import { after } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { jsonError, userOr401 } from "@/lib/api";
import { db } from "@/lib/db";
import { describeError, generateReport } from "@/lib/diagnostic/engine";
import { findOwnedDiagnostic, historyOf, STALE_GENERATION_MS, toView } from "@/lib/diagnostic/store";

// Starts building the profile report in the background and returns at once.
// Generation can take several minutes (draft, length pass, denial check), far
// longer than a hosting proxy keeps a silent request open, so the page polls
// GET /api/diagnostics/[id] until the status becomes "completed".
export async function POST(_req: Request, ctx: RouteContext<"/api/diagnostics/[id]/report">) {
  const user = await userOr401();
  if (user instanceof Response) return user;
  const d = await findOwnedDiagnostic((await ctx.params).id, user.id);
  if (!d) return jsonError(404, "Not found.");
  if (d.status === "completed") return Response.json(toView(d));
  if (d.status !== "ready" && d.status !== "generating") {
    return jsonError(409, "The diagnostic isn't ready for a report yet.");
  }

  // Claim the job in one conditional update, so a double click, a second tab
  // or a reload can't start a second generation. A generation that has run
  // past the stale limit (for example the server restarted) can be reclaimed.
  const startedAt = new Date();
  const staleBefore = new Date(startedAt.getTime() - STALE_GENERATION_MS);
  const { count } = await db.diagnostic.updateMany({
    where: {
      id: d.id,
      OR: [
        { status: "ready" },
        { status: "generating", reportStartedAt: null },
        { status: "generating", reportStartedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "generating", reportStartedAt: startedAt, reportError: null },
  });

  if (count === 1) {
    const { id, domain, userTurns } = d;
    const history = historyOf(d);
    after(() => runReportJob(id, domain, history, userTurns, startedAt));
  }

  // Either we just started it, or one is already running: report its state.
  const fresh = await findOwnedDiagnostic(d.id, user.id);
  return Response.json(toView(fresh!), { status: 202 });
}

async function runReportJob(
  id: string,
  domain: Parameters<typeof generateReport>[0],
  history: Parameters<typeof generateReport>[1],
  userTurns: number,
  startedAt: Date,
) {
  // Only this run's claim may be written; a newer claim (after a stale
  // restart) owns the row instead.
  const mine = { id, status: "generating", reportStartedAt: startedAt };
  try {
    const report = await generateReport(domain, history, userTurns);
    await db.diagnostic.updateMany({
      where: mine,
      data: {
        status: "completed",
        reportRaw: report.raw,
        reportDraft: report.draft,
        reportChecks: report.checks as unknown as Prisma.InputJsonValue,
        narrative: report.narrative,
        constraint: report.constraint,
        counterBelief: report.counterBelief,
        completedAt: new Date(),
        reportStartedAt: null,
      },
    });
  } catch (e) {
    console.error("generateReport failed", e);
    await db.diagnostic.updateMany({
      where: mine,
      data: {
        status: "ready",
        reportStartedAt: null,
        reportError: "Could not generate report: " + describeError(e),
      },
    });
  }
}

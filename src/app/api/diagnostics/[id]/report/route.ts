import { jsonError, userOr401 } from "@/lib/api";
import { describeError, generateReport } from "@/lib/diagnostic/engine";
import { findOwnedDiagnostic, historyOf, saveIfUnchanged, toView } from "@/lib/diagnostic/store";

// Generates the profile report and saves it to the user's account.
export async function POST(_req: Request, ctx: RouteContext<"/api/diagnostics/[id]/report">) {
  const user = await userOr401();
  if (user instanceof Response) return user;
  const d = await findOwnedDiagnostic((await ctx.params).id, user.id);
  if (!d) return jsonError(404, "Not found.");
  if (d.status === "completed") return Response.json(toView(d));
  if (d.status !== "ready") return jsonError(409, "The diagnostic isn't ready for a report yet.");

  let report;
  try {
    report = await generateReport(d.domain, historyOf(d));
  } catch (e) {
    console.error("generateReport failed", e);
    return jsonError(502, "Could not generate report: " + describeError(e));
  }

  await saveIfUnchanged(d, {
    status: "completed",
    reportRaw: report.raw,
    narrative: report.narrative,
    constraint: report.constraint,
    counterBelief: report.counterBelief,
    completedAt: new Date(),
  });
  // If another tab finished first, return whichever report was saved.
  const fresh = await findOwnedDiagnostic(d.id, user.id);
  return Response.json(toView(fresh!));
}

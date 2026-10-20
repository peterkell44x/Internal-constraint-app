import "server-only";

import { after } from "next/server";

import type { Diagnostic, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import type { DomainKey } from "./domains";
import { describeError, generateReport } from "./engine";
import { historyOf, STALE_GENERATION_MS } from "./store";
import { generateArchitectReport } from "./v2/engine";
import { parseFlow } from "./v2/flow";

// Builds the report in the background. Generation takes longer than a hosting
// proxy keeps a silent request open, so the page polls GET
// /api/diagnostics/[id] until the status becomes "completed".

/**
 * Claims the report job in one conditional update, so a double click, a
 * second tab or a reload can't start a second generation, then runs it after
 * the response. A generation past the stale limit (for example the server
 * restarted) can be reclaimed. Must be called from a request handler.
 */
export async function startReportJob(d: Diagnostic & { domain: DomainKey }): Promise<void> {
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
  if (count !== 1) return;
  if (d.version === 2) after(() => runArchitectJob(d.id, d.domain, d.flow, startedAt));
  else after(() => runReportJob(d.id, d.domain, historyOf(d), d.userTurns, startedAt));
}

async function runReportJob(
  id: string,
  domain: DomainKey,
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
      data: { status: "ready", reportStartedAt: null, reportError: "Could not generate report: " + describeError(e) },
    });
  }
}

async function runArchitectJob(id: string, domain: DomainKey, flow: unknown, startedAt: Date) {
  const mine = { id, status: "generating", reportStartedAt: startedAt };
  try {
    const { report, original, checks } = await generateArchitectReport(domain, parseFlow(flow));
    await db.diagnostic.updateMany({
      where: mine,
      data: {
        status: "completed",
        reportJson: report as unknown as Prisma.InputJsonValue,
        reportDraft: JSON.stringify(original),
        reportChecks: checks as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        reportStartedAt: null,
      },
    });
  } catch (e) {
    console.error("generateArchitectReport failed", e);
    await db.diagnostic.updateMany({
      where: mine,
      data: { status: "ready", reportStartedAt: null, reportError: "Could not generate report: " + describeError(e) },
    });
  }
}

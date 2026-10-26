import Link from "next/link";

import AppNav from "@/components/AppNav";
import Header from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDomainKey } from "@/lib/diagnostic/domains";
import { ANSWER_STEPS, parseFlow, TOTAL_STEPS } from "@/lib/diagnostic/v2/flow";
import { DOMAIN_LABELS } from "@/lib/diagnostic/v2/prompts";
import type { ArchitectReport } from "@/lib/diagnostic/v2/schema";

export const metadata = { title: "My reports · Internal Constraint" };

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function domainLabel(domain: string) {
  return isDomainKey(domain) ? DOMAIN_LABELS[domain] : domain;
}

/** One line for a completed report: the old constraint, or the first sentence of the hidden block card. */
function summary(d: { version: number; constraint: string | null; reportJson: unknown }): string | null {
  if (d.version !== 2) return d.constraint;
  const card = (d.reportJson as ArchitectReport | null)?.sections?.[1]?.cards?.[1] ?? "";
  return card.split(/(?<=[.!?])\s+/)[0] || null;
}

function progressLine(d: { version: number; userTurns: number; flow: unknown }): string {
  if (d.version !== 2) return d.userTurns + " answer" + (d.userTurns === 1 ? "" : "s") + " so far. Pick up where you left off.";
  const f = parseFlow(d.flow);
  if (f.answers.length >= ANSWER_STEPS) return "All " + TOTAL_STEPS + " questions answered. Open it to start your report.";
  return "Step " + (f.answers.length + 1) + " of " + TOTAL_STEPS + ". Pick up where you left off.";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const diagnostics = await db.diagnostic.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, domain: true, status: true, constraint: true, userTurns: true, createdAt: true, completedAt: true,
      version: true, flow: true, reportJson: true,
    },
  });
  const completed = diagnostics.filter((d) => d.status === "completed");
  const unfinished = diagnostics.filter((d) => d.status !== "completed");

  return (
    <>
      <AppNav email={user.email} />
      <Header
        title={user.name ? "Welcome back, " + user.name : "Your reports"}
        subtitle="Every completed diagnostic is saved here"
        actions={<Link href="/diagnostic/new" className="button primary">New diagnostic</Link>}
      />

      {unfinished.length > 0 && (
        <>
          <h2 className="section-title">In progress</h2>
          <ul className="report-list">
            {unfinished.map((d) => (
              <li key={d.id}>
                <Link href={"/diagnostic/" + d.id} className="report-item">
                  <div className="report-item-top">
                    <span>{domainLabel(d.domain)}</span>
                    <span className="muted">{dateFmt.format(d.createdAt)}</span>
                  </div>
                  <p>
                    {d.status === "generating"
                      ? "Building your profile report."
                      : d.status === "ready"
                      ? "Ready to generate your profile report."
                      : progressLine(d)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="section-title">Completed reports</h2>
      {completed.length === 0 ? (
        <p className="empty">
          No reports yet. <Link href="/diagnostic/new">Start your first diagnostic</Link>.
        </p>
      ) : (
        <ul className="report-list">
          {completed.map((d) => (
            <li key={d.id}>
              <Link href={"/diagnostic/" + d.id} className="report-item">
                <div className="report-item-top">
                  <span>{domainLabel(d.domain)}</span>
                  <span className="muted">{dateFmt.format(d.completedAt ?? d.createdAt)}</span>
                </div>
                {summary(d) && <p>{summary(d)}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

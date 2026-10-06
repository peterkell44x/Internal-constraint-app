import Link from "next/link";

import AppNav from "@/components/AppNav";
import Header from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DOMAINS, isDomainKey } from "@/lib/diagnostic/domains";

export const metadata = { title: "My reports · Internal Constraint" };

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function domainLabel(domain: string) {
  return isDomainKey(domain) ? DOMAINS[domain].label : domain;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const diagnostics = await db.diagnostic.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, domain: true, status: true, constraint: true, userTurns: true, createdAt: true, completedAt: true },
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
                      : d.userTurns + " answer" + (d.userTurns === 1 ? "" : "s") + " so far. Pick up where you left off."}
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
                {d.constraint && <p>{d.constraint}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

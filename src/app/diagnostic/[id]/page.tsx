import { notFound } from "next/navigation";

import AppNav from "@/components/AppNav";
import DiagnosticSession from "@/components/DiagnosticSession";
import ReportInternals from "@/components/ReportInternals";
import { requireUser } from "@/lib/auth";
import { canSeeReportInternals } from "@/lib/debug";
import { DOMAINS } from "@/lib/diagnostic/domains";
import { findOwnedDiagnostic, toView } from "@/lib/diagnostic/store";

export default async function DiagnosticPage({ params }: PageProps<"/diagnostic/[id]">) {
  const user = await requireUser();
  const d = await findOwnedDiagnostic((await params).id, user.id);
  if (!d) notFound();
  const domain = DOMAINS[d.domain];

  return (
    <>
      <AppNav email={user.email} />
      <DiagnosticSession
        initial={toView(d)}
        subtitle={domain.subtitle}
        reportTitle={domain.reportTitle}
      />
      {d.status === "completed" && canSeeReportInternals(user.email) && (
        <ReportInternals draft={d.reportDraft} checks={d.reportChecks} />
      )}
    </>
  );
}

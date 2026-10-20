import { notFound } from "next/navigation";

import AppNav from "@/components/AppNav";
import ArchitectInternals from "@/components/ArchitectInternals";
import ArchitectSession from "@/components/ArchitectSession";
import DiagnosticSession from "@/components/DiagnosticSession";
import ReportInternals from "@/components/ReportInternals";
import { requireUser } from "@/lib/auth";
import { canSeeReportInternals } from "@/lib/debug";
import { DOMAINS } from "@/lib/diagnostic/domains";
import { findOwnedDiagnostic, toView } from "@/lib/diagnostic/store";
import { parseFlow, rendererFor } from "@/lib/diagnostic/v2/flow";
import { DOMAIN_LABELS, QUESTION_HINTS, QUESTIONS, SECTION_NAMES, TAP_QUESTIONS, UI_TEXT } from "@/lib/diagnostic/v2/prompts";

export default async function DiagnosticPage({ params }: PageProps<"/diagnostic/[id]">) {
  const user = await requireUser();
  const d = await findOwnedDiagnostic((await params).id, user.id);
  if (!d) notFound();
  const debug = canSeeReportInternals(user.email);

  // Architect diagnoses (version 2). The question text goes to the browser as
  // data; the AI instructions stay on the server.
  if (rendererFor(d.version) === "architect") {
    return (
      <>
        <AppNav email={user.email} />
        <ArchitectSession
          initial={toView(d)}
          subtitle={DOMAIN_LABELS[d.domain]}
          questions={QUESTIONS[d.domain]}
          hints={QUESTION_HINTS[d.domain]}
          tapQuestions={[...TAP_QUESTIONS]}
          sectionNames={[...SECTION_NAMES]}
          text={UI_TEXT}
        />
        {debug && <ArchitectInternals flow={parseFlow(d.flow)} checks={d.reportChecks} original={d.reportDraft} />}
      </>
    );
  }

  // Earlier reports and chats keep the old renderer.
  const domain = DOMAINS[d.domain];
  return (
    <>
      <AppNav email={user.email} />
      <DiagnosticSession
        initial={toView(d)}
        subtitle={domain.subtitle}
        reportTitle={domain.reportTitle}
      />
      {d.status === "completed" && debug && (
        <ReportInternals draft={d.reportDraft} checks={d.reportChecks} />
      )}
    </>
  );
}

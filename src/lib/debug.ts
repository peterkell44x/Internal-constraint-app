import "server-only";

// Report internals (draft, audit, check rounds) are shown only to accounts
// listed in REPORT_DEBUG_EMAILS, a comma-separated list. Leave it unset to
// hide them from everyone.
export function canSeeReportInternals(email: string): boolean {
  const allowed = (process.env.REPORT_DEBUG_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

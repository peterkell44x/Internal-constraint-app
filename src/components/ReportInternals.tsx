// Debug view of how a report was produced: the first draft, what the audit
// found in the conversation, what the length pass and each check round
// deleted, and what could not be fixed. Rendered only for accounts allowed by
// REPORT_DEBUG_EMAILS (see src/lib/debug.ts).

import type { Audit, Violation } from "@/lib/diagnostic/denial";
import type { LengthPass, ReportChecks } from "@/lib/diagnostic/engine";

interface Props {
  draft: string | null;
  checks: unknown;
}

function ViolationList({ items }: { items: Violation[] }) {
  return (
    <ul className="internals-list">
      {items.map((v, i) => (
        <li key={i}>
          <span className="pill">{v.kind}</span> &ldquo;{v.quote}&rdquo;
          <div className="muted small">{v.reason}</div>
        </li>
      ))}
    </ul>
  );
}

function AuditView({ audit }: { audit: Audit | null }) {
  if (!audit) return <p className="muted small">The audit call failed, so this report shipped unchecked.</p>;
  return (
    <>
      <h4>Rejected by you</h4>
      {audit.rejected.length === 0 ? (
        <p className="muted small">(none)</p>
      ) : (
        <ul className="internals-list">
          {audit.rejected.map((r, i) => (
            <li key={i}>
              {r.answer && (
                <span className="pill">
                  {r.answer === "uncertain" ? "labelled uncertain, kept: contains a clear denial" : r.answer}
                </span>
              )}{" "}
              {r.interpretation}
              <div className="muted small">You: &ldquo;{r.quote}&rdquo;</div>
            </li>
          ))}
        </ul>
      )}
      <h4>Confirmed by you</h4>
      {audit.confirmed.length === 0 ? (
        <p className="muted small">(none)</p>
      ) : (
        <ul className="internals-list">
          {audit.confirmed.map((c, i) => (
            <li key={i}>
              {c.link}
              <div className="muted small">You: &ldquo;{c.quote}&rdquo;</div>
            </li>
          ))}
        </ul>
      )}
      <h4>Dropped as uncertain (not treated as rejected)</h4>
      {(audit.uncertain ?? []).length === 0 ? (
        <p className="muted small">(none)</p>
      ) : (
        <ul className="internals-list">
          {(audit.uncertain ?? []).map((u, i) => (
            <li key={i}>
              {u.interpretation}
              <div className="muted small">You: &ldquo;{u.quote}&rdquo;</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ReportInternals({ draft, checks }: Props) {
  const c = checks as Partial<ReportChecks> | null;
  const isCurrentShape = !!c && Array.isArray(c.rounds);

  return (
    <details className="internals">
      <summary>How this report was checked (visible only to you)</summary>

      {!c ? (
        <p className="muted small">No check data was stored for this report.</p>
      ) : !isCurrentShape ? (
        <>
          <p className="muted small">This report was made by an older version; raw check data:</p>
          <pre className="internals-pre">{JSON.stringify(c, null, 2)}</pre>
        </>
      ) : (
        <>
          <p className="muted small">
            Took {Math.round((c.ms ?? 0) / 1000)}s.
            {c.timedOut ? " The time budget ran out, so later check rounds were skipped." : ""}
          </p>

          <h3>Audit of the conversation</h3>
          <AuditView audit={c.audit ?? null} />

          <h3>Length pass</h3>
          {c.lengthPasses === undefined ? (
            <p className="muted small">Not recorded for this report (made before length passes were saved).</p>
          ) : c.lengthPasses.length === 0 ? (
            <p className="muted small">Not needed, or no sentences removed.</p>
          ) : (
            (c.lengthPasses as LengthPass[]).map((lp, i) => (
              <div key={i}>
                <p className="small">Pass {i + 1}: words {lp.words}. Deleted:</p>
                <ul className="internals-list">
                  {lp.deleted.map((t, j) => <li key={j}>{t}</li>)}
                </ul>
              </div>
            ))
          )}

          <h3>Check rounds</h3>
          {(c.rounds ?? []).length === 0 ? (
            <p className="muted small">No check ran (the audit failed).</p>
          ) : (
            c.rounds!.map((r, i) => (
              <div key={i} className="internals-round">
                <p className="small">
                  <strong>Round {i + 1}:</strong>{" "}
                  {r.violations === null ? "the check call failed" : r.violations.length + " violation(s)"}
                </p>
                {r.violations && r.violations.length > 0 && <ViolationList items={r.violations} />}
                {r.deleted.length > 0 && (
                  <>
                    <p className="small">Deleted:</p>
                    <ul className="internals-list">
                      {r.deleted.map((t, j) => <li key={j}>{t}</li>)}
                    </ul>
                  </>
                )}
                {r.unfixable.length > 0 && (
                  <>
                    <p className="small">Could not be deleted (protected sentence, or quote not found):</p>
                    <ViolationList items={r.unfixable} />
                  </>
                )}
              </div>
            ))
          )}
        </>
      )}

      <h3>First draft</h3>
      {draft ? <pre className="internals-pre">{draft}</pre> : <p className="muted small">No draft stored.</p>}
    </details>
  );
}

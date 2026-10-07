// Debug view of how a report was produced: the first draft, what the audit
// found in the conversation, what the length pass removed, and for each check
// what was flagged, deleted, repaired and rewritten, and what still shipped.
// Rendered only for accounts allowed by REPORT_DEBUG_EMAILS (src/lib/debug.ts).

import type { Audit, Violation } from "@/lib/diagnostic/denial";
import type { CheckRound, LengthPass, ReportChecks, RewriteRecord } from "@/lib/diagnostic/engine";

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
      <h4>Unsure (not treated as rejected; every check flags them if stated as fact)</h4>
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

function RepairsView({ repairs }: { repairs: CheckRound["repairs"] }) {
  if (repairs === undefined) return null;
  if (repairs === null) return <p className="muted small">Reference repair: the call failed.</p>;
  if (repairs.applied.length + repairs.skipped.length === 0) {
    return <p className="muted small">Reference repair: no sentence referred to anything deleted.</p>;
  }
  return (
    <>
      <p className="small">Reference repair:</p>
      <ul className="internals-list">
        {repairs.applied.map((r, i) => (
          <li key={"a" + i}>
            <span className="pill">repaired</span> &ldquo;{r.original}&rdquo;
            <div className="small">&rarr; &ldquo;{r.replacement}&rdquo;</div>
          </li>
        ))}
        {repairs.skipped.map((r, i) => (
          <li key={"s" + i}>
            <span className="pill">skipped: {r.reason}</span> &ldquo;{r.original}&rdquo;
            <div className="muted small">Proposed: &ldquo;{r.replacement}&rdquo;</div>
          </li>
        ))}
      </ul>
    </>
  );
}

function RewriteView({ rewrite }: { rewrite: RewriteRecord[] | null | undefined }) {
  if (!rewrite || rewrite.length === 0) return null;
  return (
    <>
      {rewrite.map((r, i) => (
        <div key={i}>
          <p className="small">
            <strong>Rewrite of {r.label ?? r.section}:</strong>{" "}
            {r.accepted ? "accepted" : "rejected, original kept"}
            {r.issues.length > 0 && <> ({r.issues.join("; ")})</>}
          </p>
          <p className="small">Flagged:</p>
          <ViolationList items={r.flagged} />
          <p className="small">Before:</p>
          <pre className="internals-pre">{r.before}</pre>
          {r.after !== null && (
            <>
              <p className="small">{r.accepted ? "After:" : "Proposed (not used):"}</p>
              <pre className="internals-pre">{r.after}</pre>
            </>
          )}
        </div>
      ))}
    </>
  );
}

function RoundView({ r, i, isLast }: { r: CheckRound; i: number; isLast: boolean }) {
  const fixed = r.deleted.length > 0 || r.repairs !== undefined || (r.rewrite?.length ?? 0) > 0;
  return (
    <div className="internals-round">
      <p className="small">
        <strong>Check {i + 1}:</strong>{" "}
        {r.violations === null ? "the check call failed" : r.violations.length === 0 ? "clean" : r.violations.length + " violation(s)"}
        {isLast && r.violations && r.violations.length > 0 && !fixed && " (last check: these shipped)"}
      </p>
      {r.violations && r.violations.length > 0 && <ViolationList items={r.violations} />}
      {(r.withdrawn ?? []).length > 0 && (
        <>
          <p className="small">Withdrawn by the checker (ignored):</p>
          <ViolationList items={r.withdrawn ?? []} />
        </>
      )}
      {(r.dismissed ?? []).length > 0 && (
        <>
          <p className="small">Dismissed (numbers you did say, in another form):</p>
          <ViolationList items={r.dismissed} />
        </>
      )}
      {r.deleted.length > 0 && (
        <>
          <p className="small">Deleted:</p>
          <ul className="internals-list">
            {r.deleted.map((t, j) => <li key={j}>{t}</li>)}
          </ul>
        </>
      )}
      <RepairsView repairs={r.repairs} />
      <RewriteView rewrite={r.rewrite} />
      {r.unfixable.length > 0 && !(r.rewrite && r.rewrite.length > 0) && (
        <>
          <p className="small">In protected sentences (or not found), not fixed this round:</p>
          <ViolationList items={r.unfixable} />
        </>
      )}
    </div>
  );
}

export default function ReportInternals({ draft, checks }: Props) {
  const c = checks as Partial<ReportChecks> | null;
  const isCurrentShape = !!c && Array.isArray(c.rounds);
  const rounds = c?.rounds ?? [];
  const last = rounds.at(-1);

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
            {c.timedOut ? " The time budget ran out, so later checks were skipped." : ""}
          </p>

          <h3>Audit of the conversation</h3>
          <AuditView audit={c.audit ?? null} />

          {c.statedProblem !== undefined && (
            <>
              <h3>Your stated problem</h3>
              <p className="small">
                {c.statedProblem === null ? "Could not be extracted, so the constraint's tie to it was not checked." : <>&ldquo;{c.statedProblem}&rdquo;</>}
              </p>
            </>
          )}

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

          <h3>Checks and fixes</h3>
          {rounds.length === 0 ? (
            <p className="muted small">No check ran (the audit failed).</p>
          ) : (
            rounds.map((r, i) => <RoundView key={i} r={r} i={i} isLast={i === rounds.length - 1} />)
          )}

          {c.problemFix && (
            <>
              <h3>Stated problem tie, after the checks</h3>
              <p className="muted small">The constraint still did not end on your stated problem, so it was rewritten once more (not re-checked).</p>
              <RewriteView rewrite={[c.problemFix]} />
            </>
          )}

          {/* Reports from the previous version kept these at the top level. */}
          {c.repairs !== undefined && (
            <>
              <h3>Reference repair</h3>
              <RepairsView repairs={c.repairs} />
            </>
          )}
          {c.rewrite && (
            <>
              <h3>Targeted section rewrite</h3>
              <RewriteView rewrite={c.rewrite} />
            </>
          )}
          {c.final && (
            <>
              <h3>Final check</h3>
              {c.final.violations === null ? (
                <p className="muted small">The final check call failed.</p>
              ) : c.final.violations.length === 0 ? (
                <p className="small">Clean.</p>
              ) : (
                <ViolationList items={c.final.violations} />
              )}
            </>
          )}

          {!c.final && last && (
            <p className="small">
              <strong>As shipped:</strong>{" "}
              {last.violations === null
                ? "the last check failed, so what shipped is unverified."
                : last.violations.length === 0
                ? "the last check was clean."
                : last.deleted.length > 0 || last.repairs !== undefined || (last.rewrite?.length ?? 0) > 0
                ? "fixes were applied after the last check and were not re-checked (the time budget ran out)."
                : "the last check's flags above shipped."}
            </p>
          )}
        </>
      )}

      <h3>First draft</h3>
      {draft ? <pre className="internals-pre">{draft}</pre> : <p className="muted small">No draft stored.</p>}
    </details>
  );
}

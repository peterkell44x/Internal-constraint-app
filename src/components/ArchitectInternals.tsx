// Debug view of how an Architect report was made: the hidden tie, the
// repeated words passed to each reaction, reaction retries, which cards were
// rewritten and why, which sentences were deleted and why, and whether the AI
// check succeeded. Rendered only for accounts in REPORT_DEBUG_EMAILS.

import type { ArchitectChecks } from "@/lib/diagnostic/v2/engine";
import type { Flow } from "@/lib/diagnostic/v2/flow";

interface Props {
  flow: Flow;
  checks: unknown;
  original: string | null;
}

export default function ArchitectInternals({ flow, checks, original }: Props) {
  const c = (checks ?? null) as Partial<ArchitectChecks> | null;
  return (
    <details className="internals">
      <summary>How this report was checked (visible only to you)</summary>

      <h3>Reactions</h3>
      {flow.reactions.length === 0 ? (
        <p className="muted small">None yet.</p>
      ) : (
        <ul className="internals-list">
          {[...flow.reactions].sort((a, b) => a.step - b.step).map((r) => (
            <li key={r.step}>
              <strong>{r.step === 9 ? "After the first tap" : "Answer " + r.step}</strong>
              {r.fallback && <span className="pill">AI failed twice, fallback line shown</span>}
              {r.crisis && <span className="pill">crisis</span>}
              {r.thin && <span className="pill">THIN_ANSWER</span>}
              <div className="muted small">
                Anchor: {r.anchor ? <>&ldquo;{r.anchor}&rdquo; {r.anchorOk ? "(found in their answers)" : "(NOT found in their answers)"}</> : "(none)"}
                {" · "}boldness: {r.boldness ?? "n/a"}
                {" · "}attempts: {r.attempts ?? 1}
              </div>
              {(r.fired ?? []).length > 0 && <div className="muted small">Checks that fired: {r.fired!.join(", ")}</div>}
              {(r.problems ?? []).length > 0 && <div className="muted small">Retries: {r.problems!.join("; ")}</div>}
            </li>
          ))}
        </ul>
      )}

      {!c ? (
        <p className="muted small">No report yet.</p>
      ) : (
        <>
          <h3>Hidden tie</h3>
          <p className="small">{c.hiddenTie}</p>
          <p className="muted small">
            Took {Math.round((c.ms ?? 0) / 1000)}s. Report call attempts: {c.reportAttempts}
            {c.sensitive ? ". Written as SENSITIVE (a reaction had the crisis flag)." : "."}
          </p>
          {(c.reportProblems ?? []).length > 0 && <p className="muted small">Report retries: {c.reportProblems!.join("; ")}</p>}

          <h3>AI fact check</h3>
          {c.aiCheck?.status === "ok" ? (
            <p className="small">Succeeded ({c.aiCheck.attempts} attempt{c.aiCheck.attempts === 1 ? "" : "s"}), {c.aiCheck.flagged} sentence(s) flagged.</p>
          ) : (
            <p className="small"><strong>AI check failed</strong> after {c.aiCheck?.attempts ?? 0} attempts ({c.aiCheck?.error ?? "no reply"}). The report shipped with the code checks only.</p>
          )}

          <h3>Code checks that fired</h3>
          {(c.fired ?? []).length === 0 ? (
            <p className="muted small">None.</p>
          ) : (
            <ul className="internals-list">
              {c.fired!.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}

          <h3>Cards rewritten</h3>
          {(c.regenerated ?? []).length === 0 ? (
            <p className="muted small">None.</p>
          ) : (
            <ul className="internals-list">
              {c.regenerated!.map((g, i) => (
                <li key={i}>
                  <span className="pill">{g.result}</span> {g.card}
                  <div className="muted small">{g.reasons.join(" ")}</div>
                </li>
              ))}
            </ul>
          )}

          <h3>Sentences deleted</h3>
          {(c.deleted ?? []).length === 0 ? (
            <p className="muted small">None.</p>
          ) : (
            <ul className="internals-list">
              {c.deleted!.map((d, i) => (
                <li key={i}>
                  <span className="pill">{d.by === "ai" ? "AI check" : "code check"}</span> {d.card}: &ldquo;{d.sentence}&rdquo;
                  <div className="muted small">{d.reason}</div>
                </li>
              ))}
            </ul>
          )}

          {(c.edited ?? []).length > 0 && (
            <>
              <h3>Sentences edited by the AI check (words removed only)</h3>
              <ul className="internals-list">
                {c.edited!.map((e, i) => (
                  <li key={i}>
                    {e.card}: &ldquo;{e.before}&rdquo;
                    <div className="small">&rarr; &ldquo;{e.after}&rdquo;</div>
                    <div className="muted small">{e.reason}</div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {(c.shortCards ?? []).length > 0 && (
            <p className="small">Cards under 40 words when shipped: {c.shortCards!.join(", ")}</p>
          )}
        </>
      )}

      {original && (
        <>
          <h3>First version from the AI, before the checks</h3>
          <pre className="internals-pre">{JSON.stringify(JSON.parse(original), null, 2)}</pre>
        </>
      )}
    </details>
  );
}

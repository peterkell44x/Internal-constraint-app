"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import ArchitectReport from "@/components/ArchitectReport";
import Header from "@/components/Header";
import type { DiagnosticView } from "@/lib/diagnostic/store";
import {
  currentScreen,
  emptyFlow,
  MAX_ANSWER_CHARS,
  progressPercent,
  transcript,
  TOTAL_STEPS,
} from "@/lib/diagnostic/v2/flow";
import type { UI_TEXT } from "@/lib/diagnostic/v2/prompts";

interface Props {
  initial: DiagnosticView;
  subtitle: string;
  questions: string[];
  /** The grey hint under each question; shown only, never sent to the AI. */
  hints: string[];
  tapQuestions: string[];
  sectionNames: string[];
  text: typeof UI_TEXT;
}

async function post(url: string, body?: unknown): Promise<DiagnosticView> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ").");
  return data as DiagnosticView;
}

/**
 * The Architect diagnosis: 8 fixed questions, a short reaction after each,
 * a halfway screen after the fifth, two Yes / No taps, then the report.
 * Everything is saved on the server after each step, so a reload picks up at
 * the same step.
 */
export default function ArchitectSession({ initial, subtitle, questions, hints, tapQuestions, sectionNames, text }: Props) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const chatRef = useRef<HTMLDivElement>(null);
  const requested = useRef<string | null>(null);

  const base = "/api/diagnostics/" + view.id;
  const flow = view.flow ?? emptyFlow();
  const screen = currentScreen(flow);
  const generating = view.status === "generating";
  const completed = view.status === "completed";
  const waitingForReaction = screen.kind === "reaction";

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view, pending, busy]);

  // A reaction that is still missing after a reload (it was being written
  // when the page closed) is asked for again.
  useEffect(() => {
    if (screen.kind !== "reaction" || busy) return;
    const key = "reaction" + screen.step;
    if (requested.current === key) return;
    requested.current = key;
    post(base + "/reaction", { step: screen.step })
      .then(setView)
      .catch((e: Error) => setError(e.message));
  }, [screen, busy, base]);

  // After the last tap the report is built on the server. If the page was
  // reloaded before it started, start it.
  useEffect(() => {
    if (view.status !== "ready" || view.reportError || screen.kind !== "done") return;
    if (requested.current === "report") return;
    requested.current = "report";
    post(base + "/report").then(setView).catch((e: Error) => setError(e.message));
  }, [view.status, view.reportError, screen.kind, base]);

  // While the report is being built, check in every few seconds.
  useEffect(() => {
    if (!generating || view.generationStale) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(base, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as DiagnosticView;
        if (next.status === "generating" && !next.generationStale) return;
        setView(next);
        if (next.status === "completed") router.refresh();
      } catch {
        // A missed check is fine; the next one tries again.
      }
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [generating, view.generationStale, base, router]);

  async function act(shown: string | null, url: string, body?: unknown, onError?: () => void) {
    if (busy) return;
    setBusy(true);
    setPending(shown);
    setError(null);
    try {
      setView(await post(url, body));
    } catch (e) {
      setError((e as Error).message);
      onError?.();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function sendAnswer() {
    if (screen.kind !== "question") return;
    const val = input.trim();
    if (!val) return;
    setInput("");
    void act(val, base + "/answer", { step: screen.step, text: val }, () => setInput(val));
  }

  function tap(value: boolean) {
    if (screen.kind !== "tap") return;
    void act(value ? text.yes : text.no, base + "/tap", { step: screen.step, value });
  }

  function retryReport() {
    requested.current = "report";
    void act(null, base + "/report");
  }

  if (completed && view.architectReport) {
    return (
      <>
        <Header title="Internal constraint diagnostic" subtitle={subtitle} />
        <ArchitectReport report={view.architectReport} sectionNames={sectionNames} crisis={view.crisis} text={text} />
      </>
    );
  }

  const bubbles = transcript(flow, questions, tapQuestions, hints);
  const elapsedMs = view.reportStartedAt ? Math.max(0, now - Date.parse(view.reportStartedAt)) : 0;
  const elapsed = Math.floor(elapsedMs / 60000) + ":" + String(Math.floor(elapsedMs / 1000) % 60).padStart(2, "0");
  const stepNumber = Math.min(TOTAL_STEPS, flow.answers.length + flow.taps.length + (screen.kind === "done" ? 0 : 1));

  return (
    <>
      <Header title="Internal constraint diagnostic" subtitle={subtitle} />
      <div className="progress" role="progressbar" aria-valuenow={progressPercent(flow)} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: progressPercent(flow) + "%" }} />
      </div>
      <p className="muted small progress-label">
        {screen.kind === "done" ? "All " + TOTAL_STEPS + " steps done" : "Step " + stepNumber + " of " + TOTAL_STEPS}
      </p>

      <div className="chat architect-chat" ref={chatRef}>
        {bubbles.map((b, i) =>
          b.kind === "halfway" ? (
            <div key={i} className="bubble assistant halfway-note">{text.halfway}</div>
          ) : b.kind === "answer" ? (
            <div key={i} className="bubble user">{b.text}</div>
          ) : (
            <div key={i} className={"bubble assistant" + (b.kind === "question" ? " question" : "")}>
              {b.text}
              {b.kind === "question" && b.hint && <p className="question-hint">{b.hint}</p>}
              {b.kind === "reaction" && b.crisis && <p className="support-line">{text.supportLine}</p>}
            </div>
          ),
        )}
        {pending && <div className="bubble user">{pending}</div>}
        {(waitingForReaction || (busy && pending)) && <div className="typing">typing...</div>}
      </div>

      {error && <p className="form-error">{error}</p>}

      {screen.kind === "question" && (
        <div className="answer-box">
          <textarea
            value={input}
            maxLength={MAX_ANSWER_CHARS}
            rows={4}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your answer..."
            disabled={busy}
          />
          <div className="answer-row">
            <span className="muted small">{input.length > MAX_ANSWER_CHARS - 500 ? input.length + " / " + MAX_ANSWER_CHARS : ""}</span>
            <button className="primary" onClick={sendAnswer} disabled={busy || !input.trim()}>Send</button>
          </div>
        </div>
      )}

      {screen.kind === "halfway" && (
        <div className="halfway-card">
          <p>{text.halfway}</p>
          <button className="primary" onClick={() => void act(null, base + "/halfway")} disabled={busy}>
            {text.halfwayButton}
          </button>
        </div>
      )}

      {screen.kind === "tap" && (
        <div className="tap-row">
          <button className="primary" onClick={() => tap(true)} disabled={busy}>{text.yes}</button>
          <button onClick={() => tap(false)} disabled={busy}>{text.no}</button>
        </div>
      )}

      {screen.kind === "done" && !completed && (
        <div className="building-panel" role="status">
          {view.status === "ready" && view.reportError ? (
            <>
              <p className="building-title">{text.reportFailed}</p>
              <button onClick={retryReport} disabled={busy}>{text.tryAgain}</button>
            </>
          ) : view.generationStale ? (
            <>
              <p className="building-title">{text.reportFailed}</p>
              <button onClick={retryReport} disabled={busy}>{text.tryAgain}</button>
            </>
          ) : (
            <>
              <p className="building-title">
                {text.building} <span className="building-timer">{generating ? elapsed : ""}</span>
              </p>
              <p className="muted small">{text.buildingDetail}</p>
            </>
          )}
        </div>
      )}
    </>
  );
}

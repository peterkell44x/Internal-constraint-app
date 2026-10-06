"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { DiagnosticView } from "@/lib/diagnostic/store";

import Header from "./Header";
import ReportView from "./ReportView";

// Browser side of the diagnostic. Behaves like the prototype's chat UI; the
// conversation itself is run and saved by the server.

type Bubble = { role: "user" | "assistant" | "error"; content: string };

interface Props {
  initial: DiagnosticView;
  subtitle: string;
  reportTitle: string;
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

export default function DiagnosticSession({ initial, subtitle, reportTitle }: Props) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [bubbles, setBubbles] = useState<Bubble[]>(initial.messages);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const [building, setBuilding] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const base = "/api/diagnostics/" + view.id;
  const ready = view.status === "ready";
  const generating = view.status === "generating";
  const completed = view.status === "completed";
  const [now, setNow] = useState(() => Date.now());

  function applyView(next: DiagnosticView) {
    setView(next);
    setBubbles(next.messages);
  }

  async function startConversation() {
    setStartFailed(false);
    setThinking(true);
    try {
      applyView(await post(base + "/start"));
    } catch (e) {
      setBubbles((b) => [...b, { role: "error", content: (e as Error).message }]);
      setStartFailed(true);
    } finally {
      setThinking(false);
    }
  }

  // Kick off the opening message for a brand new diagnostic.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initial.status === "in_progress" && initial.messages.length === 0) void startConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bubbles, thinking]);

  // While the report is being built on the server, check in every few
  // seconds and tick the elapsed timer. This also picks up a generation that
  // was already running when the page was opened or reloaded.
  useEffect(() => {
    if (!generating || view.generationStale) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await fetch(base, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as DiagnosticView;
        if (next.status === "generating" && !next.generationStale) return;
        applyView(next);
        if (next.status === "completed") router.refresh();
      } catch {
        // A missed check is fine; the next one tries again.
      }
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, view.generationStale, base]);

  async function sendMessage() {
    const val = input.trim();
    if (!val || thinking || ready || completed) return;
    setInput("");
    setBubbles((b) => [...b, { role: "user", content: val }]);
    setThinking(true);
    try {
      applyView(await post(base + "/messages", { text: val, userTurns: view.userTurns }));
    } catch (e) {
      // Nothing was saved; put the answer back so it can be resent.
      setBubbles((b) => [...b.slice(0, -1), { role: "error", content: (e as Error).message }]);
      setInput(val);
    } finally {
      setThinking(false);
      inputRef.current?.focus();
    }
  }

  // Starts the report on the server. The request returns straight away; the
  // polling effect above waits for the result.
  async function generateReport() {
    if (building) return;
    setBuilding(true);
    setReportError(null);
    try {
      const next = await post(base + "/report");
      setNow(Date.now());
      applyView(next);
      if (next.status === "completed") router.refresh();
    } catch (e) {
      setReportError((e as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  async function deleteDiagnostic() {
    if (!confirm("Delete this diagnostic and its report? This can't be undone.")) return;
    const res = await fetch(base, { method: "DELETE" });
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  const answers = view.userTurns;
  const elapsedMs = view.reportStartedAt ? Math.max(0, now - Date.parse(view.reportStartedAt)) : 0;
  const elapsed = Math.floor(elapsedMs / 60000) + ":" + String(Math.floor(elapsedMs / 1000) % 60).padStart(2, "0");
  const shownError = reportError ?? (ready ? view.reportError : null);
  const turnCount = answers > 0 ? answers + " answer" + (answers === 1 ? "" : "s") + " so far" : "";

  if (completed && view.report) {
    return (
      <>
        <Header title="Internal constraint diagnostic" subtitle={subtitle} />
        <ReportView reportTitle={reportTitle} report={view.report} completedAt={view.completedAt} />
        <details className="transcript-details">
          <summary>Show the conversation ({answers} answers)</summary>
          <div className="chat transcript">
            {bubbles.map((m, i) => (
              <div key={i} className={"bubble " + m.role}>{m.content}</div>
            ))}
          </div>
        </details>
        <div className="page-actions">
          <Link href="/dashboard" className="button">Back to my reports</Link>
          <button className="small-btn" onClick={deleteDiagnostic}>Delete</button>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Internal constraint diagnostic" subtitle={subtitle} />
      <div className="chat" ref={chatRef}>
        {bubbles.map((m, i) => (
          <div key={i} className={"bubble " + m.role}>{m.content}</div>
        ))}
        {thinking && <div className="typing">thinking...</div>}
      </div>

      {generating && (
        <div className="building-panel" role="status">
          {view.generationStale ? (
            <>
              <p className="building-title">This is taking much longer than it should.</p>
              <p className="muted small">Something may have gone wrong while building your report.</p>
              <button onClick={generateReport} disabled={building} style={{ fontSize: 13 }}>
                Try again
              </button>
            </>
          ) : (
            <>
              <p className="building-title">
                Building your report <span className="building-timer">{elapsed}</span>
              </p>
              <p className="muted small">
                This usually takes 2 to 4 minutes. You can leave or reload this page; it keeps going.
              </p>
            </>
          )}
        </div>
      )}

      {shownError && <div className="report">{shownError}</div>}

      <div className="input-row">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void sendMessage();
          }}
          placeholder={
            generating
              ? "Building your report..."
              : ready
              ? "Ready. Click Generate profile report below."
              : "Type your answer..."
          }
          autoComplete="off"
          disabled={ready || generating || startFailed}
        />
        <button
          className="primary"
          onClick={() => void sendMessage()}
          disabled={ready || generating || thinking || startFailed}
        >
          Send
        </button>
      </div>
      <div className="footer-row">
        <span className="turn-count">{turnCount}</span>
        <div>
          <Link href="/diagnostic/new" className="button small-btn">Switch domain</Link>
          {ready && (
            <button onClick={generateReport} disabled={building} style={{ fontSize: 13 }}>
              {building ? "Starting..." : "Generate profile report"}
            </button>
          )}
        </div>
      </div>
      {startFailed && (
        <button className="retry-btn" onClick={() => void startConversation()}>Retry</button>
      )}
    </>
  );
}

// The Architect chat as a step machine: 8 fixed questions, a short reaction
// after each, then one "Show me my report" button. The whole state is saved
// after every step, so a reload continues at the same step.
//
// Earlier version 2 diagnostics also had two Yes / No taps (and a reaction
// numbered 9 after the first). Those saved taps are still read so old
// diagnostics open, but nothing uses them any more and new ones never get any.
//
// Pure module: no prompts, no database. Used by the server and the browser.

export const ANSWER_STEPS = 8;
export const TOTAL_STEPS = ANSWER_STEPS;
export const MAX_ANSWER_CHARS = 3000;

/** How bold a reaction may be: gentle for answers 1 to 3, medium for 4 and 5, direct for 6 to 8. */
export type Boldness = "gentle" | "medium" | "direct";

export function boldnessFor(step: number): Boldness {
  return step <= 3 ? "gentle" : step <= 5 ? "medium" : "direct";
}

export interface Reaction {
  /** 1 to 8 for answers (9 was the first tap's reaction in older diagnostics). */
  step: number;
  text: string;
  crisis: boolean;
  /** True when the AI call failed twice and the neutral line was shown instead. */
  fallback?: boolean;
  /** True when the question's neutral line was shown instead of the AI's reaction. */
  neutral?: boolean;
  /** Debug: the reply had the crisis flag, so the anchor check was skipped. */
  anchorSkipped?: boolean;
  /** Debug: the exact words from their answers the reaction is built on, and whether the code found them. */
  anchor?: string;
  anchorOk?: boolean;
  /** Debug: the answer was under the THIN_ANSWER length, and the boldness asked for. */
  thin?: boolean;
  boldness?: Boldness;
  /** Debug: code checks that fired (em dash, word echo, "chasing", trim). */
  fired?: string[];
  /** Debug: how many AI attempts it took, and why earlier ones were refused. */
  attempts?: number;
  problems?: string[];
}

export interface Flow {
  answers: string[];
  /** Only in older diagnostics; always empty now. */
  taps: boolean[];
  reactions: Reaction[];
}

export type Screen =
  | { kind: "question"; step: number }
  | { kind: "reaction"; step: number }
  | { kind: "done" };

export function emptyFlow(): Flow {
  return { answers: [], taps: [], reactions: [] };
}

/** Reads a saved flow defensively; anything malformed becomes an empty flow. */
export function parseFlow(value: unknown): Flow {
  const v = (value ?? {}) as Partial<Flow>;
  return {
    answers: Array.isArray(v.answers) ? v.answers.filter((a): a is string => typeof a === "string").slice(0, ANSWER_STEPS) : [],
    taps: Array.isArray(v.taps) ? v.taps.filter((t): t is boolean => typeof t === "boolean").slice(0, 2) : [],
    reactions: Array.isArray(v.reactions)
      ? v.reactions.filter((r): r is Reaction => !!r && typeof r.step === "number" && typeof r.text === "string")
      : [],
  };
}

export function reactionFor(f: Flow, step: number): Reaction | undefined {
  return f.reactions.find((r) => r.step === step);
}

/**
 * What the person should see now. "done" comes after the reaction to answer
 * 8: the "Show me my report" button, or the report once it has started.
 */
export function currentScreen(f: Flow): Screen {
  const missing = f.answers.map((_, i) => i + 1).find((s) => !reactionFor(f, s));
  if (missing !== undefined) return { kind: "reaction", step: missing };
  if (f.answers.length < ANSWER_STEPS) return { kind: "question", step: f.answers.length + 1 };
  return { kind: "done" };
}

/** Answered questions out of 8, as a percentage: 12.5% per step, 100% when the report can start. */
export function progressPercent(f: Flow): number {
  return Math.round((f.answers.length / TOTAL_STEPS) * 100);
}

/** Checks an answer before it is saved; returns an error message or null. */
export function answerError(f: Flow, step: number, text: string): string | null {
  const screen = currentScreen(f);
  if (screen.kind !== "question" || screen.step !== step) return "This question was already answered. Please reload.";
  if (!text.trim()) return "Please type an answer.";
  if (text.length > MAX_ANSWER_CHARS) return "That answer is too long (" + MAX_ANSWER_CHARS + " characters at most).";
  return null;
}

export function withAnswer(f: Flow, text: string): Flow {
  return { ...f, answers: [...f.answers, text.trim()] };
}

export function withReaction(f: Flow, r: Reaction): Flow {
  return { ...f, reactions: [...f.reactions.filter((x) => x.step !== r.step), r] };
}

/** True when any reaction came back with the crisis flag; the report is then written as SENSITIVE. */
export function isSensitive(f: Flow): boolean {
  return f.reactions.some((r) => r.crisis);
}

export type Bubble =
  | { kind: "question"; text: string; hint?: string }
  | { kind: "answer"; text: string }
  | { kind: "reaction"; text: string; crisis: boolean };

/**
 * The chat as the person sees it: each question, their answer, and the
 * reaction that leads into the next question. The current question is last
 * when one is waiting. Old taps are not shown.
 */
export function transcript(f: Flow, questions: string[], hints: string[] = []): Bubble[] {
  const out: Bubble[] = [];
  const react = (step: number) => {
    const r = reactionFor(f, step);
    if (r) out.push({ kind: "reaction", text: r.text, crisis: r.crisis });
  };
  const screen = currentScreen(f);
  for (let i = 0; i < ANSWER_STEPS; i++) {
    const step = i + 1;
    if (i >= f.answers.length) {
      if (screen.kind === "question" && screen.step === step) out.push({ kind: "question", text: questions[i], hint: hints[i] });
      return out;
    }
    out.push({ kind: "question", text: questions[i], hint: hints[i] }, { kind: "answer", text: f.answers[i] });
    react(step);
  }
  return out;
}

/** Which renderer a saved diagnostic uses: old reports keep the old one. */
export function rendererFor(version: number | null | undefined): "architect" | "legacy" {
  return version === 2 ? "architect" : "legacy";
}

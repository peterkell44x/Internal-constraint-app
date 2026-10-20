// The Architect chat as a step machine: 8 fixed questions, then 2 Yes / No
// taps. A short reaction follows each answer and the first tap. The whole
// state is saved after every step, so a reload continues at the same step.
//
// Pure module: no prompts, no database. Used by the server and the browser.

export const ANSWER_STEPS = 8;
export const TOTAL_STEPS = 10;
/** The halfway screen comes after the reaction to this answer. */
export const HALFWAY_AFTER = 5;
export const MAX_ANSWER_CHARS = 3000;
/** The reaction after the first tap has this step number. */
export const TAP_REACTION_STEP = 9;

/** How bold a reaction may be: gentle for answers 1 to 3, medium for 4 and 5, direct for 6 to 8 and the tap. */
export type Boldness = "gentle" | "medium" | "direct";

export function boldnessFor(step: number): Boldness {
  return step <= 3 ? "gentle" : step <= 5 ? "medium" : "direct";
}

export interface Reaction {
  /** 1 to 8 for answers, 9 for the first tap. */
  step: number;
  text: string;
  crisis: boolean;
  /** True when the AI call failed twice and the neutral line was shown instead. */
  fallback?: boolean;
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
  taps: boolean[];
  reactions: Reaction[];
  halfwaySeen: boolean;
}

export type Screen =
  | { kind: "question"; step: number }
  | { kind: "reaction"; step: number }
  | { kind: "halfway" }
  | { kind: "tap"; step: number }
  | { kind: "done" };

export function emptyFlow(): Flow {
  return { answers: [], taps: [], reactions: [], halfwaySeen: false };
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
    halfwaySeen: v.halfwaySeen === true,
  };
}

export function reactionFor(f: Flow, step: number): Reaction | undefined {
  return f.reactions.find((r) => r.step === step);
}

/** The steps that should have a reaction by now. */
function reactionSteps(f: Flow): number[] {
  const steps = f.answers.map((_, i) => i + 1);
  if (f.taps.length >= 1) steps.push(TAP_REACTION_STEP);
  return steps;
}

/** What the person should see now. */
export function currentScreen(f: Flow): Screen {
  const missing = reactionSteps(f).find((s) => !reactionFor(f, s));
  if (missing !== undefined) return { kind: "reaction", step: missing };
  if (f.answers.length < ANSWER_STEPS) {
    if (f.answers.length === HALFWAY_AFTER && !f.halfwaySeen) return { kind: "halfway" };
    return { kind: "question", step: f.answers.length + 1 };
  }
  if (f.taps.length < 2) return { kind: "tap", step: ANSWER_STEPS + 1 + f.taps.length };
  return { kind: "done" };
}

/** Completed steps out of 10, as a percentage: about 10% per step. */
export function progressPercent(f: Flow): number {
  return Math.round(((f.answers.length + f.taps.length) / TOTAL_STEPS) * 100);
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

export function tapError(f: Flow, step: number): string | null {
  const screen = currentScreen(f);
  if (screen.kind !== "tap" || screen.step !== step) return "This question was already answered. Please reload.";
  return null;
}

export function withTap(f: Flow, value: boolean): Flow {
  return { ...f, taps: [...f.taps, value] };
}

export function withReaction(f: Flow, r: Reaction): Flow {
  return { ...f, reactions: [...f.reactions.filter((x) => x.step !== r.step), r] };
}

export function withHalfwaySeen(f: Flow): Flow {
  return { ...f, halfwaySeen: true };
}

/** True when any reaction came back with the crisis flag; the report is then written as SENSITIVE. */
export function isSensitive(f: Flow): boolean {
  return f.reactions.some((r) => r.crisis);
}

export type Bubble =
  | { kind: "question"; text: string; hint?: string }
  | { kind: "answer"; text: string }
  | { kind: "reaction"; text: string; crisis: boolean }
  | { kind: "halfway" };

/**
 * The chat as the person sees it: each question, their answer, and the
 * reaction that leads into the next question. The current question (or tap)
 * is last when one is waiting.
 */
export function transcript(f: Flow, questions: string[], tapQuestions: string[], hints: string[] = []): Bubble[] {
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
    if (step === HALFWAY_AFTER && f.halfwaySeen) out.push({ kind: "halfway" });
    if (step === HALFWAY_AFTER && !f.halfwaySeen) return out;
  }
  for (let t = 0; t < 2; t++) {
    if (t >= f.taps.length) {
      if (screen.kind === "tap") out.push({ kind: "question", text: tapQuestions[t] });
      return out;
    }
    out.push({ kind: "question", text: tapQuestions[t] }, { kind: "answer", text: f.taps[t] ? "Yes" : "No" });
    if (t === 0) react(TAP_REACTION_STEP);
  }
  return out;
}

/** Which renderer a saved diagnostic uses: old reports keep the old one. */
export function rendererFor(version: number | null | undefined): "architect" | "legacy" {
  return version === 2 ? "architect" : "legacy";
}

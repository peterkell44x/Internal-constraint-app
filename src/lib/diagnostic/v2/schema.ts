// JSON schemas for the Architect AI calls, and validators for what comes back.
// The schemas go to the model as structured output; the validators check what
// the schema can't (exact counts, empty strings, the reaction's word limit and
// repeated-word call-out).
//
// Pure module.

import type { RepeatedWord } from "./flow.ts";
import { countWords, findNumbers } from "./text.ts";

const str = { type: "string" };

export const REACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reaction", "crisis"],
  properties: { reaction: str, crisis: { type: "boolean" } },
} as const;

export const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hidden_tie", "sections", "old_bullets", "new_bullets"],
  properties: {
    hidden_tie: str,
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "cards"],
        properties: { name: str, cards: { type: "array", items: str } },
      },
    },
    old_bullets: { type: "array", items: str },
    new_bullets: { type: "array", items: str },
  },
} as const;

export const CARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["card"],
  properties: { card: str },
} as const;

export const FACT_CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["flagged"],
  properties: {
    flagged: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "reason"],
        properties: { n: { type: "integer" }, reason: str },
      },
    },
  },
} as const;

export interface ArchitectReport {
  hidden_tie: string;
  sections: { name: string; cards: string[] }[];
  old_bullets: string[];
  new_bullets: string[];
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * A valid report has a hidden tie, 4 sections of 3 non-empty cards, and 3
 * old and 3 new bullets. Section names come from the config, whatever the
 * model wrote, so renaming them there is enough. Null if invalid.
 */
export function parseReport(text: string, sectionNames: readonly string[]): ArchitectReport | null {
  const j = json(text) as Partial<ArchitectReport> | null;
  if (!j || !nonEmpty(j.hidden_tie)) return null;
  if (!Array.isArray(j.sections) || j.sections.length !== 4) return null;
  if (!j.sections.every((s) => Array.isArray(s?.cards) && s.cards.length === 3 && s.cards.every(nonEmpty))) return null;
  for (const b of [j.old_bullets, j.new_bullets]) if (!Array.isArray(b) || b.length !== 3 || !b.every(nonEmpty)) return null;
  return {
    hidden_tie: j.hidden_tie.trim(),
    sections: j.sections.map((s, i) => ({ name: sectionNames[i] ?? s.name, cards: s.cards.map((c) => c.trim()) })),
    old_bullets: j.old_bullets!.map((b) => b.trim()),
    new_bullets: j.new_bullets!.map((b) => b.trim()),
  };
}

export function parseCard(text: string): string | null {
  const j = json(text) as { card?: unknown } | null;
  return j && nonEmpty(j.card) ? j.card.trim() : null;
}

export function parseFactCheck(text: string): { n: number; reason: string }[] | null {
  const j = json(text) as { flagged?: unknown } | null;
  if (!j || !Array.isArray(j.flagged)) return null;
  return j.flagged
    .filter((f): f is { n: number; reason: string } => !!f && Number.isInteger(f.n))
    .map((f) => ({ n: f.n, reason: String(f.reason ?? "") }));
}

export const REACTION_MAX_WORDS = 55;

export function parseReaction(text: string): { reaction: string; crisis: boolean } | null {
  const j = json(text) as { reaction?: unknown; crisis?: unknown } | null;
  if (!j || !nonEmpty(j.reaction) || typeof j.crisis !== "boolean") return null;
  return { reaction: j.reaction.trim(), crisis: j.crisis };
}

const CALL_OUT = /\b(shows? up|showed up|appears?|appeared|comes? up|came up|used|said|wrote|written)\b.*\btimes\b/i;

/** The sentences of a reaction that call out a word's count. */
function callOutSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => CALL_OUT.test(s) && findNumbers(s).length > 0);
}

/**
 * Why a reaction can't be used as written: over the word limit, or a
 * repeated-word call-out ("the word X shows up N times") that doesn't match
 * the REPEATED_WORDS list the code computed.
 */
export function reactionProblems(text: string, repeated: RepeatedWord[]): string[] {
  const problems: string[] = [];
  const n = countWords(text);
  if (n > REACTION_MAX_WORDS) problems.push("over " + REACTION_MAX_WORDS + " words (" + n + ")");
  for (const s of callOutSentences(text)) {
    const lower = s.toLowerCase();
    const counts = findNumbers(s).map((x) => x.value);
    const ok = repeated.some((r) => new RegExp("\\b" + r.word + "\\b").test(lower) && counts.includes(r.count));
    if (!ok) problems.push("calls out a repeated word that the count does not support");
  }
  return problems;
}

/** A reaction made usable without another AI call: unsupported call-outs dropped, cut to the word limit. */
export function salvageReaction(text: string, repeated: RepeatedWord[]): string {
  const bad = new Set(callOutSentences(text).filter((s) => reactionProblems(s, repeated).length > 0));
  const kept: string[] = [];
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    if (bad.has(s)) continue;
    if (countWords([...kept, s].join(" ")) > REACTION_MAX_WORDS) break;
    kept.push(s);
  }
  return kept.join(" ").trim();
}

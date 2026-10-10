// Length pass over a generated report. The first draft reliably runs past the
// report prompt's word limits, and prompt wording alone did not fix that in
// live testing, so when a part is over, the server asks the model which whole
// sentences to delete.
//
// The model never writes report text in this pass. The code numbers the
// draft's sentences, the model replies with numbers to delete, and the code
// rebuilds the report from the remaining sentences, word for word and in their
// original order. So a cut can remove a sentence but can never move, merge,
// or reword one. The denial check (denial.ts) reuses the same numbering and
// deletion, so its cuts are delete-only too.
//
// Pure module (no imports besides types) so the tests can load it directly.

import type { Domain } from "./domains";

export const NARRATIVE_MAX_WORDS = 260;
export const SECTION_MAX_WORDS = 75;
// The constraint gets more room than the counter belief, for the closing words
// that name the person's own stated problem.
export const CONSTRAINT_MAX_WORDS = 100;

export const CONSTRAINT_PREFIX = "Your subconscious internal constraint is:";
export const COUNTER_PREFIX = "The counter belief is:";
const SPLIT = "[SPLIT]";

export interface ReportParts {
  narrative: string;
  constraint: string;
  counterBelief: string;
}

export type PartName = keyof ReportParts;

const PART_ORDER: PartName[] = ["narrative", "constraint", "counterBelief"];
const PART_LABEL: Record<PartName, string> = {
  narrative: "Narrative",
  constraint: "Constraint section",
  counterBelief: "Counter belief section",
};
export const PART_LIMITS: Record<PartName, number> = {
  narrative: NARRATIVE_MAX_WORDS,
  constraint: CONSTRAINT_MAX_WORDS,
  counterBelief: SECTION_MAX_WORDS,
};

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function reportLengths(r: ReportParts) {
  return {
    narrative: countWords(r.narrative),
    constraint: countWords(r.constraint),
    counterBelief: countWords(r.counterBelief),
  };
}

function isPartOver(r: ReportParts, part: PartName): boolean {
  return countWords(r[part]) > PART_LIMITS[part];
}

export function isOverLimits(r: ReportParts): boolean {
  return PART_ORDER.some((p) => isPartOver(r, p));
}

/** True when the text has the three parts, split correctly, with the required openings. */
export function isWellFormed(raw: string): boolean {
  const parts = raw.split(SPLIT).map((p) => p.trim());
  return (
    parts.length === 3 &&
    parts[0].length > 0 &&
    parts[1].startsWith(CONSTRAINT_PREFIX) &&
    parts[2].startsWith(COUNTER_PREFIX)
  );
}

/** Splits a paragraph into sentences without changing any character of them. */
export function splitSentences(paragraph: string): string[] {
  return paragraph
    .trim()
    .split(/(?<=[.!?]["'”’)]?)\s+(?=\S)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The report prompt asks for five narrative paragraphs in a fixed order:
// programming, incident, mechanism, where they stand today, the shift. The
// last two are found by counting from the end, so a draft with an extra
// paragraph still locks the right ones. With fewer than five paragraphs it is
// unclear which one is "today", so none is locked by position; the check loop
// carries locks forward (alsoLocked) so a paragraph locked in the draft stays
// locked after a deletion empties an earlier one.
const MIN_PARAGRAPHS_FOR_TODAY = 5;

export interface Sentence {
  id: number;
  part: PartName;
  paragraph: number;
  text: string;
  /** Sentences the code will never delete. */
  locked: boolean;
}

/** Lowercase words only, so sentence texts compare regardless of punctuation and spacing. */
export function sentenceKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Numbers every sentence of the report, part by part and paragraph by
 * paragraph. `alsoLocked` holds sentenceKey()s of sentences locked in an
 * earlier version of the report, so a protected sentence stays protected
 * wherever it ends up.
 */
export function numberSentences(r: ReportParts, alsoLocked?: Set<string>): Sentence[] {
  const out: Sentence[] = [];
  for (const part of PART_ORDER) {
    const paragraphs = r[part].split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    // "Where they stand today" is the paragraph just before the shift.
    const todayParagraph =
      part === "narrative" && paragraphs.length >= MIN_PARAGRAPHS_FOR_TODAY ? paragraphs.length - 2 : -1;
    // The last narrative paragraph is the one shift. Cutting part of it can
    // leave a setup sentence without its point, so it is kept whole.
    const shiftParagraph = part === "narrative" && paragraphs.length > 1 ? paragraphs.length - 1 : -1;
    paragraphs.forEach((para, pi) => {
      for (const text of splitSentences(para)) {
        const isOpening = part !== "narrative" && out.every((s) => s.part !== part);
        out.push({
          id: out.length + 1,
          part,
          paragraph: pi,
          text,
          // The opening sentence of each final section carries its required
          // first words, the prompt asks for "architecture" when it fits, and
          // "where they stand today" and the shift are required parts. The
          // whole counter belief section is locked so its action step can never
          // be cut; which sentence holds the action can't be told reliably, and
          // it can span two.
          locked:
            isOpening ||
            part === "counterBelief" ||
            pi === todayParagraph ||
            pi === shiftParagraph ||
            /\barchitecture\b/i.test(text) ||
            !!alsoLocked?.has(sentenceKey(text)),
        });
      }
    });
  }
  // The constraint's last sentence carries the words that tie the belief to
  // the person's own stated problem, so it is never deleted either.
  const lastConstraint = out.filter((s) => s.part === "constraint").at(-1);
  if (lastConstraint) lastConstraint.locked = true;
  return out;
}

/**
 * True when a cut went much further than needed: any part that was cut now
 * sits under half its limit. Such a pass is discarded.
 */
export function isOvercut(before: ReportParts, after: ReportParts): boolean {
  return PART_ORDER.some(
    (p) => after[p] !== before[p] && countWords(after[p]) < PART_LIMITS[p] / 2,
  );
}

/** Reads the sentence numbers out of the model's reply. */
export function parseDeletions(reply: string): number[] {
  const m = reply.match(/<delete>([\s\S]*?)<\/delete>/);
  if (!m) return [];
  return [...new Set((m[1].match(/\d+/g) ?? []).map(Number))];
}

/**
 * Rebuilds the report from the kept sentences, in their original order and
 * paragraphs. Requested deletions are ignored when the sentence is locked,
 * when deleting it would empty its part, and (for the length pass, the
 * default) when its part is within its word limit.
 */
export function applyDeletions(
  sentences: Sentence[],
  requested: number[],
  current: ReportParts,
  { onlyOverLimit = true }: { onlyOverLimit?: boolean } = {},
): string {
  const del = new Set(
    requested.filter((id) => {
      const s = sentences.find((x) => x.id === id);
      return s && !s.locked && (!onlyOverLimit || isPartOver(current, s.part));
    }),
  );
  for (const part of PART_ORDER) {
    const inPart = sentences.filter((s) => s.part === part);
    if (inPart.every((s) => del.has(s.id))) inPart.forEach((s) => del.delete(s.id));
  }
  const kept = sentences.filter((s) => !del.has(s.id));
  const rebuilt = PART_ORDER.map((part) => {
    const paragraphs: string[][] = [];
    for (const s of kept.filter((x) => x.part === part)) (paragraphs[s.paragraph] ??= []).push(s.text);
    return paragraphs.filter(Boolean).map((p) => p.join(" ")).join("\n\n");
  });
  return rebuilt.join("\n\n" + SPLIT + "\n\n");
}

export function buildCutSystem(d: Domain): string {
  return "You are shortening a " + d.reportTitle + " profile that is over its word limits. You cannot rewrite anything. The profile has been split into numbered sentences, and the only thing you can do is choose whole sentences to delete. Every sentence you keep stays word for word, in its original order.\n\n"
  + "The narrative must be " + NARRATIVE_MAX_WORDS + " words or fewer, the constraint section " + CONSTRAINT_MAX_WORDS + " words or fewer, and the counter belief section " + SECTION_MAX_WORDS + " words or fewer. Delete as few sentences as possible to bring each part marked OVER under its limit, and only delete from parts marked OVER. Each sentence shows its word count so you can check the totals.\n\n"
  + "Prefer sentences that repeat or restate something said elsewhere, or that add secondary detail. Do not delete a sentence that a kept sentence depends on to make sense, for example one that a later sentence points back to with words like that, this, it, or the same. Do not delete a sentence if that would make a kept sentence next to it read as being about something else. Never delete the verbal programming, the anchoring incident, the core of the mechanism, where they stand today, the closing shift, the constraint's closing words about the person's own stated problem, or the concrete action in the counter belief section. Avoid deleting every sentence of a paragraph. Sentences marked LOCKED cannot be deleted.\n\n"
  + "Use this exact output format. First, inside <notes> and </notes>, write at most ten short lines: the sentences you will delete, each with its word count and the reason it is safe to delete, then the running total, and check that each OVER part ends up under its limit. Then, on its own line, list the sentence numbers to delete, like this: <delete>3, 7, 12</delete>. Write nothing else.";
}

export function buildCutInput(sentences: Sentence[], r: ReportParts): string {
  const lines: string[] = [];
  for (const part of PART_ORDER) {
    const n = countWords(r[part]);
    const limit = PART_LIMITS[part];
    lines.push(
      "",
      PART_LABEL[part].toUpperCase() + ": " + n + " words, limit " + limit +
        (n > limit ? ", OVER, delete at least " + (n - limit) + " words" : ", within limit, do not delete from this part"),
    );
    let lastPara = -1;
    for (const s of sentences.filter((x) => x.part === part)) {
      if (part === "narrative" && s.paragraph !== lastPara) lines.push("(paragraph " + (s.paragraph + 1) + ")");
      lastPara = s.paragraph;
      lines.push("[" + s.id + "] (" + countWords(s.text) + " words" + (s.locked ? ", LOCKED" : "") + ") " + s.text);
    }
  }
  return "NUMBERED PROFILE" + lines.join("\n") + "\n\nReply with the sentences to delete.";
}

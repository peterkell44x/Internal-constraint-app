// Length pass over a generated report. The first draft reliably runs past the
// report prompt's word limits, and prompt wording alone did not fix that in
// live testing, so when a part is over, the server asks the model which whole
// sentences to delete.
//
// The model never writes report text in this pass. The code numbers the
// draft's sentences, the model replies with numbers to delete, and the code
// rebuilds the report from the remaining sentences, word for word and in their
// original order. So a cut can remove a sentence but can never move, merge,
// or reword one. Keeping details accurate is the report prompt's job.
//
// Pure module (no imports besides types) so the tests can load it directly.

import type { Domain } from "./domains";

export const NARRATIVE_MAX_WORDS = 260;
export const SECTION_MAX_WORDS = 75;

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
const PART_LIMIT: Record<PartName, number> = {
  narrative: NARRATIVE_MAX_WORDS,
  constraint: SECTION_MAX_WORDS,
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
  return countWords(r[part]) > PART_LIMIT[part];
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
// programming, incident, mechanism, where they stand today, the shift.
const NARRATIVE_PARAGRAPHS = 5;
const TODAY_PARAGRAPH = 3; // zero-based: the fourth paragraph

export interface Sentence {
  id: number;
  part: PartName;
  paragraph: number;
  text: string;
  /** Sentences the code will never delete. */
  locked: boolean;
}

/** Numbers every sentence of the report, part by part and paragraph by paragraph. */
export function numberSentences(r: ReportParts): Sentence[] {
  const out: Sentence[] = [];
  for (const part of PART_ORDER) {
    const paragraphs = r[part].split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    // Only lock "where they stand today" when the narrative has the expected
    // shape; otherwise its position is unknown and nothing extra is locked.
    const todayParagraph =
      part === "narrative" && paragraphs.length === NARRATIVE_PARAGRAPHS ? TODAY_PARAGRAPH : -1;
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
          // "where they stand today" and the shift are required parts.
          locked: isOpening || pi === todayParagraph || pi === shiftParagraph || /\barchitecture\b/i.test(text),
        });
      }
    });
  }
  return out;
}

/**
 * True when a cut went much further than needed: any part that was cut now
 * sits under half its limit. Such a pass is discarded.
 */
export function isOvercut(before: ReportParts, after: ReportParts): boolean {
  return PART_ORDER.some(
    (p) => after[p] !== before[p] && countWords(after[p]) < PART_LIMIT[p] / 2,
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
 * paragraphs. Requested deletions are ignored when the sentence is locked, its
 * part is within its limit, or deleting it would empty its part.
 */
export function applyDeletions(sentences: Sentence[], requested: number[], current: ReportParts): string {
  const del = new Set(
    requested.filter((id) => {
      const s = sentences.find((x) => x.id === id);
      return s && !s.locked && isPartOver(current, s.part);
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
  + "The narrative must be " + NARRATIVE_MAX_WORDS + " words or fewer and each of the two final sections must be " + SECTION_MAX_WORDS + " words or fewer. Delete as few sentences as possible to bring each part marked OVER under its limit, and only delete from parts marked OVER. Each sentence shows its word count so you can check the totals.\n\n"
  + "Prefer sentences that repeat or restate something said elsewhere, or that add secondary detail. Do not delete a sentence that a kept sentence depends on to make sense, for example one that a later sentence points back to with words like that, this, it, or the same. Do not delete a sentence if that would make a kept sentence next to it read as being about something else. Never delete the verbal programming, the anchoring incident, the core of the mechanism, where they stand today, the closing shift, or the concrete action in the counter belief section. Avoid deleting every sentence of a paragraph. Sentences marked LOCKED cannot be deleted.\n\n"
  + "Use this exact output format. First, inside <notes> and </notes>, write at most ten short lines: the sentences you will delete, each with its word count and the reason it is safe to delete, then the running total, and check that each OVER part ends up under its limit. Then, on its own line, list the sentence numbers to delete, like this: <delete>3, 7, 12</delete>. Write nothing else.";
}

export function buildCutInput(sentences: Sentence[], r: ReportParts): string {
  const lines: string[] = [];
  for (const part of PART_ORDER) {
    const n = countWords(r[part]);
    const limit = PART_LIMIT[part];
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

// Length pass over a generated report. The first draft reliably runs past the
// report prompt's word limits, and prompt wording alone did not fix that in
// live testing, so when a part is over, the server measures it and sends the
// draft back to be cut. This pass only shortens. It does not see the
// conversation, check facts, or soften conclusions; keeping details accurate
// is the report prompt's job.
//
// Pure module (no imports besides types) so the tests can load it directly.

import type { Domain } from "./domains";

export const NARRATIVE_MAX_WORDS = 260;
export const SECTION_MAX_WORDS = 75;
// The reviser is asked to aim below the hard limit so small overshoots still pass.
const NARRATIVE_TARGET_WORDS = 230;
const SECTION_TARGET_WORDS = 65;

export const CONSTRAINT_PREFIX = "Your subconscious internal constraint is:";
export const COUNTER_PREFIX = "The counter belief is:";
const SPLIT = "[SPLIT]";

export interface ReportParts {
  narrative: string;
  constraint: string;
  counterBelief: string;
}

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

export function isOverLimits(r: ReportParts): boolean {
  const l = reportLengths(r);
  return l.narrative > NARRATIVE_MAX_WORDS || l.constraint > SECTION_MAX_WORDS || l.counterBelief > SECTION_MAX_WORDS;
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

/** Pulls the corrected profile out of the reviewer's reply, or null if the block is missing. */
export function extractProfile(reply: string): string | null {
  const m = reply.match(/<profile>([\s\S]*?)<\/profile>/);
  return m ? m[1].trim() : null;
}

export function buildReviewSystem(d: Domain): string {
  return "You are shortening a " + d.reportTitle + " profile that is over its word limits. Your only job is to cut. Do not rewrite it, soften it, hedge it, or change what it says. Keep its voice, its second person address, its paragraph order, its conclusions exactly as confident as they are, and its wording wherever you are not cutting.\n\n"
  + "Never use any dash character in anything you write, not a hyphen used as a pause, not two hyphens together, not an em dash or en dash. Use a period or a comma instead.\n\n"
  + "The narrative must be " + NARRATIVE_MAX_WORDS + " words or fewer and each of the two final sections must be " + SECTION_MAX_WORDS + " words or fewer. These are hard limits. You will be told the current word counts. When a part is over, aim for about " + NARRATIVE_TARGET_WORDS + " words for the narrative and about " + SECTION_TARGET_WORDS + " for a final section, and leave parts that are within their limit unchanged. Cut repetition, restatement, and secondary detail first. Never cut the verbal programming, the anchoring incident, the mechanism with its evidence, where they stand today, or the one shift, and never cut the concrete action in the counter belief section. Never add a word, detail, number, or idea that is not already in the draft.\n\n"
  + "Keep the exact structure. The narrative stays as plain paragraphs with no headers, labels, asterisks, or bullets. Then the marker [SPLIT] on its own line, then the section that starts with the exact words " + CONSTRAINT_PREFIX + " and then the marker [SPLIT] on its own line, then the section that starts with the exact words " + COUNTER_PREFIX + " If the draft uses the word architecture, keep it. Do not add a closing line, a note about your edits, or a question.\n\n"
  + "Use this exact output format. First, inside <issues> and </issues>, list what you will cut, one short line each. Then, inside <profile> and </profile>, write the full shortened profile, starting with its first word and ending with the last word of the counter belief section. Write nothing outside those two blocks.";
}

/**
 * When the narrative is over its limit, gives each paragraph a word budget in
 * proportion to its current length. The model cuts far more reliably to
 * "this paragraph, 60 words" than to a total.
 */
export function paragraphBudgets(narrative: string): string {
  const paras = narrative.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const total = countWords(narrative);
  if (total <= NARRATIVE_MAX_WORDS) return "";
  const lines = paras.map((p, i) => {
    const n = countWords(p);
    const target = Math.max(15, Math.floor((n / total) * NARRATIVE_TARGET_WORDS));
    return "Paragraph " + (i + 1) + ": " + n + " words now, cut to " + target + " or fewer.";
  });
  return "\nNARRATIVE PARAGRAPH BUDGETS\n" + lines.join("\n") + "\n";
}

export function buildReviewInput(draft: string, r: ReportParts): string {
  const l = reportLengths(r);
  const status = (n: number, max: number, target: number) =>
    n + " words, limit " + max + (n > max ? ", OVER, cut to about " + target : ", within limit");
  return "DRAFT PROFILE\n\n" + draft
    + "\n\nCURRENT WORD COUNTS\n"
    + "Narrative: " + status(l.narrative, NARRATIVE_MAX_WORDS, NARRATIVE_TARGET_WORDS) + "\n"
    + "Constraint section: " + status(l.constraint, SECTION_MAX_WORDS, SECTION_TARGET_WORDS) + "\n"
    + "Counter belief section: " + status(l.counterBelief, SECTION_MAX_WORDS, SECTION_TARGET_WORDS) + "\n"
    + paragraphBudgets(r.narrative)
    + "\nReturn the shortened profile.";
}

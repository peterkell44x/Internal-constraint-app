// Second pass over a generated report. The first draft reliably breaks the
// report prompt's word limits and sometimes adds details the person never
// gave or states unconfirmed interpretations as fact. Prompt wording alone did
// not fix that in live testing, so the server measures the draft and sends it
// back with the conversation for a corrective edit.
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

/** The conversation as plain text, without the hidden "Begin the diagnostic." opener. */
export function formatTranscript(history: { role: "user" | "assistant"; content: string }[], opener: string): string {
  return history
    .filter((m, i) => !(i === 0 && m.role === "user" && m.content === opener))
    .map((m) => (m.role === "user" ? "PERSON: " : "GUIDE: ") + m.content)
    .join("\n\n");
}

export function buildReviewSystem(d: Domain): string {
  return "You are the final editor of a " + d.reportTitle + " profile that was written from a diagnostic conversation. You will receive the conversation and the draft profile. Your job is to correct the draft, not to rewrite it. Keep its voice, its second person address, its paragraph order, and its insight. Change only what the rules below require.\n\n"
  + "Never use any dash character in anything you write, not a hyphen used as a pause, not two hyphens together, not an em dash or en dash. Use a period or a comma instead.\n\n"
  + "Rule one, facts. Go through the draft sentence by sentence and check every detail against what the PERSON actually wrote in the conversation. Only the person's own messages count as facts. Something the GUIDE said does not count unless the person confirmed it in their own words. Remove or correct any detail that is not there, including years, dates, ages, numbers, names, places, jobs, relationship status, who ended a relationship, timing words such as last month or recently, arithmetic on their numbers, invented scenes or actions, and feelings or motives given to anyone. Anything in quotation marks must be word for word what the person wrote, otherwise remove the quotation marks. If the person said they did not know something, the draft must not answer it. Do not introduce any new detail, comparison, or calculation of your own while editing.\n\n"
  + "Rule two, interpretations. A statement about what something means, why someone did something, or what anyone felt, wanted, or intended is an interpretation. If the person confirmed it in their own words, it can stay direct. If they did not, rewrite it as the profile's read, using language like it looks like, this suggests, or the pattern here seems to be. This applies to what the draft says about other people in their life too.\n\n"
  + "Rule three, length. The narrative must be " + NARRATIVE_MAX_WORDS + " words or fewer and each of the two final sections must be " + SECTION_MAX_WORDS + " words or fewer. These are hard limits. You will be told the current word counts. When a part is over, aim for about " + NARRATIVE_TARGET_WORDS + " words for the narrative and about " + SECTION_TARGET_WORDS + " for a final section. Cut repetition, restatement, and secondary detail first. Never cut the verbal programming, the anchoring incident, the mechanism with its evidence, where they stand today, or the one shift, and never cut the concrete action in the counter belief section.\n\n"
  + "Keep the exact structure. The narrative stays as plain paragraphs with no headers, labels, asterisks, or bullets. Then the marker [SPLIT] on its own line, then the section that starts with the exact words " + CONSTRAINT_PREFIX + " and then the marker [SPLIT] on its own line, then the section that starts with the exact words " + COUNTER_PREFIX + " If the draft uses the word architecture, keep it, once, where it fits. Do not add anything new that is not in the draft or the conversation. Do not add a closing line, a note about your edits, or a question.\n\n"
  + "Work in two steps and use this exact output format. First, inside <issues> and </issues>, list every problem you find, one short line each: the detail or sentence, and whether it is not in the conversation, an unconfirmed interpretation, or a length problem. Then, inside <profile> and </profile>, write the full corrected profile, starting with its first word and ending with the last word of the counter belief section. Fix every issue you listed. Write nothing outside those two blocks.";
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

export function buildReviewInput(transcript: string, draft: string, r: ReportParts): string {
  const l = reportLengths(r);
  const status = (n: number, max: number, target: number) =>
    n + " words, limit " + max + (n > max ? ", OVER, cut to about " + target : ", within limit");
  return "CONVERSATION\n\n" + transcript
    + "\n\nDRAFT PROFILE\n\n" + draft
    + "\n\nCURRENT WORD COUNTS\n"
    + "Narrative: " + status(l.narrative, NARRATIVE_MAX_WORDS, NARRATIVE_TARGET_WORDS) + "\n"
    + "Constraint section: " + status(l.constraint, SECTION_MAX_WORDS, SECTION_TARGET_WORDS) + "\n"
    + "Counter belief section: " + status(l.counterBelief, SECTION_MAX_WORDS, SECTION_TARGET_WORDS) + "\n"
    + paragraphBudgets(r.narrative)
    + "\nReturn the corrected profile.";
}

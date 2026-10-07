// Two fixes that run after the delete-only denial check:
//
// 1. Reference repair. Deleting a sentence can leave a later one pointing at
//    something only the deleted sentence introduced ("your parents' belief"
//    with the belief itself cut). A call lists such sentences with a minimal
//    replacement, and the code swaps only those exact sentences.
//
// 2. Targeted section rewrite. The constraint, the counter belief, and the
//    final narrative paragraph are protected from deletion, so a violation in
//    them can't be removed. If the check still flags one of them, that section
//    alone is rewritten once from the confirmed and rejected lists. The code
//    rejects a rewrite that breaks the word limit, loses its required opening,
//    or uses an absolute the person never used.
//
// Pure module (no imports besides types) so the tests can load it directly.

import type { Audit, Violation } from "./denial";
import type { ReportParts, Sentence } from "./review";

export const NARRATIVE_MAX = 260;
export const SECTION_MAX = 75;
const CONSTRAINT_PREFIX = "Your subconscious internal constraint is:";
const COUNTER_PREFIX = "The counter belief is:";

export type SectionName = "constraint" | "counterBelief" | "shift";

/** Lowercase words only, so quotes match regardless of punctuation and spacing. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function paragraphsOf(narrative: string): string[] {
  return narrative.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Which of the rewritable sections a sentence belongs to, or null. The shift
 * is the final narrative paragraph.
 */
export function sectionOf(s: Sentence, sentences: Sentence[]): SectionName | null {
  if (s.part === "constraint") return "constraint";
  if (s.part === "counterBelief") return "counterBelief";
  const lastPara = Math.max(...sentences.filter((x) => x.part === "narrative").map((x) => x.paragraph));
  return s.part === "narrative" && s.paragraph === lastPara && lastPara > 0 ? "shift" : null;
}

/** The current text of a section. */
export function sectionText(parts: ReportParts, section: SectionName): string {
  if (section === "constraint") return parts.constraint;
  if (section === "counterBelief") return parts.counterBelief;
  return paragraphsOf(parts.narrative).at(-1) ?? "";
}

/** The word limit for a rewritten section; the shift shares the narrative's limit. */
export function sectionLimit(parts: ReportParts, section: SectionName): number {
  if (section !== "shift") return SECTION_MAX;
  const rest = countWords(parts.narrative) - countWords(sectionText(parts, "shift"));
  return Math.max(15, NARRATIVE_MAX - rest);
}

/** Returns the report with one section's text replaced. */
export function replaceSection(parts: ReportParts, section: SectionName, text: string): ReportParts {
  if (section === "constraint") return { ...parts, constraint: text.trim() };
  if (section === "counterBelief") return { ...parts, counterBelief: text.trim() };
  const paras = paragraphsOf(parts.narrative);
  paras[paras.length - 1] = text.trim();
  return { ...parts, narrative: paras.join("\n\n") };
}

export function joinReport(p: ReportParts): string {
  return [p.narrative, p.constraint, p.counterBelief].join("\n\n[SPLIT]\n\n");
}

const ABSOLUTES = ["only", "always", "never"];

/**
 * Problems that make a rewritten section unusable: a missing required
 * opening, going over its word limit, or an absolute (only, always, never)
 * the person never used in the conversation.
 */
export function rewriteIssues(section: SectionName, text: string, limit: number, personWords: string): string[] {
  const issues: string[] = [];
  const t = text.trim();
  if (!t) issues.push("empty");
  if (section === "constraint" && !t.startsWith(CONSTRAINT_PREFIX)) issues.push("missing the required opening words");
  if (section === "counterBelief" && !t.startsWith(COUNTER_PREFIX)) issues.push("missing the required opening words");
  const n = countWords(t);
  if (n > limit) issues.push("over the word limit (" + n + " of " + limit + ")");
  const said = new Set(normalize(personWords).split(" "));
  for (const w of ABSOLUTES) {
    if (new RegExp("\\b" + w + "\\b", "i").test(t) && !said.has(w)) issues.push('uses "' + w + '", which the person never said');
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Targeted section rewrite

const str = { type: "string" };

export const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sections"],
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "text"],
        properties: {
          section: { type: "string", enum: ["constraint", "counterBelief", "shift"] },
          text: str,
        },
      },
    },
  },
} as const;

export function buildRewriteSystem(reportTitle: string, goalPhrase: string): string {
  return "You are rewriting only the flagged sections of a " + reportTitle + " profile. A fact check flagged them because they state things the person rejected or never confirmed. You receive the conversation between a GUIDE and the PERSON, what the person confirmed, what the person rejected, the whole current profile for context, and for each section to rewrite its current text, the flagged sentences, and its word limit. Nothing you write besides the new section text is shown to the person.\n\n"
  + "Rules for every section you rewrite:\n"
  + "Build it only from items on the confirmed list and things the person stated, using the person's own words wherever possible.\n"
  + "Nothing from the rejected list may appear, in any wording.\n"
  + "Do not use only, always, never, or any similar absolute unless the person used that word themselves.\n"
  + "Do not add a cause, consequence, or detail the person did not state.\n"
  + "Stay at or under the section's word limit.\n"
  + "Never use any dash character, not a hyphen used as a pause, not two hyphens together, not an em dash or en dash. Use a period or a comma.\n"
  + "Write in second person, plain and direct, matching the voice of the rest of the profile.\n\n"
  + "constraint: start with the exact words " + CONSTRAINT_PREFIX + " then name the belief inside what the person confirmed, and how it stands between them and " + goalPhrase + ", only as far as what they said supports.\n"
  + "counterBelief: start with the exact words " + COUNTER_PREFIX + " then answer that same belief in first person, then give one action they can do and check off this week that tests the belief and produces something tangible they can point to afterward, such as a record, a number, or a message sent, not only writing down thoughts.\n"
  + "shift: the closing paragraph of the narrative. State the one shift that would change things, in plain words, using only what was confirmed.\n\n"
  + "Rewrite only the sections listed, and return each with its new text.";
}

function formatList(items: { text: string; quote: string }[]): string {
  return items.length ? items.map((i) => "- " + i.text + ' (person: "' + i.quote + '")').join("\n") : "(none)";
}

export function buildRewriteInput(
  transcript: string,
  audit: Audit,
  report: string,
  targets: { section: SectionName; current: string; flagged: Violation[]; limit: number }[],
): string {
  const confirmed = formatList(audit.confirmed.map((c) => ({ text: c.link, quote: c.quote })));
  const rejected = formatList(audit.rejected.map((r) => ({ text: r.interpretation, quote: r.quote })));
  const sections = targets
    .map(
      (t) =>
        "SECTION " + t.section + " (word limit " + t.limit + ")\nCurrent text: " + t.current + "\nFlagged:\n" +
        t.flagged.map((v) => '- "' + v.quote + '" (' + v.reason + ")").join("\n"),
    )
    .join("\n\n");
  return "CONVERSATION\n\n" + transcript + "\n\nCONFIRMED BY THE PERSON\n" + confirmed + "\n\nREJECTED BY THE PERSON\n" + rejected
    + "\n\nCURRENT PROFILE\n\n" + report + "\n\nSECTIONS TO REWRITE\n\n" + sections;
}

export function parseRewrite(text: string): { section: SectionName; text: string }[] | null {
  try {
    const j = JSON.parse(text);
    return Array.isArray(j?.sections) ? j.sections : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reference repair after deletions

export const REPAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["repairs"],
  properties: {
    repairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["original", "replacement"],
        properties: { original: str, replacement: str },
      },
    },
  },
} as const;

export function buildRepairSystem(): string {
  return "Some sentences were deleted from a written profile because they were inaccurate or too long. Your job is to find remaining sentences that no longer make sense on their own because they refer to something that was only introduced in a deleted sentence, for example a pronoun, that belief, this pattern, the same move, or a person or idea that is now never introduced.\n\n"
  + "For each such sentence, give the sentence exactly as it appears in the profile, and a minimal replacement that makes it understandable on its own. Change as few words as possible. Use only facts the person stated in the conversation. Do not bring back any claim from the deleted sentences. Keep any required opening words, such as Your subconscious internal constraint is: or The counter belief is:. Never use any dash character.\n\n"
  + "Do not list sentences that already make sense. If there are none, return an empty list.";
}

export function buildRepairInput(transcript: string, deleted: string[], report: string): string {
  return "CONVERSATION\n\n" + transcript + "\n\nDELETED SENTENCES\n" + deleted.map((d) => "- " + d).join("\n")
    + "\n\nCURRENT PROFILE\n\n" + report;
}

export function parseRepairs(text: string): { original: string; replacement: string }[] | null {
  try {
    const j = JSON.parse(text);
    return Array.isArray(j?.repairs) ? j.repairs : null;
  } catch {
    return null;
  }
}

export interface RepairOutcome {
  report: ReportParts;
  applied: { original: string; replacement: string }[];
  skipped: { original: string; replacement: string; reason: string }[];
}

/**
 * Swaps each repaired sentence for its replacement, matching the original to
 * a current sentence exactly (ignoring punctuation and case). Skips a repair
 * whose sentence can't be found, that drops a required opening, or that adds
 * far more than it changes.
 */
export function applyRepairs(
  parts: ReportParts,
  sentences: Sentence[],
  repairs: { original: string; replacement: string }[],
): RepairOutcome {
  let report = { ...parts };
  const applied: RepairOutcome["applied"] = [];
  const skipped: RepairOutcome["skipped"] = [];
  for (const r of repairs) {
    const target = sentences.find((s) => normalize(s.text) === normalize(r.original));
    const replacement = r.replacement.trim();
    let reason = "";
    if (!target) reason = "sentence not found";
    else if (!replacement) reason = "empty replacement";
    else if (target.text.startsWith(CONSTRAINT_PREFIX) && !replacement.startsWith(CONSTRAINT_PREFIX)) reason = "dropped the required opening";
    else if (target.text.startsWith(COUNTER_PREFIX) && !replacement.startsWith(COUNTER_PREFIX)) reason = "dropped the required opening";
    else if (countWords(replacement) > countWords(target.text) + 15) reason = "replacement adds too much";
    if (reason || !target) {
      skipped.push({ ...r, reason });
      continue;
    }
    report = { ...report, [target.part]: report[target.part].replace(target.text, replacement) };
    applied.push({ original: target.text, replacement });
  }
  return { report, applied, skipped };
}

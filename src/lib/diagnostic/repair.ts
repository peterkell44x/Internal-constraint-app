// Two fixes that run after the delete-only denial check:
//
// 1. Reference repair. Deleting a sentence can leave a later one pointing at
//    something only the deleted sentence introduced ("your parents' belief"
//    with the belief itself cut). A call lists such sentences with a minimal
//    replacement, and the code swaps only those exact sentences, refusing any
//    replacement that brings back wording from a deleted sentence or from
//    something the person rejected.
//
// 2. Targeted section rewrite. Protected sentences (section openings, the
//    counter belief, the architecture sentence, the "where they stand today"
//    and final paragraphs) can't be deleted, so a violation in one is fixed by
//    rewriting just the section or paragraph that holds it, from the confirmed
//    and rejected lists. The code rejects a rewrite that breaks the word limit,
//    loses its required opening or the word architecture, uses an absolute
//    the person never used, or repeats another paragraph.
//
// It also holds three checks done by code rather than by the model: absolutes
// (only, always, never, impossible...) in the constraint and counter belief
// that the person never used, narrative sentences that repeat a run of words
// from an earlier paragraph, and whether the constraint's last sentence names
// the person's own stated problem.
//
// Pure module (no imports besides types) so the tests can load it directly.

import type { Audit, Violation } from "./denial";
import type { ReportParts, Sentence } from "./review";

export const NARRATIVE_MAX = 260;
export const SECTION_MAX = 75;
export const CONSTRAINT_MAX = 100;
const CONSTRAINT_PREFIX = "Your subconscious internal constraint is:";
const COUNTER_PREFIX = "The counter belief is:";

const STOPWORDS_LIST = (
  "a an and are as at be been but by do does for from had has have he her his i if in into is it its just me my not " +
  "of on or our she so than that the their them then there they this to too was we were what when which who will " +
  "with you your yours youre"
).split(" ");

/** A rewritable section: a final section, or a narrative paragraph (1-based). */
export type SectionName = "constraint" | "counterBelief" | `paragraph${number}`;

function paragraphIndex(section: SectionName): number {
  return Number(section.slice("paragraph".length)) - 1;
}

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

/** The section a sentence belongs to: a final section, or its narrative paragraph. */
export function sectionOf(s: Sentence): SectionName {
  if (s.part === "constraint") return "constraint";
  if (s.part === "counterBelief") return "counterBelief";
  return `paragraph${s.paragraph + 1}`;
}

/** The current text of a section. */
export function sectionText(parts: ReportParts, section: SectionName): string {
  if (section === "constraint") return parts.constraint;
  if (section === "counterBelief") return parts.counterBelief;
  return paragraphsOf(parts.narrative)[paragraphIndex(section)] ?? "";
}

/** The word limit for a rewritten section; a paragraph shares the narrative's limit. */
export function sectionLimit(parts: ReportParts, section: SectionName): number {
  if (section === "constraint") return CONSTRAINT_MAX;
  if (section === "counterBelief") return SECTION_MAX;
  const rest = countWords(parts.narrative) - countWords(sectionText(parts, section));
  return Math.max(15, NARRATIVE_MAX - rest);
}

/** Returns the report with one section's text replaced. */
export function replaceSection(parts: ReportParts, section: SectionName, text: string): ReportParts {
  if (section === "constraint") return { ...parts, constraint: text.trim() };
  if (section === "counterBelief") return { ...parts, counterBelief: text.trim() };
  const paras = paragraphsOf(parts.narrative);
  const i = paragraphIndex(section);
  if (i < 0 || i >= paras.length) return parts;
  paras[i] = text.trim();
  return { ...parts, narrative: paras.join("\n\n") };
}

/** A readable name for a section, for the debug view. */
export function sectionLabel(section: SectionName, paragraphCount?: number): string {
  if (section === "constraint") return "Constraint";
  if (section === "counterBelief") return "Counter belief";
  const n = paragraphIndex(section) + 1;
  return "Narrative paragraph " + n + (paragraphCount && n === paragraphCount ? " (final)" : "");
}

export function joinReport(p: ReportParts): string {
  return [p.narrative, p.constraint, p.counterBelief].join("\n\n[SPLIT]\n\n");
}

// Absolute words the profile may use only if the person used them. Forms in
// one entry count as the same word: if the person said permanent, the profile
// may say permanently.
const ABSOLUTES: { label: string; forms: string[] }[] = [
  { label: "only", forms: ["only"] },
  { label: "always", forms: ["always"] },
  { label: "never", forms: ["never"] },
  { label: "impossible", forms: ["impossible"] },
  { label: "unsafe", forms: ["unsafe"] },
  { label: "permanent", forms: ["permanent", "permanently"] },
  { label: "forever", forms: ["forever"] },
  { label: "every time", forms: ["every time", "everytime"] },
];

/** The absolutes in a text that the person never used, by label. */
export function absolutesNotSaid(text: string, personWords: string): string[] {
  const t = " " + normalize(text) + " ";
  const said = " " + normalize(personWords) + " ";
  return ABSOLUTES.filter(
    (a) => a.forms.some((f) => t.includes(" " + f + " ")) && !a.forms.some((f) => said.includes(" " + f + " ")),
  ).map((a) => a.label);
}

/**
 * Code check of the constraint and counter belief: one violation per sentence
 * that uses an absolute the person never used.
 */
export function findAbsoluteViolations(sentences: Sentence[], personWords: string): Violation[] {
  const out: Violation[] = [];
  for (const s of sentences) {
    if (s.part !== "constraint" && s.part !== "counterBelief") continue;
    const found = absolutesNotSaid(s.text, personWords);
    if (found.length > 0) {
      out.push({ quote: s.text, kind: "absolute", reason: "uses " + found.map((w) => '"' + w + '"').join(", ") + ", which the person never said" });
    }
  }
  return out;
}

// A sentence repeats another when they share this many words in a row, at
// least DUPLICATE_MIN_CONTENT of them meaningful (not words like the, it, and).
const DUPLICATE_RUN = 6;
const DUPLICATE_MIN_CONTENT = 3;

/** The longest run of words two texts share, if it is long enough to count as a repeat; else null. */
export function sharedRun(a: string, b: string): string | null {
  const aw = normalize(a).split(" ").filter(Boolean);
  const bw = normalize(b).split(" ").filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i + DUPLICATE_RUN <= aw.length; i++) grams.add(aw.slice(i, i + DUPLICATE_RUN).join(" "));
  let best: string[] | null = null;
  for (let j = 0; j + DUPLICATE_RUN <= bw.length; j++) {
    if (!grams.has(bw.slice(j, j + DUPLICATE_RUN).join(" "))) continue;
    // Extend the match as far as both texts keep agreeing.
    let end = j + DUPLICATE_RUN;
    while (end < bw.length && grams.has(bw.slice(end - DUPLICATE_RUN + 1, end + 1).join(" "))) end++;
    const run = bw.slice(j, end);
    if (run.filter((w) => !STOPWORDS.has(w)).length < DUPLICATE_MIN_CONTENT) continue;
    if (!best || run.length > best.length) best = run;
  }
  return best ? best.join(" ") : null;
}

/**
 * Code check of the narrative: each sentence that repeats a run of words from
 * a sentence in an earlier paragraph. The first one stays; the later one is
 * flagged, to be deleted, or rewritten if it is protected.
 */
export function findDuplicateViolations(sentences: Sentence[]): Violation[] {
  const narrative = sentences.filter((s) => s.part === "narrative");
  const out: Violation[] = [];
  for (const later of narrative) {
    for (const earlier of narrative) {
      if (earlier.paragraph >= later.paragraph) continue;
      const run = sharedRun(earlier.text, later.text);
      if (run) {
        out.push({ quote: later.text, kind: "duplicate", reason: 'repeats "' + run + '" from paragraph ' + (earlier.paragraph + 1) });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The person's stated problem

export const PROBLEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["problem"],
  properties: { problem: { type: "string" } },
} as const;

export function buildProblemSystem(): string {
  return "You read a diagnostic conversation between a GUIDE and a PERSON. Early on, the guide asks what specific problem or frustration made the person come here. Find the person's answer to that question; if the guide never asked it, use the person's first answer. Return their stated problem as one short phrase of 4 to 12 words, in their own words as closely as possible, such as not having girls to banter with and have sex with, or never saving anything at the end of the month. Do not add a cause, an interpretation, or anything they did not say. Never use any dash character.";
}

export function parseProblem(text: string): string | null {
  try {
    const p = JSON.parse(text)?.problem;
    return typeof p === "string" && p.trim() ? p.trim() : null;
  } catch {
    return null;
  }
}

// Words too common to show that a sentence is about the person's problem.
const FILLER = new Set([
  ...STOPWORDS_LIST,
  ..."about all also am any because being can cant could did didnt dont doesnt even feel feels felt get gets getting got how im ive just keep keeps kept know like make makes made more much really should something still thing things think want wants wanted wanting way why would t s".split(" "),
]);

/** A rough stem so girl and girls, or saving and save, count as the same word. */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function contentStems(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((w) => w && !FILLER.has(w)).map(stem));
}

/** The meaningful words a sentence shares with the stated problem. */
export function problemWordsShared(sentence: string, statedProblem: string): string[] {
  const p = contentStems(statedProblem);
  return [...contentStems(sentence)].filter((w) => p.has(w));
}

/** True when a sentence shares at least two meaningful words with the stated problem. */
export function tiesToProblem(sentence: string, statedProblem: string): boolean {
  return problemWordsShared(sentence, statedProblem).length >= 2;
}

/** The last sentence of a text (same splitting rule as review.ts splitSentences). */
export function lastSentence(text: string): string {
  return text.trim().split(/(?<=[.!?]["'”’)]?)\s+(?=\S)/).map((x) => x.trim()).filter(Boolean).at(-1) ?? "";
}

/**
 * Code check of the constraint: a violation when its last sentence does not
 * name the person's stated problem.
 */
export function findProblemViolations(parts: ReportParts, statedProblem: string | null): Violation[] {
  if (!statedProblem || !parts.constraint.trim()) return [];
  const last = lastSentence(parts.constraint);
  if (tiesToProblem(last, statedProblem)) return [];
  return [{
    quote: last,
    kind: "stated_problem",
    reason: 'the constraint does not end by naming their stated problem ("' + statedProblem + '")',
  }];
}

/**
 * Problems that make a rewritten section unusable: a missing required
 * opening, going over its word limit, dropping the word architecture when the
 * original had it, an absolute (only, always, never, impossible...) the person
 * never used, or for a paragraph, repeating a run of words from another one.
 */
export function rewriteIssues(
  section: SectionName,
  text: string,
  limit: number,
  personWords: string,
  original = "",
  otherParagraphs: string[] = [],
  statedProblem = "",
): string[] {
  const issues: string[] = [];
  const t = text.trim();
  if (/\barchitecture\b/i.test(original) && !/\barchitecture\b/i.test(t)) issues.push("dropped the word architecture");
  if (!t) issues.push("empty");
  if (section === "constraint" && !t.startsWith(CONSTRAINT_PREFIX)) issues.push("missing the required opening words");
  if (section === "counterBelief" && !t.startsWith(COUNTER_PREFIX)) issues.push("missing the required opening words");
  const n = countWords(t);
  if (n > limit) issues.push("over the word limit (" + n + " of " + limit + ")");
  for (const w of absolutesNotSaid(t, personWords)) issues.push('uses "' + w + '", which the person never said');
  if (section === "constraint" && statedProblem && t && !tiesToProblem(lastSentence(t), statedProblem)) {
    issues.push("last sentence does not name their stated problem");
  }
  if (section.startsWith("paragraph")) {
    for (const other of otherParagraphs) {
      const run = sharedRun(other, t);
      if (run) {
        issues.push('repeats "' + run + '" from another paragraph');
        break;
      }
    }
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
          section: str,
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
  + "Nothing from the rejected list may appear, in any wording, and nothing from the unsure list may be stated as fact.\n"
  + "Do not use only, always, never, impossible, unsafe, permanent, permanently, forever, every time, or any similar absolute unless the person used that word themselves.\n"
  + "Do not repeat a sentence or a run of words that already appears in another part of the profile.\n"
  + "Do not add a cause, consequence, or detail the person did not state.\n"
  + "Stay at or under the section's word limit.\n"
  + "Never use any dash character, not a hyphen used as a pause, not two hyphens together, not an em dash or en dash. Use a period or a comma.\n"
  + "Write in second person, plain and direct, matching the voice of the rest of the profile.\n"
  + "Every sentence must read as normal prose that someone would actually say. Do not stitch fragments of the person's answers together or string quoted phrases into a list, and make sure every it, that, or this clearly points to something named in the same or the previous sentence.\n\n"
  + "constraint: start with the exact words " + CONSTRAINT_PREFIX + " then name the belief inside what the person confirmed, and how it stands between them and " + goalPhrase + ", only as far as what they said supports. End the section with a sentence saying that this belief is what keeps their stated problem going, using the words given under THEIR STATED PROBLEM. That last sentence must name the problem itself, not refer to it as it or that. If the current text already ends this way, keep that ending. To stay inside the word limit, trim elsewhere in the section, never these closing words. This is a statement about the belief, never a promise of a result.\n"
  + "counterBelief: start with the exact words " + COUNTER_PREFIX + " then answer that same belief in first person, then give one action they can do and check off this week that tests the belief and produces something tangible they can point to afterward, such as a record, a number, or a message sent, not only writing down thoughts. Say which part of their stated problem the action tests. Never promise that the action or the new belief will bring a result such as peace, money, or a relationship.\n"
  + "paragraph sections (paragraph1, paragraph2 and so on): one paragraph of the narrative. Keep its role in the profile, for example the closing shift or where they stand today, state it in plain words using only what was confirmed, and if its current text uses the word architecture, keep that word once.\n\n"
  + "Rewrite only the sections listed, return each with its new text, and use the section names exactly as given.";
}

function formatList(items: { text: string; quote: string }[]): string {
  return items.length ? items.map((i) => "- " + i.text + ' (person: "' + i.quote + '")').join("\n") : "(none)";
}

export function buildRewriteInput(
  transcript: string,
  audit: Audit,
  report: string,
  targets: { section: SectionName; current: string; flagged: Violation[]; limit: number }[],
  statedProblem: string | null = null,
): string {
  const unsure = formatList((audit.uncertain ?? []).map((u) => ({ text: u.interpretation, quote: u.quote })));
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
    + "\n\nUNSURE, MUST NOT BE STATED AS FACT\n" + unsure
    + (statedProblem ? "\n\nTHEIR STATED PROBLEM\n" + statedProblem : "")
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
  + "Also, for each paragraph listed as having lost its last sentence, check that what remains still makes its point. If it now ends on a setup with no point, give a repair of its new last sentence that completes the point using only what the person said or confirmed.\n\n"
  + "For each sentence to fix, give exactly one sentence, copied exactly as it appears in the current profile, never a block of several sentences; if two sentences need fixing, give two repairs. Then give a minimal replacement that makes it understandable on its own. Change as few words as possible. Use only facts the person stated in the conversation. Do not bring back any claim from the deleted sentences or anything on the rejected list, in any wording; if the sentence can only make sense by bringing one back, give the shortest neutral replacement instead, such as naming the person or thing in plain words. Keep any required opening words, such as Your subconscious internal constraint is: or The counter belief is:. Never use any dash character.\n\n"
  + "Do not list sentences that already make sense. If there are none, return an empty list.";
}

export function buildRepairInput(
  transcript: string,
  deleted: string[],
  rejected: string[],
  report: string,
  lostEnding: string[] = [],
): string {
  return "CONVERSATION\n\n" + transcript + "\n\nDELETED SENTENCES\n" + deleted.map((d) => "- " + d).join("\n")
    + "\n\nREJECTED BY THE PERSON\n" + (rejected.length ? rejected.map((r) => "- " + r).join("\n") : "(none)")
    + "\n\nPARAGRAPHS THAT LOST THEIR LAST SENTENCE\n" + (lostEnding.length ? lostEnding.map((p) => "- " + p).join("\n") : "(none)")
    + "\n\nCURRENT PROFILE\n\n" + report;
}

/** Repairs whose original spans several sentences; they are split or retried. */
export const RETRY_ONE_SENTENCE =
  "\n\nIn your previous reply, some originals were blocks of several sentences, which cannot be matched. Give each repair as exactly one sentence copied from the current profile.";

/**
 * Turns a repair whose original is a block of several sentences into one
 * repair per sentence that changed, when the replacement has the same number
 * of sentences. Returns the repairs that could not be split that way.
 */
export function splitRepairs(
  repairs: { original: string; replacement: string }[],
  split: (text: string) => string[],
): { repairs: { original: string; replacement: string }[]; unsplit: { original: string; replacement: string }[] } {
  const out: { original: string; replacement: string }[] = [];
  const unsplit: { original: string; replacement: string }[] = [];
  for (const r of repairs) {
    const orig = split(r.original);
    if (orig.length <= 1) {
      out.push(r);
      continue;
    }
    const repl = split(r.replacement);
    if (repl.length !== orig.length) {
      unsplit.push(r);
      continue;
    }
    orig.forEach((o, i) => {
      if (normalize(o) !== normalize(repl[i])) out.push({ original: o, replacement: repl[i] });
    });
  }
  return { repairs: out, unsplit };
}

const STOPWORDS = new Set(STOPWORDS_LIST);

/** Three-word phrases with at least two meaningful words. */
function phrases(text: string): Set<string> {
  const w = normalize(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) {
    const tri = w.slice(i, i + 3);
    if (tri.filter((x) => !STOPWORDS.has(x)).length >= 2) out.add(tri.join(" "));
  }
  return out;
}

/**
 * The first phrase a replacement adds (one not in the original sentence) that
 * also appears in forbidden text, such as a deleted sentence or something the
 * person rejected. Null when it adds nothing forbidden.
 */
export function reintroducedPhrase(original: string, replacement: string, forbidden: string[]): string | null {
  const before = phrases(original);
  const banned = new Set(forbidden.flatMap((f) => [...phrases(f)]));
  for (const p of phrases(replacement)) if (!before.has(p) && banned.has(p)) return p;
  return null;
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
  forbidden: string[] = [],
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
    else if (target.locked && countWords(replacement) < countWords(target.text) - 5) reason = "cuts too much from a protected sentence";
    else {
      const back = reintroducedPhrase(target.text, replacement, forbidden);
      if (back) reason = 'brings back deleted or rejected wording ("' + back + '")';
    }
    if (reason || !target) {
      skipped.push({ ...r, reason });
      continue;
    }
    report = { ...report, [target.part]: report[target.part].replace(target.text, replacement) };
    applied.push({ original: target.text, replacement });
  }
  return { report, applied, skipped };
}

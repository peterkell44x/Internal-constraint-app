// Denial check over a finished report. Prompt rules alone did not stop the
// report from building its constraint on an interpretation the person had
// rejected, or from joining separate things they said into a pattern they
// never confirmed. So, like the length pass, this runs as separate calls:
//
// 1. An audit reads only the conversation and lists what the person rejected
//    and which links they stated or confirmed. It runs once per report.
// 2. A check compares the finished report against that audit and lists each
//    violation, quoting the report.
//
// The flagged sentences are then deleted, delete-only like the length pass:
// the report is never rewritten, and protected sentences are never removed.
// A violation inside a protected sentence is recorded but stays.
//
// Pure module (no imports besides types) so the tests can load it directly.

import type { Sentence } from "./review";

export interface Audit {
  rejected: { interpretation: string; quote: string; answer?: "no" | "correction" | "uncertain" }[];
  confirmed: { link: string; quote: string }[];
  /** Answers labelled uncertain with no clear denial in them. Not rejections, but every check flags them if the report states them as fact. */
  uncertain?: { interpretation: string; quote: string }[];
}

// The first five come from the check call; "absolute", "duplicate" and
// "third_person" are found by code (repair.ts), and "stated_problem" by a
// separate judgment call.
export type ViolationKind =
  | "rejected"
  | "unconfirmed_link"
  | "not_said"
  | "uncertain"
  | "overstated"
  | "absolute"
  | "duplicate"
  | "third_person"
  | "stated_problem";

/** Kinds fixed by hedging the one sentence rather than deleting it. */
export const HEDGE_KINDS: ViolationKind[] = ["uncertain", "overstated"];

export interface Violation {
  quote: string;
  kind: ViolationKind;
  reason: string;
  /** From the check call: false when the checker took the flag back after writing its reason. */
  stands_behind?: boolean;
}

/** The conversation as plain text, without the hidden "Begin the diagnostic." opener. */
export function formatTranscript(history: { role: "user" | "assistant"; content: string }[], opener: string): string {
  return history
    .filter((m, i) => !(i === 0 && m.role === "user" && m.content === opener))
    .map((m) => (m.role === "user" ? "PERSON: " : "GUIDE: ") + m.content)
    .join("\n\n");
}

const str = { type: "string" };

export const AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rejected", "confirmed"],
  properties: {
    rejected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["interpretation", "quote", "answer"],
        properties: {
          interpretation: str,
          quote: str,
          answer: { type: "string", enum: ["no", "correction", "uncertain"] },
        },
      },
    },
    confirmed: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["link", "quote"],
        properties: { link: str, quote: str },
      },
    },
  },
} as const;

export const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["violations"],
  properties: {
    violations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        // stands_behind comes after the reason, so the checker decides it
        // once it has written its reasoning.
        required: ["quote", "kind", "reason", "stands_behind"],
        properties: {
          quote: str,
          kind: { type: "string", enum: ["rejected", "unconfirmed_link", "not_said", "uncertain", "overstated"] },
          reason: str,
          stands_behind: { type: "boolean" },
        },
      },
    },
  },
} as const;

export function buildAuditSystem(): string {
  return "You are auditing a diagnostic conversation between a GUIDE and a PERSON. Nothing you write is shown to the person. Produce two lists.\n\n"
  + "rejected: every interpretation, explanation, or link that was put to the person, by the guide or as a possibility, and that the person rejected, denied, corrected, or answered no to. For each, give the interpretation in plain words, the person's exact words, and label their answer: no for a clear no or denial, correction for when they gave a different answer instead, or uncertain for idk, not sure, maybe, or not knowing. If an answer is partly unsure but clearly denies something, for example maybe one thing, but I do not think it is that, label it no for what it denies.\n\n"
  + "confirmed: every link between two things that the person stated themselves or clearly agreed to when it was put to them. A link can be between something from their past and something they do now, between a feeling and a behavior, between two behaviors, or a reason they gave for something they did. For each, give the link in plain words and the person's exact words. Agreement must be clear, such as yes, that is it, or saying it in their own words. Silence, idk, changing the subject, or answering a different question is not agreement. A link only the guide stated is not confirmed.\n\n"
  + "Uncertainty is neither. If the person answered idk, not sure, maybe, or said they do not know, do not put it on either list. Only a clear no, a denial, or a correction is a rejection, and only clear agreement or their own statement is a confirmation.\n\n"
  + "Be literal and strict. Do not infer what they meant. Either list can be empty.";
}

export function buildAuditInput(transcript: string): string {
  return "CONVERSATION\n\n" + transcript;
}

export function buildCheckSystem(): string {
  return "You are fact checking a written profile against the diagnostic conversation it was written from, between a GUIDE and a PERSON. You receive the conversation, an audit listing the interpretations the person rejected, the links the person confirmed, and the things the person was unsure about, and the profile. Nothing you write is shown to the person.\n\n"
  + "List a violation for each place where the profile does one of these:\n"
  + "rejected: states, implies, or rewords anything on the rejected list. Only items on that list count as rejected; a question the person answered with idk or uncertainty is not a rejection.\n"
  + "unconfirmed_link: presents a link, cause, pattern, or same move between separate things the person said, or turns one thing they said or did into a general pattern of how they operate, when that link is not on the confirmed list and the person did not state it themselves.\n"
  + "not_said: states as fact something about the person or anyone in their life that the person never said, such as an event, number, feeling, motive, or a consequence that rests on a fact about their situation they never stated.\n"
  + "uncertain: states as fact, in any wording, anything on the uncertain list. The person was unsure about these, for example they answered yeah i think, maybe, or idk, so the profile must not present them as true, as something about them, or as the reason for something.\n"
  + "overstated: states something the person did say, but more firmly, more broadly, more often, or more exactly than they said it, for example dropping their maybe, turning since 18, maybe even 12 into a firm age, or turning one example they gave into every time.\n\n"
  + "Before flagging a number, amount, age, or duration, read every message from the person. Numbers can be written as digits or words and ranges can be written as 4-5 or four to five; these mean the same thing.\n\n"
  + "Do not flag: things the person said, links on the confirmed list and how they play out, what a single thing the person said means in their own framing, the suggested action in the counter belief section, or wording and style. When in doubt whether the person said something, check the conversation.\n\n"
  + "For each violation, quote the exact sentence or clause from the profile and give a short reason. Then set stands_behind: true only if, after checking the conversation, you still hold that it is a violation. If while writing the reason you find the person did say it, or you change your mind, leave the item out, or set stands_behind to false. Items with stands_behind false are ignored. If there are none, return an empty list.";
}

export function formatAudit(a: Audit): string {
  const rejected = a.rejected.length
    ? a.rejected.map((r) => "- " + r.interpretation + " (person: \"" + r.quote + "\")").join("\n")
    : "(none)";
  const confirmed = a.confirmed.length
    ? a.confirmed.map((c) => "- " + c.link + " (person: \"" + c.quote + "\")").join("\n")
    : "(none)";
  const uncertain = a.uncertain?.length
    ? a.uncertain.map((u) => "- " + u.interpretation + " (person: \"" + u.quote + "\")").join("\n")
    : "(none)";
  return "REJECTED BY THE PERSON\n" + rejected + "\n\nCONFIRMED BY THE PERSON\n" + confirmed
    + "\n\nUNSURE, MUST NOT BE STATED AS FACT\n" + uncertain;
}

export function buildCheckInput(transcript: string, audit: Audit, report: string): string {
  return "CONVERSATION\n\n" + transcript + "\n\nAUDIT\n\n" + formatAudit(audit) + "\n\nPROFILE\n\n" + report;
}

/** Parses a structured reply, or returns null if it is not the expected shape. */
export function parseAudit(text: string): Audit | null {
  try {
    const j = JSON.parse(text);
    if (!Array.isArray(j?.rejected) || !Array.isArray(j?.confirmed)) return null;
    // An uncertain answer (idk, not sure) is not a rejection. The model labels
    // each answer and the code drops the uncertain ones, since an instruction
    // alone to leave them out was ignored in testing. But an answer that is
    // partly unsure and still clearly denies something is kept, whatever the
    // label says.
    const keep = (r: Audit["rejected"][number]) => r.answer !== "uncertain" || containsDenial(r.quote);
    const rejected = j.rejected.filter(keep);
    const uncertain = j.rejected
      .filter((r: Audit["rejected"][number]) => !keep(r))
      .map((r: Audit["rejected"][number]) => ({ interpretation: r.interpretation, quote: r.quote }));
    return { rejected, confirmed: j.confirmed, uncertain };
  } catch {
    return null;
  }
}

/**
 * True when an answer clearly denies something, even if it also hedges. The
 * phrases of not knowing ("i dont know", "not sure", "idk", "maybe") are
 * removed first so they don't count as denials themselves.
 */
export function containsDenial(quote: string): boolean {
  const rest = quote
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\bi\s*(do\s*n'?o?t|dont|don't)\s+know\b|\bidk\b|\bnot\s+sure\b|\bno\s+idea\b|\bunsure\b|\bmaybe\b|\bnot\s+certain\b/g, " ");
  return /\b(no|nope|not|don'?t|dont|do not|didn'?t|didnt|isn'?t|isnt|wasn'?t|wasnt|never|wrong|disagree)\b/.test(rest);
}

// Reasons in which the checker takes its own flag back, as it did in testing
// ("Withdrawing this one", "Withdrawing, the person did say this").
const WITHDRAWN_REASON = /\bwithdr[ae]w(n|ing|s)?\b|\bretract(ed|ing|s)?\b|\bnot (actually |really )?a violation\b|\bscratch that\b/i;

/**
 * Separates flags the checker stands behind from ones it withdrew: marked
 * stands_behind false, or a reason that takes the flag back. Withdrawn flags
 * are never acted on.
 */
export function dropWithdrawn(violations: Violation[]): { kept: Violation[]; withdrawn: Violation[] } {
  const kept: Violation[] = [];
  const withdrawn: Violation[] = [];
  for (const v of violations) {
    if (v.stands_behind === false || WITHDRAWN_REASON.test(v.reason ?? "")) withdrawn.push(v);
    else kept.push(v);
  }
  return { kept, withdrawn };
}

export function parseViolations(text: string): Violation[] | null {
  try {
    const j = JSON.parse(text);
    return Array.isArray(j?.violations) ? (j.violations as Violation[]) : null;
  } catch {
    return null;
  }
}

/** Lowercase words only, so quotes match regardless of punctuation and spacing. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function words(text: string): string[] {
  return text.split(" ").filter(Boolean);
}

export interface ViolationMatch {
  /** Unprotected sentences to delete. */
  deleteIds: number[];
  /** Violations that can't be fixed by deletion: in a protected sentence, or not found. */
  unfixable: Violation[];
}

/**
 * The sentences a quote points at. A quote can be part of one sentence or span
 * several; trimmed or slightly reworded quotes fall back to their opening or
 * closing words. Empty when the quote can't be found.
 */
export function findQuotedSentences(sentences: Sentence[], quote: string): Sentence[] {
  const q = normalize(quote);
  if (!q) return [];
  const norm = sentences.map((s) => ({ s, t: normalize(s.text) }));
  // The quote is inside a sentence, or a whole sentence (of a few words or
  // more) is inside the quote.
  let hits = norm.filter(({ t }) => t.includes(q) || (words(t).length >= 4 && q.includes(t)));
  if (hits.length === 0) {
    const qw = words(q);
    if (qw.length >= 8) {
      const head = qw.slice(0, 8).join(" ");
      const tail = qw.slice(-8).join(" ");
      hits = norm.filter(({ t }) => t.includes(head) || t.includes(tail));
    }
  }
  return hits.map(({ s }) => s);
}

/**
 * Finds the sentences each violation quotes. Protected sentences are never
 * selected; a violation that touches one, or whose quote can't be found, is
 * unfixable by deletion.
 */
export function matchViolations(sentences: Sentence[], violations: Violation[]): ViolationMatch {
  const deleteIds = new Set<number>();
  const unfixable: Violation[] = [];
  for (const v of violations) {
    const hits = findQuotedSentences(sentences, v.quote);
    if (hits.length === 0 || hits.some((s) => s.locked)) unfixable.push(v);
    for (const s of hits) if (!s.locked) deleteIds.add(s.id);
  }
  return { deleteIds: [...deleteIds], unfixable };
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, a: 1, an: 1, half: 0.5,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * Every number in a text, from digits ("4-5", "35k", "$6,000") or words
 * ("four to five", "twenty five", "a hundred"). Words like "a" only count as
 * 1 before a scale word ("a hundred"), so ordinary text doesn't add 1s.
 */
export function extractNumbers(text: string): Set<number> {
  const out = new Set<number>();
  const t = text.toLowerCase();
  for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b/g)) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (m[2] === "k") n *= 1000;
    if (m[2] === "m") n *= 1000000;
    out.add(n);
  }
  const words = t.replace(/[^a-z]+/g, " ").split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let n: number | null = null;
    if (w in TENS) {
      n = TENS[w];
      if (words[i + 1] in UNITS && UNITS[words[i + 1]] >= 1 && UNITS[words[i + 1]] <= 9 && words[i + 1] !== "a") {
        n += UNITS[words[i + 1]];
        i++;
      }
    } else if (w in UNITS && w !== "a" && w !== "an") {
      n = UNITS[w];
    } else if ((w === "a" || w === "an") && (words[i + 1] === "hundred" || words[i + 1] === "thousand")) {
      n = 1;
    }
    if (n === null) continue;
    if (words[i + 1] === "hundred") { n *= 100; i++; }
    else if (words[i + 1] === "thousand") { n *= 1000; i++; }
    out.add(n);
  }
  return out;
}

const NUMBERISH_REASON = /\d|\b(year|years|month|months|week|weeks|day|days|hour|hours|minute|minutes|time|number|amount|age|old|duration|long|dollar|dollars|percent|range|figure|count|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|forty|fifty|hundred|thousand)\b|\$/i;

/**
 * Drops "not said" flags that are only about numbers the person did say, in
 * any form. Kept when the quote has no number, when any of its numbers is
 * missing from the person's messages, or when the reason isn't about a number.
 */
export function dismissNumberFalsePositives(
  violations: Violation[],
  personText: string,
): { kept: Violation[]; dismissed: Violation[] } {
  const said = extractNumbers(personText);
  const kept: Violation[] = [];
  const dismissed: Violation[] = [];
  for (const v of violations) {
    const nums = [...extractNumbers(v.quote)];
    const allSaid = nums.length > 0 && nums.every((n) => said.has(n));
    if (v.kind === "not_said" && allSaid && NUMBERISH_REASON.test(v.reason)) dismissed.push(v);
    else kept.push(v);
  }
  return { kept, dismissed };
}

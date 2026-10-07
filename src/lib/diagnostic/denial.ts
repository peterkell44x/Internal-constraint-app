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
  /** Answers labelled uncertain with no clear denial in them; kept for the debug view, not used by the check. */
  uncertain?: { interpretation: string; quote: string }[];
}

export type ViolationKind = "rejected" | "unconfirmed_link" | "not_said";

export interface Violation {
  quote: string;
  kind: ViolationKind;
  reason: string;
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
        required: ["quote", "kind", "reason"],
        properties: {
          quote: str,
          kind: { type: "string", enum: ["rejected", "unconfirmed_link", "not_said"] },
          reason: str,
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
  return "You are fact checking a written profile against the diagnostic conversation it was written from, between a GUIDE and a PERSON. You receive the conversation, an audit listing the interpretations the person rejected and the links the person confirmed, and the profile. Nothing you write is shown to the person.\n\n"
  + "List a violation for each place where the profile does one of these:\n"
  + "rejected: states, implies, or rewords anything on the rejected list. Only items on that list count as rejected; a question the person answered with idk or uncertainty is not a rejection.\n"
  + "unconfirmed_link: presents a link, cause, pattern, or same move between separate things the person said, or turns one thing they said or did into a general pattern of how they operate, when that link is not on the confirmed list and the person did not state it themselves.\n"
  + "not_said: states as fact something about the person or anyone in their life that the person never said, such as an event, number, feeling, motive, or a consequence that rests on a fact about their situation they never stated.\n\n"
  + "Do not flag: things the person said, links on the confirmed list and how they play out, what a single thing the person said means in their own framing, the suggested action in the counter belief section, or wording and style. When in doubt whether the person said something, check the conversation.\n\n"
  + "For each violation, quote the exact sentence or clause from the profile and give a short reason. If there are none, return an empty list.";
}

function formatAudit(a: Audit): string {
  const rejected = a.rejected.length
    ? a.rejected.map((r) => "- " + r.interpretation + " (person: \"" + r.quote + "\")").join("\n")
    : "(none)";
  const confirmed = a.confirmed.length
    ? a.confirmed.map((c) => "- " + c.link + " (person: \"" + c.quote + "\")").join("\n")
    : "(none)";
  return "REJECTED BY THE PERSON\n" + rejected + "\n\nCONFIRMED BY THE PERSON\n" + confirmed;
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

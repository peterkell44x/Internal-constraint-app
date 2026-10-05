// Denial check over a finished report. Prompt rules alone did not stop the
// report from building its constraint on an interpretation the person had
// rejected, or from joining separate things they said into a pattern they
// never confirmed. So, like the length pass, this runs as separate calls:
//
// 1. An audit reads only the conversation and lists what the person rejected
//    and which links they stated or confirmed. It runs once per report.
// 2. A check compares a finished report against that audit and lists each
//    violation, quoting the report.
//
// The engine regenerates the report when the check finds violations, and
// ships the attempt with the fewest if none comes back clean.
//
// Pure module (no imports besides types) so the tests can load it directly.

export interface Audit {
  rejected: { interpretation: string; quote: string; answer?: "no" | "correction" | "uncertain" }[];
  confirmed: { link: string; quote: string }[];
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
  + "rejected: every interpretation, explanation, or link that was put to the person, by the guide or as a possibility, and that the person rejected, denied, corrected, or answered no to. For each, give the interpretation in plain words, the person's exact words, and label their answer: no for a clear no or denial, correction for when they gave a different answer instead, or uncertain for idk, not sure, maybe, or not knowing.\n\n"
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

/**
 * Appended to the report prompt when regenerating. Lists every claim earlier
 * attempts were rejected for, so a retry does not repeat one of them.
 */
export function buildRetryNote(violations: Violation[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const v of violations) {
    const key = v.quote.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push("- \"" + v.quote.trim() + "\" (" + v.reason.trim() + ")");
  }
  return "\n\nAn earlier draft of this profile failed a fact check because it contained these claims, which the person rejected or never confirmed:\n"
    + lines.join("\n")
    + "\n\nWrite the profile again from the start. Do not make these claims or restate them in other words. Where the conversation does not support a sharper claim, say less.";
}

/** Parses a structured reply, or returns null if it is not the expected shape. */
export function parseAudit(text: string): Audit | null {
  try {
    const j = JSON.parse(text);
    if (!Array.isArray(j?.rejected) || !Array.isArray(j?.confirmed)) return null;
    // An uncertain answer (idk, not sure) is not a rejection. The model labels
    // each answer and the code drops the uncertain ones, since an instruction
    // alone to leave them out was ignored in testing.
    const rejected = j.rejected.filter((r: { answer?: string }) => r.answer !== "uncertain");
    return { rejected, confirmed: j.confirmed };
  } catch {
    return null;
  }
}

export function parseViolations(text: string): Violation[] | null {
  try {
    const j = JSON.parse(text);
    return Array.isArray(j?.violations) ? (j.violations as Violation[]) : null;
  } catch {
    return null;
  }
}

export interface Attempt<T> {
  value: T;
  violations: Violation[] | null; // null when the check itself failed
}

/**
 * The attempt to ship: the first with no violations, otherwise the one with
 * the fewest. Unchecked attempts count as worst; ties go to the earliest.
 */
export function pickBest<T>(attempts: Attempt<T>[]): Attempt<T> {
  const score = (a: Attempt<T>) => (a.violations === null ? Infinity : a.violations.length);
  return attempts.reduce((best, a) => (score(a) < score(best) ? a : best));
}

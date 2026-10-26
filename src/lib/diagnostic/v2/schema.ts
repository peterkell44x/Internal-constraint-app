// JSON schemas for the Architect AI calls, and validators for what comes back.
// The schemas go to the model as structured output; the validators check what
// the schema can't (exact counts, empty strings, edit actions).
//
// Pure module.

const str = { type: "string" };

export const REACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reaction", "anchor", "crisis"],
  properties: { reaction: str, anchor: str, crisis: { type: "boolean" } },
} as const;

export const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hidden_tie", "constraint", "sections", "old_bullets", "new_bullets"],
  properties: {
    hidden_tie: str,
    constraint: str,
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
        required: ["n", "verdict", "edit", "reason"],
        properties: {
          n: { type: "integer" },
          verdict: { type: "string", enum: ["DELETE", "EDIT"] },
          edit: str,
          reason: str,
        },
      },
    },
  },
} as const;

export const CONSTRAINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["constraint"],
  properties: { constraint: str },
} as const;

export interface ArchitectReport {
  hidden_tie: string;
  /**
   * "Your internal constraint is the belief that ..., and it is what stands
   * between you and ...". Placed by the code as the last sentence of
   * "Uncovered internal constraint" card 3; empty when there is none (and in
   * reports made before it existed).
   */
  constraint?: string;
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
    constraint: typeof j.constraint === "string" ? j.constraint.trim() : "",
    sections: j.sections.map((s, i) => ({ name: sectionNames[i] ?? s.name, cards: s.cards.map((c) => c.trim()) })),
    old_bullets: j.old_bullets!.map((b) => b.trim()),
    new_bullets: j.new_bullets!.map((b) => b.trim()),
  };
}

export function parseCard(text: string): string | null {
  const j = json(text) as { card?: unknown } | null;
  return j && nonEmpty(j.card) ? j.card.trim() : null;
}

export interface FactFlag {
  n: number;
  verdict: "DELETE" | "EDIT";
  edit: string;
  /** One clean line, for the debug view. */
  reason: string;
  /** The reason exactly as the model wrote it, for the keep-phrase check. */
  raw: string;
}

/** The reason as one clean line: the first line, cut before any "However". */
export function cleanReason(reason: string): string {
  const first = reason.split(/\n/)[0].trim();
  const cut = first.search(/\bhowever\b/i);
  return (cut > 0 ? first.slice(0, cut) : first).trim().replace(/[,;:\s]+$/, "");
}

export function parseFactCheck(text: string): FactFlag[] | null {
  const j = json(text) as { flagged?: unknown } | null;
  if (!j || !Array.isArray(j.flagged)) return null;
  return j.flagged
    .filter((f): f is { n: number; verdict?: unknown; action?: unknown; edit?: unknown; reason?: unknown } => !!f && Number.isInteger(f.n))
    .map((f) => ({
      n: f.n,
      // Anything but a clear EDIT is a delete.
      verdict: String(f.verdict ?? f.action ?? "").toUpperCase() === "EDIT" ? "EDIT" : "DELETE",
      edit: typeof f.edit === "string" ? f.edit.trim() : "",
      reason: cleanReason(String(f.reason ?? "")),
      raw: String(f.reason ?? ""),
    }));
}

export function parseConstraint(text: string): string | null {
  const j = json(text) as { constraint?: unknown } | null;
  return j && nonEmpty(j.constraint) ? j.constraint.trim() : null;
}

/** The reaction's hard length limit; it aims for about 55 words. */
export const REACTION_MAX_WORDS = 70;

export function parseReaction(text: string): { reaction: string; anchor: string; crisis: boolean } | null {
  const j = json(text) as { reaction?: unknown; anchor?: unknown; crisis?: unknown } | null;
  if (!j || !nonEmpty(j.reaction) || typeof j.crisis !== "boolean") return null;
  return { reaction: j.reaction.trim(), anchor: typeof j.anchor === "string" ? j.anchor.trim() : "", crisis: j.crisis };
}

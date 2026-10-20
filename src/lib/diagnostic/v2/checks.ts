// Fact safety for the Architect report: code checks, then one AI check.
//
// Code checks (deterministic), per card: every number and quoted phrase must
// come from the answers; no banned wording (including "chase"), no advice or
// instruction wording, no em or en dashes, no sentence repeated from another
// card, no 8-word phrase shared with another card, and no 5-word phrase used
// twice inside the card. A card that fails is rewritten once; whatever still
// fails is deleted sentence by sentence (dashes are replaced with commas
// instead). A card left under 40 words is rewritten once from the answers.
// The fixed closing lines of "Life by default" and "Life by design" are put
// at the end of their cards exactly once.
//
// AI check: one call (retried once if it fails) flags sentences, each to be
// deleted or edited by removing words only; an edit that adds or changes
// words is treated as a delete. Then the code checks run again, deleting only.
// No loops.
//
// The AI calls are passed in, so this module stays pure and testable.

import { ACTION_PHRASES, BANNED_WORDING, BULLET_ACTION_PHRASES, CARD_FIX, DEFAULT_CLOSING, DESIGN_CLOSING } from "./prompts.ts";
import type { ArchitectReport, FactFlag } from "./schema.ts";
import {
  bannedIn,
  countWords,
  hasDash,
  isWordsRemovedOnly,
  normalize,
  removeSentences,
  repeatedSentences,
  repeatedWithinCard,
  replaceDashes,
  sentencesOf,
  splitCard,
  unsupportedItems,
} from "./text.ts";

export const MIN_CARD_WORDS = 40;

export interface CheckDeps {
  /** Rewrites one card; null if the call fails. */
  regenerate(section: number, card: number, fixes: string[], report: ArchitectReport): Promise<string | null>;
  /** The AI fact check: flagged sentences. Throws if the call fails. */
  factCheck(numbered: { n: number; text: string }[]): Promise<FactFlag[]>;
}

export interface CheckDebug {
  regenerated: { card: string; reasons: string[]; result: "replaced" | "failed" | "refused" }[];
  deleted: { card: string; sentence: string; reason: string; by: "code" | "ai" }[];
  edited: { card: string; before: string; after: string; reason: string }[];
  aiCheck: { status: "ok" | "failed"; attempts: number; flagged: number; error?: string };
  /** Which code checks fired, by card, for example "Life by design, card 3: advice wording". */
  fired: string[];
  /** Cards still under the minimum length when the report shipped. */
  shortCards: string[];
}

type Ref = { s: number; c: number };

function label(r: ArchitectReport, ref: Ref): string {
  return r.sections[ref.s].name + ", card " + (ref.c + 1);
}

function refs(): Ref[] {
  const out: Ref[] = [];
  for (let s = 0; s < 4; s++) for (let c = 0; c < 3; c++) out.push({ s, c });
  return out;
}

function flat(r: ArchitectReport): string[] {
  return r.sections.flatMap((s) => s.cards);
}

function cardAt(r: ArchitectReport, ref: Ref): string {
  return r.sections[ref.s].cards[ref.c];
}

function withCard(r: ArchitectReport, ref: Ref, text: string): ArchitectReport {
  return {
    ...r,
    sections: r.sections.map((s, si) => (si !== ref.s ? s : { ...s, cards: s.cards.map((c, ci) => (ci === ref.c ? text : c)) })),
  };
}

// ---------------------------------------------------------------------------
// The fixed closing lines

const CLOSINGS: { ref: Ref; text: string }[] = [
  { ref: { s: 2, c: 2 }, text: DEFAULT_CLOSING },
  { ref: { s: 3, c: 2 }, text: DESIGN_CLOSING },
];

function closingKey(sentence: string): string {
  return normalize(sentence.replace(/\bthat['’]?s\b/gi, "that is"));
}

/** The closing line a card must end with, if any. */
export function closingFor(ref: Ref): string | undefined {
  return CLOSINGS.find((x) => x.ref.s === ref.s && x.ref.c === ref.c)?.text;
}

/** Removes every copy of the two closing lines, then puts each once at the end of its own card. */
export function enforceClosings(r: ArchitectReport): ArchitectReport {
  let out = r;
  for (const closing of CLOSINGS) {
    const key = closingKey(closing.text);
    for (const ref of refs()) {
      const copies = sentencesOf(cardAt(out, ref)).filter((s) => closingKey(s) === key);
      if (copies.length) out = withCard(out, ref, removeSentences(cardAt(out, ref), new Set(copies)));
    }
    const card = cardAt(out, closing.ref);
    const paras = splitCard(card).map((p) => p.join(" "));
    if (paras.length === 0) paras.push("");
    paras[paras.length - 1] = (paras[paras.length - 1] + " " + closing.text).trim();
    out = withCard(out, closing.ref, paras.join("\n\n"));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Code checks

/** The code checks one card fails, as kinds and as fix instructions for a rewrite. */
export function cardIssues(r: ArchitectReport, ref: Ref, answers: string): { kinds: string[]; fixes: string[] } {
  const cards = flat(r);
  const i = ref.s * 3 + ref.c;
  const card = cards[i];
  const kinds: string[] = [];
  const fixes: string[] = [];
  const unsupported = unsupportedItems(card, answers);
  if (unsupported.length) {
    kinds.push("number or quote not in their answers");
    fixes.push(CARD_FIX.unsupported + " Not in their answers: " + unsupported.join(", ") + ".");
  }
  const banned = bannedIn(card, BANNED_WORDING);
  if (banned.length) {
    kinds.push(banned.some((b) => b.startsWith("chas")) ? '"chasing"' : "banned wording");
    fixes.push(CARD_FIX.banned + " Found: " + banned.join(", ") + ".");
  }
  const action = bannedIn(card, ACTION_PHRASES);
  if (action.length) {
    kinds.push("advice wording");
    fixes.push(CARD_FIX.action + " Found: " + action.join(", ") + ".");
  }
  if (hasDash(card)) {
    kinds.push("em dash");
    fixes.push(CARD_FIX.dash);
  }
  if (repeatedSentences(cards, i).length) {
    kinds.push("repeats another card");
    fixes.push(CARD_FIX.repeated);
  }
  if (repeatedWithinCard(card, closingFor(ref)).length) {
    kinds.push("repeats itself");
    fixes.push(CARD_FIX.repeatedWithin);
  }
  return { kinds, fixes };
}

/**
 * Deletes, card by card in order, every sentence that still fails a code
 * check, and replaces any remaining dash with a comma.
 */
function deleteFailing(r: ArchitectReport, answers: string, debug: CheckDebug): ArchitectReport {
  let out = r;
  for (const ref of refs()) {
    const cards = flat(out);
    const i = ref.s * 3 + ref.c;
    const repeats = new Set(repeatedSentences(cards, i));
    const within = new Set(repeatedWithinCard(cards[i], closingFor(ref)));
    const remove = new Map<string, string>();
    for (const s of sentencesOf(cards[i])) {
      const unsupported = unsupportedItems(s, answers);
      const banned = bannedIn(s, BANNED_WORDING);
      const action = bannedIn(s, ACTION_PHRASES);
      if (unsupported.length) remove.set(s, "not in their answers: " + unsupported.join(", "));
      else if (banned.length) remove.set(s, "banned wording: " + banned.join(", "));
      else if (action.length) remove.set(s, "advice wording: " + action.join(", "));
      else if (repeats.has(s)) remove.set(s, "repeats an earlier card");
      else if (within.has(s)) remove.set(s, "repeats a phrase inside this card");
    }
    let text = cards[i];
    if (remove.size) {
      for (const [sentence, reason] of remove) debug.deleted.push({ card: label(out, ref), sentence, reason, by: "code" });
      text = removeSentences(text, new Set(remove.keys()));
    }
    if (hasDash(text)) {
      text = replaceDashes(text);
      debug.fired.push(label(out, ref) + ": em dash replaced with a comma");
    }
    if (text !== cards[i]) out = withCard(out, ref, text);
  }
  return out;
}

/**
 * A rewrite asked only to remove a number or quote may not restate the card:
 * every sentence that had no unsupported number or quote must come back word
 * for word.
 */
function keepsOtherSentences(before: string, after: string, answers: string): boolean {
  const kept = new Set(sentencesOf(after));
  return sentencesOf(before).every((s) => unsupportedItems(s, answers).length > 0 || kept.has(s));
}

/** Rewrites the given cards once each, in parallel. */
async function regenerateAll(
  r: ArchitectReport,
  jobs: { ref: Ref; fixes: string[]; numberOnly?: boolean }[],
  answers: string,
  deps: CheckDeps,
  debug: CheckDebug,
): Promise<ArchitectReport> {
  const results = await Promise.all(jobs.map((j) => deps.regenerate(j.ref.s, j.ref.c, j.fixes, r).catch(() => null)));
  let out = r;
  jobs.forEach((j, k) => {
    const text = results[k];
    if (!text) {
      debug.regenerated.push({ card: label(r, j.ref), reasons: j.fixes, result: "failed" });
      return;
    }
    if (j.numberOnly && !keepsOtherSentences(cardAt(r, j.ref), text, answers)) {
      debug.regenerated.push({ card: label(r, j.ref), reasons: [...j.fixes, "Refused: the rewrite changed more than the number."], result: "refused" });
      return;
    }
    debug.regenerated.push({ card: label(r, j.ref), reasons: j.fixes, result: "replaced" });
    out = withCard(out, j.ref, text);
  });
  return out;
}

function cleanBullets(r: ArchitectReport, answers: string, debug: CheckDebug): ArchitectReport {
  const keep = (list: string[], name: string) =>
    list
      .map((b) => (hasDash(b) ? replaceDashes(b) : b))
      .filter((b) => {
        const bad = [...unsupportedItems(b, answers), ...bannedIn(b, BANNED_WORDING), ...bannedIn(b, BULLET_ACTION_PHRASES)];
        if (bad.length) debug.deleted.push({ card: name, sentence: b, reason: "not allowed: " + bad.join(", "), by: "code" });
        return bad.length === 0;
      });
  return { ...r, old_bullets: keep(r.old_bullets, "Life by default bullets"), new_bullets: keep(r.new_bullets, "Life by design bullets") };
}

// ---------------------------------------------------------------------------

export async function checkArchitectReport(
  report: ArchitectReport,
  answers: string,
  deps: CheckDeps,
): Promise<{ report: ArchitectReport; debug: CheckDebug }> {
  const debug: CheckDebug = {
    regenerated: [],
    deleted: [],
    edited: [],
    aiCheck: { status: "failed", attempts: 0, flagged: 0 },
    fired: [],
    shortCards: [],
  };
  let r = enforceClosings(report);

  // 1. Code checks: rewrite each failing card once, then delete what still fails.
  const failing = refs()
    .map((ref) => ({ ref, ...cardIssues(r, ref, answers) }))
    .filter((j) => j.fixes.length > 0);
  for (const j of failing) debug.fired.push(label(r, j.ref) + ": " + j.kinds.join(", "));
  if (failing.length) {
    const jobs = failing.map((j) => ({ ref: j.ref, fixes: j.fixes, numberOnly: j.kinds.length === 1 && j.kinds[0].startsWith("number") }));
    r = enforceClosings(await regenerateAll(r, jobs, answers, deps, debug));
  }
  r = enforceClosings(deleteFailing(r, answers, debug));

  // 2. A card left too short is rewritten once from the answers, then checked again.
  const short = refs().filter((ref) => countWords(cardAt(r, ref)) < MIN_CARD_WORDS);
  if (short.length) {
    r = enforceClosings(await regenerateAll(r, short.map((ref) => ({ ref, fixes: [CARD_FIX.short] })), answers, deps, debug));
    r = enforceClosings(deleteFailing(r, answers, debug));
  }
  r = cleanBullets(r, answers, debug);

  // 3. The one AI check, retried once if the call fails. Each flagged sentence
  //    is edited (words removed only) or deleted.
  const numbered: { n: number; text: string; ref: Ref | "old" | "new" }[] = [];
  for (const ref of refs()) for (const t of sentencesOf(cardAt(r, ref))) numbered.push({ n: numbered.length + 1, text: t, ref });
  for (const b of r.old_bullets) numbered.push({ n: numbered.length + 1, text: b, ref: "old" });
  for (const b of r.new_bullets) numbered.push({ n: numbered.length + 1, text: b, ref: "new" });
  let flagged: FactFlag[] | null = null;
  for (let attempt = 1; attempt <= 2 && flagged === null; attempt++) {
    debug.aiCheck.attempts = attempt;
    try {
      flagged = await deps.factCheck(numbered.map(({ n, text }) => ({ n, text })));
    } catch (e) {
      debug.aiCheck.error = e instanceof Error ? e.message : String(e);
    }
  }
  if (flagged === null) {
    debug.aiCheck.status = "failed";
  } else {
    debug.aiCheck = { status: "ok", attempts: debug.aiCheck.attempts, flagged: flagged.length };
    for (const f of flagged) {
      const item = numbered.find((x) => x.n === f.n);
      if (!item) continue;
      const edit = f.action === "edit" && isWordsRemovedOnly(item.text, f.edit) ? replaceDashes(f.edit) : null;
      const reason = f.reason + (f.action === "edit" && !edit ? " (the edit changed words, so the sentence was deleted)" : "");
      if (item.ref === "old" || item.ref === "new") {
        const key = item.ref === "old" ? "old_bullets" : "new_bullets";
        const name = item.ref === "old" ? "Life by default bullets" : "Life by design bullets";
        r = { ...r, [key]: edit ? r[key].map((b) => (b === item.text ? edit : b)) : r[key].filter((b) => b !== item.text) };
        if (edit) debug.edited.push({ card: name, before: item.text, after: edit, reason });
        else debug.deleted.push({ card: name, sentence: item.text, reason, by: "ai" });
        continue;
      }
      const ref = item.ref;
      const card = cardAt(r, ref);
      if (edit) {
        r = withCard(r, ref, card.replace(item.text, edit));
        debug.edited.push({ card: label(r, ref), before: item.text, after: edit, reason });
      } else {
        r = withCard(r, ref, removeSentences(card, new Set([item.text])));
        debug.deleted.push({ card: label(r, ref), sentence: item.text, reason, by: "ai" });
      }
    }
  }

  // 4. The code checks once more, deleting only. No more AI calls.
  r = enforceClosings(deleteFailing(r, answers, debug));
  r = cleanBullets(r, answers, debug);
  r = { ...r, hidden_tie: replaceDashes(r.hidden_tie) };
  debug.shortCards = refs()
    .filter((ref) => countWords(cardAt(r, ref)) < MIN_CARD_WORDS)
    .map((ref) => label(r, ref));
  return { report: r, debug };
}

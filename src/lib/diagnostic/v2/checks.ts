// Fact safety for the Architect report: code checks, then one AI check.
//
// Code checks (deterministic), per card: every number and quoted phrase must
// come from the answers; no banned wording (including "chase"), no advice or
// instruction wording, no em or en dashes, no sentence repeated from another
// card, no 8-word phrase shared with another card, no 5-word phrase used
// twice inside the card, no duration or frequency ("for years", "always")
// and no timing or reference back ("at the same time", "the old fear") the
// person never used. A card that fails is rewritten once; whatever still
// fails is deleted sentence by sentence (dashes are replaced with commas
// instead). Sentences that tell the person what they "really" want, comment
// on their words ("you used that word") or are empty aphorisms ("where the
// real pattern lives") are deleted straight away. The fixed closing lines of
// "Life by default" and "Life by design" are put at the end of their own
// cards exactly once, and removed from every other card. The constraint
// sentence replaces the last sentence of "Uncovered internal constraint"
// card 3 and is kept last there.
//
// AI check: one call (retried once if it fails) flags sentences, each with a
// verdict: DELETE, or EDIT by removing words only; an edit that adds or
// changes words is treated as a delete. An entry whose reason says to keep
// the sentence ("rescind", "is fine") is ignored. Every card that lost a
// sentence then gets one narrow AI call for sentences left pointing at what
// was deleted. Then the code checks run again, deleting only. A card left
// under 40 words is rewritten once, told what was deleted and why, and the
// new card gets the code checks and the AI check once more. No loops.
//
// The AI calls are passed in, so this module stays pure and testable.

import {
  ACTION_PHRASES,
  BANNED_WORDING,
  CARD_FIX,
  CODE_BANNED_PHRASES,
  DEFAULT_CLOSING,
  DESIGN_CLOSING,
  DURATION_PHRASES,
  FACT_CHECK_KEEP_PHRASES,
  INSTRUCTION_PHRASES,
  REPORT_WORD_ECHO_PATTERNS,
  TIMING_PHRASES,
} from "./prompts.ts";
import type { ArchitectReport, FactFlag } from "./schema.ts";
import {
  bannedIn,
  countWords,
  durationsNotSaid,
  hasDash,
  instructionsIn,
  isWordsRemovedOnly,
  normalize,
  removeSentences,
  repeatedSentences,
  repeatedWithinCard,
  replaceDashes,
  saysKeep,
  sentencesOf,
  splitCard,
  unsupportedItems,
} from "./text.ts";

export const MIN_CARD_WORDS = 40;

export interface CheckDeps {
  /** Rewrites one card; null if the call fails. */
  regenerate(section: number, card: number, fixes: string[], report: ArchitectReport): Promise<string | null>;
  /** The AI fact check: flagged sentences. Throws if the call fails. */
  factCheck(numbered: { n: number; text: string; section: string }[]): Promise<FactFlag[]>;
  /**
   * The narrow check on one card that lost sentences in the AI check:
   * sentences left pointing at what was deleted. Throws if the call fails.
   * Skipped when not given.
   */
  danglingCheck?(section: number, card: number, numbered: { n: number; text: string }[], deleted: string[]): Promise<FactFlag[]>;
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
  /** AI check entries ignored because their reason said to keep the sentence. */
  ignored: { card: string; sentence: string; reason: string }[];
  /** The narrow check on each card that lost a sentence in the AI check. */
  dangling: { card: string; status: "ok" | "failed"; flagged: number; error?: string }[];
  /** The AI check on cards rewritten for being too short. */
  shortCheck?: { status: "ok" | "failed"; attempts: number; flagged: number; error?: string };
  /** What happened to the constraint sentence. */
  constraint: { status: "none" | "placed" | "edited" | "deleted"; text: string; replaced?: string; note?: string };
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

const CLOSINGS: { ref: Ref; text: string; marker: string }[] = [
  { ref: { s: 2, c: 2 }, text: DEFAULT_CLOSING, marker: "that is your default" },
  { ref: { s: 3, c: 2 }, text: DESIGN_CLOSING, marker: "that is your design" },
];

function closingKey(sentence: string): string {
  return normalize(sentence.replace(/\bthat['’]?s\b/gi, "that is"));
}

/** The closing line a card must end with, if any. */
export function closingFor(ref: Ref): string | undefined {
  return CLOSINGS.find((x) => x.ref.s === ref.s && x.ref.c === ref.c)?.text;
}

// ---------------------------------------------------------------------------
// The constraint sentence

/** "Uncovered internal constraint", card 3. */
export const CONSTRAINT_REF: Ref = { s: 1, c: 2 };

function isConstraint(r: ArchitectReport, sentence: string): boolean {
  return !!r.constraint && normalize(sentence) === normalize(r.constraint);
}

function withoutConstraintCopies(r: ArchitectReport): ArchitectReport {
  let out = r;
  for (const ref of refs()) {
    const copies = sentencesOf(cardAt(out, ref)).filter((s) => isConstraint(out, s));
    if (copies.length) out = withCard(out, ref, removeSentences(cardAt(out, ref), new Set(copies)));
  }
  return out;
}

function appendTo(card: string, sentence: string): string {
  const paras = splitCard(card).map((p) => p.join(" "));
  if (paras.length === 0) paras.push("");
  paras[paras.length - 1] = (paras[paras.length - 1] + " " + sentence).trim();
  return paras.join("\n\n");
}

/**
 * Puts the constraint in place the first time: any copy is removed, the
 * last sentence of "Uncovered internal constraint" card 3 (its section point)
 * is replaced by the constraint. Returns the sentence it replaced.
 */
export function placeConstraint(r: ArchitectReport): { report: ArchitectReport; replaced?: string } {
  if (!r.constraint) return { report: r };
  const out = withoutConstraintCopies(r);
  const card = cardAt(out, CONSTRAINT_REF);
  const last = sentencesOf(card).at(-1);
  const rest = last ? removeSentences(card, new Set([last])) : card;
  return { report: withCard(out, CONSTRAINT_REF, appendTo(rest, r.constraint)), replaced: last };
}

/** Keeps the constraint once, as the last sentence of its card, after a rewrite moved or dropped it. */
function enforceConstraint(r: ArchitectReport): ArchitectReport {
  if (!r.constraint) return r;
  const out = withoutConstraintCopies(r);
  return withCard(out, CONSTRAINT_REF, appendTo(cardAt(out, CONSTRAINT_REF), r.constraint));
}

/** The sentence of a card that the within-card repeat check reads first and never flags. */
function keepFor(r: ArchitectReport, ref: Ref): string | undefined {
  if (ref.s === CONSTRAINT_REF.s && ref.c === CONSTRAINT_REF.c && r.constraint) return r.constraint;
  return closingFor(ref);
}

/**
 * Removes every copy of the two closing lines from every card, including
 * reworded copies ("That's your default, and it has run a long time."), then
 * puts each once, word for word, at the end of its own card. The constraint
 * sentence, if there is one, is kept last in its own card the same way.
 */
export function enforceClosings(r: ArchitectReport): ArchitectReport {
  let out = enforceConstraint(r);
  for (const closing of CLOSINGS) {
    for (const ref of refs()) {
      const copies = sentencesOf(cardAt(out, ref)).filter((s) => (" " + closingKey(s) + " ").includes(" " + closing.marker + " "));
      if (copies.length) out = withCard(out, ref, removeSentences(cardAt(out, ref), new Set(copies)));
    }
    out = withCard(out, closing.ref, appendTo(cardAt(out, closing.ref), closing.text));
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
  const action = actionIn(card);
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
  if (repeatedWithinCard(card, keepFor(r, ref)).length) {
    kinds.push("repeats itself");
    fixes.push(CARD_FIX.repeatedWithin);
  }
  const durations = durationsNotSaid(card, answers, DURATION_PHRASES);
  if (durations.length) {
    kinds.push("invented duration (" + durations.join(", ") + ")");
    fixes.push(CARD_FIX.duration + " Found: " + durations.join(", ") + ".");
  }
  const timings = durationsNotSaid(card, answers, TIMING_PHRASES);
  if (timings.length) {
    kinds.push("invented timing (" + timings.join(", ") + ")");
    fixes.push(CARD_FIX.timing + " Found: " + timings.join(", ") + ".");
  }
  return { kinds, fixes };
}

/** Advice wording: the always-banned phrases, plus "try to" and the like used as an instruction. */
function actionIn(text: string): string[] {
  return [...bannedIn(text, ACTION_PHRASES), ...instructionsIn(text, INSTRUCTION_PHRASES)];
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
    const within = new Set(repeatedWithinCard(cards[i], keepFor(out, ref)));
    const remove = new Map<string, string>();
    for (const s of sentencesOf(cards[i])) {
      const unsupported = unsupportedItems(s, answers);
      const banned = bannedIn(s, BANNED_WORDING);
      const action = actionIn(s);
      const phrases = bannedIn(s, CODE_BANNED_PHRASES);
      const echo = REPORT_WORD_ECHO_PATTERNS.some((p) => p.test(s));
      const durations = durationsNotSaid(s, answers, DURATION_PHRASES);
      const timings = durationsNotSaid(s, answers, TIMING_PHRASES);
      if (phrases.length) remove.set(s, "banned phrase: " + phrases.join(", "));
      else if (echo) remove.set(s, "word echo");
      else if (unsupported.length) remove.set(s, "not in their answers: " + unsupported.join(", "));
      else if (durations.length) remove.set(s, "invented duration: " + durations.join(", "));
      else if (timings.length) remove.set(s, "invented timing: " + timings.join(", "));
      else if (banned.length) remove.set(s, "banned wording: " + banned.join(", "));
      else if (action.length) remove.set(s, "advice wording: " + action.join(", "));
      else if (repeats.has(s)) remove.set(s, "repeats an earlier card");
      else if (within.has(s)) remove.set(s, "repeats a phrase inside this card");
    }
    let text = cards[i];
    if (remove.size) {
      for (const [sentence, reason] of remove) {
        debug.deleted.push({ card: label(out, ref), sentence, reason, by: "code" });
        if (/^(banned phrase|word echo|invented duration|invented timing)/.test(reason)) debug.fired.push(label(out, ref) + ": " + reason.split(":")[0] + " deleted");
        if (isConstraint(out, sentence)) {
          out = { ...out, constraint: "" };
          debug.constraint = { ...debug.constraint, status: "deleted", note: "deleted by a code check: " + reason };
        }
      }
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
        const bad = [...unsupportedItems(b, answers), ...bannedIn(b, BANNED_WORDING), ...actionIn(b), ...durationsNotSaid(b, answers, TIMING_PHRASES)];
        if (bad.length) debug.deleted.push({ card: name, sentence: b, reason: "not allowed: " + bad.join(", "), by: "code" });
        return bad.length === 0;
      });
  return { ...r, old_bullets: keep(r.old_bullets, "Life by default bullets"), new_bullets: keep(r.new_bullets, "Life by design bullets") };
}

// ---------------------------------------------------------------------------

type Numbered = { n: number; text: string; section: string; ref: Ref | "old" | "new" };

function numberAll(r: ArchitectReport, only?: Ref[]): Numbered[] {
  const out: Numbered[] = [];
  for (const ref of only ?? refs()) {
    for (const t of sentencesOf(cardAt(r, ref))) out.push({ n: out.length + 1, text: t, section: r.sections[ref.s].name, ref });
  }
  if (only) return out;
  for (const b of r.old_bullets) out.push({ n: out.length + 1, text: b, section: "Life by default bullets", ref: "old" });
  for (const b of r.new_bullets) out.push({ n: out.length + 1, text: b, section: "Life by design bullets", ref: "new" });
  return out;
}

/** Runs one AI check call, retried once if it fails; null if both attempts failed. */
async function withRetry(
  call: () => Promise<FactFlag[]>,
  status: { status: "ok" | "failed"; attempts: number; flagged: number; error?: string },
): Promise<FactFlag[] | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    status.attempts = attempt;
    try {
      const flags = await call();
      status.status = "ok";
      status.flagged = flags.length;
      delete status.error;
      return flags;
    } catch (e) {
      status.error = e instanceof Error ? e.message : String(e);
    }
  }
  status.status = "failed";
  return null;
}

/**
 * Applies AI check entries: an entry whose reason says to keep the sentence
 * is ignored; a valid EDIT (words removed only) replaces the sentence; every
 * other entry deletes it. Returns the cards that lost a whole sentence, with
 * what they lost.
 */
function applyFlags(
  r: ArchitectReport,
  numbered: Numbered[],
  flags: FactFlag[],
  debug: CheckDebug,
): { report: ArchitectReport; lost: Map<string, { ref: Ref; sentences: string[] }> } {
  const lost = new Map<string, { ref: Ref; sentences: string[] }>();
  let out = r;
  for (const f of flags) {
    const item = numbered.find((x) => x.n === f.n);
    if (!item) continue;
    const where = item.ref === "old" ? "Life by default bullets" : item.ref === "new" ? "Life by design bullets" : label(out, item.ref);
    if (saysKeep(f.raw, FACT_CHECK_KEEP_PHRASES)) {
      debug.ignored.push({ card: where, sentence: item.text, reason: f.reason });
      continue;
    }
    const edit = f.verdict === "EDIT" && isWordsRemovedOnly(item.text, f.edit) ? replaceDashes(f.edit) : null;
    const reason = f.reason + (f.verdict === "EDIT" && !edit ? " (the edit changed words, so the sentence was deleted)" : "");
    if (item.ref === "old" || item.ref === "new") {
      const key = item.ref === "old" ? "old_bullets" : "new_bullets";
      out = { ...out, [key]: edit ? out[key].map((b) => (b === item.text ? edit : b)) : out[key].filter((b) => b !== item.text) };
      if (edit) debug.edited.push({ card: where, before: item.text, after: edit, reason });
      else debug.deleted.push({ card: where, sentence: item.text, reason, by: "ai" });
      continue;
    }
    const ref = item.ref;
    const card = cardAt(out, ref);
    if (!sentencesOf(card).includes(item.text)) continue;
    if (isConstraint(out, item.text)) {
      out = { ...out, constraint: edit ?? "" };
      debug.constraint = { ...debug.constraint, status: edit ? "edited" : "deleted", text: edit ?? debug.constraint.text, note: (edit ? "edited" : "deleted") + " by the AI check: " + reason };
    }
    if (edit) {
      out = withCard(out, ref, card.replace(item.text, edit));
      debug.edited.push({ card: where, before: item.text, after: edit, reason });
    } else {
      out = withCard(out, ref, removeSentences(card, new Set([item.text])));
      debug.deleted.push({ card: where, sentence: item.text, reason, by: "ai" });
      const key = ref.s + "." + ref.c;
      lost.set(key, { ref, sentences: [...(lost.get(key)?.sentences ?? []), item.text] });
    }
  }
  return { report: out, lost };
}

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
    ignored: [],
    dangling: [],
    constraint: { status: "none", text: "" },
  };
  const placed = placeConstraint(report);
  if (report.constraint) debug.constraint = { status: "placed", text: report.constraint, replaced: placed.replaced };
  let r = enforceClosings(placed.report);

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
  r = cleanBullets(r, answers, debug);

  // 2. The one AI check, retried once if the call fails. Each flagged sentence
  //    is edited (words removed only) or deleted, unless its reason says keep.
  const numbered = numberAll(r);
  const flagged = await withRetry(() => deps.factCheck(numbered.map(({ n, text, section }) => ({ n, text, section }))), debug.aiCheck);
  if (flagged) {
    const applied = applyFlags(r, numbered, flagged, debug);
    r = applied.report;

    // 3. One narrow call per card that lost a sentence: anything left
    //    pointing at what was deleted, or claiming proof with none left.
    if (deps.danglingCheck) {
      const lost = [...applied.lost.values()];
      const results = await Promise.all(
        lost.map(async ({ ref, sentences }) => {
          const card = numberAll(r, [ref]);
          try {
            return { ref, card, flags: await deps.danglingCheck!(ref.s, ref.c, card.map(({ n, text }) => ({ n, text })), sentences) };
          } catch (e) {
            return { ref, card, error: e instanceof Error ? e.message : String(e) };
          }
        }),
      );
      for (const x of results) {
        if (!x.flags) {
          debug.dangling.push({ card: label(r, x.ref), status: "failed", flagged: 0, error: x.error });
          continue;
        }
        debug.dangling.push({ card: label(r, x.ref), status: "ok", flagged: x.flags.length });
        r = applyFlags(r, x.card, x.flags, debug).report;
      }
    }
  }

  // 4. The code checks once more, deleting only.
  r = enforceClosings(deleteFailing(r, answers, debug));
  r = cleanBullets(r, answers, debug);

  // 5. A card left under 40 words is rewritten once, told what was deleted
  //    and why. The new card gets the code checks and one AI check.
  const short = refs().filter((ref) => countWords(cardAt(r, ref)) < MIN_CARD_WORDS);
  if (short.length) {
    const jobs = short.map((ref) => {
      const gone = debug.deleted.filter((d) => d.card === label(r, ref));
      const fixes = gone.length
        ? [CARD_FIX.afterDeletions, ...gone.map((d) => '"' + d.sentence + '" (' + d.reason + ")")]
        : [CARD_FIX.short];
      return { ref, fixes };
    });
    const before = r;
    r = enforceClosings(await regenerateAll(r, jobs, answers, deps, debug));
    const rewritten = short.filter((ref) => cardAt(r, ref) !== cardAt(before, ref));
    r = enforceClosings(deleteFailing(r, answers, debug));
    if (rewritten.length) {
      debug.shortCheck = { status: "failed", attempts: 0, flagged: 0 };
      const again = numberAll(r, rewritten);
      const flags = await withRetry(() => deps.factCheck(again.map(({ n, text, section }) => ({ n, text, section }))), debug.shortCheck);
      if (flags) r = applyFlags(r, again, flags, debug).report;
      r = enforceClosings(deleteFailing(r, answers, debug));
    }
  }

  r = { ...r, hidden_tie: replaceDashes(r.hidden_tie) };
  if (r.constraint) debug.constraint.text = r.constraint;
  debug.shortCards = refs()
    .filter((ref) => countWords(cardAt(r, ref)) < MIN_CARD_WORDS)
    .map((ref) => label(r, ref));
  return { report: r, debug };
}

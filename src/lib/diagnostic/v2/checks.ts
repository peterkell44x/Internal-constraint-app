// Fact safety for the Architect report: code checks, then one AI check.
//
// Code checks (deterministic), per card: every number and quoted phrase must
// come from the answers; no banned wording (including "chase"), no advice or
// instruction wording, no em or en dashes, no duration or frequency ("for
// years", "always") and no timing or reference back ("at the same time",
// "the old fear") the person never used. A card that fails is rewritten
// once; whatever still fails is deleted sentence by sentence (dashes are
// replaced with commas instead). Sentences that tell the person what they
// "really" want, comment on their words, are empty aphorisms or teaser
// claims are deleted straight away.
//
// Repeats (a sentence or 8-word phrase from an earlier card, or a 5-word
// phrase used twice in one card) are deleted first. The card is rewritten
// only if that leaves fewer than 2 sentences or 25 words, or more than half
// its sentences repeated. These are never counted as a repeat: the belief
// sentence of "Life by design" card 2, the "Stop letting ..." and "Act as if
// ..." sentences of "Life by design" card 3, and the constraint sentence (an
// earlier sentence that repeats the constraint is removed instead).
//
// The fixed closing lines of "Life by default" and "Life by design" are put
// at the end of their own cards exactly once, and removed from every other
// card. The constraint sentence replaces the last sentence of "Uncovered
// internal constraint" card 3 and is kept last there.
//
// AI check: one call (retried once if it fails) flags sentences, each with a
// verdict: DELETE, or EDIT by removing words only; an edit that adds or
// changes words is treated as a delete. Entries aimed at a closing line, or
// whose reason says to keep the sentence ("rescind", "is fine"), are
// ignored. A delete that would leave a card under 25 words is applied as
// its edit if it has a valid one, otherwise not applied (cards just
// rewritten are not protected this way). Every card that
// lost a sentence then gets one narrow AI call for sentences left pointing
// at what was deleted. Then the code checks run again, deleting only. A card
// left under 25 words is rewritten once, told what was deleted and why.
// Every card rewritten after the main AI check (or put back after a failed
// rewrite) gets the code checks and one more AI check, all in one call. A
// rewrite that fails, or leaves a card under 15 words, is discarded. No
// loops.
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
  OLD_DEFAULT_CLOSING,
  REPORT_WORD_ECHO_PATTERNS,
  TIMING_PHRASES,
} from "./prompts.ts";
import type { ArchitectReport, FactFlag } from "./schema.ts";
import {
  bannedIn,
  containsBelief,
  countWords,
  durationsNotSaid,
  frequenciesNotSaid,
  hasDash,
  instructionsIn,
  isWordsRemovedOnly,
  keepPhraseIn,
  normalize,
  plainWords,
  removeSentences,
  repeatedSentences,
  repeatedWithinCard,
  replaceDashes,
  sentencesOf,
  splitCard,
  unsupportedItems,
} from "./text.ts";

/** A card under this many words (after all checks) is rewritten once. */
export const MIN_CARD_WORDS = 25;
/**
 * An AI check delete that would leave a card under this many words is not
 * applied (closing line not counted). Cards just rewritten are not protected.
 */
export const PROTECT_CARD_WORDS = 25;
/** After deleting repeats, a card keeps at least this many sentences and words (closing line not counted), or it is rewritten. */
export const REPEAT_KEEP_SENTENCES = 2;
export const REPEAT_KEEP_WORDS = 25;
/** A rewritten card under this many words after its fact check is discarded. */
export const DISCARD_WORDS = 15;

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
  regenerated: {
    card: string;
    reasons: string[];
    result: "replaced" | "failed" | "refused";
    /** Why the card was rewritten: a repeat, too short, or another code check. */
    kind?: "repeat" | "short" | "code";
    /** Whether the rewritten card went through an AI fact check, and how many of its sentences were flagged. */
    factChecked?: boolean;
    flagged?: number;
    /** Set when the rewrite was thrown away and the earlier version put back. */
    discarded?: string;
  }[];
  deleted: { card: string; sentence: string; reason: string; by: "code" | "ai" }[];
  edited: { card: string; before: string; after: string; reason: string }[];
  aiCheck: { status: "ok" | "failed"; attempts: number; flagged: number; error?: string };
  /** Which code checks fired, by card, for example "Life by design, card 3: advice wording". */
  fired: string[];
  /** Cards still under the minimum length when the report shipped. */
  shortCards: string[];
  /** AI check entries ignored because their reason said to keep the sentence: the full note, and the keep-phrase that matched. */
  ignored: { card: string; sentence: string; reason: string; note?: string; keepPhrase?: string; withdrawn?: boolean }[];
  /**
   * Bullets an AI check entry or a code check flagged. They are kept as the
   * AI wrote them: bullets are never removed by the checks.
   */
  bulletKept?: { list: string; bullet: string; note: string; by: "ai" | "code" }[];
  /** Idiom entries whose edit swapped words: refused, and the sentence kept as it was. */
  idiomKept?: { card: string; sentence: string; reason: string; note: string }[];
  /** AI check deletes not applied because the card would drop under 25 words. */
  keptShort?: { card: string; sentence: string; reason: string }[];
  /**
   * The belief's own frequency check, run first: words removed from it
   * ("always", "constantly") with the text before and after, and other
   * frequency phrases left in it but not backed by the answers.
   */
  beliefFix?: { before: string; after: string; removed: string[]; flagged: string[] };
  /** The belief, and whether its exact words are in the constraint and in "Life by design" card 2. */
  belief?: { text: string; inConstraint: boolean; inDesign2: boolean };
  /** The narrow check on each card that lost a sentence in the AI check. */
  dangling: { card: string; status: "ok" | "failed"; flagged: number; error?: string }[];
  /** The one AI check on cards rewritten (or put back) after the main AI check. */
  shortCheck?: { status: "ok" | "failed"; attempts: number; flagged: number; error?: string };
  /** AI check entries aimed at a fixed closing line, skipped without counting them. */
  closingSkipped?: number;
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

// A sentence with any marker is a copy of that closing line. The default
// line's markers also catch its earlier wording ("..., and it has been
// running for a long time"), so only the new line is left.
const CLOSINGS: { ref: Ref; text: string; markers: string[] }[] = [
  { ref: { s: 2, c: 2 }, text: DEFAULT_CLOSING, markers: ["that is your default", "been running for a long time"] },
  { ref: { s: 3, c: 2 }, text: DESIGN_CLOSING, markers: ["that is your design"] },
];

function closingKey(sentence: string): string {
  return normalize(sentence.replace(/\bthat['’]?s\b/gi, "that is"));
}

/**
 * True when a sentence is one of the fixed closing lines (or the earlier
 * default wording), or one of them with a few words removed that still says
 * "your default", "your design" or "running for a long time". The AI check
 * never touches these: the code places them.
 */
export function isClosingLine(sentence: string): boolean {
  const key = closingKey(sentence);
  const marked = ["your default", "your design", "running for a long time"].some((m) => (" " + key + " ").includes(" " + m + " "));
  return [DEFAULT_CLOSING, OLD_DEFAULT_CLOSING, DESIGN_CLOSING].some((c) => key === closingKey(c) || (marked && isWordsRemovedOnly(closingKey(c), key)));
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

/** "Life by design", card 2: its belief sentence is never counted as a repeat. */
export const DESIGN2_REF: Ref = { s: 3, c: 1 };

/** "Life by design", card 3: its two direction sentences are never counted as a repeat. */
export const DESIGN3_REF: Ref = { s: 3, c: 2 };

const same = (a: Ref, b: Ref) => a.s === b.s && a.c === b.c;

/**
 * Sentences the repeat check never deletes: the belief sentence of "Life by
 * design" card 2, the "Stop letting ..." and "Act as if ..." sentences of
 * "Life by design" card 3, and the constraint sentence.
 */
function isRepeatExempt(r: ArchitectReport, ref: Ref, sentence: string): boolean {
  if (same(ref, DESIGN2_REF) && containsBelief(sentence, r.belief)) return true;
  if (same(ref, DESIGN3_REF) && /^(stop letting|act as if)\b/.test(normalize(sentence))) return true;
  return same(ref, CONSTRAINT_REF) && isConstraint(r, sentence);
}

/**
 * Sentences of a card that come before the constraint and repeat it (the
 * same sentence, or 8 or more words in a row). The constraint is kept and
 * these earlier copies go instead.
 */
function constraintCopies(r: ArchitectReport, ref: Ref): string[] {
  if (!r.constraint || ref.s * 3 + ref.c >= CONSTRAINT_REF.s * 3 + CONSTRAINT_REF.c) return [];
  return repeatedSentences([r.constraint, cardAt(r, ref)], 1);
}

/**
 * The sentences of a card that repeat earlier cards or a phrase inside the
 * card, plus earlier copies of the constraint, minus the exempt sentences.
 */
export function repeatsIn(r: ArchitectReport, ref: Ref): Set<string> {
  const cards = flat(r);
  const i = ref.s * 3 + ref.c;
  const all = [...repeatedSentences(cards, i), ...repeatedWithinCard(cards[i], keepFor(r, ref)), ...constraintCopies(r, ref)];
  return new Set(all.filter((s) => !isRepeatExempt(r, ref, s)));
}

/** Words in a card, not counting a fixed closing line. */
function wordsWithoutClosing(card: string): number {
  return countWords(sentencesOf(card).filter((s) => !isClosingLine(s)).join(" "));
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
      const copies = sentencesOf(cardAt(out, ref)).filter((s) => closing.markers.some((m) => (" " + closingKey(s) + " ").includes(" " + m + " ")));
      if (copies.length) out = withCard(out, ref, removeSentences(cardAt(out, ref), new Set(copies)));
    }
    out = withCard(out, closing.ref, appendTo(cardAt(out, closing.ref), closing.text));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Code checks

/**
 * The code checks one card fails, as kinds and as fix instructions for a
 * rewrite. Repeats are handled on their own (see deleteRepeats).
 */
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
  const durations = frequenciesNotSaid(card, answers, DURATION_PHRASES);
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
    const repeats = new Set(repeatedSentences(cards, i).filter((s) => !isRepeatExempt(out, ref, s)));
    const within = new Set(repeatedWithinCard(cards[i], keepFor(out, ref)).filter((s) => !isRepeatExempt(out, ref, s)));
    const copies = new Set(constraintCopies(out, ref));
    const remove = new Map<string, string>();
    for (const s of sentencesOf(cards[i])) {
      const unsupported = unsupportedItems(s, answers);
      const banned = bannedIn(s, BANNED_WORDING);
      const action = actionIn(s);
      const phrases = bannedIn(s, CODE_BANNED_PHRASES);
      const echo = REPORT_WORD_ECHO_PATTERNS.some((p) => p.test(s));
      const durations = frequenciesNotSaid(s, answers, DURATION_PHRASES);
      const timings = durationsNotSaid(s, answers, TIMING_PHRASES);
      if (phrases.length) remove.set(s, "banned phrase: " + phrases.join(", "));
      else if (echo) remove.set(s, "word echo");
      else if (unsupported.length) remove.set(s, "not in their answers: " + unsupported.join(", "));
      else if (durations.length) remove.set(s, "invented duration: " + durations.join(", "));
      else if (timings.length) remove.set(s, "invented timing: " + timings.join(", "));
      else if (banned.length) remove.set(s, "banned wording: " + banned.join(", "));
      else if (action.length) remove.set(s, "advice wording: " + action.join(", "));
      else if (copies.has(s)) remove.set(s, "repeats the constraint: constraint kept, earlier copy removed");
      else if (repeats.has(s)) remove.set(s, "repeats an earlier card");
      else if (within.has(s)) remove.set(s, "repeats a phrase inside this card");
    }
    let text = cards[i];
    if (remove.size) {
      for (const [sentence, reason] of remove) {
        debug.deleted.push({ card: label(out, ref), sentence, reason, by: "code" });
        if (/^(banned phrase|word echo|invented duration|invented timing)/.test(reason)) debug.fired.push(label(out, ref) + ": " + reason.split(":")[0] + " deleted");
        if (copies.has(sentence)) debug.fired.push(label(out, ref) + ": constraint kept, earlier copy removed");
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

type Job = { ref: Ref; fixes: string[]; numberOnly?: boolean; kind: "repeat" | "short" | "code"; send?: string };

/**
 * Rewrites the given cards once each, in parallel. `send` is the card text
 * the rewrite sees, when it differs from the card in the report (a card
 * whose repeats were already deleted is sent with them). Returns the debug
 * entry of each job.
 */
async function regenerateAll(
  r: ArchitectReport,
  jobs: Job[],
  answers: string,
  deps: CheckDeps,
  debug: CheckDebug,
): Promise<{ report: ArchitectReport; entries: CheckDebug["regenerated"] }> {
  const results = await Promise.all(
    jobs.map((j) => deps.regenerate(j.ref.s, j.ref.c, j.fixes, j.send === undefined ? r : withCard(r, j.ref, j.send)).catch(() => null)),
  );
  let out = r;
  const entries = jobs.map((j, k) => {
    const text = results[k];
    const before = j.send ?? cardAt(r, j.ref);
    let entry: CheckDebug["regenerated"][number];
    if (!text) entry = { card: label(r, j.ref), reasons: j.fixes, result: "failed", kind: j.kind };
    else if (j.numberOnly && !keepsOtherSentences(before, text, answers)) {
      entry = { card: label(r, j.ref), reasons: [...j.fixes, "Refused: the rewrite changed more than the number."], result: "refused", kind: j.kind };
    } else {
      entry = { card: label(r, j.ref), reasons: j.fixes, result: "replaced", kind: j.kind };
      out = withCard(out, j.ref, text);
    }
    debug.regenerated.push(entry);
    return entry;
  });
  return { report: out, entries };
}

/**
 * Deletes repeated sentences card by card, in order. A card that would be
 * left with fewer than 2 sentences or 25 words, or that had more than half
 * its sentences repeated, is returned for a rewrite instead: it still loses
 * the repeats now (so later cards are compared with what is left), and the
 * rewrite is sent the card as it was.
 */
function deleteRepeats(r: ArchitectReport, debug: CheckDebug): { report: ArchitectReport; rewrite: { ref: Ref; original: string; fallback: string }[] } {
  let out = r;
  const rewrite: { ref: Ref; original: string; fallback: string }[] = [];
  for (const ref of refs()) {
    const repeats = repeatsIn(out, ref);
    if (repeats.size === 0) continue;
    const original = cardAt(out, ref);
    const after = removeSentences(original, repeats);
    const copies = new Set(constraintCopies(out, ref));
    const left = sentencesOf(after).filter((s) => !isClosingLine(s)).length;
    const counted = sentencesOf(original).filter((s) => !isClosingLine(s)).length;
    const tooMuch = left < REPEAT_KEEP_SENTENCES || wordsWithoutClosing(after) < REPEAT_KEEP_WORDS || repeats.size > counted / 2;
    for (const sentence of repeats) {
      const reason = copies.has(sentence) ? "repeats the constraint: constraint kept, earlier copy removed" : "repeats an earlier card or a phrase in this card";
      debug.deleted.push({ card: label(out, ref), sentence, reason, by: "code" });
      if (copies.has(sentence)) debug.fired.push(label(out, ref) + ": constraint kept, earlier copy removed");
    }
    debug.fired.push(label(out, ref) + ": " + repeats.size + " repeated sentence(s) deleted" + (tooMuch ? ", card sent for a rewrite" : ""));
    if (tooMuch) rewrite.push({ ref, original, fallback: after });
    out = withCard(out, ref, after);
  }
  return { report: out, rewrite };
}

/**
 * The bullets' code checks. Bullets are never removed, so the final screen
 * always shows as many as the AI wrote: a bullet a check flags (invented
 * number or quote, banned or advice wording, invented timing) is kept and
 * listed in the debug view. Dashes are still replaced with commas.
 */
function cleanBullets(r: ArchitectReport, answers: string, debug: CheckDebug): ArchitectReport {
  const keep = (list: string[], name: string) =>
    list.map((b) => {
      const text = hasDash(b) ? replaceDashes(b) : b;
      const bad = [...unsupportedItems(text, answers), ...bannedIn(text, BANNED_WORDING), ...actionIn(text), ...durationsNotSaid(text, answers, TIMING_PHRASES)];
      if (bad.length && !(debug.bulletKept ?? []).some((x) => x.bullet === text && x.by === "code")) {
        (debug.bulletKept ??= []).push({ list: name, bullet: text, note: "flagged by a code check: " + bad.join(", "), by: "code" });
      }
      return text;
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
 * Drops AI check entries aimed at a fixed closing line: they are not
 * applied, not counted as flagged, and never start the per-card check.
 */
function withoutClosings(numbered: Numbered[], flags: FactFlag[], debug: CheckDebug): FactFlag[] {
  const kept = flags.filter((f) => {
    const item = numbered.find((x) => x.n === f.n);
    return !(item && item.ref !== "old" && item.ref !== "new" && isClosingLine(item.text));
  });
  debug.closingSkipped = (debug.closingSkipped ?? 0) + flags.length - kept.length;
  return withoutWithdrawn(numbered, kept, debug);
}

/** True when the AI's note withdraws its own flag ("withdraw", "withdrawing", "withdrawn", "withdrew"). */
export function isWithdrawn(note: string): boolean {
  return /\bwithdr[ae]w\w*/i.test(note);
}

/**
 * Drops AI check entries the AI withdrew in its own note: they are not
 * applied, not counted as flagged, and never start the per-card check. They
 * are listed with the other ignored entries in the debug view.
 */
function withoutWithdrawn(numbered: Numbered[], flags: FactFlag[], debug: CheckDebug): FactFlag[] {
  return flags.filter((f) => {
    if (!isWithdrawn(f.raw)) return true;
    const item = numbered.find((x) => x.n === f.n);
    if (item) {
      const where = item.ref === "old" ? "Life by default bullets" : item.ref === "new" ? "Life by design bullets" : item.section + ", card " + ((item.ref as Ref).c + 1);
      debug.ignored.push({ card: where, sentence: item.text, reason: f.reason, note: f.raw, withdrawn: true });
    }
    return false;
  });
}

/**
 * True when an entry is an idiom or cliche flag (fact check category 16).
 * Entries carry no category, so this reads the AI's note: it names an idiom,
 * a cliche or a stock phrase.
 */
export function isIdiomEntry(note: string): boolean {
  return /\b(idioms?|idiomatic|clich[eé]s?|clich[eé]d|stock phrases?)\b/i.test(note);
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
  /** Cards just rewritten: the thin-card protection does not apply to them. */
  rewritten: Ref[] = [],
): { report: ArchitectReport; lost: Map<string, { ref: Ref; sentences: string[] }> } {
  const lost = new Map<string, { ref: Ref; sentences: string[] }>();
  let out = r;
  for (const f of flags) {
    const item = numbered.find((x) => x.n === f.n);
    if (!item) continue;
    const where = item.ref === "old" ? "Life by default bullets" : item.ref === "new" ? "Life by design bullets" : label(out, item.ref);
    // Bullets are never removed or edited by the check, whatever the entry says.
    if (item.ref === "old" || item.ref === "new") {
      (debug.bulletKept ??= []).push({ list: where, bullet: item.text, note: f.raw, by: "ai" });
      continue;
    }
    const keepPhrase = keepPhraseIn(f.raw, FACT_CHECK_KEEP_PHRASES);
    if (keepPhrase) {
      debug.ignored.push({ card: where, sentence: item.text, reason: f.reason, note: f.raw, keepPhrase });
      continue;
    }
    let edit = f.verdict === "EDIT" && isWordsRemovedOnly(item.text, f.edit) ? replaceDashes(f.edit) : null;
    // A refused idiom edit keeps the sentence as it was; it is not turned into a delete.
    if (f.verdict === "EDIT" && !edit && isIdiomEntry(f.raw)) {
      (debug.idiomKept ??= []).push({ card: where, sentence: item.text, reason: f.reason, note: f.raw });
      continue;
    }
    let reason = f.reason + (f.verdict === "EDIT" && !edit ? " (the edit changed words, so the sentence was deleted)" : "");
    // Thin-card protection: a delete that would leave the card under 25
    // words becomes its edit if it has a valid one, or is not applied.
    // Cards just rewritten are not protected.
    const ref = item.ref;
    if (!edit && !rewritten.some((x) => same(x, ref))) {
      const remaining = wordsWithoutClosing(removeSentences(cardAt(out, ref), new Set([item.text])));
      if (remaining < PROTECT_CARD_WORDS && sentencesOf(cardAt(out, ref)).includes(item.text)) {
        if (f.edit && isWordsRemovedOnly(item.text, f.edit)) {
          edit = replaceDashes(f.edit);
          reason = f.reason + " (applied as an edit: deleting would leave the card under " + PROTECT_CARD_WORDS + " words)";
        } else {
          (debug.keptShort ??= []).push({ card: where, sentence: item.text, reason: f.reason + " (kept, card would drop under " + PROTECT_CARD_WORDS + " words)" });
          continue;
        }
      }
    }
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

/** How many entries were aimed at the sentences of the card with this label. */
function flaggedOn(r: ArchitectReport, numbered: Numbered[], flags: FactFlag[], card: string): number {
  return flags.filter((f) => {
    const item = numbered.find((x) => x.n === f.n);
    return item && item.ref !== "old" && item.ref !== "new" && label(r, item.ref) === card;
  }).length;
}

/** The frequency words removed from the belief when the answers do not back them. */
const BELIEF_REMOVABLE = ["always", "constantly"];

/**
 * The belief's frequency check. "always" or "constantly" not backed by the
 * answers (the word and the one after it, as in frequenciesNotSaid) is
 * removed, nothing else changed. Any other frequency phrase not backed is
 * only reported.
 */
export function checkBelief(belief: string, answers: string): { after: string; removed: string[]; flagged: string[] } {
  const said = " " + plainWords(answers).join(" ") + " ";
  const tokens = belief.split(/\s+/).filter(Boolean);
  const removed: string[] = [];
  const kept = tokens.filter((t, i) => {
    const word = normalize(t);
    if (!BELIEF_REMOVABLE.includes(word)) return true;
    const next = plainWords(tokens.slice(i + 1).join(" "))[0];
    if (said.includes(" " + (next ? word + " " + next : word) + " ")) return true;
    removed.push(word);
    return false;
  });
  const after = removed.length ? kept.join(" ") : belief;
  const flagged = frequenciesNotSaid(after, answers, DURATION_PHRASES).filter((p) => !BELIEF_REMOVABLE.includes(p));
  return { after, removed: [...new Set(removed)], flagged };
}

/** Replaces every case-insensitive copy of `from` with `to` in a text. */
function replaceAllText(text: string, from: string, to: string): string {
  return text.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), to);
}

/**
 * Applies a changed belief: the old belief text is replaced word for word in
 * the constraint, in "Life by design" card 2, and in the "Stop letting ..."
 * sentence of "Life by design" card 3.
 */
function withChangedBelief(r: ArchitectReport, before: string, after: string): ArchitectReport {
  let out: ArchitectReport = { ...r, belief: after, constraint: r.constraint ? replaceAllText(r.constraint, before, after) : r.constraint };
  out = withCard(out, DESIGN2_REF, replaceAllText(cardAt(out, DESIGN2_REF), before, after));
  const c3 = cardAt(out, DESIGN3_REF);
  const stop = sentencesOf(c3).filter((x) => /^stop letting\b/.test(normalize(x)));
  let next = c3;
  for (const x of stop) next = next.replace(x, replaceAllText(x, before, after));
  return withCard(out, DESIGN3_REF, next);
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
  // 0. The belief's own frequency check comes first, and a changed belief is
  //    carried into the constraint and "Life by design" cards 2 and 3 before
  //    any other check, so the belief exemptions keep working.
  if (report.belief) {
    const fix = checkBelief(report.belief, answers);
    if (fix.removed.length || fix.flagged.length) debug.beliefFix = { before: report.belief, after: fix.after, removed: fix.removed, flagged: fix.flagged };
    if (fix.after !== report.belief) report = withChangedBelief(report, report.belief, fix.after);
  }
  const placed = placeConstraint(report);
  if (report.constraint) debug.constraint = { status: "placed", text: report.constraint, replaced: placed.replaced };
  let r = enforceClosings(placed.report);

  // 1. Repeats are deleted first; a card left too thin by that is rewritten.
  //    Then the other code checks: each failing card is rewritten once (one
  //    rewrite per card, whatever the reasons), then what still fails is deleted.
  const repeats = deleteRepeats(r, debug);
  r = enforceClosings(repeats.report);
  const jobs = new Map<string, Job>();
  for (const x of repeats.rewrite) {
    jobs.set(label(r, x.ref), { ref: x.ref, fixes: [CARD_FIX.repeated], kind: "repeat", send: x.original });
  }
  for (const ref of refs()) {
    const issues = cardIssues(r, ref, answers);
    if (!issues.fixes.length) continue;
    debug.fired.push(label(r, ref) + ": " + issues.kinds.join(", "));
    const existing = jobs.get(label(r, ref));
    if (existing) existing.fixes.push(...issues.fixes);
    else jobs.set(label(r, ref), { ref, fixes: issues.fixes, kind: "code", numberOnly: issues.kinds.length === 1 && issues.kinds[0].startsWith("number") });
  }
  const fallbackOf = new Map(repeats.rewrite.map((x) => [label(r, x.ref), x.fallback]));
  const step1 = jobs.size ? await regenerateAll(r, [...jobs.values()], answers, deps, debug) : { report: r, entries: [] };
  r = enforceClosings(step1.report);
  const repeatRewrites = step1.entries.filter((e) => e.kind === "repeat");
  for (const e of repeatRewrites) {
    if (e.result !== "replaced") e.discarded = "rewrite discarded: the rewrite call failed, kept the card with its repeats deleted";
  }
  r = enforceClosings(deleteFailing(r, answers, debug));
  r = cleanBullets(r, answers, debug);

  // 2. The one AI check, retried once if the call fails. It also checks every
  //    card rewritten in step 1 (those cards are not thin-card protected).
  const step1Rewritten = refs().filter((ref) => step1.entries.some((e) => e.result === "replaced" && e.card === label(r, ref)));
  const numbered = numberAll(r);
  const flagged = await withRetry(() => deps.factCheck(numbered.map(({ n, text, section }) => ({ n, text, section }))), debug.aiCheck);
  for (const e of step1.entries) if (e.result === "replaced") Object.assign(e, { factChecked: !!flagged, flagged: 0 });
  if (flagged) {
    const real = withoutClosings(numbered, flagged, debug);
    debug.aiCheck.flagged = real.length;
    for (const e of step1.entries) if (e.result === "replaced") e.flagged = flaggedOn(r, numbered, real, e.card);
    const applied = applyFlags(r, numbered, real, debug, step1Rewritten);
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
        const real = withoutClosings(x.card, x.flags, debug);
        debug.dangling.push({ card: label(r, x.ref), status: "ok", flagged: real.length });
        r = applyFlags(r, x.card, real, debug, step1Rewritten).report;
      }
    }
  }

  // A repeat rewrite left under 15 words is thrown away: the card goes back
  // to its version with the repeats deleted, and is checked again in step 5.
  const recheck: Ref[] = [];
  for (const e of repeatRewrites) {
    const ref = refs().find((x) => label(r, x) === e.card)!;
    if (e.result === "replaced" && wordsWithoutClosing(cardAt(r, ref)) < DISCARD_WORDS) {
      e.discarded = "rewrite discarded: under " + DISCARD_WORDS + " words after the fact check, put back the card with its repeats deleted";
      r = enforceClosings(withCard(r, ref, fallbackOf.get(e.card)!));
      recheck.push(ref);
    }
  }

  // 4. The code checks once more, deleting only.
  r = enforceClosings(deleteFailing(r, answers, debug));
  r = cleanBullets(r, answers, debug);

  // 5. A card left under 25 words is rewritten once, told what was deleted
  //    and why. Every card rewritten here, and every card put back above,
  //    gets the code checks and one more AI check, all in one call.
  const short = refs().filter((ref) => countWords(cardAt(r, ref)) < MIN_CARD_WORDS && !recheck.some((x) => x.s === ref.s && x.c === ref.c));
  const beforeShort = r;
  let shortEntries: CheckDebug["regenerated"] = [];
  if (short.length) {
    const shortJobs: Job[] = short.map((ref) => {
      const gone = debug.deleted.filter((d) => d.card === label(r, ref));
      const fixes = gone.length ? [CARD_FIX.afterDeletions, ...gone.map((d) => '"' + d.sentence + '" (' + d.reason + ")")] : [CARD_FIX.short];
      return { ref, fixes, kind: "short" };
    });
    const res = await regenerateAll(r, shortJobs, answers, deps, debug);
    shortEntries = res.entries;
    for (const e of shortEntries) if (e.result !== "replaced") e.discarded = "rewrite discarded: the rewrite call failed, kept the card as it was";
    r = enforceClosings(res.report);
  }
  const rewritten = short.filter((ref) => cardAt(r, ref) !== cardAt(beforeShort, ref));
  const again = [...rewritten, ...recheck];
  if (again.length) {
    r = enforceClosings(deleteFailing(r, answers, debug));
    debug.shortCheck = { status: "failed", attempts: 0, flagged: 0 };
    const nums = numberAll(r, again);
    const flags = await withRetry(() => deps.factCheck(nums.map(({ n, text, section }) => ({ n, text, section }))), debug.shortCheck);
    const real = flags ? withoutClosings(nums, flags, debug) : [];
    if (flags) {
      debug.shortCheck.flagged = real.length;
      r = applyFlags(r, nums, real, debug, rewritten).report;
    }
    for (const e of shortEntries) if (e.result === "replaced") Object.assign(e, { factChecked: !!flags, flagged: flaggedOn(r, nums, real, e.card) });
    for (const ref of recheck) {
      const e = repeatRewrites.find((x) => x.card === label(r, ref));
      if (e) e.discarded += flags ? " (that card was fact-checked again: " + flaggedOn(r, nums, real, e.card) + " flagged)" : " (the fact check on it failed)";
    }
    // A short rewrite left under 15 words is thrown away: the card goes back to how it was before the rewrite.
    for (const e of shortEntries) {
      const ref = short.find((x) => label(r, x) === e.card)!;
      if (e.result === "replaced" && wordsWithoutClosing(cardAt(r, ref)) < DISCARD_WORDS) {
        e.discarded = "rewrite discarded: under " + DISCARD_WORDS + " words after the fact check, put back the card as it was before the rewrite";
        r = enforceClosings(withCard(r, ref, cardAt(beforeShort, ref)));
      }
    }
    r = enforceClosings(deleteFailing(r, answers, debug));
  }

  r = { ...r, hidden_tie: replaceDashes(r.hidden_tie) };
  if (r.constraint) debug.constraint.text = r.constraint;
  if (r.belief) {
    debug.belief = {
      text: r.belief,
      inConstraint: containsBelief(r.constraint ?? "", r.belief),
      inDesign2: containsBelief(cardAt(r, DESIGN2_REF), r.belief),
    };
  }
  debug.shortCards = refs()
    .filter((ref) => countWords(cardAt(r, ref)) < MIN_CARD_WORDS)
    .map((ref) => label(r, ref));
  return { report: r, debug };
}

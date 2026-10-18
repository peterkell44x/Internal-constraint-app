// Fact safety for the Architect report: code checks, then one AI check.
//
// Code checks (deterministic): every number and quoted phrase must come from
// the answers, no banned wording, no sentence twice and no 8-word phrase in
// two cards. A card that fails is rewritten once; whatever still fails is
// deleted sentence by sentence. A card left under 40 words is rewritten once
// from the answers.
//
// AI check: one call (retried once if it fails) lists sentences that state
// something not in the answers; they are deleted, then the code checks run
// again, deleting only. No loops.
//
// The AI calls are passed in, so this module stays pure and testable.

import { BANNED_WORDING, CARD_FIX } from "./prompts.ts";
import type { ArchitectReport } from "./schema.ts";
import { bannedIn, countWords, removeSentences, repeatedSentences, sentencesOf, unsupportedItems } from "./text.ts";

export const MIN_CARD_WORDS = 40;

export interface CheckDeps {
  /** Rewrites one card; null if the call fails. */
  regenerate(section: number, card: number, fixes: string[], report: ArchitectReport): Promise<string | null>;
  /** The AI fact check: flagged sentence numbers. Throws if the call fails. */
  factCheck(numbered: { n: number; text: string }[]): Promise<{ n: number; reason: string }[]>;
}

export interface CheckDebug {
  regenerated: { card: string; reasons: string[]; result: "replaced" | "failed" }[];
  deleted: { card: string; sentence: string; reason: string; by: "code" | "ai" }[];
  aiCheck: { status: "ok" | "failed"; attempts: number; flagged: number; error?: string };
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

function withCard(r: ArchitectReport, ref: Ref, text: string): ArchitectReport {
  return {
    ...r,
    sections: r.sections.map((s, si) => (si !== ref.s ? s : { ...s, cards: s.cards.map((c, ci) => (ci === ref.c ? text : c)) })),
  };
}

/** What is wrong with one card, as fix instructions for a rewrite. Empty if nothing. */
export function cardIssues(r: ArchitectReport, ref: Ref, answers: string): string[] {
  const cards = flat(r);
  const i = ref.s * 3 + ref.c;
  const card = cards[i];
  const issues: string[] = [];
  const unsupported = unsupportedItems(card, answers);
  if (unsupported.length) issues.push(CARD_FIX.unsupported + " Not in their answers: " + unsupported.join(", ") + ".");
  const banned = bannedIn(card, BANNED_WORDING);
  if (banned.length) issues.push(CARD_FIX.banned + " Found: " + banned.join(", ") + ".");
  if (repeatedSentences(cards, i).length) issues.push(CARD_FIX.repeated);
  return issues;
}

/** Deletes, card by card in order, every sentence that still fails a code check. */
function deleteFailing(r: ArchitectReport, answers: string, debug: CheckDebug): ArchitectReport {
  let out = r;
  for (const ref of refs()) {
    const cards = flat(out);
    const i = ref.s * 3 + ref.c;
    const repeats = new Set(repeatedSentences(cards, i));
    const remove = new Map<string, string>();
    for (const s of sentencesOf(cards[i])) {
      const unsupported = unsupportedItems(s, answers);
      const banned = bannedIn(s, BANNED_WORDING);
      if (unsupported.length) remove.set(s, "not in their answers: " + unsupported.join(", "));
      else if (banned.length) remove.set(s, "banned wording: " + banned.join(", "));
      else if (repeats.has(s)) remove.set(s, "repeats an earlier card");
    }
    if (remove.size === 0) continue;
    for (const [sentence, reason] of remove) debug.deleted.push({ card: label(out, ref), sentence, reason, by: "code" });
    out = withCard(out, ref, removeSentences(cards[i], new Set(remove.keys())));
  }
  return out;
}

/** Rewrites the given cards once each, in parallel; keeps a rewrite only if the call returned one. */
async function regenerateAll(
  r: ArchitectReport,
  jobs: { ref: Ref; fixes: string[] }[],
  deps: CheckDeps,
  debug: CheckDebug,
): Promise<ArchitectReport> {
  const results = await Promise.all(jobs.map((j) => deps.regenerate(j.ref.s, j.ref.c, j.fixes, r).catch(() => null)));
  let out = r;
  jobs.forEach((j, k) => {
    const text = results[k];
    debug.regenerated.push({ card: label(r, j.ref), reasons: j.fixes, result: text ? "replaced" : "failed" });
    if (text) out = withCard(out, j.ref, text);
  });
  return out;
}

function deleteBullets(r: ArchitectReport, answers: string, debug: CheckDebug): ArchitectReport {
  const keep = (list: string[], name: string) =>
    list.filter((b) => {
      const bad = [...unsupportedItems(b, answers), ...bannedIn(b, BANNED_WORDING)];
      if (bad.length) debug.deleted.push({ card: name, sentence: b, reason: "not allowed: " + bad.join(", "), by: "code" });
      return bad.length === 0;
    });
  return { ...r, old_bullets: keep(r.old_bullets, "Old pattern bullets"), new_bullets: keep(r.new_bullets, "New pattern bullets") };
}

export async function checkArchitectReport(
  report: ArchitectReport,
  answers: string,
  deps: CheckDeps,
): Promise<{ report: ArchitectReport; debug: CheckDebug }> {
  const debug: CheckDebug = { regenerated: [], deleted: [], aiCheck: { status: "failed", attempts: 0, flagged: 0 }, shortCards: [] };
  let r = report;

  // 1. Code checks: rewrite each failing card once, then delete what still fails.
  const failing = refs().map((ref) => ({ ref, fixes: cardIssues(r, ref, answers) })).filter((j) => j.fixes.length > 0);
  if (failing.length) r = await regenerateAll(r, failing, deps, debug);
  r = deleteFailing(r, answers, debug);

  // 2. A card left too short is rewritten once from the answers, then checked again.
  const short = refs().filter((ref) => countWords(r.sections[ref.s].cards[ref.c]) < MIN_CARD_WORDS);
  if (short.length) {
    r = await regenerateAll(r, short.map((ref) => ({ ref, fixes: [CARD_FIX.short] })), deps, debug);
    r = deleteFailing(r, answers, debug);
  }
  r = deleteBullets(r, answers, debug);

  // 3. The one AI check, retried once if the call fails. Flagged sentences are deleted.
  const numbered: { n: number; text: string; ref: Ref | "old" | "new" }[] = [];
  for (const ref of refs()) for (const t of sentencesOf(r.sections[ref.s].cards[ref.c])) numbered.push({ n: numbered.length + 1, text: t, ref });
  for (const b of r.old_bullets) numbered.push({ n: numbered.length + 1, text: b, ref: "old" });
  for (const b of r.new_bullets) numbered.push({ n: numbered.length + 1, text: b, ref: "new" });
  let flagged: { n: number; reason: string }[] | null = null;
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
      if (item.ref === "old" || item.ref === "new") {
        const key = item.ref === "old" ? "old_bullets" : "new_bullets";
        r = { ...r, [key]: r[key].filter((b) => b !== item.text) };
        debug.deleted.push({ card: item.ref === "old" ? "Old pattern bullets" : "New pattern bullets", sentence: item.text, reason: f.reason, by: "ai" });
      } else {
        const ref = item.ref;
        r = withCard(r, ref, removeSentences(r.sections[ref.s].cards[ref.c], new Set([item.text])));
        debug.deleted.push({ card: label(r, ref), sentence: item.text, reason: f.reason, by: "ai" });
      }
    }
  }

  // 4. The code checks once more, deleting only. No more AI calls.
  r = deleteFailing(r, answers, debug);
  r = deleteBullets(r, answers, debug);
  debug.shortCards = refs()
    .filter((ref) => countWords(r.sections[ref.s].cards[ref.c]) < MIN_CARD_WORDS)
    .map((ref) => label(r, ref));
  return { report: r, debug };
}

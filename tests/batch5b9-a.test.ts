// Batch 5b-9, item A: more keep-phrases; an entry whose note says to keep the
// sentence never deletes or edits it and is not counted as flagged.

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkArchitectReport, type CheckDeps } from "../src/lib/diagnostic/v2/checks.ts";
import { FACT_CHECK_KEEP_PHRASES, SECTION_NAMES, UI_TEXT } from "../src/lib/diagnostic/v2/prompts.ts";
import { parseReport, type ArchitectReport, type FactFlag } from "../src/lib/diagnostic/v2/schema.ts";
import { keepPhraseIn, reportDisplay } from "../src/lib/diagnostic/v2/text.ts";

function card(tag: number): string {
  const word = (k: number) => "z" + String.fromCharCode(97 + tag) + String.fromCharCode(97 + (k % 26)) + String.fromCharCode(97 + Math.floor(k / 26));
  return Array.from({ length: 5 }, (_, s) => "You " + Array.from({ length: 12 }, (_, w) => word(s * 12 + w)).join(" ") + ".").join(" ");
}

function report(overrides: Record<number, string> = {}): ArchitectReport {
  return {
    hidden_tie: "You say you want money. But underneath, money means a tense home.",
    sections: SECTION_NAMES.map((name, s) => ({ name, cards: [0, 1, 2].map((c) => overrides[s * 3 + c] ?? card(s * 3 + c)) })),
    old_bullets: ["Hiding statements from yourself", "Stopping when it gets tense", "Waiting for a better month"],
    new_bullets: ["Looking at money weekly", "Staying in it when tense", "Treating setbacks as interruptions"],
  };
}

const ANSWERS = "I grew up in Leeds with 3 kids in the house. I want 5k saved.";
const NEW = [
  "no fix needed", "no fix required", "no change needed", "no change required", "no edit needed", "no edit required", "nothing to fix",
  "nothing needs to change", "does not need to be changed", "does not need a fix", "no problem here", "this is fine", "is fine as written",
  "can stay", "should stay", "should be kept", "leave it as is", "leave as is", "unchanged",
];

async function run(r: ArchitectReport, entries: (numbered: { n: number; text: string }[]) => FactFlag[]) {
  const deps: CheckDeps = {
    regenerate: async (s, c, _f, current) => current.sections[s].cards[c],
    factCheck: async (numbered) => entries(numbered),
  };
  return checkArchitectReport(r, ANSWERS, deps);
}

const TARGET = card(2).split(". ")[2] + ".";
const NOTE = "Actually sentence 3 refers to 'that sense' from sentence 2 which is still present, no fix needed.";

test("5b-9 A: a 'no fix needed' entry is ignored, for a DELETE and for an EDIT that changes words", async () => {
  for (const f of [
    (n: number): FactFlag => ({ n, verdict: "DELETE", edit: "", reason: "Refers back to something", raw: NOTE }),
    (n: number): FactFlag => ({ n, verdict: "EDIT", edit: "Something completely different.", reason: "Refers back to something", raw: NOTE }),
  ]) {
    const out = await run(report(), (numbered) => [f(numbered.find((x) => x.text === TARGET)!.n)]);
    assert.equal(out.report.sections[0].cards[2], card(2), "the sentence survives unchanged");
    assert.equal(out.debug.aiCheck.flagged, 0, "not counted as flagged");
    assert.deepEqual(out.debug.ignored, [{ card: "Where it started, card 3", sentence: TARGET, reason: "Refers back to something", note: NOTE, keepPhrase: "no fix needed" }]);
    assert.ok(!out.debug.deleted.some((x) => x.sentence === TARGET) && out.debug.edited.length === 0);
  }
});

test("5b-9 A: a normal reason is still deleted", async () => {
  const out = await run(report(), (numbered) => [
    { n: numbered.find((x) => x.text === TARGET)!.n, verdict: "DELETE", edit: "", reason: "Abstract aphorism with no concrete claim", raw: "Abstract aphorism with no concrete claim" },
  ]);
  assert.ok(!out.report.sections[0].cards[2].includes(TARGET));
  assert.equal(out.debug.aiCheck.flagged, 1);
});

test("5b-9 A: every new phrase is on the list and matches after normalising", () => {
  for (const p of NEW) {
    assert.ok(FACT_CHECK_KEEP_PHRASES.includes(p), p);
    assert.ok(keepPhraseIn("Looked again. " + p.toUpperCase().replace(/ /g, "  ") + "!", FACT_CHECK_KEEP_PHRASES), p);
  }
  // The earlier phrases are still there.
  for (const p of ["rescind", "no flag needed", "is fine", "is fine on its own", "keeping as-is", "keep as is", "no change needed"]) assert.ok(FACT_CHECK_KEEP_PHRASES.includes(p), p);
});

test("5b-9 A: bullets are still kept by the bullet rule, and an old saved report renders as before", async () => {
  const r = report();
  const out = await run(r, (numbered) => [{ n: numbered.find((x) => x.text === r.new_bullets[0])!.n, verdict: "DELETE", edit: "", reason: "Vague", raw: "Vague, no fix needed" }]);
  assert.deepEqual(out.report.new_bullets, r.new_bullets);
  assert.equal(out.debug.bulletKept!.length, 1);
  const shown = reportDisplay(parseReport(JSON.stringify(r), SECTION_NAMES)!.sections, SECTION_NAMES, UI_TEXT.oldPattern, UI_TEXT.newPattern);
  assert.deepEqual(shown.sections.map((s) => s.cards), r.sections.map((s) => s.cards));
});

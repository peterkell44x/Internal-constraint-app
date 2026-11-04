// Batch 5b-8, item D: an AI check edit that removes "belief" becomes a delete;
// a rule keeps "the belief" / "that belief" out of the early sections.

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkArchitectReport, type CheckDeps } from "../src/lib/diagnostic/v2/checks.ts";
import { buildReportSystem, CARD_REGEN_SYSTEM, SECTION_NAMES, UI_TEXT } from "../src/lib/diagnostic/v2/prompts.ts";
import { parseReport, type ArchitectReport, type FactFlag } from "../src/lib/diagnostic/v2/schema.ts";
import { reportDisplay } from "../src/lib/diagnostic/v2/text.ts";

function card(tag: number): string {
  const word = (k: number) => "z" + String.fromCharCode(97 + tag) + String.fromCharCode(97 + (k % 26)) + String.fromCharCode(97 + Math.floor(k / 26));
  return Array.from({ length: 5 }, (_, s) => "You " + Array.from({ length: 12 }, (_, w) => word(s * 12 + w)).join(" ") + ".").join(" ");
}

function report(overrides: Record<number, string> = {}): ArchitectReport {
  return {
    hidden_tie: "You say you want love. But underneath, love means a tense home.",
    sections: SECTION_NAMES.map((name, s) => ({ name, cards: [0, 1, 2].map((c) => overrides[s * 3 + c] ?? card(s * 3 + c)) })),
    old_bullets: ["Hiding what you feel", "Stopping when it gets tense", "Waiting for a better month"],
    new_bullets: ["Saying what you feel", "Staying in it when tense", "Treating setbacks as interruptions"],
  };
}

const ANSWERS = "I grew up in Leeds with 3 kids in the house. My parents fought every night.";
const flag = (n: number, verdict: "DELETE" | "EDIT", reason: string, edit = ""): FactFlag => ({ n, verdict, edit, reason, raw: reason });

function run(r: ArchitectReport, entry: (numbered: { n: number; text: string }[]) => FactFlag[]) {
  let dangling = 0;
  const deps: CheckDeps = {
    regenerate: async (s, c, _f, current) => current.sections[s].cards[c],
    factCheck: async (numbered) => entry(numbered),
    danglingCheck: async () => {
      dangling++;
      return [];
    },
  };
  return checkArchitectReport(r, ANSWERS, deps).then((out) => ({ out, dangling }));
}

const BROKEN = "It is not the situation that shifts your confidence, it is what that belief tells you the situation means.";
const CUT = "It is not the situation that shifts your confidence, it is what that tells you the situation means.";

test("5b-8 D: an edit whose change removes 'belief' deletes the sentence instead", async () => {
  const { out, dangling } = await run(report({ 4: card(4) + " " + BROKEN }), (numbered) => [
    flag(numbered.find((x) => x.text === BROKEN)!.n, "EDIT", "Refers to a belief not yet stated.", CUT),
  ]);
  assert.equal(out.report.sections[1].cards[1], card(4), "deleted, not edited");
  assert.ok(!out.report.sections[1].cards[1].includes(CUT));
  assert.equal(out.debug.edited.length, 0);
  const d = out.debug.deleted.find((x) => x.sentence === BROKEN)!;
  assert.equal(d.by, "ai");
  assert.match(d.reason, /removed the word 'belief', so the sentence was deleted/);
  assert.equal(dangling, 1, "like any AI-check deletion, the card gets the per-card check");
});

test("5b-8 D: other edits are applied as before; refused idiom edits stay refused", async () => {
  const other = "It is not the situation that shifts your confidence, it is what you think the situation means.";
  const { out } = await run(report({ 4: card(4) + " " + other }), (numbered) => [
    flag(numbered.find((x) => x.text === other)!.n, "EDIT", "Overstates.", "It is what you think the situation means."),
  ]);
  assert.ok(out.report.sections[1].cards[1].endsWith("It is what you think the situation means."));
  assert.equal(out.debug.edited.length, 1);

  const idiom = "It feels like the peace you are building toward has been pulled back.";
  const { out: out2 } = await run(report({ 7: card(7) + " " + idiom }), (numbered) => [
    flag(numbered.find((x) => x.text === idiom)!.n, "EDIT", "Stock idiom.", "It feels like the peace you are building toward has slipped."),
  ]);
  assert.ok(out2.report.sections[2].cards[1].endsWith(idiom));
  assert.equal(out2.debug.idiomKept!.length, 1);
});

test("5b-8 D: on a thin card the sentence is kept as it was, never given the broken edit", async () => {
  const thin = card(4).split(". ")[0] + ". " + BROKEN;
  const { out } = await run(report({ 4: thin }), (numbered) => [
    flag(numbered.find((x) => x.text === BROKEN)!.n, "EDIT", "Refers to a belief not yet stated.", CUT),
  ]);
  assert.equal(out.report.sections[1].cards[1], thin);
  assert.match(out.debug.keptShort![0].reason, /kept, card would drop under 25 words/);
});

test("5b-8 D: the rule against 'the belief' in the early sections is in the report and rewrite instructions", () => {
  const rule = "In Where it started and Life by default, do not write 'the belief' or 'that belief'; say what they expect or assume instead.";
  assert.ok(buildReportSystem().includes("\n- " + rule + "\n"));
  assert.ok(CARD_REGEN_SYSTEM.includes("\n\n" + rule + "\n\n"));
});

test("5b-8 D: an old saved report renders as before", () => {
  const old = report({ 4: card(4) + " " + BROKEN });
  const shown = reportDisplay(parseReport(JSON.stringify(old), SECTION_NAMES)!.sections, SECTION_NAMES, UI_TEXT.oldPattern, UI_TEXT.newPattern);
  assert.equal(shown.sections[1].cards[1], card(4) + " " + BROKEN);
});

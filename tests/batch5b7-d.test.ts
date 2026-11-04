// Batch 5b-7, item D: "Move as if [the new belief] is already true, starting
// today." replaces "Act as if [the new belief], even before you feel ready."

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkArchitectReport, type CheckDeps } from "../src/lib/diagnostic/v2/checks.ts";
import {
  buildReportSystem,
  CARD_REGEN_SYSTEM,
  CARD_ROLES,
  DANGLING_CHECK_SYSTEM,
  DESIGN_CLOSING,
  FACT_CHECK_SYSTEM,
  REACTION_SYSTEM,
  SECTION_NAMES,
  UI_TEXT,
} from "../src/lib/diagnostic/v2/prompts.ts";
import { parseReport, type ArchitectReport, type FactFlag } from "../src/lib/diagnostic/v2/schema.ts";
import { reportDisplay } from "../src/lib/diagnostic/v2/text.ts";

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
const BELIEF = "money only comes with a fight when you need it most";
const CONSTRAINT = "Your internal constraint is the belief that " + BELIEF + ", and it is what stands between you and 5k saved.";
const STOP = "Stop letting " + BELIEF + " decide what you do today.";
const MOVE = "Move as if money can come to you in calm and steady ways is already true, starting today.";

test("5b-7 D: the instructions use the new sentence and never the old one", () => {
  const shape = '"Move as if [the new belief] is already true, starting today."';
  const d2 = "Word the new belief inside this sentence so the whole sentence reads naturally.";
  const sys = buildReportSystem();
  assert.ok(sys.includes('"Stop letting [the belief] decide what you do today." and ' + shape + " " + d2 + " Each sentence is under 25 words"));
  assert.ok(CARD_ROLES[3][2].includes(shape + " " + d2 + " "));
  assert.ok(CARD_REGEN_SYSTEM.includes('"Stop letting [the belief] decide what you do today." and ' + shape));
  for (const text of [sys, CARD_REGEN_SYSTEM, JSON.stringify(CARD_ROLES), FACT_CHECK_SYSTEM, DANGLING_CHECK_SYSTEM, REACTION_SYSTEM]) {
    assert.ok(!/act as if|even before you feel ready/i.test(text));
  }
});

test("5b-7 D: the new sentence gets the old sentence's protection; no code check flags 'starting today'", async () => {
  const calls: number[] = [];
  const flagged: string[] = [];
  const deps: CheckDeps = {
    regenerate: async (s, c, _f, current) => {
      calls.push(s * 3 + c);
      return current.sections[s].cards[c];
    },
    factCheck: async (numbered): Promise<FactFlag[]> => {
      flagged.push(...numbered.map((x) => x.text));
      return [];
    },
  };
  // MOVE is also copied into an earlier card, and STOP shares 8+ words with the constraint.
  const r = { ...report({ 11: card(11) + " " + STOP + " " + MOVE, 8: card(8) + " " + MOVE }), belief: BELIEF, constraint: CONSTRAINT };
  const out = await checkArchitectReport(r, ANSWERS + " 5k", deps);
  const c3 = out.report.sections[3].cards[2];
  assert.equal(c3, card(11) + " " + STOP + " " + MOVE + " " + DESIGN_CLOSING, "both kept, card not rewritten");
  assert.ok(!calls.includes(11));
  assert.ok(flagged.includes(MOVE), "it goes to the AI check like any sentence");
  assert.ok(!out.debug.deleted.some((x) => x.sentence === MOVE && x.card.startsWith("Life by design")));
  assert.ok(!out.debug.fired.some((f) => f.startsWith("Life by design, card 3")), "no code check fired on Design card 3");
});

test("5b-7 D: an old saved report with 'Act as if' still shows it exactly as before", () => {
  const old = report({ 11: card(11) + " Act as if money can come in calm ways, even before you feel ready." });
  const shown = reportDisplay(parseReport(JSON.stringify(old), SECTION_NAMES)!.sections, SECTION_NAMES, UI_TEXT.oldPattern, UI_TEXT.newPattern);
  assert.equal(shown.sections[3].cards[2], card(11) + " Act as if money can come in calm ways, even before you feel ready.");
});

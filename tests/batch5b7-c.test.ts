// Batch 5b-7, item C: Uncovered internal constraint card 1 opens by stating
// the block in plain words; card 2 does not repeat that sentence.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem, CARD_ROLES } from "../src/lib/diagnostic/v2/prompts.ts";

const C1 =
  "The first sentence of this card states, in plain words taken from their answers, what part of them has tied to what (the pattern the hidden tie describes). Do not use the belief's exact words in that sentence. After it, continue with the most emotional experience from answer 5 and their strongest line, as before.";
const C2 = "Do not repeat the first sentence of the previous card in the same words.";

test("5b-7 C (instruction only): card 1 states the block first, card 2 does not repeat it, in the report and rewrite descriptions", () => {
  const sys = buildReportSystem();
  const section = sys.slice(sys.indexOf('(2) "Uncovered internal constraint":'), sys.indexOf('(3) "Life by default":'));
  assert.ok(section.includes("quote their strongest line. " + C1), "card 1, report");
  assert.ok(section.includes("This is the most important card. " + C2 + " Card 3 is "), "card 2, report");
  assert.ok(CARD_ROLES[1][0].includes("their strongest line quoted. " + C1), "card 1, rewrite");
  assert.ok(CARD_ROLES[1][1].endsWith("One soft word allowed. " + C2), "card 2, rewrite");
  assert.equal(sys.split(C1).length, 2);
  assert.equal(sys.split(C2).length, 2);
});

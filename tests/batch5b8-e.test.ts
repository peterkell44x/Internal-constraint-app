// Batch 5b-8, item E: Design card 3 keeps both ends of the "Move as if" sentence.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem, CARD_ROLES } from "../src/lib/diagnostic/v2/prompts.ts";

const E = "Only the new belief inside that sentence may be reworded or shortened. The words 'Move as if' at the start and 'is already true, starting today' at the end stay exactly as written.";
const D57 = '"Move as if [the new belief] is already true, starting today." Word the new belief inside this sentence so the whole sentence reads naturally.';

test("5b-8 E (instruction only): the new sentence sits next to the 'Move as if' line, which is unchanged", () => {
  const sys = buildReportSystem();
  assert.ok(sys.includes(D57 + " Each sentence is under 25 words"), "the 5b-7 D wording is unchanged");
  assert.ok(sys.includes('no "this week".\n' + E + "\nFinal screen:"), "its own line, right after Design card 3");
  assert.ok(CARD_ROLES[3][2].includes(D57 + " " + E + " (each under 25 words"), "next to it in the rewrite description");
});

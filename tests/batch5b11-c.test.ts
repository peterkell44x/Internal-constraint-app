// Batch 5b-11, item C: the word "vision".

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem, CARD_REGEN_SYSTEM } from "../src/lib/diagnostic/v2/prompts.ts";

const C =
  "When you refer to what the person is working toward, their target or their goal, call it their 'vision' where it reads naturally. Do not rename their business or their job, and do not change their own words or numbers.";

test("5b-11 C (instruction only): the 'vision' sentence is in the CARDS section and the rewrite instructions", () => {
  const sys = buildReportSystem();
  assert.ok(sys.indexOf("CARDS (3 per section") < sys.indexOf(C) && sys.indexOf(C) < sys.indexOf("\n(1) "));
  assert.ok(sys.includes("\n" + C + "\n"));
  assert.ok(CARD_REGEN_SYSTEM.includes("\n\n" + C + "\n\n"));
  assert.equal(sys.split(C).length, 2);
  // The hidden tie and constraint templates are unchanged.
  assert.ok(sys.includes('"You say you want [goal]. But underneath, part of you has tied [goal] to [meaning]'));
  assert.ok(sys.includes("and it is what stands between you and [their goal from answer 7]."));
});

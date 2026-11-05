// Batch 5b-8, item F: a quiet self-check before the report is returned.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem, CARD_REGEN_SYSTEM } from "../src/lib/diagnostic/v2/prompts.ts";

const F =
  "Before you return the report, read each card once and rewrite any sentence that gives their behavior a name of your own, states a feeling they did not say they had, or does not follow from the sentence before it.";

test("5b-8 F (instruction only): the self-check sentence ends the CARDS section and is in the rewrite instructions", () => {
  const sys = buildReportSystem();
  assert.ok(sys.includes("\n" + F + "\n\nReturn only JSON:"), "the last line of the CARDS section");
  assert.ok(CARD_REGEN_SYSTEM.includes("\n\n" + F + '\n\nReturn only JSON: {"card": "..."}'));
  assert.equal(sys.split(F).length, 2);
});

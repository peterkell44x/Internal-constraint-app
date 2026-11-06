// Batch 5b-8, item A: no names of your own for their behavior, no unexplained causes.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem, CARD_REGEN_SYSTEM } from "../src/lib/diagnostic/v2/prompts.ts";

const A =
  "Describe what they do in plain verbs, in the words they used. Do not give their behavior or the pattern a name of your own, including a verb turned into a noun with 'the' in front of it. If you explain why they do something or why something changed, use only what they said; when you go beyond it, write 'likely' or 'may'.";

test("5b-8 A (instruction only): the paragraph is right after the card-opening rule, and in the rewrite instructions", () => {
  const sys = buildReportSystem();
  assert.ok(sys.includes("Do not open a card with a lead-in, a scene or background that comes before the point.\n" + A + "\n"));
  assert.ok(sys.indexOf(A) < sys.indexOf("\n(1) "), "before the per-section descriptions");
  assert.ok(CARD_REGEN_SYSTEM.includes("\n\n" + A + "\n\n"));
  // The hidden tie instructions are unchanged.
  assert.ok(sys.includes('"You say you want [goal]. But underneath, part of you has tied [goal] to [meaning], because [what they heard, saw or lived]. So when [situation], you [what they do], and that looks like [their stated problem]."'));
  assert.equal(sys.split(A).length, 2);
});

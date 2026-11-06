// Batch 5b-10, item B: Money questions end with "The more detail, the better."

import assert from "node:assert/strict";
import { test } from "node:test";

import { QUESTIONS } from "../src/lib/diagnostic/v2/prompts.ts";

test("5b-10 B: all eight Money questions end with the new closing line; the rest of each question is unchanged", () => {
  assert.equal(QUESTIONS.money.length, 8);
  for (const q of QUESTIONS.money) {
    assert.ok(q.endsWith("? The more detail, the better.") || q.endsWith(". The more detail, the better."), q);
    assert.ok(!q.includes("As much detail as you can give me."), q);
  }
  for (const d of ["relationships", "fitness", "happiness"] as const) {
    for (const q of QUESTIONS[d]) assert.ok(q.endsWith(" As much detail as you can give me."), d);
  }
});

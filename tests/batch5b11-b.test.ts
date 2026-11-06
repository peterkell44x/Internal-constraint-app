// Batch 5b-11, item B: Money question 6 hint.

import assert from "node:assert/strict";
import { test } from "node:test";

import { transcript, emptyFlow, withAnswer, withReaction, type Flow } from "../src/lib/diagnostic/v2/flow.ts";
import { QUESTION_HINTS, QUESTIONS } from "../src/lib/diagnostic/v2/prompts.ts";

test("5b-11 B: the Money chat shows the new question 6 hint; other domains keep the old one", () => {
  const hint = "Think about what you actually do, think and tell yourself, even if it's not what you wish you did.";
  assert.equal(QUESTION_HINTS.money[5], hint);
  let f: Flow = emptyFlow();
  for (let i = 1; i <= 8; i++) f = withReaction(withAnswer(f, "Answer " + i), { step: i, text: "Reaction " + i + ".", crisis: false });
  const shown = transcript(f, QUESTIONS.money, QUESTION_HINTS.money).filter((b) => b.kind === "question");
  assert.equal(shown[5].kind === "question" && shown[5].hint, hint);
  for (const d of ["relationships", "fitness", "happiness"] as const) {
    assert.equal(QUESTION_HINTS[d][5], "Think about what you actually do, even if it's not what you wish you did.", d);
  }
});

// Batch 5b-11, item A: Money question 2 hint.

import assert from "node:assert/strict";
import { test } from "node:test";

import { transcript, emptyFlow, withAnswer, withReaction, type Flow } from "../src/lib/diagnostic/v2/flow.ts";
import { QUESTION_HINTS, QUESTIONS } from "../src/lib/diagnostic/v2/prompts.ts";

test("5b-11 A: the Money chat shows the new question 2 hint; other domains keep the old one", () => {
  assert.equal(QUESTION_HINTS.money[1], "Think about what they said, what they did, and how they handled money.");
  let f: Flow = emptyFlow();
  for (let i = 1; i <= 8; i++) f = withReaction(withAnswer(f, "Answer " + i), { step: i, text: "Reaction " + i + ".", crisis: false });
  const shown = transcript(f, QUESTIONS.money, QUESTION_HINTS.money).filter((b) => b.kind === "question");
  assert.equal(shown[1].kind === "question" && shown[1].hint, "Think about what they said, what they did, and how they handled money.");
  for (const d of ["relationships", "fitness", "happiness"] as const) {
    assert.equal(QUESTION_HINTS[d][1], "Think about what they said, what they did, and how their life looked from the outside.", d);
  }
});

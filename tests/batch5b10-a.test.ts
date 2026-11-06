// Batch 5b-10, item A: new wording for Money questions 2, 4, 5, 6 and 7.

import assert from "node:assert/strict";
import { test } from "node:test";

import { transcript, emptyFlow, withAnswer, withReaction, type Flow } from "../src/lib/diagnostic/v2/flow.ts";
import { QUESTION_HINTS, QUESTIONS } from "../src/lib/diagnostic/v2/prompts.ts";


test("5b-10 A: Money questions 2, 4, 5, 6 and 7 have the new wording; 1, 3 and 8 and every hint are unchanged", () => {
  const q = QUESTIONS.money;
  assert.ok(q[1].startsWith("As a kid, who influenced you the most when it came to money? What was their relationship with money like? "));
  assert.ok(q[3].startsWith("Think of a moment when money was really flowing for you. What were you doing, and what changed afterward? "));
  assert.ok(q[4].startsWith("Looking back, which moments around money hurt the most, stressed you out the most, or felt the most emotional? Something you lived through or watched someone else go through. "));
  assert.ok(q[5].startsWith("When a money plan falls apart or money gets tight, what do you do, think, and tell yourself? "));
  assert.ok(q[6].startsWith("What's your vision? Using numbers, where do you want to be financially in 6 months, 12 months, or beyond? "));
  assert.ok(q[0].startsWith("Let's start at the beginning. Where did you grow up, who was around you, and what was life like with money back then? "));
  assert.ok(q[2].startsWith("What does your life with money look like right now, day to day? Be as honest as you can. "));
  assert.ok(q[7].startsWith("Picture the version of you who already has that. How do they act, how do they carry themselves, and how do they think? "));
  assert.deepEqual(QUESTION_HINTS.money, [
    "Think about the home, the people around you, the mood, and what was said about money.",
    "Think about what they said, what they did, and how they handled money.",
    "Think about a normal week. What you do, feel, and tell yourself.",
    "Think about what you were doing, how it felt, and what changed after.",
    "Something you lived or something you watched. Who was there, what happened, how it felt.",
    "Think about what you actually do, even if it's not what you wish you did.",
    "Real numbers are best. Also say how it would feel and how you would see money by then.",
    "Think about how they talk, how they walk into a room, and how they handle a bad day. Also their beliefs, expectations, feelings, reactions, what they pay attention to, and what they think about. Then begin to embody that now.",
  ]);
});

test("5b-10 A: the Money chat shows the eight questions in order with the hints", () => {
  let f: Flow = emptyFlow();
  for (let i = 1; i <= 8; i++) f = withReaction(withAnswer(f, "Answer " + i), { step: i, text: "Reaction " + i + ".", crisis: false });
  const qs = transcript(f, QUESTIONS.money, QUESTION_HINTS.money).filter((b) => b.kind === "question");
  assert.deepEqual(qs.map((b) => (b.kind === "question" ? [b.text, b.hint] : null)), QUESTIONS.money.map((q, i) => [q, QUESTION_HINTS.money[i]]));
});

test("5b-10 A: the other domains' questions are untouched", () => {
  assert.ok(QUESTIONS.relationships[1].startsWith("Growing up, who did you look up to most? What was their relationship like?"));
  assert.ok(QUESTIONS.fitness[6].startsWith("Paint the picture."));
  assert.ok(QUESTIONS.happiness[5].startsWith("What do you do when life feels overwhelming or out of control?"));
});

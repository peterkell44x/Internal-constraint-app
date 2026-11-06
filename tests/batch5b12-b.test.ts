// Batch 5b-12, item B: the abstract bullet example is gone.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem, CARD_REGEN_SYSTEM, CARD_ROLES, FACT_CHECK_SYSTEM, DANGLING_CHECK_SYSTEM, REACTION_SYSTEM } from "../src/lib/diagnostic/v2/prompts.ts";

test("5b-12 B (instruction only): the bullet example is gone everywhere; the other bullet rules are unchanged", () => {
  const sys = buildReportSystem();
  for (const t of [sys, CARD_REGEN_SYSTEM, JSON.stringify(CARD_ROLES), FACT_CHECK_SYSTEM, DANGLING_CHECK_SYSTEM, REACTION_SYSTEM]) {
    assert.ok(!t.includes("Treating setbacks as interruptions"));
  }
  assert.ok(
    sys.includes(
      'Final screen: 3 bullets for "Life by default" and 3 for "Life by design", each at most 9 words. They are short phrases about how they act or how they see things, built from their own facts. Never tasks, instructions or advice.\n' +
        "Each bullet must describe something a person could picture someone doing or seeing, using a thing, amount, person or place the person named in their answers. Do not use an abstract noun as if it were a place or an object. If a bullet could not be acted out or filmed, rewrite it.\n" +
        "Life By Default bullets are only things the person said they do or live. One event is not a habit. Life By Design bullets are the new way of acting or seeing that the person is moving toward. Never put in Life By Design something the person already does or said they already do.\n",
    ),
  );
});

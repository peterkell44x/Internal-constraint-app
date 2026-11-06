// Batch 5b-11, item D: bullets true to the person.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem } from "../src/lib/diagnostic/v2/prompts.ts";

const D =
  "Life By Default bullets are only things the person said they do or live. One event is not a habit. Life By Design bullets are the new way of acting or seeing that the person is moving toward. Never put in Life By Design something the person already does or said they already do.";

test("5b-11 D (instruction only): the sentence follows the bullet instructions, which are unchanged", () => {
  const sys = buildReportSystem();
  assert.ok(
    sys.includes(
      'Final screen: 3 bullets for "Life by default" and 3 for "Life by design", each at most 9 words. They are short phrases about how they act or how they see things, built from their own facts. Never tasks, instructions or advice.\nEach bullet must describe something a person could picture someone doing or seeing, using a thing, amount, person or place the person named in their answers. Do not use an abstract noun as if it were a place or an object. If a bullet could not be acted out or filmed, rewrite it.\n' +
        D + "\n",
    ),
  );
  assert.equal(sys.split(D).length, 2);
});

// Batch 5b-9, item B: bullets must be concrete.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem, CARD_REGEN_SYSTEM, CARD_ROLES } from "../src/lib/diagnostic/v2/prompts.ts";

const B =
  "Each bullet must describe something a person could picture someone doing or seeing, using a thing, amount, person or place the person named in their answers. Do not use an abstract noun as if it were a place or an object. If a bullet could not be acted out or filmed, rewrite it.";

test("5b-9 B (instruction only): the bullet rule follows the bullet instructions, which are unchanged", () => {
  const sys = buildReportSystem();
  assert.ok(
    sys.includes(
      'Final screen: 3 bullets for "Life by default" and 3 for "Life by design", each at most 9 words. They are short phrases about how they act or how they see things, built from their own facts. Never tasks, instructions or advice.\n' + B + "\n",
    ),
  );
  assert.equal(sys.split(B).length, 2);
  // No rewrite instruction describes bullets.
  assert.ok(!/bullet/i.test(CARD_REGEN_SYSTEM.replace("in any card or bullet", "") + JSON.stringify(CARD_ROLES)));
});

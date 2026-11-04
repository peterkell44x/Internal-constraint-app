// Batch 5b-8, item C: Uncovered card 3 keeps a linking sentence.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem, CARD_ROLES } from "../src/lib/diagnostic/v2/prompts.ts";

test("5b-8 C (instruction only): card 3 has a linking sentence before the section point, in the report and rewrite descriptions", () => {
  const sys = buildReportSystem();
  assert.ok(
    sys.includes(
      'Card 3 is how they react when things go wrong (answer 6), using BOTH halves of that answer if it has two (for example what they do when it is really bad and when it slips a little), then ONE plain sentence that links that reaction to the pattern in the hidden tie, using only what they said (this sentence stays in the card), then the section point. The code replaces that section point with your "constraint" sentence. Do not use the linking sentence as the section point.\n(3) ',
    ),
  );
  assert.equal(
    CARD_ROLES[1][2],
    "How they react when things go wrong (answer 6), using both halves of that answer if it has two. Before that, one plain sentence links their reaction to the hidden tie, using only what they said. Do not end with a section point: the code adds the constraint sentence as the last sentence.",
  );
});

// Batch 5b-9, item C: the debug view lists the sections of a report attempt
// rejected for having the wrong number of sections.

import assert from "node:assert/strict";
import { test } from "node:test";

import { SECTION_NAMES } from "../src/lib/diagnostic/v2/prompts.ts";
import { parseReport, reportShapeError, sectionSummary, shapeProblem } from "../src/lib/diagnostic/v2/schema.ts";

const cards = (n: number) => Array.from({ length: n }, (_, i) => "Card " + (i + 1) + " text.");
const base = {
  hidden_tie: "You say you want money.",
  old_bullets: ["a", "b", "c"],
  new_bullets: ["d", "e", "f"],
};

test("5b-9 C: a 6-section attempt shows its 6 names and card counts", () => {
  const names = ["Where it started", "Uncovered internal constraint", "Life by default", "Life by design", "Old pattern", "New pattern"];
  const reply = JSON.stringify({ ...base, sections: names.map((name, i) => ({ name, cards: cards(i < 4 ? 3 : 1) })) });
  assert.equal(parseReport(reply, SECTION_NAMES), null, "still rejected, so the retry runs as before");
  assert.equal(
    shapeProblem(1, reply),
    'attempt 1: reply did not match the report shape: ' + reportShapeError(reply) +
      '. Sections in this attempt: 6 sections: 1. "Where it started" (3 cards); 2. "Uncovered internal constraint" (3 cards); 3. "Life by default" (3 cards); 4. "Life by design" (3 cards); 5. "Old pattern" (1 card); 6. "New pattern" (1 card)',
  );
  // Missing names and card lists are shown as such.
  assert.equal(sectionSummary(JSON.stringify({ ...base, sections: [{}, { name: "X", cards: [] }] })), '2 sections: 1. (no name) (no cards list); 2. "X" (0 cards)');
});

test("5b-9 C: a 4-section attempt adds nothing new", () => {
  const four = JSON.stringify({ ...base, hidden_tie: "", sections: SECTION_NAMES.map((name) => ({ name, cards: cards(3) })) });
  assert.equal(sectionSummary(four), null);
  assert.equal(shapeProblem(2, four), "attempt 2: reply did not match the report shape: " + reportShapeError(four));
  assert.equal(sectionSummary("not json"), null);
});

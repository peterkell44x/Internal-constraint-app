import assert from "node:assert/strict";
import { test } from "node:test";

import { DOMAINS } from "../src/lib/diagnostic/domains.ts";
import {
  buildReviewInput,
  buildReviewSystem,
  countWords,
  formatTranscript,
  isOverLimits,
  isWellFormed,
} from "../src/lib/diagnostic/review.ts";

const good = "Story here.\n[SPLIT]\nYour subconscious internal constraint is: X.\n[SPLIT]\nThe counter belief is: Y.";
const words = (n: number) => Array.from({ length: n }, () => "w").join(" ");

test("countWords", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("  one two\nthree  "), 3);
});

test("isWellFormed requires three parts with the exact openings", () => {
  assert.ok(isWellFormed(good));
  assert.ok(!isWellFormed("Story only"));
  assert.ok(!isWellFormed("Story\n[SPLIT]\nThe constraint is X\n[SPLIT]\nThe counter belief is: Y"));
  assert.ok(!isWellFormed("Story\n[SPLIT]\nYour subconscious internal constraint is: X\n[SPLIT]\nCounter: Y"));
  assert.ok(!isWellFormed(good + "\n[SPLIT]\nextra"));
  assert.ok(!isWellFormed("\n[SPLIT]\nYour subconscious internal constraint is: X\n[SPLIT]\nThe counter belief is: Y"));
});

test("isOverLimits uses 260 for the narrative and 75 per section", () => {
  assert.ok(!isOverLimits({ narrative: words(260), constraint: words(75), counterBelief: words(75) }));
  assert.ok(isOverLimits({ narrative: words(261), constraint: words(10), counterBelief: words(10) }));
  assert.ok(isOverLimits({ narrative: words(10), constraint: words(76), counterBelief: words(10) }));
  assert.ok(isOverLimits({ narrative: words(10), constraint: words(10), counterBelief: words(76) }));
});

test("formatTranscript drops the hidden opener and labels speakers", () => {
  const t = formatTranscript(
    [
      { role: "user", content: "Begin the diagnostic." },
      { role: "assistant", content: "What did you hear?" },
      { role: "user", content: "Money is evil." },
    ],
    "Begin the diagnostic.",
  );
  assert.equal(t, "GUIDE: What did you hear?\n\nPERSON: Money is evil.");
});

test("review input reports counts and flags parts over the limit", () => {
  const input = buildReviewInput("T", good, { narrative: words(300), constraint: words(20), counterBelief: words(80) });
  assert.match(input, /Narrative: 300 words, limit 260, OVER, cut to about 230/);
  assert.match(input, /Constraint section: 20 words, limit 75, within limit/);
  assert.match(input, /Counter belief section: 80 words, limit 75, OVER, cut to about 65/);
});

test("review prompt has no dash characters and names the domain report", () => {
  for (const d of Object.values(DOMAINS)) {
    const s = buildReviewSystem(d);
    assert.ok(s.includes(d.reportTitle));
    assert.ok(!/[—–]|\w-\w|--/.test(s), "dash in review prompt");
  }
});

test("paragraph budgets only appear when the narrative is over, and sum under the limit", async () => {
  const { paragraphBudgets } = await import("../src/lib/diagnostic/review.ts");
  assert.equal(paragraphBudgets(words(200)), "");
  const text = [words(120), words(100), words(80)].join("\n\n");
  const budgets = [...paragraphBudgets(text).matchAll(/cut to (\d+)/g)].map((m) => +m[1]);
  assert.equal(budgets.length, 3);
  assert.ok(budgets.reduce((a, b) => a + b, 0) <= 260);
  assert.ok(budgets[0] > budgets[2]);
});

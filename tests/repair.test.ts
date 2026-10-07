import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyRepairs,
  joinReport,
  replaceSection,
  rewriteIssues,
  sectionLimit,
  sectionOf,
  sectionText,
} from "../src/lib/diagnostic/repair.ts";
import { numberSentences } from "../src/lib/diagnostic/review.ts";
import { splitReport } from "../src/lib/diagnostic/text.ts";

const raw =
  "Your parents' belief was that rest is earned. You heard it often.\n\n" +
  "The anchor was the gym at 12.\n\n" +
  "The mechanism is starting over. You lose control when other priorities take your time.\n\n" +
  "Right now you are restarting again.\n\n" +
  "The shift is to keep going when it slips.\n\n[SPLIT]\n\n" +
  "Your subconscious internal constraint is: visible results are the only proof your effort is real.\n\n[SPLIT]\n\n" +
  "The counter belief is: effort counts before it shows. This week, log every workout and count them on Sunday.";
const parts = splitReport(raw, "[SPLIT]");
const sentences = numberSentences(parts);
const byStart = (t: string) => sentences.find((s) => s.text.startsWith(t))!;

test("sectionOf maps sentences to the constraint, the counter belief, and the final paragraph only", () => {
  assert.equal(sectionOf(byStart("Your subconscious"), sentences), "constraint");
  assert.equal(sectionOf(byStart("This week"), sentences), "counterBelief");
  assert.equal(sectionOf(byStart("The shift"), sentences), "shift");
  assert.equal(sectionOf(byStart("Right now"), sentences), null);
  assert.equal(sectionOf(byStart("The mechanism"), sentences), null);
});

test("sectionLimit gives the shift whatever the narrative has left", () => {
  assert.equal(sectionLimit(parts, "constraint"), 75);
  const narrativeWords = parts.narrative.split(/\s+/).filter(Boolean).length;
  const shiftWords = sectionText(parts, "shift").split(/\s+/).length;
  assert.equal(sectionLimit(parts, "shift"), 260 - (narrativeWords - shiftWords));
});

test("rewriteIssues rejects a missing opening, going over the limit, and absolutes the person never used", () => {
  const person = "everything about it. i lose control when other things take my time. nothing to show for it";
  assert.deepEqual(rewriteIssues("constraint", "Your subconscious internal constraint is: effort counts.", 75, person), []);
  assert.ok(rewriteIssues("constraint", "Effort counts.", 75, person).includes("missing the required opening words"));
  assert.ok(rewriteIssues("counterBelief", "The counter belief is: " + "w ".repeat(80), 75, person).some((i) => i.startsWith("over the word limit")));
  assert.ok(rewriteIssues("constraint", "Your subconscious internal constraint is: results are the only proof.", 75, person).some((i) => i.includes('"only"')));
  // An absolute the person did use is allowed.
  assert.deepEqual(rewriteIssues("shift", "You always restart.", 40, person + " i always restart"), []);
});

test("replaceSection swaps one section and leaves the rest", () => {
  const out = replaceSection(parts, "shift", "Keep going when it slips.");
  assert.ok(out.narrative.endsWith("Keep going when it slips."));
  assert.ok(out.narrative.startsWith("Your parents' belief"));
  assert.equal(out.constraint, parts.constraint);
  assert.equal(splitReport(joinReport(out), "[SPLIT]").narrative, out.narrative);
});

test("applyRepairs swaps exact sentences, refuses dropped openings, and skips unknown sentences", () => {
  const out = applyRepairs(parts, sentences, [
    { original: "Your parents' belief was that rest is earned.", replacement: "The belief you grew up with was that rest is earned." },
    { original: "Your subconscious internal constraint is: visible results are the only proof your effort is real.", replacement: "Results prove effort." },
    { original: "A sentence that is not in the report.", replacement: "x" },
  ]);
  assert.equal(out.applied.length, 1);
  assert.ok(out.report.narrative.startsWith("The belief you grew up with was that rest is earned. You heard it often."));
  assert.deepEqual(out.skipped.map((s) => s.reason), ["dropped the required opening", "sentence not found"]);
  assert.equal(out.report.constraint, parts.constraint);
});

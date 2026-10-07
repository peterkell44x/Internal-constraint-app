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

test("sectionOf maps sentences to the final sections or their narrative paragraph", () => {
  assert.equal(sectionOf(byStart("Your subconscious")), "constraint");
  assert.equal(sectionOf(byStart("This week")), "counterBelief");
  assert.equal(sectionOf(byStart("The shift")), "paragraph5");
  assert.equal(sectionOf(byStart("Right now")), "paragraph4");
});

test("sectionLimit gives a paragraph whatever the narrative has left", () => {
  assert.equal(sectionLimit(parts, "constraint"), 75);
  const narrativeWords = parts.narrative.split(/\s+/).filter(Boolean).length;
  const shiftWords = sectionText(parts, "paragraph5").split(/\s+/).length;
  assert.equal(sectionLimit(parts, "paragraph5"), 260 - (narrativeWords - shiftWords));
});

test("rewriteIssues rejects a missing opening, going over the limit, and absolutes the person never used", () => {
  const person = "everything about it. i lose control when other things take my time. nothing to show for it";
  assert.deepEqual(rewriteIssues("constraint", "Your subconscious internal constraint is: effort counts.", 75, person), []);
  assert.ok(rewriteIssues("constraint", "Effort counts.", 75, person).includes("missing the required opening words"));
  assert.ok(rewriteIssues("counterBelief", "The counter belief is: " + "w ".repeat(80), 75, person).some((i) => i.startsWith("over the word limit")));
  assert.ok(rewriteIssues("constraint", "Your subconscious internal constraint is: results are the only proof.", 75, person).some((i) => i.includes('"only"')));
  // An absolute the person did use is allowed.
  assert.deepEqual(rewriteIssues("paragraph5", "You always restart.", 40, person + " i always restart"), []);
  // A paragraph that had the word architecture must keep it.
  assert.ok(rewriteIssues("paragraph1", "Your dad said it often.", 60, person, "That built the architecture of it.").includes("dropped the word architecture"));
});

test("replaceSection swaps one paragraph or section and leaves the rest", () => {
  const mid = replaceSection(parts, "paragraph4", "Right now you are starting again.");
  assert.equal(mid.narrative.split("\n\n")[3], "Right now you are starting again.");
  assert.equal(mid.narrative.split("\n\n").length, 5);
  const out = replaceSection(parts, "paragraph5", "Keep going when it slips.");
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

test("a repair that brings back deleted or rejected wording is refused", async () => {
  const { reintroducedPhrase } = await import("../src/lib/diagnostic/repair.ts");
  const deleted = ["You were both solving specific problems rather than pursuing a vision of a finished body."];
  const rejected = ["He trains to fix problems, not to reach a finished body"];
  const original = "That approach shaped how you train now.";
  // The real case: the repair copied the rejected claim back in.
  assert.ok(reintroducedPhrase(original, "Both solving specific problems rather than pursuing a vision of a finished body shaped how you train now.", [...deleted, ...rejected]));
  // A neutral repair that just names the thing is fine.
  assert.equal(reintroducedPhrase(original, "How your dad trained shaped how you train now.", [...deleted, ...rejected]), null);
  // Wording already in the original sentence doesn't count as brought back.
  assert.equal(reintroducedPhrase("A finished body was the goal.", "A finished body was the goal for years.", deleted), null);

  const parts = splitReport(raw, "[SPLIT]");
  const out = applyRepairs(parts, numberSentences(parts), [
    { original: "Your parents' belief was that rest is earned.", replacement: "Solving specific problems rather than pursuing a vision was the belief." },
  ], deleted);
  assert.equal(out.applied.length, 0);
  assert.match(out.skipped[0].reason, /brings back deleted or rejected wording/);
});

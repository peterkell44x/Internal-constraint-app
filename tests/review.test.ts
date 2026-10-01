import assert from "node:assert/strict";
import { test } from "node:test";

import { DOMAINS } from "../src/lib/diagnostic/domains.ts";
import {
  applyDeletions,
  buildCutInput,
  buildCutSystem,
  countWords,
  isOverLimits,
  isWellFormed,
  numberSentences,
  parseDeletions,
  splitSentences,
  type ReportParts,
} from "../src/lib/diagnostic/review.ts";
import { splitReport } from "../src/lib/diagnostic/text.ts";

const good = "Story here.\n[SPLIT]\nYour subconscious internal constraint is: X.\n[SPLIT]\nThe counter belief is: Y.";
const words = (n: number) => Array.from({ length: n }, () => "w").join(" ");

// A realistic over-length report: narrative ~300 words in 4 paragraphs, the
// last a short closing line like a real report's "one shift".
const sentence = (tag: string) => "This is sentence " + tag + " with " + words(16) + ".";
const para = (p: number, n: number) => Array.from({ length: n }, (_, i) => sentence(p + "." + i)).join(" ");
const longReport =
  [para(1, 7), 'He said "idle hands are the devil\'s workshop." The architecture was built over years.', para(3, 7), "That is the shift."].join("\n\n") +
  "\n\n[SPLIT]\n\nYour subconscious internal constraint is: Rest means you are about to be caught. This keeps you working.\n\n[SPLIT]\n\nThe counter belief is: Stopping is safe. Take one day off this week. That proves it.";
const parts = (raw: string): ReportParts => splitReport(raw, "[SPLIT]");

test("countWords", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("  one two\nthree  "), 3);
});

test("isWellFormed requires three parts with the exact openings", () => {
  assert.ok(isWellFormed(good));
  assert.ok(!isWellFormed("Story only"));
  assert.ok(!isWellFormed("Story\n[SPLIT]\nThe constraint is X\n[SPLIT]\nThe counter belief is: Y"));
  assert.ok(!isWellFormed(good + "\n[SPLIT]\nextra"));
});

test("isOverLimits uses 260 for the narrative and 75 per section", () => {
  assert.ok(!isOverLimits({ narrative: words(260), constraint: words(75), counterBelief: words(75) }));
  assert.ok(isOverLimits({ narrative: words(261), constraint: words(10), counterBelief: words(10) }));
  assert.ok(isOverLimits({ narrative: words(10), constraint: words(76), counterBelief: words(10) }));
});

test("splitSentences keeps every character, including closing quotes", () => {
  const p = 'He said "go away." She left. Did it matter? Yes!';
  const s = splitSentences(p);
  assert.deepEqual(s, ['He said "go away."', "She left.", "Did it matter?", "Yes!"]);
  assert.equal(s.join(" "), p);
});

test("numberSentences locks section openings and the architecture sentence", () => {
  const s = numberSentences(parts(longReport));
  const locked = s.filter((x) => x.locked).map((x) => x.text);
  assert.ok(locked.includes("The architecture was built over years."));
  assert.ok(locked.some((t) => t.startsWith("Your subconscious internal constraint is:")));
  assert.ok(locked.some((t) => t.startsWith("The counter belief is:")));
  assert.ok(locked.includes("That is the shift."));
  assert.equal(locked.length, 4);
});

test("parseDeletions reads numbers from the delete block only", () => {
  assert.deepEqual(parseDeletions("<notes>drop 9</notes>\n<delete>3, 7,12</delete>"), [3, 7, 12]);
  assert.deepEqual(parseDeletions("no block 4 5"), []);
});

test("cuts never reorder, merge, reword, or add text, whatever the model asks for", () => {
  const p = parts(longReport);
  const s = numberSentences(p);
  const original = s.map((x) => x.text);
  // Many random deletion requests, including nonsense ids.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let trial = 0; trial < 300; trial++) {
    const req = s.filter(() => rand() < 0.4).map((x) => x.id).concat([0, 999]);
    const out = applyDeletions(s, req, p);
    const keptTexts = numberSentences(parts(out)).map((x) => x.text);
    // Every kept sentence is an original sentence, unchanged, in original order.
    let i = 0;
    for (const t of keptTexts) {
      while (i < original.length && original[i] !== t) i++;
      assert.ok(i < original.length, "sentence not found in original order: " + t);
      i++;
    }
    assert.ok(isWellFormed(out));
  }
});

test("only parts that are over their limit can lose sentences", () => {
  const p = parts(longReport);
  assert.ok(countWords(p.narrative) > 260 && countWords(p.constraint) <= 75);
  const s = numberSentences(p);
  const all = s.map((x) => x.id);
  const out = parts(applyDeletions(s, all, p));
  assert.equal(out.constraint, p.constraint);
  assert.equal(out.counterBelief, p.counterBelief);
});

test("locked sentences survive and a part is never emptied", () => {
  const p = parts(longReport);
  const s = numberSentences(p);
  const out = parts(applyDeletions(s, s.map((x) => x.id), p));
  assert.equal(out.narrative, "The architecture was built over years.\n\nThat is the shift.");
  // A part made only of deletable sentences (one paragraph, so no shift lock)
  // is left whole rather than emptied.
  const noLock = parts(para(1, 15) + "\n\n[SPLIT]\n\nYour subconscious internal constraint is: X.\n\n[SPLIT]\n\nThe counter belief is: Y.");
  const s2 = numberSentences(noLock);
  assert.equal(parts(applyDeletions(s2, s2.map((x) => x.id), noLock)).narrative, noLock.narrative);
});

test("a cut that guts a part is flagged as overcut", async () => {
  const { isOvercut } = await import("../src/lib/diagnostic/review.ts");
  const p = parts(longReport);
  const s = numberSentences(p);
  assert.ok(isOvercut(p, parts(applyDeletions(s, s.map((x) => x.id), p))));
  const firstTwo = s.filter((x) => x.part === "narrative").slice(0, 2).map((x) => x.id);
  assert.ok(!isOvercut(p, parts(applyDeletions(s, firstTwo, p))));
});

test("paragraph breaks are preserved and emptied paragraphs disappear", () => {
  const p = parts(longReport);
  const s = numberSentences(p);
  const para3 = s.filter((x) => x.part === "narrative" && x.paragraph === 2).map((x) => x.id);
  const out = parts(applyDeletions(s, para3, p));
  assert.equal(out.narrative.split("\n\n").length, 3);
  assert.equal(out.narrative.split("\n\n")[0], p.narrative.split("\n\n")[0]);
});

test("cut input shows counts, OVER flags, and locks", () => {
  const p = parts(longReport);
  const input = buildCutInput(numberSentences(p), p);
  assert.match(input, /NARRATIVE: \d+ words, limit 260, OVER, delete at least \d+ words/);
  assert.match(input, /CONSTRAINT SECTION: \d+ words, limit 75, within limit, do not delete from this part/);
  assert.match(input, /\(\d+ words, LOCKED\) The architecture was built over years\./);
});

test("cut prompt has no dash characters and names the domain report", () => {
  for (const d of Object.values(DOMAINS)) {
    const sys = buildCutSystem(d);
    assert.ok(sys.includes(d.reportTitle));
    assert.ok(!/[—–]|\w-\w|--/.test(sys), "dash in cut prompt");
  }
});

test("the where-you-stand-today paragraph is locked when the narrative has five paragraphs", () => {
  const five = [para(1, 3), para(2, 3), para(3, 3), "Right now you are 29. You still leave the gym.", para(5, 3)].join("\n\n");
  const raw = five + "\n\n[SPLIT]\n\nYour subconscious internal constraint is: X.\n\n[SPLIT]\n\nThe counter belief is: Y.";
  const p = parts(raw);
  const s = numberSentences(p);
  const locked = s.filter((x) => x.locked && x.part === "narrative").map((x) => x.text);
  assert.deepEqual(locked.slice(0, 2), ["Right now you are 29.", "You still leave the gym."]);
  assert.equal(locked.length, 2 + 3); // plus the three sentences of the final paragraph
  const out = parts(applyDeletions(s, s.map((x) => x.id), p));
  assert.ok(out.narrative.includes("Right now you are 29. You still leave the gym."));
});

test("nothing extra is locked when the narrative does not have five paragraphs", () => {
  const four = [para(1, 3), para(2, 3), "Right now you are 29.", para(4, 3)].join("\n\n");
  const raw = four + "\n\n[SPLIT]\n\nYour subconscious internal constraint is: X.\n\n[SPLIT]\n\nThe counter belief is: Y.";
  // Only the final paragraph (the shift) is locked when the count is not five.
  const locked = numberSentences(parts(raw)).filter((x) => x.locked && x.part === "narrative");
  assert.ok(locked.every((x) => x.paragraph === 3));
  assert.equal(locked.length, 3);
});

test("the final narrative paragraph is locked whole, so the shift is never left half-finished", () => {
  const raw = [para(1, 4), para(2, 4), "The real cost is not that it slowed you down. It is that you still believe it."].join("\n\n") +
    "\n\n[SPLIT]\n\nYour subconscious internal constraint is: X.\n\n[SPLIT]\n\nThe counter belief is: Y.";
  const p = parts(raw);
  const s = numberSentences(p);
  const out = parts(applyDeletions(s, s.map((x) => x.id), p));
  assert.ok(out.narrative.endsWith("The real cost is not that it slowed you down. It is that you still believe it."));
});

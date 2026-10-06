import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUDIT_SCHEMA,
  buildCheckInput,
  CHECK_SCHEMA,
  formatTranscript,
  matchViolations,
  parseAudit,
  parseViolations,
  type Violation,
} from "../src/lib/diagnostic/denial.ts";
import { applyDeletions, numberSentences } from "../src/lib/diagnostic/review.ts";
import { splitReport } from "../src/lib/diagnostic/text.ts";

const v = (quote: string, kind: Violation["kind"] = "unconfirmed_link"): Violation => ({ quote, kind, reason: "r" });

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

test("parseAudit and parseViolations accept the expected shape and reject anything else", () => {
  assert.deepEqual(parseAudit('{"rejected":[],"confirmed":[{"link":"a","quote":"b"}]}'), {
    rejected: [],
    confirmed: [{ link: "a", quote: "b" }],
    uncertain: [],
  });
  assert.equal(parseAudit("not json"), null);
  assert.equal(parseAudit('{"rejected":[]}'), null);
  assert.deepEqual(parseViolations('{"violations":[]}'), []);
  assert.equal(parseViolations('{"other":1}'), null);
});

test("check input carries the conversation, the audit lists, and the profile", () => {
  const input = buildCheckInput("PERSON: no", { rejected: [{ interpretation: "starting felt risky", quote: "no" }], confirmed: [] }, "PROFILE TEXT");
  assert.match(input, /CONVERSATION\n\nPERSON: no/);
  assert.match(input, /REJECTED BY THE PERSON\n- starting felt risky \(person: "no"\)/);
  assert.match(input, /CONFIRMED BY THE PERSON\n\(none\)/);
  assert.ok(input.endsWith("PROFILE TEXT"));
});

test("schemas are strict objects, as structured output requires", () => {
  for (const s of [AUDIT_SCHEMA, CHECK_SCHEMA]) {
    assert.equal(s.additionalProperties, false);
    assert.ok(s.required.length > 0);
  }
});

test("audit and check prompts treat idk as neither rejected nor confirmed", async () => {
  const { buildAuditSystem, buildCheckSystem } = await import("../src/lib/diagnostic/denial.ts");
  assert.match(buildAuditSystem(), /Uncertainty is neither/);
  assert.match(buildAuditSystem(), /idk, not sure, maybe/);
  assert.match(buildCheckSystem(), /answered with idk or uncertainty is not a rejection/);
});

test("parseAudit drops rejected items whose answer was uncertain", () => {
  const a = parseAudit(JSON.stringify({
    rejected: [
      { interpretation: "starting felt risky", quote: "no", answer: "no" },
      { interpretation: "there is a constraint", quote: "idk", answer: "uncertain" },
      { interpretation: "others' expectations", quote: "my expectations of myself", answer: "correction" },
    ],
    confirmed: [],
  }));
  assert.deepEqual(a?.rejected.map((r) => r.interpretation), ["starting felt risky", "others' expectations"]);
});

const report =
  "Your dad said you would be rich. He worked hard for it.\n\n" +
  "You kept the dropout secret. That keeps you building in private. You also lose all accountability.\n\n" +
  "The shift is to say it out loud.\n\n[SPLIT]\n\n" +
  "Your subconscious internal constraint is: being seen trying is dangerous. This keeps you hidden.\n\n[SPLIT]\n\n" +
  "The counter belief is: being seen is safe. Tell one person this week.";

test("matchViolations finds partial quotes, multi-sentence quotes, and refuses protected sentences", () => {
  const s = numberSentences(splitReport(report, "[SPLIT]"));
  const id = (t: string) => s.find((x) => x.text.startsWith(t))!.id;
  const { deleteIds, unfixable } = matchViolations(s, [
    v("lose all accountability"), // part of one sentence
    v("You kept the dropout secret. That keeps you building in private."), // spans two
    v("being seen trying is dangerous"), // inside the protected constraint opening
    v("a sentence that is nowhere in this report at all"), // not found
  ]);
  assert.deepEqual(deleteIds.sort(), [id("You kept"), id("That keeps"), id("You also")].sort());
  assert.deepEqual(unfixable.map((x) => x.quote), ["being seen trying is dangerous", "a sentence that is nowhere in this report at all"]);
});

test("matchViolations tolerates punctuation, case and trimmed quotes", () => {
  const s = numberSentences(splitReport(report, "[SPLIT]"));
  const { deleteIds } = matchViolations(s, [v("YOU ALSO lose all accountability!!"), v("Your dad said you would be rich and then some extra words that are not there")]);
  assert.equal(deleteIds.length, 2);
});

test("denial deletions remove only the flagged sentences, from any part, in order", () => {
  const p = splitReport(report, "[SPLIT]");
  const s = numberSentences(p);
  const { deleteIds } = matchViolations(s, [v("That keeps you building in private."), v("This keeps you hidden.")]);
  const out = splitReport(applyDeletions(s, deleteIds, p, { onlyOverLimit: false }), "[SPLIT]");
  assert.equal(out.narrative.split("\n\n")[1], "You kept the dropout secret. You also lose all accountability.");
  assert.equal(out.constraint, "Your subconscious internal constraint is: being seen trying is dangerous.");
  // With the length pass default, parts within their limit are untouched.
  assert.equal(splitReport(applyDeletions(s, deleteIds, p), "[SPLIT]").narrative, p.narrative);
});

test("containsDenial spots a denial inside a hedged answer, but not plain uncertainty", async () => {
  const { containsDenial } = await import("../src/lib/diagnostic/denial.ts");
  // The real answer that was wrongly dropped: hedged, then a clear denial of the cause.
  assert.ok(containsDenial("maybe a part of me is not in a rush. to a degree, i should be faster. but i dont think the reason is because the outcome already feels guaranteed."));
  assert.ok(containsDenial("no, because once i thought of the idea, i decided to work on it."));
  assert.ok(!containsDenial("idk thats why im talking to you. there might be something im unaware of. idk to be honest"));
  assert.ok(!containsDenial("i dont know"));
  assert.ok(!containsDenial("not sure, maybe"));
});

test("parseAudit keeps an uncertain-labelled answer that clearly denies, and records the truly uncertain ones", () => {
  const a = parseAudit(JSON.stringify({
    rejected: [
      { interpretation: "the outcome feels guaranteed", quote: "maybe a part of me is not in a rush. but i dont think the reason is because the outcome already feels guaranteed.", answer: "uncertain" },
      { interpretation: "there is a constraint", quote: "idk thats why im talking to you", answer: "uncertain" },
    ],
    confirmed: [],
  }));
  assert.deepEqual(a?.rejected.map((r) => r.interpretation), ["the outcome feels guaranteed"]);
  assert.deepEqual(a?.uncertain?.map((r) => r.interpretation), ["there is a constraint"]);
});

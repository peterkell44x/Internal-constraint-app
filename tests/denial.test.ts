import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUDIT_SCHEMA,
  buildCheckInput,
  buildRetryNote,
  CHECK_SCHEMA,
  formatTranscript,
  parseAudit,
  parseViolations,
  pickBest,
  type Violation,
} from "../src/lib/diagnostic/denial.ts";

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
  });
  assert.equal(parseAudit("not json"), null);
  assert.equal(parseAudit('{"rejected":[]}'), null);
  assert.deepEqual(parseViolations('{"violations":[]}'), []);
  assert.equal(parseViolations('{"other":1}'), null);
});

test("pickBest ships the first clean attempt, else the fewest violations, else the first", () => {
  assert.equal(pickBest([{ value: 1, violations: [v("a"), v("b")] }, { value: 2, violations: [] }, { value: 3, violations: [] }]).value, 2);
  assert.equal(pickBest([{ value: 1, violations: [v("a"), v("b")] }, { value: 2, violations: [v("c")] }, { value: 3, violations: [v("d"), v("e")] }]).value, 2);
  assert.equal(pickBest([{ value: 1, violations: [v("a")] }, { value: 2, violations: [v("b")] }]).value, 1);
  // A failed check never beats a checked attempt, and with no checks the first ships.
  assert.equal(pickBest([{ value: 1, violations: null }, { value: 2, violations: [v("a")] }]).value, 2);
  assert.equal(pickBest([{ value: 1, violations: null }, { value: 2, violations: null }]).value, 1);
});

test("the retry note lists each flagged claim once", () => {
  const note = buildRetryNote([v("You stay hidden."), v("you stay hidden. "), v("You never post.", "not_said")]);
  assert.equal((note.match(/^- /gm) ?? []).length, 2);
  assert.match(note, /"You stay hidden\."/);
  assert.match(note, /Do not make these claims or restate them in other words/);
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

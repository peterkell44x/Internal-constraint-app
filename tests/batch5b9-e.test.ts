// Batch 5b-9, item E: only Money can be started; the others are hidden, not removed.

import assert from "node:assert/strict";
import { test } from "node:test";

import { ACTIVE_DOMAINS, newDiagnosisError, pickerDomains } from "../src/lib/diagnostic/active-domains.ts";
import { DOMAIN_KEYS, isDomainKey } from "../src/lib/diagnostic/domains.ts";
import { QUESTIONS } from "../src/lib/diagnostic/v2/prompts.ts";

test("5b-9 E: the picker shows only Money, and only Money can be started", () => {
  assert.deepEqual(ACTIVE_DOMAINS, ["money"]);
  assert.deepEqual(pickerDomains(), ["money"]);
  assert.equal(newDiagnosisError("money"), null);
  for (const d of ["relationships", "fitness", "happiness"]) assert.equal(newDiagnosisError(d), "This domain is not available right now.", d);
  assert.equal(newDiagnosisError("cooking"), "Unknown domain.");
});

test("5b-9 E: hidden, not removed: old Love, Fitness and Happiness diagnoses still open", () => {
  for (const d of ["relationships", "fitness", "happiness"]) {
    assert.ok(DOMAIN_KEYS.includes(d as never), d);
    assert.ok(isDomainKey(d), "saved diagnoses in this domain still load and show their label");
    assert.equal(QUESTIONS[d as keyof typeof QUESTIONS].length, 8, "its questions are still there");
  }
});

test("5b-9 E: flipping the switch back shows the domain again", () => {
  assert.deepEqual(pickerDomains(["money", "relationships"]), ["money", "relationships"]);
  assert.equal(newDiagnosisError("relationships", ["money", "relationships"]), null);
  assert.deepEqual(pickerDomains(DOMAIN_KEYS), DOMAIN_KEYS);
});

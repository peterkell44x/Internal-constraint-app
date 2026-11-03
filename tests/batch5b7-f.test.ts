// Batch 5b-7, item F: each section ends on a sentence tied to one of their
// facts; the quoted example ending is gone.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildReportSystem,
  CARD_REGEN_SYSTEM,
  CARD_ROLES,
  DANGLING_CHECK_SYSTEM,
  DEFAULT_CLOSING,
  DESIGN_CLOSING,
  FACT_CHECK_SYSTEM,
  REACTION_SYSTEM,
} from "../src/lib/diagnostic/v2/prompts.ts";

const ADD = ", using one specific fact from their answers, ideally one not already used in that card";

test("5b-7 F (instruction only): the example ending is gone; section endings use one specific fact", () => {
  const sys = buildReportSystem();
  for (const text of [sys, CARD_REGEN_SYSTEM, JSON.stringify(CARD_ROLES), FACT_CHECK_SYSTEM, DANGLING_CHECK_SYSTEM, REACTION_SYSTEM]) {
    assert.ok(!text.includes("So the thing that started at home"));
  }
  assert.ok(
    sys.includes(
      "CARDS (3 per section; the last card of each section ends with ONE plain sentence of about 20 words that states the point of the whole section and uses one specific fact from their answers (something they did, a number, or something they said), ideally a fact not already used in that card. It is not a general summary and not a saying.)",
    ),
  );
  assert.ok(CARD_ROLES[0][2].endsWith("stating the point of the section" + ADD + "."));
  assert.ok(CARD_ROLES[2][2].includes("stating the point of the section" + ADD + ', then exactly: "' + DEFAULT_CLOSING + '"'));
  assert.ok(CARD_ROLES[3][2].includes("stating the point of the section" + ADD + ', then exactly: "' + DESIGN_CLOSING + '"'));
  assert.ok(!CARD_ROLES[1][2].includes(ADD), "Uncovered card 3 unchanged");
});

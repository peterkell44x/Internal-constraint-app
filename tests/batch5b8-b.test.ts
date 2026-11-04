// Batch 5b-8, item B: Uncovered card 1 does not invent feelings or lines.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem, CARD_ROLES } from "../src/lib/diagnostic/v2/prompts.ts";

const B1 =
  "Only write a feeling if they said they felt it. If they gave no strong line, do not make one up and do not mention that there is none: state what happened and what they did, in their words.";
const C57 =
  "The first sentence of this card states, in plain words taken from their answers, what part of them has tied to what (the pattern the hidden tie describes). Do not use the belief's exact words in that sentence. After it, continue with the most emotional experience from answer 5 and their strongest line, as before.";

test("5b-8 B (instruction only): card 1 keeps to stated feelings and lines, in the report and rewrite descriptions", () => {
  const sys = buildReportSystem();
  const start = sys.indexOf('(2) "Uncovered internal constraint": Card 1');
  const card1 = sys.slice(start, sys.indexOf(" Card 2 is ", start));
  assert.equal(
    card1,
    '(2) "Uncovered internal constraint": Card 1 is the most emotional experience they described (answer 5), the centre of it all: say what it did to how they see themselves, only where their answer shows it, and quote their strongest line. ' +
      C57 + " " + B1,
  );
  assert.equal(
    CARD_ROLES[1][0],
    "The most emotional experience they described (answer 5), the centre of it all: what it did to how they see themselves, only where their answer shows it, and their strongest line quoted. " + C57 + " " + B1,
  );
});

// The early sections refer to the belief only as "that pattern", never "that belief".

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReportSystem } from "../src/lib/diagnostic/v2/prompts.ts";

test("early sections: 'that pattern' only, never 'that belief' (instruction only)", () => {
  const sys = buildReportSystem();
  assert.ok(
    sys.includes(
      'Everywhere else ("Where it started", "Uncovered internal constraint" cards 1 and 2, "Life by default") refer to it only as "that pattern", never "that belief", or describe it differently, but never reword it as a competing version of the belief.',
    ),
  );
  assert.ok(!sys.includes('refer to it as "that belief" or "that pattern"'));
});

// Guards the port: the prompts and text handling in src/lib/diagnostic must
// produce exactly what the original prototype produces. The prototype's own
// code is loaded from reference/ and evaluated side by side.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

import { DOMAIN_BLURBS, DOMAINS } from "../src/lib/diagnostic/domains.ts";
import * as prompts from "../src/lib/diagnostic/prompts.ts";
import { splitReadyMarker, splitReport, stripDashes } from "../src/lib/diagnostic/text.ts";

const html = readFileSync(new URL("../reference/internal-constraint-diagnostic.html", import.meta.url), "utf8");
const script = html.slice(html.indexOf("<script>") + "<script>".length, html.indexOf("</script>"));

function section(from: string, to: string): string {
  const start = script.indexOf(from);
  const end = script.indexOf(to, start);
  assert.ok(start >= 0 && end > start, "could not find " + from + " in the prototype");
  return script.slice(start, end);
}

// Evaluate only the pure parts of the prototype (no DOM needed).
const proto = vm.runInNewContext(
  section("const DOMAINS = {", "// ---- App logic") +
    section("function stripDashes(text)", "async function callClaude") +
    section("const READY_MARKER", "function handleReply") +
    ";({ DOMAINS, buildSystemPrompt, buildReportSystem, stripDashes, READY_MARKER, HARD_CEILING, FORCE_CLOSE_SYSTEM_PROMPT })",
);

test("domain definitions match the prototype", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(DOMAINS)), JSON.parse(JSON.stringify(proto.DOMAINS)));
});

test("domain picker blurbs match the prototype", () => {
  for (const [key, blurb] of Object.entries(DOMAIN_BLURBS)) {
    assert.ok(html.includes(`data-domain="${key}">`) && html.includes("<span>" + blurb + "</span>"), key);
  }
});

for (const key of Object.keys(DOMAINS) as (keyof typeof DOMAINS)[]) {
  test(`system prompt for ${key} is identical`, () => {
    assert.equal(prompts.buildSystemPrompt(DOMAINS[key]), proto.buildSystemPrompt(proto.DOMAINS[key]));
  });
  test(`report prompt for ${key} is identical`, () => {
    assert.equal(prompts.buildReportSystem(DOMAINS[key]), proto.buildReportSystem(proto.DOMAINS[key]));
  });
}

test("constants match the prototype", () => {
  assert.equal(prompts.READY_MARKER, proto.READY_MARKER);
  assert.equal(prompts.HARD_CEILING, proto.HARD_CEILING);
  assert.equal(prompts.FORCE_CLOSE_SYSTEM_PROMPT, proto.FORCE_CLOSE_SYSTEM_PROMPT);
  assert.ok(script.includes(`content: "${prompts.BEGIN_MESSAGE}"`));
  assert.ok(script.includes(`content: "${prompts.REPORT_REQUEST_MESSAGE}"`));
  assert.ok(script.includes(`split('${prompts.REPORT_SPLIT_MARKER}')`));
  assert.ok(script.includes('model: "claude-sonnet-4-6"') && script.includes("max_tokens: 1000"));
});

test("stripDashes behaves like the prototype", () => {
  const samples = [
    "",
    "No dashes here.",
    "It was — honestly — a lot.",
    "Money–the root",
    "Wait -- what?",
    "word--word",
    "a , b .",
    "Twelve-year-old you, a well-known line.",
    "Ends with a dash —",
    "Mixed — dash -- and–more , , here .",
  ];
  for (const s of samples) assert.equal(stripDashes(s), proto.stripDashes(s), JSON.stringify(s));
});

test("readiness marker handling", () => {
  assert.deepEqual(splitReadyMarker("I have what I need. Click Generate profile report.\n[READY_FOR_REPORT]", "[READY_FOR_REPORT]"), {
    ready: true,
    clean: "I have what I need. Click Generate profile report.",
  });
  assert.deepEqual(splitReadyMarker("What did your dad say?", "[READY_FOR_REPORT]"), {
    ready: false,
    clean: "What did your dad say?",
  });
});

test("report splitting", () => {
  assert.deepEqual(splitReport(" Story.\n[SPLIT]\nYour subconscious internal constraint is: X\n[SPLIT]\nThe counter belief is: Y ", "[SPLIT]"), {
    narrative: "Story.",
    constraint: "Your subconscious internal constraint is: X",
    counterBelief: "The counter belief is: Y",
  });
  assert.deepEqual(splitReport("Only a narrative", "[SPLIT]"), { narrative: "Only a narrative", constraint: "", counterBelief: "" });
});

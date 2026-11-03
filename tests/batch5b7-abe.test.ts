// Batch 5b-7, items A, B and E: every card opens with its point, the
// "surface story" label is gone, and "each time" is a frequency phrase.

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkArchitectReport, checkBelief, type CheckDeps } from "../src/lib/diagnostic/v2/checks.ts";
import {
  buildReportSystem,
  CARD_REGEN_SYSTEM,
  CARD_ROLES,
  CODE_BANNED_PHRASES,
  DANGLING_CHECK_SYSTEM,
  DURATION_PHRASES,
  FACT_CHECK_SYSTEM,
  REACTION_SHAPES,
  REACTION_SYSTEM,
  SECTION_NAMES,
  UI_TEXT,
} from "../src/lib/diagnostic/v2/prompts.ts";
import { cleanReaction } from "../src/lib/diagnostic/v2/reaction.ts";
import { parseReport, type ArchitectReport } from "../src/lib/diagnostic/v2/schema.ts";
import { frequenciesNotSaid, reportDisplay } from "../src/lib/diagnostic/v2/text.ts";

/** A card of 5 sentences of 13 words; each card uses its own words, so cards never repeat. */
function card(tag: number): string {
  const word = (k: number) => "z" + String.fromCharCode(97 + tag) + String.fromCharCode(97 + (k % 26)) + String.fromCharCode(97 + Math.floor(k / 26));
  return Array.from({ length: 5 }, (_, s) => "You " + Array.from({ length: 12 }, (_, w) => word(s * 12 + w)).join(" ") + ".").join(" ");
}

function report(overrides: Record<number, string> = {}): ArchitectReport {
  return {
    hidden_tie: "You say you want money. But underneath, money means a tense home.",
    sections: SECTION_NAMES.map((name, s) => ({ name, cards: [0, 1, 2].map((c) => overrides[s * 3 + c] ?? card(s * 3 + c)) })),
    old_bullets: ["Hiding statements from yourself", "Stopping when it gets tense", "Waiting for a better month"],
    new_bullets: ["Looking at money weekly", "Staying in it when tense", "Treating setbacks as interruptions"],
  };
}

function deps() {
  const calls: { section: number; card: number }[] = [];
  const d: CheckDeps = {
    regenerate: async (section, c, _fixes, current) => {
      calls.push({ section, card: c });
      return current.sections[section].cards[c];
    },
    factCheck: async () => [],
  };
  return { d, calls };
}

const ANSWERS = "I grew up in Leeds with 3 kids in the house. Each time I got paid I spent it. I want 5k saved.";
const A_SENTENCE = "The first sentence of every card says plainly what that card is about. Do not open a card with a lead-in, a scene or background that comes before the point.";

test("5b-7 A (instruction only): the card-opening sentence is in the report and rewrite instructions, with no example", () => {
  const sys = buildReportSystem();
  assert.ok(sys.includes("\n" + A_SENTENCE + "\n(1) "), "in the CARDS section, before the per-section descriptions");
  assert.ok(sys.indexOf("CARDS (3 per section") < sys.indexOf(A_SENTENCE));
  assert.ok(CARD_REGEN_SYSTEM.includes(A_SENTENCE));
  assert.equal(sys.split(A_SENTENCE).length, 2);
});

test("5b-7 B: 'surface story' and 'real story' are gone from every instruction except the new rule, and are banned", async () => {
  const rule = "Do not use the words 'surface story' or 'real story' in the report.";
  const all = [buildReportSystem(), CARD_REGEN_SYSTEM, JSON.stringify(CARD_ROLES), FACT_CHECK_SYSTEM, DANGLING_CHECK_SYSTEM, REACTION_SYSTEM, JSON.stringify(REACTION_SHAPES)];
  for (const text of all) assert.ok(!/surface story|real story/i.test(text.split(rule).join("")), text.slice(0, 40));
  assert.ok(buildReportSystem().includes("- " + rule));
  assert.ok(CARD_REGEN_SYSTEM.includes(rule));
  assert.ok(buildReportSystem().includes("Card 2 is what they think the problem is, then what is underneath it (the hidden_tie in plain words). This is the most important card."));
  assert.ok(CARD_ROLES[1][1].startsWith("What they think the problem is, then what is underneath it (the hidden tie in plain words, never labelled). One soft word allowed."));
  assert.ok(CODE_BANNED_PHRASES.includes("surface story") && CODE_BANNED_PHRASES.includes("real story"));

  // A card sentence with it is deleted straight away, like the other banned phrases (no rewrite).
  const { d, calls } = deps();
  const out = await checkArchitectReport(report({ 4: card(4) + " That is the surface story.", 5: card(5) + " The real story is quieter." }), ANSWERS, d);
  assert.equal(calls.length, 0);
  assert.equal(out.report.sections[1].cards[1], card(4));
  assert.ok(out.debug.deleted.some((x) => x.sentence === "That is the surface story." && x.reason === "banned phrase: surface story"));
  assert.ok(out.debug.deleted.some((x) => x.sentence === "The real story is quieter."));
  // And from a reaction.
  assert.equal(cleanReaction("You froze. That is the surface story.").text, "You froze.");

  // An old saved report with the phrase still opens and shows it exactly as before.
  const old = report({ 4: card(4) + " That is the surface story." });
  const shown = reportDisplay(parseReport(JSON.stringify(old), SECTION_NAMES)!.sections, SECTION_NAMES, UI_TEXT.oldPattern, UI_TEXT.newPattern);
  assert.equal(shown.sections[1].cards[1], card(4) + " That is the surface story.");
});

test("5b-7 E: 'each time' is checked exactly like 'every time'", async () => {
  assert.ok(DURATION_PHRASES.includes("each time") && DURATION_PHRASES.includes("every time"));
  const answers = "I grew up in Leeds. I want 5k saved.";
  assert.deepEqual(frequenciesNotSaid("Each time the progress was real, the setback was real.", answers, DURATION_PHRASES), ["each time"]);
  assert.deepEqual(frequenciesNotSaid("Every time the progress was real, it stopped.", answers, DURATION_PHRASES), ["every time"]);
  // Backed: the phrase and the word after it are in the answers.
  assert.deepEqual(frequenciesNotSaid("Each time I got paid, you spent it.", ANSWERS, DURATION_PHRASES), []);
  // In a card: rewritten once, then deleted, like "every time".
  const { d, calls } = deps();
  const out = await checkArchitectReport(report({ 1: card(1) + " Each time the progress was real, the setback was real." }), answers, d);
  assert.deepEqual(calls.map((c) => [c.section, c.card]), [[0, 1]]);
  assert.equal(out.report.sections[0].cards[1], card(1));
  assert.ok(out.debug.deleted.some((x) => x.reason === "invented duration: each time"));
  // In the belief: not edited, only flagged.
  assert.deepEqual(checkBelief("each time you get close it slips away", answers), {
    after: "each time you get close it slips away",
    removed: [],
    flagged: ["each time"],
  });
});

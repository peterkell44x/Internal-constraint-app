import assert from "node:assert/strict";
import { test } from "node:test";

import { DOMAIN_KEYS } from "../src/lib/diagnostic/domains.ts";
import { checkArchitectReport, MIN_CARD_WORDS, type CheckDeps } from "../src/lib/diagnostic/v2/checks.ts";
import {
  currentScreen,
  emptyFlow,
  isSensitive,
  parseFlow,
  progressPercent,
  rendererFor,
  transcript,
  withAnswer,
  withHalfwaySeen,
  withReaction,
  withTap,
  type Flow,
} from "../src/lib/diagnostic/v2/flow.ts";
import { buildReactionInput, buildReportInput } from "../src/lib/diagnostic/v2/inputs.ts";
import {
  BANNED_WORDING,
  CARD_FIX,
  QUESTION_JOBS,
  QUESTIONS,
  SECTION_NAMES,
  TAP_QUESTIONS,
  UI_TEXT,
} from "../src/lib/diagnostic/v2/prompts.ts";
import { parseReaction, parseReport, reactionProblems, salvageReaction, type ArchitectReport } from "../src/lib/diagnostic/v2/schema.ts";
import { findNumbers, repeatedWords, unsupportedItems } from "../src/lib/diagnostic/v2/text.ts";

// ---------------------------------------------------------------------------
// Question data

test("4 domains with 8 non-empty questions each, 8 jobs, 2 taps, 4 section names", () => {
  assert.equal(DOMAIN_KEYS.length, 4);
  for (const d of DOMAIN_KEYS) {
    assert.equal(QUESTIONS[d].length, 8, d);
    assert.ok(QUESTIONS[d].every((q) => q.trim().length > 10), d);
  }
  assert.equal(QUESTION_JOBS.length, 8);
  assert.ok(QUESTION_JOBS.every((j) => j.trim()));
  assert.equal(TAP_QUESTIONS.length, 2);
  assert.equal(SECTION_NAMES.length, 4);
});

// ---------------------------------------------------------------------------
// Step machine

const react = (f: Flow, step: number, crisis = false): Flow => withReaction(f, { step, text: "Reaction " + step + ".", crisis });

/** Answers questions 1..n with their reactions, passing the halfway screen. */
function answered(n: number): Flow {
  let f = emptyFlow();
  for (let i = 1; i <= n; i++) {
    if (i === 6) f = withHalfwaySeen(f);
    f = react(withAnswer(f, "Answer " + i), i);
  }
  return f;
}

test("10 steps: 8 questions, the halfway screen after answer 5, taps at 9 and 10, about 10% each", () => {
  let f = emptyFlow();
  assert.deepEqual(currentScreen(f), { kind: "question", step: 1 });
  assert.equal(progressPercent(f), 0);
  for (let i = 1; i <= 8; i++) {
    if (i === 6) {
      assert.deepEqual(currentScreen(f), { kind: "halfway" });
      f = withHalfwaySeen(f);
    }
    assert.deepEqual(currentScreen(f), { kind: "question", step: i });
    f = withAnswer(f, "Answer " + i);
    assert.deepEqual(currentScreen(f), { kind: "reaction", step: i });
    assert.equal(progressPercent(f), i * 10);
    f = react(f, i);
  }
  assert.deepEqual(currentScreen(f), { kind: "tap", step: 9 });
  f = withTap(f, false);
  assert.deepEqual(currentScreen(f), { kind: "reaction", step: 9 });
  assert.equal(progressPercent(f), 90);
  f = react(f, 9);
  assert.deepEqual(currentScreen(f), { kind: "tap", step: 10 });
  f = withTap(f, true);
  assert.deepEqual(currentScreen(f), { kind: "done" });
  assert.equal(progressPercent(f), 100);
});

test("a reload resumes at the same step, with nothing typed lost", () => {
  for (const f of [answered(3), answered(5), withAnswer(answered(6), "typed but no reaction yet"), withTap(answered(8), true)]) {
    const reloaded = parseFlow(JSON.parse(JSON.stringify(f)));
    assert.deepEqual(reloaded, f);
    assert.deepEqual(currentScreen(reloaded), currentScreen(f));
  }
  // The answer saved before its reaction is kept, and the reaction is asked for again.
  assert.deepEqual(currentScreen(withAnswer(answered(6), "x")), { kind: "reaction", step: 7 });
  assert.deepEqual(parseFlow(null), emptyFlow());
});

test("the transcript leads each next question with the reaction to the last answer", () => {
  const q = QUESTIONS.money;
  const t = transcript(answered(2), q, [...TAP_QUESTIONS]);
  assert.deepEqual(t.map((b) => b.kind), ["question", "answer", "reaction", "question", "answer", "reaction", "question"]);
  const last = t.at(-1)!;
  assert.equal(last.kind === "question" ? last.text : null, q[2]);
  // Halfway: after reaction 5, before question 6.
  assert.equal(transcript(answered(5), q, [...TAP_QUESTIONS]).at(-1)!.kind, "reaction");
  const after = transcript(withHalfwaySeen(answered(5)), q, [...TAP_QUESTIONS]);
  assert.deepEqual(after.slice(-2).map((b) => b.kind), ["halfway", "question"]);
  // After answer 8 comes the first tap.
  const taps = transcript(answered(8), q, [...TAP_QUESTIONS]);
  const lastTap = taps.at(-1)!;
  assert.equal(lastTap.kind === "question" ? lastTap.text : null, TAP_QUESTIONS[0]);
});

test("answers: empty refused, up to 3000 characters, only for the current step", async () => {
  const { answerError, tapError } = await import("../src/lib/diagnostic/v2/flow.ts");
  assert.equal(answerError(emptyFlow(), 1, "idk"), null);
  assert.ok(answerError(emptyFlow(), 1, "   "));
  assert.ok(answerError(emptyFlow(), 1, "x".repeat(3001)));
  assert.equal(answerError(emptyFlow(), 1, "x".repeat(3000)), null);
  assert.ok(answerError(emptyFlow(), 2, "skip ahead"));
  assert.ok(tapError(answered(7), 9));
  assert.equal(tapError(answered(8), 9), null);
});

// ---------------------------------------------------------------------------
// Repeated words

test("REPEATED_WORDS: 3 or more, 5 letters or more, no stop words, at most 2", () => {
  assert.deepEqual(repeatedWords("Money money MONEY. Tense, tense, tense, tense. Stress stress stress. their their their their"), [
    { word: "tense", count: 4 },
    { word: "money", count: 3 },
  ]);
  assert.deepEqual(repeatedWords("dad dad dad dad, about about about about"), []); // short word, stop word
  assert.deepEqual(repeatedWords("Money was tight. Money was tense."), []); // only twice
  assert.deepEqual(repeatedWords(""), []);
});

test("the reaction input carries the job, earlier answers and REPEATED_WORDS", () => {
  const f = withAnswer(react(withAnswer(emptyFlow(), "We moved twice."), 1), "My dad, my dad, my dad. Always money money money.");
  const input = buildReactionInput("money", f, 2, repeatedWords(f.answers[1]));
  assert.match(input, /WHAT THIS QUESTION IS FOR: Who they modelled/);
  assert.match(input, /A1: We moved twice\./);
  assert.match(input, /REPEATED_WORDS: money \(3 times\)/);
  assert.match(buildReactionInput("money", answered(1), 1, []), /REPEATED_WORDS: \(none\)/);
});

// ---------------------------------------------------------------------------
// Numbers and quotes

const ANSWERS = "I grew up in Leeds with 3 kids in the house. Money was tense for six months after dad lost his job. Mum said \"we can't afford nice things\". I want 5k saved.";

test("numbers: digits and number words match, 6 and 12 months are allowed, one/two/three only before a count noun", () => {
  assert.deepEqual(unsupportedItems("For 6 months money was tense.", ANSWERS), []);
  assert.deepEqual(unsupportedItems("There were three kids at home.", ANSWERS), []);
  assert.deepEqual(unsupportedItems("You want 5,000 saved.", ANSWERS), []);
  assert.deepEqual(unsupportedItems("In 12 months you will have it.", ANSWERS), []);
  assert.deepEqual(unsupportedItems("You were 22 when it started.", ANSWERS), ["22"]);
  assert.deepEqual(unsupportedItems("It lasted four years.", ANSWERS), ["four"]);
  assert.deepEqual(unsupportedItems("Here are three things to see. One idea stands out.", ANSWERS), []);
  assert.deepEqual(unsupportedItems("It took two years.", ANSWERS), ["two"]);
  assert.deepEqual(findNumbers("twenty five and a hundred").map((n) => n.value), [25, 100]);
});

test("quotes must be in the answers, ignoring case and punctuation", () => {
  assert.deepEqual(unsupportedItems('Mum told you "We can’t afford nice things."', ANSWERS), []);
  assert.deepEqual(unsupportedItems("You said “money is evil”.", ANSWERS), ['"money is evil"']);
});

// ---------------------------------------------------------------------------
// The report checks, with fake AI calls

/** A card of 5 sentences of 13 words; each card uses its own words, so cards never repeat. */
function card(tag: number): string {
  const word = (k: number) => "z" + String.fromCharCode(97 + tag) + String.fromCharCode(97 + (k % 26)) + String.fromCharCode(97 + Math.floor(k / 26));
  return Array.from({ length: 5 }, (_, s) => "You " + Array.from({ length: 12 }, (_, w) => word(s * 12 + w)).join(" ") + ".").join(" ");
}

function report(overrides: Record<number, string> = {}): ArchitectReport {
  return {
    hidden_tie: "You say you want money. But underneath, money means a tense home.",
    sections: SECTION_NAMES.map((name, s) => ({ name, cards: [0, 1, 2].map((c) => overrides[s * 3 + c] ?? card(s * 3 + c)) })),
    old_bullets: ["You avoid looking at money", "You stop when it gets tense", "You wait"],
    new_bullets: ["You look at money weekly", "You keep going when tense", "You act"],
  };
}

function deps(over: Partial<CheckDeps> = {}) {
  const calls: { section: number; card: number; fixes: string[] }[] = [];
  const d: CheckDeps = {
    regenerate: async (section, cardIdx, fixes, current) => {
      calls.push({ section, card: cardIdx, fixes });
      // By default, a rewrite that fixes nothing.
      return over.regenerate ? over.regenerate(section, cardIdx, fixes, current) : current.sections[section].cards[cardIdx];
    },
    factCheck: over.factCheck ?? (async () => []),
  };
  return { d, calls };
}

test("an unsupported number: the card is rewritten once, then the sentence is deleted", async () => {
  const bad = card(1) + " You were 22 when it started.";
  const { d, calls } = deps();
  const out = await checkArchitectReport(report({ 1: bad }), ANSWERS, d);
  assert.deepEqual(calls.map((c) => [c.section, c.card]), [[0, 1]]);
  assert.match(calls[0].fixes[0], /Remove the unsupported number or quote.*22/);
  assert.equal(out.report.sections[0].cards[1], card(1));
  assert.deepEqual(out.debug.deleted.map((x) => [x.sentence, x.by]), [["You were 22 when it started.", "code"]]);
});

test("a rewrite that fixes the problem is kept and nothing is deleted", async () => {
  const { d } = deps({ regenerate: async () => card(20) });
  const out = await checkArchitectReport(report({ 4: card(4) + ' You said "money is evil".' }), ANSWERS, d);
  assert.equal(out.report.sections[1].cards[1], card(20));
  assert.equal(out.debug.deleted.length, 0);
  assert.equal(out.debug.regenerated[0].result, "replaced");
});

test("no sentence twice and no 8-word phrase in two cards: the later card is fixed", async () => {
  const shared = "You learned that money only ever arrives with a fight attached.";
  const { d, calls } = deps();
  const out = await checkArchitectReport(report({ 1: card(1) + " " + shared, 7: card(7) + " " + shared }), ANSWERS, d);
  assert.deepEqual(calls.map((c) => [c.section, c.card, c.fixes]), [[2, 1, [CARD_FIX.repeated]]]);
  assert.ok(out.report.sections[0].cards[1].includes(shared), "the first one stays");
  assert.ok(!out.report.sections[2].cards[1].includes(shared), "the later one is deleted");
  // A shared 8-word run inside different sentences counts too.
  const a = "You kept waiting for the right moment to finally start saving.";
  const b = "Again you kept waiting for the right moment to finally start again.";
  const out2 = await checkArchitectReport(report({ 0: card(0) + " " + a, 5: card(5) + " " + b }), ANSWERS, deps().d);
  assert.ok(!out2.report.sections[1].cards[2].includes(b));
});

test("banned wording: the card is rewritten once, then the sentence is deleted", async () => {
  const { d, calls } = deps();
  const out = await checkArchitectReport(report({ 9: card(9) + " Now you recalibrate everything." }), ANSWERS, d);
  assert.equal(calls.length, 1);
  assert.match(calls[0].fixes[0], /banned wording.*recalibrate/);
  assert.ok(!out.report.sections[3].cards[0].includes("recalibrate"));
  assert.ok(BANNED_WORDING.includes("recalibrate"));
});

test("a card under 40 words is rewritten once from the answers", async () => {
  const short = "You learned money was tense. You stayed quiet about it.";
  const { d, calls } = deps({
    regenerate: async (s, c, fixes, current) => (fixes[0] === CARD_FIX.short ? card(22) : current.sections[s].cards[c]),
  });
  const out = await checkArchitectReport(report({ 3: short }), ANSWERS, d);
  assert.deepEqual(calls.map((c) => [c.section, c.card, c.fixes]), [[1, 0, [CARD_FIX.short]]]);
  assert.equal(out.report.sections[1].cards[0], card(22));
  // If the rewrite fails, the card ships as it is and is listed as short.
  const failing = await checkArchitectReport(report({ 3: short }), ANSWERS, deps({ regenerate: async () => null }).d);
  assert.equal(failing.debug.regenerated[0].result, "failed");
  assert.ok(failing.debug.shortCards.includes("The hidden block, card 1"));
  assert.ok(MIN_CARD_WORDS === 40);
});

test("the AI check deletes the sentences it flags, then the code checks run again", async () => {
  const flaggedSentence = card(6).split(". ")[0] + ".";
  const { d } = deps({
    factCheck: async (numbered) => numbered.filter((x) => x.text === flaggedSentence).map((x) => ({ n: x.n, reason: "invented event" })),
  });
  const out = await checkArchitectReport(report(), ANSWERS, d);
  assert.equal(out.debug.aiCheck.status, "ok");
  assert.equal(out.debug.aiCheck.flagged, 1);
  assert.ok(!out.report.sections[2].cards[0].includes(flaggedSentence));
  assert.deepEqual(out.debug.deleted.map((x) => x.by), ["ai"]);
});

test("if the AI check fails, it is retried once, then the report ships with the code checks only, recorded", async () => {
  let calls = 0;
  const { d } = deps({ factCheck: async () => { calls++; throw new Error("overloaded"); } });
  const out = await checkArchitectReport(report({ 0: card(0) + " You were 22 then." }), ANSWERS, d);
  assert.equal(calls, 2);
  assert.equal(out.debug.aiCheck.status, "failed");
  assert.equal(out.debug.aiCheck.attempts, 2);
  assert.match(out.debug.aiCheck.error!, /overloaded/);
  assert.ok(!out.report.sections[0].cards[0].includes("22"), "the code checks still ran");
});

// ---------------------------------------------------------------------------
// Schemas

test("report JSON: 4 sections of 3 cards, 3 and 3 bullets, a hidden tie; names come from the config", () => {
  const good = { ...report(), sections: report().sections.map((s) => ({ ...s, name: "whatever" })) };
  const parsed = parseReport(JSON.stringify(good), SECTION_NAMES);
  assert.ok(parsed);
  assert.deepEqual(parsed.sections.map((s) => s.name), [...SECTION_NAMES]);
  assert.equal(parseReport(JSON.stringify({ ...good, hidden_tie: "" }), SECTION_NAMES), null);
  assert.equal(parseReport(JSON.stringify({ ...good, old_bullets: ["a", "b"] }), SECTION_NAMES), null);
  assert.equal(parseReport(JSON.stringify({ ...good, sections: good.sections.slice(0, 3) }), SECTION_NAMES), null);
  const elevenCards = good.sections.map((s, i) => (i === 2 ? { ...s, cards: s.cards.slice(0, 2) } : s));
  assert.equal(parseReport(JSON.stringify({ ...good, sections: elevenCards }), SECTION_NAMES), null);
  assert.equal(parseReport("not json", SECTION_NAMES), null);
});

test("reaction JSON: a reaction string and a crisis boolean; call-outs must match REPEATED_WORDS", () => {
  assert.deepEqual(parseReaction('{"reaction":"Tense is the word you picked.","crisis":false}'), { reaction: "Tense is the word you picked.", crisis: false });
  assert.equal(parseReaction('{"reaction":"x","crisis":"no"}'), null);
  assert.equal(parseReaction('{"reaction":"","crisis":false}'), null);
  const list = [{ word: "tense", count: 3 }];
  assert.deepEqual(reactionProblems("The word tense shows up 3 times. Money feels like a fight.", list), []);
  assert.ok(reactionProblems("The word money shows up 3 times.", list).length > 0);
  assert.ok(reactionProblems("The word tense shows up 3 times.", []).length > 0);
  assert.ok(reactionProblems("word ".repeat(56), []).some((p) => p.startsWith("over 55 words")));
  assert.equal(salvageReaction("The word money shows up 4 times. Money feels like a fight.", list), "Money feels like a fight.");
});

// ---------------------------------------------------------------------------
// Crisis, sensitive, old reports

test("a crisis reaction shows the support line and makes the report SENSITIVE", () => {
  const f = react(withAnswer(emptyFlow(), "something heavy"), 1, true);
  assert.ok(isSensitive(f));
  assert.ok(!isSensitive(answered(3)));
  const bubble = transcript(f, QUESTIONS.money, [...TAP_QUESTIONS]).find((b) => b.kind === "reaction");
  assert.ok(bubble && bubble.kind === "reaction" && bubble.crisis);
  assert.match(UI_TEXT.supportLine, /988/);
  assert.match(buildReportInput("money", f, isSensitive(f)), /SENSITIVE: true/);
  assert.match(buildReportInput("money", answered(8), false), /SENSITIVE: false/);
});

test("old reports keep the old renderer; only version 2 uses the new one", () => {
  assert.equal(rendererFor(1), "legacy");
  assert.equal(rendererFor(undefined), "legacy");
  assert.equal(rendererFor(null), "legacy");
  assert.equal(rendererFor(2), "architect");
});

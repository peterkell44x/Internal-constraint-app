import assert from "node:assert/strict";
import { test } from "node:test";

import { DOMAIN_KEYS } from "../src/lib/diagnostic/domains.ts";
import { checkArchitectReport, enforceClosings, MIN_CARD_WORDS, type CheckDeps } from "../src/lib/diagnostic/v2/checks.ts";
import {
  boldnessFor,
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
  CARD_FIX,
  DEFAULT_CLOSING,
  DESIGN_CLOSING,
  QUESTION_HINTS,
  QUESTION_JOBS,
  QUESTIONS,
  SECTION_NAMES,
  TAP_QUESTIONS,
  UI_TEXT,
} from "../src/lib/diagnostic/v2/prompts.ts";
import { cleanReaction } from "../src/lib/diagnostic/v2/reaction.ts";
import { cleanReason, parseFactCheck, parseReaction, parseReport, type ArchitectReport, type FactFlag } from "../src/lib/diagnostic/v2/schema.ts";
import {
  anchorInAnswers,
  findNumbers,
  isWordsRemovedOnly,
  replaceDashes,
  repeatedWithinCard,
  sentencesOf,
  trimAtSentence,
  unsupportedItems,
} from "../src/lib/diagnostic/v2/text.ts";

// ---------------------------------------------------------------------------
// Question data and hints

test("4 domains with 8 non-empty questions each, 8 jobs, 2 taps, 4 section names", () => {
  assert.equal(DOMAIN_KEYS.length, 4);
  for (const d of DOMAIN_KEYS) {
    assert.equal(QUESTIONS[d].length, 8, d);
    assert.ok(QUESTIONS[d].every((q) => q.trim().length > 10), d);
  }
  assert.equal(QUESTION_JOBS.length, 8);
  assert.equal(TAP_QUESTIONS.length, 2);
  assert.equal(SECTION_NAMES.length, 4);
});

test('every question asks for "As much detail as you can give me." exactly once', () => {
  for (const d of DOMAIN_KEYS) {
    for (const q of QUESTIONS[d]) {
      assert.ok(q.endsWith("As much detail as you can give me."), q);
      assert.equal(q.split("As much detail as you can give me.").length, 2, q);
    }
  }
});

test("a hint shows under all 8 questions in all 4 domains, and is never sent to the AI", () => {
  for (const d of DOMAIN_KEYS) {
    assert.equal(QUESTION_HINTS[d].length, 8, d);
    assert.ok(QUESTION_HINTS[d].every((h) => h.trim().length > 0), d);
    const f = answeredUpTo(8);
    const shown = transcript(f, QUESTIONS[d], [...TAP_QUESTIONS], QUESTION_HINTS[d]).filter((b) => b.kind === "question" && b.hint);
    assert.equal(shown.length, 8, d);
    const sent = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => buildReactionInput(d, f, s, boldnessFor(s), false)).join("\n") + buildReportInput(d, f, false);
    for (const h of QUESTION_HINTS[d]) assert.ok(!sent.includes(h), "hint sent to the AI: " + h);
  }
  assert.equal(QUESTION_HINTS.money[6], "Real numbers are best. A rough guess is fine.");
  assert.equal(QUESTION_HINTS.fitness[6], "Say what it looks like and feels like. A rough picture is fine.");
  assert.equal(QUESTION_HINTS.happiness[0], "Think about the home, the people around you, and the mood.");
});

// ---------------------------------------------------------------------------
// Step machine

const react = (f: Flow, step: number, crisis = false): Flow => withReaction(f, { step, text: "Reaction " + step + ".", crisis });

function answeredUpTo(n: number): Flow {
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
  f = react(withTap(f, false), 9);
  assert.deepEqual(currentScreen(f), { kind: "tap", step: 10 });
  f = withTap(f, true);
  assert.deepEqual(currentScreen(f), { kind: "done" });
  assert.equal(progressPercent(f), 100);
});

test("a reload resumes at the same step, with nothing typed lost", () => {
  for (const f of [answeredUpTo(3), answeredUpTo(5), withAnswer(answeredUpTo(6), "typed"), withTap(answeredUpTo(8), true)]) {
    const reloaded = parseFlow(JSON.parse(JSON.stringify(f)));
    assert.deepEqual(reloaded, f);
    assert.deepEqual(currentScreen(reloaded), currentScreen(f));
  }
  assert.deepEqual(parseFlow(null), emptyFlow());
});

test("boldness ramps: answers 1 to 3 gentle, 4 and 5 medium, 6 to 8 and the tap direct", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(boldnessFor), ["gentle", "gentle", "gentle", "medium", "medium", "direct", "direct", "direct", "direct"]);
});

test("the reaction input carries the job, earlier answers, BOLDNESS and THIN_ANSWER, and no REPEATED_WORDS", () => {
  const f = withAnswer(react(withAnswer(emptyFlow(), "We moved twice."), 1), "My dad.");
  const input = buildReactionInput("money", f, 2, "gentle", true);
  assert.match(input, /WHAT THIS QUESTION IS FOR: Who they modelled/);
  assert.match(input, /A1: We moved twice\./);
  assert.match(input, /BOLDNESS: gentle/);
  assert.match(input, /THIN_ANSWER: true/);
  assert.ok(!/REPEATED_WORDS/.test(input));
});

// ---------------------------------------------------------------------------
// Reactions: word echo, chasing, dashes, length, anchors

test("word-echo sentences are deleted from a reaction", () => {
  const r = cleanReaction("The word happy shows up 4 times. Happiness keeps arriving but not staying for you.");
  assert.equal(r.text, "Happiness keeps arriving but not staying for you.");
  assert.deepEqual(r.fired, ["word echo deleted"]);
  for (const echo of ["You used dandruff again and again.", "Girls shows up 3 times.", "You called it a wall.", "It is the same word every time."]) {
    assert.equal(cleanReaction(echo + " That is how it feels.").text, "That is how it feels.", echo);
  }
  // A plain use of "shows up" without a count is fine.
  assert.equal(cleanReaction("When he shows up late, you go quiet.").text, "When he shows up late, you go quiet.");
});

test('"chasing" sentences are deleted from a reaction, and dashes become commas', () => {
  assert.equal(cleanReaction("You keep chasing the next high. Money means safety.").text, "Money means safety.");
  const d = cleanReaction("Money was tense — always – at home.");
  assert.equal(d.text, "Money was tense, always, at home.");
  assert.ok(d.fired.includes("em dash replaced"));
  assert.equal(replaceDashes("One thing—and another."), "One thing, and another.");
});

test("a reaction over 70 words is cut at the end of a full sentence", () => {
  const s = (n: number) => Array.from({ length: n }, () => "word").join(" ") + ".";
  const text = [s(30), s(30), s(30)].join(" ");
  const out = trimAtSentence(text, 70);
  assert.equal(out, [s(30), s(30)].join(" "));
  assert.ok(out.endsWith("."));
  assert.equal(trimAtSentence(s(80), 70), s(80), "a single long sentence is never cut mid-thought");
  assert.equal(cleanReaction(text).fired.at(-1), "trimmed to 70 words");
  assert.equal(trimAtSentence(s(10), 70), s(10));
});

test("the anchor must be words copied from their answers, ignoring case and punctuation", () => {
  const answers = "I lock back in and get disciplined. If I slip a bit, I fall toward junk food!";
  assert.ok(anchorInAnswers("lock back in and get disciplined", answers));
  assert.ok(anchorInAnswers("Fall toward JUNK food", answers));
  assert.ok(!anchorInAnswers("lose your grip", answers));
  assert.ok(!anchorInAnswers("", answers));
  assert.ok(!anchorInAnswers("junk foo", answers), "a part of a word is not an anchor");
  assert.deepEqual(parseReaction('{"reaction":"x.","anchor":"junk food","crisis":false}'), { reaction: "x.", anchor: "junk food", crisis: false });
});

// ---------------------------------------------------------------------------
// Numbers and quotes

const ANSWERS = "I grew up in Leeds with 3 kids in the house. I started lifting at 18 and I'm 22 now. Money was tense for six months. Mum said \"we can't afford nice things\". I want 5k saved.";

test("numbers: digits and words match, 6 and 12 months are allowed, a difference of two ages is allowed", () => {
  assert.deepEqual(unsupportedItems("For 6 months money was tense.", ANSWERS), []);
  assert.deepEqual(unsupportedItems("There were three kids at home.", ANSWERS), []);
  assert.deepEqual(unsupportedItems("You want 5,000 saved.", ANSWERS), []);
  assert.deepEqual(unsupportedItems("Four years of real effort.", ANSWERS), [], "22 minus 18");
  assert.deepEqual(unsupportedItems("You were 25 when it started.", ANSWERS), ["25"]);
  assert.deepEqual(unsupportedItems("It took two years.", ANSWERS), ["two"]);
  assert.deepEqual(unsupportedItems("Here are three things to see.", ANSWERS), []);
  assert.deepEqual(findNumbers("twenty five and a hundred").map((n) => n.value), [25, 100]);
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
    old_bullets: ["Hiding statements from yourself", "Stopping when it gets tense", "Waiting for a better month"],
    new_bullets: ["Looking at money weekly", "Staying in it when tense", "Treating setbacks as interruptions"],
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

test("the closing lines end Life by default and Life by design card 3, exactly once", async () => {
  const r = enforceClosings(report({ 8: card(8) + " That's your design. " + DEFAULT_CLOSING, 2: card(2) + " " + DESIGN_CLOSING }));
  const def = r.sections[2].cards[2];
  const des = r.sections[3].cards[2];
  assert.ok(def.endsWith(DEFAULT_CLOSING));
  assert.equal(def.split(DEFAULT_CLOSING).length, 2);
  assert.ok(des.endsWith(DESIGN_CLOSING));
  assert.equal(des.split(DESIGN_CLOSING).length, 2);
  assert.ok(!r.sections[0].cards[2].includes(DESIGN_CLOSING));
  const out = await checkArchitectReport(report(), ANSWERS, deps().d);
  assert.ok(out.report.sections[2].cards[2].endsWith(DEFAULT_CLOSING));
  assert.ok(out.report.sections[3].cards[2].endsWith(DESIGN_CLOSING));
});

test("an unsupported number: the rewrite may remove only the number; otherwise the sentence is deleted", async () => {
  const bad = card(1) + " You were 25 when it started.";
  // A rewrite that restates the whole card is refused.
  const restated = deps({ regenerate: async () => card(20) });
  const out = await checkArchitectReport(report({ 1: bad }), ANSWERS, restated.d);
  assert.equal(out.debug.regenerated[0].result, "refused");
  assert.equal(out.report.sections[0].cards[1], card(1));
  assert.deepEqual(out.debug.deleted.map((x) => x.sentence), ["You were 25 when it started."]);
  assert.match(restated.calls[0].fixes[0], /Remove ONLY the unsupported number/);
  // A rewrite that removes just the number is kept.
  const minimal = deps({ regenerate: async () => card(1) + " You were young when it started." });
  const out2 = await checkArchitectReport(report({ 1: bad }), ANSWERS, minimal.d);
  assert.equal(out2.debug.regenerated[0].result, "replaced");
  assert.ok(out2.report.sections[0].cards[1].endsWith("You were young when it started."));
});

test("advice wording: the card is rewritten once, then the sentence is deleted; advice bullets are deleted", async () => {
  const { d, calls } = deps();
  const r = report({ 11: card(11) + " Pause before reacting. Ask yourself what you need." });
  r.new_bullets = ["Try to stay calm", "Treating setbacks as interruptions", "Remember to breathe"];
  const out = await checkArchitectReport(r, ANSWERS, d);
  assert.equal(calls.length, 1);
  assert.match(calls[0].fixes.join(" "), /no task, instruction or advice/);
  const c = out.report.sections[3].cards[2];
  assert.ok(!/pause before|ask yourself/i.test(c));
  assert.ok(c.endsWith(DESIGN_CLOSING));
  assert.deepEqual(out.report.new_bullets, ["Treating setbacks as interruptions"]);
  assert.ok(out.debug.fired.some((f) => f.includes("advice wording")));
});

test('"chasing" and other banned wording: the card is rewritten once, then the sentence is deleted', async () => {
  const { d, calls } = deps();
  const out = await checkArchitectReport(report({ 9: card(9) + " You keep chasing the next win. The hidden tie is this: money hurts." }), ANSWERS, d);
  assert.equal(calls.length, 1);
  const c = out.report.sections[3].cards[0];
  assert.ok(!/chasing|hidden tie/i.test(c));
  assert.ok(out.debug.fired.some((f) => f.includes('"chasing"')));
});

test("em dashes: the card is rewritten once, then dashes are replaced with commas", async () => {
  const { d, calls } = deps();
  const out = await checkArchitectReport(report({ 0: card(0) + " Money was tense — always." }), ANSWERS, d);
  assert.deepEqual(calls[0].fixes, [CARD_FIX.dash]);
  assert.ok(out.report.sections[0].cards[0].endsWith("Money was tense, always."));
  assert.ok(out.debug.fired.some((f) => f.includes("em dash replaced")));
});

test("a 5-word phrase used twice inside one card: rewritten once, then the later sentence is deleted", async () => {
  assert.deepEqual(
    repeatedWithinCard("It has run since you were small. And it has run since you were small, quietly."),
    ["And it has run since you were small, quietly."],
  );
  assert.deepEqual(repeatedWithinCard("You went quiet at home. You went quiet at school."), [], "4 shared words is fine");
  // The fixed closing line stays; the other copy goes.
  const withClosing = "It has been running for a long time in you. " + DEFAULT_CLOSING;
  assert.deepEqual(repeatedWithinCard(withClosing, DEFAULT_CLOSING), ["It has been running for a long time in you."]);
  const { d, calls } = deps();
  const out = await checkArchitectReport(report({ 3: card(3) + " It has run since you were small. It has run since you were small, quietly." }), ANSWERS, d);
  assert.deepEqual(calls.map((c) => c.fixes), [[CARD_FIX.repeatedWithin]]);
  assert.ok(!out.report.sections[1].cards[0].includes("small, quietly"));
});

test("no sentence twice and no 8-word phrase in two cards: the later card is fixed", async () => {
  const shared = "You learned that money only ever arrives with a fight attached.";
  const { d, calls } = deps();
  const out = await checkArchitectReport(report({ 1: card(1) + " " + shared, 7: card(7) + " " + shared }), ANSWERS, d);
  assert.deepEqual(calls.map((c) => [c.section, c.card, c.fixes]), [[2, 1, [CARD_FIX.repeated]]]);
  assert.ok(out.report.sections[0].cards[1].includes(shared));
  assert.ok(!out.report.sections[2].cards[1].includes(shared));
});

test("a card under 40 words is rewritten once from the answers", async () => {
  const short = "You learned money was tense. You stayed quiet about it.";
  const { d, calls } = deps({ regenerate: async (s, c, fixes, current) => (fixes[0] === CARD_FIX.short ? card(22) : current.sections[s].cards[c]) });
  const out = await checkArchitectReport(report({ 3: short }), ANSWERS, d);
  assert.deepEqual(calls.map((c) => [c.section, c.card, c.fixes]), [[1, 0, [CARD_FIX.short]]]);
  assert.equal(out.report.sections[1].cards[0], card(22));
  assert.equal(MIN_CARD_WORDS, 40);
});

// ---------------------------------------------------------------------------
// The AI fact check: delete, or edit by removing words only

test("an EDIT is accepted only when it is the original with some words removed, in order", () => {
  const o = "You grew up hearing that bodies get fat and weak as you age.";
  assert.ok(isWordsRemovedOnly(o, "You grew up hearing that bodies get weak."));
  assert.ok(!isWordsRemovedOnly(o, "You grew up hearing that bodies get strong."), "a changed word");
  assert.ok(!isWordsRemovedOnly(o, "Bodies get fat, you grew up hearing."), "reordered");
  assert.ok(!isWordsRemovedOnly(o, o), "nothing removed");
  assert.ok(!isWordsRemovedOnly(o, ""), "empty");
});

test("the AI check edits a sentence by removing words, deletes when the edit adds words, and handles a dangling one", async () => {
  const target = card(4).split(". ")[1] + ".";
  const changed = card(5).split(". ")[0] + ".";
  const dangling = card(5).split(". ")[1] + ".";
  const editTo = target.split(" ").slice(0, 6).join(" ") + ".";
  const { d } = deps({
    factCheck: async (numbered) => {
      const n = (t: string) => numbered.find((x) => x.text === t)!.n;
      const flags: FactFlag[] = [
        { n: n(target), action: "edit", edit: editTo, reason: "Overstates what they said." },
        { n: n(changed), action: "edit", edit: "Something new entirely.", reason: "Invents an event." },
        { n: n(dangling), action: "delete", edit: "", reason: "Left dangling by the deletion." },
      ];
      return flags;
    },
  });
  const out = await checkArchitectReport(report(), ANSWERS, d);
  assert.ok(out.report.sections[1].cards[1].includes(editTo));
  assert.ok(!out.report.sections[1].cards[1].includes(target));
  assert.ok(!out.report.sections[1].cards[2].includes(changed));
  assert.ok(!out.report.sections[1].cards[2].includes(dangling));
  assert.equal(out.debug.edited.length, 1);
  assert.deepEqual(out.debug.deleted.filter((x) => x.by === "ai").map((x) => x.sentence), [changed, dangling]);
  assert.match(out.debug.deleted[0].reason, /edit changed words/);
});

test("the AI check's reason is one clean line", () => {
  assert.equal(cleanReason("Invents an age they never gave.\nMore thoughts here."), "Invents an age they never gave.");
  assert.equal(cleanReason("Not in their answers. However, on reflection it might be fine."), "Not in their answers.");
  const parsed = parseFactCheck('{"flagged":[{"n":2,"action":"edit","edit":"x","reason":"Bad. However fine"},{"n":3,"action":"weird","edit":"","reason":"r"}]}');
  assert.deepEqual(parsed, [
    { n: 2, action: "edit", edit: "x", reason: "Bad." },
    { n: 3, action: "delete", edit: "", reason: "r" },
  ]);
});

test("if the AI check fails, it is retried once, then the report ships with the code checks only, recorded", async () => {
  let calls = 0;
  const { d } = deps({ factCheck: async () => { calls++; throw new Error("overloaded"); } });
  const out = await checkArchitectReport(report({ 0: card(0) + " You were 25 then." }), ANSWERS, d);
  assert.equal(calls, 2);
  assert.equal(out.debug.aiCheck.status, "failed");
  assert.match(out.debug.aiCheck.error!, /overloaded/);
  assert.ok(!out.report.sections[0].cards[0].includes("25"), "the code checks still ran");
});

// ---------------------------------------------------------------------------
// Report JSON, section names, inputs

test("section labels: new names, same data shape, and earlier reports still parse and open", () => {
  assert.deepEqual([...SECTION_NAMES], ["Where it started", "Uncovered internal constraint", "Life by default", "Life by design"]);
  assert.equal(UI_TEXT.oldPattern, "Life by default");
  assert.equal(UI_TEXT.newPattern, "Life by design");
  // A batch 2 report saved with the old names has the same shape and still parses.
  const old = { ...report(), sections: report().sections.map((s, i) => ({ ...s, name: ["Where it started", "The hidden block", "Your old pattern", "Your new pattern"][i] })) };
  const parsed = parseReport(JSON.stringify(old), SECTION_NAMES);
  assert.ok(parsed);
  assert.deepEqual(parsed.sections.map((s) => s.name), [...SECTION_NAMES]);
  assert.equal(parseReport(JSON.stringify({ ...old, old_bullets: ["a", "b"] }), SECTION_NAMES), null);
  // Old (version 1) reports keep the old renderer.
  assert.equal(rendererFor(1), "legacy");
  assert.equal(rendererFor(undefined), "legacy");
  assert.equal(rendererFor(2), "architect");
});

test("the report input marks thin answers and leaves out the Yes / No taps", () => {
  let f = answeredUpTo(8);
  f = { ...f, answers: f.answers.map((a, i) => (i === 2 ? a + " " + "detail ".repeat(30) : a)) };
  const input = buildReportInput("money", withTap(withTap(f, true), false), false);
  assert.match(input, /THIN ANSWERS: Q1, Q2, Q4, Q5, Q6, Q7, Q8/);
  assert.ok(!input.includes(TAP_QUESTIONS[0]) && !input.includes(TAP_QUESTIONS[1]));
});

test("a crisis reaction shows the support line and makes the report SENSITIVE", () => {
  const f = react(withAnswer(emptyFlow(), "something heavy"), 1, true);
  assert.ok(isSensitive(f));
  const bubble = transcript(f, QUESTIONS.money, [...TAP_QUESTIONS]).find((b) => b.kind === "reaction");
  assert.ok(bubble && bubble.kind === "reaction" && bubble.crisis);
  assert.match(UI_TEXT.supportLine, /988/);
  assert.match(buildReportInput("money", f, isSensitive(f)), /SENSITIVE: true/);
});

test("sentencesOf keeps every sentence of a card", () => {
  assert.deepEqual(sentencesOf("One. Two? Three!"), ["One.", "Two?", "Three!"]);
});

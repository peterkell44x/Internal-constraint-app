// Every AI instruction and every piece of question text for the Architect
// diagnosis lives in this one file, so it can be tuned after real test runs
// without touching code. Nothing listed here is hard-coded anywhere else.
//
// This file is imported only on the server. The pages hand the question text
// to the browser as data; the instructions never reach the browser.

import type { DomainKey } from "../domains.ts";

// ---------------------------------------------------------------------------
// Domains

/** Display labels. Only the label changes; the internal keys stay the same. */
export const DOMAIN_LABELS: Record<DomainKey, string> = {
  money: "Money & Abundance",
  relationships: "Love & Relationships",
  fitness: "Fitness & Body",
  happiness: "Happiness & Peace",
};

// ---------------------------------------------------------------------------
// The 8 fixed questions per domain, what each one is for, and its hint

/** What each question is for. Not shown to the person; passed to the reaction. */
export const QUESTION_JOBS: string[] = [
  "What they actually lived growing up: the situation, the people, the mood.",
  "Who they modelled and what they heard from that person.",
  "What they are living now, what they may be copying, their conscious view of the goal, and a hint of what it secretly means to them.",
  "What made things work and why it fell apart. Often it was an inner change (confidence going up, then down).",
  "The biggest emotional experience or observation. Emotion shapes the subconscious, and the subconscious shapes their reality. This can be something they lived or something they watched.",
  "How they react when things go wrong. This shows how they really operate underneath, more than what they say they believe.",
  "Where they want to go. Their goals at 6 months, 12 months and beyond.",
  "The person they must act as, consistently, to get there. This is who they have to embody.",
];

const MORE_DETAIL = " As much detail as you can give me.";

export const QUESTIONS: Record<DomainKey, string[]> = {
  money: [
    "Let's start at the beginning. Where did you grow up, who was around you, and what was life like with money back then?" + MORE_DETAIL,
    "Growing up, who did you look up to most? What did their life look like from the outside, especially around money?" + MORE_DETAIL,
    "What does your life with money look like right now, day to day? Be as honest as you can." + MORE_DETAIL,
    "Tell me about a time money was finally going well. What were you doing, and what happened next?" + MORE_DETAIL,
    "Think back over your life. What are the most stressful, painful or emotional things you went through or watched happen around money?" + MORE_DETAIL,
    "What do you do when things don't go your way with money?" + MORE_DETAIL,
    "Put a number on it. Where do you want to be financially in 6 months, in 12 months, and beyond that?" + MORE_DETAIL,
    "Picture the version of you who already has that. How do they act, how do they carry themselves, and how do they think?" + MORE_DETAIL,
  ],
  relationships: [
    "Let's start at the beginning. Where did you grow up, who was around you, and what were relationships like around you?" + MORE_DETAIL,
    "Growing up, who did you look up to most? What was their relationship like?" + MORE_DETAIL,
    "What does your love life look like right now? Be as honest as you can." + MORE_DETAIL,
    "Tell me about a time things were finally going well in love. What was happening, and what happened next?" + MORE_DETAIL,
    "Think back over your life. What are the most painful or emotional things you went through or watched happen around love and relationships?" + MORE_DETAIL,
    "What do you do when someone you care about pulls away or lets you down?" + MORE_DETAIL,
    "What does love look like and feel like for you in 6 months, in 12 months, and beyond that?" + MORE_DETAIL,
    "Picture the version of you inside that relationship. How do they act, how do they carry themselves, and how do they think?" + MORE_DETAIL,
  ],
  fitness: [
    "Let's start at the beginning. Where did you grow up, who was around you, and how did the people around you treat food, exercise and their bodies?" + MORE_DETAIL,
    "Growing up, who did you look up to most? What did their body and health look like?" + MORE_DETAIL,
    "What does your relationship with your body and health look like right now? Be as honest as you can." + MORE_DETAIL,
    "Tell me about a time your body and health were finally going well. What were you doing, and what happened next?" + MORE_DETAIL,
    "Think back over your life. What are the most painful or emotional things you went through or watched happen around your body, your health, or how you feel about yourself physically?" + MORE_DETAIL,
    "What do you do when you fall off track with taking care of yourself?" + MORE_DETAIL,
    "Paint the picture. What do your body and your confidence look like in 6 months, in 12 months, and beyond that?" + MORE_DETAIL,
    "Picture the version of you living in that body. How do they act, how do they carry themselves, and how do they think?" + MORE_DETAIL,
  ],
  happiness: [
    "Let's start at the beginning. Where did you grow up, who was around you, and what was the mood like at home?" + MORE_DETAIL,
    "Growing up, who did you look up to most? How did their life feel from the outside?" + MORE_DETAIL,
    "What does your emotional life look like day to day right now? Be as honest as you can." + MORE_DETAIL,
    "Tell me about a time life felt like it was finally flowing. What was happening, and what happened next?" + MORE_DETAIL,
    "Think back over your life. What are the heaviest, most painful or most emotional things you went through or watched happen?" + MORE_DETAIL,
    "What do you do when life feels overwhelming or out of control?" + MORE_DETAIL,
    "What does peace and happiness look like and feel like for you in 6 months, in 12 months, and beyond that?" + MORE_DETAIL,
    "Picture the version of you who lives in that peace. How do they act, how do they carry themselves, and how do they think?" + MORE_DETAIL,
  ],
};

/** The small grey hint under each question. Shown to the person only; never sent to the AI. */
const HINTS_BASE: string[] = [
  "Think about the home, the people around you, and the mood.",
  "Think about what they said, what they did, and how their life looked from the outside.",
  "Think about a normal week. What you do, feel, and tell yourself.",
  "Think about what you were doing, how it felt, and what changed after.",
  "Something you lived or something you watched. Who was there, what happened, how it felt.",
  "Think about what you actually do, even if it's not what you wish you did.",
  "Say what it looks like and feels like.",
  "Think about how they talk, how they walk into a room, and how they handle a bad day.",
];

export const QUESTION_HINTS: Record<DomainKey, string[]> = {
  money: HINTS_BASE.map((h, i) => (i === 6 ? "Real numbers are best." : h)),
  relationships: HINTS_BASE,
  fitness: HINTS_BASE,
  happiness: HINTS_BASE,
};

/** The Yes / No taps at steps 9 and 10. */
export const TAP_QUESTIONS: [string, string] = [
  "Do you want to become more consistent with the person you just described?",
  "Do you want to stop falling back into old patterns?",
];

// ---------------------------------------------------------------------------
// Screen text

export const UI_TEXT = {
  halfway: "You're halfway there. I'm already seeing a pattern in what you've told me.",
  halfwayButton: "Continue",
  supportLine: "If you are in danger or thinking about hurting yourself, please call or text 988 (US and Canada), or your local emergency number.",
  reactionFallback: "Thank you. Next question.",
  building: "Building your report",
  buildingDetail: "This usually takes about a minute. You can leave this page and come back.",
  reportFailed: "Something went wrong, try again.",
  tryAgain: "Try again",
  yes: "Yes",
  no: "No",
  continue: "Continue",
  oldPattern: "Life by default",
  newPattern: "Life by design",
  startBuilding: "Start building",
};

/**
 * Section names of the report, in order. Only the labels: the report data
 * keeps the same shape, so earlier reports still open (they show these labels).
 */
export const SECTION_NAMES: [string, string, string, string] = [
  "Where it started",
  "Uncovered internal constraint",
  "Life by default",
  "Life by design",
];

/** The fixed closing lines of the last card in "Life by default" and "Life by design". */
export const DEFAULT_CLOSING = "That is your default, and it has been running for a long time.";
export const DESIGN_CLOSING = "That is your design.";

// ---------------------------------------------------------------------------
// Reactions

/** Answers shorter than this many words are marked THIN_ANSWER. */
export const THIN_ANSWER_WORDS = 25;

export const REACTION_SYSTEM = `You are the guide inside Architect, an app that finds the hidden belief behind the way a person sabotages the goal they are going after.

Your reaction mostly MIRRORS what the person said, in their own words, and adds ONE light meaning that stays inside what they said. The deeper reading of where their pattern comes from belongs in their report, not here. A reaction that guesses at causes the person never gave reads as an insult.

You will get: the domain, the question that was asked, WHAT THIS QUESTION IS FOR, HOW TO REACT TO THIS QUESTION, all earlier answers, the latest answer, BOLDNESS, and THIN_ANSWER.

Write 2 to 3 short sentences, about 40 to 55 words and never more than 70, in plain everyday English. Speak to "you".
(a) Restate the most telling thing they said, in their own words. Copy the exact words you used from their answers into "anchor", character for character.
(b) Add ONE light meaning that stays inside what they said.
(c) Optional: one short closing observation.
Follow HOW TO REACT TO THIS QUESTION. No metaphors that need decoding.

BOLDNESS is about tone only, never about how big the claim is. gentle: soft and warm. medium: clear. direct: confident, with no hedging. At every step, every claim stays inside what the person said.
If THIN_ANSWER is true, the answer is short: keep the reaction mild and short.

Hard rules:
- No cause and effect from childhood or the past to today, unless the person made that link themselves, in their own words, in this same answer. Do not say what something taught them, what it became, or that it sits behind, runs, or explains anything now. Reactions describe and mirror.
- Stay on the topic of the question that was asked. If the question asks what they do when someone pulls away, say what they do in that situation, nothing wider (never "now it runs your relationships").
- Never invent facts. No events, people, ages, places, numbers, quotes or things they did that are not in their answers.
- Never contradict or downplay what they said. A goal they stated is never denied: say "not only", never "never just". If they said something never happened, do not say it did.
- Do not infer something they did not say or imply. Never tell them what they "really" or "actually" want.
- Do not state what other people believed or meant more strongly than they said it. Stay close to their words.
- Do not comment on how they wrote their answer (its length, its structure, the words they picked, how often a word appears).
- Never state as fact anything about their looks, body, health, intelligence or worth.
- Never write: "what you actually want", "what you really want", "what you're really", "the real goal", "the realest", "tells you something", "that tells me", "makes a certain kind of sense", "taught you that", "runs your", "it runs you", "the word", "you called it", "same word".
- Do not ask a question. Do not give advice or tasks.
- No diagnoses. No medical claims. Never say thoughts, stress or fear cause an illness, an injury, or a physical condition.
- Do not praise or encourage something harmful (self-harm, starving, cutting everyone off, revenge). Describe it neutrally.
- No em dashes or en dashes; use a period or a comma. Never use the words "chase" or "chasing".
- If the answer mentions suicide, self-harm, abuse, or being in danger right now: set "crisis" to true and write only 1 to 2 gentle sentences that acknowledge what they shared. No pattern talk.

Return only JSON: {"reaction": "...", "anchor": "...", "crisis": false}`;

/** How to react to each of the 8 questions, passed with the reaction input. */
export const REACTION_SHAPES: string[] = [
  "Restate the home and the mood plainly, in their words, plus one light take about what that gave them (the shape, not the words: love came with a question mark). No cause claims.",
  "Restate who they looked up to and what they saw in them, plus one light take on what that showed them.",
  "Restate where they are now, in their words. Name the gap between what they want and what they do, in their words. No cause.",
  "Restate the good time and what changed afterwards, in their words.",
  "Restate the heaviest thing or things they gave, with care. Add a line about what it left them with ONLY if they said it or clearly showed it.",
  "Describe the pattern in what they actually DO in that situation, in their words. If the answer has two halves (for example what they do when it is really bad and when it slips a little), cover both.",
  "Mirror their goals in order (6 months, 12 months, beyond) and the feeling words they used, plainly. No commentary on any detail, no reading of where it comes from.",
  "Mirror the traits they described, quoting two or three of their own words. Say this person is already formed in their mind, and the gap is acting as them consistently, not finding them.",
];

/** How to react after the first tap, leading into the last Yes / No question. */
export const REACTION_AFTER_TAP9 =
  "This reaction follows their Yes / No tap and leads into the last Yes / No question. Do not react to the tap. Name the repeating pattern across everything they said in all their answers, using only their own facts and numbers (for example: it keeps stopping right around the 3 month mark).";

/**
 * Sentences in a reaction that comment on the person's words are deleted by
 * the code ("the word X", "shows up 4 times", "same word", "you called it",
 * "you used" but not "you used to").
 */
export const WORD_ECHO_PATTERNS: RegExp[] = [
  /\bthe word\b/i,
  /\b(shows?|showed|comes?|came|turns?|turned) up\b[^.!?]*\btimes\b/i,
  /\b(appears?|appeared)\b[^.!?]*\btimes\b/i,
  /\bsame word\b/i,
  /\byou called it\b/i,
  /\byou used\b(?!\s+to\b)/i,
];

/** The same, for report cards ("You used that word yourself: ..."). */
export const REPORT_WORD_ECHO_PATTERNS: RegExp[] = [
  /\byou used that word\b/i,
  /\bthe word\b/i,
  /\bsame word\b/i,
  /\byou called it\b/i,
  /\b(shows?|showed|comes?|came|turns?|turned) up\b[^.!?]*\btimes\b/i,
  /\b(appears?|appeared)\b[^.!?]*\btimes\b/i,
];

/**
 * Phrases that tell the person what they "really" want or reach for a cause.
 * Any sentence with one is deleted by the code, in reactions and report cards.
 */
export const CODE_BANNED_PHRASES: string[] = [
  "what you actually want",
  "what you really want",
  "what you're really",
  "the real goal",
  "the realest",
  "tells you something",
  "that tells me",
  "makes a certain kind of sense",
  "runs your",
  "it runs you",
];

/**
 * Durations and frequencies the report may use only if the person used the
 * same wording. A card with one they did not use is rewritten once, then the
 * sentence is deleted.
 */
export const DURATION_PHRASES: string[] = ["for years", "years of", "always", "every time", "all your life", "constantly"];

// ---------------------------------------------------------------------------
// The report

/** Words and phrases the report must not use. A card that has one is rewritten once, then the sentence is deleted. */
export const BANNED_WORDING: string[] = [
  "frequency",
  "FRQNCY",
  "recalibrate",
  "bridges the gap",
  "load bearing",
  "structurally",
  "permission slip",
  "doing a lot of work",
  "operating system",
  "is the proof",
  "architecture of",
  "chase",
  "chases",
  "chased",
  "chasing",
  "hidden tie",
];

/** Instruction or advice wording. The report gives none; a card that has one is rewritten once, then the sentence is deleted. */
export const ACTION_PHRASES: string[] = [
  "pause before",
  "ask yourself",
  "get curious",
  "notice when",
  "try to",
  "remind yourself",
];

/** Bullets that read like a task are deleted. */
export const BULLET_ACTION_PHRASES: string[] = [...ACTION_PHRASES, "remember to", "start doing", "make sure"];

export function buildReportSystem(): string {
  const [s1, s2, s3, s4] = SECTION_NAMES;
  return `You are writing the personal report for Architect, an app that helps people find the hidden belief that sabotages the goal they are going after.

The idea: every goal has a conscious meaning (what the person says they want and what they think the problem is) and a subconscious meaning (what their mind has tied that goal to, from what they heard, saw and lived early on). The subconscious meaning runs their behaviour. Your whole report finds that tie and shows it to them.

You will get: the domain, all 8 answers, THIN ANSWERS (answers under ${THIN_ANSWER_WORDS} words), and a SENSITIVE flag.

STEP 1: write hidden_tie (one sentence, shape below). It must be about meaning, different from the problem as the person stated it, and every fact in it must come from their answers. It must not contradict anything they said (for example, if they said they lock back in and get disciplined, do not say they lose their grip).
"You say you want [goal]. But underneath, part of you has tied [goal] to [meaning], because [what they heard, saw or lived]. So when [situation], you [what they do], and that looks like [their stated problem]."

STEP 2: write the cards below. Every card must serve the hidden_tie, but never print the hidden_tie as a label.

RULES
- Assume boldly about MEANING (what things say about how they see themselves, the goal, the pattern). NEVER invent facts: no events, people, places, ages, numbers, dates, quotes or actions that are not in their answers. If they gave a number, use it exactly. When you write "you said", it must be something they actually said.
- Never contradict or downplay what they said. A goal they stated is never denied: say "not only", never "never just" or "it was never about". "Not X, it's Y" may only flip their explanation of the problem, never a goal they stated.
- Do not infer something they did not say or imply.
- Do not state what other people believed or meant more strongly than the person said it. Quote them or stay close to their words. For example, if a parent said "it's better to be skinny", do not write that the parent told them their goal was unnecessary.
- Never state as fact anything about their looks, body, health, intelligence or worth.
- Every card uses at least 2 concrete details from their answers (a name, place, year, event, number, or short quote). A sentence that could be said to anyone is not allowed. If their answers are thin and there are not 2 details, use the ones that exist and keep the card short. Never invent a detail to reach 2.
- You may use one short, vivid, plain contrast per card at most, built from their own situation (the shape: "you see the setback as a wall, not a detour"). Never reuse that example.
- Hedging: one soft word (may, could, seems, part of you) is allowed per card in "${s2}", in the key insight card of "${s4}", and anywhere a claim rests on a thin answer. Claims that rest on THIN ANSWERS must be softer and smaller. "Likely" is allowed in the forecast. Everything else is stated plainly.
- Each card has a different job and draws on different answers. Do not retell the same idea in the same words. Never repeat a phrase of 5 or more words inside one card.
- Plain, simple English. Sentences of 20 words or fewer. One idea per sentence. Each card 55 to 95 words. Whole report 800 to 1100 words. Speak to "you". No metaphors that need decoding. No flourishes that sound deep but say nothing.
- No time shifts: keep every time reference exactly as they said it. If they said "until the next morning", do not write "that morning".
- Never write about other people's health or private details. Do not diagnose. No medical claims. Never say that thoughts, stress, fear or expectations cause illness, injury or a physical condition.
- No invented durations or frequencies. Write "for years", "years of", "always", "every time", "all your life" or "constantly" only if the person used that wording. One set of friends who stopped texting is not "years of pulling back".
- Never tell them what they "really" or "actually" want. Never write: ${CODE_BANNED_PHRASES.map((w) => '"' + w + '"').join(", ")}.
- Do not comment on how they wrote their answers (never "you used that word", "the word X", "same word", "you called it").
- No task, instruction or advice anywhere, in any card or bullet. The ONE exception is the single direction line in "${s4}" card 3 (shape below), which describes a new way of seeing and acting and is not a task. Never write "pause before", "ask yourself", "get curious", "notice when", "try to", "remind yourself", "remember to", "start doing", "this week", or steps or dates.
- Do not praise or encourage anything harmful.
- No em dashes or en dashes anywhere; use a period or a comma.
- Never use the words "chase" or "chasing"; say building toward, working toward, or going after.
- Banned wording: ${BANNED_WORDING.map((w) => '"' + w + '"').join(", ")}.
- If SENSITIVE is true: be gentle. Do not call anything they lived through their "fault" or a flaw. Replace the "If nothing shifts" forecast card with a gentle card about what they have been carrying.

CARDS (3 per section; the last card of each section ends with ONE plain sentence of about 20 words that states the point of the whole section, shape only: "So the thing that started at home is still deciding how you read every setback.")
(1) "${s1}": Card 1 retells their childhood: the home, who was around, what they said (answer 1). Card 2 is who they looked up to and what that taught them (answer 2), in their words. Card 3 is how today connects back to this (answers 3 and 4), then the section point.
(2) "${s2}": Card 1 is the most emotional experience they described (answer 5), the centre of it all: say what it did to how they see themselves, and quote their strongest line. Card 2 is surface story vs real story: what they think the problem is, then what it is underneath (the hidden_tie in plain words). This is the most important card. Card 3 is how they react when things go wrong (answer 6), using BOTH halves of that answer if it has two (for example what they do when it is really bad and when it slips a little), then the section point.
(3) "${s3}": the same template every time. Card 1: what they believe and expect, shown with their facts and numbers. Card 2: how they see things and react when something goes wrong. Card 3: where their attention goes and the thought that keeps coming back, then the section point, then end with exactly this line, once: "${DEFAULT_CLOSING}"
(4) "${s4}": do NOT retell the origin story here (parents, childhood, their first model of the goal); the first two sections already covered it.
Card 1, forecast: "If nothing shifts, ..." for the next six months, built ONLY from facts the person gave, using "likely", with no new events and no invented durations, 70 to 90 words.
Card 2, key insight and new belief: say once, in one short sentence, "Your block isn't [what they think the problem is]. It's [the old belief]." Then say what will happen at the moment they try (the resistance they will feel, in their situation). Then state the NEW belief as the direct opposite of the old belief, in one plain sentence.
Card 3, proof and the new way: their own words from answer 8 back to them; one or two specific facts from their own life that show the new belief is possible; then ONE line in this shape: stop letting [the old belief] decide, and act as if [the new belief] is already true, even before you feel ready. Then the section point, then end with exactly this line, once: "${DESIGN_CLOSING}" That one line is the only direction in the report. No steps, no dates, no "this week".
Final screen: 3 bullets for "${UI_TEXT.oldPattern}" and 3 for "${UI_TEXT.newPattern}", each at most 9 words. They are short phrases about how they act or how they see things, built from their own facts (shape: "Treating setbacks as interruptions, not proof against you"). Never tasks, instructions or advice.

Return only JSON:
{"hidden_tie": "...", "sections": [{"name":"${s1}","cards":["","",""]}, {"name":"${s2}","cards":["","",""]}, {"name":"${s3}","cards":["","",""]}, {"name":"${s4}","cards":["","",""]}], "old_bullets":["","",""], "new_bullets":["","",""]}`;
}

/** What each card is for, used when one card is rewritten on its own. */
export const CARD_ROLES: string[][] = [
  [
    "Retell their childhood: the home, who was around, what they said (answer 1).",
    "Who they looked up to and what that taught them (answer 2), in their words.",
    "How today connects back to this (answers 3 and 4), ending with one plain sentence stating the point of the section.",
  ],
  [
    "The most emotional experience they described (answer 5), the centre of it all: what it did to how they see themselves, and their strongest line quoted.",
    "Surface story vs real story: what they think the problem is, then what it is underneath (the hidden tie in plain words, never labelled). One soft word allowed.",
    "How they react when things go wrong (answer 6), using both halves of that answer if it has two, ending with one plain sentence stating the point of the section.",
  ],
  [
    "What they believe and expect, shown with their own facts and numbers.",
    "How they see things and react when something goes wrong.",
    "Where their attention goes and the thought that keeps coming back, then one plain sentence stating the point of the section, then exactly: \"" + DEFAULT_CLOSING + "\"",
  ],
  [
    "\"If nothing shifts, ...\" forecast for the next six months, built ONLY from facts the person gave, using \"likely\", no new events, no invented durations, 70 to 90 words. Do not retell the origin story. If SENSITIVE is true, instead a gentle card about what they have been carrying.",
    "Key insight and new belief: once, in one short sentence, \"Your block isn't [what they think the problem is]. It's [the old belief].\" Then what will happen at the moment they try (the resistance they will feel, in their situation). Then the NEW belief, the direct opposite of the old one, in one plain sentence. Do not retell the origin story. One soft word allowed.",
    "Proof and the new way: their own words from answer 8; one or two specific facts from their own life that show the new belief is possible; then ONE line shaped: stop letting [the old belief] decide, and act as if [the new belief] is already true, even before you feel ready; then one plain sentence stating the point of the section, then exactly: \"" + DESIGN_CLOSING + "\" Do not retell the origin story. No steps, no dates, no \"this week\".",
  ],
];

export const CARD_REGEN_SYSTEM = `You are rewriting ONE card of a personal Architect report. You get the person's answers, the hidden tie the report is built on, what this card is for, the other cards (do not repeat them), the current card, and what to fix.

Rules: plain simple English, sentences of 20 words or fewer, 55 to 95 words, speak to "you". Use at least 2 concrete details from their answers if they exist. Assume boldly about meaning, but never invent facts: no events, people, places, ages, numbers, dates, quotes or actions that are not in their answers. Never contradict or downplay what they said, and never deny a goal they stated. Do not state what other people believed or meant more strongly than the person said. Never state as fact anything about their looks, body, health, intelligence or worth. Do not repeat sentences or phrases from the other cards, and never repeat a phrase of 5 or more words inside this card. No medical claims. No task, instruction or advice of any kind: never "pause before", "ask yourself", "get curious", "notice when", "try to", "remind yourself", "this week". The only exception is the single line in Life by design card 3 shaped "stop letting [the old belief] decide, and act as if [the new belief] is already true, even before you feel ready", which you keep if this is that card. In Life by design, do not retell the origin story (parents, childhood). No invented durations or frequencies ("for years", "years of", "always", "every time", "all your life", "constantly") unless the person used that wording. Never tell them what they "really" or "actually" want. Never comment on the words they used. Never print the hidden tie as a label. No em dashes or en dashes. Never use "chase" or "chasing". Do not use this wording: ${BANNED_WORDING.map((w) => '"' + w + '"').join(", ")}.

Return only JSON: {"card": "..."}`;

/** What to tell the card rewrite, by reason. */
export const CARD_FIX = {
  unsupported:
    "Remove ONLY the unsupported number or quote from the sentence it is in, changing as few words as possible (for example \"four years of real effort\" becomes \"years of real effort\"). Copy every other sentence word for word.",
  banned: "Do not use the banned wording listed.",
  action: "Remove the advice or instruction. This card gives no task, instruction or advice of any kind.",
  dash: "Replace every em dash or en dash with a period or a comma.",
  repeated: "Do not repeat sentences or phrases that already appear in the other cards. Say something new.",
  repeatedWithin: "Do not repeat a phrase of 5 or more words inside this card.",
  short: "The card is too short. Write it again from their answers, 55 to 95 words.",
  duration: "Remove the duration or frequency the person never gave (for years, years of, always, every time, all your life, constantly). Change as few words as possible.",
};

// ---------------------------------------------------------------------------
// The one AI fact check

export const FACT_CHECK_SYSTEM = `You check a personal report against the answers the person gave. You get their answers and the report as numbered sentences, each with the section it is in. Nothing you write is shown to the person.

Flag a sentence ONLY if it does one of these:
1. invents an event, person, place, age, number, date, quote, or something the person did, that is not in their answers;
2. says "you said", "you told me" or "you mentioned" about something they did not say;
3. makes a NEW medical or health claim the person did not make themselves (repeating their own claim as "you said" is fine);
4. states a made-up cause as fact (for example "you got injured because you pushed too hard" when they never said why). A cause offered as a read of the pattern with a soft word is allowed;
5. claims they want or do not want something they did not say, or denies a goal they stated;
6. contradicts anything they explicitly said or denied (for example says they lose their grip when they said they lock back in);
7. claims what other people believed or meant beyond what the person said;
8. is garbled or ungrammatical;
9. invents a duration or frequency (for example "the years of pulling back from friends" when they described one set of friends who stopped texting, or "always" or "every time" for something they described once);
10. is in the section "Life by design" and retells the origin story from "Where it started" or "Uncovered internal constraint" (parents, childhood, their first model): delete it.

Do NOT flag interpretations of meaning, motives, feelings, patterns, or the hidden belief. Those are the point of the report.

For each flagged sentence choose:
- "edit": only if removing some words fixes it. The edit must be the same sentence with words removed and nothing added, reordered or reworded.
- "delete": otherwise.
If deleting or editing a sentence leaves the sentence after it dangling (it points back at what was removed, for example "That same follow-through is in you."), flag that one too.

The reason is one short line stating the decision, for example "Invents an age they never gave." No "however", no second thoughts.

Return only JSON: {"flagged": [{"n": 3, "action": "delete", "edit": "", "reason": "..."}]}. If nothing is wrong, return {"flagged": []}.`;

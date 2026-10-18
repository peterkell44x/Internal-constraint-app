// Deterministic text helpers for the Architect diagnosis: the repeated words
// passed to a reaction, sentence splitting, and the code checks on the report
// (numbers and quotes must come from the answers, banned wording, repeats).
//
// Pure module: no prompts, no database.

import type { RepeatedWord } from "./flow.ts";

const STOP_WORDS = new Set(
  ("about above after again against all also always and another any anyone anything around because been before being " +
    "below between both but could didnt does doesnt doing dont down during each even every everyone everything from " +
    "further have having here hers herself himself into itself just like little might more most much myself never " +
    "other others ourselves over really same should since some something still such than that thats their theirs " +
    "them themselves then there theres these they theyre thing things think this those though through under until " +
    "very want wanted were what whatever when where whether which while whom whose with would youre yours yourself " +
    "yourselves maybe gonna kinda sorta pretty")
    .split(" "),
);

/**
 * Words of 5 letters or more, other than common stop words, that appear 3 or
 * more times in a text. At most 2, most frequent first.
 */
export function repeatedWords(text: string): RepeatedWord[] {
  const counts = new Map<string, number>();
  for (const w of text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (w.length < 5 || STOP_WORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([word, count]) => ({ word, count }));
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Lowercase words only, apostrophes dropped, so "can't" matches "cant". */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Splits a card into paragraphs of sentences, keeping every character of each sentence. */
export function splitCard(card: string): string[][] {
  return card
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(/(?<=[.!?]["'”’)]?)\s+(?=\S)/).map((s) => s.trim()).filter(Boolean));
}

export function sentencesOf(card: string): string[] {
  return splitCard(card).flat();
}

/** The card without the given sentences. */
export function removeSentences(card: string, remove: Set<string>): string {
  return splitCard(card)
    .map((p) => p.filter((s) => !remove.has(s)).join(" "))
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Numbers

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1000000 };

/** "one", "two" and "three" count as a number in the report only before one of these words. */
const COUNT_NOUN = /^(year|years|month|months|week|weeks|day|days|hour|hours|minute|minutes|time|times|kid|kids|child|children|job|jobs|people|person|friend|friends|dollar|dollars|grand|k|pound|pounds|kg|kilo|kilos|lb|lbs|percent|session|sessions|grade|business|businesses|attempt|attempts|relationship|relationships|partner|partners|brother|brothers|sister|sisters)$/;
const SMALL_WORDS = new Set(["one", "two", "three"]);

export interface FoundNumber {
  value: number;
  /** The text that produced it, for the debug view. */
  text: string;
  /** The word right after it, lowercase. */
  next: string;
}

/**
 * Every number in a text, from digits ("4-5", "35k", "$6,000", "8th") or
 * number words ("four", "twenty five", "a hundred"). In report text
 * (`strictSmall`), "one", "two" and "three" only count before a counting
 * noun such as years or times, since they also count the report's own items.
 */
export function findNumbers(text: string, { strictSmall = false }: { strictSmall?: boolean } = {}): FoundNumber[] {
  const out: FoundNumber[] = [];
  const lower = text.toLowerCase().replace(/[’']/g, "");
  for (const m of lower.matchAll(/(\d[\d,]*(?:\.\d+)?)(k|m)?(?:st|nd|rd|th)?\b(?:[\s-]+([a-z]+))?/g)) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (m[2] === "k") n *= 1000;
    if (m[2] === "m") n *= 1000000;
    out.push({ value: n, text: m[1] + (m[2] ?? ""), next: m[3] ?? "" });
  }
  const words = lower.replace(/[^a-z]+/g, " ").split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let n: number | null = null;
    let j = i;
    if (w in TENS) {
      n = TENS[w];
      if (words[i + 1] in UNITS && UNITS[words[i + 1]] >= 1 && UNITS[words[i + 1]] <= 9) {
        n += UNITS[words[i + 1]];
        j = i + 1;
      }
    } else if (w in UNITS) {
      n = UNITS[w];
    } else if ((w === "a" || w === "an") && words[i + 1] in SCALES) {
      n = 1;
    }
    if (n === null) continue;
    if (words[j + 1] in SCALES) {
      n *= SCALES[words[j + 1]];
      j++;
    }
    const next = words[j + 1] ?? "";
    if (strictSmall && j === i && SMALL_WORDS.has(w) && !COUNT_NOUN.test(next)) {
      i = j;
      continue;
    }
    out.push({ value: n, text: words.slice(i, j + 1).join(" "), next });
    i = j;
  }
  return out;
}

/** The phrases in double quotation marks. */
export function findQuotes(text: string): string[] {
  return [...text.matchAll(/["“]([^"”]{2,}?)["”]/g)].map((m) => m[1].trim()).filter(Boolean);
}

/**
 * Numbers and quoted phrases in a piece of report text that are not in the
 * person's answers. "6 months" and "12 months" are allowed: every domain's
 * seventh question asks about 6 and 12 months.
 */
export function unsupportedItems(text: string, answers: string): string[] {
  const said = new Set(findNumbers(answers).map((n) => n.value));
  const out: string[] = [];
  for (const n of findNumbers(text, { strictSmall: true })) {
    if (said.has(n.value)) continue;
    if ((n.value === 6 || n.value === 12) && n.next.startsWith("month")) continue;
    out.push(n.text);
  }
  const answersNorm = " " + normalize(answers) + " ";
  for (const q of findQuotes(text)) {
    const qn = normalize(q);
    if (qn && !answersNorm.includes(" " + qn + " ")) out.push('"' + q + '"');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Banned wording and repeats

/** The banned words or phrases a text uses. */
export function bannedIn(text: string, banned: string[]): string[] {
  return banned.filter((b) => new RegExp("\\b" + b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(text));
}

const PHRASE_WORDS = 8;

function grams(text: string): Set<string> {
  const w = normalize(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + PHRASE_WORDS <= w.length; i++) out.add(w.slice(i, i + PHRASE_WORDS).join(" "));
  return out;
}

/**
 * Sentences of a card that repeat earlier text: the same sentence anywhere
 * earlier in the report (including earlier in the same card), or a run of 8
 * or more words shared with an earlier card.
 */
export function repeatedSentences(cards: string[], index: number): string[] {
  const earlierCards = cards.slice(0, index);
  const earlierSentences = new Set(earlierCards.flatMap(sentencesOf).map(normalize));
  const earlierGrams = new Set(earlierCards.flatMap((c) => [...grams(c)]));
  const out: string[] = [];
  for (const s of sentencesOf(cards[index])) {
    const n = normalize(s);
    if (!n) continue;
    if (earlierSentences.has(n) || [...grams(s)].some((g) => earlierGrams.has(g))) out.push(s);
    earlierSentences.add(n);
  }
  return out;
}

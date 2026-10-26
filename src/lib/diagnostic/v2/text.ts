// Deterministic text helpers for the Architect diagnosis: sentence splitting,
// and the code checks on reactions and the report (numbers and quotes must
// come from the answers, banned wording, dashes, repeats, anchors, edits).
//
// Pure module: no prompts, no database.

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
  // A simple difference between two ages (10 to 100) or two years (1900 to
  // 2100) the person gave is allowed: "since 18" and "I'm 22" make "four years".
  const ages = [...said].filter((n) => Number.isInteger(n) && n >= 10 && n <= 100);
  const years = [...said].filter((n) => Number.isInteger(n) && n >= 1900 && n <= 2100);
  for (const group of [ages, years]) for (const a of group) for (const b of group) if (a > b) said.add(a - b);
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

// ---------------------------------------------------------------------------
// Dashes, phrases, length, anchors, edits

/** True when a text has an em dash or en dash. */
export function hasDash(text: string): boolean {
  return /[—–]/.test(text);
}

/** Replaces every em dash and en dash with ", ". */
export function replaceDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/^,\s*/, "");
}

/** The sentences of a text that match any of the patterns. */
export function sentencesMatching(text: string, patterns: RegExp[]): string[] {
  return sentencesOf(text).filter((s) => patterns.some((p) => p.test(s)));
}

/**
 * Cuts a text to at most `max` words, only at the end of a full sentence.
 * The first sentence is always kept whole, even if it alone is longer.
 */
export function trimAtSentence(text: string, max: number): string {
  if (countWords(text) <= max) return text.trim();
  const kept: string[] = [];
  for (const s of sentencesOf(text)) {
    if (kept.length > 0 && countWords([...kept, s].join(" ")) > max) break;
    kept.push(s);
  }
  return kept.join(" ");
}

/** True when the anchor (copied words) really appears in the answers, ignoring case and punctuation. */
export function anchorInAnswers(anchor: string, answers: string): boolean {
  const a = normalize(anchor);
  return a.length > 0 && (" " + normalize(answers) + " ").includes(" " + a + " ");
}

/**
 * True when `edited` is `original` with some words removed and nothing
 * added, reworded or reordered (comparing words, ignoring case and
 * punctuation). An empty edit is not an edit.
 */
export function isWordsRemovedOnly(original: string, edited: string): boolean {
  const o = normalize(original).split(" ").filter(Boolean);
  const e = normalize(edited).split(" ").filter(Boolean);
  if (e.length === 0 || e.length >= o.length) return false;
  let i = 0;
  for (const w of e) {
    while (i < o.length && o[i] !== w) i++;
    if (i === o.length) return false;
    i++;
  }
  return true;
}

const WITHIN_WORDS = 5;

/**
 * Sentences of one card that repeat a phrase of 5 or more words already used
 * in the same card (earlier, or earlier in the same sentence). The `keep`
 * sentence (a fixed closing line) is read first, so the other copy is the one
 * flagged.
 */
export function repeatedWithinCard(card: string, keep?: string): string[] {
  const all = sentencesOf(card);
  const keepNorm = keep ? normalize(keep) : null;
  const ordered = keepNorm ? [...all.filter((s) => normalize(s) === keepNorm), ...all.filter((s) => normalize(s) !== keepNorm)] : all;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of ordered) {
    const w = normalize(s).split(" ").filter(Boolean);
    let repeated = false;
    const mine = new Set<string>();
    for (let i = 0; i + WITHIN_WORDS <= w.length; i++) {
      const g = w.slice(i, i + WITHIN_WORDS).join(" ");
      if (seen.has(g) || mine.has(g)) repeated = true;
      mine.add(g);
    }
    if (repeated && normalize(s) !== keepNorm) out.push(s);
    for (const g of mine) seen.add(g);
  }
  return out;
}

/**
 * Duration or frequency phrases in a text ("for years", "always") that the
 * person never used, comparing words and ignoring case and punctuation.
 */
export function durationsNotSaid(text: string, answers: string, phrases: string[]): string[] {
  const said = " " + normalize(answers) + " ";
  return bannedIn(text, phrases).filter((p) => !said.includes(" " + normalize(p) + " "));
}

const INSTRUCTION_LEAD = /^(?:just)?$|\b(?:should|could|need to|needs to|must|lets|you can)(?: just)?$/;

/**
 * The phrases a text uses as an instruction: at the start of a sentence
 * ("Try to relax.") or right after should, could, need to, must, let's or
 * you can ("you can try to rest"). "When you try to push through" is not one.
 */
export function instructionsIn(text: string, phrases: string[]): string[] {
  const found = new Set<string>();
  for (const s of sentencesOf(text)) {
    const n = " " + normalize(s) + " ";
    for (const p of phrases) {
      const key = " " + normalize(p) + " ";
      for (let at = n.indexOf(key); at !== -1; at = n.indexOf(key, at + 1)) {
        if (INSTRUCTION_LEAD.test(n.slice(0, at).trim())) found.add(p);
      }
    }
  }
  return [...found];
}

/** True when a fact check reason says the sentence should stay ("rescind", "is fine"). */
export function saysKeep(reason: string, keepPhrases: string[]): boolean {
  const n = " " + normalize(reason) + " ";
  return keepPhrases.some((p) => {
    const k = normalize(p);
    return k === "rescind" ? /\brescind/.test(n) : n.includes(" " + k + " ");
  });
}

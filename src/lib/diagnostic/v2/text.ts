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
/** "one" is not a quantity after these words ("the one time", "no one")... */
const ONE_AFTER = new Set(["the", "no", "any", "every", "that", "this", "each"]);
/** ...or before these ("one of them", "one another", "one who"). */
const ONE_BEFORE = new Set(["of", "another", "who", "that", "which", "thing"]);

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
    if (w === "one" && !(words[i + 1] in SCALES) && (ONE_AFTER.has(words[i - 1]) || ONE_BEFORE.has(words[i + 1]))) continue;
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

const CONTRACTIONS: Record<string, string> = {
  cant: "can not", cannot: "can not", wont: "will not", dont: "do not", doesnt: "does not", didnt: "did not",
  isnt: "is not", arent: "are not", wasnt: "was not", werent: "were not", havent: "have not", hasnt: "has not",
  hadnt: "had not", couldnt: "could not", wouldnt: "would not", shouldnt: "should not", mustnt: "must not",
  im: "i am", ive: "i have", youre: "you are", youve: "you have", youll: "you will", youd: "you would",
  theyre: "they are", theyve: "they have", theyll: "they will", hes: "he is", shes: "she is", thats: "that is",
  whats: "what is", theres: "there is", lets: "let us", ill: "i will", id: "i would",
};
// "ill" and "id" are real words too, but the same on both sides, so matching still works.

/** One word for the anchor match: first and second person are one word, third person is another, and am / are are one. */
const PERSON: Record<string, string> = {
  i: "_p1", me: "_p1", my: "_p1", mine: "_p1", you: "_p1", your: "_p1", yours: "_p1",
  he: "_p3", she: "_p3", they: "_p3", him: "_p3", her: "_p3", them: "_p3", his: "_p3", their: "_p3",
  am: "_be", are: "_be", was: "_was", were: "_was",
};

function anchorWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter(Boolean)
    .flatMap((w) => (CONTRACTIONS[w] ?? w).split(" "))
    .map((w) => PERSON[w] ?? w);
}

/**
 * True when the anchor (words copied from their answers) is really there,
 * forgivingly: case, punctuation and contractions are ignored, "I / my" and
 * "you / your" count as the same word, and so do "he / she / they / his /
 * their". It counts when the whole anchor appears as one run in the answers,
 * or when it does after dropping its first one or two words (a subject swap
 * such as "he" for "my dad"), as long as at least 4 words are left.
 */
export function anchorInAnswers(anchor: string, answers: string): boolean {
  const a = anchorWords(anchor);
  if (a.length === 0) return false;
  const hay = " " + anchorWords(answers).join(" ") + " ";
  const has = (words: string[]) => hay.includes(" " + words.join(" ") + " ");
  if (has(a)) return true;
  for (const drop of [1, 2]) if (a.length - drop >= 4 && has(a.slice(drop))) return true;
  return false;
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

const INSTRUCTION_LEAD = /^(?:then|so)?(?: ?just)?$|\b(?:should|could|need to|needs to|must|lets|you can)(?: just)?$/;

/**
 * The phrases a text uses as an instruction: at the start of a sentence,
 * after an optional "Then," or "So," ("Try to relax.") or right after should, could, need to, must, let's or
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

/** The keep-phrase a fact check reason uses ("rescind", "is fine"), or null if none. */
export function keepPhraseIn(reason: string, keepPhrases: string[]): string | null {
  const n = " " + normalize(reason) + " ";
  return (
    keepPhrases.find((p) => {
      const k = normalize(p);
      return k === "rescind" ? /\brescind/.test(n) : n.includes(" " + k + " ");
    }) ?? null
  );
}

/** True when a fact check reason says the sentence should stay. */
export function saysKeep(reason: string, keepPhrases: string[]): boolean {
  return keepPhraseIn(reason, keepPhrases) !== null;
}

/** True when a text contains the belief phrase, ignoring case, punctuation and spacing, with contractions expanded on both sides. */
export function containsBelief(text: string, belief: string | undefined): boolean {
  const b = belief ? plainWords(belief).join(" ") : "";
  return b.length > 0 && (" " + plainWords(text).join(" ") + " ").includes(" " + b + " ");
}

/** Lowercase words, punctuation removed, contractions expanded ("can't" becomes "can not"). */
export function plainWords(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean).flatMap((w) => (CONTRACTIONS[w] ?? w).split(" "));
}

/**
 * Frequency phrases in a text ("always", "every time") that the person's
 * answers do not back up. A phrase counts as backed only if the answers have
 * it together with the word that follows it in the same sentence of the
 * text: "always skinny" in the answers backs "always skinny", not "always
 * take". At the end of a sentence, the phrase alone in the answers is enough.
 */
export function frequenciesNotSaid(text: string, answers: string, phrases: string[]): string[] {
  const said = " " + plainWords(answers).join(" ") + " ";
  const out = new Set<string>();
  for (const sentence of sentencesOf(text)) {
    const w = plainWords(sentence);
    for (const p of phrases) {
      const pw = plainWords(p);
      for (let k = 0; k + pw.length <= w.length; k++) {
        if (pw.some((x, j) => w[k + j] !== x)) continue;
        const next = w[k + pw.length];
        const key = next ? [...pw, next].join(" ") : pw.join(" ");
        if (!said.includes(" " + key + " ")) out.add(p);
      }
    }
  }
  return [...out];
}

/**
 * The belief inside a constraint sentence: the words between "the belief
 * that " and ", and it is what stands between". Empty if it isn't there.
 */
export function beliefFromConstraint(constraint: string | undefined): string {
  const m = /the belief that\s+(.+?),?\s+and it is what stands between/i.exec(constraint ?? "");
  return m ? m[1].trim() : "";
}

/**
 * What the report screens show: the configured section names (stored names
 * are ignored, so old and new reports look the same) and the two bullet
 * headings, all in Title Case. Display only; stored data is unchanged.
 */
export function reportDisplay(
  sections: { name: string; cards: string[] }[],
  sectionNames: readonly string[],
  oldLabel: string,
  newLabel: string,
): { sections: { name: string; cards: string[] }[]; oldHeading: string; newHeading: string } {
  return {
    sections: sections.map((s, i) => ({ name: titleCase(sectionNames[i] ?? s.name), cards: s.cards.filter((c) => c.trim()) })),
    oldHeading: titleCase(oldLabel),
    newHeading: titleCase(newLabel),
  };
}

/** "Life by default" becomes "Life By Default": the first letter of every word capitalised, for display only. */
export function titleCase(text: string): string {
  return text.replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
}

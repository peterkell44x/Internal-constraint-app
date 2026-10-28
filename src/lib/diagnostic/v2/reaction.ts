// What a reaction shows: the retry rule, the neutral line on a real anchor
// miss, and the code clean-up applied to every reaction before it is shown: sentences
// that comment on the person's words ("the word X", "shows up 4 times"), tell
// them what they "really" want or reach for a cause ("runs your"), or use
// "chase", or use a timing or reference back the person never used ("at the
// same time", "the old fear") are deleted, dashes become commas, and the
// reaction is cut to 70 words at the end of a full sentence.
//
// Pure module.

import type { Boldness, Reaction } from "./flow.ts";
import { CODE_BANNED_PHRASES, NEUTRAL_LINES, TIMING_PHRASES, WORD_ECHO_PATTERNS } from "./prompts.ts";
import { parseReaction, REACTION_MAX_WORDS } from "./schema.ts";
import { anchorInAnswers, bannedIn, countWords, durationsNotSaid, hasDash, removeSentences, replaceDashes, sentencesMatching, sentencesOf, trimAtSentence } from "./text.ts";

const CHASE = [/\bchas(e|es|ed|ing)\b/i];

/** `answers` is everything the person has typed so far, for the timing check. */
export function cleanReaction(text: string, answers = ""): { text: string; fired: string[] } {
  const fired: string[] = [];
  let out = text.trim();
  const echo = sentencesMatching(out, WORD_ECHO_PATTERNS);
  if (echo.length) {
    out = removeSentences(out, new Set(echo));
    fired.push("word echo deleted");
  }
  const banned = sentencesOf(out).filter((s) => bannedIn(s, CODE_BANNED_PHRASES).length > 0);
  if (banned.length) {
    out = removeSentences(out, new Set(banned));
    fired.push("banned phrase deleted (" + banned.flatMap((s) => bannedIn(s, CODE_BANNED_PHRASES)).join(", ") + ")");
  }
  const chase = sentencesMatching(out, CHASE);
  if (chase.length) {
    out = removeSentences(out, new Set(chase));
    fired.push('"chasing" deleted');
  }
  const timing = sentencesOf(out).filter((s) => durationsNotSaid(s, answers, TIMING_PHRASES).length > 0);
  if (timing.length) {
    out = removeSentences(out, new Set(timing));
    fired.push("invented timing deleted (" + timing.flatMap((s) => durationsNotSaid(s, answers, TIMING_PHRASES)).join(", ") + ")");
  }
  if (hasDash(out)) {
    out = replaceDashes(out);
    fired.push("em dash replaced");
  }
  if (countWords(out) > REACTION_MAX_WORDS) {
    out = trimAtSentence(out, REACTION_MAX_WORDS);
    fired.push("trimmed to " + REACTION_MAX_WORDS + " words");
  }
  return { text: out.trim(), fired };
}

/** The plain line shown for a question instead of its reaction. */
export function neutralLine(step: number): string {
  return NEUTRAL_LINES[step - 1] ?? NEUTRAL_LINES[0];
}

/**
 * Runs the reaction call (at most twice) and decides what is shown.
 * Attempt 1 is retried if the call fails, the reply can't be used, its
 * anchor isn't in their answers, or it has a dash. If the anchor is still
 * not found after the retry, the question's neutral line is shown instead
 * (a crisis flag on the reply is kept, so the support line still shows).
 * If no usable reply comes back at all, the neutral line is shown too.
 * `answers` is everything the person has typed up to this question.
 */
export async function decideReaction(
  call: () => Promise<string>,
  step: number,
  answers: string,
  thin: boolean,
  boldness: Boldness,
): Promise<Reaction> {
  const problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = parseReaction(await call());
      if (!parsed) {
        problems.push("attempt " + attempt + ": reply was not valid");
        continue;
      }
      const anchorOk = anchorInAnswers(parsed.anchor, answers);
      const dash = hasDash(parsed.reaction);
      if (attempt === 1 && (!anchorOk || dash)) {
        problems.push("attempt 1: " + [!anchorOk && "anchor not found in their answers", dash && "em dash"].filter(Boolean).join(", "));
        continue;
      }
      if (!anchorOk) {
        problems.push("attempt 2: anchor not found in their answers");
        return { step, text: neutralLine(step), crisis: parsed.crisis, neutral: true, anchor: parsed.anchor, anchorOk, thin, boldness, attempts: 2, problems };
      }
      const { text, fired } = cleanReaction(parsed.reaction, answers);
      if (!text) {
        problems.push("attempt " + attempt + ": nothing left after the code checks");
        continue;
      }
      return { step, text, crisis: parsed.crisis, anchor: parsed.anchor, anchorOk, thin, boldness, fired, attempts: attempt, problems };
    } catch (e) {
      problems.push("attempt " + attempt + ": " + (e instanceof Error ? e.message : String(e)));
    }
  }
  return { step, text: neutralLine(step), crisis: false, fallback: true, neutral: true, thin, boldness, attempts: 2, problems };
}

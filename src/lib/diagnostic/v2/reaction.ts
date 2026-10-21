// The code clean-up applied to every reaction before it is shown: sentences
// that comment on the person's words ("the word X", "shows up 4 times"), tell
// them what they "really" want or reach for a cause ("runs your"), or use
// "chase" are deleted, dashes become commas, and the reaction is cut to 70
// words at the end of a full sentence.
//
// Pure module.

import { CODE_BANNED_PHRASES, WORD_ECHO_PATTERNS } from "./prompts.ts";
import { REACTION_MAX_WORDS } from "./schema.ts";
import { bannedIn, countWords, hasDash, removeSentences, replaceDashes, sentencesMatching, sentencesOf, trimAtSentence } from "./text.ts";

const CHASE = [/\bchas(e|es|ed|ing)\b/i];

export function cleanReaction(text: string): { text: string; fired: string[] } {
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

import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { DomainKey } from "../domains";
import { checkArchitectReport, type CheckDebug } from "./checks";
import { isSensitive, TAP_REACTION_STEP, type Flow, type Reaction } from "./flow";
import { answersText, buildCardInput, buildFactCheckInput, buildReactionInput, buildReportInput } from "./inputs";
import {
  buildReportSystem,
  CARD_REGEN_SYSTEM,
  FACT_CHECK_SYSTEM,
  REACTION_SYSTEM,
  SECTION_NAMES,
  UI_TEXT,
} from "./prompts";
import {
  type ArchitectReport,
  CARD_SCHEMA,
  FACT_CHECK_SCHEMA,
  parseCard,
  parseFactCheck,
  parseReaction,
  parseReport,
  REACTION_SCHEMA,
  reactionProblems,
  REPORT_SCHEMA,
  salvageReaction,
} from "./schema";
import { repeatedWords } from "./text";

// The same model the app has always used, overridable with ANTHROPIC_MODEL.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/** One structured call; returns the raw JSON text. Throws if the call fails. */
async function callJSON(system: string, input: string, schema: Record<string, unknown>, maxTokens: number): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: input }],
    output_config: { format: { type: "json_schema", schema } },
  });
  if (response.stop_reason === "max_tokens") throw new Error("reply cut off at " + maxTokens + " tokens");
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The reaction to one answer (steps 1 to 8) or to the first tap (step 9).
 * Retried once if the call fails or the reply can't be used; after that the
 * neutral fallback line is used, so the chat is never blocked.
 */
export async function generateReaction(domain: DomainKey, f: Flow, step: number): Promise<Reaction> {
  const repeated = step === TAP_REACTION_STEP ? [] : repeatedWords(f.answers[step - 1] ?? "");
  const input = buildReactionInput(domain, f, step, repeated);
  const problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = parseReaction(await callJSON(REACTION_SYSTEM, input, REACTION_SCHEMA, 600));
      if (!parsed) {
        problems.push("attempt " + attempt + ": reply was not valid");
        continue;
      }
      const issues = reactionProblems(parsed.reaction, repeated);
      if (issues.length && attempt === 1) {
        problems.push("attempt 1: " + issues.join("; "));
        continue;
      }
      // On the second attempt a usable but imperfect reaction is trimmed rather than dropped.
      const text = issues.length ? salvageReaction(parsed.reaction, repeated) : parsed.reaction;
      if (issues.length) problems.push("attempt 2: " + issues.join("; ") + " (trimmed)");
      if (!text) break;
      return { step, text, crisis: parsed.crisis, repeatedWords: repeated, attempts: attempt, problems };
    } catch (e) {
      problems.push("attempt " + attempt + ": " + message(e));
    }
  }
  console.error("Reaction " + step + " failed; using the fallback line", problems);
  return { step, text: UI_TEXT.reactionFallback, crisis: false, fallback: true, repeatedWords: repeated, attempts: 2, problems };
}

/** What the report checks saw and did, stored with the report for the debug view. */
export interface ArchitectChecks extends CheckDebug {
  version: 2;
  hiddenTie: string;
  sensitive: boolean;
  reportAttempts: number;
  reportProblems: string[];
  ms: number;
}

/**
 * Writes the report in one call (retried once if it fails or is invalid),
 * then runs the code checks and the one AI check. Throws if the report
 * itself can't be written, so the person can try again.
 */
export async function generateArchitectReport(
  domain: DomainKey,
  f: Flow,
): Promise<{ report: ArchitectReport; original: ArchitectReport; checks: ArchitectChecks }> {
  const started = Date.now();
  const sensitive = isSensitive(f);
  const system = buildReportSystem();
  const input = buildReportInput(domain, f, sensitive);
  const problems: string[] = [];
  let original: ArchitectReport | null = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= 2 && !original; attempt++) {
    attempts = attempt;
    try {
      original = parseReport(await callJSON(system, input, REPORT_SCHEMA, 8000), SECTION_NAMES);
      if (!original) problems.push("attempt " + attempt + ": reply did not match the report shape");
    } catch (e) {
      problems.push("attempt " + attempt + ": " + message(e));
    }
  }
  if (!original) throw new Error("The report could not be written (" + problems.join("; ") + ")");

  const answers = answersText(f);
  const { report, debug } = await checkArchitectReport(original, answers, {
    async regenerate(section, card, fixes, current) {
      try {
        return parseCard(
          await callJSON(CARD_REGEN_SYSTEM, buildCardInput(domain, f, current, section, card, fixes, sensitive), CARD_SCHEMA, 1200),
        );
      } catch (e) {
        console.error("Card rewrite failed", e);
        return null;
      }
    },
    async factCheck(numbered) {
      const flagged = parseFactCheck(await callJSON(FACT_CHECK_SYSTEM, buildFactCheckInput(domain, f, numbered), FACT_CHECK_SCHEMA, 3000));
      if (flagged === null) throw new Error("the fact check reply was not valid");
      return flagged;
    },
  });
  if (debug.aiCheck.status === "failed") console.error("Report AI check failed twice; shipped with code checks only", debug.aiCheck.error);

  return {
    report,
    original,
    checks: {
      version: 2,
      hiddenTie: original.hidden_tie,
      sensitive,
      reportAttempts: attempts,
      reportProblems: problems,
      ms: Date.now() - started,
      ...debug,
    },
  };
}

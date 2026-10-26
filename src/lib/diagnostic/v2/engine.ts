import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { DomainKey } from "../domains";
import { checkArchitectReport, type CheckDebug } from "./checks";
import { boldnessFor, isSensitive, type Flow, type Reaction } from "./flow";
import {
  answersText,
  buildCardInput,
  buildConstraintInput,
  buildDanglingInput,
  buildFactCheckInput,
  buildReactionInput,
  buildReportInput,
} from "./inputs";
import {
  buildReportSystem,
  CARD_REGEN_SYSTEM,
  CONSTRAINT_START,
  CONSTRAINT_SYSTEM,
  DANGLING_CHECK_SYSTEM,
  FACT_CHECK_SYSTEM,
  REACTION_SYSTEM,
  SECTION_NAMES,
  THIN_ANSWER_WORDS,
  UI_TEXT,
} from "./prompts";
import { cleanReaction } from "./reaction";
import {
  type ArchitectReport,
  CARD_SCHEMA,
  CONSTRAINT_SCHEMA,
  FACT_CHECK_SCHEMA,
  parseCard,
  parseConstraint,
  parseFactCheck,
  parseReaction,
  parseReport,
  REACTION_SCHEMA,
  REPORT_SCHEMA,
} from "./schema";
import { anchorInAnswers, countWords, hasDash, normalize } from "./text";

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
 * The reaction to one answer (steps 1 to 8). Retried once if the call fails, the reply can't be used, its anchor isn't
 * in their answers, or it has a dash. After that the code clean-up fixes what
 * it can, and if nothing usable is left, the neutral line is shown, so the
 * chat is never blocked.
 */
export async function generateReaction(domain: DomainKey, f: Flow, step: number): Promise<Reaction> {
  const thin = countWords(f.answers[step - 1] ?? "") < THIN_ANSWER_WORDS;
  const boldness = boldnessFor(step);
  const input = buildReactionInput(domain, f, step, boldness, thin);
  const answers = f.answers.slice(0, step).join("\n");
  const problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = parseReaction(await callJSON(REACTION_SYSTEM, input, REACTION_SCHEMA, 600));
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
      const { text, fired } = cleanReaction(parsed.reaction, answers);
      if (!text) {
        problems.push("attempt " + attempt + ": nothing left after the code checks");
        continue;
      }
      return { step, text, crisis: parsed.crisis, anchor: parsed.anchor, anchorOk, thin, boldness, fired, attempts: attempt, problems };
    } catch (e) {
      problems.push("attempt " + attempt + ": " + message(e));
    }
  }
  console.error("Reaction " + step + " failed; using the fallback line", problems);
  return { step, text: UI_TEXT.reactionFallback, crisis: false, fallback: true, thin, boldness, attempts: 2, problems };
}

/** What the report checks saw and did, stored with the report for the debug view. */
export interface ArchitectChecks extends CheckDebug {
  version: 2;
  hiddenTie: string;
  sensitive: boolean;
  reportAttempts: number;
  reportProblems: string[];
  /** Where the constraint sentence came from: the report, a second call, or nowhere. */
  constraintSource: "report" | "regenerated" | "missing";
  ms: number;
}

/** True when a constraint sentence has the required opening. */
function constraintOk(text: string | undefined): boolean {
  return !!text && normalize(text).startsWith(normalize(CONSTRAINT_START));
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

  // The constraint sentence: if the report has none (or not in its shape),
  // one more call writes only that; if that fails too, the report ships without it.
  let constraintSource: ArchitectChecks["constraintSource"] = "report";
  if (!constraintOk(original.constraint)) {
    let again: string | null = null;
    try {
      again = parseConstraint(await callJSON(CONSTRAINT_SYSTEM, buildConstraintInput(domain, f, original.hidden_tie), CONSTRAINT_SCHEMA, 400));
    } catch (e) {
      problems.push("constraint call: " + message(e));
    }
    constraintSource = constraintOk(again ?? undefined) ? "regenerated" : "missing";
    original = { ...original, constraint: constraintSource === "regenerated" ? again! : "" };
  }

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
    async danglingCheck(_section, _card, numbered, deleted) {
      const flagged = parseFactCheck(await callJSON(DANGLING_CHECK_SYSTEM, buildDanglingInput(numbered, deleted), FACT_CHECK_SCHEMA, 1000));
      if (flagged === null) throw new Error("the card check reply was not valid");
      return flagged;
    },
  });
  if (debug.aiCheck.status === "failed") console.error("Report AI check failed twice; shipped with code checks only", debug.aiCheck.error);

  return {
    report,
    original,
    checks: {
      version: 2,
      hiddenTie: report.hidden_tie,
      sensitive,
      reportAttempts: attempts,
      reportProblems: problems,
      constraintSource,
      ms: Date.now() - started,
      ...debug,
    },
  };
}

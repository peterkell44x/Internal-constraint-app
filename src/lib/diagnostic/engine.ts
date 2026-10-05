import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { DOMAINS, type DomainKey } from "./domains";
import {
  BEGIN_MESSAGE,
  FORCE_CLOSE_SYSTEM_PROMPT,
  HARD_CEILING,
  READY_MARKER,
  REPORT_REQUEST_MESSAGE,
  REPORT_SPLIT_MARKER,
  buildReportSystem,
  buildSystemPrompt,
} from "./prompts";
import {
  applyDeletions,
  buildCutInput,
  buildCutSystem,
  isOverLimits,
  isOvercut,
  isWellFormed,
  numberSentences,
  parseDeletions,
  reportLengths,
} from "./review";
import {
  AUDIT_SCHEMA,
  type Attempt,
  type Audit,
  buildAuditInput,
  buildAuditSystem,
  buildCheckInput,
  buildCheckSystem,
  buildRetryNote,
  CHECK_SCHEMA,
  formatTranscript,
  parseAudit,
  parseViolations,
  pickBest,
  type Violation,
} from "./denial";
import { splitReadyMarker, splitReport, stripDashes } from "./text";

// Server-side port of the prototype's diagnostic engine. The model call
// parameters, dash stripping, readiness marker handling, hard ceiling and
// report splitting all match the prototype exactly; the only difference is
// that the conversation now lives in the database instead of browser memory.

export type ChatMessage = { role: "user" | "assistant"; content: string };

// The model and max_tokens the prototype was tuned on.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = 1000;
// The report is much longer than a chat turn; give it headroom so it is never
// cut off before the counter belief section. Length is controlled by the prompt.
const REPORT_MAX_TOKENS = 2000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

async function callClaude(msgs: ChatMessage[], system: string, maxTokens = MAX_TOKENS): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: msgs,
  });
  if (response.stop_reason === "max_tokens") {
    console.warn("Claude reply hit max_tokens (" + maxTokens + ") and was cut off");
  }
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .trim();
  return stripDashes(text);
}

/** Turns an API failure into a message that is safe to show the user. */
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) {
    return "The AI service is busy right now. Please try again in a moment.";
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return "The server's AI API key is missing or invalid.";
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return "Could not reach the AI service. Please try again.";
  }
  if (e instanceof Anthropic.APIError) {
    return "The AI service returned an error (" + (e.status ?? "unknown") + "). Please try again.";
  }
  return "Something went wrong. Please try again.";
}

export interface TurnResult {
  messages: ChatMessage[];
  reply: string;
  ready: boolean;
}

// Mirrors the prototype's handleReply(): strip the marker, record the reply.
function applyReply(history: ChatMessage[], reply: string): TurnResult {
  const { clean, ready } = splitReadyMarker(reply, READY_MARKER);
  return {
    messages: [...history, { role: "assistant", content: clean }],
    reply: clean,
    ready,
  };
}

/** Mirrors the prototype's startConversation(). */
export async function startConversation(domain: DomainKey): Promise<TurnResult> {
  const firstMsgs: ChatMessage[] = [{ role: "user", content: BEGIN_MESSAGE }];
  const reply = await callClaude(firstMsgs, buildSystemPrompt(DOMAINS[domain]));
  return applyReply(firstMsgs, reply);
}

/**
 * Mirrors the prototype's sendMessage(). `userTurns` is the count before this
 * answer; the returned history includes the new user turn and the reply.
 */
export async function sendUserMessage(
  domain: DomainKey,
  history: ChatMessage[],
  userTurns: number,
  text: string,
): Promise<TurnResult & { userTurns: number }> {
  const messages: ChatMessage[] = [...history, { role: "user", content: text }];
  const turns = userTurns + 1;
  const forceClose = turns >= HARD_CEILING;
  const system = forceClose ? FORCE_CLOSE_SYSTEM_PROMPT : buildSystemPrompt(DOMAINS[domain]);
  const reply = await callClaude(messages, system);
  return { ...applyReply(messages, reply), userTurns: turns };
}

export interface Report {
  raw: string;
  narrative: string;
  constraint: string;
  counterBelief: string;
  /** The first draft before review, kept for tuning. */
  draft: string;
}

// The cut reply is the model's working notes (it checks which sentences others
// depend on, which can run long) followed by the list of sentence numbers.
// At 1000 tokens the notes were cut off before the list in testing.
const CUT_MAX_TOKENS = 4000;

// At most this many length passes. Each runs only while a part is still over
// its word limit (in testing, one pass usually suffices).
const MAX_CUT_PASSES = 3;

/** Today's date, so the report can read "last year" correctly instead of guessing a year. */
function todayLine(): string {
  const today = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date());
  return "\n\nToday's date is " + today + ". Use it only to make sense of time references they made, such as last year. Do not put a date or year in the profile unless they stated it.";
}

/**
 * Added when the conversation was closed by the answer limit. Reaching the
 * limit means the chat never declared the connection confirmed, so the report
 * must not manufacture one.
 */
const CEILING_REPORT_NOTE =
  "\n\nThis conversation reached its answer limit before the connection between the origin belief and their current behavior was tested and confirmed. Build the narrative, the mechanism, the constraint, and the counter belief only from what they actually stated or confirmed. If no specific belief and mechanism was confirmed, state the constraint at the level the conversation actually supports, even if that makes it less specific, rather than constructing a sharper one. This takes priority over the instructions above to go deeper, to build a case, and to make the constraint sting. Do not mention the answer limit or that the conversation ended early.";

/**
 * Writes one report: a draft, then the length pass. Returns the draft and the
 * shortened version.
 */
async function draftAndCut(
  domain: DomainKey,
  reportMsgs: ChatMessage[],
  system: string,
): Promise<{ draft: string; final: string }> {
  const draft = await callClaude(reportMsgs, system, REPORT_MAX_TOKENS);

  let current = draft;
  for (let pass = 1; pass <= MAX_CUT_PASSES; pass++) {
    const parts = splitReport(current, REPORT_SPLIT_MARKER);
    if (!isOverLimits(parts)) break;
    const sentences = numberSentences(parts);
    let reply: string;
    try {
      reply = await callClaude(
        [{ role: "user", content: buildCutInput(sentences, parts) }],
        buildCutSystem(DOMAINS[domain]),
        CUT_MAX_TOKENS,
      );
    } catch (e) {
      // A shortened report is better, but an over-length one beats no report.
      console.error("Report length pass " + pass + " failed; keeping the previous version", e);
      break;
    }
    const revised = applyDeletions(sentences, parseDeletions(reply), parts);
    // An unusable reply (no list, only locked sentences, or far too much cut)
    // changes nothing and the next pass simply asks again.
    if (revised === current || !isWellFormed(revised)) {
      console.warn("Report length pass " + pass + " removed nothing usable; trying again");
      continue;
    }
    if (isOvercut(parts, splitReport(revised, REPORT_SPLIT_MARKER))) {
      console.warn("Report length pass " + pass + " cut far more than needed; trying again");
      continue;
    }
    const before = reportLengths(parts);
    const after = reportLengths(splitReport(revised, REPORT_SPLIT_MARKER));
    console.info(
      "Report length pass " + pass + ": words " +
        [before.narrative, before.constraint, before.counterBelief].join("/") + " -> " +
        [after.narrative, after.constraint, after.counterBelief].join("/"),
    );
    current = revised;
  }
  return { draft, final: current };
}

// Calls that return JSON matching a schema. No dash stripping: the output is
// data for the code, never shown to the person.
async function callJSON(system: string, input: string, schema: Record<string, unknown>): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: CHECK_MAX_TOKENS,
    system,
    messages: [{ role: "user", content: input }],
    output_config: { format: { type: "json_schema", schema } },
  });
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** Lists what the person rejected and confirmed, or null if the call fails. */
async function auditConversation(transcript: string): Promise<Audit | null> {
  try {
    return parseAudit(await callJSON(buildAuditSystem(), buildAuditInput(transcript), AUDIT_SCHEMA));
  } catch (e) {
    console.error("Report audit failed; the report will ship unchecked", e);
    return null;
  }
}

/** Lists the report's violations of the audit, or null if the call fails. */
async function checkReport(transcript: string, audit: Audit, report: string): Promise<Violation[] | null> {
  try {
    return parseViolations(await callJSON(buildCheckSystem(), buildCheckInput(transcript, audit, report), CHECK_SCHEMA));
  } catch (e) {
    console.error("Report check failed", e);
    return null;
  }
}

// The audit and check replies are short lists.
const CHECK_MAX_TOKENS = 4000;

// Regenerations after the first attempt when the check finds violations.
const MAX_DENIAL_RETRIES = 2;

/** What the denial check saw, stored with the report for tuning. */
export interface ReportChecks {
  audit: Audit | null;
  attempts: { violations: Violation[] | null }[];
  shipped: number; // index into attempts
}

/**
 * Mirrors the prototype's report button handler, followed by the length pass
 * and the denial check.
 */
export async function generateReport(
  domain: DomainKey,
  history: ChatMessage[],
  userTurns: number,
): Promise<Report & { checks: ReportChecks }> {
  const reportMsgs: ChatMessage[] = history.concat([{ role: "user", content: REPORT_REQUEST_MESSAGE }]);
  const hitCeiling = userTurns >= HARD_CEILING;
  const system = buildReportSystem(DOMAINS[domain]) + todayLine() + (hitCeiling ? CEILING_REPORT_NOTE : "");
  const transcript = formatTranscript(history, BEGIN_MESSAGE);

  // The audit only needs the conversation, so it runs alongside the first draft.
  const [first, audit] = await Promise.all([draftAndCut(domain, reportMsgs, system), auditConversation(transcript)]);

  const attempts: Attempt<{ draft: string; final: string }>[] = [];
  if (!audit) {
    attempts.push({ value: first, violations: null });
  } else {
    let value = first;
    const flagged: Violation[] = [];
    for (let i = 0; i <= MAX_DENIAL_RETRIES; i++) {
      if (i > 0) value = await draftAndCut(domain, reportMsgs, system + buildRetryNote(flagged));
      const violations = await checkReport(transcript, audit, value.final);
      attempts.push({ value, violations });
      console.info(
        "Report denial check attempt " + (i + 1) + ": " +
          (violations === null ? "check failed" : violations.length + " violation(s)"),
      );
      // Stop when clean, or when the check can't run (nothing to retry against).
      if (violations === null || violations.length === 0) break;
      flagged.push(...violations);
    }
  }

  const best = pickBest(attempts);
  const checks: ReportChecks = {
    audit,
    attempts: attempts.map((a) => ({ violations: a.violations })),
    shipped: attempts.indexOf(best),
  };
  const { draft, final } = best.value;
  return { raw: final, draft, ...splitReport(final, REPORT_SPLIT_MARKER), checks };
}

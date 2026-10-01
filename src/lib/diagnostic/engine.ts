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
  buildReviewInput,
  buildReviewSystem,
  extractProfile,
  isOverLimits,
  isWellFormed,
  reportLengths,
} from "./review";
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

// The review reply holds an issue list plus the full corrected profile.
const REVIEW_MAX_TOKENS = 3000;

// At most this many length passes. Each runs only while a part is still over
// its word limit (in testing, one pass usually suffices).
const MAX_REVIEW_PASSES = 3;

/** Today's date, so the report can read "last year" correctly instead of guessing a year. */
function todayLine(): string {
  const today = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date());
  return "\n\nToday's date is " + today + ". Use it only to make sense of time references they made, such as last year. Do not put a date or year in the profile unless they stated it.";
}

/** Mirrors the prototype's report button handler, followed by the length pass. */
export async function generateReport(domain: DomainKey, history: ChatMessage[]): Promise<Report> {
  const reportMsgs: ChatMessage[] = history.concat([{ role: "user", content: REPORT_REQUEST_MESSAGE }]);
  const draft = await callClaude(reportMsgs, buildReportSystem(DOMAINS[domain]) + todayLine(), REPORT_MAX_TOKENS);

  let current = draft;
  for (let pass = 1; pass <= MAX_REVIEW_PASSES; pass++) {
    const parts = splitReport(current, REPORT_SPLIT_MARKER);
    if (!isOverLimits(parts)) break;
    let reply: string;
    try {
      reply = await callClaude(
        [{ role: "user", content: buildReviewInput(current, parts) }],
        buildReviewSystem(DOMAINS[domain]),
        REVIEW_MAX_TOKENS,
      );
    } catch (e) {
      // A shortened report is better, but an over-length one beats no report.
      console.error("Report review pass " + pass + " failed; keeping the previous version", e);
      break;
    }
    const revised = extractProfile(reply) ?? "";
    if (!isWellFormed(revised)) {
      console.warn(
        "Report review pass " + pass + " returned a malformed report; keeping the previous version. Start: " +
          JSON.stringify(reply.slice(0, 200)),
      );
      break;
    }
    const before = reportLengths(parts);
    const after = reportLengths(splitReport(revised, REPORT_SPLIT_MARKER));
    console.info(
      "Report review pass " + pass + ": words " +
        [before.narrative, before.constraint, before.counterBelief].join("/") + " -> " +
        [after.narrative, after.constraint, after.counterBelief].join("/"),
    );
    current = revised;
  }

  return { raw: current, draft, ...splitReport(current, REPORT_SPLIT_MARKER) };
}

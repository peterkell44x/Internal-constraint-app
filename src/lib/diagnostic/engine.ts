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
import { splitReadyMarker, splitReport, stripDashes } from "./text";

// Server-side port of the prototype's diagnostic engine. The model call
// parameters, dash stripping, readiness marker handling, hard ceiling and
// report splitting all match the prototype exactly; the only difference is
// that the conversation now lives in the database instead of browser memory.

export type ChatMessage = { role: "user" | "assistant"; content: string };

// The model and max_tokens the prototype was tuned on.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = 1000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

async function callClaude(msgs: ChatMessage[], system: string): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: msgs,
  });
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
}

/** Mirrors the prototype's report button handler. */
export async function generateReport(domain: DomainKey, history: ChatMessage[]): Promise<Report> {
  const reportMsgs: ChatMessage[] = history.concat([{ role: "user", content: REPORT_REQUEST_MESSAGE }]);
  const summary = await callClaude(reportMsgs, buildReportSystem(DOMAINS[domain]));
  return { raw: summary, ...splitReport(summary, REPORT_SPLIT_MARKER) };
}

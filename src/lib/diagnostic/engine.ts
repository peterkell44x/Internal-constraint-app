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
  type Audit,
  buildAuditInput,
  buildAuditSystem,
  buildCheckInput,
  buildCheckSystem,
  CHECK_SCHEMA,
  findQuotedSentences,
  formatTranscript,
  matchViolations,
  parseAudit,
  parseViolations,
  type Violation,
} from "./denial";
import {
  applyRepairs,
  buildRepairInput,
  buildRepairSystem,
  buildRewriteInput,
  buildRewriteSystem,
  joinReport,
  parseRepairs,
  parseRewrite,
  REPAIR_SCHEMA,
  replaceSection,
  REWRITE_SCHEMA,
  rewriteIssues,
  type SectionName,
  sectionLimit,
  sectionOf,
  sectionText,
} from "./repair";
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
  deadline: number,
): Promise<{ draft: string; final: string; lengthPasses: LengthPass[] }> {
  const draft = await callClaude(reportMsgs, system, REPORT_MAX_TOKENS);

  let current = draft;
  const lengthPasses: LengthPass[] = [];
  for (let pass = 1; pass <= MAX_CUT_PASSES; pass++) {
    const parts = splitReport(current, REPORT_SPLIT_MARKER);
    if (!isOverLimits(parts)) break;
    if (Date.now() > deadline) {
      console.warn("Report time budget reached; skipping further length passes");
      break;
    }
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
    const words = [before.narrative, before.constraint, before.counterBelief].join("/") + " -> " +
      [after.narrative, after.constraint, after.counterBelief].join("/");
    console.info("Report length pass " + pass + ": words " + words);
    lengthPasses.push({ words, deleted: sentences.filter((x) => !revised.includes(x.text)).map((x) => x.text) });
    current = revised;
  }
  return { draft, final: current, lengthPasses };
}

/** One length pass: word counts before and after, and the sentences it removed. */
export interface LengthPass {
  words: string;
  deleted: string[];
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

// Check-and-delete rounds. Each checks the current report and deletes the
// sentences it flags; the second catches anything the first missed.
const MAX_CHECK_ROUNDS = 2;

// The reference-repair and section-rewrite replies are short.
const FIX_MAX_TOKENS = 3000;

// After this long, no new length pass or check round starts and the report
// ships as it stands, keeping generation well inside hosting time limits.
const REPORT_TIME_BUDGET_MS = 4 * 60 * 1000;

/** What the denial check saw and did, stored with the report for tuning. */
export interface ReportChecks {
  lengthPasses: LengthPass[];
  audit: Audit | null;
  rounds: { violations: Violation[] | null; deleted: string[]; unfixable: Violation[] }[];
  /** Sentences repaired because they referred to something that was deleted. */
  repairs?: { applied: { original: string; replacement: string }[]; skipped: { original: string; replacement: string; reason: string }[] } | null;
  /** The one targeted rewrite of flagged protected sections. */
  rewrite?: { section: SectionName; flagged: Violation[]; before: string; after: string | null; accepted: boolean; issues: string[] }[] | null;
  /** The check after repairs and the rewrite; whatever it still flags ships. */
  final?: { violations: Violation[] | null } | null;
  timedOut: boolean;
  ms: number;
}

/**
 * Mirrors the prototype's report button handler, followed by the length pass,
 * the delete-only denial check, reference repair, and a targeted rewrite of
 * any protected section that is still flagged.
 */
export async function generateReport(
  domain: DomainKey,
  history: ChatMessage[],
  userTurns: number,
): Promise<Report & { checks: ReportChecks }> {
  const started = Date.now();
  const deadline = started + REPORT_TIME_BUDGET_MS;
  const reportMsgs: ChatMessage[] = history.concat([{ role: "user", content: REPORT_REQUEST_MESSAGE }]);
  const hitCeiling = userTurns >= HARD_CEILING;
  const system = buildReportSystem(DOMAINS[domain]) + todayLine() + (hitCeiling ? CEILING_REPORT_NOTE : "");
  const transcript = formatTranscript(history, BEGIN_MESSAGE);
  const personWords = history.filter((m, i) => m.role === "user" && i > 0).map((m) => m.content).join("\n");

  // The audit only needs the conversation, so it runs alongside the draft.
  const [{ draft, final, lengthPasses }, audit] = await Promise.all([
    draftAndCut(domain, reportMsgs, system, deadline),
    auditConversation(transcript),
  ]);

  let current = final;
  let timedOut = false;
  const rounds: ReportChecks["rounds"] = [];
  const checks: ReportChecks = { lengthPasses, audit, rounds, timedOut, ms: 0 };
  if (audit) {
    for (let round = 1; round <= MAX_CHECK_ROUNDS; round++) {
      if (round > 1 && Date.now() > deadline) {
        timedOut = true;
        console.warn("Report time budget reached; skipping further check rounds");
        break;
      }
      const violations = await checkReport(transcript, audit, current);
      if (violations === null || violations.length === 0) {
        rounds.push({ violations, deleted: [], unfixable: [] });
        console.info("Report check round " + round + ": " + (violations === null ? "check failed" : "clean"));
        break;
      }
      const parts = splitReport(current, REPORT_SPLIT_MARKER);
      const sentences = numberSentences(parts);
      const { deleteIds, unfixable } = matchViolations(sentences, violations);
      const revised = applyDeletions(sentences, deleteIds, parts, { onlyOverLimit: false });
      const deleted = sentences.filter((s) => deleteIds.includes(s.id) && !revised.includes(s.text)).map((s) => s.text);
      rounds.push({ violations, deleted, unfixable });
      console.info(
        "Report check round " + round + ": " + violations.length + " violation(s), deleted " +
          deleted.length + " sentence(s), " + unfixable.length + " unfixable",
      );
      // Nothing deletable left (only protected or unmatched quotes): stop.
      if (revised === current) break;
      current = revised;
    }

    let changed = false;

    // Repair sentences left pointing at something a deletion removed.
    const allDeleted = [...lengthPasses.flatMap((lp) => lp.deleted), ...rounds.flatMap((r) => r.deleted)];
    if (allDeleted.length > 0) {
      const parts = splitReport(current, REPORT_SPLIT_MARKER);
      const repairs = await callFix(buildRepairSystem(), buildRepairInput(transcript, allDeleted, current), REPAIR_SCHEMA, parseRepairs);
      if (repairs === null) {
        checks.repairs = null;
      } else {
        const cleaned = repairs.map((r) => ({ original: r.original, replacement: stripDashes(r.replacement) }));
        const outcome = applyRepairs(parts, numberSentences(parts), cleaned);
        checks.repairs = { applied: outcome.applied, skipped: outcome.skipped };
        if (outcome.applied.length > 0) {
          current = joinReport(outcome.report);
          changed = true;
        }
        console.info("Report reference repair: " + outcome.applied.length + " applied, " + outcome.skipped.length + " skipped");
      }
    }

    // One targeted rewrite of any protected section the last round still flags.
    const lastFlags = rounds.at(-1)?.unfixable ?? [];
    if (lastFlags.length > 0) {
      const parts = splitReport(current, REPORT_SPLIT_MARKER);
      const sentences = numberSentences(parts);
      const flaggedBySection = new Map<SectionName, Violation[]>();
      for (const v of lastFlags) {
        const sections = new Set(findQuotedSentences(sentences, v.quote).map((s) => sectionOf(s, sentences)));
        for (const sec of sections) if (sec) flaggedBySection.set(sec, [...(flaggedBySection.get(sec) ?? []), v]);
      }
      if (flaggedBySection.size > 0) {
        const targets = [...flaggedBySection].map(([section, flagged]) => ({
          section,
          flagged,
          current: sectionText(parts, section),
          limit: sectionLimit(parts, section),
        }));
        const d = DOMAINS[domain];
        const rewritten = await callFix(
          buildRewriteSystem(d.reportTitle, d.goalPhrase),
          buildRewriteInput(transcript, audit, current, targets),
          REWRITE_SCHEMA,
          parseRewrite,
        );
        let updated = parts;
        checks.rewrite = targets.map((t) => {
          const proposal = rewritten?.find((r) => r.section === t.section)?.text ?? null;
          const text = proposal === null ? null : stripDashes(proposal);
          const issues = text === null ? ["no rewrite returned"] : rewriteIssues(t.section, text, t.limit, personWords);
          const accepted = issues.length === 0;
          if (accepted && text !== null) updated = replaceSection(updated, t.section, text);
          return { section: t.section, flagged: t.flagged, before: t.current, after: text, accepted, issues };
        });
        if (checks.rewrite.some((r) => r.accepted)) {
          current = joinReport(updated);
          changed = true;
        }
        console.info(
          "Report section rewrite: " + checks.rewrite.map((r) => r.section + (r.accepted ? " accepted" : " rejected")).join(", "),
        );
      }
    }

    // Check once more after repairs or the rewrite; what it flags ships and is
    // shown in the debug view.
    if (changed) {
      checks.final = { violations: await checkReport(transcript, audit, current) };
      console.info("Report final check: " + (checks.final.violations?.length ?? "failed") + " violation(s)");
    }
  }

  checks.timedOut = timedOut;
  checks.ms = Date.now() - started;
  return { raw: current, draft, ...splitReport(current, REPORT_SPLIT_MARKER), checks };
}

/** A structured call for the repair and rewrite steps; null if it fails. */
async function callFix<T>(
  system: string,
  input: string,
  schema: Record<string, unknown>,
  parse: (text: string) => T | null,
): Promise<T | null> {
  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: FIX_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: input }],
      output_config: { format: { type: "json_schema", schema } },
    });
    return parse(response.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
  } catch (e) {
    console.error("Report fix call failed; continuing without it", e);
    return null;
  }
}

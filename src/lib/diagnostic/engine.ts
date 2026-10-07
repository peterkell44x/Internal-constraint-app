import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { DOMAINS, type DomainKey } from "./domains";
import {
  BEGIN_MESSAGE,
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
  type ReportParts,
  type Sentence,
  sentenceKey,
  splitSentences,
} from "./review";
import {
  AUDIT_SCHEMA,
  type Audit,
  buildAuditInput,
  buildAuditSystem,
  buildCheckInput,
  buildCheckSystem,
  CHECK_SCHEMA,
  dismissNumberFalsePositives,
  dropWithdrawn,
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
  buildProblemSystem,
  buildRewriteSystem,
  findAbsoluteViolations,
  findDuplicateViolations,
  findProblemViolations,
  joinReport,
  parseProblem,
  parseRepairs,
  parseRewrite,
  PROBLEM_SCHEMA,
  REPAIR_SCHEMA,
  RETRY_ONE_SENTENCE,
  replaceSection,
  REWRITE_SCHEMA,
  rewriteIssues,
  type SectionName,
  sectionLabel,
  sectionLimit,
  sectionOf,
  sectionText,
  splitRepairs,
} from "./repair";
import { dropUnansweredQuestion, splitReadyMarker, splitReport, stripDashes } from "./text";

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
 * What the guide says after the last allowed answer. The model is not asked:
 * told to close, it still sometimes replied with a new question the person
 * could no longer answer.
 */
export const CEILING_CLOSING_LINE =
  "I have what I need to build your profile now. Go ahead and click Generate Profile Report.";

/**
 * Mirrors the prototype's sendMessage(), except at the answer limit, where the
 * fixed closing line replaces the model's reply. `userTurns` is the count
 * before this answer; the returned history includes the new user turn and the
 * reply.
 */
export async function sendUserMessage(
  domain: DomainKey,
  history: ChatMessage[],
  userTurns: number,
  text: string,
): Promise<TurnResult & { userTurns: number }> {
  const messages: ChatMessage[] = [...history, { role: "user", content: text }];
  const turns = userTurns + 1;
  if (turns >= HARD_CEILING) {
    return {
      messages: [...messages, { role: "assistant", content: CEILING_CLOSING_LINE }],
      reply: CEILING_CLOSING_LINE,
      ready: true,
      userTurns: turns,
    };
  }
  const reply = await callClaude(messages, buildSystemPrompt(DOMAINS[domain]));
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

/** The person's stated problem as a short phrase in their words, or null if the call fails. */
async function extractProblem(transcript: string): Promise<string | null> {
  try {
    const p = parseProblem(await callJSON(buildProblemSystem(), "CONVERSATION\n\n" + transcript, PROBLEM_SCHEMA));
    return p === null ? null : stripDashes(p);
  } catch (e) {
    console.error("Stated problem extraction failed; the constraint's tie to it won't be checked", e);
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

// Checks of the report. After each one except the last, the flagged sentences
// are fixed: unprotected ones deleted, references they leave dangling
// repaired, and protected ones rewritten with their section. The last check
// only records what still ships.
const MAX_CHECKS = 3;

// The reference-repair and section-rewrite replies are short.
const FIX_MAX_TOKENS = 3000;

// After this long, no new length pass or check round starts and the report
// ships as it stands, keeping generation well inside hosting time limits.
const REPORT_TIME_BUDGET_MS = 4 * 60 * 1000;

export interface RewriteRecord {
  section: SectionName;
  label: string;
  flagged: Violation[];
  before: string;
  after: string | null;
  accepted: boolean;
  issues: string[];
}

export interface CheckRound {
  /** What this round acted on: the check call's flags plus the code checks' (absolute, duplicate). */
  violations: Violation[] | null;
  /** Flags the checker took back in its own reason (or marked stands_behind false); never acted on. */
  withdrawn?: Violation[];
  /** "Not said" number flags dropped because the person did say those numbers. */
  dismissed: Violation[];
  deleted: string[];
  /** Flags in protected sentences (or quotes not found), sent to the rewrite. */
  unfixable: Violation[];
  repairs?: { applied: { original: string; replacement: string }[]; skipped: { original: string; replacement: string; reason: string }[] } | null;
  rewrite?: RewriteRecord[] | null;
}

/** What the denial check saw and did, stored with the report for tuning. */
export interface ReportChecks {
  lengthPasses: LengthPass[];
  audit: Audit | null;
  rounds: CheckRound[];
  timedOut: boolean;
  ms: number;
  /** The person's stated problem, extracted once from the conversation; null if that failed. */
  statedProblem?: string | null;
  /** The rewrite after the checks when the constraint still did not end on their stated problem. */
  problemFix?: RewriteRecord | null;
  /** Older reports stored these at the top level; kept so they still display. */
  repairs?: CheckRound["repairs"];
  rewrite?: RewriteRecord[] | null;
  final?: { violations: Violation[] | null } | null;
}

/**
 * Mirrors the prototype's report button handler, followed by the length pass
 * and up to three checks; after each but the last, flagged sentences are
 * deleted, dangling references repaired, and flagged protected sections
 * rewritten.
 */
export async function generateReport(
  domain: DomainKey,
  history: ChatMessage[],
  userTurns: number,
): Promise<Report & { checks: ReportChecks }> {
  const started = Date.now();
  const deadline = started + REPORT_TIME_BUDGET_MS;
  // A question the person never answered (for example from a conversation
  // closed at the answer limit before the fixed closing line) is left out.
  history = dropUnansweredQuestion(history);
  const reportMsgs: ChatMessage[] = history.concat([{ role: "user", content: REPORT_REQUEST_MESSAGE }]);
  const hitCeiling = userTurns >= HARD_CEILING;
  const system = buildReportSystem(DOMAINS[domain]) + todayLine() + (hitCeiling ? CEILING_REPORT_NOTE : "");
  const transcript = formatTranscript(history, BEGIN_MESSAGE);
  const personWords = history.filter((m, i) => m.role === "user" && i > 0).map((m) => m.content).join("\n");

  // The audit and the stated problem only need the conversation, so they run
  // alongside the draft.
  const [{ draft, final, lengthPasses }, audit, statedProblem] = await Promise.all([
    draftAndCut(domain, reportMsgs, system, deadline),
    auditConversation(transcript),
    extractProblem(transcript),
  ]);

  let current = final;
  let timedOut = false;
  const rounds: CheckRound[] = [];
  const rewriteCount = new Map<SectionName, number>();
  // Every sentence ever locked stays locked, wherever later deletions and
  // rewrites move it. Locks were once worked out afresh from each round's
  // paragraph positions, which let a protected paragraph be deleted.
  const lockedKeys = new Set<string>();
  const number = (p: ReportParts): Sentence[] => {
    const out = numberSentences(p, lockedKeys);
    for (const x of out) if (x.locked) lockedKeys.add(sentenceKey(x.text));
    return out;
  };
  number(splitReport(final, REPORT_SPLIT_MARKER));

  /** Rewrites the given sections in one call and keeps each rewrite that passes the code checks. */
  const rewriteSections = async (
    targets: { section: SectionName; flagged: Violation[]; current: string; limit: number }[],
    paragraphCount: number,
  ): Promise<{ report: string; records: RewriteRecord[] }> => {
    const d = DOMAINS[domain];
    const rewritten = await callFix(
      buildRewriteSystem(d.reportTitle, d.goalPhrase),
      buildRewriteInput(transcript, audit!, current, targets, statedProblem),
      REWRITE_SCHEMA,
      parseRewrite,
    );
    let updated = splitReport(current, REPORT_SPLIT_MARKER);
    const records = targets.map((t) => {
      const proposal = rewritten?.find((r) => r.section === t.section)?.text ?? null;
      const text = proposal === null ? null : stripDashes(proposal);
      const others = t.section.startsWith("paragraph")
        ? updated.narrative.split(/\n\s*\n/).map((x) => x.trim()).filter((x) => x && x !== t.current)
        : [];
      const issues = text === null
        ? ["no rewrite returned"]
        : rewriteIssues(t.section, text, t.limit, personWords, t.current, others, statedProblem ?? "");
      const accepted = issues.length === 0;
      if (accepted && text !== null) {
        updated = replaceSection(updated, t.section, text);
        // A rewritten protected section stays protected.
        number(updated);
      }
      return { section: t.section, label: sectionLabel(t.section, paragraphCount), flagged: t.flagged, before: t.current, after: text, accepted, issues };
    });
    return { report: records.some((r) => r.accepted) ? joinReport(updated) : current, records };
  };
  const everDeleted = lengthPasses.flatMap((lp) => lp.deleted);
  const rejectedText = audit ? audit.rejected.flatMap((r) => [r.interpretation, r.quote]) : [];

  if (audit) {
    for (let n = 1; n <= MAX_CHECKS; n++) {
      if (n > 1 && Date.now() > deadline) {
        timedOut = true;
        console.warn("Report time budget reached; skipping further checks");
        break;
      }
      const found = await checkReport(transcript, audit, current);
      let parts = splitReport(current, REPORT_SPLIT_MARKER);
      let sentences = number(parts);
      const { kept: standing, withdrawn } = found === null ? { kept: null, withdrawn: [] } : dropWithdrawn(found);
      const { kept: modelFlags, dismissed } =
        standing === null ? { kept: null, dismissed: [] } : dismissNumberFalsePositives(standing, personWords);
      // Code checks run every round, even when the check call fails.
      const absolutes = findAbsoluteViolations(sentences, personWords);
      const duplicates = findDuplicateViolations(sentences);
      const unanchored = findProblemViolations(parts, statedProblem);
      const codeFlags = [...absolutes, ...duplicates, ...unanchored];
      const violations = modelFlags === null && codeFlags.length === 0 ? null : [...(modelFlags ?? []), ...codeFlags];
      const round: CheckRound = { violations, withdrawn, dismissed, deleted: [], unfixable: [] };
      rounds.push(round);
      if (violations === null || violations.length === 0) {
        console.info("Report check " + n + ": " + (violations === null ? "check failed" : "clean") + ", " + withdrawn.length + " withdrawn");
        break;
      }
      console.info("Report check " + n + ": " + violations.length + " violation(s), " + withdrawn.length + " withdrawn, " + dismissed.length + " dismissed");
      // The last check only records what ships.
      if (n === MAX_CHECKS) break;

      // 1. Delete flagged sentences that aren't protected. An absolute is
      //    never fixed by deleting its sentence (that could drop the
      //    constraint's closing words); its section is rewritten instead.
      //    Code-found flags name their exact sentence, so they are matched by
      //    text; matching a duplicate by quote would also hit the first copy.
      const matched = matchViolations(sentences, modelFlags ?? []);
      const deleteIds = [...matched.deleteIds];
      const unfixable = [...matched.unfixable, ...absolutes, ...unanchored];
      for (const v of duplicates) {
        const s = sentences.find((x) => x.text === v.quote);
        if (s && !s.locked) deleteIds.push(s.id);
        else unfixable.push(v);
      }
      const afterDelete = applyDeletions(sentences, deleteIds, parts, { onlyOverLimit: false });
      round.deleted = sentences.filter((x) => deleteIds.includes(x.id) && !afterDelete.includes(x.text)).map((x) => x.text);
      round.unfixable = unfixable;
      // Narrative paragraphs whose last sentence was deleted but which still
      // have others: the repair checks they still make their point.
      const lostEnding: string[] = [];
      const afterParts = splitReport(afterDelete, REPORT_SPLIT_MARKER);
      const afterParas = afterParts.narrative.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
      for (const pi of new Set(sentences.filter((x) => x.part === "narrative").map((x) => x.paragraph))) {
        const inPara = sentences.filter((x) => x.part === "narrative" && x.paragraph === pi);
        const kept = inPara.filter((x) => afterDelete.includes(x.text));
        if (kept.length > 0 && !afterDelete.includes(inPara.at(-1)!.text)) {
          const para = afterParas.find((a) => a.endsWith(kept.at(-1)!.text));
          if (para) lostEnding.push(para);
        }
      }
      current = afterDelete;
      everDeleted.push(...round.deleted);

      // 2. Repair sentences left pointing at something a deletion removed.
      if (round.deleted.length > 0) {
        parts = splitReport(current, REPORT_SPLIT_MARKER);
        const repairInput = buildRepairInput(transcript, everDeleted, rejectedText, current, lostEnding);
        let repairs = await callFix(buildRepairSystem(), repairInput, REPAIR_SCHEMA, parseRepairs);
        if (repairs !== null) {
          // A repair must name one sentence. A block of several is split into
          // its changed sentences; one that can't be split is asked for again,
          // once.
          const first = splitRepairs(repairs, splitSentences);
          repairs = first.repairs;
          if (first.unsplit.length > 0) {
            const retry = await callFix(buildRepairSystem(), repairInput + RETRY_ONE_SENTENCE, REPAIR_SCHEMA, parseRepairs);
            const second = retry === null ? { repairs: [], unsplit: first.unsplit } : splitRepairs(retry, splitSentences);
            const have = new Set(repairs.map((r) => r.original));
            repairs = [...repairs, ...second.repairs.filter((r) => !have.has(r.original)), ...second.unsplit];
          }
        }
        if (repairs === null) {
          round.repairs = null;
        } else {
          const cleaned = repairs.map((r) => ({ original: r.original, replacement: stripDashes(r.replacement) }));
          const outcome = applyRepairs(parts, number(parts), cleaned, [...everDeleted, ...rejectedText]);
          round.repairs = { applied: outcome.applied, skipped: outcome.skipped };
          if (outcome.applied.length > 0) current = joinReport(outcome.report);
          console.info("Report reference repair: " + outcome.applied.length + " applied, " + outcome.skipped.length + " skipped");
        }
      }

      // 3. Rewrite each section that holds a flagged protected sentence, at
      //    most twice per section.
      parts = splitReport(current, REPORT_SPLIT_MARKER);
      sentences = number(parts);
      const flaggedBySection = new Map<SectionName, Violation[]>();
      for (const v of unfixable) {
        // A code-found absolute is fixed by rewrite whether or not its sentence is locked.
        const byText = v.kind === "absolute" || v.kind === "duplicate" || v.kind === "stated_problem";
        const hits = byText ? sentences.filter((x) => x.text === v.quote) : findQuotedSentences(sentences, v.quote);
        const sections = new Set(hits.filter((x) => x.locked || v.kind === "absolute").map(sectionOf));
        for (const sec of sections) {
          if ((rewriteCount.get(sec) ?? 0) >= 2) continue;
          flaggedBySection.set(sec, [...(flaggedBySection.get(sec) ?? []), v]);
        }
      }
      if (flaggedBySection.size > 0) {
        const paragraphCount = parts.narrative.split(/\n\s*\n/).filter((x) => x.trim()).length;
        const targets = [...flaggedBySection].map(([section, flagged]) => ({
          section,
          flagged,
          current: sectionText(parts, section),
          limit: sectionLimit(parts, section),
        }));
        const outcome = await rewriteSections(targets, paragraphCount);
        round.rewrite = outcome.records;
        for (const t of targets) rewriteCount.set(t.section, (rewriteCount.get(t.section) ?? 0) + 1);
        current = outcome.report;
        console.info("Report section rewrite: " + round.rewrite.map((r) => r.label + (r.accepted ? " accepted" : " rejected")).join(", "));
      }
    }
  }

  // If the constraint still does not end on the person's stated problem, one
  // more rewrite of it, supplying the phrase.
  let problemFix: RewriteRecord | null = null;
  if (audit) {
    const parts = splitReport(current, REPORT_SPLIT_MARKER);
    const unanchored = findProblemViolations(parts, statedProblem);
    if (unanchored.length > 0) {
      const paragraphCount = parts.narrative.split(/\n\s*\n/).filter((x) => x.trim()).length;
      const target = { section: "constraint" as SectionName, flagged: unanchored, current: parts.constraint, limit: sectionLimit(parts, "constraint") };
      const outcome = await rewriteSections([target], paragraphCount);
      problemFix = outcome.records[0];
      current = outcome.report;
      console.info("Report stated problem rewrite: " + (problemFix.accepted ? "accepted" : "rejected"));
    }
  }

  const checks: ReportChecks = { lengthPasses, audit, rounds, timedOut, ms: Date.now() - started, statedProblem, problemFix };
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

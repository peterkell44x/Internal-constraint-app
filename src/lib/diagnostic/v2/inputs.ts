// Builds the text sent with each Architect AI call. The instructions
// themselves are in prompts.ts; this only lays out the person's data.
//
// Pure module.

import type { DomainKey } from "../domains.ts";
import type { Boldness, Flow } from "./flow.ts";
import { ANSWER_STEPS } from "./flow.ts";
import { CARD_ROLES, DOMAIN_LABELS, QUESTION_JOBS, QUESTIONS, REACTION_SHAPES, THIN_ANSWER_WORDS } from "./prompts.ts";
import type { ArchitectReport } from "./schema.ts";
import { countWords } from "./text.ts";

/** All the person's answers as plain text, for the code checks. */
export function answersText(f: Flow): string {
  return f.answers.join("\n\n");
}

function qa(domain: DomainKey, answers: string[], upTo: number): string {
  return answers
    .slice(0, upTo)
    .map((a, i) => "Q" + (i + 1) + ": " + QUESTIONS[domain][i] + "\nA" + (i + 1) + ": " + a)
    .join("\n\n");
}

/** The input for the reaction to one answer (steps 1 to 8). */
export function buildReactionInput(domain: DomainKey, f: Flow, step: number, boldness: Boldness, thin: boolean): string {
  const lines = ["DOMAIN: " + DOMAIN_LABELS[domain]];
  const i = step - 1;
  lines.push(
    "QUESTION: " + QUESTIONS[domain][i],
    "WHAT THIS QUESTION IS FOR: " + QUESTION_JOBS[i],
    "HOW TO REACT TO THIS QUESTION: " + REACTION_SHAPES[i],
    "EARLIER ANSWERS:\n" + (i === 0 ? "(none)" : qa(domain, f.answers, i)),
    "LATEST ANSWER: " + f.answers[i],
    "BOLDNESS: " + boldness,
    "THIN_ANSWER: " + (thin ? "true" : "false"),
  );
  return lines.join("\n\n");
}

/** The answers under the THIN_ANSWER length, as "Q3, Q6", or "(none)". */
export function thinAnswers(f: Flow): string {
  const thin = f.answers.map((a, i) => (countWords(a) < THIN_ANSWER_WORDS ? "Q" + (i + 1) : "")).filter(Boolean);
  return thin.length ? thin.join(", ") : "(none)";
}

/**
 * The input for the report: the domain, all 8 answers, which answers are
 * thin, and SENSITIVE. Taps saved by older diagnostics are left out.
 */
export function buildReportInput(domain: DomainKey, f: Flow, sensitive: boolean): string {
  return [
    "DOMAIN: " + DOMAIN_LABELS[domain],
    "ANSWERS:\n" + qa(domain, f.answers, ANSWER_STEPS),
    "THIN ANSWERS: " + thinAnswers(f),
    "SENSITIVE: " + (sensitive ? "true" : "false"),
  ].join("\n\n");
}

/** The input for rewriting one card on its own. */
export function buildCardInput(
  domain: DomainKey,
  f: Flow,
  report: ArchitectReport,
  section: number,
  card: number,
  fixes: string[],
  sensitive: boolean,
): string {
  const others = report.sections
    .flatMap((s, si) => s.cards.map((c, ci) => ({ si, ci, c, name: s.name })))
    .filter((x) => !(x.si === section && x.ci === card))
    .map((x) => "- " + x.name + ", card " + (x.ci + 1) + ": " + x.c)
    .join("\n");
  return [
    "DOMAIN: " + DOMAIN_LABELS[domain],
    "ANSWERS:\n" + qa(domain, f.answers, ANSWER_STEPS),
    "THIN ANSWERS: " + thinAnswers(f),
    "SENSITIVE: " + (sensitive ? "true" : "false"),
    "HIDDEN TIE: " + report.hidden_tie,
    ...(section === 1 && card === 2 && report.constraint
      ? ["CONSTRAINT: the code adds this as the last sentence of this card. Do not write it, and do not end with a section point: " + report.constraint]
      : []),
    "THIS CARD: " + report.sections[section].name + ", card " + (card + 1) + ". It is for: " + CARD_ROLES[section][card],
    "OTHER CARDS:\n" + others,
    "CURRENT CARD: " + report.sections[section].cards[card],
    "FIX:\n" + fixes.map((x) => "- " + x).join("\n"),
  ].join("\n\n");
}

/** The input for the one AI fact check: the answers and the numbered sentences, each with its section. */
export function buildFactCheckInput(domain: DomainKey, f: Flow, numbered: { n: number; text: string; section: string }[]): string {
  return [
    "ANSWERS:\n" + qa(domain, f.answers, ANSWER_STEPS),
    "REPORT, NUMBERED SENTENCES:\n" + numbered.map((s) => "[" + s.n + "] (" + s.section + ") " + s.text).join("\n"),
  ].join("\n\n");
}

/** The input for the narrow check on one card that lost sentences: what was deleted, and the card now. */
export function buildDanglingInput(numbered: { n: number; text: string }[], deleted: string[]): string {
  return [
    "DELETED SENTENCES:\n" + deleted.map((d) => "- " + d).join("\n"),
    "THE CARD NOW, NUMBERED SENTENCES:\n" + numbered.map((s) => "[" + s.n + "] " + s.text).join("\n"),
  ].join("\n\n");
}

/** The input for writing only the constraint sentence. */
export function buildConstraintInput(domain: DomainKey, f: Flow, hiddenTie: string): string {
  return ["DOMAIN: " + DOMAIN_LABELS[domain], "ANSWERS:\n" + qa(domain, f.answers, ANSWER_STEPS), "HIDDEN TIE: " + hiddenTie].join("\n\n");
}

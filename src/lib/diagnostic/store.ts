import "server-only";

import type { Diagnostic, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { isDomainKey, type DomainKey } from "./domains";
import type { ChatMessage } from "./engine";
import { BEGIN_MESSAGE } from "./prompts";

export type DiagnosticStatus = "in_progress" | "ready" | "completed";

/** What the browser is allowed to see of a diagnostic. */
export interface DiagnosticView {
  id: string;
  domain: DomainKey;
  status: DiagnosticStatus;
  /** Visible chat bubbles (the hidden "Begin the diagnostic." opener is omitted). */
  messages: { role: "user" | "assistant"; content: string }[];
  userTurns: number;
  report: { narrative: string; constraint: string; counterBelief: string } | null;
  createdAt: string;
  completedAt: string | null;
}

export function historyOf(d: Diagnostic): ChatMessage[] {
  return Array.isArray(d.messages) ? (d.messages as unknown as ChatMessage[]) : [];
}

/** Converts a message history into the JSON column's input type. */
export function messagesJson(messages: ChatMessage[]): Prisma.InputJsonValue {
  return messages as unknown as Prisma.InputJsonValue;
}

export function toView(d: Diagnostic): DiagnosticView {
  const history = historyOf(d);
  const visible = history[0]?.role === "user" && history[0]?.content === BEGIN_MESSAGE ? history.slice(1) : history;
  return {
    id: d.id,
    domain: d.domain as DomainKey,
    status: d.status as DiagnosticStatus,
    messages: visible.map((m) => ({ role: m.role, content: m.content })),
    userTurns: d.userTurns,
    report:
      d.status === "completed"
        ? { narrative: d.narrative ?? "", constraint: d.constraint ?? "", counterBelief: d.counterBelief ?? "" }
        : null,
    createdAt: d.createdAt.toISOString(),
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
  };
}

/** Loads a diagnostic only if it belongs to the given user. */
export async function findOwnedDiagnostic(id: string, userId: string) {
  const d = await db.diagnostic.findFirst({ where: { id, userId } });
  if (!d || !isDomainKey(d.domain)) return null;
  return d as Diagnostic & { domain: DomainKey };
}

/**
 * Saves new state only if the row hasn't changed since it was read, so two
 * tabs (or a double click) can't interleave turns. Returns false on conflict.
 */
export async function saveIfUnchanged(
  prev: Diagnostic,
  data: Parameters<typeof db.diagnostic.update>[0]["data"],
): Promise<boolean> {
  const { count } = await db.diagnostic.updateMany({
    where: { id: prev.id, updatedAt: prev.updatedAt },
    data,
  });
  return count === 1;
}

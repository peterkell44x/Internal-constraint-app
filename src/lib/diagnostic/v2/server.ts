import "server-only";

import type { Diagnostic } from "@/generated/prisma/client";
import { jsonError, userOr401 } from "@/lib/api";

import type { DomainKey } from "../domains";
import { findOwnedDiagnostic, flowJson, saveIfUnchanged, toView } from "../store";
import { generateReaction } from "./engine";
import { currentScreen, parseFlow, reactionFor, withReaction } from "./flow";

type Owned = Diagnostic & { domain: DomainKey };

/** Loads the signed-in user's version 2 diagnostic, or the error Response to return. */
export async function loadArchitect(id: string): Promise<{ d: Owned; userId: string } | Response> {
  const user = await userOr401();
  if (user instanceof Response) return user;
  const d = await findOwnedDiagnostic(id, user.id);
  if (!d) return jsonError(404, "Not found.");
  if (d.version !== 2) return jsonError(409, "This diagnostic uses the earlier format.");
  return { d, userId: user.id };
}

/**
 * Generates and saves the reaction a step is waiting for. Does nothing if it
 * is already there. The answer was saved before this runs, so a failure here
 * never loses what the person typed; a reload asks for the reaction again.
 */
export async function addReaction(id: string, userId: string, step: number): Promise<Owned | null> {
  const d = await findOwnedDiagnostic(id, userId);
  if (!d) return null;
  const f = parseFlow(d.flow);
  const screen = currentScreen(f);
  if (reactionFor(f, step) || screen.kind !== "reaction" || screen.step !== step) return d;
  const r = await generateReaction(d.domain, f, step);
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await findOwnedDiagnostic(id, userId);
    if (!fresh) return null;
    const ff = parseFlow(fresh.flow);
    if (reactionFor(ff, step)) return fresh;
    if (await saveIfUnchanged(fresh, { flow: flowJson(withReaction(ff, r)), crisis: fresh.crisis || r.crisis })) break;
  }
  return findOwnedDiagnostic(id, userId);
}

export function viewResponse(d: Owned | null, status = 200): Response {
  return d ? Response.json(toView(d), { status }) : jsonError(404, "Not found.");
}

// Which domains a NEW diagnosis can be started in. The others are hidden, not
// removed: their questions, prompts and code stay, and their saved reports and
// chats still open. To bring a domain back, add its key to ACTIVE_DOMAINS.
//
// Pure module.

import { DOMAIN_KEYS, type DomainKey } from "./domains.ts";

export const ACTIVE_DOMAINS: DomainKey[] = ["money"];

/** The domains the picker shows, in their usual order. */
export function pickerDomains(active: readonly DomainKey[] = ACTIVE_DOMAINS): DomainKey[] {
  return DOMAIN_KEYS.filter((k) => active.includes(k));
}

/** Why a new diagnosis can't be started in this domain, or null if it can. */
export function newDiagnosisError(domain: unknown, active: readonly DomainKey[] = ACTIVE_DOMAINS): string | null {
  if (!(DOMAIN_KEYS as unknown[]).includes(domain)) return "Unknown domain.";
  if (!active.includes(domain as DomainKey)) return "This domain is not available right now.";
  return null;
}

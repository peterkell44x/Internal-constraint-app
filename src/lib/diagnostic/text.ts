// Pure text helpers from the prototype. Kept free of imports so the parity
// tests can load them directly.

// Verbatim from the prototype.
export function stripDashes(text: string): string {
  if (!text) return text;
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+--\s+/g, ", ")
    .replace(/(\w)--(\w)/g, "$1, $2")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([,.])/g, "$1");
}

/** Mirrors the prototype's handleReply(): detect and remove the readiness marker. */
export function splitReadyMarker(reply: string, marker: string): { clean: string; ready: boolean } {
  return { ready: reply.includes(marker), clean: reply.split(marker).join("").trim() };
}

/** Mirrors the prototype's report parsing. */
export function splitReport(summary: string, marker: string) {
  const parts = summary.split(marker).map((p) => p.trim());
  return { narrative: parts[0] || "", constraint: parts[1] || "", counterBelief: parts[2] || "" };
}

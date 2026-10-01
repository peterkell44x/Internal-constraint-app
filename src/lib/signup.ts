import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

// Sign-ups are gated by a shared passcode (SIGNUP_PASSCODE) so a deployed copy
// can't be used by strangers to spend the API key. In production with no
// passcode configured, sign-ups are closed rather than open.

function configuredPasscode(): string {
  return (process.env.SIGNUP_PASSCODE ?? "").trim();
}

/** Whether the sign-up form should ask for a passcode. */
export function signupPasscodeRequired(): boolean {
  return configuredPasscode() !== "" || process.env.NODE_ENV === "production";
}

/** Checks a submitted passcode. Local development without a passcode stays open. */
export function signupPasscodeOk(submitted: string): boolean {
  const expected = configuredPasscode();
  if (!expected) return process.env.NODE_ENV !== "production";
  const a = createHash("sha256").update(submitted.trim()).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

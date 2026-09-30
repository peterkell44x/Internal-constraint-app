import "server-only";

import { getCurrentUser } from "./auth";

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

/** Returns the user, or a 401 Response for route handlers. */
export async function userOr401() {
  const user = await getCurrentUser();
  return user ?? jsonError(401, "You are not signed in.");
}

import { jsonError, userOr401 } from "@/lib/api";
import { describeError, startConversation } from "@/lib/diagnostic/engine";
import { findOwnedDiagnostic, historyOf, messagesJson, saveIfUnchanged, toView } from "@/lib/diagnostic/store";

// Gets the AI's opening message. Also used by the Retry button when that fails.
export async function POST(_req: Request, ctx: RouteContext<"/api/diagnostics/[id]/start">) {
  const user = await userOr401();
  if (user instanceof Response) return user;
  const d = await findOwnedDiagnostic((await ctx.params).id, user.id);
  if (!d) return jsonError(404, "Not found.");
  if (historyOf(d).length > 0) return Response.json(toView(d)); // already started

  let result;
  try {
    result = await startConversation(d.domain);
  } catch (e) {
    console.error("startConversation failed", e);
    return jsonError(502, "Could not start: " + describeError(e));
  }

  const saved = await saveIfUnchanged(d, {
    messages: messagesJson(result.messages),
    status: result.ready ? "ready" : "in_progress",
  });
  const fresh = await findOwnedDiagnostic(d.id, user.id);
  if (!saved && fresh && historyOf(fresh).length === 0) return jsonError(409, "Please reload and try again.");
  return Response.json(toView(fresh!));
}

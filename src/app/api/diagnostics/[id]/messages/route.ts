import { jsonError, userOr401 } from "@/lib/api";
import { describeError, sendUserMessage } from "@/lib/diagnostic/engine";
import { findOwnedDiagnostic, historyOf, messagesJson, saveIfUnchanged, toView } from "@/lib/diagnostic/store";

const MAX_ANSWER_LENGTH = 8000;

// Sends one user answer and returns the updated conversation.
export async function POST(req: Request, ctx: RouteContext<"/api/diagnostics/[id]/messages">) {
  const user = await userOr401();
  if (user instanceof Response) return user;
  const d = await findOwnedDiagnostic((await ctx.params).id, user.id);
  if (!d) return jsonError(404, "Not found.");

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return jsonError(400, "Message is empty.");
  if (text.length > MAX_ANSWER_LENGTH) return jsonError(400, "That answer is too long.");

  const history = historyOf(d);
  if (d.status !== "in_progress" || history.length === 0) {
    return jsonError(409, "This conversation is not accepting answers.");
  }
  // The client says which turn it thinks it is answering; reject stale tabs.
  if (typeof body?.userTurns === "number" && body.userTurns !== d.userTurns) {
    return jsonError(409, "This conversation changed in another tab. Please reload.");
  }

  let result;
  try {
    result = await sendUserMessage(d.domain, history, d.userTurns, text);
  } catch (e) {
    console.error("sendUserMessage failed", e);
    return jsonError(502, "Error: " + describeError(e));
  }

  const saved = await saveIfUnchanged(d, {
    messages: messagesJson(result.messages),
    userTurns: result.userTurns,
    status: result.ready ? "ready" : "in_progress",
  });
  if (!saved) return jsonError(409, "This conversation changed in another tab. Please reload.");

  const fresh = await findOwnedDiagnostic(d.id, user.id);
  return Response.json(toView(fresh!));
}

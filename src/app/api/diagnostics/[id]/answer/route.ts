import { jsonError } from "@/lib/api";
import { flowJson, saveIfUnchanged } from "@/lib/diagnostic/store";
import { answerError, parseFlow, withAnswer } from "@/lib/diagnostic/v2/flow";
import { addReaction, loadArchitect, viewResponse } from "@/lib/diagnostic/v2/server";

// Saves the answer to one of the 8 fixed questions, then the reaction to it.
export async function POST(req: Request, ctx: RouteContext<"/api/diagnostics/[id]/answer">) {
  const loaded = await loadArchitect((await ctx.params).id);
  if (loaded instanceof Response) return loaded;
  const { d, userId } = loaded;
  if (d.status !== "in_progress") return jsonError(409, "This diagnostic is not accepting answers.");

  const body = await req.json().catch(() => null);
  const step = Number(body?.step);
  const text = typeof body?.text === "string" ? body.text : "";
  const f = parseFlow(d.flow);
  const error = answerError(f, step, text);
  if (error) return jsonError(error.startsWith("This question") ? 409 : 400, error);

  // Saved first, on its own, so nothing typed is lost if the reaction fails.
  if (!(await saveIfUnchanged(d, { flow: flowJson(withAnswer(f, text)) }))) {
    return jsonError(409, "This diagnostic changed in another tab. Please reload.");
  }
  return viewResponse(await addReaction(d.id, userId, step));
}

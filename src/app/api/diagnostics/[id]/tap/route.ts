import { jsonError } from "@/lib/api";
import { startReportJob } from "@/lib/diagnostic/job";
import { findOwnedDiagnostic, flowJson, saveIfUnchanged } from "@/lib/diagnostic/store";
import { parseFlow, TAP_REACTION_STEP, tapError, withTap } from "@/lib/diagnostic/v2/flow";
import { addReaction, loadArchitect, viewResponse } from "@/lib/diagnostic/v2/server";

// Saves a Yes / No tap. The choice is kept but changes nothing that follows.
// After step 9 comes a reaction; after step 10 the report starts building.
export async function POST(req: Request, ctx: RouteContext<"/api/diagnostics/[id]/tap">) {
  const loaded = await loadArchitect((await ctx.params).id);
  if (loaded instanceof Response) return loaded;
  const { d, userId } = loaded;
  if (d.status !== "in_progress") return jsonError(409, "This diagnostic is not accepting answers.");

  const body = await req.json().catch(() => null);
  const step = Number(body?.step);
  if (typeof body?.value !== "boolean") return jsonError(400, "Please tap Yes or No.");
  const f = parseFlow(d.flow);
  const error = tapError(f, step);
  if (error) return jsonError(409, error);

  const next = withTap(f, body.value);
  const last = step === 10;
  if (!(await saveIfUnchanged(d, { flow: flowJson(next), ...(last ? { status: "ready" } : {}) }))) {
    return jsonError(409, "This diagnostic changed in another tab. Please reload.");
  }
  if (!last) return viewResponse(await addReaction(d.id, userId, TAP_REACTION_STEP));

  const ready = await findOwnedDiagnostic(d.id, userId);
  if (ready) await startReportJob(ready);
  return viewResponse(await findOwnedDiagnostic(d.id, userId), 202);
}

import { jsonError } from "@/lib/api";
import { flowJson, findOwnedDiagnostic, saveIfUnchanged } from "@/lib/diagnostic/store";
import { currentScreen, parseFlow, withHalfwaySeen } from "@/lib/diagnostic/v2/flow";
import { loadArchitect, viewResponse } from "@/lib/diagnostic/v2/server";

// The person pressed Continue on the halfway screen.
export async function POST(_req: Request, ctx: RouteContext<"/api/diagnostics/[id]/halfway">) {
  const loaded = await loadArchitect((await ctx.params).id);
  if (loaded instanceof Response) return loaded;
  const { d, userId } = loaded;
  const f = parseFlow(d.flow);
  if (currentScreen(f).kind === "halfway" && !(await saveIfUnchanged(d, { flow: flowJson(withHalfwaySeen(f)) }))) {
    return jsonError(409, "This diagnostic changed in another tab. Please reload.");
  }
  return viewResponse(await findOwnedDiagnostic(d.id, userId));
}

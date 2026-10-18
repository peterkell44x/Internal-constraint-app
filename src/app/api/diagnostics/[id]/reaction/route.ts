import { addReaction, loadArchitect, viewResponse } from "@/lib/diagnostic/v2/server";

// Generates a reaction that is still missing, for example after a reload
// while one was being written. Does nothing if it is already there.
export async function POST(req: Request, ctx: RouteContext<"/api/diagnostics/[id]/reaction">) {
  const loaded = await loadArchitect((await ctx.params).id);
  if (loaded instanceof Response) return loaded;
  const body = await req.json().catch(() => null);
  return viewResponse(await addReaction(loaded.d.id, loaded.userId, Number(body?.step)));
}

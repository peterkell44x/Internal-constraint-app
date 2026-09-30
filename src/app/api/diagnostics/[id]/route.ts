import { jsonError, userOr401 } from "@/lib/api";
import { db } from "@/lib/db";
import { findOwnedDiagnostic, toView } from "@/lib/diagnostic/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/diagnostics/[id]">) {
  const user = await userOr401();
  if (user instanceof Response) return user;
  const d = await findOwnedDiagnostic((await ctx.params).id, user.id);
  if (!d) return jsonError(404, "Not found.");
  return Response.json(toView(d));
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/diagnostics/[id]">) {
  const user = await userOr401();
  if (user instanceof Response) return user;
  const d = await findOwnedDiagnostic((await ctx.params).id, user.id);
  if (!d) return jsonError(404, "Not found.");
  await db.diagnostic.delete({ where: { id: d.id } });
  return new Response(null, { status: 204 });
}

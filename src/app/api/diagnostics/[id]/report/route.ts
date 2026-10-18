import { jsonError, userOr401 } from "@/lib/api";
import { startReportJob } from "@/lib/diagnostic/job";
import { findOwnedDiagnostic, toView } from "@/lib/diagnostic/store";

// Starts building the report in the background and returns at once; the page
// polls GET /api/diagnostics/[id] until the status becomes "completed".
export async function POST(_req: Request, ctx: RouteContext<"/api/diagnostics/[id]/report">) {
  const user = await userOr401();
  if (user instanceof Response) return user;
  const d = await findOwnedDiagnostic((await ctx.params).id, user.id);
  if (!d) return jsonError(404, "Not found.");
  if (d.status === "completed") return Response.json(toView(d));
  if (d.status !== "ready" && d.status !== "generating") {
    return jsonError(409, "The diagnostic isn't ready for a report yet.");
  }

  await startReportJob(d);

  // Either we just started it, or one is already running: report its state.
  const fresh = await findOwnedDiagnostic(d.id, user.id);
  return Response.json(toView(fresh!), { status: 202 });
}

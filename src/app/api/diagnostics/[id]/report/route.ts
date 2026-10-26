import { jsonError, userOr401 } from "@/lib/api";
import { startReportJob } from "@/lib/diagnostic/job";
import { findOwnedDiagnostic, saveIfUnchanged, toView } from "@/lib/diagnostic/store";
import { currentScreen, parseFlow } from "@/lib/diagnostic/v2/flow";

// Starts building the report in the background and returns at once; the page
// polls GET /api/diagnostics/[id] until the status becomes "completed".
// For the Architect flow this is the "Show me my report" button: once the
// reaction to answer 8 is in, the diagnostic is marked ready here.
export async function POST(_req: Request, ctx: RouteContext<"/api/diagnostics/[id]/report">) {
  const user = await userOr401();
  if (user instanceof Response) return user;
  let d = await findOwnedDiagnostic((await ctx.params).id, user.id);
  if (!d) return jsonError(404, "Not found.");
  if (d.status === "completed") return Response.json(toView(d));
  if (d.version === 2 && d.status === "in_progress" && currentScreen(parseFlow(d.flow)).kind === "done") {
    // A second click or tab may have got there first; either way, read it again.
    await saveIfUnchanged(d, { status: "ready" });
    d = await findOwnedDiagnostic(d.id, user.id);
    if (!d) return jsonError(404, "Not found.");
  }
  if (d.status !== "ready" && d.status !== "generating") {
    return jsonError(409, "The diagnostic isn't ready for a report yet.");
  }

  await startReportJob(d);

  // Either we just started it, or one is already running: report its state.
  const fresh = await findOwnedDiagnostic(d.id, user.id);
  return Response.json(toView(fresh!), { status: 202 });
}

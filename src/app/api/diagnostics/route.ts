import { jsonError, userOr401 } from "@/lib/api";
import { db } from "@/lib/db";
import { newDiagnosisError } from "@/lib/diagnostic/active-domains";
import { flowJson } from "@/lib/diagnostic/store";
import { emptyFlow } from "@/lib/diagnostic/v2/flow";

// Create a new Architect diagnosis (version 2) in the chosen domain.
export async function POST(req: Request) {
  const user = await userOr401();
  if (user instanceof Response) return user;

  const body = await req.json().catch(() => null);
  const domain = body?.domain;
  const error = newDiagnosisError(domain);
  if (error) return jsonError(400, error);

  const d = await db.diagnostic.create({ data: { userId: user.id, domain, version: 2, flow: flowJson(emptyFlow()) } });
  return Response.json({ id: d.id }, { status: 201 });
}

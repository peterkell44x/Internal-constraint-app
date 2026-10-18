import { jsonError, userOr401 } from "@/lib/api";
import { db } from "@/lib/db";
import { isDomainKey } from "@/lib/diagnostic/domains";
import { flowJson } from "@/lib/diagnostic/store";
import { emptyFlow } from "@/lib/diagnostic/v2/flow";

// Create a new Architect diagnosis (version 2) in the chosen domain.
export async function POST(req: Request) {
  const user = await userOr401();
  if (user instanceof Response) return user;

  const body = await req.json().catch(() => null);
  const domain = body?.domain;
  if (!isDomainKey(domain)) return jsonError(400, "Unknown domain.");

  const d = await db.diagnostic.create({ data: { userId: user.id, domain, version: 2, flow: flowJson(emptyFlow()) } });
  return Response.json({ id: d.id }, { status: 201 });
}

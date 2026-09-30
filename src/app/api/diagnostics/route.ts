import { jsonError, userOr401 } from "@/lib/api";
import { db } from "@/lib/db";
import { isDomainKey } from "@/lib/diagnostic/domains";

// Create a new diagnostic in the chosen domain. The first AI message is
// requested separately via /start so the page can show "thinking...".
export async function POST(req: Request) {
  const user = await userOr401();
  if (user instanceof Response) return user;

  const body = await req.json().catch(() => null);
  const domain = body?.domain;
  if (!isDomainKey(domain)) return jsonError(400, "Unknown domain.");

  const d = await db.diagnostic.create({ data: { userId: user.id, domain } });
  return Response.json({ id: d.id }, { status: 201 });
}

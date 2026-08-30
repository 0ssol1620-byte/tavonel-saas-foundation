import { GET as getCollection } from "../../../collections/[id]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return getCollection(request, context);
}

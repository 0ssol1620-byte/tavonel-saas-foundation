import { GET as getActiveWorld } from "../../../../collections/[id]/world/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return getActiveWorld(request, context);
}

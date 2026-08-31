import { POST as askActiveWorld } from "../../../collections/[id]/ask/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return askActiveWorld(request, context);
}

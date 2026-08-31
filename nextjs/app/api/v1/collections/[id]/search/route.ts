import { POST as searchActiveWorld } from "../../../../collections/[id]/search/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return searchActiveWorld(request, context);
}

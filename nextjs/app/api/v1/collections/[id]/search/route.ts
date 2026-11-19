import { POST as searchActiveWorld } from "../../../../collections/[id]/search/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The same platform bound as the route this wraps (a literal: Next.js reads segment config statically).
export const maxDuration = 60;

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return searchActiveWorld(request, context);
}

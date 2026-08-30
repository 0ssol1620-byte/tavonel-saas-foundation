import { POST as rotateDeveloperKey } from "../../../../v1/developer/keys/[id]/rotate/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return rotateDeveloperKey(request, context);
}

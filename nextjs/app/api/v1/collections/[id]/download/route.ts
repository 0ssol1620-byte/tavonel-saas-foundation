import { GET as downloadCollection } from "../../../../collections/[id]/download/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return downloadCollection(request, context);
}

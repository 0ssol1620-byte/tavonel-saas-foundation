import { DELETE as revokeConnection } from "../../../connections/[id]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return revokeConnection(request, context);
}

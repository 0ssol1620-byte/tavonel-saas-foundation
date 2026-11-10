import { NextResponse } from "next/server";
import { authorizeFoundationRevoke } from "@/lib/developer-auth";
import { revokeFoundationConnection } from "@/lib/developer-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  // Not plan-gated: a lapsed, held or trial workspace can still withdraw what it shared.
  const auth = await authorizeFoundationRevoke(request, "connections:write");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ code: "CONNECTION_ID_INVALID" }, { status: 400, headers: NO_STORE });
  const result = await revokeFoundationConnection(auth.principal.workspaceKey, id, {
    userId: auth.principal.userId,
    keyId: auth.principal.keyId,
  });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.code === "CONNECTION_NOT_FOUND" ? 404 : 503, headers: NO_STORE });
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

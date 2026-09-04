import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { revokeDeveloperApiKey } from "@/lib/developer-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  if (auth.principal.accessSource === "trial") {
    return NextResponse.json({ code: "TRIAL_FEATURE_NOT_INCLUDED" }, { status: 402, headers: NO_STORE });
  }
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ code: "API_KEY_ID_INVALID" }, { status: 400, headers: NO_STORE });
  const result = await revokeDeveloperApiKey(auth.principal.workspaceKey, auth.principal.userId, id);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.code === "API_KEY_NOT_FOUND" ? 404 : 503, headers: NO_STORE });
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

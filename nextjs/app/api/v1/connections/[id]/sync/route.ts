import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { parseConnectionBatchInput } from "@/lib/developer-contracts";
import { applyFoundationConnectionBatch } from "@/lib/developer-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeFoundationRequest(request, "connections:sync", "studio");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ code: "CONNECTION_ID_INVALID" }, { status: 400, headers: NO_STORE });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 1_100_000) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  const text = await request.text();
  if (text.length > 1_100_000) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
  }
  const batch = await parseConnectionBatchInput(body, auth.principal.workspaceKey);
  if (!batch) return NextResponse.json({ code: "CONNECTION_BATCH_INVALID" }, { status: 400, headers: NO_STORE });
  const result = await applyFoundationConnectionBatch(auth.principal.workspaceKey, id, {
    userId: auth.principal.userId,
    keyId: auth.principal.keyId,
  }, batch);
  if (!result.ok) {
    const status = result.code === "CONNECTION_CURSOR_CONFLICT" || result.code === "CONNECTION_BATCH_CONFLICT" ? 409 : result.code === "CONNECTION_NOT_SYNCABLE" ? 423 : 503;
    return NextResponse.json({ code: result.code }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ code: "OK", ...result.result }, { headers: NO_STORE });
}

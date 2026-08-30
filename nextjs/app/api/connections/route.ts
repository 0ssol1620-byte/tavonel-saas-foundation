import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { parseConnectionInput } from "@/lib/developer-contracts";
import { createFoundationConnection, listFoundationConnections } from "@/lib/developer-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await authorizeFoundationRequest(request, "connections:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const result = await listFoundationConnections(auth.principal.workspaceKey);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ code: "OK", connections: result.connections }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await authorizeFoundationRequest(request, "connections:write", "studio");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 8_192) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  const text = await request.text();
  if (text.length > 8_192) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
  }
  const input = parseConnectionInput(body);
  if (!input) return NextResponse.json({ code: "CONNECTION_INPUT_INVALID" }, { status: 400, headers: NO_STORE });
  const result = await createFoundationConnection(auth.principal.workspaceKey, {
    userId: auth.principal.userId,
    keyId: auth.principal.keyId,
  }, input);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ code: "CREATED", connection: result.connection }, { status: 201, headers: NO_STORE });
}

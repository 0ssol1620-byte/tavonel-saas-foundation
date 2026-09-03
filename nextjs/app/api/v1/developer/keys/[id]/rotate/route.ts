import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { parseDeveloperScopes } from "@/lib/developer-contracts";
import { rotateDeveloperApiKey } from "@/lib/developer-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { "Cache-Control": "no-store", "X-TAVONEL-API-Version": "1" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  /*
    An API key is how the Developer plan is used at all.

    Key issue, rotation and revocation all required "studio" while the plan that advertises
    "API and MCP access" is the observer-level one. That is the same mismatch the compile route
    had: a subscriber could pay for API access and then be unable to mint the credential that
    grants it. Collaboration is what the Team plan sells; a key to your own workspace is not
    collaboration.
  */
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ code: "API_KEY_ID_INVALID" }, { status: 400, headers: HEADERS });
  const text = await request.text();
  if (text.length > 8_192) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: HEADERS });
  let body: Record<string, unknown>;
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; }
  catch { return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: HEADERS }); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const scopes = parseDeveloperScopes(body.scopes);
  const expiresInDays = body.expiresInDays === null || body.expiresInDays === undefined ? null : Number(body.expiresInDays);
  if (!name || name.length > 80 || !scopes || (expiresInDays !== null && (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365))) {
    return NextResponse.json({ code: "API_KEY_INPUT_INVALID" }, { status: 400, headers: HEADERS });
  }
  const result = await rotateDeveloperApiKey({
    workspaceKey: auth.principal.workspaceKey,
    userId: auth.principal.userId,
    oldKeyId: id,
    name,
    scopes,
    expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
  });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.code === "API_KEY_NOT_FOUND" ? 404 : 503, headers: HEADERS });
  return NextResponse.json({ code: "ROTATED", apiVersion: 1, key: result.key, token: result.token, replacedKeyId: result.replacedKeyId }, { status: 201, headers: HEADERS });
}

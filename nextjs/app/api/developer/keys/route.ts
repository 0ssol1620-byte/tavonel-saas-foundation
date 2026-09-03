import { NextResponse } from "next/server";
import { parseDeveloperScopes } from "@/lib/developer-contracts";
import { requireFoundationSession } from "@/lib/developer-auth";
import { createDeveloperApiKey, listDeveloperApiKeys } from "@/lib/developer-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const result = await listDeveloperApiKeys(auth.principal.workspaceKey);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ code: "OK", keys: result.keys }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  /*
    An API key is how the Developer plan is used at all.

    Key issue, rotation and revocation all required "studio" while the plan that advertises
    "API and MCP access" is the observer-level one. That is the same mismatch the compile route
    had: a subscriber could pay for API access and then be unable to mint the credential that
    grants it. Collaboration is what the Team plan sells; a key to your own workspace is not
    collaboration.
  */
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 8_192) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  const text = await request.text();
  if (text.length > 8_192) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const scopes = parseDeveloperScopes(body.scopes);
  const expiresInDays = body.expiresInDays === null || body.expiresInDays === undefined ? null : Number(body.expiresInDays);
  if (!name || name.length > 80 || !scopes || (expiresInDays !== null && (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365))) {
    return NextResponse.json({ code: "API_KEY_INPUT_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const expiresAt = expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
  const result = await createDeveloperApiKey({
    workspaceKey: auth.principal.workspaceKey,
    userId: auth.principal.userId,
    name,
    scopes,
    expiresAt,
  });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ code: "CREATED", key: result.key, token: result.token }, { status: 201, headers: NO_STORE });
}

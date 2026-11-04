import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { parseDeveloperScopes, type DeveloperScope } from "@/lib/developer-contracts";
import { rotateDeveloperApiKey } from "@/lib/developer-store";
import { recordServerFunnel } from "@/lib/funnel-events";
import { trialAiAccess } from "@/lib/trial-ai-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { "Cache-Control": "no-store", "X-TAVONEL-API-Version": "1" };

type RotateInput =
  | { ok: true; name: string; scopes: DeveloperScope[]; expiresInDays: number | null }
  | { ok: false; code: "REQUEST_TOO_LARGE" | "INVALID_JSON" | "API_KEY_INPUT_INVALID"; status: 400 | 413 };

async function readRotateInput(request: Request): Promise<RotateInput> {
  const text = await request.text();
  if (text.length > 8_192) return { ok: false, code: "REQUEST_TOO_LARGE", status: 413 };
  let body: Record<string, unknown>;
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; }
  catch { return { ok: false, code: "INVALID_JSON", status: 400 }; }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const scopes = parseDeveloperScopes(body.scopes);
  const expiresInDays = body.expiresInDays === null || body.expiresInDays === undefined ? null : Number(body.expiresInDays);
  if (!name || name.length > 80 || !scopes || (expiresInDays !== null && (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365))) {
    return { ok: false, code: "API_KEY_INPUT_INVALID", status: 400 };
  }
  return { ok: true, name, scopes, expiresInDays };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });
  // Read first so the trial decision (flag on) and its shadow (flag off) judge the replacement's
  // actual scopes -- it stays read-only. The order of answers is unchanged: trial, id, then input.
  const input = await readRotateInput(request);
  const trial = await trialAiAccess(auth.principal, "key_rotate", input.ok ? input.scopes : null);
  if (!trial.ok) {
    if (trial.wouldAllow) recordServerFunnel("trial_ai_access_would_allow", { kind: "key_rotate" });
    return NextResponse.json({ code: trial.code }, { status: trial.status, headers: HEADERS });
  }
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ code: "API_KEY_ID_INVALID" }, { status: 400, headers: HEADERS });
  if (!input.ok) return NextResponse.json({ code: input.code }, { status: input.status, headers: HEADERS });
  const { name, scopes, expiresInDays } = input;
  const result = await rotateDeveloperApiKey({
    workspaceKey: auth.principal.workspaceKey,
    userId: auth.principal.userId,
    authorizationRevision: auth.principal.authorizationRevision,
    oldKeyId: id,
    name,
    scopes,
    expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
  });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.code === "API_KEY_NOT_FOUND" ? 404 : result.code === "AUTHORIZATION_CHANGED_RETRY" ? 403 : 503, headers: HEADERS });
  return NextResponse.json({ code: "ROTATED", apiVersion: 1, key: result.key, token: result.token, replacedKeyId: result.replacedKeyId }, { status: 201, headers: HEADERS });
}

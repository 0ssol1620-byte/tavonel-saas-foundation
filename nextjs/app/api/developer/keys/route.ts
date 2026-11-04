import { NextResponse } from "next/server";
import { parseDeveloperScopes } from "@/lib/developer-contracts";
import { requireFoundationSession, revalidateFoundationSession } from "@/lib/developer-auth";
import { createDeveloperApiKey, listDeveloperApiKeys } from "@/lib/developer-store";
import { recordServerFunnel } from "@/lib/funnel-events";
import { trialAiAccess, trialScopesAllowed, type TrialAiOperation } from "@/lib/trial-ai-access";
import type { FoundationPrincipal } from "@/lib/developer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

async function trialBlocked(principal: FoundationPrincipal, operation: TrialAiOperation) {
  const trial = await trialAiAccess(principal, operation);
  if (trial.ok) return null;
  if (trial.wouldAllow) recordServerFunnel("trial_ai_access_would_allow", { kind: operation });
  return NextResponse.json({ code: trial.code }, { status: trial.status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const blocked = await trialBlocked(auth.principal, "key_list");
  if (blocked) return blocked;
  const result = await listDeveloperApiKeys(auth.principal.workspaceKey);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: NO_STORE });
  const current = await revalidateFoundationSession(request, auth.principal, "observer");
  if (!current.ok) return NextResponse.json({ code: current.code }, { status: current.status, headers: NO_STORE });
  return NextResponse.json({ code: "OK", keys: result.keys }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const blocked = await trialBlocked(auth.principal, "key_create");
  if (blocked) return blocked;
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
  // Reached by a trial only with TRIAL_AI_ACCESS on: its one key is read-only, never a connector key.
  if (auth.principal.accessSource === "trial" && !trialScopesAllowed(scopes)) {
    return NextResponse.json({ code: "TRIAL_FEATURE_NOT_INCLUDED" }, { status: 402, headers: NO_STORE });
  }
  const expiresAt = expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
  const result = await createDeveloperApiKey({
    workspaceKey: auth.principal.workspaceKey,
    userId: auth.principal.userId,
    authorizationRevision: auth.principal.authorizationRevision,
    name,
    scopes,
    expiresAt,
  });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.code === "AUTHORIZATION_CHANGED_RETRY" ? 403 : 503, headers: NO_STORE });
  return NextResponse.json({ code: "CREATED", key: result.key, token: result.token }, { status: 201, headers: NO_STORE });
}

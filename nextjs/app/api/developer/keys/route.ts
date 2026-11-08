import { NextResponse } from "next/server";
import { parseDeveloperScopes, type DeveloperScope } from "@/lib/developer-contracts";
import { requireFoundationSession, revalidateFoundationSession } from "@/lib/developer-auth";
import { createDeveloperApiKey, listDeveloperApiKeys } from "@/lib/developer-store";
import { recordServerFunnel } from "@/lib/funnel-events";
import { trialAiAccess, type TrialAiOperation } from "@/lib/trial-ai-access";
import type { FoundationPrincipal } from "@/lib/developer-auth";
import { reservedKeyName } from "@/lib/remote-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

async function trialBlocked(principal: FoundationPrincipal, operation: TrialAiOperation, scopes: DeveloperScope[] | null = null) {
  const trial = await trialAiAccess(principal, operation, scopes);
  if (trial.ok) return null;
  if (trial.wouldAllow) recordServerFunnel("trial_ai_access_would_allow", { kind: operation });
  return NextResponse.json({ code: trial.code }, { status: trial.status, headers: NO_STORE });
}

type KeyInput =
  | { ok: true; name: string; scopes: DeveloperScope[]; expiresInDays: number | null }
  | { ok: false; code: "REQUEST_TOO_LARGE" | "INVALID_JSON" | "API_KEY_INPUT_INVALID"; status: 400 | 413 };

async function readKeyInput(request: Request): Promise<KeyInput> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 8_192) return { ok: false, code: "REQUEST_TOO_LARGE", status: 413 };
  const text = await request.text();
  if (text.length > 8_192) return { ok: false, code: "REQUEST_TOO_LARGE", status: 413 };
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, code: "INVALID_JSON", status: 400 };
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const scopes = parseDeveloperScopes(body.scopes);
  const expiresInDays = body.expiresInDays === null || body.expiresInDays === undefined ? null : Number(body.expiresInDays);
  // `MCP: ` labels the remote MCP's own keys; a new hand-made key may not take it. Classification is token_kind, not this.
  if (!name || name.length > 80 || reservedKeyName(name) || !scopes || (expiresInDays !== null && (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365))) {
    return { ok: false, code: "API_KEY_INPUT_INVALID", status: 400 };
  }
  return { ok: true, name, scopes, expiresInDays };
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
  return NextResponse.json({ code: "OK", keys: result.keys, remoteMcpKeys: result.remoteMcpKeys }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  // The body is read before the trial decision so the flag-on check and the flag-off shadow both
  // judge the scopes actually asked for (a trial key is read-only, never a connector key). A trial
  // still gets its 402 first; an input error answers only once the trial check has let it through.
  const input = await readKeyInput(request);
  const blocked = await trialBlocked(auth.principal, "key_create", input.ok ? input.scopes : null);
  if (blocked) return blocked;
  if (!input.ok) return NextResponse.json({ code: input.code }, { status: input.status, headers: NO_STORE });
  const { name, scopes, expiresInDays } = input;
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

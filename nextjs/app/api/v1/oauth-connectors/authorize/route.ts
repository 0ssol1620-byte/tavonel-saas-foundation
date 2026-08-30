import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { buildOAuthAuthorizationUrl, createOAuthPkce, parseOAuthConnectorProvider, readOAuthProviderRuntime, sha256Hex } from "@/lib/connector-oauth";
import { deleteOAuthSecret, putOAuthSecret, readOAuthSecretBrokerConfig } from "@/lib/connector-oauth-secrets";
import { createOAuthAuthorization } from "@/lib/connector-oauth-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store", "X-TAVONEL-API-Version": "1" };

export async function POST(request: Request) {
  const auth = await requireFoundationSession(request, "studio");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 4_096) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: HEADERS });
  const text = await request.text();
  if (text.length > 4_096) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: HEADERS });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text) as Record<string, unknown>; }
  catch { return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: HEADERS }); }
  const provider = parseOAuthConnectorProvider(body.provider);
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!provider || !displayName || displayName.length > 100) return NextResponse.json({ code: "OAUTH_CONNECTOR_INPUT_INVALID" }, { status: 400, headers: HEADERS });
  const runtime = readOAuthProviderRuntime(provider);
  const broker = readOAuthSecretBrokerConfig();
  if (!runtime || !broker) return NextResponse.json({ code: "OAUTH_PROVIDER_NOT_CONFIGURED" }, { status: 503, headers: HEADERS });

  const { state, verifier } = createOAuthPkce();
  const stateSha256 = await sha256Hex(state);
  let verifierReference = "";
  try {
    verifierReference = await putOAuthSecret(broker, `oauth/pkce/${auth.principal.workspaceKey}/${provider}/${stateSha256}`, verifier);
    const stored = await createOAuthAuthorization({
      workspaceKey: auth.principal.workspaceKey,
      userId: auth.principal.userId,
      provider,
      displayName,
      stateSha256,
      pkceVerifierReference: verifierReference,
      redirectUri: runtime.redirectUri,
      requestedScopes: runtime.scopes,
    });
    if (!stored.ok) {
      await deleteOAuthSecret(broker, verifierReference).catch(() => undefined);
      return NextResponse.json({ code: stored.code }, { status: 503, headers: HEADERS });
    }
    const authorizationUrl = await buildOAuthAuthorizationUrl(runtime, state, verifier);
    return NextResponse.json({ code: "AUTHORIZED_REDIRECT_READY", apiVersion: 1, provider, authorizationUrl, expiresAt: stored.expiresAt }, { headers: HEADERS });
  } catch {
    if (verifierReference) await deleteOAuthSecret(broker, verifierReference).catch(() => undefined);
    return NextResponse.json({ code: "OAUTH_AUTHORIZATION_START_FAILED" }, { status: 503, headers: HEADERS });
  }
}

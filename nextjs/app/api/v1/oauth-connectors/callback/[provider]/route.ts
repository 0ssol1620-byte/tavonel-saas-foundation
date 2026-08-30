import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { exchangeOAuthCode, fetchOAuthProviderIdentity, parseOAuthConnectorProvider, readOAuthProviderRuntime, sha256Hex } from "@/lib/connector-oauth";
import { deleteOAuthSecret, putOAuthSecret, readOAuthSecret, readOAuthSecretBrokerConfig } from "@/lib/connector-oauth-secrets";
import { consumeOAuthAuthorization, createOAuthConnection } from "@/lib/connector-oauth-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function workspaceRedirect(request: Request, status: "connected" | "failed", provider: string, code?: string) {
  const url = new URL("/workspace", request.url);
  url.searchParams.set("oauth", status);
  url.searchParams.set("provider", provider);
  if (code) url.searchParams.set("code", code);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store", "X-TAVONEL-API-Version": "1" } });
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await context.params;
  const provider = parseOAuthConnectorProvider(rawProvider);
  if (!provider) return workspaceRedirect(request, "failed", rawProvider, "OAUTH_PROVIDER_INVALID");
  const auth = await requireFoundationSession(request, "studio");
  if (!auth.ok) return workspaceRedirect(request, "failed", provider, auth.code);
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return workspaceRedirect(request, "failed", provider, "OAUTH_PROVIDER_DENIED");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || code.length > 4_096 || !/^[A-Za-z0-9_-]{40,128}$/.test(state)) return workspaceRedirect(request, "failed", provider, "OAUTH_CALLBACK_INVALID");
  const runtime = readOAuthProviderRuntime(provider);
  const broker = readOAuthSecretBrokerConfig();
  if (!runtime || !broker) return workspaceRedirect(request, "failed", provider, "OAUTH_PROVIDER_NOT_CONFIGURED");

  const consumed = await consumeOAuthAuthorization(await sha256Hex(state), provider, auth.principal.userId);
  if (!consumed.ok || consumed.authorization.workspaceKey !== auth.principal.workspaceKey || consumed.authorization.redirectUri !== runtime.redirectUri) {
    return workspaceRedirect(request, "failed", provider, "OAUTH_AUTHORIZATION_INVALID");
  }
  const authorization = consumed.authorization;
  let refreshTokenReference = "";
  try {
    const [verifier, clientSecret] = await Promise.all([
      readOAuthSecret(broker, authorization.pkceVerifierReference),
      readOAuthSecret(broker, runtime.clientSecretReference),
    ]);
    const tokens = await exchangeOAuthCode({ runtime, code, verifier, clientSecret });
    const identity = await fetchOAuthProviderIdentity(provider, tokens.accessToken);
    refreshTokenReference = await putOAuthSecret(
      broker,
      `oauth/refresh/${auth.principal.workspaceKey}/${provider}/${await sha256Hex(identity.accountId)}`,
      tokens.refreshToken,
    );
    const created = await createOAuthConnection({
      workspaceKey: auth.principal.workspaceKey,
      userId: auth.principal.userId,
      provider,
      displayName: authorization.displayName,
      providerAccountId: identity.accountId,
      providerAccountLabel: identity.label,
      grantedScopes: tokens.grantedScopes,
      clientSecretReference: runtime.clientSecretReference,
      refreshTokenReference,
    });
    if (!created.ok) {
      await deleteOAuthSecret(broker, refreshTokenReference).catch(() => undefined);
      return workspaceRedirect(request, "failed", provider, created.code);
    }
    return workspaceRedirect(request, "connected", provider);
  } catch {
    if (refreshTokenReference) await deleteOAuthSecret(broker, refreshTokenReference).catch(() => undefined);
    return workspaceRedirect(request, "failed", provider, "OAUTH_CALLBACK_FAILED");
  } finally {
    await deleteOAuthSecret(broker, authorization.pkceVerifierReference).catch(() => undefined);
  }
}

import { NextResponse } from "next/server";
import { createDeveloperApiKey, listDeveloperApiKeys, revokeDeveloperApiKey } from "@/lib/developer-store";
import {
  REMOTE_MCP_TOKEN_TTL_SECONDS,
  checkTokenRequest,
  codeIdMarker,
  keyNameFor,
  remoteMcpEnabled,
  remoteMcpSealingKey,
  type RemoteMcpTokenResponse,
} from "@/lib/remote-mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// OAuth 2.1 §3.2.3: token responses are never cached.
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

const oauthError = (status: number, error: string, error_description: string) =>
  NextResponse.json({ error, error_description }, { status, headers: NO_STORE });

/*
  POST /api/mcp/oauth/token -- authorization code + PKCE verifier in, read-only access token out.

  The token is a developer API key minted through the same RPC as Workspace > Developers, which
  re-checks the member's authorization revision at the moment of minting and writes the audit
  row. It holds only the granted read scopes and expires with the token.

  No refresh token is issued at this stage of the ladder: a client re-authorizes when the token
  expires. A second redemption of one code revokes the key the first one minted (OAuth 2.1
  §4.1.3) and is refused.
*/
export async function POST(request: Request) {
  if (!remoteMcpEnabled()) return new NextResponse(null, { status: 404 });
  const key = remoteMcpSealingKey();
  if (!key) return oauthError(503, "temporarily_unavailable", "REMOTE_MCP_NOT_CONFIGURED");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded")) {
    return oauthError(400, "invalid_request", "The token request must be application/x-www-form-urlencoded.");
  }
  const text = await request.text();
  if (text.length > 16_384) return oauthError(400, "invalid_request", "The token request is too large.");
  const checked = checkTokenRequest(new URLSearchParams(text), key, new URL(request.url).origin);
  if (!checked.ok) return oauthError(checked.status, checked.error, checked.error_description);
  const { grant } = checked;

  const existing = await listDeveloperApiKeys(grant.workspaceKey);
  if (!existing.ok) return oauthError(503, "temporarily_unavailable", existing.code);
  // ponytail: list-then-mint, not a unique constraint; two simultaneous redemptions of one code by
  // the PKCE holder can both mint. Add a code ledger with a unique index if that ever matters.
  const replayed = existing.keys.find((entry) => entry.name.endsWith(codeIdMarker(grant.codeId)));
  if (replayed) {
    if (!replayed.revokedAt) await revokeDeveloperApiKey(grant.workspaceKey, grant.userId, grant.authorizationRevision, replayed.keyId);
    return oauthError(400, "invalid_grant", "The authorization code was already used.");
  }

  const minted = await createDeveloperApiKey({
    workspaceKey: grant.workspaceKey,
    userId: grant.userId,
    authorizationRevision: grant.authorizationRevision,
    name: keyNameFor(grant),
    scopes: grant.scopes,
    expiresAt: new Date(Date.now() + REMOTE_MCP_TOKEN_TTL_SECONDS * 1000).toISOString(),
  });
  if (!minted.ok) {
    return minted.code === "AUTHORIZATION_CHANGED_RETRY"
      ? oauthError(400, "invalid_grant", "The workspace authorization changed since consent.")
      : oauthError(503, "temporarily_unavailable", minted.code);
  }
  const response: RemoteMcpTokenResponse = {
    access_token: minted.token,
    token_type: "Bearer",
    expires_in: REMOTE_MCP_TOKEN_TTL_SECONDS,
    scope: grant.scopes.join(" "),
  };
  return NextResponse.json(response, { headers: NO_STORE });
}

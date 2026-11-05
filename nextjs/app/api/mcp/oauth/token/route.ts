import { NextResponse } from "next/server";
import { recordServerFunnel } from "@/lib/funnel-events";
import { createDeveloperApiKey, listRecentRemoteMcpKeys, revokeDeveloperApiKey } from "@/lib/developer-store";
import { authorizeFoundationSessionProduct } from "@/lib/self-service-trial";
import {
  REMOTE_MCP_CODE_TTL_SECONDS,
  REMOTE_MCP_TOKEN_TTL_SECONDS,
  checkTokenRequest,
  clientTag,
  codeIdMarker,
  cohortRefusalStatus,
  keyNameFor,
  remoteMcpCohortRefusal,
  remoteMcpEnabled,
  remoteMcpSealingKey,
  requestOrigin,
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
  §4.1.3) and is refused. A reconnect revokes the same member's earlier keys for the same client
  (review R1 M6), so a connector holds one live key, not one per hour.

  The token is a `tvnl_mcp_` key: usable through /api/mcp only (lib/remote-mcp-dispatch.ts).
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
  const checked = checkTokenRequest(new URLSearchParams(text), key, requestOrigin(request));
  if (!checked.ok) return oauthError(checked.status, checked.error, checked.error_description);
  const { grant } = checked;
  // A1.0: no token outside the processing cohort, checked at minting -- not only at consent, so a
  // workspace removed from the cohort between consent and exchange gets nothing.
  const cohort = remoteMcpCohortRefusal(grant.workspaceKey);
  if (cohort) {
    return NextResponse.json(
      { error: cohort === "REMOTE_MCP_COHORT_EXCLUDED" ? "access_denied" : "temporarily_unavailable", error_description: cohort, code: cohort },
      { status: cohortRefusalStatus(cohort), headers: NO_STORE },
    );
  }

  /*
    Issue time, not only consent: a free evaluation holds no key (TRIAL_FEATURE_NOT_INCLUDED, as the
    consent route says), and a plan that lapsed in the code's 120 s gets nothing. W1-A2 (#186)
    replaces the trial refusal with its key cap, here as at consent.
  */
  const product = await authorizeFoundationSessionProduct(grant.workspaceKey, grant.userId, "observer");
  if (!product.ok || product.access.source === "trial") {
    const code = product.ok ? "TRIAL_FEATURE_NOT_INCLUDED" : product.code;
    const status = product.ok ? 402 : product.status;
    return NextResponse.json(
      { error: status >= 500 ? "temporarily_unavailable" : "access_denied", error_description: code, code },
      { status, headers: NO_STORE },
    );
  }

  const since = new Date(Date.now() - (REMOTE_MCP_TOKEN_TTL_SECONDS + REMOTE_MCP_CODE_TTL_SECONDS) * 1000).toISOString();
  const existing = await listRecentRemoteMcpKeys(grant.workspaceKey, grant.userId, since);
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
    audience: "mcp",
  });
  if (!minted.ok) {
    return minted.code === "AUTHORIZATION_CHANGED_RETRY"
      ? oauthError(400, "invalid_grant", "The workspace authorization changed since consent.")
      : oauthError(503, "temporarily_unavailable", minted.code);
  }
  // The new key first, then the old ones: a failed revoke leaves an old key to its expiry (≤ 1 h), said in the log.
  const tag = ` ~${clientTag(grant.clientId)} `;
  const superseded = existing.keys.filter((entry) => !entry.revokedAt && entry.name.includes(tag)
    && (entry.expiresAt === null || Date.parse(entry.expiresAt) > Date.now()));
  let unrevoked = 0;
  for (const entry of superseded) {
    const revoked = await revokeDeveloperApiKey(grant.workspaceKey, grant.userId, grant.authorizationRevision, entry.keyId);
    if (!revoked.ok) unrevoked += 1;
  }
  if (unrevoked > 0) console.error(JSON.stringify({ event: "mcp_superseded_key_revoke_failed", count: unrevoked }));
  recordServerFunnel("mcp_token_issued");
  const response: RemoteMcpTokenResponse = {
    access_token: minted.token,
    token_type: "Bearer",
    expires_in: REMOTE_MCP_TOKEN_TTL_SECONDS,
    scope: grant.scopes.join(" "),
  };
  return NextResponse.json(response, { headers: NO_STORE });
}

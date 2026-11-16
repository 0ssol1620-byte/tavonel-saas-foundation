import { NextResponse } from "next/server";
import { recordServerFunnel } from "@/lib/funnel-events";
import { createDeveloperApiKey, getRemoteMcpKey, listRecentRemoteMcpKeys, revokeDeveloperApiKey } from "@/lib/developer-store";
import { authorizeFoundationSessionProduct } from "@/lib/self-service-trial";
import { trialAiAccessEnabled, trialMcpTokenAccess } from "@/lib/trial-ai-access";
import {
  REMOTE_MCP_CODE_TTL_SECONDS,
  REMOTE_MCP_REFRESH_TTL_SECONDS,
  REMOTE_MCP_TOKEN_TTL_SECONDS,
  checkRefreshRequest,
  checkTokenRequest,
  clientTag,
  codeIdMarker,
  issueRefreshToken,
  cohortRefusalStatus,
  keyNameFor,
  remoteMcpRefreshEnabled,
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

  No refresh token is issued unless TAVONEL_REMOTE_MCP_REFRESH_ENABLED=true (off by default); then a
  sealed refresh token rotates with the key it is bound to, and a revoked key presented again ends
  that token's family (every key rotated from the same code). Off, a client re-authorizes when the token expires. A second redemption of one code revokes the keys the first one minted (OAuth 2.1
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
  const form = new URLSearchParams(text);
  const refreshing = remoteMcpRefreshEnabled() && form.get("grant_type") === "refresh_token";
  const checked = refreshing ? checkRefreshRequest(form, key) : checkTokenRequest(form, key, requestOrigin(request));
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
    Issue time, not only consent: a plan that lapsed in the code's 120 s gets nothing. A free
    evaluation gets TRIAL_FEATURE_NOT_INCLUDED, as the consent route says, unless trial AI access
    is on -- then W1-A2's one-live-key cap is checked here, where the key is minted (below).
  */
  const refuse = (code: string, status: number) => NextResponse.json(
    { error: status >= 500 ? "temporarily_unavailable" : "access_denied", error_description: code, code },
    { status, headers: NO_STORE },
  );
  const product = await authorizeFoundationSessionProduct(grant.workspaceKey, grant.userId, "observer");
  if (!product.ok) return refuse(product.code, product.status);
  const trial = product.access.source === "trial";
  if (trial && !trialAiAccessEnabled()) return refuse("TRIAL_FEATURE_NOT_INCLUDED", 402);

  const refreshOn = remoteMcpRefreshEnabled();
  const refreshKeyId = checked.refreshKeyId;
  const tag = ` ~${clientTag(grant.clientId)} `;
  const since = new Date(Date.now() - (REMOTE_MCP_TOKEN_TTL_SECONDS + REMOTE_MCP_CODE_TTL_SECONDS) * 1000).toISOString();
  // Flag off, one read of the last hour serves the replay check and the supersede, as before. Flag on,
  // each decision reads only the rows it decides on (this code's keys in the last hour; this client's
  // unrevoked keys within the refresh TTL, expired or not), so another client's rotations can never push
  // a row out of the capped read. A read that still overflows is a 503, not a partial decision.
  const existing = refreshKeyId !== undefined
    ? { ok: true as const, keys: [] }
    : refreshOn
      ? await listRecentRemoteMcpKeys(grant.workspaceKey, grant.userId, since, { nameLike: `*${codeIdMarker(grant.codeId).trim()}` })
      : await listRecentRemoteMcpKeys(grant.workspaceKey, grant.userId, since);
  if (!existing.ok) return oauthError(503, "temporarily_unavailable", existing.code);
  const family = refreshOn
    ? await listRecentRemoteMcpKeys(grant.workspaceKey, grant.userId, new Date(Date.now() - REMOTE_MCP_REFRESH_TTL_SECONDS * 1000).toISOString(), { nameLike: `*${tag.trim()}*`, unrevokedOnly: true })
    : existing;
  if (!family.ok) return oauthError(503, "temporarily_unavailable", family.code);
  // ponytail: list-then-mint, not a unique constraint; two simultaneous redemptions of one code by
  // the PKCE holder can both mint. Add a code ledger with a unique index if that ever matters.
  const live = (entry: { revokedAt: string | null; expiresAt: string | null }) => !entry.revokedAt && (refreshOn || entry.expiresAt === null || Date.parse(entry.expiresAt) > Date.now());
  /*
    A key is named `<client name> ~<client tag> #<code id>`, and every key a refresh rotates through keeps
    the code id that started it: that suffix is the family. Membership is read from the suffix only,
    because the client name before it is self-asserted and may carry another client's tag.
  */
  const marker = codeIdMarker(grant.codeId);
  const ofThisClient = (name: string) => name.slice(0, name.lastIndexOf(" #") + 1).endsWith(tag);
  // This member's earlier live keys for this client.
  const mine = family.keys.filter((entry) => ofThisClient(entry.name) && live(entry));
  const superseded = mine.map((entry) => entry.keyId);
  if (refreshKeyId !== undefined) {
    // Rotation is bound to the live key: it must still exist for this member, and not be revoked (expired is fine).
    const old = await getRemoteMcpKey(grant.workspaceKey, grant.userId, refreshKeyId);
    if (!old.ok) return oauthError(503, "temporarily_unavailable", old.code);
    if (!old.key) return oauthError(400, "invalid_grant", "The refresh token is not valid.");
    if (old.key.revokedAt) {
      // A rotated-out or revoked key presented again: treat as reuse and end the presented token's family.
      // Only that family: a stale token from a consent that was since replaced must not end the consent that replaced it.
      let failed = 0;
      for (const keyId of mine.filter((entry) => entry.name.endsWith(marker)).map((entry) => entry.keyId)) {
        const ended = await revokeDeveloperApiKey(grant.workspaceKey, grant.userId, grant.authorizationRevision, keyId);
        if (!ended.ok) failed += 1;
      }
      if (failed > 0) console.error(JSON.stringify({ event: "mcp_refresh_reuse_revoke_failed", count: failed }));
      return oauthError(400, "invalid_grant", "The refresh token is not valid.");
    }
  }
  // A replayed code ends every unrevoked key of the family it started (one key with the flag off).
  const replayed = existing.keys.filter((entry) => entry.name.endsWith(marker));
  if (replayed.length > 0) {
    for (const entry of replayed) {
      if (!entry.revokedAt) await revokeDeveloperApiKey(grant.workspaceKey, grant.userId, grant.authorizationRevision, entry.keyId);
    }
    return oauthError(400, "invalid_grant", "The authorization code was already used.");
  }
  // The earlier live keys are revoked once the new key exists, so a reconnect replaces them, and the
  // trial cap does not count them against the key that replaces them. The rotated key is always among them.
  const toRevoke = refreshKeyId !== undefined && !superseded.includes(refreshKeyId) ? [...superseded, refreshKeyId] : superseded;
  if (trial) {
    const capped = await trialMcpTokenAccess(
      { workspaceKey: grant.workspaceKey, userId: grant.userId, accessSource: "trial" },
      grant.scopes,
      toRevoke,
    );
    if (!capped.ok) return refuse(capped.code, capped.status);
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
  let unrevoked = 0;
  for (const keyId of toRevoke) {
    const revoked = await revokeDeveloperApiKey(grant.workspaceKey, grant.userId, grant.authorizationRevision, keyId);
    if (!revoked.ok) unrevoked += 1;
  }
  if (unrevoked > 0) console.error(JSON.stringify({ event: "mcp_superseded_key_revoke_failed", count: unrevoked }));
  recordServerFunnel("mcp_token_issued");
  const response: RemoteMcpTokenResponse = {
    access_token: minted.token,
    token_type: "Bearer",
    expires_in: REMOTE_MCP_TOKEN_TTL_SECONDS,
    scope: grant.scopes.join(" "),
    ...(remoteMcpRefreshEnabled() ? { refresh_token: issueRefreshToken(grant, minted.key.keyId, key) } : {}),
  };
  return NextResponse.json(response, { headers: NO_STORE });
}

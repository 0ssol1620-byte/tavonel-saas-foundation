import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consumeOAuthAuthorization, createOAuthAuthorization, markOAuthConnectionReauthorizationRequired } from "./connector-oauth-store";

// The withdrawn-grant flag is the only writer of `reauthorization_required`, and it is written
// by a worker with no user watching. So the assertions here are about the two things that
// cannot be observed later: the row it is allowed to touch, and its refusal to report success
// when it touched nothing.

const INPUT = {
  workspaceKey: "pilot-acme01",
  userId: "11111111-1111-4111-8111-111111111111",
  oauthConnectionId: "22222222-2222-4222-8222-222222222222",
  errorCode: "OAUTH_TOKEN_REFRESH_FAILED",
};

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://oauth-test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"x".repeat(40)}`);
}

function respond(body: unknown, status = 200) {
  const fetcher = vi.fn(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(() => {
  // Vercel Production carries real Supabase configuration; tests start empty and opt in.
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("markOAuthConnectionReauthorizationRequired", () => {
  it("refuses without reaching the network when the store is not configured", async () => {
    const fetcher = respond([{ oauth_connection_id: INPUT.oauthConnectionId }]);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "OAUTH_STORE_NOT_CONFIGURED",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("patches exactly one workspace-scoped, unrevoked row with the terminal error code", async () => {
    configure();
    const fetcher = respond([{ oauth_connection_id: INPUT.oauthConnectionId }]);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({ ok: true });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`oauth_connection_id=eq.${INPUT.oauthConnectionId}`);
    // Tenant scope and the revoked guard are in the query, not in application code: a
    // revoked connection is a closed record and must never be reopened by a worker.
    expect(url).toContain(`workspace_key=eq.${INPUT.workspaceKey}`);
    expect(url).toContain("status=neq.revoked");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "reauthorization_required",
      last_error_code: "OAUTH_TOKEN_REFRESH_FAILED",
      updated_by: INPUT.userId,
    });
    expect(typeof body.updated_at).toBe("string");
  });

  it("audits the transition under the action the constraint now allows", async () => {
    /*
      The status a workspace owner is asked to act on, with a record of who set it and why.
      `foundation_developer_audit_events.action` is a closed CHECK and had no value for this
      transition until 20260911120100 added one, which is why the flag first shipped
      unaudited: a refused constraint plus a fail-closed write would have made it unreachable
      again.
    */
    configure();
    const fetcher = respond([{ oauth_connection_id: INPUT.oauthConnectionId }]);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({ ok: true });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/foundation_developer_audit_events");
    expect(JSON.parse(String(init.body))).toMatchObject({
      workspace_key: INPUT.workspaceKey,
      action: "oauth_connection_reauthorization_required",
      target_id: INPUT.oauthConnectionId,
      actor_user_id: INPUT.userId,
      // The terminal code and nothing else: `details` may not carry a token or a document.
      details: { errorCode: INPUT.errorCode },
    });
  });

  it("refuses when the flag landed but the audit row did not, rather than reporting success", async () => {
    // The window PostgREST cannot close. Reported, because a state change nobody can attribute
    // is exactly what the audit ledger exists to prevent -- and the caller logs the refusal.
    configure();
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (call++ === 0
      ? Response.json([{ oauth_connection_id: INPUT.oauthConnectionId }])
      : Response.json({ code: "23514" }, { status: 400 }))));
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "DEVELOPER_AUDIT_WRITE_FAILED",
    });
  });

  it("refuses when the filter matched nothing, as it does for a revoked connection", async () => {
    configure();
    respond([]);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "OAUTH_CONNECTION_NOT_FOUND",
    });
  });

  it("refuses a rejected write rather than assuming the flag landed", async () => {
    configure();
    respond({ code: "42501" }, 403);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "OAUTH_CONNECTION_STATUS_WRITE_FAILED",
    });
  });

  it("refuses a write that touched more than the one named connection", async () => {
    configure();
    respond([{ oauth_connection_id: "a" }, { oauth_connection_id: "b" }]);
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "OAUTH_CONNECTION_STATUS_WRITE_FAILED",
    });
  });

  it("refuses a transport failure instead of throwing into the worker", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    await expect(markOAuthConnectionReauthorizationRequired(INPUT)).resolves.toEqual({
      ok: false,
      code: "OAUTH_CONNECTION_STATUS_WRITE_FAILED",
    });
  });
});

/*
  DB-B1 (review 2). Production's foundation_oauth_authorizations has no authorization_purpose column
  and its consume_foundation_oauth_authorization (20260920121000) returns no authorizationPurpose:
  both exist only in supabase/drafts/google-viewer-principal-boundary.sql. This database is that
  production schema: an insert naming an unknown column is refused as PostgREST does (PGRST204).
*/
describe("OAuth authorization against the production schema (viewer link off)", () => {
  const PRODUCTION_COLUMNS = new Set([
    "workspace_key", "provider", "display_name", "state_sha256", "pkce_verifier_reference", "redirect_uri",
    "requested_scopes", "created_by", "authorization_revision", "expires_at",
  ]);
  const authorization = {
    workspaceKey: "pilot-acme01", userId: INPUT.userId, provider: "google_drive" as const, displayName: "Research Drive",
    stateSha256: "a".repeat(64), pkceVerifierReference: "vault://tavonel/oauth/pkce/state",
    redirectUri: "https://tavonel.com/api/v1/oauth-connectors/callback/google_drive",
    requestedScopes: ["https://www.googleapis.com/auth/drive.readonly"], authorizationRevision: 3,
  };

  function productionDatabase() {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/v1/foundation_oauth_authorizations")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const unknown = Object.keys(body).find((key) => !PRODUCTION_COLUMNS.has(key));
        if (unknown) return Response.json({ code: "PGRST204", message: `Could not find the '${unknown}' column` }, { status: 400 });
        return Response.json([{ authorization_id: "49d42924-a3cc-4a09-b92d-9c86b58901a1" }], { status: 201 });
      }
      if (url.includes("/rest/v1/foundation_developer_audit_events")) return new Response(null, { status: 201 });
      if (url.includes("/rest/v1/rpc/consume_foundation_oauth_authorization")) {
        // 20260920121000's jsonb_build_object: no authorizationPurpose key.
        return Response.json({
          authorizationId: "49d42924-a3cc-4a09-b92d-9c86b58901a1", workspaceKey: "pilot-acme01", userId: INPUT.userId,
          authorizationRevision: 3, displayName: "Research Drive", pkceVerifierReference: authorization.pkceVerifierReference,
          redirectUri: authorization.redirectUri, requestedScopes: authorization.requestedScopes,
        });
      }
      return Response.json({}, { status: 500 });
    });
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  it("starts a connector authorization without the draft-only column", async () => {
    configure();
    const fetcher = productionDatabase();
    await expect(createOAuthAuthorization({ ...authorization, authorizationPurpose: "connector_connection" }))
      .resolves.toMatchObject({ ok: true, authorizationId: "49d42924-a3cc-4a09-b92d-9c86b58901a1" });
    const insert = fetcher.mock.calls.find(([input]) => String(input).includes("foundation_oauth_authorizations"));
    expect(JSON.parse(String((insert?.[1] as RequestInit).body))).not.toHaveProperty("authorization_purpose");
  });

  it("reads a production consume row with no purpose as a connector connection", async () => {
    configure();
    productionDatabase();
    const consumed = await consumeOAuthAuthorization("a".repeat(64), "google_drive");
    expect(consumed).toMatchObject({ ok: true, authorization: { authorizationPurpose: "connector_connection", authorizationRevision: 3 } });
  });

  it("names the column only for a viewer link, and refuses an unknown purpose", async () => {
    configure();
    const fetcher = productionDatabase();
    // The draft schema is what a viewer link needs; against production it fails closed.
    await expect(createOAuthAuthorization({ ...authorization, authorizationPurpose: "viewer_acl_link" }))
      .resolves.toEqual({ ok: false, code: "OAUTH_AUTHORIZATION_CREATE_FAILED" });
    const insert = fetcher.mock.calls.find(([input]) => String(input).includes("foundation_oauth_authorizations"));
    expect(JSON.parse(String((insert?.[1] as RequestInit).body))).toMatchObject({ authorization_purpose: "viewer_acl_link" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      authorizationId: "49d42924-a3cc-4a09-b92d-9c86b58901a1", workspaceKey: "pilot-acme01", userId: INPUT.userId,
      authorizationRevision: 3, displayName: "Research Drive", pkceVerifierReference: "vault://p", redirectUri: "https://r",
      requestedScopes: [], authorizationPurpose: "admin",
    })));
    await expect(consumeOAuthAuthorization("a".repeat(64), "google_drive")).resolves.toEqual({ ok: false, code: "OAUTH_AUTHORIZATION_INVALID" });
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { listOAuthSourcePage, oauthSourceDownloadRequest } from "./connector-oauth-adapters";
import { readOAuthProviderRuntime, type OAuthConnectorProvider } from "./connector-oauth";
import { listGoogleDriveLifecyclePage } from "./google-drive-lifecycle";
import { observeSourceVersion } from "./source-version-guard";

/*
  Customer-data gate #14: one provider's token, cursor, content or receipt must not reach another
  provider's path. Each check pins the exact origin or refusal rather than "one of the three".
  The worker half (the stored connection, not the job, chooses provider and reader) is in
  sync-worker.test.ts. Mocked providers only: this is not live-account qualification.
*/

const ORIGIN: Record<OAuthConnectorProvider, string> = {
  google_drive: "https://www.googleapis.com",
  dropbox: "https://content.dropboxapi.com",
  microsoft_graph: "https://graph.microsoft.com",
};
const PROVIDERS = Object.keys(ORIGIN) as OAuthConnectorProvider[];

function recorder(body: unknown) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    return Response.json(body);
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("per-provider isolation", () => {
  it.each(PROVIDERS)("builds %s downloads only for that provider's own origin", provider => {
    const request = oauthSourceDownloadRequest({ provider, nativeId: "item-1", revision: "a1c10ce0dd78", mimeType: "application/pdf" });
    expect(new URL(request.url).origin).toBe(ORIGIN[provider]);
  });

  it.each([
    ["dropbox", { entries: [], cursor: "c", has_more: false }, "https://api.dropboxapi.com"],
    ["microsoft_graph", { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/drive/root/delta?t=1" }, "https://graph.microsoft.com"],
  ] as const)("sends a %s bearer token only to its own listing origin", async (provider, body, origin) => {
    const { fetcher, calls } = recorder(body);
    await listOAuthSourcePage({ provider, accessToken: `${provider}-token`, cursor: null, fetcher });
    expect(calls).toEqual([{ url: expect.stringMatching(`^${origin}/`), auth: `Bearer ${provider}-token` }]);
  });

  it("refuses another provider's cursor before any request carries the token", async () => {
    const { fetcher, calls } = recorder({});
    const graphLink = "https://graph.microsoft.com/v1.0/me/drive/root/delta?$deltatoken=x";
    await expect(listOAuthSourcePage({ provider: "microsoft_graph", accessToken: "t", fetcher,
      cursor: "https://api.dropboxapi.com/2/files/list_folder/continue" })).rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
    await expect(listOAuthSourcePage({ provider: "dropbox", accessToken: "t", cursor: graphLink, fetcher }))
      .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
    for (const cursor of [graphLink, "AAHdropbox-cursor", "tavonel-sync-v1:3:AAHdropbox"]) {
      await expect(listGoogleDriveLifecyclePage({ accessToken: "t", cursor, fetcher })).rejects.toThrow("DRIVE_CURSOR_INVALID");
    }
    // A Google change cursor is not a Dropbox or Graph continuation either.
    const googleCursor = "tv-drive-v2:" + Buffer.from(JSON.stringify({ phase: "changes", drive: null, start: "s", page: null })).toString("base64url");
    await expect(listOAuthSourcePage({ provider: "microsoft_graph", accessToken: "t", cursor: googleCursor, fetcher }))
      .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
    await expect(listOAuthSourcePage({ provider: "google_drive", accessToken: "t", cursor: googleCursor, fetcher }))
      .rejects.toThrow("OAUTH_SOURCE_READER_RETIRED");
    expect(calls).toEqual([]);
  });

  it.each(["google_drive", "microsoft_graph"] as const)("reads %s version metadata only from its own origin", async provider => {
    const { fetcher, calls } = recorder({});
    const item = { nativeId: "file-1", name: "f", revision: "1", mimeType: "application/pdf", sizeBytes: 1, modifiedAt: null, kind: "file" as const };
    await expect(observeSourceVersion(provider, item, {}, `${provider}-token`, fetcher)).rejects.toThrow();
    expect(calls).toEqual([{ url: expect.stringMatching(`^${ORIGIN[provider]}/`), auth: `Bearer ${provider}-token` }]);
  });

  it("reads Dropbox version metadata only from its own API origin", async () => {
    const { fetcher, calls } = recorder({});
    const item = { nativeId: "id:file-1", name: "f", revision: "a1c10ce0dd78", mimeType: "application/pdf", sizeBytes: 1, modifiedAt: null, kind: "file" as const };
    await expect(observeSourceVersion("dropbox", item, {}, "dropbox-token", fetcher)).rejects.toThrow();
    expect(calls).toEqual([{ url: "https://api.dropboxapi.com/2/files/get_metadata", auth: "Bearer dropbox-token" }]);
  });

  it("configures a provider only from its own credentials and token endpoint", () => {
    const env = { TAVONEL_PUBLIC_ORIGIN: "https://tavonel.com", TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_ID: "google-client",
      TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_SECRET_REF: "vault://google/client" };
    expect(readOAuthProviderRuntime("dropbox", env)).toBeNull();
    expect(readOAuthProviderRuntime("microsoft_graph", env)).toBeNull();
    expect(new URL(readOAuthProviderRuntime("google_drive", env)!.tokenEndpoint).origin).toBe("https://oauth2.googleapis.com");
  });

  it("binds stored observations and tombstone receipts to the connection's own provider", () => {
    const bindings = readFileSync("../supabase/migrations/20260909193323_connector_document_bindings.sql", "utf8");
    const deletion = readFileSync("../supabase/migrations/20260920132000_legal_hold_deletion_sweeper.sql", "utf8");
    expect(bindings).toMatch(/workspace_key = new\.workspace_key\s+and provider = new\.provider and status = 'active'/);
    expect(deletion).toMatch(/c\.workspace_key = p_workspace_key\s+and c\.provider::text = p_provider;\s+if not found then raise exception 'SOURCE_DELETION_CONNECTION_MISMATCH'/);
    expect(deletion).toMatch(/b\.provider is distinct from p_provider\)/);
  });
});

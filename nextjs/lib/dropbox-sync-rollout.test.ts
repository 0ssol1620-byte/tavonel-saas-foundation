import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Dropbox sync against today's production schema, with the intake-approval rollout switch both ways.

  The database below has main dbe22b1e's connector functions and tables and nothing from migration
  20261007100000: any other function answers PostgREST's PGRST202, as production does. The real
  adapter, page store, reconciliation client, suspension/deletion store and job store run against
  it; only credentials and the byte import are stubbed.

  Off (shipped): the page syncs exactly as main does, and no request names reconcile_dropbox_source_page.
  On without the migration: the sync fails closed with a code naming the missing migration, and the
  checkpoint does not move.
*/

const PRODUCTION_FUNCTIONS = new Set(["connector_sync_page", "request_connector_source_deletion", "complete_foundation_job_batch"]);
const PRODUCTION_TABLES = new Set(["connector_source_suspensions"]);

const db = vi.hoisted(() => ({
  rollout: false,
  calls: [] as Array<{ name: string; body: Record<string, unknown> | null }>,
  pages: new Map<string, unknown>(),
  suspensions: [] as Array<Record<string, unknown>>,
}));
vi.mock("./intake-approval-rollout", () => ({ get INTAKE_APPROVAL_ROLLOUT_ENABLED() { return db.rollout; } }));

vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(40) }),
  supabaseAdminRequest: async (_config: unknown, path: string, init: RequestInit = {}) => {
    const url = new URL(path, "https://project.supabase.co");
    const rpc = url.pathname.startsWith("/rest/v1/rpc/");
    const name = url.pathname.replace(/^\/rest\/v1\/(rpc\/)?/, "");
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    db.calls.push({ name, body });
    if (!(rpc ? PRODUCTION_FUNCTIONS : PRODUCTION_TABLES).has(name)) {
      return Response.json({ code: rpc ? "PGRST202" : "PGRST205", message: `Could not find public.${name}` }, { status: 404 });
    }
    if (name === "connector_sync_page") {
      const key = String(body?.p_page_key);
      if (body?.p_page !== null) db.pages.set(key, body?.p_page);
      return Response.json(db.pages.get(key) ?? null);
    }
    if (name === "request_connector_source_deletion") return Response.json({ receiptId: `sha256:${"d".repeat(64)}`, status: "recorded" });
    if (name === "complete_foundation_job_batch") return Response.json({ state: body?.p_outcome === "succeeded" ? "succeeded" : "queued" });
    if (init.method === "POST") {
      db.suspensions.push(...(body as unknown as Array<Record<string, unknown>>));
      return Response.json(body);
    }
    const sourceId = url.searchParams.get("source_id")?.replace(/^eq\./, "");
    return Response.json(db.suspensions.filter(row => row.source_id === sourceId).slice(0, 1));
  },
}));

const importSourceObject = vi.hoisted(() => vi.fn());
vi.mock("./source-import", () => ({ importSourceObject }));
vi.mock("./customer-data-admission", () => ({ canAdmitCustomerSource: async () => true }));
vi.mock("./connector-oauth-store", () => ({
  getOAuthConnectionSecretReference: async () => ({ ok: true, provider: "dropbox", refreshTokenReference: "vault://refresh" }),
  markOAuthConnectionReauthorizationRequired: async () => ({ ok: true }),
}));
vi.mock("./connector-oauth", async importOriginal => ({
  ...await importOriginal<typeof import("./connector-oauth")>(),
  readOAuthProviderRuntime: () => ({ clientSecretReference: "vault://client" }),
  refreshOAuthAccessToken: async () => ({ accessToken: "at-1" }),
}));
vi.mock("./connector-oauth-secrets", () => ({ readOAuthSecret: async () => "secret", readOAuthSecretBrokerConfig: () => ({ kind: "vault" }) }));
vi.mock("./r2-synthetic-canary", () => ({ readR2SignerEnv: () => ({ accountId: "a", bucket: "b", accessKeyId: "k", secretAccessKey: "s" }) }));

import { connectorSourceIdentity } from "./connector-source-identity";
import { runSourceImportBatch } from "./sync-worker";
import type { ClaimedJob } from "./job-store";

const JOB: ClaimedJob = {
  jobId: `job-${"a".repeat(32)}`, workspaceKey: "pilot-acme01", jobType: "source_import", attempt: 1, maxAttempts: 5,
  oauthConnectionId: "22222222-2222-4222-8222-222222222222", collectionId: null,
  payload: { userId: "11111111-1111-4111-8111-111111111111" }, cursorToken: "dropbox-cursor-1", itemsSeen: 0, itemsDone: 0,
};

// A real list_folder/continue page: one file, then a DeletedMetadata (name and path, no id).
const DROPBOX_PAGE = {
  entries: [
    { ".tag": "file", id: "id:keep", name: "keep.pdf", path_lower: "/keep.pdf", rev: "015a", size: 100, server_modified: "2026-10-01T00:00:00Z" },
    { ".tag": "deleted", name: "old.pdf", path_lower: "/old.pdf" },
  ],
  cursor: "dropbox-cursor-2",
  has_more: false,
};

beforeEach(() => {
  db.rollout = false;
  db.calls.length = 0;
  db.pages.clear();
  db.suspensions.length = 0;
  importSourceObject.mockReset().mockImplementation(async (_ctx: unknown, item: { nativeId: string }) => ({
    ok: true, nativeId: item.nativeId, documentId: "doc", filename: "keep.pdf",
  }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(DROPBOX_PAGE)));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Dropbox sync with the intake-approval rollout switch off (the shipped value)", () => {
  it("ships off", async () => {
    const shipped = await vi.importActual<typeof import("./intake-approval-rollout")>("./intake-approval-rollout");
    expect(shipped.INTAKE_APPROVAL_ROLLOUT_ENABLED).toBe(false);
  });

  it("syncs a page with a DeletedMetadata as main dbe22b1e does, never naming reconcile_dropbox_source_page", async () => {
    const result = await runSourceImportBatch(JOB, "worker-1");
    expect(result).toEqual({ ok: true, value: { state: "succeeded", scanned: 2, imported: 1, skipped: [], complete: true } });

    // Main's mapping: the removal's path_lower is its nativeId, and nothing carries a providerPath.
    const removed = { nativeId: "/old.pdf", name: "old.pdf", revision: "deleted:/old.pdf", mimeType: null, sizeBytes: null, modifiedAt: null, kind: "deleted" };
    const kept = { nativeId: "id:keep", name: "keep.pdf", revision: "015a", mimeType: null, sizeBytes: 100, modifiedAt: "2026-10-01T00:00:00Z", kind: "file" };
    expect([...db.pages.values()]).toEqual([{ items: [kept, removed], cursor: "dropbox-cursor-2", complete: true }]);
    expect(importSourceObject).toHaveBeenCalledTimes(1);
    expect(importSourceObject.mock.calls[0]![1]).toEqual(kept);

    // Main's removal: suspended and tombstoned by that id at once, before any import or commit.
    const { sourceId } = await connectorSourceIdentity({ workspaceKey: JOB.workspaceKey, connectionId: JOB.oauthConnectionId!,
      provider: "dropbox", nativeId: "/old.pdf", revision: "suspension-identity-only" });
    expect(db.suspensions).toEqual([{ source_id: sourceId, workspace_key: JOB.workspaceKey, reason: "removed_or_inaccessible" }]);
    expect(db.calls.find(call => call.name === "request_connector_source_deletion")?.body)
      .toMatchObject({ p_source_id: sourceId, p_provider: "dropbox", p_reason: "provider_deleted" });

    expect(db.calls.map(call => call.name)).toEqual(["connector_sync_page", "connector_sync_page",
      "connector_source_suspensions", "connector_source_suspensions", "request_connector_source_deletion", "complete_foundation_job_batch"]);
    expect(db.calls.at(-1)?.body).toMatchObject({ p_outcome: "succeeded", p_items_seen_delta: 2, p_items_done_delta: 1, p_cursor_token: "dropbox-cursor-2" });
    expect(db.calls.some(call => call.name === "reconcile_dropbox_source_page")).toBe(false);
  });
});

describe("Dropbox sync with the switch on against a database without migration 20261007100000", () => {
  it("fails closed with DROPBOX_SOURCE_RECONCILIATION_MIGRATION_MISSING and keeps the checkpoint", async () => {
    db.rollout = true;
    const result = await runSourceImportBatch(JOB, "worker-1");
    expect(result).toEqual({ ok: false, code: "DROPBOX_SOURCE_RECONCILIATION_MIGRATION_MISSING" });

    expect(db.calls.map(call => call.name)).toEqual(["connector_sync_page", "connector_sync_page",
      "reconcile_dropbox_source_page", "complete_foundation_job_batch"]);
    // Retried, never failed or advanced: no cursor travels with the batch, so the job resumes at dropbox-cursor-1.
    expect(db.calls.at(-1)?.body).toMatchObject({ p_outcome: "retry", p_cursor_token: null, p_items_seen_delta: 0,
      p_items_done_delta: 0, p_error_code: "DROPBOX_SOURCE_RECONCILIATION_MIGRATION_MISSING" });
    expect(importSourceObject).not.toHaveBeenCalled();
    expect(db.suspensions).toEqual([]);
  });
});

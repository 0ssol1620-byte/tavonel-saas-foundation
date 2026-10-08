import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { request, config } = vi.hoisted(() => ({ request: vi.fn(), config: vi.fn() }));
vi.mock("./supabase-admin", () => ({ supabaseAdminRequest: request, readSupabaseAdminConfig: config }));
import { connectorSyncPageKey } from "./connector-sync-page";
import { reconcileDropboxSourcePage } from "./dropbox-source-reconciliation";
import type { ClaimedJob } from "./job-store";

const job: ClaimedJob = { jobId: "job-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", workspaceKey: "pilot-acme01",
  jobType: "source_import", attempt: 1, maxAttempts: 5, oauthConnectionId: "22222222-2222-4222-8222-222222222222",
  collectionId: null, payload: { target: { rootPath: "/Research" } }, cursorToken: null, itemsSeen: 0, itemsDone: 0 };
beforeEach(() => { vi.resetAllMocks(); config.mockReturnValue({}); });

describe("Dropbox source reconciliation store", () => {
  it("addresses the durable page key and replays one stored answer", async () => {
    request.mockImplementation(async () => Response.json({ suspend: ["id:A"], replayed: true }));
    const first = await reconcileDropboxSourcePage(job, "worker", "c1");
    const replay = await reconcileDropboxSourcePage(job, "worker-2", "c1");
    expect(first).toEqual({ ok: true, suspend: ["id:A"] });
    expect(replay).toEqual(first);
    const bodies = request.mock.calls.map(call => JSON.parse(call[2].body));
    expect(bodies[0]).toEqual({ p_workspace_key: job.workspaceKey, p_job_id: job.jobId, p_worker_id: "worker",
      p_page_key: connectorSyncPageKey(job, "c1") });
    expect(bodies[1].p_page_key).toBe(bodies[0].p_page_key);
  });

  it.each(["DROPBOX_SOURCE_PATH_UNRESOLVED", "DROPBOX_SOURCE_IDENTITY_LEGACY", "DROPBOX_SOURCE_STREAM_INVALID"])("passes the %s refusal through", async code => {
    request.mockResolvedValue(Response.json({ message: code }, { status: 400 }));
    expect(await reconcileDropboxSourcePage(job, "worker", null)).toEqual({ ok: false, code });
  });

  it("reports an unreachable store or a malformed answer as unavailable, never as an empty removal set", async () => {
    for (const response of [new Response(null, { status: 503 }), Response.json({ suspend: ["/a.pdf"] }),
      Response.json({ suspend: null }), Response.json({ message: "CONNECTOR_PAGE_LEASE_INVALID" }, { status: 400 })]) {
      request.mockResolvedValueOnce(response);
      expect(await reconcileDropboxSourcePage(job, "worker", null)).toEqual({ ok: false, code: "DROPBOX_SOURCE_RECONCILIATION_UNAVAILABLE" });
    }
    config.mockReturnValue(null);
    expect(await reconcileDropboxSourcePage(job, "worker", null)).toEqual({ ok: false, code: "DROPBOX_SOURCE_RECONCILIATION_UNAVAILABLE" });
  });
});

// Text contract only; behavior is in supabase/tests/dropbox_source_reconciliation.sql (pgTAP).
describe("Dropbox source reconciliation migration", () => {
  const migration = readFileSync("../supabase/migrations/20261007100000_dropbox_source_path_reconciliation.sql", "utf8");
  const body = migration.slice(migration.indexOf("function public.reconcile_dropbox_source_page("), migration.indexOf("\n$$;"));

  it("is additive: one transaction, new objects only, no binding or identity function touched", () => {
    expect(migration.match(/^begin;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    // enqueue_connector_sync is the one replaced function: it gains the in-place resume.
    expect(migration.match(/create or replace function public\.\w+/gi)).toEqual(["create or replace function public.enqueue_connector_sync"]);
    expect(migration).not.toMatch(/\b(drop|alter function)\b/i);
    // Bindings are read for the gate below, never written; the suspension and deletion guards are untouched.
    expect(migration).not.toMatch(/(insert into|update|delete from) public\.connector_document_bindings/);
    expect(migration).not.toMatch(/connector_source_suspensions|request_connector_source_deletion|guard_connector/);
  });

  it("applies entries in list_folder order, never removals first", () => {
    expect(body).toMatch(/with ordinality as e\(value, n\)\s+order by e\.n loop/);
    expect(body).not.toMatch(/order by \(e\.value->>'kind'\)/);
  });

  it("resumes an uncommitted Dropbox stream in place, keeping its cursor, progress and receipts", () => {
    const enqueue = migration.slice(migration.indexOf("function public.enqueue_connector_sync("));
    const resume = enqueue.slice(enqueue.indexOf("public.dropbox_uncommitted_source_stream(p_workspace_key, p_connection_id)"),
      enqueue.indexOf("v_key := encode("));
    expect(resume).toMatch(/update public\.foundation_jobs set state = 'queued'/);
    expect(resume).toMatch(/where workspace_key = p_workspace_key and job_id = v_existing\.job_id/);
    expect(resume).not.toMatch(/cursor_token|items_seen|items_done|payload =|insert into/);
    expect(migration).toMatch(/where j\.state in \('failed','dead'\) and j\.payload->>'sourceReaderVersion' = 'dropbox-list-v2'/);
  });

  it("guards every source_import insert for a Dropbox connection, not just enqueue_connector_sync", () => {
    expect(migration).toMatch(/create trigger foundation_jobs_dropbox_stream_guard before insert on public\.foundation_jobs/);
    const guard = migration.slice(migration.indexOf("function public.guard_dropbox_source_import_insert()"));
    expect(guard).toMatch(/raise exception 'DROPBOX_SOURCE_STREAM_INVALID'/);
    expect(guard).toMatch(/dropbox_uncommitted_source_stream\(new\.workspace_key, new\.oauth_connection_id\)\)\.job_id is not null[\s\S]*raise exception 'DROPBOX_SOURCE_STREAM_CONFLICT'/);
  });

  it("returns for suspension only staged ids with a Dropbox binding in this workspace and connection", () => {
    const boundary = body.slice(body.indexOf("if (v_page->>'complete')::boolean then"));
    expect(boundary).toMatch(/from public\.connector_document_bindings b\s+where b\.workspace_key = pr\.workspace_key and b\.oauth_connection_id = pr\.oauth_connection_id\s+and b\.provider = 'dropbox' and b\.native_id = pr\.native_id\) as bound/);
    expect(boundary).toMatch(/filter \(where r\.bound\)/);
    expect(boundary).toMatch(/filter \(where not r\.bound\)/);
  });

  it("reads the stored snapshot under lease and scope lock before the replay receipt", () => {
    expect(body).not.toMatch(/p_page jsonb/);
    const lease = body.indexOf("raise exception 'CONNECTOR_PAGE_LEASE_INVALID'");
    const snapshot = body.indexOf("from public.foundation_connector_page_snapshots");
    const lock = body.indexOf("pg_advisory_xact_lock");
    const receipt = body.indexOf("from public.dropbox_source_reconciliation_receipts");
    expect(lease).toBeGreaterThan(-1);
    expect(lease).toBeLessThan(snapshot);
    expect(snapshot).toBeLessThan(lock);
    expect(lock).toBeLessThan(receipt);
    expect(receipt).toBeLessThan(body.indexOf("jsonb_array_elements(v_page->'items') with ordinality"));
  });

  it("suspends only at the listing boundary and only ids with no live in-scope path", () => {
    const boundary = body.indexOf("if (v_page->>'complete')::boolean then");
    expect(boundary).toBeGreaterThan(-1);
    expect(body.slice(0, boundary)).not.toMatch(/jsonb_agg/);
    expect(body.slice(boundary)).toMatch(/not exists \(select 1 from public\.dropbox_source_paths p[\s\S]*p\.native_id = pr\.native_id and p\.live\)/);
    expect(body).toMatch(/raise exception 'DROPBOX_SOURCE_PATH_UNRESOLVED'/);
  });
});

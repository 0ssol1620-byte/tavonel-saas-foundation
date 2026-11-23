import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-E-CON-1: Dropbox and Microsoft Graph sync, qualified on recorded provider page shapes.

  The pages under __fixtures__/connector-pages are synthetic: written by hand from the providers'
  public API documentation (each file names the page and when it was read). No provider is called.
  They are served through the global fetch to the REAL adapter (connector-oauth-adapters.ts), and
  the REAL worker, page store, reconciliation client, suspension/deletion store, job store and
  critical-read check run against the in-memory PostgREST below. Stubbed: credentials, the byte
  import (importSourceObject), and the answers of reconcile_dropbox_source_page -- the SQL itself is
  proven in supabase/tests/dropbox_source_reconciliation.sql and is not changed here.

  The Dropbox reconciliation switch is mocked so both of its values are exercised; the shipped
  values of it and of the upload-approval lineage are read from the real modules at the end.
*/

const state = vi.hoisted(() => ({
  reconcile: true,
  provider: "dropbox" as "dropbox" | "microsoft_graph",
  calls: [] as Array<{ name: string; body: Record<string, unknown> | null }>,
  pages: new Map<string, unknown>(),
  suspensions: [] as Array<Record<string, unknown>>,
  bindings: [] as Array<Record<string, string>>,
  reconcileAnswers: [] as string[][],
  pageStoreDown: false,
  requests: [] as string[],
}));

vi.mock("./dropbox-reconciliation-switch", () => ({
  DROPBOX_RECONCILIATION_SWITCH: false,
  dropboxReconciliationEnabled: () => state.reconcile,
}));

vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: () => ({ url: "https://project.supabase.co", serviceRoleKey: "s".repeat(40) }),
  supabaseAdminRequest: async (_config: unknown, route: string, init: RequestInit = {}) => {
    const url = new URL(route, "https://project.supabase.co");
    const name = url.pathname.replace(/^\/rest\/v1\/(rpc\/)?/, "");
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    state.calls.push({ name, body });
    if (name === "connector_sync_page") {
      if (state.pageStoreDown) return Response.json({ message: "unavailable" }, { status: 503 });
      const key = String(body?.p_page_key);
      if (body?.p_page !== null) state.pages.set(key, body?.p_page);
      return Response.json(state.pages.get(key) ?? null);
    }
    if (name === "reconcile_dropbox_source_page") {
      const suspend = state.reconcileAnswers.shift();
      if (!suspend) return Response.json({ message: "UNEXPECTED_RECONCILIATION" }, { status: 500 });
      return Response.json({ suspend });
    }
    if (name === "request_connector_source_deletion") return Response.json({ receiptId: `sha256:${"d".repeat(64)}`, status: "recorded" });
    if (name === "complete_foundation_job_batch") return Response.json({ state: body?.p_outcome === "succeeded" ? "succeeded" : "queued" });
    if (name === "connector_documents_blocked") {
      // Mirrors 20260927102000's predicate for the one column this test moves: a bound document
      // whose source has a suspension row is blocked. Connection status and tombstones are not modelled.
      const ids = body?.p_document_ids as string[];
      const suspended = new Set(state.suspensions.map(row => row.source_id));
      return Response.json(state.bindings.some(row => ids.includes(row.document_id!) && suspended.has(row.source_id)));
    }
    if (name === "connector_document_bindings") return Response.json(state.bindings);
    if (name === "connector_source_suspensions") {
      if (init.method === "POST") {
        state.suspensions.push(...(body as unknown as Array<Record<string, unknown>>));
        return Response.json(body);
      }
      const sourceId = url.searchParams.get("source_id")?.replace(/^eq\./, "");
      return Response.json(state.suspensions.filter(row => row.source_id === sourceId).slice(0, 1));
    }
    return Response.json({ code: "PGRST202", message: `Could not find public.${name}` }, { status: 404 });
  },
}));

const importSourceObject = vi.hoisted(() => vi.fn());
vi.mock("./source-import", () => ({ importSourceObject }));
vi.mock("./customer-data-admission", () => ({ canAdmitCustomerSource: async () => true }));
vi.mock("./connector-oauth-store", () => ({
  getOAuthConnectionSecretReference: async () => ({ ok: true, provider: state.provider, refreshTokenReference: "vault://refresh" }),
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
import { connectorSyncPageKey } from "./connector-sync-page";
import { authorizeConnectorCriticalRead } from "./connector-critical-read";
import { readCompileReceiptSigner, signCompileReceipt, verifyCompileReceipt } from "./compile-receipt-signing";
import { readExportTrustStoreEnv } from "./export-signing";
import { REINVENTORY_PAGE_LIMIT, REINVENTORY_ROUND_LIMIT, runSourceImportBatch } from "./sync-worker";
import type { ClaimedJob } from "./job-store";

type Fixture = {
  synthetic: true; source: string[]; retrievedAt: string;
  // `path` is list_folder's scope; a page recorded without one answers the root ("").
  request: { method: string; url: string; cursor: string | null; path?: string };
  status: number; headers: Record<string, string>; body: unknown;
};
const FIXTURE_DIR = path.resolve(import.meta.dirname, "__fixtures__", "connector-pages");
const FIXTURES = new Map(readdirSync(FIXTURE_DIR).filter(file => file.endsWith(".json"))
  .map(file => [file.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as Fixture]));

/** Serves a recorded page for exactly the request it records; any other request is refused, not answered. */
async function providerFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  const body = init?.body ? JSON.parse(String(init.body)) as { cursor?: string; path?: string } : null;
  state.requests.push(body ? `${url} ${JSON.stringify(body.cursor ?? body.path)}` : url);
  const cursor = body?.cursor ?? null;
  const recorded = [...FIXTURES.values()].find(page => page.request.url === url
    && (url.startsWith("https://graph.microsoft.com/")
      || (page.request.cursor === cursor && (cursor !== null || (page.request.path ?? "") === body?.path))));
  if (!recorded) throw new Error(`UNRECORDED_PROVIDER_REQUEST ${url}`);
  return new Response(JSON.stringify(recorded.body), {
    status: recorded.status, headers: { "content-type": "application/json", ...recorded.headers },
  });
}

const WS = "pilot-acme01";
const CONNECTION = "22222222-2222-4222-8222-222222222222";
const VIEWER = "11111111-1111-4111-8111-111111111111";
const job = (cursorToken: string | null, target?: Record<string, string>): ClaimedJob => ({
  jobId: `job-${"a".repeat(32)}`, workspaceKey: WS, jobType: "source_import", attempt: 1, maxAttempts: 5,
  oauthConnectionId: CONNECTION, collectionId: null, payload: target ? { userId: VIEWER, target } : { userId: VIEWER },
  cursorToken, itemsSeen: 0, itemsDone: 0,
});
const names = () => state.calls.map(call => call.name);
const completions = () => state.calls.filter(call => call.name === "complete_foundation_job_batch").map(call => call.body!);
const imported = () => importSourceObject.mock.calls.map(call => call[1] as { nativeId: string; revision: string; providerPath?: string });
const suspendedNativeIds = async (provider: "dropbox" | "microsoft_graph", nativeIds: string[]) =>
  Promise.all(nativeIds.map(async nativeId => (await connectorSourceIdentity({ workspaceKey: WS, connectionId: CONNECTION,
    provider, nativeId, revision: "suspension-identity-only" })).sourceId));

beforeEach(() => {
  state.reconcile = true;
  state.provider = "dropbox";
  state.calls.length = 0;
  state.pages.clear();
  state.suspensions.length = 0;
  state.bindings.length = 0;
  state.reconcileAnswers.length = 0;
  state.pageStoreDown = false;
  state.requests.length = 0;
  importSourceObject.mockReset().mockImplementation(async (_ctx: unknown, item: { nativeId: string; kind: string }) => {
    state.calls.push({ name: "import", body: { nativeId: item.nativeId } });
    return item.kind === "folder"
      ? { ok: false, nativeId: item.nativeId, code: "SOURCE_NOT_QUALIFIED" }
      : { ok: true, nativeId: item.nativeId, documentId: "doc", filename: "f.pdf" };
  });
  vi.stubGlobal("fetch", vi.fn(providerFetch));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("recorded pages", () => {
  it("are labelled synthetic and name the documentation they were written from", () => {
    expect(FIXTURES.size).toBe(16);
    for (const page of FIXTURES.values()) {
      expect(page.synthetic).toBe(true);
      expect(page.source.length).toBeGreaterThan(0);
      for (const source of page.source) expect(source).toMatch(/^https:\/\/(learn\.microsoft\.com|raw\.githubusercontent\.com\/dropbox|docs\.dropboxapi\.com)\//);
      expect(Number.isFinite(Date.parse(page.retrievedAt))).toBe(true);
    }
  });
});

describe("Dropbox: a move split across pages, reconciliation switch on", () => {
  it("keeps the moved file's source: nothing is suspended at the old path, the id arrives at the new one", async () => {
    state.reconcileAnswers.push([], [], []);
    let cursor: string | null = null;
    for (const expected of ["AAHsynthetic-dropbox-cursor-1", "AAHsynthetic-dropbox-cursor-2", "AAHsynthetic-dropbox-cursor-3"]) {
      const result = await runSourceImportBatch(job(cursor), "worker-1");
      expect(result.ok).toBe(true);
      expect(completions().at(-1)).toMatchObject({ p_cursor_token: expected });
      cursor = expected;
    }
    expect(completions().map(row => row.p_outcome)).toEqual(["progress", "progress", "succeeded"]);
    expect(state.suspensions).toEqual([]);
    expect(names()).not.toContain("request_connector_source_deletion");
    // The removal never travels as an import, and the moved file arrives under its id, not a path.
    expect(imported().map(item => item.nativeId)).toEqual(["id:SYNTHkeep000000000000001", "id:SYNTHnotes00000000000002", "id:SYNTHq3000000000000000003"]);
    expect(imported()[2]!.providerPath).toBe("/archive/q3.pdf");
    // Every page went through reconciliation, keyed by the page the store holds.
    expect(state.calls.filter(call => call.name === "reconcile_dropbox_source_page").map(call => call.body!.p_page_key))
      .toEqual([null, "AAHsynthetic-dropbox-cursor-1", "AAHsynthetic-dropbox-cursor-2"].map(c => connectorSyncPageKey(job(c), c)));
  });

  it("contrast, switch off (shipped): main's path suspends the old path at once by its path_lower", async () => {
    state.reconcile = false;
    expect(await runSourceImportBatch(job(null), "worker-1")).toMatchObject({ ok: true });
    expect(names()).not.toContain("reconcile_dropbox_source_page");
    expect(state.suspensions.map(row => row.source_id)).toEqual(await suspendedNativeIds("dropbox", ["/reports/q3.pdf"]));
  });
});

describe("Dropbox: a deleted folder, reconciliation switch on", () => {
  it("tombstones what reconciliation resolves under the folder and never imports a file the page later removes", async () => {
    // reconcile_dropbox_source_page answers the boundary page with every id last observed under /old.
    state.reconcileAnswers.push(["id:SYNTHearlier00000000001", "id:SYNTHearlier00000000002"]);
    expect(await runSourceImportBatch(job("AAHsynthetic-dropbox-cursor-9"), "worker-1"))
      .toEqual({ ok: true, value: { state: "succeeded", scanned: 2, imported: 0, skipped: [], complete: true } });
    expect(importSourceObject).not.toHaveBeenCalled();
    const sourceIds = await suspendedNativeIds("dropbox", ["id:SYNTHearlier00000000001", "id:SYNTHearlier00000000002"]);
    expect(state.suspensions.map(row => row.source_id)).toEqual(sourceIds);
    expect(state.calls.filter(call => call.name === "request_connector_source_deletion").map(call => call.body))
      .toEqual(sourceIds.map(id => expect.objectContaining({ p_source_id: id, p_provider: "dropbox", p_reason: "provider_deleted" })));
    // Suspension and tombstone are committed before the cursor moves.
    expect(names().lastIndexOf("request_connector_source_deletion")).toBeLessThan(names().indexOf("complete_foundation_job_batch"));
    expect(completions()).toEqual([expect.objectContaining({ p_outcome: "succeeded", p_cursor_token: "AAHsynthetic-dropbox-cursor-10" })]);
  });
});

/** A source imported and bound before the scenario starts; the critical read answers for its document. */
const boundSource = async (provider: "dropbox" | "microsoft_graph", nativeId: string, revision: string) => {
  const id = await connectorSourceIdentity({ workspaceKey: WS, connectionId: CONNECTION, provider, nativeId, revision });
  const row = { document_id: id.documentId, source_id: id.sourceId, source_version_id: id.sourceVersionId,
    oauth_connection_id: CONNECTION, native_id: nativeId, provider };
  state.bindings.push(row);
  return row;
};
const criticalRead = (documentId: string) => authorizeConnectorCriticalRead({ workspaceKey: WS, documentIds: [documentId], viewerUserId: VIEWER });
/** Turns the crank until the job settles or `limit` turns pass. */
const runToEnd = async (start: string | null, target?: Record<string, string>, limit = 8) => {
  let cursor = start;
  const results: Array<Awaited<ReturnType<typeof runSourceImportBatch>>> = [];
  for (let turn = 0; turn < limit; turn += 1) {
    const result = await runSourceImportBatch(job(cursor, target), "worker-1");
    results.push(result);
    const last = completions().at(-1)!;
    if (last.p_outcome !== "progress") break;
    cursor = (last.p_cursor_token as string | null) ?? cursor;
  }
  return results;
};
const DRIVE = "https://graph.microsoft.com/v1.0/drives/SYNTHDRIVE2/root/delta";
const TEAM = { rootPath: "/team" };

describe("a dead cursor (Graph 410 resync, Dropbox 409 reset) starts a bounded re-inventory that never purges", () => {
  it.each([true, false])("Dropbox reset: re-lists /team from list_folder, keeps the unlisted source (reconciliation %s)", async reconcile => {
    state.reconcile = reconcile;
    state.reconcileAnswers.push([], []);
    const gone = await boundSource("dropbox", "id:SYNTHteamGone00000000001", "015a1c10ce0dd70");
    expect(await criticalRead(gone.document_id)).toMatchObject({ ok: true });

    const results = await runToEnd("AAHsynthetic-dropbox-cursor-3", TEAM);
    expect(results[0]).toEqual({ ok: true, value: { state: "queued", scanned: 0, imported: 0, skipped: [], complete: false, reinventoryRound: 1 } });
    expect(completions().map(row => [row.p_outcome, row.p_cursor_token])).toEqual([
      ["progress", "tavonel-resync-v1:1:0:0:"],
      ["progress", "tavonel-resync-v1:1:1:0:AAHsynthetic-dropbox-fresh-1"],
      // The page that ends the listing commits a bare provider cursor: the connection checkpoint.
      ["succeeded", "AAHsynthetic-dropbox-fresh-2"],
    ]);
    // The dead cursor is sent once; the fresh listing is list_folder on the job's own scope.
    expect(state.requests).toEqual([
      'https://api.dropboxapi.com/2/files/list_folder/continue "AAHsynthetic-dropbox-cursor-3"',
      'https://api.dropboxapi.com/2/files/list_folder "/team"',
      'https://api.dropboxapi.com/2/files/list_folder/continue "AAHsynthetic-dropbox-fresh-1"',
    ]);
    expect(imported().map(item => item.nativeId)).toEqual(["id:SYNTHteamA0000000000000001", "id:SYNTHteamB0000000000000002"]);
    // No purge: the source the re-inventory did not name is neither suspended nor tombstoned, and still reads.
    expect(state.suspensions).toEqual([]);
    expect(names()).not.toContain("request_connector_source_deletion");
    expect(await criticalRead(gone.document_id)).toMatchObject({ ok: true });
    if (reconcile) {
      // Each round page is reconciled under the round's own durable key.
      expect(state.calls.filter(call => call.name === "reconcile_dropbox_source_page").map(call => call.body!.p_page_key))
        .toEqual(["tavonel-resync-v1:1:", "tavonel-resync-v1:1:AAHsynthetic-dropbox-fresh-1"].map(c => connectorSyncPageKey(job(null, TEAM), c)));
    } else {
      expect(names()).not.toContain("reconcile_dropbox_source_page");
    }
  });

  it("Graph 410: re-enumerates the drive from its root delta, never the Location, keeps the unlisted source, duplicates none", async () => {
    state.provider = "microsoft_graph";
    state.reconcile = false;
    const gone = await boundSource("microsoft_graph", "SYNTHGONE01", "eSYNTHgone01v1");
    const kept = await boundSource("microsoft_graph", "SYNTHKEEP01", "eSYNTHkeep01v1");

    await runToEnd(`${DRIVE}?token=SYNTHdead2`, { driveId: "SYNTHDRIVE2" });
    expect(completions().map(row => [row.p_outcome, row.p_cursor_token])).toEqual([
      ["progress", "tavonel-resync-v1:1:0:0:"],
      ["progress", `tavonel-resync-v1:1:1:0:${DRIVE}?token=SYNTHfresh1`],
      ["succeeded", `${DRIVE}?token=SYNTHfresh2`],
    ]);
    expect(state.requests).toEqual([`${DRIVE}?token=SYNTHdead2`, `${DRIVE}?%24top=25`, `${DRIVE}?token=SYNTHfresh1`]);
    expect(state.requests.join(" ")).not.toContain("SYNTHlocation");
    expect(state.suspensions).toEqual([]);
    expect(names()).not.toContain("request_connector_source_deletion");
    expect(await criticalRead(gone.document_id)).toMatchObject({ ok: true });
    // Re-listing an unchanged item lands on the source, version and document it already had.
    const again = imported().find(item => item.nativeId === "SYNTHKEEP01")!;
    const identity = await connectorSourceIdentity({ workspaceKey: WS, connectionId: CONNECTION, provider: "microsoft_graph",
      nativeId: again.nativeId, revision: again.revision });
    expect([identity.sourceId, identity.documentId]).toEqual([kept.source_id, kept.document_id]);
  });

  it("a round's first page is listed fresh, never replayed from the job's own first page", async () => {
    state.provider = "microsoft_graph";
    state.reconcile = false;
    const target = { driveId: "SYNTHDRIVE2" };
    // The job's original first page (cursor null) is already durable, naming an item the drive no longer has.
    state.pages.set(connectorSyncPageKey(job(null, target), null), { items: [{ nativeId: "SYNTHSTALE01", name: "stale.pdf",
      revision: "eSTALE", mimeType: "application/pdf", sizeBytes: 1, modifiedAt: null, kind: "file" }],
    cursor: `${DRIVE}?token=SYNTHfresh1`, complete: false });
    await runSourceImportBatch(job("tavonel-resync-v1:1:0:0:", target), "worker-1");
    expect(state.requests).toEqual([`${DRIVE}?%24top=25`]);
    expect(imported().map(item => item.nativeId)).toEqual(["SYNTHKEEP01"]);
  });

  it.each([
    ["Graph 503", "microsoft_graph", `${DRIVE}?token=SYNTHbusy2`],
    ["Dropbox 500", "dropbox", "AAHsynthetic-dropbox-busy"],
    ["Dropbox 409 that is not a reset (path/not_found)", "dropbox", "AAHsynthetic-dropbox-gone-root"],
  ] as const)("%s is an outage, not a resync: retried with the checkpoint held, in or out of a round", async (_name, provider, cursor) => {
    state.provider = provider;
    for (const token of [cursor, `tavonel-resync-v1:1:7:0:${cursor}`]) {
      state.calls.length = 0;
      state.requests.length = 0;
      expect(await runSourceImportBatch(job(token), "worker-1")).toEqual({ ok: false, code: "SOURCE_LIST_FAILED" });
      expect(completions()).toEqual([expect.objectContaining({ p_outcome: "retry", p_cursor_token: null, p_error_code: "SOURCE_LIST_FAILED" })]);
      expect(state.requests).toHaveLength(1);
    }
    expect(state.pages.size).toBe(0);
    expect(state.suspensions).toEqual([]);
    expect(importSourceObject).not.toHaveBeenCalled();
  });

  it("page bound: the round stops, failed and named, on the turn after its last allowed page; a page that ends the listing still succeeds", async () => {
    state.reconcile = false;
    const last = REINVENTORY_PAGE_LIMIT - 1;
    expect(await runToEnd(`tavonel-resync-v1:1:${last}:0:`, TEAM)).toEqual([
      expect.objectContaining({ ok: true }),
      { ok: false, code: "SOURCE_REINVENTORY_BOUND_EXCEEDED" },
    ]);
    expect(completions().map(row => [row.p_outcome, row.p_cursor_token ?? row.p_error_code])).toEqual([
      ["progress", `tavonel-resync-v1:1:${REINVENTORY_PAGE_LIMIT}:0:AAHsynthetic-dropbox-fresh-1`],
      ["failed", "SOURCE_REINVENTORY_BOUND_EXCEEDED"],
    ]);
    expect(state.requests).toHaveLength(1);

    state.calls.length = 0;
    expect(await runSourceImportBatch(job(`tavonel-resync-v1:1:${last}:0:AAHsynthetic-dropbox-fresh-1`, TEAM), "worker-1"))
      .toMatchObject({ ok: true, value: { complete: true } });
    expect(completions()).toEqual([expect.objectContaining({ p_outcome: "succeeded", p_cursor_token: "AAHsynthetic-dropbox-fresh-2" })]);
    expect(state.suspensions).toEqual([]);
  });

  it("round bound: a reset inside a round starts the next round until the last, then the job stops failed and named", async () => {
    state.reconcile = false;
    expect(await runSourceImportBatch(job("tavonel-resync-v1:1:3:0:AAHsynthetic-dropbox-cursor-3"), "worker-1"))
      .toMatchObject({ ok: true, value: { reinventoryRound: 2 } });
    expect(completions().at(-1)).toMatchObject({ p_outcome: "progress", p_cursor_token: "tavonel-resync-v1:2:0:0:" });

    state.calls.length = 0;
    expect(await runSourceImportBatch(job(`tavonel-resync-v1:${REINVENTORY_ROUND_LIMIT}:3:0:AAHsynthetic-dropbox-cursor-3`), "worker-1"))
      .toEqual({ ok: false, code: "SOURCE_REINVENTORY_BOUND_EXCEEDED" });
    expect(completions()).toEqual([expect.objectContaining({ p_outcome: "failed", p_error_code: "SOURCE_REINVENTORY_BOUND_EXCEEDED", p_cursor_token: null })]);
    expect(state.suspensions).toEqual([]);
    expect(names()).not.toContain("request_connector_source_deletion");
  });

  it.each([
    "tavonel-resync-v1:0:0:0:", `tavonel-resync-v1:${REINVENTORY_ROUND_LIMIT + 1}:0:0:`, `tavonel-resync-v1:1:${REINVENTORY_PAGE_LIMIT + 1}:0:`,
    "tavonel-resync-v1:01:0:0:", "tavonel-resync-v1:1:-1:0:", "tavonel-resync-v1:1:1e2:0:", "tavonel-resync-v1:1:0:", "tavonel-resync-v1:",
    "tavonel-resync-v1:1:0:NaN:", "tavonel-resync-v1: 1:0:0:", "tavonel-resync-v1:1:0:9999999:",
  ])("a round token out of range or malformed (%s) is refused before any provider request", async token => {
    expect(await runSourceImportBatch(job(token), "worker-1")).toEqual({ ok: false, code: "JOB_CURSOR_INVALID" });
    expect(completions()).toEqual([expect.objectContaining({ p_outcome: "failed", p_error_code: "JOB_CURSOR_INVALID" })]);
    expect(state.requests).toEqual([]);
  });
});

/*
  The class, not the inputs above: "the provider says this continuation is dead" is the ONLY thing
  that starts a round. Generated provider answers -- every status from 200 to 599, bodies that put a
  resync code or a reset tag in the right place, the wrong place, the wrong type, the wrong case,
  too deep, or not at all, non-JSON, redirects, thrown transports -- go through the real adapter and
  the real worker. Each generator states whether its answer is a resync; the worker must agree, and
  whatever it decides, it never imports, suspends or deletes on that turn.
*/
describe("generated provider answers: only a dead-continuation signal starts a round", () => {
  type Answer = { resync: boolean; status: number; body: string | null; headers?: Record<string, string>; throws?: boolean };
  const seeded = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const GRAPH_CODES = ["resyncRequired", "resyncChangesApplyDifferences", "resyncChangesUploadDifferences"];
  const DECOYS = ["ResyncRequired", "resync", "reset", "Reset", "resyncrequired", "serviceNotAvailable", "itemNotFound", "__proto__",
    "constructor", "", "resyncRequired ", "activityLimitReached", "path", "other"];
  const nest = (code: unknown, depth: number, key: "innererror" | "innerError") => {
    let error: Record<string, unknown> = { code };
    for (let level = 0; level < depth; level += 1) error = { code: "generalException", [key]: error };
    return error;
  };

  const generators: Array<(pick: () => number, provider: "dropbox" | "microsoft_graph") => Answer> = [
    // The signal, in every documented shape.
    (pick, provider) => provider === "microsoft_graph"
      ? { resync: true, status: 410, body: JSON.stringify({ error: nest(GRAPH_CODES[Math.floor(pick() * 3)], Math.floor(pick() * 8), pick() < 0.5 ? "innererror" : "innerError") }) }
      : { resync: true, status: 409, body: JSON.stringify({ error_summary: "reset/..", error: { ".tag": "reset" } }) },
    // The right code or tag under any other status.
    (pick, provider) => {
      let status = 200 + Math.floor(pick() * 400);
      if (status === (provider === "microsoft_graph" ? 410 : 409)) status += 1;
      return { resync: false, status, body: JSON.stringify(provider === "microsoft_graph"
        ? { error: { code: GRAPH_CODES[Math.floor(pick() * 3)] } } : { error: { ".tag": "reset" } }) };
    },
    // The right status, a decoy code or tag, or the right one in the wrong place or type, or nested past the walk.
    (pick, provider) => {
      const decoy = DECOYS[Math.floor(pick() * DECOYS.length)];
      const shapes = provider === "microsoft_graph"
        ? [{ error: { code: decoy } }, { code: "resyncRequired" }, { error: { code: ["resyncRequired"] } }, { error: "resyncRequired" },
          { error: [{ code: "resyncRequired" }] }, { error: { message: "resyncRequired" } }, { error: nest("resyncRequired", 8, "innererror") }, null, 7]
        : [{ error: { ".tag": decoy } }, { ".tag": "reset" }, { error: "reset" }, { error: [{ ".tag": "reset" }] },
          { error: { ".tag": ["reset"] } }, { error_summary: "reset/..", error: { ".tag": "path", path: { ".tag": "reset" } } }, null, "reset"];
      return { resync: false, status: provider === "microsoft_graph" ? 410 : 409, body: JSON.stringify(shapes[Math.floor(pick() * shapes.length)]) };
    },
    // Not JSON at all, or nothing.
    (pick, provider) => ({ resync: false, status: provider === "microsoft_graph" ? 410 : 409,
      body: ["", "reset", "<html>Gone</html>", "{\"error\":{\".tag\":\"reset\"}", "\u0000", "{".repeat(64)][Math.floor(pick() * 6)]! }),
    // Outages: 5xx and 429.
    pick => ({ resync: false, status: [429, 500, 502, 503, 504, 507, 509][Math.floor(pick() * 7)]!, body: JSON.stringify({ error: { code: "serviceNotAvailable" } }),
      headers: { "retry-after": "30" } }),
    // A redirect, followed until the hop limit or refused without a Location.
    pick => ({ resync: false, status: 301 + Math.floor(pick() * 7), body: null,
      headers: pick() < 0.5 ? {} as Record<string, string> : { location: "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=SYNTHloop" } }),
    // A transport that throws (timeout, reset connection).
    () => ({ resync: false, status: 0, body: null, throws: true }),
  ];

  it.each(["dropbox", "microsoft_graph"] as const)("%s: 600 generated answers, in and out of a round", async provider => {
    state.provider = provider;
    state.reconcile = provider === "dropbox";
    const pick = seeded(provider === "dropbox" ? 0x5eed : 0xbeef);
    const continuation = provider === "dropbox" ? "AAHfuzz-cursor" : "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=SYNTHfuzz";
    const seen = { resync: 0, other: 0 };
    for (let index = 0; index < 600; index += 1) {
      const answer = generators[Math.floor(pick() * generators.length)]!(pick, provider);
      const round = Math.floor(pick() * (REINVENTORY_ROUND_LIMIT + 1));
      const token = round === 0 ? continuation : `tavonel-resync-v1:${round}:${Math.floor(pick() * REINVENTORY_PAGE_LIMIT)}:0:${continuation}`;
      state.calls.length = 0;
      state.requests.length = 0;
      vi.stubGlobal("fetch", vi.fn(async () => {
        if (answer.throws) throw new TypeError("fetch failed");
        return new Response(answer.status === 204 || answer.status === 205 || answer.status === 304 ? null : answer.body,
          { status: answer.status, headers: answer.headers ?? {} });
      }));
      const result = await runSourceImportBatch(job(token), "worker-1");
      const label = `${provider} #${index} round ${round} ${answer.status} ${String(answer.body).slice(0, 80)}`;
      expect(completions(), label).toHaveLength(1);
      const [done] = completions();
      if (answer.resync && round < REINVENTORY_ROUND_LIMIT) {
        expect(result, label).toMatchObject({ ok: true, value: { reinventoryRound: round + 1, scanned: 0 } });
        expect(done, label).toMatchObject({ p_outcome: "progress", p_cursor_token: `tavonel-resync-v1:${round + 1}:0:0:` });
      } else if (answer.resync) {
        expect(result, label).toEqual({ ok: false, code: "SOURCE_REINVENTORY_BOUND_EXCEEDED" });
        expect(done, label).toMatchObject({ p_outcome: "failed", p_cursor_token: null });
      } else {
        // Outage or unreadable answer: never a round, and the checkpoint stays where it was.
        expect(result.ok, label).toBe(false);
        expect(["SOURCE_LIST_FAILED", "OAUTH_SOURCE_PAGE_INVALID", "OAUTH_SOURCE_CURSOR_INVALID"], label).toContain(done!.p_error_code);
        expect(done, label).toMatchObject({ p_outcome: "retry", p_cursor_token: null });
      }
      seen[answer.resync ? "resync" : "other"] += 1;
      expect(state.suspensions, label).toEqual([]);
      expect(names(), label).not.toContain("request_connector_source_deletion");
      expect(names(), label).not.toContain("reconcile_dropbox_source_page");
      expect(importSourceObject, label).not.toHaveBeenCalled();
      expect(state.pages.size, label).toBe(0);
    }
    // Both sides of the property were exercised, not just the common one.
    expect(seen.resync).toBeGreaterThan(50);
    expect(seen.other).toBeGreaterThan(300);
  }, 60_000);

  it("a provider that starts no continuation (the first listing) cannot ask for a round", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error_summary: "reset/..", error: { ".tag": "reset" } }, { status: 409 })));
    expect(await runSourceImportBatch(job(null), "worker-1")).toEqual({ ok: false, code: "SOURCE_LIST_FAILED" });
    state.provider = "microsoft_graph";
    state.calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "resyncRequired" } }, { status: 410 })));
    expect(await runSourceImportBatch(job(null), "worker-1")).toEqual({ ok: false, code: "SOURCE_LIST_FAILED" });
    expect(completions()).toEqual([expect.objectContaining({ p_outcome: "retry", p_cursor_token: null })]);
  });
});

describe("a listed page is durable before its cursor moves", () => {
  it("a page that cannot be made durable commits no cursor", async () => {
    state.pageStoreDown = true;
    expect(await runSourceImportBatch(job(null), "worker-1")).toEqual({ ok: false, code: "CONNECTOR_PAGE_STORE_UNAVAILABLE" });
    expect(completions()).toEqual([expect.objectContaining({ p_outcome: "retry", p_cursor_token: null })]);
    expect(importSourceObject).not.toHaveBeenCalled();
    expect(state.suspensions).toEqual([]);
  });

  it("a cursor is committed only after the page it ends was persisted", async () => {
    state.reconcileAnswers.push([]);
    await runSourceImportBatch(job(null), "worker-1");
    const persisted = state.calls.findIndex(call => call.name === "connector_sync_page" && call.body?.p_page !== null);
    const committed = state.calls.findIndex(call => call.name === "complete_foundation_job_batch" && call.body?.p_cursor_token !== null);
    expect(persisted).toBeGreaterThanOrEqual(0);
    expect(committed).toBeGreaterThan(persisted);
  });
});

describe("Microsoft Graph: nextLink to deltaLink, a move, a delete and the critical read", () => {
  const nextLink = "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=SYNTHnext1";
  const binding = async (nativeId: string, revision: string) => {
    const id = await connectorSourceIdentity({ workspaceKey: WS, connectionId: CONNECTION, provider: "microsoft_graph", nativeId, revision });
    return { document_id: id.documentId, source_id: id.sourceId, source_version_id: id.sourceVersionId,
      oauth_connection_id: CONNECTION, native_id: nativeId, provider: "microsoft_graph" };
  };

  it("pages by nextLink, ends on deltaLink, keeps a moved item's id and refuses a deleted one before any reindex", async () => {
    state.provider = "microsoft_graph";
    state.reconcile = false;

    expect(await runSourceImportBatch(job(null), "worker-1")).toMatchObject({ ok: true, value: { complete: false } });
    expect(completions().at(-1)).toMatchObject({ p_outcome: "progress", p_cursor_token: nextLink });
    expect(imported().map(item => [item.nativeId, item.revision])).toEqual([
      ["SYNTHFOLDER01", "eSYNTHfolder1"], ["SYNTHITEM01", "eSYNTHitem01v1"], ["SYNTHITEM02", "eSYNTHitem02v1"]]);

    // SYNTHITEM02 was imported and bound; a viewer can read it.
    const deleted = await binding("SYNTHITEM02", "eSYNTHitem02v1");
    state.bindings.push(deleted);
    const read = () => authorizeConnectorCriticalRead({ workspaceKey: WS, documentIds: [deleted.document_id], viewerUserId: VIEWER });
    expect(await read()).toEqual({ ok: true, freshness: { mode: "not_applicable" } });

    state.calls.length = 0;
    importSourceObject.mockClear();
    expect(await runSourceImportBatch(job(nextLink), "worker-1")).toMatchObject({ ok: true, value: { complete: true } });
    expect(completions().at(-1)).toMatchObject({ p_outcome: "succeeded",
      p_cursor_token: "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=SYNTHdelta1" });
    // The move is a new revision of the same id; the delete is suspended by its stable id at once.
    expect(imported().map(item => [item.nativeId, item.revision])).toEqual([["SYNTHITEM01", "eSYNTHitem01v2"]]);
    expect(state.suspensions.map(row => row.source_id)).toEqual([deleted.source_id]);
    expect(names().indexOf("connector_source_suspensions")).toBeLessThan(names().indexOf("import"));
    expect(names()).not.toContain("reconcile_dropbox_source_page");

    // The refusal comes from the suspension row, not from a later reindex.
    expect(await read()).toEqual({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" });
  });

  it("with the viewer-link check on, a Graph or Dropbox binding fails closed: no fresh-ACL path exists for them", async () => {
    vi.stubEnv("TAVONEL_GOOGLE_VIEWER_LINK_ENABLED", "true");
    state.bindings.push(await binding("SYNTHITEM01", "eSYNTHitem01v1"));
    expect(await authorizeConnectorCriticalRead({ workspaceKey: WS, documentIds: [state.bindings[0]!.document_id], viewerUserId: VIEWER }))
      .toEqual({ ok: false, code: "CONNECTOR_ACL_FRESH_CHECK_UNAVAILABLE" });
    state.bindings[0]!.provider = "dropbox";
    expect(await authorizeConnectorCriticalRead({ workspaceKey: WS, documentIds: [state.bindings[0]!.document_id], viewerUserId: VIEWER }))
      .toEqual({ ok: false, code: "CONNECTOR_ACL_FRESH_CHECK_UNAVAILABLE" });
    expect(state.requests).toEqual([]);
  });

  it("a signed compile receipt binds the connector source version it compiled", async () => {
    const v1 = await connectorSourceIdentity({ workspaceKey: WS, connectionId: CONNECTION, provider: "microsoft_graph", nativeId: "SYNTHITEM01", revision: "eSYNTHitem01v1" });
    const v2 = await connectorSourceIdentity({ workspaceKey: WS, connectionId: CONNECTION, provider: "microsoft_graph", nativeId: "SYNTHITEM01", revision: "eSYNTHitem01v2" });
    // One logical source across the move; each revision is its own version and its own document.
    expect(v2.sourceId).toBe(v1.sourceId);
    expect(v2.sourceVersionId).not.toBe(v1.sourceVersionId);
    expect(v2.documentId).not.toBe(v1.documentId);

    const pair = generateKeyPairSync("ed25519");
    const spki = createPublicKey(pair.privateKey).export({ format: "der", type: "spki" });
    const env = {
      TAVONEL_EXPORT_SIGNING_KEY_ID: "qualification-2026",
      TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON: JSON.stringify({ schemaVersion: "tavonel.export_trust.v2", minimumSignatureVersion: 2,
        activeKeyId: "qualification-2026", keys: [{ keyId: "qualification-2026", keyVersion: 1, algorithm: "Ed25519", status: "active",
          notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", publicKeySpkiDerBase64: spki.toString("base64"),
          publicKeySpkiSha256: `sha256:${createHash("sha256").update(spki).digest("hex")}` }] }),
    };
    const signer = readCompileReceiptSigner(env)!;
    const trust = readExportTrustStoreEnv(env)!;
    const signed = signCompileReceipt(signer, {
      tenantId: WS, workspaceId: WS, collectionId: "col-1", manifestDigest: `sha256:${"1".repeat(64)}`, lifecycle: "candidate",
      coreRuntime: "core-v2", worldStateId: null, coreRequestId: "req-1", coreOutputSha256: `sha256:${"2".repeat(64)}`,
      customerDataGateReceiptSha256: `sha256:${"3".repeat(64)}`, sourceDocuments: [{ documentId: v1.documentId, versionKey: "4".repeat(64) }],
      sourceScope: "connector", authorizationEpoch: null, coreResponseSchema: "tavonel.product_core_response.v2",
      coreReleaseDigest: `sha256:${"5".repeat(64)}`, compiledAt: "2026-11-18T00:00:00.000Z",
    })!;
    expect(verifyCompileReceipt(signed.receipt, { tenantId: WS, workspaceId: WS }, trust))
      .toMatchObject({ ok: true, payload: { sourceScope: "connector", sourceDocuments: [{ documentId: v1.documentId }] } });
    // Presenting the receipt as evidence for the later revision breaks the signature.
    const swapped = { ...signed.receipt, payloadJson: signed.receipt.payloadJson.replace(v1.documentId, v2.documentId) };
    expect(verifyCompileReceipt(swapped, { tenantId: WS, workspaceId: WS }, trust)).toEqual({ ok: false, code: "COMPILE_RECEIPT_SIGNATURE_INVALID" });
  });
});

describe("the Dropbox reconciliation switch is apart from the upload-approval lineage (lead decision E-2)", () => {
  const ROOT = path.resolve(import.meta.dirname, "..");
  const sources = (dir: string): string[] => readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "__fixtures__" ? [] : sources(rel);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [rel] : [];
  });
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("is read by the Dropbox adapter and worker only, and they no longer read the approval switch", () => {
    const importers = [...sources("lib"), ...sources("app"), ...sources("components")]
      .filter(rel => /from "[^"]*dropbox-reconciliation-switch"/.test(read(rel)));
    expect(importers.sort()).toEqual(["lib/connector-oauth-adapters.ts", "lib/sync-worker.ts"]);
    for (const rel of importers) expect(read(rel)).not.toContain("INTAKE_APPROVAL_ROLLOUT_ENABLED");
    // The approval module is untouched by this switch and still ships off.
    const approval = read("lib/intake-approval-rollout.ts");
    expect(approval).toContain("const APPROVAL_LINEAGE_SWITCH = false;");
    expect(approval).not.toContain("dropbox-reconciliation-switch");
    // Reads every source file under lib, app and components: 5.3 s on a cold cache (r20 probe control).
  }, 30_000);

  it("ships off; with it off and the lineage off, Dropbox runs main's path", async () => {
    const actual = await vi.importActual<typeof import("./dropbox-reconciliation-switch")>("./dropbox-reconciliation-switch");
    expect(actual.DROPBOX_RECONCILIATION_SWITCH).toBe(false);
    expect(actual.dropboxReconciliationEnabled()).toBe(false);
    const approval = await vi.importActual<typeof import("./intake-approval-rollout")>("./intake-approval-rollout");
    expect(approval.INTAKE_APPROVAL_ROLLOUT_ENABLED).toBe(false);
  });

  it("the approval lineage on still implies reconciliation on (its migration set includes 20261007100000)", async () => {
    vi.resetModules();
    vi.doMock("./intake-approval-rollout", () => ({ INTAKE_APPROVAL_ROLLOUT_ENABLED: true }));
    const actual = await vi.importActual<typeof import("./dropbox-reconciliation-switch")>("./dropbox-reconciliation-switch");
    expect(actual.dropboxReconciliationEnabled()).toBe(true);
    vi.doUnmock("./intake-approval-rollout");
  });
});

import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readConnectorLatestBinding, recordConnectorDocumentBinding } from "../../lib/connector-binding-store";
import { readConnectorCompileIdentities } from "../../lib/connector-compile-identity";
import { requestConnectorSourceDeletion } from "../../lib/connector-source-access";
import { connectorSourceIdentity } from "../../lib/connector-source-identity";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "../../lib/supabase-admin";

/*
  Continuous connector source revisions through an actual PostgREST service and PostgreSQL.

  Started only by source-revision-journey.mjs against an owned disposable service: the bare local
  PostgREST 16 binary, or the hosted job's local Supabase stack (PostgREST behind its gateway at
  `/rest/v1`). Every read and write goes through the unchanged product functions and request
  helper; the only substitution is transport: the `https://…/rest/v1/…` URL is routed to the
  loopback base. Method, headers (the service key the real service verifies), body, status and
  response rows are not synthesized.
*/
const base = process.env.TAVONEL_LOCAL_POSTGREST_BASE;
const serviceKey = process.env.TAVONEL_LOCAL_SERVICE_ROLE_KEY ?? "";
const workspaceKey = process.env.TAVONEL_LOCAL_REVISION_WORKSPACE ?? "";
const connectionId = process.env.TAVONEL_LOCAL_REVISION_CONNECTION ?? "";
const out = process.env.TAVONEL_LOCAL_REVISION_OUT;
const gateway = "https://postgrest.journey.invalid";
const originalFetch = globalThis.fetch;
const provider = "google_drive" as const;
const nativeId = "journey-continuous-native";
const assertions: string[] = [];
const ids: Record<string, string> = {};
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

// Same order as an import: snapshot the latest binding, then record against that snapshot.
async function bind(revision: string, byte: string, snapshot?: string[], native = nativeId) {
  const identity = await connectorSourceIdentity({ workspaceKey, connectionId, provider, nativeId: native, revision });
  let expected = snapshot;
  if (expected === undefined) {
    const latest = await readConnectorLatestBinding({ workspaceKey, connectionId, provider, nativeId: native, revision });
    if (!latest.ok) throw new Error(latest.code);
    expected = latest.sourceVersionIds;
  }
  const result = await recordConnectorDocumentBinding({ workspaceKey, connectionId, provider, nativeId: native, revision,
    contentSha256: `sha256:${byte.repeat(64)}`, byteLength: 11, mimeType: "text/plain", expectedLatestSourceVersionIds: expected });
  return { identity, result };
}
async function versionsFor(revisionPrefix: string) {
  const response = await supabaseAdminRequest(readSupabaseAdminConfig()!, `/rest/v1/connector_document_bindings?workspace_key=eq.${workspaceKey}&source_id=eq.${ids.sourceId}&provider_revision=like.${revisionPrefix}*&select=provider_revision`);
  expect(response.status).toBe(200);
  return (await response.json() as Array<{ provider_revision: string }>).map(row => row.provider_revision);
}
function record(name: string, run: () => Promise<void>) {
  it(name, async () => { await run(); assertions.push(name); });
}

describe.skipIf(!base)("continuous connector revisions through actual PostgREST (transport routed locally)", () => {
  beforeAll(() => {
    if (!base || !/^http:\/\/127\.0\.0\.1:\d+(\/rest\/v1)?$/.test(base)) throw new Error("Only a loopback disposable PostgREST is accepted");
    if (serviceKey.length < 32) throw new Error("Missing the disposable service key");
    process.env.NEXT_PUBLIC_SUPABASE_URL = gateway;
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
    globalThis.fetch = async (input, init) => {
      if (typeof input !== "string" || !input.startsWith(`${gateway}/rest/v1/`)) throw new Error("Unexpected network destination in local PostgREST qualification");
      return originalFetch(`${base}/${input.slice(`${gateway}/rest/v1/`.length)}`, init);
    };
  });
  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (out) writeFileSync(out, JSON.stringify({ assertions, ids }), { mode: 0o600 });
  });

  record("first bound revision resolves to its logical source", async () => {
    const r1 = await bind("revision-1", "1");
    expect(r1.result).toEqual({ ok: true });
    Object.assign(ids, { sourceId: r1.identity.sourceId, r1Document: r1.identity.documentId, r1Version: r1.identity.sourceVersionId });
    const resolved = await readConnectorCompileIdentities(workspaceKey, [r1.identity.documentId]);
    expect(resolved.ok && resolved.identities.get(r1.identity.documentId)).toBe(r1.identity.sourceId);
  });

  record("a newer bound revision supersedes the older selection before compile", async () => {
    await settle();
    const r2 = await bind("revision-2", "2");
    expect(r2.result).toEqual({ ok: true });
    expect(r2.identity.sourceId).toBe(ids.sourceId);
    Object.assign(ids, { r2Document: r2.identity.documentId, r2Version: r2.identity.sourceVersionId });
    expect(await readConnectorCompileIdentities(workspaceKey, [ids.r1Document])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
  });

  record("the current revision resolves to the same logical source", async () => {
    const resolved = await readConnectorCompileIdentities(workspaceKey, [ids.r2Document]);
    expect(resolved.ok && resolved.identities.get(ids.r2Document)).toBe(ids.sourceId);
  });

  record("both revisions in one selection stay ambiguous", async () => {
    expect(await readConnectorCompileIdentities(workspaceKey, [ids.r1Document, ids.r2Document]))
      .toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_AMBIGUOUS" });
  });

  record("an identical rebind of an old revision does not make it latest again", async () => {
    // Provider re-listing revision-1 is an idempotent replay; recorded_at is the first observation.
    expect((await bind("revision-1", "1")).result).toEqual({ ok: true });
    expect(await readConnectorCompileIdentities(workspaceKey, [ids.r1Document])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
  });

  record("a revision bound while compile runs refuses the post-dispatch recheck", async () => {
    const before = await readConnectorCompileIdentities(workspaceKey, [ids.r2Document]);
    expect(before.ok).toBe(true);
    await settle();
    const r3 = await bind("revision-3", "3");
    expect(r3.result).toEqual({ ok: true });
    Object.assign(ids, { r3Document: r3.identity.documentId, r3Version: r3.identity.sourceVersionId });
    expect(await readConnectorCompileIdentities(workspaceKey, [ids.r2Document])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
  });

  record("supersession keeps every historical revision binding immutable and readable", async () => {
    const config = readSupabaseAdminConfig()!;
    const response = await supabaseAdminRequest(config, `/rest/v1/connector_document_bindings?workspace_key=eq.${workspaceKey}&source_id=eq.${ids.sourceId}&select=source_version_id,document_id,provider_revision&order=recorded_at.asc`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { source_version_id: ids.r1Version, document_id: ids.r1Document, provider_revision: "revision-1" },
      { source_version_id: ids.r2Version, document_id: ids.r2Document, provider_revision: "revision-2" },
      { source_version_id: ids.r3Version, document_id: ids.r3Document, provider_revision: "revision-3" },
    ]);
    const rewrite = await supabaseAdminRequest(config, `/rest/v1/connector_document_bindings?source_version_id=eq.${ids.r1Version}`, {
      method: "PATCH", body: JSON.stringify({ provider_revision: "revision-9" }) });
    expect(rewrite.ok).toBe(false);
  });

  record("a revision recorded against a stale latest snapshot is contested and writes nothing", async () => {
    // The import's snapshot predates revision-3; another revision was bound while it downloaded.
    const stale = await bind("stale-snapshot", "5", [ids.r2Version]);
    expect(stale.result).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_CONTESTED" });
    expect(await versionsFor("stale-snapshot")).toEqual([]);
    const current = await readConnectorCompileIdentities(workspaceKey, [ids.r3Document]);
    expect(current.ok && current.identities.get(ids.r3Document)).toBe(ids.sourceId);
  });

  record("concurrent actual requests against one latest snapshot admit exactly one revision", async () => {
    const racers = ["concurrent-a", "concurrent-b", "concurrent-c", "concurrent-d", "concurrent-e", "concurrent-f"];
    const results = await Promise.all(racers.map((revision, index) => bind(revision, "abcdef"[index], [ids.r3Version])));
    const winners = results.filter(entry => entry.result.ok);
    expect(winners).toHaveLength(1);
    expect(results.filter(entry => !entry.result.ok).map(entry => entry.result))
      .toEqual(Array(racers.length - 1).fill({ ok: false, code: "CONNECTOR_SOURCE_REVISION_CONTESTED" }));
    const stored = await versionsFor("concurrent-");
    expect(stored).toHaveLength(1);
    Object.assign(ids, { winnerDocument: winners[0].identity.documentId, winnerRevision: stored[0] });
    expect(winners[0].identity.documentId).toBe((await connectorSourceIdentity({ workspaceKey, connectionId, provider, nativeId, revision: stored[0] })).documentId);
    // The database-ordered winner is now latest; the previous latest is superseded.
    const resolved = await readConnectorCompileIdentities(workspaceKey, [ids.winnerDocument]);
    expect(resolved.ok && resolved.identities.get(ids.winnerDocument)).toBe(ids.sourceId);
    expect(await readConnectorCompileIdentities(workspaceKey, [ids.r3Document])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
  });

  // Fixtures written by owner-level SQL in source-revision-journey.mjs (LEGACY_FIXTURES there).
  const tieNative = "journey-legacy-tie-native", tiedNative = "journey-tied-current-native", subNative = "journey-submillisecond-native";
  const fixtureIdentity = (native: string, revision: string) => connectorSourceIdentity({ workspaceKey, connectionId, provider, nativeId: native, revision });
  // Fixture bytes: sha256:8…8, 11 bytes, text/plain (a replay must match them exactly).
  const FIXTURE_BYTE = "8";
  const rpc = (name: string, body: unknown) => supabaseAdminRequest(readSupabaseAdminConfig()!, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });

  record("the schema derives exactly the identities the application derives", async () => {
    for (const [native, revision] of [[nativeId, "revision-1"], ["문서/é \"quoted\" \\ back", "rev 7/ü"], ["id:AbC_-123", "015f2c3a"]]) {
      const expected = await fixtureIdentity(native, revision);
      const response = await rpc("connector_binding_identity", { p_workspace_key: workspaceKey, p_connection_id: connectionId, p_provider: provider, p_native_id: native, p_revision: revision });
      expect(response.status).toBe(200);
      const body = await response.json();
      const row = Array.isArray(body) ? body[0] : body;
      expect(row).toEqual({ source_id: expected.sourceId, source_version_id: expected.sourceVersionId, document_id: expected.documentId });
    }
  });

  record("a direct service-role table insert is refused; only the guarded writer records", async () => {
    const identity = await fixtureIdentity("journey-direct-native", "direct-bypass");
    const direct = await supabaseAdminRequest(readSupabaseAdminConfig()!, "/rest/v1/connector_document_bindings", { method: "POST", headers: { prefer: "return=minimal" },
      body: JSON.stringify({ source_version_id: identity.sourceVersionId, source_id: identity.sourceId, workspace_key: workspaceKey, oauth_connection_id: connectionId,
        provider, native_id: "journey-direct-native", provider_revision: "direct-bypass", document_id: identity.documentId,
        content_sha256: `sha256:${"9".repeat(64)}`, byte_length: 11, mime_type: "text/plain" }) });
    expect(direct.ok).toBe(false);
    expect(await direct.text()).toContain("CONNECTOR_BINDING_WRITE_PATH");
    const recorded = await bind("direct-bypass-guarded", "9", undefined, "journey-direct-native");
    expect(recorded.result).toEqual({ ok: true });
  });

  record("the guarded writer refuses a row whose identity does not derive from its fields", async () => {
    const own = await fixtureIdentity("journey-mismatch-native", "identity-mismatch"), other = await fixtureIdentity("journey-mismatch-native", "other-revision");
    const response = await rpc("record_connector_document_binding_after", { p_expected_latest_source_version_ids: [], p_binding: {
      source_version_id: other.sourceVersionId, source_id: own.sourceId, workspace_key: workspaceKey, oauth_connection_id: connectionId, provider,
      native_id: "journey-mismatch-native", provider_revision: "identity-mismatch", document_id: own.documentId,
      content_sha256: `sha256:${"9".repeat(64)}`, byte_length: 11, mime_type: "text/plain" } });
    expect(response.ok).toBe(false);
    expect(await response.text()).toContain("CONNECTOR_BINDING_IDENTITY_MISMATCH");
  });

  record("a legacy equal-instant tie is superseded as a whole by a current revision, never tie-broken", async () => {
    const tied = await Promise.all(["legacy-a", "legacy-b"].map(revision => fixtureIdentity(tieNative, revision)));
    Object.assign(ids, { legacySourceId: tied[0].sourceId });
    for (const identity of tied) {
      expect(await readConnectorCompileIdentities(workspaceKey, [identity.documentId])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_AMBIGUOUS" });
    }
    const snapshot = await readConnectorLatestBinding({ workspaceKey, connectionId, provider, nativeId: tieNative, revision: "legacy-current" });
    expect(snapshot).toEqual({ ok: true, sourceVersionIds: tied.map(identity => identity.sourceVersionId).sort() });
    // A snapshot naming only one tied row is not the newest set: contested, nothing written.
    expect((await bind("legacy-partial", "6", [tied[0].sourceVersionId], tieNative)).result).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_CONTESTED" });
    const current = await bind("legacy-current", "7", snapshot.ok ? snapshot.sourceVersionIds : [], tieNative);
    expect(current.result).toEqual({ ok: true });
    const resolved = await readConnectorCompileIdentities(workspaceKey, [current.identity.documentId]);
    expect(resolved.ok && resolved.identities.get(current.identity.documentId)).toBe(tied[0].sourceId);
    for (const identity of tied) {
      expect(await readConnectorCompileIdentities(workspaceKey, [identity.documentId])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
    }
    // Replaying a tied legacy revision after supersession never moves latest.
    expect((await bind("legacy-a", FIXTURE_BYTE, undefined, tieNative)).result).toEqual({ ok: true });
    expect(await readConnectorLatestBinding({ workspaceKey, connectionId, provider, nativeId: tieNative, revision: "legacy-a" }))
      .toEqual({ ok: true, sourceVersionIds: [current.identity.sourceVersionId] });
  });

  record("a tie whose provider-current revision is one of its rows is resolved to that row, never by id", async () => {
    const [a, b] = await Promise.all(["tied-a", "tied-b"].map(revision => fixtureIdentity(tiedNative, revision)));
    expect(await readConnectorCompileIdentities(workspaceKey, [a.documentId])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_AMBIGUOUS" });
    const snapshot = await readConnectorLatestBinding({ workspaceKey, connectionId, provider, nativeId: tiedNative, revision: "tied-a" });
    expect(snapshot).toEqual({ ok: true, sourceVersionIds: [a.sourceVersionId, b.sourceVersionId].sort() });
    // A stale snapshot (one member only) does not resolve anything.
    expect((await bind("tied-a", FIXTURE_BYTE, [a.sourceVersionId], tiedNative)).result).toEqual({ ok: true });
    expect(await readConnectorCompileIdentities(workspaceKey, [a.documentId])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_AMBIGUOUS" });
    // The provider names tied-a current and the snapshot is the whole tie: resolved.
    expect((await bind("tied-a", FIXTURE_BYTE, snapshot.ok ? snapshot.sourceVersionIds : [], tiedNative)).result).toEqual({ ok: true });
    const resolved = await readConnectorCompileIdentities(workspaceKey, [a.documentId]);
    expect(resolved.ok && resolved.identities.get(a.documentId)).toBe(a.sourceId);
    expect(await readConnectorCompileIdentities(workspaceKey, [b.documentId])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
    // The other member replays without moving latest; a newer revision then supersedes as usual.
    expect((await bind("tied-b", FIXTURE_BYTE, [a.sourceVersionId], tiedNative)).result).toEqual({ ok: true });
    expect(await readConnectorLatestBinding({ workspaceKey, connectionId, provider, nativeId: tiedNative, revision: "tied-b" })).toEqual({ ok: true, sourceVersionIds: [a.sourceVersionId] });
    const newer = await bind("tied-c", "c", undefined, tiedNative);
    expect(newer.result).toEqual({ ok: true });
    expect(await readConnectorCompileIdentities(workspaceKey, [a.documentId])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
  });

  record("revisions observed 1 microsecond apart inside one millisecond keep their database order", async () => {
    const [older, newer] = await Promise.all(["sub-a", "sub-b"].map(revision => fixtureIdentity(subNative, revision)));
    const rows = await supabaseAdminRequest(readSupabaseAdminConfig()!, `/rest/v1/connector_document_bindings?workspace_key=eq.${workspaceKey}&source_id=eq.${older.sourceId}&select=recorded_at`);
    const instants = (await rows.json() as Array<{ recorded_at: string }>).map(row => row.recorded_at);
    expect(instants).toHaveLength(2);
    // JavaScript milliseconds cannot tell these apart; the database can.
    expect(new Set(instants.map(at => Date.parse(at))).size).toBe(1);
    const latest = await readConnectorCompileIdentities(workspaceKey, [newer.documentId]);
    expect(latest.ok && latest.identities.get(newer.documentId)).toBe(newer.sourceId);
    expect(await readConnectorCompileIdentities(workspaceKey, [older.documentId])).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_SUPERSEDED" });
    expect(await readConnectorLatestBinding({ workspaceKey, connectionId, provider, nativeId: subNative, revision: "sub-c" })).toEqual({ ok: true, sourceVersionIds: [newer.sourceVersionId] });
  });

  record("provider deletion tombstones the logical source and refuses a new revision", async () => {
    const deleted = await requestConnectorSourceDeletion({ workspaceKey, connectionId, provider, nativeId, reason: "provider_deleted" });
    expect(deleted).toMatchObject({ ok: true, held: false });
    expect((await bind("revision-4", "4")).result).toEqual({ ok: false, code: "SOURCE_TOMBSTONED" });
    const replay = await requestConnectorSourceDeletion({ workspaceKey, connectionId, provider, nativeId, reason: "provider_deleted" });
    expect(replay).toMatchObject({ ok: true, replayed: true, receiptId: deleted.ok ? deleted.receiptId : "" });
  });
});

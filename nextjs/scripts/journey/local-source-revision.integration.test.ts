import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordConnectorDocumentBinding } from "../../lib/connector-binding-store";
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

async function bind(revision: string, byte: string) {
  const identity = await connectorSourceIdentity({ workspaceKey, connectionId, provider, nativeId, revision });
  const result = await recordConnectorDocumentBinding({ workspaceKey, connectionId, provider, nativeId, revision,
    contentSha256: `sha256:${byte.repeat(64)}`, byteLength: 11, mimeType: "text/plain" });
  return { identity, result };
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

  record("provider deletion tombstones the logical source and refuses a new revision", async () => {
    const deleted = await requestConnectorSourceDeletion({ workspaceKey, connectionId, provider, nativeId, reason: "provider_deleted" });
    expect(deleted).toMatchObject({ ok: true, held: false });
    expect((await bind("revision-4", "4")).result).toEqual({ ok: false, code: "SOURCE_TOMBSTONED" });
    const replay = await requestConnectorSourceDeletion({ workspaceKey, connectionId, provider, nativeId, reason: "provider_deleted" });
    expect(replay).toMatchObject({ ok: true, replayed: true, receiptId: deleted.ok ? deleted.receiptId : "" });
  });
});

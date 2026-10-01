import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readConnectorLatestBinding, recordConnectorDocumentBinding } from "./connector-binding-store";
import { connectorSourceIdentity } from "./connector-source-identity";
const source = { workspaceKey: "pilot-acme01", connectionId: "22222222-2222-4222-8222-222222222222",
  provider: "google_drive" as const, nativeId: "native", revision: "v1" };
const latest = `sv-${"b".repeat(64)}`;
const input = { ...source, contentSha256: `sha256:${"a".repeat(64)}`, byteLength: 3, mimeType: "application/pdf", expectedLatestSourceVersionId: latest };
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://binding-test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"x".repeat(40)}`);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function row() {
  const i = await connectorSourceIdentity(input);
  return { source_version_id: i.sourceVersionId, source_id: i.sourceId, workspace_key: input.workspaceKey,
    oauth_connection_id: input.connectionId, provider: input.provider, native_id: input.nativeId,
    provider_revision: input.revision, document_id: i.documentId, content_sha256: input.contentSha256,
    byte_length: input.byteLength, mime_type: input.mimeType, recorded_at: "2026-09-09T00:00:00Z" };
}
it.each(["recorded", "replay"])("records through the compare-and-set RPC and verifies the durable winner (%s)", async outcome => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json(outcome)).mockResolvedValueOnce(Response.json([await row()]));
  vi.stubGlobal("fetch", fetcher);
  expect(await recordConnectorDocumentBinding(input)).toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(String(fetcher.mock.calls[1][0])).toContain("/rest/v1/rpc/record_connector_document_binding_current");
  const body = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(body.p_expected_latest_source_version_id).toBe(latest);
  // The database assigns the observation instant; the caller never supplies one.
  expect(body.p_binding).not.toHaveProperty("recorded_at");
});
it("writes nothing more and names the refusal when another revision became latest", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json("contested"));
  vi.stubGlobal("fetch", fetcher);
  expect(await recordConnectorDocumentBinding(input)).toEqual({ ok: false, code: "CONNECTOR_SOURCE_REVISION_CONTESTED" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("fails closed on an unknown RPC outcome", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json("maybe")));
  expect(await recordConnectorDocumentBinding(input)).toEqual({ ok: false, code: "CONNECTOR_BINDING_WRITE_FAILED" });
});
it.each(["content_sha256", "workspace_key", "document_id", "provider_revision"])("refuses conflicting %s", async field => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json("replay")).mockResolvedValueOnce(Response.json([{ ...await row(), [field]: "different" }])));
  expect(await recordConnectorDocumentBinding(input)).toEqual({ ok: false, code: "CONNECTOR_BINDING_CONFLICT" });
});
it("fails when the migration or write is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(new Response(null, { status: 404 })));
  expect(await recordConnectorDocumentBinding(input)).toEqual({ ok: false, code: "CONNECTOR_BINDING_WRITE_FAILED" });
});
it("does not write a binding when the logical source was tombstoned", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(false));
  vi.stubGlobal("fetch", fetcher);
  expect(await recordConnectorDocumentBinding(input)).toEqual({ ok: false, code: "SOURCE_TOMBSTONED" });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0][0])).toContain("connector_source_import_allowed");
});
it("fails closed when the tombstone guard cannot answer", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await recordConnectorDocumentBinding(input)).toEqual({ ok: false, code: "CONNECTOR_BINDING_GUARD_UNAVAILABLE" });
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each([{ byteLength: 0 }, { expectedLatestSourceVersionId: "sv-not-a-version" }])("refuses malformed observations before contacting the database %j", async change => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await recordConnectorDocumentBinding({ ...input, ...change })).toEqual({ ok: false, code: "CONNECTOR_BINDING_INVALID" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("reads the database-ordered latest binding of the logical source", async () => {
  const { sourceId } = await connectorSourceIdentity(source);
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ source_version_id: latest, workspace_key: source.workspaceKey, source_id: sourceId }]));
  vi.stubGlobal("fetch", fetcher);
  expect(await readConnectorLatestBinding(source)).toEqual({ ok: true, sourceVersionId: latest });
  const url = String(fetcher.mock.calls[0][0]);
  expect(url).toContain(`source_id=eq.${sourceId}`);
  expect(url).toContain("order=recorded_at.desc");
});
it("reports no latest binding for a never-bound source", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([])));
  expect(await readConnectorLatestBinding(source)).toEqual({ ok: true, sourceVersionId: null });
});
it.each([
  ["an unavailable read", new Response(null, { status: 503 })],
  ["a foreign workspace row", Response.json([{ source_version_id: latest, workspace_key: "pilot-other01", source_id: "src-x" }])],
  ["a malformed version id", Response.json([{ source_version_id: "sv-x", workspace_key: source.workspaceKey, source_id: "src-x" }])],
  ["an object body", Response.json({})],
])("fails closed on %s", async (_label, response) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));
  expect(await readConnectorLatestBinding(source)).toEqual({ ok: false, code: "CONNECTOR_BINDING_READ_FAILED" });
});

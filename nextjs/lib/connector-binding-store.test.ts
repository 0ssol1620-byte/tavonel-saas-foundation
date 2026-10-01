import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readConnectorLatestBinding, recordConnectorDocumentBinding } from "./connector-binding-store";
import { connectorSourceIdentity } from "./connector-source-identity";
const source = { workspaceKey: "pilot-acme01", connectionId: "22222222-2222-4222-8222-222222222222",
  provider: "google_drive" as const, nativeId: "native", revision: "v1" };
const latest = `sv-${"b".repeat(64)}`;
const input = { ...source, contentSha256: `sha256:${"a".repeat(64)}`, byteLength: 3, mimeType: "application/pdf", expectedLatestSourceVersionIds: [latest] };
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
  expect(String(fetcher.mock.calls[1][0])).toContain("/rest/v1/rpc/record_connector_document_binding_after");
  const body = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(body.p_expected_latest_source_version_ids).toEqual([latest]);
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
it.each([{ byteLength: 0 }, { expectedLatestSourceVersionIds: ["sv-not-a-version"] }, { expectedLatestSourceVersionIds: [latest, latest] },
  { expectedLatestSourceVersionIds: Array.from({ length: 17 }, (_, i) => `sv-${i.toString(16).padStart(64, "0")}`) },
  { expectedLatestSourceVersionIds: null as unknown as string[] }])("refuses malformed observations before contacting the database %j", async change => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await recordConnectorDocumentBinding({ ...input, ...change })).toEqual({ ok: false, code: "CONNECTOR_BINDING_INVALID" });
  expect(fetcher).not.toHaveBeenCalled();
});

const v = (n: number) => `sv-${n.toString(16).padStart(64, "0")}`;
it("reads the effective newest set of the logical source from the database", async () => {
  const { sourceId } = await connectorSourceIdentity(source);
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json([latest]));
  vi.stubGlobal("fetch", fetcher);
  expect(await readConnectorLatestBinding(source)).toEqual({ ok: true, sourceVersionIds: [latest] });
  expect(String(fetcher.mock.calls[0][0])).toContain("/rest/v1/rpc/connector_source_newest_versions");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ p_workspace_key: source.workspaceKey, p_source_id: sourceId });
});
it("reports a whole unresolved tie, sorted, and an unbound source as empty", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([v(9), v(3)])).mockResolvedValueOnce(Response.json([])));
  expect(await readConnectorLatestBinding(source)).toEqual({ ok: true, sourceVersionIds: [v(3), v(9)] });
  expect(await readConnectorLatestBinding(source)).toEqual({ ok: true, sourceVersionIds: [] });
});
it.each([
  ["an unavailable read", () => new Response(null, { status: 503 })],
  ["a malformed version id", () => Response.json(["sv-x"])],
  ["a duplicated version", () => Response.json([latest, latest])],
  ["a tie wider than the writer accepts", () => Response.json(Array.from({ length: 17 }, (_, i) => v(i)))],
  ["an object body", () => Response.json({})],
])("fails closed on %s", async (_label, response) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response()));
  expect(await readConnectorLatestBinding(source)).toEqual({ ok: false, code: "CONNECTOR_BINDING_READ_FAILED" });
});
it("accepts a tie resolution as a verified write of the already-bound revision", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json("resolved")).mockResolvedValueOnce(Response.json([await row()]));
  vi.stubGlobal("fetch", fetcher);
  expect(await recordConnectorDocumentBinding({ ...input, expectedLatestSourceVersionIds: [v(3), v(9)] })).toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("sends the snapshot set sorted, so the server compares sets rather than order", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json("recorded")).mockResolvedValueOnce(Response.json([await row()]));
  vi.stubGlobal("fetch", fetcher);
  expect(await recordConnectorDocumentBinding({ ...input, expectedLatestSourceVersionIds: [v(9), v(3)] })).toEqual({ ok: true });
  expect(JSON.parse(fetcher.mock.calls[1][1].body).p_expected_latest_source_version_ids).toEqual([v(3), v(9)]);
});

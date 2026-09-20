import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordConnectorDocumentBinding } from "./connector-binding-store";
import { connectorSourceIdentity } from "./connector-source-identity";
const input = { workspaceKey: "pilot-acme01", connectionId: "22222222-2222-4222-8222-222222222222",
  provider: "google_drive" as const, nativeId: "native", revision: "v1",
  contentSha256: `sha256:${"a".repeat(64)}`, byteLength: 3, mimeType: "application/pdf" };
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
it.each([{ inserted: [] }, { inserted: [{ inserted: true }] }])("verifies the durable winner after insert or replay %j", async ({ inserted }) => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json(inserted)).mockResolvedValueOnce(Response.json([await row()]));
  vi.stubGlobal("fetch", fetcher);
  expect(await recordConnectorDocumentBinding(input)).toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(3);
  const body = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(body[0]).not.toHaveProperty("recorded_at");
});
it.each(["content_sha256", "workspace_key", "document_id", "provider_revision"])("refuses conflicting %s", async field => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json([{ ...await row(), [field]: "different" }])));
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
it("refuses malformed observations before contacting the database", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await recordConnectorDocumentBinding({ ...input, byteLength: 0 })).toEqual({ ok: false, code: "CONNECTOR_BINDING_INVALID" });
  expect(fetcher).not.toHaveBeenCalled();
});

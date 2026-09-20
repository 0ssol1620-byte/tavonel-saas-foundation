import { beforeEach, describe, expect, it, vi } from "vitest";

const { request, config, identity } = vi.hoisted(() => ({
  request: vi.fn(), config: vi.fn(), identity: vi.fn(),
}));
vi.mock("./supabase-admin", () => ({ supabaseAdminRequest: request, readSupabaseAdminConfig: config }));
vi.mock("./connector-source-identity", () => ({ connectorSourceIdentity: identity }));
import { requestConnectorSourceDeletion } from "./connector-source-access";

const receiptId = `sha256:${"a".repeat(64)}`;
const input = {
  workspaceKey: "pilot-acme01", connectionId: "11111111-1111-4111-8111-111111111111",
  provider: "google_drive" as const, nativeId: "file-1", reason: "provider_deleted" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  config.mockReturnValue({});
  identity.mockResolvedValue({ sourceId: `src-${"b".repeat(64)}` });
});

describe("connector source deletion request", () => {
  it("treats a legal-hold tombstone as durable success while exposing held state", async () => {
    request.mockResolvedValue(Response.json({ receiptId, status: "held" }));
    await expect(requestConnectorSourceDeletion(input)).resolves.toEqual({
      ok: true, receiptId, replayed: false, held: true,
    });
  });

  it("retries when policy state cannot be proven", async () => {
    request.mockResolvedValue(Response.json({ message: "SOURCE_LEGAL_HOLD_STATE_UNKNOWN" }, { status: 409 }));
    await expect(requestConnectorSourceDeletion(input)).resolves.toEqual({
      ok: false, code: "SOURCE_LEGAL_HOLD_STATE_UNKNOWN",
    });
  });
});

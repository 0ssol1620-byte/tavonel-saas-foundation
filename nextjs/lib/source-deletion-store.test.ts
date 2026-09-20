import { beforeEach, describe, expect, it, vi } from "vitest";

const { request, config } = vi.hoisted(() => ({ request: vi.fn(), config: vi.fn() }));
vi.mock("./supabase-admin", () => ({ supabaseAdminRequest: request, readSupabaseAdminConfig: config }));
import { createSourceDeletionSweepStore } from "./source-deletion-store";
import type { DeletionCandidate } from "./source-deletion-sweeper";

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const row = {
  deletionId: sha("a"), workspaceKey: "pilot-acme01", sourceId: `src-${"b".repeat(64)}`,
  objectKey: "quarantine/pilot-acme01/doc/source", objectSha256: sha("c"),
  legalHoldState: "inactive", claimId: "11111111-1111-4111-8111-111111111111",
  claimExpiresAt: "2099-01-01T00:00:00.000Z",
} satisfies DeletionCandidate;

beforeEach(() => {
  vi.resetAllMocks();
  config.mockReturnValue({});
});

describe("source deletion store", () => {
  it("reports an eligible deletion blocked on incomplete artifact inventory", async () => {
    request.mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ inventoryIncomplete: true }));
    await expect(createSourceDeletionSweepStore().claim(1)).resolves.toEqual({
      ok: false, code: "SOURCE_DELETION_INVENTORY_INCOMPLETE",
    });
    expect(request.mock.calls[1]![1]).toBe("/rest/v1/rpc/source_deletion_sweep_status");
  });

  it("distinguishes an idle queue from a blocked inventory", async () => {
    request.mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ inventoryIncomplete: false }));
    await expect(createSourceDeletionSweepStore().claim(1)).resolves.toEqual({ ok: true, candidates: [] });
  });

  it("validates and returns the durable claim token and expiry", async () => {
    request.mockResolvedValue(Response.json([row]));
    await expect(createSourceDeletionSweepStore().claim(1)).resolves.toEqual({ ok: true, candidates: [row] });
  });

  it("binds finalize to the claim token", async () => {
    request.mockResolvedValue(Response.json({ receiptId: sha("d"), status: "recorded" }));
    await expect(createSourceDeletionSweepStore().finalize({ ...row, objectAlreadyAbsent: false }))
      .resolves.toMatchObject({ ok: true });
    expect(JSON.parse(request.mock.calls[0]![2].body)).toMatchObject({
      p_claim_id: row.claimId,
      p_deletion_id: row.deletionId,
      p_object_key: row.objectKey,
    });
  });

  it("durably begins external deletion with the same claim token", async () => {
    request.mockResolvedValue(new Response(null, { status: 200 }));
    await expect(createSourceDeletionSweepStore().beginDelete(row)).resolves.toEqual({ ok: true });
    expect(request.mock.calls[0]![1]).toBe("/rest/v1/rpc/begin_source_deletion_object");
    expect(JSON.parse(request.mock.calls[0]![2].body)).toMatchObject({
      p_claim_id: row.claimId, p_object_sha256: row.objectSha256,
    });
  });
});

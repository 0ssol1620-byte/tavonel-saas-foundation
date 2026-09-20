import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getFoundationActiveWorld,
  listFoundationWorldVersions,
  promoteFoundationCandidate,
  rollbackFoundationWorld,
  validatePromoteWorldMutation,
} from "./world-store";

const workspaceKey = "pilot-worldtest0000";
const collectionId = "collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const manifestDigest = `sha256:${"b".repeat(64)}`;
const outputSha = `sha256:${"d".repeat(64)}`;
const actorUserId = "44444444-4444-4444-4444-444444444444";
const operationId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const candidateObjectKey = `immutable/${workspaceKey}/${workspaceKey}/collections/${collectionId}/${"b".repeat(64)}/candidate-world.json`;

function receipt(action: "activate" | "rollback", target: string, revision: number) {
  return {
    status: "applied",
    action,
    manifestDigest: target,
    revision,
    operationId,
    eventId,
    requestSha256: `sha256:${"e".repeat(64)}`,
    receiptSha256: `sha256:${"f".repeat(64)}`,
  };
}

function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://world-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"x".repeat(40)}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("Foundation world lifecycle store", () => {
  it("requires the immutable candidate key to bind workspace, collection and manifest", () => {
    const mutation = {
      operationId,
      workspaceKey,
      collectionId,
      manifestDigest,
      candidateObjectKey,
      worldStateId: "ws_candidate_b",
      coreOutputSha256: outputSha,
      actorUserId,
      expectedCurrentManifest: null,
      expectedCurrentRevision: 0,
      reason: "Human review passed",
    };
    expect(validatePromoteWorldMutation(mutation)).toBe(true);
    expect(
      validatePromoteWorldMutation({
        ...mutation,
        candidateObjectKey: candidateObjectKey.replace(
          workspaceKey,
          "pilot-other"
        ),
      })
    ).toBe(false);
  });

  it("sends promotion through the service-only RPC without exposing the service key", async () => {
    configure();
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("apikey")).toMatch(/^sb_secret_/);
        expect(headers.has("authorization")).toBe(false);
        expect(JSON.parse(String(init?.body))).toEqual(
          expect.objectContaining({
            p_operation_id: operationId,
            p_action: "activate",
            p_workspace_key: workspaceKey,
            p_target_manifest_digest: manifestDigest,
            p_expected_current_state: "empty",
            p_expected_current_revision: 0,
            p_actor_user_id: actorUserId,
          })
        );
        return Response.json(receipt("activate", manifestDigest, 1));
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      promoteFoundationCandidate({
        operationId,
        workspaceKey,
        collectionId,
        manifestDigest,
        candidateObjectKey,
        worldStateId: "ws_candidate_b",
        coreOutputSha256: outputSha,
        actorUserId,
        expectedCurrentManifest: null,
        expectedCurrentRevision: 0,
        reason: "Human review passed",
      })
    ).resolves.toEqual({
      ok: true,
      result: receipt("activate", manifestDigest, 1),
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/rest/v1/rpc/transition_foundation_world_atomic"
    );
  });

  it("maps stale CAS promotion and rollback failures to stable product errors", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { message: "world_transition_compare_and_swap_conflict" },
          { status: 400 }
        )
      )
    );
    await expect(
      rollbackFoundationWorld({
        operationId,
        workspaceKey,
        collectionId,
        targetManifestDigest: `sha256:${"a".repeat(64)}`,
        actorUserId,
        expectedCurrentManifest: manifestDigest,
        expectedCurrentRevision: 3,
        reason: "Human rollback review passed",
      })
    ).resolves.toEqual({ ok: false, code: "ACTIVE_WORLD_CONFLICT" });
  });

  it.each([
    ["world_transition_idempotency_conflict", "WORLD_TRANSITION_IDEMPOTENCY_CONFLICT"],
    ["world_transition_forbidden", "WORLD_TRANSITION_FORBIDDEN"],
    ["world_transition_authorization_changed", "AUTHORIZATION_CHANGED_RETRY"],
    ["world_rollback_target_missing", "ROLLBACK_TARGET_NOT_FOUND"],
    ["world_rollback_target_state_conflict", "ROLLBACK_TARGET_CONFLICT"],
  ])("maps %s to the stable product error %s", async (databaseError, productError) => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: databaseError }, { status: 400 }))
    );
    await expect(
      rollbackFoundationWorld({
        operationId,
        workspaceKey,
        collectionId,
        targetManifestDigest: `sha256:${"a".repeat(64)}`,
        actorUserId,
        expectedCurrentManifest: manifestDigest,
        expectedCurrentRevision: 3,
        reason: "Human rollback review passed",
      })
    ).resolves.toEqual({ ok: false, code: productError });
  });

  it("rejects a successful response whose receipt is not bound to the operation", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({
        ...receipt("activate", manifestDigest, 1),
        operationId: "99999999-9999-4999-8999-999999999999",
      }))
    );
    await expect(
      promoteFoundationCandidate({
        operationId,
        workspaceKey,
        collectionId,
        manifestDigest,
        candidateObjectKey,
        worldStateId: "ws_candidate_b",
        coreOutputSha256: outputSha,
        actorUserId,
        expectedCurrentManifest: null,
        expectedCurrentRevision: 0,
        reason: "Human review passed",
      })
    ).resolves.toEqual({ ok: false, code: "WORLD_STORE_WRITE_FAILED" });
  });

  it("loads an active pointer only when its version row is still active and digest-bound", async () => {
    configure();
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? Response.json([
              {
                workspace_key: workspaceKey,
                collection_id: collectionId,
                manifest_digest: manifestDigest,
                revision: 3,
                updated_at: "2026-08-29T12:00:00Z",
              },
            ])
          : Response.json([
              {
                candidate_object_key: candidateObjectKey,
                world_state_id: "ws_candidate_b",
                core_output_sha256: outputSha,
                lifecycle_status: "active",
              },
            ]);
      })
    );

    const loaded = await getFoundationActiveWorld(workspaceKey, collectionId);
    expect(loaded).toEqual({
      ok: true,
      world: expect.objectContaining({
        manifestDigest,
        revision: 3,
        candidateObjectKey,
      }),
    });
  });

  it("rejects an active pointer whose immutable candidate key is not digest-bound", async () => {
    configure();
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? Response.json([
              {
                workspace_key: workspaceKey,
                collection_id: collectionId,
                manifest_digest: manifestDigest,
                revision: 1,
                updated_at: "2026-08-29T12:00:00Z",
              },
            ])
          : Response.json([
              {
                candidate_object_key: candidateObjectKey.replace(
                  "b".repeat(64),
                  "a".repeat(64)
                ),
                world_state_id: "ws_candidate_b",
                core_output_sha256: outputSha,
                lifecycle_status: "active",
              },
            ]);
      })
    );

    await expect(
      getFoundationActiveWorld(workspaceKey, collectionId)
    ).resolves.toEqual({
      ok: false,
      code: "ACTIVE_WORLD_BINDING_INVALID",
    });
  });

  it("rejects malformed retained version metadata from the database", async () => {
    configure();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            manifest_digest: manifestDigest,
            world_state_id: "ws_candidate_b",
            lifecycle_status: "active",
            first_promoted_at: "not-a-timestamp",
            last_activated_at: "2026-08-29T12:00:00Z",
            activation_count: 1,
          },
        ])
      )
    );

    await expect(
      listFoundationWorldVersions(workspaceKey, collectionId)
    ).resolves.toEqual({
      ok: false,
      code: "WORLD_VERSION_BINDING_INVALID",
    });
  });
});

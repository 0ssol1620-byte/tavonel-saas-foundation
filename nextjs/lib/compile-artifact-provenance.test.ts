import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.fn();
const request = vi.fn();
vi.mock("./supabase-admin", () => ({
  readSupabaseAdminConfig: () => config(),
  supabaseAdminRequest: (...args: unknown[]) => request(...args),
}));

const { PUBLISH_MARGIN_MS, mayPublish, registerCollectionArtifact } = await import("./compile-artifact-provenance");

const INPUT = {
  workspaceKey: "pilot-c9c9c9c9c9c94c9c",
  collectionId: `collection-${"c".repeat(32)}`,
  manifestDigest: `sha256:${"1".repeat(64)}`,
  documentIds: ["0c900000-0000-4000-8000-00000000000a"],
};

beforeEach(() => {
  config.mockReset().mockReturnValue({ url: "https://db.example", serviceRoleKey: "k".repeat(40) });
  request.mockReset();
});

describe("registerCollectionArtifact", () => {
  it("sends the exact mapping and counts the lease from before the request", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ objectKey: "x", leaseSeconds: 120 }), { status: 200 }));
    const result = await registerCollectionArtifact(INPUT, () => 1_000);
    expect(result).toEqual({ ok: true, publishBy: 1_000 + 120_000 - PUBLISH_MARGIN_MS });
    const [, path, init] = request.mock.calls[0]!;
    expect(path).toBe("/rest/v1/rpc/register_collection_artifact_provenance");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      p_workspace_key: INPUT.workspaceKey,
      p_collection_id: INPUT.collectionId,
      p_manifest_digest: INPUT.manifestDigest,
      p_document_ids: INPUT.documentIds,
    });
  });

  it("passes the database's refusal through as a refusal", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ code: "P0001", message: "COLLECTION_ARTIFACT_SOURCE_DELETED" }),
      { status: 400 }));
    expect(await registerCollectionArtifact(INPUT)).toEqual({
      ok: false, code: "COLLECTION_ARTIFACT_SOURCE_DELETED", refused: true,
    });
  });

  it("treats any other failure as unavailable, never as registered", async () => {
    request.mockResolvedValue(new Response("oops", { status: 500 }));
    expect(await registerCollectionArtifact(INPUT)).toMatchObject({ ok: false, refused: false });
    request.mockRejectedValue(new Error("timeout"));
    expect(await registerCollectionArtifact(INPUT)).toMatchObject({ ok: false, refused: false });
    request.mockResolvedValue(new Response(JSON.stringify({ leaseSeconds: "soon" }), { status: 200 }));
    expect(await registerCollectionArtifact(INPUT)).toMatchObject({ ok: false, refused: false });
  });

  it("refuses ids a deletion could never name without calling the database", async () => {
    for (const documentIds of [[], ["doc-legacy-ocr"], ["0C900000-0000-4000-8000-00000000000A"]]) {
      expect(await registerCollectionArtifact({ ...INPUT, documentIds })).toMatchObject({ ok: false, refused: true });
    }
    expect(await registerCollectionArtifact({ ...INPUT, workspaceKey: "pilot" })).toMatchObject({ ok: false });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("mayPublish", () => {
  it("allows a PUT only before the deadline", () => {
    expect(mayPublish({ publishBy: 10 }, () => 9)).toBe(true);
    expect(mayPublish({ publishBy: 10 }, () => 10)).toBe(false);
  });
});

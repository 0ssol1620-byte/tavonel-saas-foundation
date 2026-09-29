import { describe, expect, it, vi } from "vitest";
import { runSourceDeletionInventoryAttestation } from "./source-deletion-inventory";
import {
  hashFoundationSourceInventoryObject,
  listFoundationSourceInventory,
} from "./source-deletion-inventory-r2";

const signer = {
  accountId: "account",
  bucket: "tavonel-saas-foundation-quarantine",
  accessKeyId: "access",
  secretAccessKey: "secret",
};

const deletionId = `sha256:${"a".repeat(64)}`;
const sourceId = `src-${"b".repeat(64)}`;
const documentId = "11111111-1111-4111-8111-111111111111";
const workspaceKey = "pilot-acme01";
const worldKey = (digestSeed: string, workspace = workspaceKey) =>
  `immutable/${workspace}/${workspace}/collections/collection-${"e".repeat(32)}/${digestSeed.repeat(64 / digestSeed.length)}/candidate-world.json`;

describe("source deletion inventory attestation", () => {
  it("stays idle when no eligible source needs an inventory", async () => {
    const readCandidate = vi.fn(async () => ({ ok: true as const, candidate: null }));
    await expect(runSourceDeletionInventoryAttestation({ signer, readCandidate }))
      .resolves.toEqual({ ok: true, code: "IDLE", processed: 0 });
  });

  it("hashes a stable complete listing before recording one attestation", async () => {
    const objects = [{
      key: `quarantine/${workspaceKey}/${documentId}/source`,
      sizeBytes: 5,
    }];
    const list = vi.fn(async () => ({ ok: true as const, objects }));
    const hash = vi.fn(async (_signer: typeof signer, _workspace: string, object: typeof objects[number]) => ({
      ok: true as const,
      object: { ...object, sha256: `sha256:${"c".repeat(64)}` },
    }));
    const readCandidate = vi.fn(async () => ({
      ok: true as const,
      candidate: { deletionId, workspaceKey, sourceId, documentIds: [documentId], worldObjectKeys: [] },
    }));
    const attest = vi.fn(async () => ({
      ok: true as const,
      attestation: {
        status: "recorded" as const,
        manifestSha256: `sha256:${"d".repeat(64)}`,
        artifactCount: 1,
      },
    }));

    await expect(runSourceDeletionInventoryAttestation({
      signer, list, hash, readCandidate, attest,
    })).resolves.toEqual({
      ok: true, code: "ATTESTED", processed: 1, artifactCount: 1, status: "recorded",
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(hash).toHaveBeenCalledOnce();
    expect(attest).toHaveBeenCalledWith(
      deletionId,
      [{ ...objects[0], sha256: `sha256:${"c".repeat(64)}` }],
      [],
    );
  });

  it("inventories the exact World keys twice and hands the full set to the attestation", async () => {
    const present = worldKey("1");
    const absent = worldKey("2");
    const objects = [
      { key: present, sizeBytes: 7 },
      { key: `quarantine/${workspaceKey}/${documentId}/source`, sizeBytes: 5 },
    ];
    const list = vi.fn(async () => ({ ok: true as const, objects }));
    const hash = vi.fn(async (_s: unknown, _w: string, object: { key: string; sizeBytes: number }) => ({
      ok: true as const, object: { ...object, sha256: `sha256:${"c".repeat(64)}` },
    }));
    const readCandidate = vi.fn(async () => ({
      ok: true as const,
      candidate: { deletionId, workspaceKey, sourceId, documentIds: [documentId], worldObjectKeys: [present, absent] },
    }));
    const attest = vi.fn(async () => ({ ok: true as const,
      attestation: { status: "recorded" as const, manifestSha256: `sha256:${"d".repeat(64)}`, artifactCount: 2 } }));

    await expect(runSourceDeletionInventoryAttestation({ signer, list, hash, readCandidate, attest }))
      .resolves.toMatchObject({ ok: true, code: "ATTESTED", artifactCount: 2 });
    expect(list.mock.calls).toEqual([
      [signer, workspaceKey, [documentId], [present, absent]],
      [signer, workspaceKey, [documentId], [present, absent]],
    ]);
    // The absent key is still named: the database records it as absent, never as purged.
    expect(attest).toHaveBeenCalledWith(deletionId, expect.any(Array), [present, absent]);
  });

  it("refuses an oversized World set and records it against the tombstone", async () => {
    const worldObjectKeys = Array.from({ length: 65 }, (_, i) => worldKey(i.toString(16).padStart(2, "0")));
    const readCandidate = vi.fn(async () => ({
      ok: true as const,
      candidate: { deletionId, workspaceKey, sourceId, documentIds: [documentId], worldObjectKeys },
    }));
    const list = vi.fn();
    const attest = vi.fn();
    const recordFailure = vi.fn(async () => ({ ok: true as const }));

    await expect(runSourceDeletionInventoryAttestation({ signer, list, readCandidate, attest, recordFailure }))
      .resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_WORLD_LIMIT", processed: 0, deletionId, failureRecorded: true });
    expect(list).not.toHaveBeenCalled();
    expect(attest).not.toHaveBeenCalled();
  });

  it("refuses to attest an empty listing while the source still has bound documents", async () => {
    // An R2 listing that fails open returns []. Attesting it would record artifact_count 0 as a
    // complete inventory, enqueue nothing, and make every later attestation of the real objects
    // a permanent ATTESTATION_CONFLICT. The database refuses this; so does the worker.
    const list = vi.fn(async () => ({ ok: true as const, objects: [] }));
    const readCandidate = vi.fn(async () => ({
      ok: true as const,
      candidate: { deletionId, workspaceKey, sourceId, documentIds: [documentId], worldObjectKeys: [] },
    }));
    const attest = vi.fn();
    const recordFailure = vi.fn(async () => ({ ok: true as const }));

    await expect(runSourceDeletionInventoryAttestation({
      signer, list, readCandidate, attest, recordFailure,
    })).resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_EMPTY_LISTING", processed: 0,
      deletionId, failureRecorded: true });
    expect(attest).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(deletionId, "SOURCE_INVENTORY_EMPTY_LISTING");
  });

  it("isolates a stuck tombstone: its failure is recorded so the next run takes the next one", async () => {
    // Stand-in for source_deletion_inventory_candidate's order: least recently failed first.
    const stuck = { deletionId, workspaceKey, sourceId, documentIds: [documentId], worldObjectKeys: [] };
    const other = { ...stuck, deletionId: `sha256:${"e".repeat(64)}`, documentIds: ["22222222-2222-4222-8222-222222222222"] };
    const failures = new Map<string, number>();
    const readCandidate = vi.fn(async () => ({
      ok: true as const,
      candidate: [stuck, other].sort((a, b) => (failures.get(a.deletionId) ?? 0) - (failures.get(b.deletionId) ?? 0))[0]!,
    }));
    const recordFailure = vi.fn(async (id: string) => {
      failures.set(id, (failures.get(id) ?? 0) + 1);
      return { ok: true as const };
    });
    const list = vi.fn(async (_s: unknown, _w: string, ids: readonly string[]) => ({
      ok: true as const,
      objects: ids[0] === documentId ? [] : [{ key: `quarantine/${workspaceKey}/${ids[0]}/source`, sizeBytes: 5 }],
    }));
    const hash = vi.fn(async (_s: unknown, _w: string, object: { key: string; sizeBytes: number }) => ({
      ok: true as const, object: { ...object, sha256: `sha256:${"c".repeat(64)}` },
    }));
    const attest = vi.fn(async () => ({ ok: true as const,
      attestation: { status: "recorded" as const, manifestSha256: `sha256:${"d".repeat(64)}`, artifactCount: 1 } }));
    const deps = { signer, list, hash, readCandidate, attest, recordFailure };

    expect(await runSourceDeletionInventoryAttestation(deps)).toMatchObject({ ok: false, deletionId });
    expect(await runSourceDeletionInventoryAttestation(deps)).toMatchObject({ ok: true, code: "ATTESTED" });
    expect(attest).toHaveBeenCalledWith(other.deletionId, expect.any(Array), []);
    // The stuck one is still handed out again later: retried, never skipped or marked done.
    failures.set(other.deletionId, 2);
    expect(await runSourceDeletionInventoryAttestation(deps)).toMatchObject({ ok: false, deletionId });
    expect(recordFailure).toHaveBeenCalledTimes(2);
  });

  it("refuses a prefix that changes while bytes are being hashed", async () => {
    const first = [{
      key: `quarantine/${workspaceKey}/${documentId}/source`,
      sizeBytes: 5,
    }];
    const second = [...first, {
      key: `quarantine/${workspaceKey}/${documentId}/cdr-reject.json`,
      sizeBytes: 9,
    }];
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, objects: first })
      .mockResolvedValueOnce({ ok: true as const, objects: second });
    const hash = vi.fn(async (_signer: typeof signer, _workspace: string, object: typeof first[number]) => ({
      ok: true as const,
      object: { ...object, sha256: `sha256:${"c".repeat(64)}` },
    }));
    const readCandidate = vi.fn(async () => ({
      ok: true as const,
      candidate: { deletionId, workspaceKey, sourceId, documentIds: [documentId], worldObjectKeys: [] },
    }));
    const attest = vi.fn();
    const recordFailure = vi.fn(async () => ({ ok: false as const, code: "SOURCE_INVENTORY_STORE_FAILED" }));

    await expect(runSourceDeletionInventoryAttestation({
      signer, list, hash, readCandidate, attest, recordFailure,
    })).resolves.toEqual({
      ok: false, code: "SOURCE_INVENTORY_CHANGED_DURING_SCAN", processed: 0, deletionId, failureRecorded: false,
    });
    expect(attest).not.toHaveBeenCalled();
  });
});

describe("source deletion R2 inventory", () => {
  it("lists only the exact quarantine and immutable document prefixes", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const prefix = url.searchParams.get("prefix") ?? "";
      const key = prefix.endsWith("/")
        ? `${prefix}${prefix.startsWith("quarantine/") ? "source" : "sanitized.pdf"}`
        : "";
      const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${key}</Key><Size>5</Size></Contents></ListBucketResult>`;
      return new Response(xml, { status: 200 });
    });
    const result = await listFoundationSourceInventory(
      signer, workspaceKey, [documentId], [], fetcher,
    );
    expect(result).toEqual({
      ok: true,
      objects: [
        { key: `immutable/${workspaceKey}/${workspaceKey}/${documentId}/sanitized.pdf`, sizeBytes: 5 },
        { key: `quarantine/${workspaceKey}/${documentId}/source`, sizeBytes: 5 },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("lists each World key exactly: present with its size, absent omitted, neighbours ignored", async () => {
    const present = worldKey("1");
    const absent = worldKey("2");
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = prefix === present
        ? [present]
        : prefix === absent ? [`${absent}.bak`] : [];
      // One page with more to come: an exact World key must not follow the cursor.
      const truncated = prefix === present ? "<IsTruncated>true</IsTruncated><NextContinuationToken>next</NextContinuationToken>" : "<IsTruncated>false</IsTruncated>";
      const xml = `<?xml version="1.0"?><ListBucketResult>${truncated}${keys.map((key) => `<Contents><Key>${key}</Key><Size>7</Size></Contents>`).join("")}</ListBucketResult>`;
      return new Response(xml, { status: 200 });
    });
    const result = await listFoundationSourceInventory(signer, workspaceKey, [], [absent, present], fetcher);
    expect(result).toEqual({ ok: true, objects: [{ key: present, sizeBytes: 7 }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([input]) => new URL(String(input)).searchParams.get("max-keys") === "1")).toBe(true);
  });

  it("refuses a foreign, non-World or oversized World key set before reading R2", async () => {
    const fetcher = vi.fn();
    for (const keys of [
      [worldKey("1", "pilot-other01")],
      [`immutable/${workspaceKey}/${workspaceKey}/collections/collection-${"e".repeat(32)}/`],
      [`immutable/${workspaceKey}/${workspaceKey}/${documentId}/sanitized.pdf`],
      [worldKey("1"), worldKey("1")],
    ]) {
      await expect(listFoundationSourceInventory(signer, workspaceKey, [documentId], keys, fetcher))
        .resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_SCOPE_INVALID" });
    }
    const oversized = Array.from({ length: 65 }, (_, i) => worldKey(i.toString(16).padStart(2, "0")));
    await expect(listFoundationSourceInventory(signer, workspaceKey, [documentId], oversized, fetcher))
      .resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_WORLD_LIMIT" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hashes exactly the listed bytes and refuses a size drift", async () => {
    const object = {
      key: `quarantine/${workspaceKey}/${documentId}/source`,
      sizeBytes: 5,
    };
    const fetcher = vi.fn(async () => new Response("hello", {
      status: 200, headers: { "content-length": "5" },
    }));
    const result = await hashFoundationSourceInventoryObject(
      signer, workspaceKey, object, fetcher,
    );
    expect(result).toMatchObject({
      ok: true,
      object: {
        ...object,
        sha256: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      },
    });

    const changed = await hashFoundationSourceInventoryObject(
      signer, workspaceKey, object,
      vi.fn(async () => new Response("helloo", {
        status: 200, headers: { "content-length": "6" },
      })),
    );
    expect(changed).toEqual({ ok: false, code: "SOURCE_INVENTORY_LIST_CHANGED" });
  });
});

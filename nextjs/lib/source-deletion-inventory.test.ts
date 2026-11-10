import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  HASH_BUDGET_BYTES,
  HASH_BUDGET_MS,
  runSourceDeletionInventoryAttestation,
} from "./source-deletion-inventory";
import {
  hashFoundationSourceInventoryObject,
  listFoundationSourceInventory,
  type SourceInventoryHashedObject,
  type SourceInventoryObject,
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

const candidateFor = (overrides: Partial<{ deletionId: string; documentIds: string[]; worldObjectKeys: string[] }> = {}) => ({
  ok: true as const,
  candidate: { deletionId, workspaceKey, sourceId, documentIds: [documentId], worldObjectKeys: [] as string[], ...overrides },
});
const part = (n: number, sizeBytes = 5, etag = "e1"): SourceInventoryObject =>
  ({ key: `quarantine/${workspaceKey}/${documentId}/segments/part-${String(n).padStart(5, "0")}`, sizeBytes, etag });
const hashOf = (object: SourceInventoryObject) => `sha256:${createHash("sha256").update(`${object.key}:${object.sizeBytes}`).digest("hex")}`;
const hasher = () => vi.fn(async (_s: unknown, _w: string, object: SourceInventoryObject) => ({
  ok: true as const, object: { ...object, sha256: hashOf(object) },
}));

/**
 * The database half, in memory: rows keyed by object, a digest over the ordered set, and a seal
 * that refuses any set but the one it was named with -- what 20261110043000 does under its lock.
 */
function digestStore() {
  const rows = new Map<string, SourceInventoryHashedObject>();
  const ordered = () => [...rows.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const setSha = () => `sha256:${createHash("sha256").update(JSON.stringify(ordered())).digest("hex")}`;
  const sealed: SourceInventoryHashedObject[][] = [];
  return {
    rows,
    sealed,
    readDigests: vi.fn(async () => ({ ok: true as const, digests: { objects: ordered(), digestSetSha256: setSha() } })),
    recordDigest: vi.fn(async (_id: string, object: SourceInventoryHashedObject) => {
      rows.set(object.key, object);
      return { ok: true as const };
    }),
    discardDigests: vi.fn(async () => {
      rows.clear();
      return { ok: true as const };
    }),
    seal: vi.fn(async (_id: string, digestSetSha256: string, _world: readonly string[]) => {
      if (digestSetSha256 !== setSha()) return { ok: false as const, code: "SOURCE_INVENTORY_STORE_FAILED" };
      sealed.push(ordered());
      return { ok: true as const, attestation: {
        status: sealed.length === 1 ? "recorded" as const : "replayed" as const,
        manifestSha256: `sha256:${"d".repeat(64)}`,
        artifactCount: rows.size,
      } };
    }),
  };
}

describe("source deletion inventory attestation", () => {
  it("stays idle when no eligible source needs an inventory", async () => {
    const readCandidate = vi.fn(async () => ({ ok: true as const, candidate: null }));
    await expect(runSourceDeletionInventoryAttestation({ signer, readCandidate }))
      .resolves.toEqual({ ok: true, code: "IDLE", processed: 0 });
  });

  it("hashes a stable complete listing, persists each digest and seals that exact set", async () => {
    const objects = [{ key: `quarantine/${workspaceKey}/${documentId}/source`, sizeBytes: 5, etag: "e1" }];
    const list = vi.fn(async () => ({ ok: true as const, objects }));
    const hash = hasher();
    const store = digestStore();

    await expect(runSourceDeletionInventoryAttestation({
      signer, list, hash, readCandidate: vi.fn(async () => candidateFor()), ...store,
    })).resolves.toEqual({
      ok: true, code: "ATTESTED", processed: 1, artifactCount: 1, status: "recorded",
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(hash).toHaveBeenCalledOnce();
    expect(store.recordDigest).toHaveBeenCalledWith(deletionId, { ...objects[0], sha256: hashOf(objects[0]!) });
    expect(store.seal).toHaveBeenCalledWith(deletionId, expect.stringMatching(/^sha256:[a-f0-9]{64}$/), []);
    expect(store.sealed).toEqual([[{ ...objects[0], sha256: hashOf(objects[0]!) }]]);
  });

  it("inventories the exact World keys twice and hands the full set to the seal", async () => {
    const present = worldKey("1");
    const absent = worldKey("2");
    const objects = [
      { key: present, sizeBytes: 7, etag: "e1" },
      { key: `quarantine/${workspaceKey}/${documentId}/source`, sizeBytes: 5, etag: "e1" },
    ];
    const list = vi.fn(async () => ({ ok: true as const, objects }));
    const store = digestStore();

    await expect(runSourceDeletionInventoryAttestation({
      signer, list, hash: hasher(), ...store,
      readCandidate: vi.fn(async () => candidateFor({ worldObjectKeys: [present, absent] })),
    })).resolves.toMatchObject({ ok: true, code: "ATTESTED", artifactCount: 2 });
    expect(list.mock.calls).toEqual([
      [signer, workspaceKey, [documentId], [present, absent]],
      [signer, workspaceKey, [documentId], [present, absent]],
    ]);
    // The absent key is still named: the database records it as absent, never as purged.
    expect(store.seal).toHaveBeenCalledWith(deletionId, expect.any(String), [present, absent]);
  });

  it("refuses an oversized World set and records it against the tombstone", async () => {
    const worldObjectKeys = Array.from({ length: 65 }, (_, i) => worldKey(i.toString(16).padStart(2, "0")));
    const list = vi.fn();
    const store = digestStore();
    const recordFailure = vi.fn(async () => ({ ok: true as const }));

    await expect(runSourceDeletionInventoryAttestation({
      signer, list, ...store, recordFailure, readCandidate: vi.fn(async () => candidateFor({ worldObjectKeys })),
    })).resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_WORLD_LIMIT", processed: 0, deletionId, failureRecorded: true });
    expect(list).not.toHaveBeenCalled();
    expect(store.seal).not.toHaveBeenCalled();
  });

  it("refuses to attest an empty listing while the source still has bound documents", async () => {
    // An R2 listing that fails open returns []. Attesting it would record artifact_count 0 as a
    // complete inventory, enqueue nothing, and make every later attestation of the real objects
    // a permanent ATTESTATION_CONFLICT. The database refuses this; so does the worker.
    const list = vi.fn(async () => ({ ok: true as const, objects: [] }));
    const store = digestStore();
    const recordFailure = vi.fn(async () => ({ ok: true as const }));

    await expect(runSourceDeletionInventoryAttestation({
      signer, list, ...store, recordFailure, readCandidate: vi.fn(async () => candidateFor()),
    })).resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_EMPTY_LISTING", processed: 0,
      deletionId, failureRecorded: true });
    expect(store.readDigests).not.toHaveBeenCalled();
    expect(store.seal).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(deletionId, "SOURCE_INVENTORY_EMPTY_LISTING");
  });

  it("isolates a stuck tombstone: its failure is recorded so the next run takes the next one", async () => {
    // Stand-in for source_deletion_inventory_candidate's order: least recently failed first.
    const stuck = candidateFor().candidate;
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
      objects: ids[0] === documentId ? [] : [{ key: `quarantine/${workspaceKey}/${ids[0]}/source`, sizeBytes: 5, etag: "e1" }],
    }));
    const store = digestStore();
    const deps = { signer, list, hash: hasher(), readCandidate, ...store, recordFailure };

    expect(await runSourceDeletionInventoryAttestation(deps)).toMatchObject({ ok: false, deletionId });
    expect(await runSourceDeletionInventoryAttestation(deps)).toMatchObject({ ok: true, code: "ATTESTED" });
    expect(store.seal).toHaveBeenCalledWith(other.deletionId, expect.any(String), []);
    // The stuck one is still handed out again later: retried, never skipped or marked done.
    failures.set(other.deletionId, 2);
    expect(await runSourceDeletionInventoryAttestation(deps)).toMatchObject({ ok: false, deletionId });
    expect(recordFailure).toHaveBeenCalledTimes(2);
  });

  it("refuses a prefix that changes while bytes are being hashed", async () => {
    const first = [{ key: `quarantine/${workspaceKey}/${documentId}/source`, sizeBytes: 5, etag: "e1" }];
    const second = [...first, { key: `quarantine/${workspaceKey}/${documentId}/cdr-reject.json`, sizeBytes: 9, etag: "e1" }];
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, objects: first })
      .mockResolvedValueOnce({ ok: true as const, objects: second });
    const store = digestStore();
    const recordFailure = vi.fn(async () => ({ ok: false as const, code: "SOURCE_INVENTORY_STORE_FAILED" }));

    await expect(runSourceDeletionInventoryAttestation({
      signer, list, hash: hasher(), ...store, recordFailure, readCandidate: vi.fn(async () => candidateFor()),
    })).resolves.toEqual({
      ok: false, code: "SOURCE_INVENTORY_CHANGED_DURING_SCAN", processed: 0, deletionId, failureRecorded: false,
    });
    expect(store.seal).not.toHaveBeenCalled();
  });

  it("attests 600 objects across several runs, hashing each object exactly once", async () => {
    // Past the 512 the single-call attestation held. The clock advances 100 ms per reading, so
    // each run stops starting objects at the 15 s budget and the next run continues.
    const objects = Array.from({ length: 600 }, (_, i) => part(i + 1, 1));
    const list = vi.fn(async () => ({ ok: true as const, objects }));
    const hash = hasher();
    const store = digestStore();
    let clock = 0;
    const deps = { signer, list, hash, ...store, now: () => (clock += 100), readCandidate: vi.fn(async () => candidateFor()) };

    const runs = [];
    for (let run = 0; run < 10; run += 1) {
      const result = await runSourceDeletionInventoryAttestation(deps);
      runs.push(result);
      if (result.code !== "IN_PROGRESS") break;
    }
    expect(runs.length).toBeGreaterThan(2);
    expect(runs.slice(0, -1).every((result) => result.ok && result.code === "IN_PROGRESS")).toBe(true);
    const perRun = HASH_BUDGET_MS / 100;
    expect(runs[0]).toEqual({ ok: true, code: "IN_PROGRESS", processed: 0, deletionId, hashedCount: perRun, remainingCount: 600 - perRun });
    expect(runs.at(-1)).toEqual({ ok: true, code: "ATTESTED", processed: 1, artifactCount: 600, status: "recorded" });
    expect(hash).toHaveBeenCalledTimes(600);
    expect(new Set(hash.mock.calls.map(([, , object]) => object.key)).size).toBe(600);
    expect(store.sealed).toHaveLength(1);
    expect(store.sealed[0]).toHaveLength(600);
    expect(store.discardDigests).not.toHaveBeenCalled();
  });

  it("stops at the byte budget but always hashes one object, so a run never stalls", async () => {
    const big = Math.floor(HASH_BUDGET_BYTES * 0.6);
    const objects = [part(1, big), part(2, big), part(3, big)];
    const list = vi.fn(async () => ({ ok: true as const, objects }));
    const hash = hasher();
    const store = digestStore();
    const deps = { signer, list, hash, ...store, now: () => 0, readCandidate: vi.fn(async () => candidateFor()) };

    await expect(runSourceDeletionInventoryAttestation(deps)).resolves.toMatchObject({ code: "IN_PROGRESS", hashedCount: 1, remainingCount: 2 });
    await expect(runSourceDeletionInventoryAttestation(deps)).resolves.toMatchObject({ code: "IN_PROGRESS", hashedCount: 1, remainingCount: 1 });
    // The last object is hashed and sealed in the same run.
    await expect(runSourceDeletionInventoryAttestation(deps)).resolves.toMatchObject({ code: "ATTESTED", artifactCount: 3 });
    expect(hash).toHaveBeenCalledTimes(3);
    // A progress run lists once; the sealing run lists before and after.
    expect(list).toHaveBeenCalledTimes(4);
  });

  it("resumes after a run dies between objects without hashing a persisted object again", async () => {
    const objects = [part(1), part(2), part(3), part(4)];
    const list = vi.fn(async () => ({ ok: true as const, objects }));
    const hash = hasher();
    hash.mockImplementationOnce(async (_s, _w, object) => ({ ok: true as const, object: { ...object, sha256: hashOf(object) } }))
      .mockImplementationOnce(async (_s, _w, object) => ({ ok: true as const, object: { ...object, sha256: hashOf(object) } }))
      .mockImplementationOnce(async () => { throw new Error("function instance killed"); });
    const store = digestStore();
    const recordFailure = vi.fn(async () => ({ ok: true as const }));
    const deps = { signer, list, hash, ...store, recordFailure, now: () => 0, readCandidate: vi.fn(async () => candidateFor()) };

    await expect(runSourceDeletionInventoryAttestation(deps)).rejects.toThrow("function instance killed");
    expect([...store.rows.keys()]).toEqual([part(1).key, part(2).key]);

    await expect(runSourceDeletionInventoryAttestation(deps)).resolves.toMatchObject({ code: "ATTESTED", artifactCount: 4 });
    expect(hash.mock.calls.slice(3).map(([, , object]) => object.key)).toEqual([part(3).key, part(4).key]);
    expect(store.sealed[0]).toEqual(objects.map((object) => ({ ...object, sha256: hashOf(object) })));
  });

  it("discards every persisted digest when the listing changed between runs, then hashes again", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, objects: [part(1, 5), part(2, 5)] })
      .mockResolvedValue({ ok: true as const, objects: [part(1, 6), part(2, 5)] });
    const hash = hasher();
    const store = digestStore();
    let clock = 0;
    const deps = { signer, list, hash, ...store, now: () => (clock += HASH_BUDGET_MS), readCandidate: vi.fn(async () => candidateFor()) };

    await expect(runSourceDeletionInventoryAttestation(deps)).resolves.toMatchObject({ code: "IN_PROGRESS", hashedCount: 1 });
    expect(store.rows.get(part(1).key)?.sizeBytes).toBe(5);
    // part-00001 is now listed at 6 bytes: its digest is of bytes that are gone.
    await expect(runSourceDeletionInventoryAttestation(deps)).resolves.toMatchObject({ code: "IN_PROGRESS", hashedCount: 1 });
    expect(store.discardDigests).toHaveBeenCalledOnce();
    await expect(runSourceDeletionInventoryAttestation(deps)).resolves.toMatchObject({ code: "ATTESTED", artifactCount: 2 });
    expect(store.sealed[0]).toEqual([part(1, 6), part(2, 5)].map((object) => ({ ...object, sha256: hashOf(object) })));
  });

  it("discards and hashes again when a key was rewritten at the same size between runs (its ETag moved)", async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, objects: [part(1, 5), part(2, 5)] })
      .mockResolvedValue({ ok: true as const, objects: [part(1, 5, "e2"), part(2, 5)] });
    const hash = hasher();
    const store = digestStore();
    let clock = 0;
    const deps = { signer, list, hash, ...store, now: () => (clock += HASH_BUDGET_MS), readCandidate: vi.fn(async () => candidateFor()) };

    await expect(runSourceDeletionInventoryAttestation(deps)).resolves.toMatchObject({ code: "IN_PROGRESS", hashedCount: 1 });
    expect(store.rows.get(part(1).key)?.etag).toBe("e1");
    await expect(runSourceDeletionInventoryAttestation(deps)).resolves.toMatchObject({ code: "IN_PROGRESS", hashedCount: 1 });
    expect(store.discardDigests).toHaveBeenCalledOnce();
    await expect(runSourceDeletionInventoryAttestation(deps)).resolves.toMatchObject({ code: "ATTESTED", artifactCount: 2 });
    expect(store.sealed[0]?.map((object) => object.etag)).toEqual(["e2", "e1"]);
  });

  it("seals nothing when an overlapping run changed the digest set after this run's listing", async () => {
    const objects = [part(1), part(2)];
    const list = vi.fn(async () => ({ ok: true as const, objects }));
    const store = digestStore();
    const read = store.readDigests.getMockImplementation()!;
    // The second read (just before sealing) sees an overlapping run's discard.
    store.readDigests.mockImplementationOnce(read).mockImplementationOnce(async () => {
      store.rows.clear();
      return read();
    });
    const recordFailure = vi.fn(async () => ({ ok: true as const }));

    await expect(runSourceDeletionInventoryAttestation({
      signer, list, hash: hasher(), ...store, recordFailure, now: () => 0, readCandidate: vi.fn(async () => candidateFor()),
    })).resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_DIGESTS_CHANGED", processed: 0, deletionId, failureRecorded: true });
    expect(store.seal).not.toHaveBeenCalled();
  });

  it("passes a seal refusal through: the database's own check of the digest set fails closed", async () => {
    const objects = [part(1)];
    const store = digestStore();
    store.seal.mockResolvedValueOnce({ ok: false as const, code: "SOURCE_INVENTORY_STORE_FAILED" });
    const recordFailure = vi.fn(async () => ({ ok: true as const }));

    await expect(runSourceDeletionInventoryAttestation({
      signer, list: vi.fn(async () => ({ ok: true as const, objects })), hash: hasher(), ...store, recordFailure,
      now: () => 0, readCandidate: vi.fn(async () => candidateFor()),
    })).resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_STORE_FAILED", processed: 0, deletionId, failureRecorded: true });
    // The digests stay: the next run seals them without reading a byte again.
    expect(store.rows.size).toBe(1);
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
      const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${key}</Key><Size>5</Size><ETag>&quot;e1&quot;</ETag></Contents></ListBucketResult>`;
      return new Response(xml, { status: 200 });
    });
    const result = await listFoundationSourceInventory(
      signer, workspaceKey, [documentId], [], fetcher,
    );
    expect(result).toEqual({
      ok: true,
      objects: [
        { key: `immutable/${workspaceKey}/${workspaceKey}/${documentId}/sanitized.pdf`, sizeBytes: 5, etag: "e1" },
        { key: `quarantine/${workspaceKey}/${documentId}/source`, sizeBytes: 5, etag: "e1" },
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
      const xml = `<?xml version="1.0"?><ListBucketResult>${truncated}${keys.map((key) => `<Contents><Key>${key}</Key><Size>7</Size><ETag>"e1"</ETag></Contents>`).join("")}</ListBucketResult>`;
      return new Response(xml, { status: 200 });
    });
    const result = await listFoundationSourceInventory(signer, workspaceKey, [], [absent, present], fetcher);
    expect(result).toEqual({ ok: true, objects: [{ key: present, sizeBytes: 7, etag: "e1" }] });
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
      etag: "e1",
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

    // Rewritten at the same size between the listing and the read: the served ETag says so.
    const rewritten = await hashFoundationSourceInventoryObject(
      signer, workspaceKey, object,
      vi.fn(async () => new Response("hullo", {
        status: 200, headers: { "content-length": "5", etag: '"e2"' },
      })),
    );
    expect(rewritten).toEqual({ ok: false, code: "SOURCE_INVENTORY_LIST_CHANGED" });
  });

  it("refuses a listing entry with no ETag, because a same-size rewrite could not be seen", async () => {
    const fetcher = vi.fn(async () => new Response(
      `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>quarantine/${workspaceKey}/${documentId}/source</Key><Size>5</Size></Contents></ListBucketResult>`,
      { status: 200 },
    ));
    await expect(listFoundationSourceInventory(signer, workspaceKey, [documentId], [], fetcher))
      .resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_LIST_INVALID" });
  });
});

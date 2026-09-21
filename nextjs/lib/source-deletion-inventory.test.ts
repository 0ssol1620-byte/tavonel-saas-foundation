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
      candidate: { deletionId, workspaceKey, sourceId, documentIds: [documentId] },
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
    );
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
      candidate: { deletionId, workspaceKey, sourceId, documentIds: [documentId] },
    }));
    const attest = vi.fn();

    await expect(runSourceDeletionInventoryAttestation({
      signer, list, hash, readCandidate, attest,
    })).resolves.toEqual({
      ok: false, code: "SOURCE_INVENTORY_CHANGED_DURING_SCAN", processed: 0,
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
      signer, workspaceKey, [documentId], fetcher,
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

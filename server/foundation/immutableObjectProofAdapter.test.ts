import { describe, expect, it } from "vitest";
import { activationPolicy } from "../../shared/activationPolicy";
import {
  bindImmutableSourceProof,
  metadataOnlyObjectStoreAdapter,
  objectStoreAdapterIsLive,
  type ImmutableHeadObservation,
  type ImmutableSourceProof,
} from "./immutableObjectProofAdapter";

const digestA = "a".repeat(64);

const proof = (overrides: Partial<ImmutableSourceProof> = {}): ImmutableSourceProof => ({
  tenantId: "tenant_01",
  workspaceId: "workspace_01",
  documentId: "doc_01",
  immutableObjectKey: "immutable/tenant_01/workspace_01/dv_01/input.pdf",
  contentSha256: `sha256:${digestA}`,
  byteLength: 806,
  mimeType: "application/pdf",
  versionKey: "dv_01",
  stage: "immutable-approved",
  ...overrides,
});

const observation = (overrides: Partial<ImmutableHeadObservation> = {}): ImmutableHeadObservation => ({
  objectKey: "immutable/tenant_01/workspace_01/dv_01/input.pdf",
  contentLength: 806,
  observedMimeType: "application/pdf",
  sha256Hex: digestA,
  stage: "immutable-approved",
  versionKey: "dv_01",
  ...overrides,
});

const capability = {
  permitted: true as const,
  documentId: "doc-a",
  objectKey: "quarantine/workspace-a/doc-a/source",
  expiresInSeconds: 300,
  contentLength: 100,
  originalFilename: "synthetic.pdf",
  declaredMimeType: "application/pdf",
  requiredBoundary: "browser-direct-quarantine" as const,
  uploadUrl: null,
};

describe("metadata-only object-store proof adapter", () => {
  it("binds an immutable source proof without reading bytes or calling R2", () => {
    expect(bindImmutableSourceProof(proof(), observation())).toEqual({
      accepted: true,
      code: "IMMUTABLE_SOURCE_BOUND",
      objectKey: proof().immutableObjectKey,
    });
    expect(objectStoreAdapterIsLive()).toBe(false);
    expect(activationPolicy.customerIntake.enabled).toBe(false);
  });

  it("reuses MIME normalization so parameterized PDF metadata still matches", () => {
    expect(
      bindImmutableSourceProof(
        proof(),
        observation({ observedMimeType: "application/pdf; charset=binary" }),
      ).accepted,
    ).toBe(true);
  });

  it("rejects traversal keys, tenant mismatch, missing digests, and non-immutable stage", () => {
    expect(
      bindImmutableSourceProof(
        proof({ immutableObjectKey: "immutable/tenant_01/workspace_01/../other.pdf" }),
        observation({ objectKey: "immutable/tenant_01/workspace_01/../other.pdf" }),
      ),
    ).toEqual({ accepted: false, code: "OBJECT_KEY_INVALID" });
    expect(
      bindImmutableSourceProof(proof({ tenantId: "tenant_02" }), observation()),
    ).toEqual({ accepted: false, code: "OBJECT_KEY_INVALID" });
    expect(
      bindImmutableSourceProof(proof({ contentSha256: "not-a-digest" }), observation()),
    ).toEqual({ accepted: false, code: "DIGEST_MISSING" });
    expect(
      bindImmutableSourceProof(proof(), observation({ stage: "quarantine-uploaded" })),
    ).toEqual({ accepted: false, code: "STAGE_NOT_IMMUTABLE" });
  });

  it("unifies quarantine completion on the same adapter and never issues an upload URL", () => {
    const result = metadataOnlyObjectStoreAdapter.completeQuarantineUpload(capability, {
      objectKey: capability.objectKey,
      contentLength: 100,
      observedMimeType: "application/pdf",
      sourceSha256: digestA,
    });
    expect(result).toEqual({
      accepted: true,
      code: "DOCUMENT_QUARANTINED",
      documentId: "doc-a",
      nextDocumentState: "quarantined",
    });
    expect(capability.uploadUrl).toBeNull();
  });
});

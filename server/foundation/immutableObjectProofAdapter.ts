import { activationPolicy } from "../../shared/activationPolicy";
import { isImmutableScopedObjectKey } from "../../shared/productCoreCompileEnvelope";
import { normalizeDocumentMimeType } from "../../shared/qualifiedDocumentInputs";
import {
  completeQuarantineUpload,
  type QuarantineCompletionDecision,
  type QuarantineUploadObservation,
} from "./quarantineUploadCompletion";
import type { QuarantineUploadContract } from "./r2UploadContract";

const SHA256 = /^sha256:[a-f0-9]{64}$/;

export type ImmutableSourceProof = {
  tenantId: string;
  workspaceId: string;
  documentId: string;
  immutableObjectKey: string;
  contentSha256: string;
  byteLength: number;
  mimeType: string;
  versionKey: string;
  stage: "immutable-approved";
};

export type ImmutableHeadObservation = {
  objectKey: string;
  contentLength: number;
  observedMimeType: string;
  sha256Hex: string;
  stage: string;
  versionKey: string;
};

export type ImmutableProofDecision =
  | {
      accepted: false;
      code:
        | "OBJECT_KEY_INVALID"
        | "CONTENT_LENGTH_MISMATCH"
        | "OBSERVED_MIME_MISMATCH"
        | "DIGEST_MISSING"
        | "DIGEST_MISMATCH"
        | "STAGE_NOT_IMMUTABLE"
        | "VERSION_KEY_MISMATCH"
        | "TENANT_WORKSPACE_MISMATCH";
    }
  | { accepted: true; code: "IMMUTABLE_SOURCE_BOUND"; objectKey: string };

export type ObjectStoreProofAdapter = {
  completeQuarantineUpload: (
    capability: QuarantineUploadContract,
    observation: QuarantineUploadObservation,
  ) => QuarantineCompletionDecision;
  bindImmutableSourceProof: (
    proof: ImmutableSourceProof,
    observation: ImmutableHeadObservation,
  ) => ImmutableProofDecision;
};

function digestHex(value: string): string | null {
  if (SHA256.test(value)) return value.slice("sha256:".length);
  if (/^[a-f0-9]{64}$/.test(value)) return value;
  return null;
}

/**
 * Metadata-only immutable source proof. Never reads object bytes or calls R2.
 * Reuses Product immutable key hardening and MIME normalization.
 */
export function bindImmutableSourceProof(
  proof: ImmutableSourceProof,
  observation: ImmutableHeadObservation,
): ImmutableProofDecision {
  if (!proof.documentId || proof.immutableObjectKey !== observation.objectKey) {
    return { accepted: false, code: "TENANT_WORKSPACE_MISMATCH" };
  }
  if (!isImmutableScopedObjectKey(proof.immutableObjectKey, proof.tenantId, proof.workspaceId)) {
    return { accepted: false, code: "OBJECT_KEY_INVALID" };
  }
  const expectedDigest = digestHex(proof.contentSha256);
  const observedDigest = digestHex(observation.sha256Hex);
  if (!expectedDigest || !observedDigest) return { accepted: false, code: "DIGEST_MISSING" };
  if (expectedDigest !== observedDigest) return { accepted: false, code: "DIGEST_MISMATCH" };
  if (!Number.isSafeInteger(proof.byteLength) || proof.byteLength !== observation.contentLength) {
    return { accepted: false, code: "CONTENT_LENGTH_MISMATCH" };
  }
  if (normalizeDocumentMimeType(observation.observedMimeType) !== normalizeDocumentMimeType(proof.mimeType)) {
    return { accepted: false, code: "OBSERVED_MIME_MISMATCH" };
  }
  if (proof.stage !== "immutable-approved" || observation.stage !== "immutable-approved") {
    return { accepted: false, code: "STAGE_NOT_IMMUTABLE" };
  }
  if (!proof.versionKey || proof.versionKey !== observation.versionKey) {
    return { accepted: false, code: "VERSION_KEY_MISMATCH" };
  }
  return { accepted: true, code: "IMMUTABLE_SOURCE_BOUND", objectKey: proof.immutableObjectKey };
}

export const metadataOnlyObjectStoreAdapter: ObjectStoreProofAdapter = {
  completeQuarantineUpload,
  bindImmutableSourceProof,
};

export function objectStoreAdapterIsLive(): false {
  void activationPolicy.customerIntake.enabled;
  return false;
}


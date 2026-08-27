import { nanoid } from "nanoid";
import type { UploadCapabilityRequest } from "./uploadCapability";
import { evaluateUploadCapability } from "./uploadCapability";

export type QuarantineUploadContract =
  | { permitted: false; code: "INTAKE_DISABLED" | "FORBIDDEN" | "ENTITLEMENT_REQUIRED" | "UNQUALIFIED_INPUT" }
  | {
      permitted: true;
      documentId: string;
      objectKey: string;
      expiresInSeconds: number;
      contentLength: number;
      originalFilename: string;
      declaredMimeType: string;
      requiredBoundary: "browser-direct-quarantine";
      uploadUrl: null;
    };

export function issueQuarantineUploadContract(
  request: UploadCapabilityRequest,
  documentId = nanoid(18),
): QuarantineUploadContract {
  const decision = evaluateUploadCapability(request);
  if (!decision.permitted) return decision;

  // A real URL is intentionally unavailable until a separately approved R2 signer exists.
  // This contract contains no file bytes and never asks Vercel to stream a document body.
  return {
    permitted: true,
    documentId,
    objectKey: `quarantine/${request.workspaceId}/${documentId}/source`,
    expiresInSeconds: decision.expiresInSeconds,
    contentLength: decision.maxBytes,
    originalFilename: decision.originalFilename,
    declaredMimeType: decision.normalizedMimeType,
    requiredBoundary: "browser-direct-quarantine",
    uploadUrl: null,
  };
}

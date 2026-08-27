import { activationPolicy } from "../../shared/activationPolicy";
import type { QualifiedDocumentMime } from "../../shared/qualifiedDocumentInputs";
import type { WorkspaceEntitlement, WorkspaceMembership } from "../../shared/tenantDomain";
import { validateQualifiedDocumentInput } from "../../shared/qualifiedDocumentInputs";
import { canAccessWorkspace, entitlementAllowsUpload } from "./tenantAuthorization";

export type UploadCapabilityRequest = {
  actorId: string;
  workspaceId: string;
  requestedBytes: number;
  originalFilename: string;
  declaredMimeType: string;
  membership: WorkspaceMembership | null | undefined;
  entitlement: WorkspaceEntitlement | null | undefined;
  now?: Date;
};

export type UploadCapabilityDecision =
  | { permitted: false; code: "INTAKE_DISABLED" | "FORBIDDEN" | "ENTITLEMENT_REQUIRED" | "UNQUALIFIED_INPUT" }
  | {
      permitted: true;
      code: "QUALIFIED";
      maxBytes: number;
      expiresInSeconds: number;
      originalFilename: string;
      normalizedMimeType: QualifiedDocumentMime;
      storageBoundary: "browser-direct-quarantine";
    };

export function evaluateUploadCapability(
  request: UploadCapabilityRequest,
): UploadCapabilityDecision {
  // This guard is deliberately first: no entitlement state can bypass the global live-intake gate.
  if (!activationPolicy.customerIntake.enabled) {
    return { permitted: false, code: "INTAKE_DISABLED" };
  }

  if (!canAccessWorkspace(request.membership, request.actorId, request.workspaceId, "document.requestUpload")) {
    return { permitted: false, code: "FORBIDDEN" };
  }

  const qualifiedInput = validateQualifiedDocumentInput(request);
  if (!qualifiedInput.valid) {
    return { permitted: false, code: "UNQUALIFIED_INPUT" };
  }

  if (!entitlementAllowsUpload(request.entitlement, request.requestedBytes, request.now)) {
    return { permitted: false, code: "ENTITLEMENT_REQUIRED" };
  }

  return {
    permitted: true,
    code: "QUALIFIED",
    maxBytes: request.requestedBytes,
    expiresInSeconds: 300,
    originalFilename: qualifiedInput.originalFilename,
    normalizedMimeType: qualifiedInput.normalizedMimeType,
    storageBoundary: "browser-direct-quarantine",
  };
}

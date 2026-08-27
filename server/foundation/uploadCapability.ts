import { activationPolicy } from "../../shared/activationPolicy";
import type { WorkspaceEntitlement, WorkspaceMembership } from "../../shared/tenantDomain";
import { canAccessWorkspace, entitlementAllowsUpload } from "./tenantAuthorization";

export type UploadCapabilityRequest = {
  actorId: string;
  workspaceId: string;
  requestedBytes: number;
  membership: WorkspaceMembership | null | undefined;
  entitlement: WorkspaceEntitlement | null | undefined;
  now?: Date;
};

export type UploadCapabilityDecision =
  | { permitted: false; code: "INTAKE_DISABLED" | "FORBIDDEN" | "ENTITLEMENT_REQUIRED" }
  | {
      permitted: true;
      code: "QUALIFIED";
      maxBytes: number;
      expiresInSeconds: number;
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

  if (!entitlementAllowsUpload(request.entitlement, request.requestedBytes, request.now)) {
    return { permitted: false, code: "ENTITLEMENT_REQUIRED" };
  }

  return {
    permitted: true,
    code: "QUALIFIED",
    maxBytes: request.requestedBytes,
    expiresInSeconds: 300,
    storageBoundary: "browser-direct-quarantine",
  };
}

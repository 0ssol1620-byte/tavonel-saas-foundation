import type {
  WorkspaceEntitlement,
  WorkspaceMembership,
  WorkspaceRole,
} from "../../shared/tenantDomain";

export type WorkspaceAction =
  | "workspace.read"
  | "document.read"
  | "document.requestUpload"
  | "workspace.manageMembers"
  | "workspace.manageBilling"
  | "candidate.review";

const rolePermissions: Record<WorkspaceRole, readonly WorkspaceAction[]> = {
  owner: [
    "workspace.read",
    "document.read",
    "document.requestUpload",
    "workspace.manageMembers",
    "workspace.manageBilling",
    "candidate.review",
  ],
  admin: [
    "workspace.read",
    "document.read",
    "document.requestUpload",
    "workspace.manageMembers",
    "candidate.review",
  ],
  member: ["workspace.read", "document.read", "document.requestUpload"],
  viewer: ["workspace.read", "document.read"],
};

export function canAccessWorkspace(
  membership: WorkspaceMembership | null | undefined,
  actorId: string,
  workspaceId: string,
  action: WorkspaceAction,
) {
  if (!membership) return false;
  if (membership.userId !== actorId || membership.workspaceId !== workspaceId) {
    return false;
  }
  return rolePermissions[membership.role].includes(action);
}

export function entitlementAllowsUpload(
  entitlement: WorkspaceEntitlement | null | undefined,
  requestedBytes: number,
  now = new Date(),
) {
  if (!entitlement || !Number.isSafeInteger(requestedBytes) || requestedBytes <= 0) {
    return false;
  }
  if (
    entitlement.status !== "trialing" &&
    entitlement.status !== "active" &&
    entitlement.status !== "past_due"
  ) {
    return false;
  }
  if (entitlement.validUntil && entitlement.validUntil.getTime() <= now.getTime()) {
    return false;
  }
  const hasByteCapacity = entitlement.uploadBytesUsed + requestedBytes <= entitlement.uploadBytesLimit;
  const hasDocumentCapacity = entitlement.documentCount < entitlement.documentLimit;
  return hasByteCapacity && hasDocumentCapacity;
}

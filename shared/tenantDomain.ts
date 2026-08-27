export const workspaceRoles = ["owner", "admin", "member", "viewer"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export const subscriptionStates = [
  "trialing",
  "active",
  "past_due",
  "paused",
  "canceled",
  "inactive",
] as const;
export type SubscriptionState = (typeof subscriptionStates)[number];

export const documentStates = [
  "requested",
  "quarantined",
  "sanitized",
  "rejected",
  "candidate_ready",
] as const;
export type DocumentState = (typeof documentStates)[number];

export type WorkspaceMembership = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
};

export type WorkspaceEntitlement = {
  workspaceId: string;
  status: SubscriptionState;
  uploadBytesLimit: number;
  uploadBytesUsed: number;
  documentLimit: number;
  documentCount: number;
  validUntil: Date | null;
};

export type DocumentMetadata = {
  id: string;
  workspaceId: string;
  createdBy: string;
  originalFilename: string;
  declaredMimeType: string;
  quarantineObjectKey: string;
  state: DocumentState;
  sourceSha256: string | null;
};

export type WorkspaceMembership = { workspaceId: string; userId: string; role: "owner" | "admin" | "member" | "viewer" };
export type WorkspaceEntitlement = {
  workspaceId: string;
  status: "trialing" | "active" | "past_due" | "paused" | "canceled" | "inactive";
  uploadBytesLimit: number;
  uploadBytesUsed: number;
  documentLimit: number;
  documentCount: number;
  validUntil: Date | null;
};

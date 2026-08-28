import { createClient } from "@supabase/supabase-js";
import type { WorkspaceEntitlement, WorkspaceMembership } from "./pilot-tenant";
import { FOUNDATION_INTAKE_MAX_BYTES } from "./r2-presign";

export function foundationWorkspaceId(userId: string) {
  const compact = userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  return `pilot-${compact || "user"}`;
}

export function foundationPilotAccess(userId: string): { membership: WorkspaceMembership; entitlement: WorkspaceEntitlement } {
  const workspaceId = foundationWorkspaceId(userId);
  return {
    membership: { workspaceId, userId, role: "owner" },
    entitlement: {
      workspaceId,
      status: "active",
      uploadBytesLimit: FOUNDATION_INTAKE_MAX_BYTES * 20,
      uploadBytesUsed: 0,
      documentLimit: 20,
      documentCount: 0,
      validUntil: null,
    },
  };
}

export async function getRequestUser(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url.startsWith("https://") || !key) return null;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(authorization.slice("Bearer ".length));
  if (error || !data.user?.id) return null;
  return data.user;
}

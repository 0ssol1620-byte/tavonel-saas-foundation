import { createClient } from "@supabase/supabase-js";
import type { WorkspaceEntitlement, WorkspaceMembership } from "./pilot-tenant";
import { FOUNDATION_INTAKE_MAX_BYTES } from "./r2-presign";

export function foundationWorkspaceId(userId: string) {
  const compact = userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  return `pilot-${compact || "user"}`;
}

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readFoundationPilotUserIds(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const raw = env.FOUNDATION_PILOT_USER_IDS?.trim() ?? "";
  if (!raw) return null;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.length > 20 || values.some((value) => !USER_ID.test(value))) return null;
  return new Set(values.map((value) => value.toLowerCase()));
}

export function foundationPilotAccess(
  userId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { membership: WorkspaceMembership; entitlement: WorkspaceEntitlement } | null {
  const allowed = readFoundationPilotUserIds(env);
  if (!USER_ID.test(userId) || !allowed?.has(userId.toLowerCase())) return null;
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
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(5_000),
      }),
    },
  });
  try {
    const { data, error } = await client.auth.getUser(authorization.slice("Bearer ".length));
    if (error || !data.user?.id) return null;
    return data.user;
  } catch {
    return null;
  }
}

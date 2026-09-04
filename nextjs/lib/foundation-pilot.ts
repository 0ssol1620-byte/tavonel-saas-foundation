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

// How this deployment decides who may use the product.
//
//   pilot        - only the user IDs in FOUNDATION_PILOT_USER_IDS. The original behaviour,
//                  and still correct for a private deployment.
//   self_service - any authenticated user gets their own workspace on first request.
//
// The allowlist was the single gate in front of every authenticated surface
// (billing, promote, rollback, documents, developer API, enterprise), so a signed-in
// customer who was not hand-added to an environment variable could authenticate and then do
// nothing at all. That is correct for a private pilot and fatal for self-service signup.
//
// Default is `pilot`. A deployment opts into public signup explicitly by setting
// ACCESS_MODE=self_service. Vercel preview deployments remain pilot even when they inherit the
// project value: otherwise a public preview URL could mint free trials against the production
// database. Local/test environments have no VERCEL_ENV and may opt in explicitly.
export type AccessMode = "pilot" | "self_service";

export function readAccessMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AccessMode {
  if (env.ACCESS_MODE?.trim().toLowerCase() !== "self_service") return "pilot";
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase() ?? "";
  if (vercelEnv && vercelEnv !== "production") return "pilot";
  return "self_service";
}

// This object is only the immediate, in-process onboarding envelope. The durable trial policy
// (7 days / 3 files / 50 standard pages / 1 World) lives in foundation_trial_policy and is
// re-checked transactionally before intake/compute. Keeping the provisional document and byte
// envelope no larger than the durable free tier prevents UI/read paths from advertising a larger
// allowance during the milliseconds before the database bootstrap finishes.
function selfServiceEntitlement(workspaceId: string): WorkspaceEntitlement {
  return {
    workspaceId,
    status: "trialing",
    uploadBytesLimit: FOUNDATION_INTAKE_MAX_BYTES * 3,
    uploadBytesUsed: 0,
    documentLimit: 3,
    documentCount: 0,
    validUntil: null,
  };
}

export function foundationPilotAccess(
  userId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { membership: WorkspaceMembership; entitlement: WorkspaceEntitlement } | null {
  // A malformed user ID is refused in every mode: the workspace key is derived from it, so
  // an unvalidated value would produce an unaddressable or colliding tenant.
  if (!USER_ID.test(userId)) return null;
  const workspaceId = foundationWorkspaceId(userId);

  if (readAccessMode(env) === "self_service") {
    // First-party onboarding: the authenticated user owns their own workspace. Tenant
    // isolation is unchanged -- the workspace key is still derived from the user ID, so this
    // widens WHO may hold a workspace, never what one workspace can reach.
    return { membership: { workspaceId, userId, role: "owner" }, entitlement: selfServiceEntitlement(workspaceId) };
  }

  const allowed = readFoundationPilotUserIds(env);
  if (!allowed?.has(userId.toLowerCase())) return null;
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

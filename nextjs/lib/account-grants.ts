import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;

export type FoundationAccountGrant = {
  userId: string;
  grantKind: "owner";
  accessPlan: "observer_access" | "studio_access";
  billingExempt: boolean;
  trialExempt: boolean;
  active: boolean;
};

export type FoundationSelfServiceTrial = {
  userId: string;
  workspaceKey: string;
  status: "trialing" | "converted" | "expired" | "blocked";
  startedAt: string;
  expiresAt: string;
  endedReason: string | null;
};

export async function getFoundationAccountGrant(userId: string) {
  if (!UUID.test(userId)) return { ok: false as const, code: "ACCOUNT_GRANT_INPUT_INVALID" };
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "ACCOUNT_GRANT_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "user_id,grant_kind,access_plan,billing_exempt,trial_exempt,active",
    user_id: `eq.${userId}`,
    active: "eq.true",
    limit: "1",
  });
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_account_access_grants?${query}`, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return { ok: false as const, code: "ACCOUNT_GRANT_STORE_READ_FAILED" };
  }
  if (!response.ok) return { ok: false as const, code: "ACCOUNT_GRANT_STORE_READ_FAILED" };
  const rows = await response.json().catch(() => []) as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return { ok: true as const, grant: null };
  if (row.grant_kind !== "owner" || !["observer_access", "studio_access"].includes(String(row.access_plan ?? ""))) {
    return { ok: false as const, code: "ACCOUNT_GRANT_STORE_INVALID" };
  }
  return {
    ok: true as const,
    grant: {
      userId,
      grantKind: "owner" as const,
      accessPlan: row.access_plan as FoundationAccountGrant["accessPlan"],
      billingExempt: row.billing_exempt === true,
      trialExempt: row.trial_exempt === true,
      active: row.active === true,
    } satisfies FoundationAccountGrant,
  };
}

export async function getFoundationSelfServiceTrial(workspaceKey: string, userId: string) {
  if (!WORKSPACE.test(workspaceKey) || !UUID.test(userId)) {
    return { ok: false as const, code: "TRIAL_STATE_INPUT_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "TRIAL_STATE_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "user_id,workspace_key,status,started_at,expires_at,ended_reason",
    workspace_key: `eq.${workspaceKey}`,
    user_id: `eq.${userId}`,
    limit: "1",
  });
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/foundation_self_service_trials?${query}`, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return { ok: false as const, code: "TRIAL_STATE_STORE_READ_FAILED" };
  }
  if (!response.ok) return { ok: false as const, code: "TRIAL_STATE_STORE_READ_FAILED" };
  const rows = await response.json().catch(() => []) as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return { ok: true as const, trial: null };
  const status = String(row.status ?? "");
  if (!["trialing", "converted", "expired", "blocked"].includes(status)
    || typeof row.started_at !== "string" || typeof row.expires_at !== "string") {
    return { ok: false as const, code: "TRIAL_STATE_STORE_INVALID" };
  }
  return {
    ok: true as const,
    trial: {
      userId,
      workspaceKey,
      status: status as FoundationSelfServiceTrial["status"],
      startedAt: row.started_at,
      expiresAt: row.expires_at,
      endedReason: typeof row.ended_reason === "string" ? row.ended_reason : null,
    } satisfies FoundationSelfServiceTrial,
  };
}

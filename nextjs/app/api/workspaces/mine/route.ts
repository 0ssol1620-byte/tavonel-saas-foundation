import { NextResponse } from "next/server";
import { resolveActingWorkspace } from "@/lib/acting-workspace";
import { BILLING_OFFERS } from "@/lib/billing-catalog";
import { getRequestUser } from "@/lib/foundation-pilot";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

const WORKSPACE_KEY = /^pilot-[A-Za-z0-9]{1,16}$/;
const ROLES = new Set(["owner", "admin", "member"]);
const LIST_LIMIT = 100;

/** The public shape of one membership. Built field by field: the store row never passes through. */
export type MyWorkspace = {
  workspaceKey: string;
  role: "owner" | "admin" | "member";
  /** The workspace's own name, "<owner>'s workspace" unless renamed; null when it has none. */
  workspaceName: string | null;
  /** The plan the workspace is on while it is active or trialing; null otherwise. */
  planLabel: string | null;
  acting: boolean;
};

async function read(path: string): Promise<unknown[] | null> {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  try {
    const response = await supabaseAdminRequest(config, path, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const rows: unknown = await response.json().catch(() => null);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/*
  WO-C-T1: the workspaces the caller may act in -- every active membership, their own included --
  and which one this request acts in. A row the store returns in any other shape fails the
  request rather than being skipped: a switcher that silently drops a workspace is a wrong answer.
*/
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return reply({ code: "AUTH_REQUIRED" }, 401);
  const acting = await resolveActingWorkspace(request, user);
  if (!acting.ok) return reply({ code: acting.code }, acting.status);

  const memberRows = await read(`/rest/v1/foundation_workspace_members?${new URLSearchParams({
    select: "workspace_key,user_id,role,state,foundation_workspaces(display_name)",
    user_id: `eq.${user.id}`,
    state: "eq.active",
    order: "workspace_key.asc",
    limit: String(LIST_LIMIT + 1),
  })}`);
  if (!memberRows) return reply({ code: "WORKSPACE_MEMBERSHIP_READ_FAILED" }, 503);
  const memberships: Array<Omit<MyWorkspace, "planLabel" | "acting">> = [];
  for (const value of memberRows.slice(0, LIST_LIMIT)) {
    const row = record(value);
    const workspace = record(row?.foundation_workspaces);
    const key = row?.workspace_key;
    const name = workspace?.display_name;
    if (!row || typeof key !== "string" || !WORKSPACE_KEY.test(key)
      || typeof row.user_id !== "string" || row.user_id.toLowerCase() !== user.id.toLowerCase()
      || row.state !== "active" || !ROLES.has(row.role as string)
      || (name !== undefined && name !== null && typeof name !== "string")) {
      return reply({ code: "WORKSPACE_MEMBERSHIP_STORE_INVALID" }, 503);
    }
    memberships.push({ workspaceKey: key, role: row.role as MyWorkspace["role"], workspaceName: typeof name === "string" ? name : null });
  }

  const plans = new Map<string, string | null>();
  if (memberships.length > 0) {
    const billingRows = await read(`/rest/v1/foundation_billing_accounts?${new URLSearchParams({
      select: "workspace_key,access_plan,plan_code,subscription_status",
      workspace_key: `in.(${memberships.map((item) => item.workspaceKey).join(",")})`,
    })}`);
    if (!billingRows) return reply({ code: "BILLING_ACCOUNT_READ_FAILED" }, 503);
    for (const value of billingRows) {
      const row = record(value);
      const key = row?.workspace_key;
      if (!row || typeof key !== "string" || !memberships.some((item) => item.workspaceKey === key)) {
        return reply({ code: "BILLING_ACCOUNT_STORE_INVALID" }, 503);
      }
      // One paying account per workspace (WO-C-T2). Two is an integrity failure, not a label to pick.
      if (plans.has(key)) return reply({ code: "BILLING_ACCOUNT_STORE_INVALID" }, 503);
      const code = typeof row.plan_code === "string" ? row.plan_code : row.access_plan;
      const offer = typeof code === "string" && Object.hasOwn(BILLING_OFFERS, code)
        ? BILLING_OFFERS[code as keyof typeof BILLING_OFFERS] : null;
      const live = row.subscription_status === "active" || row.subscription_status === "trialing";
      plans.set(key, live && offer ? offer.label : null);
    }
  }

  const workspaces: MyWorkspace[] = memberships.map((item) => ({
    ...item,
    planLabel: plans.get(item.workspaceKey) ?? null,
    acting: item.workspaceKey === acting.membership.workspaceId,
  }));
  return reply({
    code: "OK",
    actingWorkspaceKey: acting.membership.workspaceId,
    workspaces,
    truncated: memberRows.length > LIST_LIMIT,
  });
}

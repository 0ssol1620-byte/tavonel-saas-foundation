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
  /**
   * The name the workspace's owner gave at sign-up (Supabase Auth `full_name`), trimmed; null when
   * they gave none usable. Only the name: never the owner's user id, email or other metadata.
   */
  ownerDisplayName: string | null;
  /** The plan the workspace is on while it is active or trialing; null otherwise. */
  planLabel: string | null;
  acting: boolean;
};

async function readJson(path: string): Promise<unknown> {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  try {
    const response = await supabaseAdminRequest(config, path, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

async function read(path: string): Promise<unknown[] | null> {
  const rows = await readJson(path);
  return Array.isArray(rows) ? rows : null;
}

const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX = 120;

/**
 * A display name from a sign-up form is the user's own text. It is shown only when it is a string
 * of 1..120 characters after trimming with no control character -- the bound the workspace's own
 * name has (foundation_workspaces.display_name). Anything else is "no name", never a repaired one.
 */
function displayName(metadata: unknown): string | null {
  const raw = record(metadata)?.full_name;
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  const printable = [...name].every((char) => {
    const point = char.codePointAt(0)!;
    return point > 0x1f && (point < 0x7f || point > 0x9f);
  });
  return name.length >= 1 && name.length <= NAME_MAX && printable ? name : null;
}

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
  const memberships: Array<Omit<MyWorkspace, "ownerDisplayName" | "planLabel" | "acting">> = [];
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

  /*
    The owner of each listed workspace: its one active owner row (a unique index keeps it one), then
    that user's sign-up name from Supabase Auth. A workspace with no owner row or two, a malformed
    row, or an owner Auth cannot answer for, fails the request -- a switcher that shows a shared
    workspace without its owner would read as "nobody's".
  */
  const owners = new Map<string, string>();
  const names = new Map<string, string | null>();
  if (memberships.length > 0) {
    const ownerRows = await read(`/rest/v1/foundation_workspace_members?${new URLSearchParams({
      select: "workspace_key,user_id",
      workspace_key: `in.(${memberships.map((item) => item.workspaceKey).join(",")})`,
      role: "eq.owner",
      state: "eq.active",
    })}`);
    if (!ownerRows) return reply({ code: "WORKSPACE_MEMBERSHIP_READ_FAILED" }, 503);
    for (const value of ownerRows) {
      const row = record(value);
      const key = row?.workspace_key;
      if (!row || typeof key !== "string" || !memberships.some((item) => item.workspaceKey === key) || owners.has(key)
        || typeof row.user_id !== "string" || !USER_ID.test(row.user_id)) {
        return reply({ code: "WORKSPACE_MEMBERSHIP_STORE_INVALID" }, 503);
      }
      owners.set(key, row.user_id.toLowerCase());
    }
    if (owners.size !== memberships.length) return reply({ code: "WORKSPACE_MEMBERSHIP_STORE_INVALID" }, 503);
    // ponytail: one Auth read per distinct owner (at most LIST_LIMIT); a batched admin read if lists grow.
    const ownerIds = [...new Set(owners.values())];
    const users = await Promise.all(ownerIds.map((id) => readJson(`/auth/v1/admin/users/${id}`)));
    for (const [index, id] of ownerIds.entries()) {
      const user = record(users[index]);
      if (!user) return reply({ code: "WORKSPACE_MEMBERSHIP_READ_FAILED" }, 503);
      if (typeof user.id !== "string" || user.id.toLowerCase() !== id) return reply({ code: "WORKSPACE_MEMBERSHIP_STORE_INVALID" }, 503);
      names.set(id, displayName(user.user_metadata));
    }
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
    ownerDisplayName: names.get(owners.get(item.workspaceKey)!) ?? null,
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

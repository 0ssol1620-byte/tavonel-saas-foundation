import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFoundationBillingAccount } from "./billing-store";
import { authorizeFoundationProduct } from "./billing-product-access";
import { authorizeFoundationSessionProduct } from "./self-service-trial";

/*
  WO-C-T2: a member's work draws on the workspace's plan -- the owner's grant and the workspace's
  billing account -- never the member's own. Every module on the path is real (account-grants,
  billing-store, workspace-membership, billing-product-access, self-service-trial, supabase-admin);
  only `fetch` is replaced, by a PostgREST that filters these tables the way the queries ask.
*/

const OWNER = "0a0a0a0a-0000-4000-8000-00000000000a";
const MEMBER = "0b0b0b0b-0000-4000-8000-00000000000b";
const THIRD = "0c0c0c0c-0000-4000-8000-00000000000c";
const WS = "pilot-0a0a0a0a00004000"; // foundationWorkspaceId(OWNER)
const MEMBER_OWN_WS = "pilot-0b0b0b0b00004000";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let failing = new Set<string>();
let requests: string[] = [];

const memberRow = (userId: string, role: string, state = "active") => ({
  workspace_key: WS, user_id: userId, role, state, accepted_at: "2026-11-20T00:00:00Z",
  revoked_at: state === "revoked" ? "2026-11-21T00:00:00Z" : null, authorization_revision: 1,
});
const account = (userId: string, plan: "observer_access" | "studio_access", extra: Row = {}) => ({
  workspace_key: WS, user_id: userId, access_plan: plan, plan_code: null, subscription_status: "active",
  credit_balance: 100, lifetime_credits_purchased: 100, lifetime_credits_reversed: 0, overage_enabled: false,
  overage_units: 0, billing_hold: false, paddle_customer_id: null, paddle_subscription_id: null,
  subscription_cancel_at: null, updated_at: null, ...extra,
});
const grant = (userId: string, plan: "observer_access" | "studio_access" = "studio_access") => ({
  user_id: userId, grant_kind: "owner", access_plan: plan, billing_exempt: true, trial_exempt: true, active: true,
});

function postgrest(input: string) {
  const url = new URL(input);
  const table = url.pathname.replace("/rest/v1/", "");
  requests.push(`${table}?${url.searchParams.toString()}`);
  if (failing.has(table)) return new Response("{}", { status: 500 });
  if (table === "broken_json") return new Response("not json", { status: 200 });
  let rows = [...(tables[table] ?? [])];
  for (const [key, value] of url.searchParams) {
    if (["select", "limit", "order"].includes(key)) continue;
    if (!value.startsWith("eq.")) throw new Error(`unexpected filter ${key}=${value}`);
    rows = rows.filter((row) => String(row[key]) === value.slice(3));
  }
  const limit = Number(url.searchParams.get("limit") ?? rows.length);
  return new Response(JSON.stringify(rows.slice(0, limit)), { status: 200 });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://store.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
  tables = { foundation_workspace_members: [memberRow(OWNER, "owner"), memberRow(MEMBER, "member")] };
  failing = new Set();
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => postgrest(input)));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const tablesRead = () => requests.map((request) => request.split("?")[0]);

describe("an owner in their own workspace reads exactly what it read before", () => {
  it("one grant read and one account read keyed on the owner, and no membership read", async () => {
    tables.foundation_billing_accounts = [account(OWNER, "studio_access")];
    expect(await authorizeFoundationProduct(WS, OWNER, "studio")).toEqual({ ok: true, source: "paid", billingExempt: false });
    expect(requests).toEqual([
      `foundation_account_access_grants?select=user_id%2Cgrant_kind%2Caccess_plan%2Cbilling_exempt%2Ctrial_exempt%2Cactive&user_id=eq.${OWNER}&active=eq.true&limit=1`,
      expect.stringMatching(new RegExp(`^foundation_billing_accounts\\?select=.*&workspace_key=eq\\.${WS}&user_id=eq\\.${OWNER}&limit=1$`)),
    ]);
  });

  it("no account is still the empty plan, with no membership read", async () => {
    expect(await authorizeFoundationProduct(WS, OWNER, "observer")).toEqual({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
    expect(tablesRead()).toEqual(["foundation_account_access_grants", "foundation_billing_accounts"]);
  });

  it("an owner grant answers alone", async () => {
    tables.foundation_account_access_grants = [grant(OWNER)];
    expect(await authorizeFoundationProduct(WS, OWNER, "studio")).toEqual({ ok: true, source: "owner", billingExempt: true });
    expect(tablesRead()).toEqual(["foundation_account_access_grants"]);
  });
});

describe("a member draws on the workspace's plan", () => {
  it("the owner's Team account admits the member, and the account names the owner as payer", async () => {
    tables.foundation_billing_accounts = [account(OWNER, "studio_access")];
    const read = await getFoundationBillingAccount(WS, MEMBER);
    expect(read).toMatchObject({ ok: true, account: { workspaceKey: WS, userId: OWNER, accessPlan: "studio_access", creditBalance: 100 } });
    expect(await authorizeFoundationProduct(WS, MEMBER, "studio")).toEqual({ ok: true, source: "paid", billingExempt: false });
    expect(await authorizeFoundationSessionProduct(WS, MEMBER, "connections"))
      .toMatchObject({ ok: true, access: { source: "paid", accessPlan: "studio_access" } });
  });

  it("the owner's operator grant covers the member, with no billing account at all", async () => {
    tables.foundation_account_access_grants = [grant(OWNER)];
    expect(await authorizeFoundationProduct(WS, MEMBER, "studio")).toEqual({ ok: true, source: "owner", billingExempt: true });
    expect(await authorizeFoundationSessionProduct(WS, MEMBER, "observer"))
      .toMatchObject({ ok: true, access: { source: "owner", billingExempt: true } });
  });

  it("the plan still decides by role: a member does not activate on a Developer plan", async () => {
    tables.foundation_billing_accounts = [account(OWNER, "observer_access")];
    expect(await authorizeFoundationProduct(WS, MEMBER, "activation", "member"))
      .toEqual({ ok: false, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 });
  });

  it("a held workspace holds its members too", async () => {
    tables.foundation_billing_accounts = [account(OWNER, "studio_access", { billing_hold: true })];
    expect(await authorizeFoundationProduct(WS, MEMBER, "observer")).toEqual({ ok: false, code: "BILLING_HOLD", status: 402 });
  });

  it("the member's own operator grant does not carry into a workspace whose plan is the owner's", async () => {
    tables.foundation_account_access_grants = [grant(MEMBER)];
    expect(await authorizeFoundationProduct(WS, MEMBER, "observer")).toEqual({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
    // ...and in their own workspace it still answers alone.
    requests = [];
    expect(await authorizeFoundationProduct(MEMBER_OWN_WS, MEMBER, "studio")).toEqual({ ok: true, source: "owner", billingExempt: true });
    expect(tablesRead()).toEqual(["foundation_account_access_grants"]);
  });

  it("the member's own paid account elsewhere does not admit them here", async () => {
    tables.foundation_billing_accounts = [{ ...account(MEMBER, "studio_access"), workspace_key: MEMBER_OWN_WS }];
    expect(await authorizeFoundationProduct(WS, MEMBER, "observer")).toEqual({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
  });

  it("never draws on the owner's free evaluation, and never reads it", async () => {
    tables.foundation_self_service_trials = [{
      user_id: OWNER, workspace_key: WS, status: "trialing", started_at: "2026-11-20T00:00:00Z",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), ended_reason: null,
    }];
    expect(await authorizeFoundationSessionProduct(WS, OWNER, "observer")).toMatchObject({ ok: true, access: { source: "trial" } });
    requests = [];
    expect(await authorizeFoundationSessionProduct(WS, MEMBER, "observer"))
      .toEqual({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
    expect(tablesRead()).not.toContain("foundation_self_service_trials");
  });
});

describe("anyone without an active admin or member row gets the empty plan it always got", () => {
  it.each([
    ["a revoked member", () => { tables.foundation_workspace_members[1] = memberRow(MEMBER, "member", "revoked"); }],
    ["a stranger", () => { tables.foundation_workspace_members = [memberRow(OWNER, "owner")]; }],
  ])("%s is refused and never reads the workspace's account", async (_label, arrange) => {
    arrange();
    tables.foundation_billing_accounts = [account(OWNER, "studio_access")];
    expect(await authorizeFoundationProduct(WS, MEMBER, "observer")).toEqual({ ok: false, code: "SUBSCRIPTION_REQUIRED", status: 402 });
    expect(requests.filter((request) => request.startsWith("foundation_billing_accounts?"))
      .every((request) => request.includes(`user_id=eq.${MEMBER}`))).toBe(true);
  });
});

describe("the payer is the account's holder, as foundation_workspace_capped_plan reads it", () => {
  it("an account held by someone other than the owner: its holder pays, and its holder's grant decides", async () => {
    tables.foundation_billing_accounts = [account(THIRD, "observer_access")];
    expect(await getFoundationBillingAccount(WS, MEMBER)).toMatchObject({ ok: true, account: { userId: THIRD } });
    expect(await authorizeFoundationProduct(WS, MEMBER, "studio")).toEqual({ ok: false, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 });
    // An operator grant on the OWNER does not uncap an account somebody else holds (CAT-D13).
    tables.foundation_account_access_grants = [grant(OWNER)];
    expect(await authorizeFoundationProduct(WS, MEMBER, "studio")).toEqual({ ok: false, code: "STUDIO_SUBSCRIPTION_REQUIRED", status: 402 });
    tables.foundation_account_access_grants = [grant(THIRD)];
    expect(await authorizeFoundationProduct(WS, MEMBER, "studio")).toEqual({ ok: true, source: "owner", billingExempt: true });
  });
});

describe("an ambiguous payer is an integrity failure, never an empty plan", () => {
  it.each([
    ["two accounts for one workspace", () => { tables.foundation_billing_accounts = [account(OWNER, "studio_access"), account(THIRD, "studio_access")]; }, "BILLING_ACCOUNT_INTEGRITY_FAILED"],
    ["an account row with no usable holder", () => { tables.foundation_billing_accounts = [account("not-a-uuid", "studio_access")]; }, "BILLING_ACCOUNT_INTEGRITY_FAILED"],
    ["no account and no active owner", () => { tables.foundation_workspace_members = [memberRow(MEMBER, "member")]; }, "BILLING_ACCOUNT_PAYER_UNRESOLVED"],
    ["no account and two active owners", () => { tables.foundation_workspace_members.push(memberRow(THIRD, "owner")); }, "BILLING_ACCOUNT_PAYER_UNRESOLVED"],
    ["the membership store down", () => { failing.add("foundation_workspace_members"); }, "WORKSPACE_MEMBERSHIP_READ_FAILED"],
    ["the account store down for the workspace read", () => {
      tables.foundation_billing_accounts = [];
      vi.stubGlobal("fetch", vi.fn(async (input: string) =>
        input.includes("foundation_billing_accounts") && !input.includes("user_id=") ? new Response("{}", { status: 500 }) : postgrest(input)));
    }, "BILLING_STORE_READ_FAILED"],
  ])("%s", async (_label, arrange, code) => {
    arrange();
    expect(await authorizeFoundationProduct(WS, MEMBER, "observer")).toEqual({ ok: false, code, status: 503 });
    expect(await authorizeFoundationSessionProduct(WS, MEMBER, "observer")).toEqual({ ok: false, code, status: 503 });
  });

  it("the owner's grant store down", async () => {
    tables.foundation_billing_accounts = [account(OWNER, "studio_access")];
    let grantReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      // The member's own grant read answers; the payer's (the second) fails.
      if (input.includes("foundation_account_access_grants") && ++grantReads === 2) return new Response("{}", { status: 500 });
      return postgrest(input);
    }));
    expect(await authorizeFoundationProduct(WS, MEMBER, "observer"))
      .toEqual({ ok: false, code: "ACCOUNT_GRANT_STORE_READ_FAILED", status: 503 });
  });
});

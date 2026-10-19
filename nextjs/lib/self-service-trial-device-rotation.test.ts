import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./account-grants", () => ({
  getFoundationAccountGrant: vi.fn(async () => ({ ok: true, grant: null })),
  getFoundationSelfServiceTrial: vi.fn(async () => ({ ok: true, trial: null })),
}));
vi.mock("./billing-store", () => ({ getFoundationBillingAccount: vi.fn(async () => ({ ok: true, account: {} })) }));
vi.mock("./billing-product-access", () => ({
  billingProductDecision: () => ({ ok: false, code: "PAID_ACCESS_REQUIRED", status: 402 }),
}));
vi.mock("./foundation-pilot", () => ({ readAccessMode: () => "self_service" }));
// No store: the bootstrap stops right after the device token is resolved, which is all this checks.
vi.mock("./supabase-admin", () => ({ readSupabaseAdminConfig: () => null, supabaseAdminRequest: vi.fn() }));

import { bootstrapFoundationSelfServiceTrial } from "./self-service-trial";

/*
  Journey map A6 / D-06: the trial device token is the fourth use of FOUNDATION_BILLING_HMAC. A token
  signed under the replaced key keeps its device id while that key is configured as
  FOUNDATION_BILLING_HMAC_PREVIOUS, and is re-signed with the current key. Nothing signs with the
  previous key, and without it the behaviour is the pre-A6 one: a fresh device id.
*/
const OLD = "billing-old-secret-that-is-at-least-32-characters";
const CURRENT = "billing-new-secret-that-is-at-least-32-characters";
const DEVICE = "0123456789abcdef0123456789abcdef";
const user = { id: "969dc192-daa2-4119-969d-c192daa24119", app_metadata: { provider: "google" } };

function token(key: string, id = DEVICE) {
  return `v1.${id}.${createHmac("sha256", key).update(`tavonel-trial-device-token/v1\0${id}`, "utf8").digest("hex")}`;
}

async function bootstrap(cookie: string) {
  return bootstrapFoundationSelfServiceTrial(
    new Request("https://tavonel.com/api/access/bootstrap", { headers: { cookie: `tvnl_device=${cookie}` } }),
    user,
    "pilot-969dc192daa24119",
  );
}

function issued(result: Awaited<ReturnType<typeof bootstrap>>) {
  return /^tvnl_device=([^;]+);/.exec(result.setCookie ?? "")?.[1] ?? null;
}

describe("trial device token across a billing key rotation", () => {
  beforeEach(() => {
    vi.stubEnv("FOUNDATION_BILLING_HMAC", CURRENT);
    vi.stubEnv("FOUNDATION_BILLING_HMAC_PREVIOUS", "");
  });

  it("keeps a current-key token as it is", async () => {
    const result = await bootstrap(token(CURRENT));
    expect(result).toMatchObject({ ok: false, code: "TRIAL_STORE_NOT_CONFIGURED" });
    expect(result.setCookie).toBeUndefined();
  });

  it("replaces a replaced-key token with a fresh device id while no previous key is configured", async () => {
    const replacement = issued(await bootstrap(token(OLD)));
    expect(replacement).not.toBeNull();
    const [, id] = replacement!.split(".");
    expect(id).not.toBe(DEVICE);
    expect(replacement).toBe(token(CURRENT, id));
  });

  it("re-signs the same device id with the current key while the replaced key is configured as previous", async () => {
    vi.stubEnv("FOUNDATION_BILLING_HMAC_PREVIOUS", OLD);
    const replacement = issued(await bootstrap(token(OLD)));
    expect(replacement).toBe(token(CURRENT, DEVICE));
    expect(replacement).not.toBe(token(OLD, DEVICE));
  });

  it("does not keep a token no configured key signed, and never runs on the previous key alone", async () => {
    vi.stubEnv("FOUNDATION_BILLING_HMAC_PREVIOUS", OLD);
    const replacement = issued(await bootstrap(token("unrelated-secret-that-is-at-least-32-characters")));
    expect(replacement?.split(".")[1]).not.toBe(DEVICE);

    vi.stubEnv("FOUNDATION_BILLING_HMAC", "");
    const refused = await bootstrap(token(OLD));
    expect(refused).toEqual({ ok: false, code: "TRIAL_RISK_GATE_NOT_CONFIGURED", status: 503 });
  });
});

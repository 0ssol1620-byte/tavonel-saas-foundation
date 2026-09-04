import { afterEach, describe, expect, it, vi } from "vitest";
import { assessTrialSourceReuse } from "./trial-source-risk";

const input = {
  workspaceKey: "pilot-4444444444444444",
  userId: "44444444-4444-4444-8444-444444444444",
  documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  bytes: Buffer.from("same trial source bytes", "utf8"),
};

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
  vi.stubEnv("FOUNDATION_BILLING_HMAC", "b".repeat(64));
}

describe("trial source reuse assessment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends only a keyed digest to the database", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "allow",
      idempotentReplay: false,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(assessTrialSourceReuse(input)).resolves.toEqual({
      ok: true,
      status: "allow",
      idempotentReplay: false,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body.p_content_hmac).toMatch(/^hmac256:[a-f0-9]{64}$/);
    expect(String(init.body)).not.toContain(input.bytes.toString("utf8"));
  });

  it("turns a cross-account duplicate decision into a fail-closed review", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "denied",
      code: "TRIAL_SOURCE_REVIEW_REQUIRED",
    }), { status: 200 })));
    await expect(assessTrialSourceReuse(input)).resolves.toEqual({
      ok: false,
      code: "TRIAL_SOURCE_REVIEW_REQUIRED",
    });
  });

  it("does not silently skip the gate when its secret is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"s".repeat(31)}`);
    vi.stubEnv("FOUNDATION_BILLING_HMAC", "");
    await expect(assessTrialSourceReuse(input)).resolves.toEqual({
      ok: false,
      code: "TRIAL_SOURCE_RISK_NOT_CONFIGURED",
    });
  });
});

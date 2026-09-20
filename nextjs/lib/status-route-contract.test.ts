import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as legacyStatus } from "../app/api/status/route";
import { GET as publicStatusV2 } from "../app/api/status/v2/route";
import { parsePublicStatusV2 } from "./public-status-contract";

afterEach(() => vi.unstubAllEnvs());

describe("status API compatibility", () => {
  it("keeps the legacy route available during the v2 migration", async () => {
    const response = legacyStatus();
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.mode).toBe("foundation");
    expect(body).toHaveProperty("activationPolicy");
    expect(body).toHaveProperty("auth");
  });

  it("serves the separate public v2 contract without legacy operator fields", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://tenant.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
    const response = publicStatusV2();
    const raw: unknown = await response.json();
    const body = parsePublicStatusV2(raw);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toBeNull();
    expect(body?.availableActions.signIn.enabled).toBe(true);
    expect(raw).not.toHaveProperty("activationPolicy");
    expect(raw).not.toHaveProperty("auth");
    expect(raw).not.toHaveProperty("billing");
    expect(raw).not.toHaveProperty("r2");
    expect(raw).not.toHaveProperty("coreV2");
  });
});

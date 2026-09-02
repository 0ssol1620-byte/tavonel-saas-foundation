import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient, client } = vi.hoisted(() => ({
  createClient: vi.fn(),
  client: { auth: { getSession: vi.fn() } },
}));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

describe("Supabase browser client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    createClient.mockReset();
    createClient.mockReturnValue(client);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-anon-key");
  });

  it("reuses one GoTrue client across polling and interactive calls", async () => {
    const { getSupabaseBrowserClient } = await import("./supabase-browser");

    expect(getSupabaseBrowserClient()).toBe(client);
    expect(getSupabaseBrowserClient()).toBe(client);
    expect(getSupabaseBrowserClient()).toBe(client);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("fails closed without caching an invalid configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://fixture.supabase.co");
    const { getSupabaseBrowserClient } = await import("./supabase-browser");

    expect(getSupabaseBrowserClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});


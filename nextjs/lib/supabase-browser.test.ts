import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: { auth: {} },
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

describe("Supabase browser client", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createClient.mockReset();
    mocks.createClient.mockReturnValue(mocks.client);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("reuses one GoTrue client throughout the browser module", async () => {
    const { getSupabaseBrowserClient } = await import("./supabase-browser");

    expect(getSupabaseBrowserClient()).toBe(mocks.client);
    expect(getSupabaseBrowserClient()).toBe(mocks.client);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });

  it("fails closed and caches the result for a non-HTTPS endpoint", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://example.supabase.co";
    const { getSupabaseBrowserClient } = await import("./supabase-browser");

    expect(getSupabaseBrowserClient()).toBeNull();
    expect(getSupabaseBrowserClient()).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

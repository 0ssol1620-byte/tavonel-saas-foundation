import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseAdminRequest } from "./supabase-admin";

describe("Supabase admin REST authentication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends opaque secret keys only through apikey", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    const key = `sb_secret_${"s".repeat(31)}`;

    await supabaseAdminRequest({ url: "https://project.supabase.co", serviceRoleKey: key }, "/rest/v1/table");

    expect(fetchMock).toHaveBeenCalledWith("https://project.supabase.co/rest/v1/table", expect.any(Object));
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("apikey")).toBe(key);
    expect(headers.has("authorization")).toBe(false);
  });

  it("keeps bearer authorization for legacy service-role JWTs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    const key = `eyJ${"j".repeat(48)}`;

    await supabaseAdminRequest({ url: "https://project.supabase.co", serviceRoleKey: key }, "/rest/v1/table");

    expect(fetchMock).toHaveBeenCalledWith("https://project.supabase.co/rest/v1/table", expect.any(Object));
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("apikey")).toBe(key);
    expect(headers.get("authorization")).toBe(`Bearer ${key}`);
  });
});

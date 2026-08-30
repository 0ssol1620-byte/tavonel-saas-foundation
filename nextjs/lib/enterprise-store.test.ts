import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnterpriseAccess } from "./enterprise-store";

const organizationId = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
const userId = "49d42924-a3cc-4a09-b92d-9c86b58901a1";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("enterprise access store", () => {
  it("queries the organization explicitly so PostgREST foreign-key ambiguity cannot block access", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://enterprise-test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"x".repeat(40)}`;
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("enterprise_workspaces")) return Response.json([{ workspace_key: "pilot-1234567890abcdef", display_name: "TAVONEL", organization_id: organizationId }]);
      if (url.includes("enterprise_organizations?")) return Response.json([{ name: "TAVONEL", status: "active" }]);
      if (url.includes("enterprise_organization_memberships")) return Response.json([{ role: "owner" }]);
      if (url.includes("enterprise_workspace_memberships")) return Response.json([{ role: "owner" }]);
      return Response.json([], { status: 404 });
    }));

    await expect(getEnterpriseAccess("pilot-1234567890abcdef", userId)).resolves.toMatchObject({
      ok: true,
      principal: { organizationName: "TAVONEL", organizationRole: "owner", workspaceRole: "owner" },
    });
    expect(urls.find((url) => url.includes("enterprise_workspaces"))).not.toContain("enterprise_organizations%28");
    expect(urls.some((url) => url.includes(`enterprise_organizations?select=name%2Cstatus&organization_id=eq.${organizationId}`))).toBe(true);
  });
});

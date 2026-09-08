import { describe, expect, it } from "vitest";
import { MARKETING_EVENTS, publicPageLocation, readConsent, referralOrigin } from "./marketing-analytics";

describe("public marketing analytics boundary", () => {
  it("refuses private, unknown and user-supplied URLs", () => {
    for (const path of ["/workspace", "/workspace/sources", "/auth/callback", "/login", "/api/contact", "/docs/private-id", "/?email=person@example.com", "https://other.example/"]) expect(publicPageLocation(path)).toBeNull();
    expect(publicPageLocation("/pricing")).toBe("https://tavonel.com/pricing");
  });
  it("retains referral origins, never paths, search terms or tokens", () => {
    expect(referralOrigin("https://example.com/private/file?q=secret#token")).toBe("https://example.com");
    expect(referralOrigin("javascript:secret")).toBe("");
    expect(referralOrigin("")).toBe("");
  });
  it("fails closed on absent, invalid, expired or unavailable consent", () => {
    for (const value of [null, "broken", '{}', '{"allowed":true,"expires":1}']) expect(readConsent({ getItem: () => value }, 2)).toBeNull();
    expect(readConsent({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
    expect(readConsent({ getItem: () => '{"allowed":false,"expires":10}' }, 2)).toBe(false);
    expect(readConsent({ getItem: () => '{"allowed":true,"expires":10}' }, 2)).toBe(true);
  });
  it("does not forward workspace, questions or arbitrary custom events", () => {
    for (const name of ["workspace_first_ask", "workspace_world_activated", "explore_ask_used", "user_email", "sign_up", "purchase"]) expect(MARKETING_EVENTS.has(name)).toBe(false);
  });
});

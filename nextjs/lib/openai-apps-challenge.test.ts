import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/.well-known/openai-apps-challenge/route";

/* WO-MCP-LISTING-2: /.well-known/openai-apps-challenge serves the env token, or nothing. */
afterEach(() => vi.unstubAllEnvs());

describe("/.well-known/openai-apps-challenge", () => {
  it("is a 404 with an empty body when the variable is unset, blank or not one printable token", async () => {
    for (const value of [undefined, "", "   ", "two words", "line\nbreak", "x".repeat(513), "tokén"]) {
      vi.stubEnv("TAVONEL_OPENAI_APPS_CHALLENGE", value);
      const response = GET();
      expect(response.status, JSON.stringify(value)).toBe(404);
      expect(await response.text(), JSON.stringify(value)).toBe("");
    }
  });

  it("serves exactly the configured token as plain text, uncached", async () => {
    vi.stubEnv("TAVONEL_OPENAI_APPS_CHALLENGE", "  oa-challenge_Token.123=  ");
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("oa-challenge_Token.123=");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

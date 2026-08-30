import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(resolve(import.meta.dirname, "../next.config.mjs"), "utf8");

describe("production security headers", () => {
  it("locks framing, objects, transport, and browser capabilities", () => {
    expect(config).toContain('key: "Content-Security-Policy"');
    expect(config).toContain("frame-ancestors 'none'");
    expect(config).toContain("object-src 'none'");
    expect(config).toContain('key: "Strict-Transport-Security"');
    expect(config).toContain('key: "Permissions-Policy"');
  });

  it("permits only the product dependencies needed by browser auth, billing, and direct intake", () => {
    expect(config).toContain("https://*.supabase.co");
    expect(config).toContain("https://*.paddle.com");
    expect(config).toContain("https://*.r2.cloudflarestorage.com");
    expect(config).toContain("connect-src 'self'");
  });

  it("pins every versioned API response to the v1 response contract", () => {
    expect(config).toContain('source: "/api/v1/:path*"');
    expect(config).toContain('{ key: "X-TAVONEL-API-Version", value: "1" }');
    expect(config).toContain('{ key: "Vary", value: "Accept" }');
  });
});

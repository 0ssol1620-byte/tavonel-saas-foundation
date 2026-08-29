import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(resolve(process.cwd(), "next.config.mjs"), "utf8");

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
});

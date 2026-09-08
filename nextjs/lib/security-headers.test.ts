import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(resolve(import.meta.dirname, "../next.config.mjs"), "utf8");

describe("production security headers", () => {
  it("locks framing, objects, transport, and browser capabilities", () => {
    expect(config).toContain('key: "Content-Security-Policy"');
    expect(config).toContain("frame-ancestors 'none'");
    expect(config).toContain("object-src 'none'");
    expect(config).toContain('localHttpPlaywright ? null : "upgrade-insecure-requests"');
    expect(config).toContain('key: "Strict-Transport-Security"');
    expect(config).toContain('key: "Permissions-Policy"');
  });

  it("permits only the product dependencies needed by browser auth, billing, and direct intake", () => {
    expect(config).toContain("https://*.supabase.co");
    expect(config).toContain("https://*.paddle.com");
    expect(config).toContain("https://*.r2.cloudflarestorage.com");
    expect(config).toContain("connect-src 'self'");
  });

  /*
    §41 adds a *second*, strict CSP in Report-Only. This is the guard that says the enforced one
    did not move while that happened: the whole point of a report-only phase is that nothing a
    visitor loads today changes. Written as the literal expected string rather than a set of
    `toContain` checks, because a directive silently dropped from the middle of the enforced
    policy is exactly the failure a substring test cannot see.
  */
  it("pins the enforced policy including the specific consent-based analytics hosts", async () => {
    const { default: nextConfig } = await import("../next.config.mjs");
    const headers = await nextConfig.headers!();
    const catchAll = headers.find((entry) => entry.source === "/(.*)")!;
    const enforced = catchAll.headers.find((header) => header.key === "Content-Security-Policy")!;
    const policy =
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
      "form-action 'self'; script-src 'self' 'unsafe-inline' https://cdn.paddle.com https://*.paddle.com https://www.googletagmanager.com; " +
      "style-src 'self' 'unsafe-inline'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; " +
      "img-src 'self' data: blob:; font-src 'self' data:; " +
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.paddle.com https://*.r2.cloudflarestorage.com https://www.google-analytics.com https://region1.google-analytics.com; " +
      "frame-src 'self' https://*.paddle.com https://*.r2.cloudflarestorage.com; " +
      "worker-src 'self' blob:; manifest-src 'self'";
    // The one directive the config itself makes conditional, and the Playwright web server
    // builds with that variable set. Both spellings are pinned; neither is a wildcard.
    expect(enforced.value).toBe(
      process.env.PLAYWRIGHT_LOCAL_HTTP === "1" ? policy : `${policy}; upgrade-insecure-requests`,
    );
    expect(
      catchAll.headers.some((header) => header.key === "Content-Security-Policy-Report-Only"),
      "the report-only policy is minted per request in middleware, never as a static header",
    ).toBe(false);
  });

  /*
    §41 P-08, stated as an invariant rather than as a position in the byte-identity string above.

    The point of the split is that a `<style>` element and a `style="..."` attribute stop sharing
    one permission. Two ways to lose that silently: dropping `style-src-elem` back to
    `'unsafe-inline'` to make something render, or dropping `style-src-attr` and breaking the 39
    attribute uses in `app` and `components`. Both are one word, and both pass a `toContain`
    check on `style-src`.
  */
  it("keeps style elements and style attributes on separate permissions", async () => {
    const { default: nextConfig } = await import("../next.config.mjs");
    const enforced = (await nextConfig.headers!()).find((entry) => entry.source === "/(.*)")!.headers.find((header) => header.key === "Content-Security-Policy")!.value;
    expect(enforced, "a <style> element is attacker-authored CSS; 'self' is the point").toContain("style-src-elem 'self'");
    expect(enforced.match(/style-src-elem [^;]*/)?.[0], "style-src-elem admitted inline CSS again").not.toContain("'unsafe-inline'");
    expect(enforced, "React renders style attributes; blocking them breaks the product, not an attack").toContain("style-src-attr 'unsafe-inline'");
  });

  it("pins every versioned API response to the v1 response contract", () => {
    expect(config).toContain('source: "/api/v1/:path*"');
    expect(config).toContain('{ key: "X-TAVONEL-API-Version", value: "1" }');
    expect(config).toContain('{ key: "Vary", value: "Accept" }');
  });
});

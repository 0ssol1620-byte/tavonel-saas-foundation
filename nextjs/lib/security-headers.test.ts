import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cspEnforcedWithNonce,
  cspNonceEnforcedPath,
  cspNonceScriptSrc,
  readCspNonceEnforcement,
} from "./csp-policy";
import { cspReportOnly, generateCspNonce } from "./csp-report-only";

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

  /*
    S10 §41 Phase 4, as a policy that can be built and compared before anything is promoted.

    The enforced header that ships is still the static string pinned above, and the assertions
    here are about the nonce policy `lib/csp-policy.ts` produces: that it is strict where it has
    to be, unchanged everywhere else, and that it cannot be switched on by accident.
  */
  describe("the nonce policy that would replace 'unsafe-inline'", () => {
    const nonce = generateCspNonce();
    const policy = () => {
      const built = cspEnforcedWithNonce(nonce);
      if (!built.ok) throw new Error(built.code);
      return built.policy;
    };
    const directives = (value: string) =>
      new Map(value.split("; ").map((directive) => [directive.split(" ")[0]!, directive]));

    it("keeps Paddle checkout and the consent script loadable", () => {
      const scriptSrc = directives(policy()).get("script-src")!;
      // `'strict-dynamic'` is what keeps both working: paddle.js and gtag.js are inserted by
      // bundled scripts with createElement, so they inherit trust instead of needing a nonce.
      expect(scriptSrc).toContain("'strict-dynamic'");
      // And the hosts stay, because a browser without 'strict-dynamic' has nothing else.
      expect(scriptSrc).toContain("https://cdn.paddle.com");
      expect(scriptSrc).toContain("https://*.paddle.com");
      expect(scriptSrc).toContain("https://www.googletagmanager.com");
      expect(scriptSrc).not.toContain("'unsafe-inline'");

      const all = directives(policy());
      // Checkout is an overlay iframe on a Paddle origin, and it posts to Paddle.
      expect(all.get("frame-src")).toContain("https://*.paddle.com");
      expect(all.get("connect-src")).toContain("https://*.paddle.com");
      // GA4 only loads after consent, and only reaches its own collectors.
      expect(all.get("connect-src")).toContain("https://www.google-analytics.com");
      expect(all.get("connect-src")).toContain("https://region1.google-analytics.com");
    });

    it("enforces exactly the script-src that Report-Only has been measuring", async () => {
      // A policy promoted from a different string than the one observed proves nothing about
      // what the observation window found.
      expect(directives(policy()).get("script-src")).toBe(cspNonceScriptSrc(nonce));
      expect(directives(cspReportOnly(nonce)).get("script-src")).toBe(cspNonceScriptSrc(nonce));
    });

    it("changes nothing but script-src against the policy in force today", async () => {
      const { default: nextConfig } = await import("../next.config.mjs");
      const enforced = directives(
        (await nextConfig.headers!())
          .find((entry) => entry.source === "/(.*)")!
          .headers.find((header) => header.key === "Content-Security-Policy")!.value,
      );
      const candidate = directives(policy());
      for (const [name, directive] of enforced) {
        if (name === "script-src") continue;
        // One directive moves. Anything else moving with it would make a regression
        // unattributable to the change that caused it.
        expect(candidate.get(name), `${name} drifted`).toBe(directive);
      }
      // An enforced policy still reports, or the day it starts refusing is the day the reports
      // stop arriving.
      expect(candidate.get("report-uri")).toBe("report-uri /api/csp-report");
      expect(candidate.get("report-to")).toBe("report-to csp-endpoint");
    });

    it("refuses to build a policy from a nonce it cannot use", () => {
      // `'nonce-'` with nothing after it blocks every script on the page. A named refusal that
      // leaves the static policy standing is the smaller failure.
      for (const bad of ["", "short", "not a nonce", "!!!!!!!!!!!!!!!!!!!!!!!!"]) {
        expect(cspEnforcedWithNonce(bad)).toEqual({ ok: false, code: "CSP_NONCE_INVALID" });
      }
      expect(cspEnforcedWithNonce(generateCspNonce())).toMatchObject({ ok: true });
    });

    it("is off unless the switch is exactly on, and covers only the authenticated surface", () => {
      expect(readCspNonceEnforcement({})).toBe(false);
      for (const value of ["", "0", "true", "yes", "ON"]) {
        expect(readCspNonceEnforcement({ TAVONEL_CSP_ENFORCE_NONCE: value })).toBe(false);
      }
      expect(readCspNonceEnforcement({ TAVONEL_CSP_ENFORCE_NONCE: "1" })).toBe(true);

      // The scope is the ƒ column of `next build`, not a guess about which pages feel dynamic.
      expect(cspNonceEnforcedPath("/workspace/sources")).toBe(true);
      expect(cspNonceEnforcedPath("/workspace/collections/abc")).toBe(true);
      /*
        The two exclusions that keep the flag from blanking a page. `next build` (2026-09-11)
        prerenders /workspace and /workspace/admin -- 27 inline scripts, zero nonce attributes --
        so an enforced nonce policy there refuses the framework's own bootstrap. They come back
        into scope only when they are dynamically rendered.
      */
      expect(cspNonceEnforcedPath("/workspace")).toBe(false);
      expect(cspNonceEnforcedPath("/workspace/admin")).toBe(false);
      // A whole segment, so /workspaceblog cannot inherit the workspace's policy.
      expect(cspNonceEnforcedPath("/workspaceblog")).toBe(false);
      for (const path of ["/", "/pricing", "/status", "/login"]) {
        expect(cspNonceEnforcedPath(path)).toBe(false);
      }
    });

    it("leaves the shipped Report-Only header minted per request, unchanged", () => {
      const middleware = readFileSync(resolve(import.meta.dirname, "../middleware.ts"), "utf8");
      expect(middleware).toContain('response.headers.set("Content-Security-Policy-Report-Only", cspReportOnly(generateCspNonce()));');
    });
  });

  it("pins every versioned API response to the v1 response contract", () => {
    expect(config).toContain('source: "/api/v1/:path*"');
    expect(config).toContain('{ key: "X-TAVONEL-API-Version", value: "1" }');
    expect(config).toContain('{ key: "Vary", value: "Accept" }');
  });
});

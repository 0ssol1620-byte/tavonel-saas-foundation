import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const localHttpPlaywright = process.env.PLAYWRIGHT_LOCAL_HTTP === "1";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.paddle.com https://*.paddle.com",
  /*
    §41 P-08. `'unsafe-inline'` on styles was covering two very different things, and only one of
    them is used.

    A `<style>` element executes attacker-authored CSS -- selector-driven exfiltration, an
    injected overlay over a real control. A `style="..."` attribute on an element React already
    decided to render is a far narrower thing. Splitting the directive keeps the second and drops
    the first, and it costs nothing here: the 27 prerendered pages of a production build contain
    **zero** `<style>` elements and 13 style attributes, and `app` + `components` contain zero
    `<style>` in source against 39 attribute uses. next/font emits a `<link rel="stylesheet">`,
    not the inline block an earlier note in `lib/csp-report-only.ts` assumed.

    `style-src` stays, and stays permissive, as the fallback for a browser too old to know the
    two narrower directives -- which is also the only browser that reaches the one runtime
    `<style>` injection in the bundle: pdf.js falls back to appending a `<style>` element for
    embedded font faces when `adoptedStyleSheets` is missing. Firefox 75-100 and Safari 15.4-16.3
    understand `style-src-elem` and lack `adoptedStyleSheets`, so on those the evidence viewer
    renders its PDF text in fallback fonts. That is the whole measured cost.
  */
  "style-src 'self' 'unsafe-inline'",
  "style-src-elem 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.paddle.com https://*.r2.cloudflarestorage.com",
  "frame-src 'self' https://*.paddle.com https://*.r2.cloudflarestorage.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  // Production and HTTPS Preview must upgrade insecure subresources. The built-in Playwright
  // server is intentionally plain HTTP, though, and WebKit applies this directive to localhost
  // itself, turning same-origin CSS/JS requests into HTTPS requests for a port with no TLS
  // listener. Omit only in that explicit local test-server process; production never sets it.
  localHttpPlaywright ? null : "upgrade-insecure-requests",
].filter(Boolean).join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  outputFileTracingRoot: packageRoot,
  async headers() {
    return [
      {
        source: "/api/v1/:path*",
        headers: [
          { key: "X-TAVONEL-API-Version", value: "1" },
          { key: "Vary", value: "Accept" },
        ],
      },
      /*
        The compile cuts are immutable content served on a mutable path.

        Vercel's default for anything under /public is `max-age=0, must-revalidate`, so every
        visit re-fetched several megabytes of film that had not changed — a returning visitor
        paid the same wait as a first-time one. These files are only ever replaced by a
        redeploy, which changes the deployment and therefore the edge cache, so a year of
        immutable caching is safe and is the difference between "loads again" and "already
        there".
      */
      {
        source: "/film/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      { source: "/(.*)", headers: securityHeaders },
    ];
  },
};
export default nextConfig;

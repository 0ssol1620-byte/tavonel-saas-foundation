import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.paddle.com https://*.paddle.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.paddle.com https://*.r2.cloudflarestorage.com",
  "frame-src 'self' https://*.paddle.com https://*.r2.cloudflarestorage.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

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

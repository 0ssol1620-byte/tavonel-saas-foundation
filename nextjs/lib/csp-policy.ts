/*
  S10 §41 Phase 3-4 — what it would actually take to drop `'unsafe-inline'`, and the parts of it
  that can be built without touching what is enforced today.

  The state this starts from, verified rather than assumed (live GET of https://tavonel.com/,
  2026-09-11): two CSP headers are sent at once. The enforced one carries
  `script-src 'self' 'unsafe-inline' https://cdn.paddle.com https://*.paddle.com
  https://www.googletagmanager.com`. The Report-Only one carries the strict form,
  `'nonce-<random>' 'strict-dynamic'` with the same hosts, and reports to /api/csp-report. That is
  a staged rollout working as designed, not a vulnerability -- and it is Phase 1-2 of four.

  This file is Phase 3's answer and Phase 4's mechanism, minus the two lines that have to be
  written in files this lane does not own. Nothing here changes a header that ships today: the
  enforced policy is still the static string in `next.config.mjs`, pinned byte-for-byte by
  `security-headers.test.ts`, and the Report-Only policy is still `cspReportOnly` unchanged.

  ---------------------------------------------------------------------------
  1. The first-party inline script inventory
  ---------------------------------------------------------------------------

  Written by us, and both are data blocks rather than executable script:

    app/layout.tsx                  <script type="application/ld+json"> Organization + SoftwareApplication
    components/breadcrumb-json-ld.tsx  <script type="application/ld+json"> BreadcrumbList

  Written by the framework, and this is the half that decides the schedule: Next.js emits its own
  inline `<script>` elements in every document -- the bootstrap and the RSC flight payload pushes
  (`self.__next_f.push(...)`). They are inline, they are numerous, and they are not optional.

  Third-party origins, all loaded as `<script src>` from bundled code, never inline:

    https://cdn.paddle.com/paddle/v2/paddle.js   created by lib/paddle-browser.ts
    https://www.googletagmanager.com/gtag/js     created by components/marketing-consent.tsx,
                                                 only after an explicit visitor choice

  Both survive a nonce policy without being nonced, because `'strict-dynamic'` extends trust to
  scripts that a trusted script inserts with `document.createElement("script")` -- which is
  exactly how both of them are loaded. The Paddle and Google hosts stay in the directive anyway,
  for browsers that do not implement `'strict-dynamic'`, where the host allowlist is the whole
  policy. This is why `cspNonceScriptSrc` keeps them: dropping them would break checkout on an
  older browser to tidy up a directive.

  ---------------------------------------------------------------------------
  2. Why Phase 4 is not a config flip, stated as a measurement
  ---------------------------------------------------------------------------

  A nonce is per response, and a statically prerendered page has no response to mint one into.
  That is the whole of Phase 4's cost, and the two halves of it were measured rather than assumed
  (`next dev`, port 3210, 2026-09-11; then `next build`):

  Measured, and better than the earlier note in `csp-report-only.ts` feared: the nonce already
  reaches the framework's own inline scripts on a dynamically rendered page. Next 15 reads it from
  `headers['content-security-policy'] || headers['content-security-policy-report-only']`
  (`next/dist/server/app-render/app-render.js`), and the Report-Only header `middleware.ts` sets
  is enough -- a request to `/` returned 29 inline `<script>` elements and 30 `nonce="..."`
  attributes, every one of them carrying the same nonce as the Report-Only header on that
  response. So no nonce plumbing has to be written for the framework, and the Report-Only reports
  arriving today are NOT dominated by our own bootstrap.

  Measured, and still the blocker: a page served from the build's prerendered HTML has no nonce at
  all. `next build` produced 27 prerendered documents; every one of them contains inline
  `<script>` elements (26 and 27 on /security and /workspace) and **zero** `nonce=` attributes.
  An enforced nonce policy on any of those pages blocks the framework's own bootstrap, which is a
  blank page rather than a degraded one.

  So the line that decides Phase 4's scope is not "first-party or third-party", and not
  "authenticated or public". It is exactly the ƒ/○ column of `next build`:

    ƒ served per request, nonce present    /pricing /refunds /status /terms
                                           /workspace/[surface] /workspace/[surface]/[detail]
                                           /reproducibility/sample /reproducibility/sample-world
    ○ prerendered, no nonce                the other 27 documents, INCLUDING /workspace and
                                           /workspace/admin -- `/workspace` is a "use client"
                                           page with no dynamic export, so it is prerendered to
                                           a shell

  `cspNonceEnforcedPath` below encodes that column, which is why it covers the workspace's
  `/workspace/<surface>` routes and deliberately excludes `/workspace` itself and
  `/workspace/admin`. That coupling is fragile on purpose rather than by accident: a commit that
  adds or removes a `force-dynamic` export changes which pages may carry the policy, and the
  predicate has to be re-derived from a build when it does.

  ---------------------------------------------------------------------------
  3. Reading the report-only violations that exist now
  ---------------------------------------------------------------------------

  /api/csp-report has no storage. It writes one sanitized line per violation to stderr --
  `{"event":"csp_violation","documentPath":...,"directive":...,"blockedSource":...,"disposition":...}`
  -- deliberately: `summarizeCspReport` drops `script-sample`, query strings and everything of
  `blocked-uri` past its origin, because on a workspace page those carry customer text and tokens.
  So the reports live in the deployment's runtime logs and nowhere else. To read them:

    vercel logs <deployment-url> --json | jq -r 'select(.message | contains("csp_violation"))'

  or the Vercel dashboard's runtime-log search for `csp_violation`. Bucket by `directive` and
  `blockedSource`; `blockedSource: "inline"` with `directive: "script-src-elem"` is the framework
  bootstrap described above, and anything else is a real finding.

  A retention warning that belongs with the instructions: runtime logs are short-lived, so
  "violations over the trailing N days" is only answerable for as long as the log window. A real
  observation window needs a log drain or a table, and that is a founder decision about cost, not
  something this file can arrange.

  One thing the measurement above settles about this data: on a dynamically rendered page the
  framework's inline scripts already carry the nonce, so a `blockedSource: "inline"` row from one
  of those pages is a real finding and not our own bootstrap. On a prerendered page every inline
  script violates, so those rows say nothing except "this page is prerendered". Bucket by
  `documentPath` before drawing any conclusion.

  ---------------------------------------------------------------------------
  4. The promotion steps, exactly
  ---------------------------------------------------------------------------

  1. Wire the flag in `middleware.ts`. Two lines, and they are in the lane report because this
     lane does not own that file: mint the nonce once, and when `readCspNonceEnforcement()` and
     `cspNonceEnforcedPath(request.nextUrl.pathname)` are both true, also set
     `Content-Security-Policy` from `cspEnforcedWithNonce(nonce)` on the response. A refusal from
     that builder means no header is set and the static policy stands; log the code.
  2. Read the logs as in section 3, bucketed by `documentPath`. On the ƒ routes from section 2,
     every remaining `inline` row is a real finding: fix it or allowlist it deliberately. Do not
     count rows from prerendered pages: they are the rendering mode, not a defect.
  3. Set `TAVONEL_CSP_ENFORCE_NONCE=1` on Preview only. Then, with devtools open:
       - complete a Paddle checkout,
       - complete a Google OAuth sign-in,
       - open a document in the evidence viewer on a `/workspace/<surface>` route.
     A blocked inline script does not always look broken, so read the console for CSP refusals as
     well as the assertions. `e2e/` is lane L8's; the checkout and OAuth specs are the ones to run.
  4. Only then set it in Production. The rollback is unsetting one variable, and it takes effect
     on the next request rather than the next deploy.
  5. To widen the scope past `/workspace/<surface>`, a page has to be dynamically rendered first.
     That is one export per route and it belongs to whoever owns the route; adding paths to
     `cspNonceEnforcedPath` without doing it blocks every inline script on those pages. Re-derive
     the list from `next build` output, never from a guess about which pages "feel" dynamic.
  6. `security-headers.test.ts` keeps pinning the static enforced policy byte-for-byte. That
     string does not change in any of these steps; the flag adds a per-response header on the
     routes it covers and leaves the static one for everything else.

  Not done, and not pretended: nothing here is wired into `middleware.ts`, nothing has been
  promoted, no observation window has been read, and `'unsafe-inline'` is still in the enforced
  policy on every page of the deployment.
*/
import { CSP_REPORT_PATH } from "./csp-report-only";

/** A base64 nonce of at least 128 bits, which is what `generateCspNonce` produces. */
const NONCE = /^[A-Za-z0-9+/]{22,}={0,2}$/;

/** The env switch. Off unless it is exactly "1": a typo must not enable an enforced policy. */
export function readCspNonceEnforcement(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.TAVONEL_CSP_ENFORCE_NONCE === "1";
}

/**
 * Where an enforced nonce policy may be sent.
 *
 * The workspace surface routes, and only those. Two reasons, and the second is the one that
 * decides it: they render the customer's own documents, so an injection there is the one that
 * matters -- and `next build` serves them per request, so the response carries a nonce the
 * framework's inline scripts already use. Anything prerendered has no nonce and would be blocked.
 *
 * The two exclusions are not oversights. `/workspace` and `/workspace/admin` are prerendered
 * (section 2 of the file header), so they keep the static enforced policy from `next.config.mjs`
 * until someone makes them dynamic.
 */
export const CSP_NONCE_ENFORCED_PREFIX = "/workspace/" as const;

/** Prerendered today, therefore nonce-free, therefore never given a nonce policy. */
const CSP_NONCE_EXCLUDED = new Set(["/workspace", "/workspace/admin"]);

export function cspNonceEnforcedPath(pathname: string): boolean {
  if (CSP_NONCE_EXCLUDED.has(pathname)) return false;
  // A full segment, so `/workspaceblog` cannot inherit the workspace's policy.
  return pathname.startsWith(CSP_NONCE_ENFORCED_PREFIX) && pathname.length > CSP_NONCE_ENFORCED_PREFIX.length;
}

/**
 * The script-src of the strict policy.
 *
 * Identical to the one `cspReportOnly` measures with, which is the point -- the policy that gets
 * enforced has to be the policy that was observed, or the observation proved nothing about it.
 * `security-headers.test.ts` asserts the two stay equal.
 */
export function cspNonceScriptSrc(nonce: string): string {
  return `script-src 'nonce-${nonce}' 'strict-dynamic' https://cdn.paddle.com https://*.paddle.com https://www.googletagmanager.com`;
}

/**
 * The enforced policy for one response, or a named refusal.
 *
 * Fails closed on a bad nonce rather than emitting `'nonce-'` with nothing after it, which would
 * be a policy that blocks every script on the page. A caller that gets a refusal must send no
 * header at all and let the static enforced policy stand: a weaker policy for one response is a
 * smaller problem than a blank page, and the refusal is returned so it can be logged rather than
 * swallowed.
 */
export function cspEnforcedWithNonce(nonce: string): { ok: true; policy: string } | { ok: false; code: string } {
  if (!NONCE.test(nonce)) return { ok: false, code: "CSP_NONCE_INVALID" };
  return {
    ok: true,
    policy: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      cspNonceScriptSrc(nonce),
      // Unchanged from the enforced policy: §41 P-08 already split element from attribute here,
      // and this change is about script-src. Moving both at once would make a regression
      // unattributable.
      "style-src 'self' 'unsafe-inline'",
      "style-src-elem 'self'",
      "style-src-attr 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.paddle.com https://*.r2.cloudflarestorage.com https://www.google-analytics.com https://region1.google-analytics.com",
      // Paddle's checkout overlay is an iframe; R2 is the evidence viewer's source.
      "frame-src 'self' https://*.paddle.com https://*.r2.cloudflarestorage.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
      // An enforced policy reports too. Without this, the moment it starts refusing things is
      // the moment the reports stop.
      `report-uri ${CSP_REPORT_PATH}`,
      "report-to csp-endpoint",
    ].join("; "),
  };
}

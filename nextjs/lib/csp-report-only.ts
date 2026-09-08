/*
  §41 Phase 1–2: the strict CSP, measured before it is enforced.

  The enforced policy in `next.config.mjs` carries `'unsafe-inline'` on script-src, which is the
  one directive that decides whether CSP contains an XSS at all. It cannot simply be dropped:
  nobody knows yet which inline scripts this deployment actually emits, and a strict policy that
  breaks Paddle checkout costs more than the injection it prevents.

  So this is the measurement, not the fix. Every response carries a second, strict policy in
  `Report-Only`, and the browser reports what that policy *would* have blocked to
  `/api/csp-report` without refusing anything. Phase 3 reads those reports; Phase 4 promotes the
  policy to enforced. Nothing here changes what is enforced today, and `security-headers.test.ts`
  holds the enforced header byte-for-byte so that stays true.

  Two deliberate narrowings:

  - script-src only. `style-src 'unsafe-inline'` matches the enforced policy, because next/font
    and Next's own style injection emit inline <style> on every page and a strict style-src would
    bury the script findings under thousands of style reports. Styles are a separate phase.
  - The nonce is not yet handed to first-party scripts. Reading `headers()` in the root layout to
    stamp a nonce onto the JSON-LD block would opt every page out of static rendering, and Phase 1
    is supposed to find out what is inline, not pay for the fix before the answer is in. The
    report for this lane lists the inline sources by hand; the nonce here is what makes the
    report-only policy strict enough for those reports to be produced at all.
*/

export const CSP_REPORT_PATH = "/api/csp-report";

/** One fresh nonce per response. 128 bits, which is the CSP spec's own floor. */
export function generateCspNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The strict policy, in Report-Only. Same allowlists as the enforced policy — Paddle, Supabase,
 * R2 — with `'unsafe-inline'` on script-src replaced by a nonce plus `'strict-dynamic'`.
 *
 * `'strict-dynamic'` makes a browser that understands it ignore the host allowlist on script-src
 * entirely and trust only what a nonced script loads. The Paddle hosts stay for browsers that do
 * not, where they are the whole policy.
 */
export function cspReportOnly(nonce: string) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' https://cdn.paddle.com https://*.paddle.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.paddle.com https://*.r2.cloudflarestorage.com",
    "frame-src 'self' https://*.paddle.com https://*.r2.cloudflarestorage.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Both, on purpose: `report-uri` is what Safari and older Chrome still send to, `report-to`
    // is what current Chrome sends to, and Phase 3 needs reports from every browser a buyer uses.
    `report-uri ${CSP_REPORT_PATH}`,
    "report-to csp-endpoint",
  ].join("; ");
}

/** Value of the `Reporting-Endpoints` header that names the group `report-to` refers to. */
export const CSP_REPORTING_ENDPOINTS = `csp-endpoint="${CSP_REPORT_PATH}"`;

export type CspViolation = {
  documentPath: string;
  directive: string;
  blockedSource: string;
  disposition: string;
};

/*
  A violation report is a document the browser composed about a page the reporter was looking at,
  so it is treated as hostile data and as personal data at once. Three fields are dropped rather
  than logged:

  - `script-sample`, because on an authenticated workspace page the 40 bytes it carries can be
    the customer's own document text.
  - the query string and fragment of `document-uri` and `referrer`, because a share link or an
    auth callback puts a token there. Only the path survives.
  - `blocked-uri` beyond its origin, for the same reason.

  What is left is the four fields Phase 3 actually reads: which page, which directive, which
  origin, and whether it was reported or enforced.
*/
function safeOrigin(value: unknown) {
  if (typeof value !== "string" || !value) return "unknown";
  // The CSP keywords a browser reports instead of a URL. They are the interesting ones.
  if (["inline", "eval", "wasm-eval", "self", "data", "blob", "about"].includes(value)) return value;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "unparseable";
  }
}

function safePath(value: unknown) {
  if (typeof value !== "string" || !value) return "unknown";
  try {
    return new URL(value).pathname;
  } catch {
    return "unparseable";
  }
}

/**
 * Reduce one report body — either the `application/csp-report` shape or the newer
 * `application/reports+json` one — to the four fields that may be logged. Returns null for
 * anything that is not a CSP violation report, so a stray POST is rejected rather than logged.
 */
export function summarizeCspReport(body: unknown): CspViolation | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const legacy = record["csp-report"];
  const report = (legacy && typeof legacy === "object" ? legacy : record) as Record<string, unknown>;
  const directive = report["effective-directive"] ?? report["violated-directive"] ?? report.effectiveDirective;
  if (typeof directive !== "string" || !directive) return null;
  return {
    documentPath: safePath(report["document-uri"] ?? report.documentURL),
    // A directive value is a token list; only the directive name is needed and the rest is policy
    // text the log does not need repeated on every row.
    directive: directive.split(/\s+/)[0]!,
    blockedSource: safeOrigin(report["blocked-uri"] ?? report.blockedURL),
    disposition: report.disposition === "enforce" ? "enforce" : "report",
  };
}

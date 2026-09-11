import { NextResponse } from "next/server";
import { CSP_REPORTING_ENDPOINTS, cspReportOnly, generateCspNonce } from "@/lib/csp-report-only";
import { cspEnforcedWithNonce, cspNonceEnforcedPath, readCspNonceEnforcement } from "@/lib/csp-policy";

/*
  The only reason this file exists: a nonce has to be minted per response, and `next.config.mjs`
  headers are static strings. Everything else about the enforced security headers stays there.

  See `lib/csp-report-only.ts` for why the strict policy is Report-Only and what it deliberately
  does not cover yet, and `lib/csp-policy.ts` for the promotion steps the flag below is step 1 of.

  One nonce per response, shared by both policies. A second mint for the enforced header would
  enforce a policy nobody observed, which is the one thing the Report-Only window exists to
  prevent (audit S10).
*/
export function middleware(request: Request & { nextUrl: URL }) {
  const nonce = generateCspNonce();
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy-Report-Only", cspReportOnly(nonce));
  response.headers.set("Reporting-Endpoints", CSP_REPORTING_ENDPOINTS);
  // Off unless TAVONEL_CSP_ENFORCE_NONCE=1, and then only on routes the build serves per
  // request. The variable is unset everywhere, so this is a no-op on every response today.
  if (readCspNonceEnforcement() && cspNonceEnforcedPath(request.nextUrl.pathname)) {
    const enforced = cspEnforcedWithNonce(nonce);
    // A refusal sets no header and leaves the static enforced policy standing: weaker for one
    // response, and not a blank page. Logged rather than swallowed.
    if (enforced.ok) response.headers.set("Content-Security-Policy", enforced.policy);
    else console.error(JSON.stringify({ event: "csp_nonce_refused", code: enforced.code }));
  }
  return response;
}

export const config = {
  /*
    Documents only. Build assets under `_next/static` are immutable and carry no inline script;
    running the nonce mint on each of them would spend edge time to learn nothing. `/api` is
    excluded for the same reason and one more: a JSON response has no scripts to report on, and
    the report collector itself must never be able to report on its own response.
  */
  matcher: ["/((?!_next/static|_next/image|api/|film/|fonts/|favicon.ico).*)"],
};

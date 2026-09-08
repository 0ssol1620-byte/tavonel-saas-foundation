import { NextResponse } from "next/server";
import { CSP_REPORTING_ENDPOINTS, cspReportOnly, generateCspNonce } from "@/lib/csp-report-only";

/*
  The only reason this file exists: a nonce has to be minted per response, and `next.config.mjs`
  headers are static strings. Everything else about the enforced security headers stays there.

  See `lib/csp-report-only.ts` for why the strict policy is Report-Only and what it deliberately
  does not cover yet.
*/
export function middleware() {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy-Report-Only", cspReportOnly(generateCspNonce()));
  response.headers.set("Reporting-Endpoints", CSP_REPORTING_ENDPOINTS);
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

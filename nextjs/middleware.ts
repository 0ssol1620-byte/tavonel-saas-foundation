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

  The matcher below stays wide even though only the workspace surfaces now receive a header. One
  predicate decides the scope, and it is `cspNonceEnforcedPath`; a matcher that had to agree with
  it would be a second copy of the same list, and the two would disagree the first time one of
  them was widened.
*/
export function middleware(request: Request & { nextUrl: URL }) {
  /*
    T1-004 -- the Report-Only policy goes exactly where it can be satisfied, and nowhere else.

    It used to go on every document. On a prerendered page that is a policy nothing can pass:
    the HTML was written at build time, it carries no nonce, and every one of the framework's
    ~26 inline `<script>` elements violates `script-src 'nonce-...'` on every single page view.
    Chrome logged it as a "serious" issue on all seven pages the 2026-09-15 audit opened, and the
    reports it produced said one thing over and over -- *this page is prerendered* -- while
    burying the rows that would have meant something.

    Deleting the header outright was the other option and it throws away a working measurement.
    `cspNonceEnforcedPath` is the answer instead, because it is already the set of routes the
    enforced policy may ever be sent to (`lib/csp-policy.ts` §2, derived from the ƒ column of
    `next build`). Observing exactly where you would enforce is the whole point of a report-only
    window; observing where you never will is what produced the noise.

    What this gives up, stated rather than glossed: the public dynamic routes -- `/`, `/pricing`,
    `/status`, `/terms`, `/refunds` -- no longer report. Next stamps its nonce on their inline
    scripts, so the policy passed there, and a passing check on a route that will not be promoted
    is not information. It comes back the moment `cspNonceEnforcedPath` widens to include them,
    which is the same commit that would make promoting them possible.
  */
  const observed = cspNonceEnforcedPath(request.nextUrl.pathname);
  const response = NextResponse.next();
  if (!observed) return response;
  const nonce = generateCspNonce();
  response.headers.set("Content-Security-Policy-Report-Only", cspReportOnly(nonce));
  response.headers.set("Reporting-Endpoints", CSP_REPORTING_ENDPOINTS);
  // Off unless TAVONEL_CSP_ENFORCE_NONCE=1, and then only on routes the build serves per
  // request. The variable is unset everywhere, so this is a no-op on every response today.
  if (readCspNonceEnforcement()) {
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

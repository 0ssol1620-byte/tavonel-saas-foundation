# CDR workload identity candidate — 2026-09-10

Implemented server-side token exchange primitive in nextjs/lib/cdr-workload-identity.ts. It is not an HTTP route and has no current runtime caller. Caller must first authenticate Worker and obtain subject token only from Vercel runtime, never request header/body. Fixed STS and IAM endpoints, Foundation project317850201666/provider resource and Foundation service-account namespace checks, exact validation-service audience, no persistent/cache credentials,15second combined timeout,16KiB token-response ceiling, redirect refusal and redacted errors. Google STS/IAM, not local token decoding, supplies subject validation/authorization.

VERIFIED:16fixture tests cover request shape/audience, foreign project/account/injected resource rejection before network, malformed exchange/ID outputs, IAM401/403/500, redacted network exceptions and oversized stream cancellation. TypeScript/ESLint passed. Receipts .chatgpt2codex/cdr-identity-tests-final-0910.log and cdr-identity-check-final-0910.log. This checkout's Next.js dependencies installed from frozen lock; initial missing dependency failures retained. No dependency manifest changed.

NOT VERIFIED: actual Vercel runtime subject, live Google federation exchange, IAM grants, authenticated Worker broker request/replay/size controls, file forwarding and exact service qualification. No IAM changes, service-account keys, deployment, customer bytes or customer-data activation. The service audience is the existing private validation canary; naming it is not production promotion.

NEXT: bind an authenticated request handler to request-scoped getVercelOidcToken; provision tightly scoped issuer/audience/team/project/environment provider conditions and only required service-account impersonation/invoker authority; verify wrong identity denial and actual private-service health/clean/malicious file path before switching Worker. Preserve existing source/output digest binding, byte bounds, replay and receipt controls.

Official protocol references:
- https://vercel.com/docs/oidc/gcp
- https://vercel.com/docs/oidc/reference
- https://cloud.google.com/iam/docs/reference/sts/rest/v1/TopLevel/token
- https://cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateIdToken

## Broker request authorization — 2026-09-10
Added domain-separated HMAC verifier bound to POST, fixed identity route, fixed CDR audience, UUIDv4 request ID and60second past/future window. New service-only claim_cdr_identity_request RPC atomically serializes replay/rate accounting, allows60new requests per rolling minute and retains IDs3minutes (longer than the maximum accepted timestamp lifetime). No token/document data stored; table direct access revoked includingservice_role, RLS enabled; security-definer function has empty search_path and fully qualified objects. Missing RPC must fail closed when handler is wired.
Verified23unit tests incl exchange and request tampering/time/secret tests; strictTypeScript/ESLintPASS. Actual PostgreSQL17 isolated cdr_identity_0910 database applied migration and ran all SQL assertions: duplicate refusal,60limit/61refusal, expirationcleanup, serviceRPC grant, browserRPC denial, no direct service tableSELECT. Test transaction rolled back. pgTAP reporting wrappers added for SupabaseCI; local SQL assertion execution was before those wrappers. Full migration chain and concurrency test remain pending; no production DB application. OwnPG55441 stopped after test. Receipts .chatgpt2codex/cdr-identity-auth-tests-0910.log, cdr-identity-auth-check-0910.log, cdr-identity-db-0910.log.
HTTP route/runtime subject, Worker client, live WIF grants and realCDRpath still to connect. New migration20260909215500 is required before enabling broker. Last goal turn made implementation+actualDB progress; goal remainsACTIVE.

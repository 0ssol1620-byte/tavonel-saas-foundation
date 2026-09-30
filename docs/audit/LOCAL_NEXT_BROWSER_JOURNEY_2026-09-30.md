# Actual local Next browser downstream journey

This increment connects the previously qualified **real Python Core HTTP outputs, PostgreSQL 17, PostgREST 16.4 and SeaweedFS 4.48** to an actual Next development server and a separate headless Chromium context. It uses only fresh disposable local data and keys. Latest published Foundation `4b472a74` was merged into this isolated branch at `caa853d0`; selected-revision components were not edited.

## Boundary qualification

The browser visits the actual `/login` page and sends same-origin fetch requests with explicitly injected synthetic Bearer tokens. There is no actual Google/GoTrue login or authenticated UI click claim. A loopback HTTPS gateway implements only a **synthetic `/auth/v1/user` identity adapter**, verifying the supplied token against the actual PostgREST `/profiles` endpoint before returning a fixture user. It implements neither login nor refresh. Invalid signatures and expired tokens therefore receive actual PostgREST cryptographic refusals, which the unchanged Next authentication code translates to `AUTH_REQUIRED`.

REST operations proxy to real PostgREST and the fresh real database. Production R2 signatures proxy to real SeaweedFS; the signed logical R2 Host is restored when routing through the loopback transport gateway, while method, signature, body and object path remain unchanged. No service verdict, object response or database transaction is mocked. The same run produces both revision artifacts through the actual Core HTTP adapter before seeding their unchanged bytes into S3. Core execution occurs during fixture preparation, not from the browser's restore request.

A fresh RSA key and self-signed certificate are written only inside the disposable PostgreSQL test directory. The owned Next child trusts that PEM through `NODE_EXTRA_CA_CERTS`; no certificate is installed and no system trust/DNS/firewall setting is changed. Only the isolated browser context ignores fixture TLS errors. Browser outbound requests to non-loopback hosts are aborted. The gateway is bound to loopback. Next and its owned worker tree are stopped by exact child PID before gateway/storage/database cleanup. The Next development cache remains only in this task's isolated checkout.

## Actual browser assertions

- A trial-risk `tvnl_device` cookie supplies no authentication; a request without Bearer credentials receives 401.
- Wrong-signature and expired synthetic JWTs receive 401 through actual Next/provider-adapter/PostgREST calls.
- A valid token reads the actual SQL active pointer; the response has `Cache-Control: no-store`.
- Both exact manifests read their actual Core package bytes from S3 through Next, retaining the selected manifest and Core receipt output hash.
- A browser historical restore runs the actual Next rollback handler, retained-artifact/source checks, S3 reads and SQL transition RPC.
- One explicit local fault consumes the real successful restore response and disconnects the browser before delivery. The actual SQL pointer has already advanced once. Chromium may retry the reset connection automatically; when it does, the test requires that actual retry to return `replayed`. Subsequent explicit browser retries also receive the durable replay result without advancing the pointer again.
- An old expected publication revision is refused with 409 `ACTIVE_WORLD_CONFLICT`.
- After real membership revocation RPC, the same still-cryptographically-valid synthetic JWT is refused by the read route with 403 `WORKSPACE_MEMBERSHIP_REQUIRED` and cannot mutate history.

The fixture's original owner is made an admin while the existing admin becomes the sole owner in one local SQL transaction before the revocation test. This is synthetic fixture preparation, **not qualification of an ownership-transfer product API**; no such API was found. Database owner uniqueness remains intact.

## Reproduce with existing local tools

Use `nextjs/scripts/journey/local-postgres-journey.mjs` with the previously documented PostgreSQL, PostgREST and Core environment variables, plus:

```powershell
$env:TAVONEL_LOCAL_SEAWEED_EXE='C:\Users\yspow\Documents\Codex\2026-09-30\task-2\runtimes\seaweedfs-4.48\weed.exe'
$env:TAVONEL_LOCAL_POWERSHELL=(Get-Command pwsh).Source
$env:TAVONEL_LOCAL_NEXT_BROWSER='1'
node scripts/journey/local-postgres-journey.mjs
pnpm check
pnpm exec eslint --no-ignore scripts/journey/local-next-browser-journey.mjs scripts/journey/local-storage-journey.mjs scripts/journey/local-postgrest-journey.mjs scripts/journey/local-postgres-journey.mjs
```

The branch's frozen Next dependencies and installed Playwright Chromium are required. The opt-in fails when actual Core artifacts or the checksum-qualified S3 executable are missing; there is no fake service or production fallback. Existing CI can run this on a Windows worker with the qualified portable runtimes, PostgreSQL 17, PowerShell and Playwright installed. Non-Windows S3 binaries require separate checksum qualification rather than bypassing the runtime check.

## Remaining qualification

No GoTrue executable, Go compiler or Docker is installed; genuine provider execution requires a compatible GoTrue runtime, or separately approved build/container tooling and dependencies. No system runtime was installed. Actual provider session revocation/refresh, Google OAuth and interrupted sign-in remain unverified. The selected-revision **API** is exercised; selected-revision component interaction and a complete intake/compile/review/publish UI journey remain separate acceptance gates. Next is a development server, not an optimized production deployment. pgvector remains explicitly shimmed for migrations, so vector semantics are unverified. Local S3 is not production Cloudflare R2. The synthetic source fixtures do not qualify production connector-origin/CDR admission.

K07 gains actual browser restore/replay/stale-publication qualification. K09/K19/K21 gain actual Next/browser refusal after cryptographic JWT failure and database membership revocation. K04/K06 retain real Core qualification, with those exact outputs now read through the application. K10 and UX11–UX16 remain partial; no entire masterplan item or production readiness is inferred. The next bounded slice is actual hydrated workspace/callback UI with persisted synthetic Supabase session and sign-in interruption checks; genuine login retains the external runtime prerequisite above.

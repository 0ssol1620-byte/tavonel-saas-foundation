# Disposable real S3 storage qualification

This is a local synthetic storage boundary result, not a completed authenticated browser journey or production Cloudflare R2 qualification. The isolated Foundation branch is `codex/customer-journey-local`; integration reference `2f9024b9` was merged at `c7ed78ba0a407a3076d72f2c2c6c958c9a753ddd`. Previous tested commits are retained. No public UI or selected-revision components changed.

## Actual service and isolation

The harness starts the official SeaweedFS 4.48 Windows executable against a newly generated temporary directory. It accepts no service endpoint, existing data directory or external credentials. All nine selected listeners bind loopback. Two Go scheduler threads and one 16 MB volume bound local resource use; telemetry, administration UI, WebDAV, Iceberg and Lance listeners are disabled. Environment variables are allowlisted; storage keys are freshly generated per invocation and passed only to the owned child processes. The service is stopped before removing its generated directory, including on test failure. No user services, firewall, certificate stores, DNS, Git global settings or production configurations are changed.

Official download: [SeaweedFS 4.48 Windows release](https://github.com/seaweedfs/seaweedfs/releases/download/4.48/windows_amd64.zip).

- ZIP SHA-256: `fe90c04c0620ad1a1c756f86cd5e1443773f56a446688077a4bb5ec04c3cc874`.
- Executable SHA-256: `394a0154424f3d96f7969c044b77ee4cfb649299f8b42ecc7b703971872ce61d`; checked before execution.
- Existing permitted local runtime: `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\runtimes\seaweedfs-4.48\weed.exe`.

The unchanged production R2 client produces SigV4 requests with region `auto` and its usual R2 host. The test substitutes **transport destination only**, forwarding the original method, signed host, headers and body to the real loopback S3 service. No response, object bytes, signature verdict or storage operation is mocked. SeaweedFS is explicitly configured with that signed public host. This tests the production signer and storage protocol against actual S3-compatible service behavior, including conditional writes; it does not establish Cloudflare-specific compatibility, encryption, durability, capacity or operating guarantees. Tenant prefix admission is application validation, not separate tenant-scoped S3 IAM.

## Reproduce

From the isolated repository's `nextjs` directory, with its existing frozen dependencies:

```powershell
$env:TAVONEL_LOCAL_SEAWEED_EXE='C:\Users\yspow\Documents\Codex\2026-09-30\task-2\runtimes\seaweedfs-4.48\weed.exe'
node scripts/journey/local-storage-journey.mjs
pnpm check
pnpm exec eslint --no-ignore scripts/journey/local-storage-journey.mjs scripts/journey/local-storage.integration.test.ts
```

The runner executes one Vitest worker. Running the integration test directly without the owned service skips it; that skip is not qualifying evidence. A successful runner prints the actual Foundation commit and harness/runtime SHA-256 values. On this Windows sandbox, executable/network permissions require the authorized disposable-runtime tool escalation; ordinary restricted PG/runtime launches are not a fallback to live services.

## Verified behaviors

Six real-service tests cover unsigned bucket access denial; wrong PUT and GET signatures; first-write/read/list of candidate JSON; exact and conflicting replay returning `exists` without replacement; concurrent first writers with exactly one successful immutable write; separate revision objects retaining the older bytes; foreign workspace prefix denial in the production client; deletion yielding `NOT_FOUND` followed by explicit fixture restoration; and successful sanitized PDF digest verification followed by actual corrupted object bytes producing `SOURCE_DIGEST_MISMATCH`. These are storage assertions only. Deleting/restoring a synthetic object is not application publication revoke/restore or Auth session revocation.

## Auth and browser boundary assessment

No GoTrue executable, Go compiler or Docker runtime is available among existing tools. Smallest prerequisite for genuine local provider execution is a compatible GoTrue runtime executable, or an approved Go/container runtime with its build/runtime dependencies. Google OAuth would additionally require its separately configured provider; no external identity credentials were requested or invented.

Inspection confirms the current browser uses persisted Supabase sessions and sends Bearer tokens; `getRequestUser` calls the provider's `/auth/v1/user`. `tvnl_device` is a signed trial-risk cookie, not an authentication session. Consequently a fabricated cookie alone cannot prove authenticated access. A downstream Next test can still use an explicitly labelled synthetic `/auth/v1/user` adapter plus fixture sessions and the real PostgREST service, without claiming real login. It will need a per-process trusted loopback TLS endpoint because production Supabase URL validation requires HTTPS, an isolated Next build/server, browser local session seeding, and routing to this actual local S3 service. No production URL validator or frontend selected-revision component was relaxed here.

**Unverified in this increment:** actual Next HTTP/browser, interrupted sign-in, expired/revoked provider session, browser selected-revision and stale-publication acceptance; application admission/publication/revocation using this S3 service together with the previously qualified real Core/PostgREST/SQL boundaries; GoTrue, Cloudflare R2 and production source serving. JWT expiration, database membership revocation and cross-revision CAS retain their preceding real PostgREST/SQL qualification, not a new browser claim.

K04/K06/K07 retain earlier local Core/SQL qualification. K09/K19/K21 retain earlier JWT/RLS/membership qualification; application/provider acceptance remains partial. K10 and UX11–UX16 remain partial. This increment reduces the missing object-storage runtime boundary but completes no masterplan item. Next local critical path estimate: 1–2 working days for combined Next TLS/session/S3 browser integration, with low confidence; genuine GoTrue login additionally depends on the runtime/provider prerequisites above. This is not a whole-masterplan completion estimate.

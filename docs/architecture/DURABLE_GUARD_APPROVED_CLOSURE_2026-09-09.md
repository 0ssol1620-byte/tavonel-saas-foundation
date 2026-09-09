# Durable guards — approved continuation, 2026-09-09

Status: additional implementation and qualification; NOT a production migration receipt.

## Changes after the initial PR #43

- Recheck the real session/API key, effective membership and product access immediately before a successful Ask response, including a cached response. Rechecking does not consume a second API rate allowance. Clone the authorization principal rather than mutating the earlier decision.
- Cache at most 300 live keyed responses per workspace/scope. Reserve a running request's maximum ciphertext capacity before work begins. The total reservation/response ceiling is 16 MiB. Never evict a still-valid replay to admit a new key.
- Preserve a successfully committed replay when the completion RPC response is lost; cleanup may delete only a running row with the correct fencing token.
- An explicit operator SQL script installs one named, ownership-checked one-minute pg_cron job. The CI test proves a new successful job run actually removes an expired synthetic witness; merely seeing cron.job is not a pass. Installation is repeated to exercise idempotence.

## Evidence observed

- TypeScript plus six affected unit suites passed: 69 tests before the final two Ask-route regressions were added.
- Real isolated PostgreSQL 17.2 race suite: 17 checks passed. This includes 20 independent writers, exact Ask/export caps, same-key single-flight, foreign/expired token fencing, role privileges, contact sliding windows, 300-key bound, and atomic 16 MiB reservations.
- Node 22.23.2 portable runtime was downloaded from the official release and SHA256-verified. It does not change the system Node installation or shared dependencies.
- The broad local Node 22 suite did not produce a completed tool receipt within its execution bound. It is not claimed green. The exact committed SHA must pass the normal GitHub CI, including the new actual-scheduler test.

## Still a distinct release gate

Late session/key authorization does not magically add provider-source ACL capture or lifecycle enforcement. The current shared/aclSnapshot.ts and source-domain-store.ts explicitly document that source-specific permission snapshots are not fully consumed by the live retrieval path. The global customer-data gate must not be opened on the strength of this PR.

Before this application version is deployed, production needs migration 0055, verified backup/current-schema binding, actual maintenance execution evidence and an authenticated canary. This session does not have a successful approved Supabase management action; a denied tool call is not a migration. Do not deploy the database-dependent app first, weaken the database guard, or expose an ad-hoc privileged endpoint to get around that restriction.

No new Ask charging, pricing, contract terms, customer-data opening, source-quality claim or research-model promotion is introduced.

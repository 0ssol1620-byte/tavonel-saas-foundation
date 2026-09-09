# Durable operation guards — staged rollout, 2026-09-09

Status: implementation and isolated PostgreSQL rehearsal, NOT a production deployment or security qualification.

## Scope

Migration 0055 adds service-role-only, RLS-protected operation leases and contact sliding windows. Ask admits four and export two running operations per workspace across application instances. An idempotency key claims a running operation atomically, conflicts on a changed body, and replays a completed answer. Owner tokens fence expired workers. Ask cache identity includes the authenticated actor/key/scopes and current World identity; the active World is checked before replay and again before returning success.

Request keys and request bodies are represented only by domain-separated HMACs. Cached success responses are AES-256-GCM encrypted and authenticated against workspace/scope/key/body binding. Plaintext is bounded at 1 MB. No failed answer is stored as a successful replay. The current service-role key is used for domain-separated derivation; rotation deliberately invalidates earlier cache entries.

Contact uses the existing five-per-ten-minute limit on both IP and email domain, now in one atomic transaction. The request stream is capped at 16,384 bytes, independently of Content-Length. The existing trusted-proxy convention is retained; platform header replacement must still be verified at the edge. No real email was sent by tests.

Production cannot disable durable guards by omitting an opt-in: VERCEL_ENV=production requires the database guard. Database/migration/configuration failures refuse expensive work with 503 instead of falling back to per-process allowance. Local/preview tests retain bounded process-local state.

## Evidence produced in this execution

- PostgreSQL 17.2, a newly initialized disposable loopback-only cluster on port 55439.
- Migration applied, then applied again successfully.
- Twenty independent connections admit exactly four Ask and two export operations.
- Twelve simultaneous identical idempotency keys admit exactly one worker.
- Twenty contact requests admit five; changing only one dimension cannot reset allowance.
- Foreign/expired lease owners cannot release or overwrite a successor.
- Anonymous/authenticated database roles have no table read or RPC execute privilege.
- Fifteen real database checks passed in scripts/db/operation-guard-race.mjs.
- Sixty-seven targeted application tests passed, including the existing Ask/export/contact suites.
- TypeScript check passed.

The database race script is wired into DB rehearsal CI against its disposable local Supabase database. Its execution refuses non-loopback targets. No production database was contacted or modified.

## Required release sequence

1. Review this change independently, including cache authorization when connector/source permissions change without a World pointer change. Existing World Gate limitations are not solved by adding a cache.
2. Complete full-chain PostgreSQL 17 rehearsal and exact-SHA application/security CI. Migration 0055 is additive, must be re-runnable and must not break the old build.
3. Prove the production backup/restore posture and current migration state; apply the exact reviewed migration before deploying this application version.
4. Configure bounded periodic calls to prune_foundation_operations and prune_foundation_contact_limits, monitor backlog and set a measured replay-storage budget. Expired rows are logically ineligible immediately; physical deletion after ten minutes is NOT promised without a working cleanup job.
5. Exercise a scoped authenticated canary across multiple instances: 429 limits, 409 in-flight/conflict, successful replay, cancellation, backend timeout, database outage, key rotation and permission revocation. Include the ambiguous case where the database completed an RPC but the application lost its response.
6. Only then deploy this application version. A deploy before the migration would fail closed and disrupt Ask/export/contact.

## Boundaries

This change does not introduce Ask credit charging, modify plan terms, authorize customer-data processing, open a paid holdout, qualify OCR models, deploy PDFium, or establish full connector ACL lifecycle support. Global customer-data activation stays unchanged.

No independent reviewer was available in this execution: the runtime enforces zero additional model calls. A goal record is not an independent review receipt. This branch must not self-approve its production rollout.

## Local commands

From repository root, against a disposable PostgreSQL 17 cluster with the migration and test roles already applied:

```text
LOCAL_OPERATION_GUARD_TEST=1 PGPORT=<loopback port> node nextjs/scripts/db/operation-guard-race.mjs
```

Application tests:

```text
pnpm --dir nextjs exec vitest run lib/workspace-operation-guard.test.ts lib/contact-durable-guard.test.ts lib/ask-route-limits.test.ts lib/export-route-limits.test.ts lib/contact-route.test.ts lib/workspace-cost-guard.test.ts --maxWorkers=2 --minWorkers=1
```

All receipts and scratch logs from this execution are under D:\tvfix-0909\.chatgpt2codex. They are not an instruction to publish internal operational evidence.

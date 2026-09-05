# TAVONEL Foundation Security Boundaries

This project is a separate SaaS foundation. It must not modify, deploy to, or receive secrets from the existing `tavonel` production application or the isolated CDR activation repository.

## Explicitly inactive capabilities

The current application may demonstrate user experience and server-side contracts, but it must not accept customer document bytes, initiate R2 uploads, call AV/CDR/OCR/GPU providers, dispatch GPU work, or promote a candidate knowledge graph. Every external operation remains fail-closed until sandbox qualification and a separate contextual approval are complete.

## External integration principles

Supabase Auth, Paddle, Cloudflare R2, and any CDR credentials must be configured through managed server-side secrets only. Browser code may hold a provider-designated publishable token when appropriate, but never service-role keys, webhook secrets, R2 credentials, CDR material, or signing credentials. The server must derive tenant identity from an authenticated session and never from a browser-supplied workspace identifier alone.

## Direct-upload boundary

Document bytes belong only in a tenant-scoped quarantine object store. The browser receives a narrowly scoped, short-lived upload capability only after server-side authentication, entitlement, and quota checks. Postgres stores metadata and immutable proof references; it never stores document bytes. Vercel server handlers coordinate contracts and never proxy large document bodies.

## CDR bootstrap boundary

The CDR bootstrap is outside this project. The prepared source is the existing restricted Seoul Developer Connect link, fixed activation commit, and verified committed bootstrap configuration. A future triggerless one-off build creates a regional runtime secret only after an explicit final confirmation. This SaaS foundation does not submit that build, attach any secret, or activate any CDR caller.

## Current state (2026-09-06)

The "Explicitly inactive capabilities" section above is out of date and is kept for the record rather than rewritten. It says the application must not accept customer document bytes, initiate R2 uploads, or dispatch GPU work. Since 2026-08-29 `nextjs/lib/activation-policy.ts` — the live policy, read by `/api/status`, `/api/uploads/capability` and the OAuth sync route — has had `customerIntake`, `cdr` and `ocrGpu` enabled, each with a recorded reason. Candidate promotion remains closed and is still an explicit human decision.

What is still closed, and how: `activationPolicy.customerData.enabled` is `false`, and the compile envelope refuses `route.privacyPolicy === "approved_customer_data"` unless it is given an allowed `CustomerDataGateDecision` bound to the same tenant and workspace (`shared/customerDataGate.ts`). Independently of that, the live request builder `buildProductCoreV2Request` (`nextjs/lib/core-runtime-v2.ts:166`) writes `foundation_synthetic_only` as a literal that no caller can influence. Both are asserted by tests, in `server/foundation/customerDataGate.test.ts` and `nextjs/lib/customer-data-live-path.test.ts`.

The seventeen preconditions that gate customer data, their current EXISTS / PARTIAL / MISSING status with paths, the named security suite (`pnpm security:suite`, and the same script under `nextjs/`), and what that suite does and does not prove are in `docs/CUSTOMER_DATA_GATE_2026-09-06.md`.

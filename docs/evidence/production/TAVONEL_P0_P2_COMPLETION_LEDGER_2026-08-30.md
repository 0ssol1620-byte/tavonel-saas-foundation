# TAVONEL P0-P2 completion ledger

Recorded: 2026-08-30 KST

## Production release

- Release source: GitHub `main`; canonical production alias verified after each
  source-linked deployment
- Canonical URL: `https://tavonel.com`
- Vercel state: `READY`, production alias assigned
- Supabase migrations: `0013_connector_oauth.sql`,
  `0014_enterprise_control_plane.sql` and
  `0015_enterprise_pilot_bootstrap.sql` committed successfully in the
  production SQL editor
- The sole production owner was bound idempotently to an enterprise
  organization and workspace by the service-role-only bootstrap RPC; the
  bootstrap also created the default governance policy and immutable audit
  event
- Public readiness: `ready=true`; authentication, document pipeline and
  signed export are operational; billing remains `test_only`
- Anonymous enterprise and OAuth connector requests return `401`

## Verified implementation

### P0 operations

- Large-document admission and bounded split planning
- Full credit release for terminal failure and operator-review outcomes
- Deletion, restore, incident and cost-alert evidence contracts
- Four-eyes promotion and rollback gates; automatic candidate promotion remains
  disabled
- Production signed ZIP validation rejects content, manifest, inventory and
  signature tampering
- Legal, privacy, security and contact pages have one `h1`, ordered headings,
  and keyboard-focusable skip targets

### P1 developer and source surfaces

- Google Drive, Dropbox and Microsoft Graph OAuth PKCE contracts, managed-secret
  references, callbacks, inventory and revocation
- Atomic API-key rotation, rate/usage contract, audit API and OpenAPI v1
- CLI and MCP distribution version `2026.8.30.1`
- Clean-environment verification: isolated home, no inherited provider secrets,
  CLI and MCP version checks, Python source-agent syntax check
- Existing production evidence proves web upload, source-agent replay,
  API, CLI, MCP and signed-download full sequences. The temporary proof key was
  revoked and no plaintext key was retained.

### P2 enterprise control plane

- Organization and workspace RBAC with deny-by-default authorization
- SAML and SCIM configuration that cannot become active without provider
  verification
- Immutable audit events and JSONL/CSV export contracts
- Retention, legal hold, signed export, RTO/RPO, region and dedicated-deployment
  policies
- Usage, GPU cost, revenue and job-failure dashboard contracts
- SLA, DPA and security-questionnaire package templates

### Quality and runtime

- Unit and contract tests: `298/298`
- Full browser E2E: `159 passed`, `3 skipped`, `0 failed`
- Launch browser QA: Chromium, Firefox and WebKit
- Required widths: `1920, 1440, 1280, 1024, 768, 390, 360`, plus reduced
  motion
- Knowledge-quality evaluator: `13/13`
- Reference fixture acceptance report: `10/10` qualified
- Production RunPod evidence: real browser upload and source-agent documents
  produced immutable sanitized PDF and OCR JSON; the API/CLI/MCP collection and
  signed ZIP sequence passed
- Current single-run production Lighthouse evidence for the home route:
  performance `0.97`, LCP `2.36 s`, CLS `0.066`. The multi-category
  three-run local harness remains noisy and is not treated as a production
  pass.

## External gates not represented as complete

These items require an owner identity step, provider approval, paid-plan
purchase, legal review or a real customer/provider account. Code completion is
not evidence that these gates are complete.

| Gate | Current evidence | Required close condition |
|---|---|---|
| Korean business registration | HomeTax application received; receipt `119-2026-2-505445830804`; stated processing deadline 2026-09-01 | Registration issued and certificate downloaded |
| Business disclosure and mail-order filing | Waiting for registration number and live-sale decision | Publish required operator fields and file if legally required |
| Paddle account | Domain approved; identity review in progress; live setup not started | Owner completes identity check; Paddle approves live account |
| Paddle live lifecycle | Application remains sandbox/test-only | Live catalog, API key and webhook deployed; small charge, entitlement, refund and cancellation proven |
| Gmail Send-as | Incoming `hello@tavonel.com` and Resend domain work; Gmail alias is not configured | Owner completes Gmail/SMTP identity step and confirms personal address is hidden |
| RunPod MFA | Disabled | Owner enables MFA and stores recovery material |
| RunPod workload | Full sequences passed for bounded public documents | Fresh mixed, large customer-like corpus quality run after provider and retention gates |
| Supabase recovery | Free plan reports no backups | Upgrade/enable backups and complete restore drill |
| R2 retention/recovery | Incomplete multipart cleanup exists; no complete object-retention/restore drill | Apply approved lifecycle and prove restore without losing immutable evidence |
| Provider alerts | Cloudflare and RunPod alerts exist; Vercel explicit budget notification is not proven | Configure and receive a Vercel alert canary |
| OAuth provider apps | Contracts and production DB schema are live | Create Google, Dropbox and Entra apps/secrets and run real-account file collection |
| Enterprise identity/regions | Control plane is live and fail-closed | Connect real IdP, provision target regions/dedicated deployment and run tenant E2E |
| Security/compliance | Defensive controls and QA exist | Independent penetration test, legal review and chosen SOC 2/ISO program |
| GitHub protection | Private Free repository and billing state block required protections/CI | Resolve billing or plan, enable protections/scanning, then obtain green CI |

## Evidence references

- `docs/evidence/production/TAVONEL_PRODUCT_SURFACES_FULL_SEQUENCE_2026-08-30.json`
- `docs/evidence/ocr/FOUNDATION_GPU_OCR_FULL_SEQUENCE_2026-08-29.json`
- `docs/evidence/collections/FOUNDATION_KNOWLEDGE_PACKAGE_QA_2026-08-29.json`
- `docs/runbooks/P0_OPERATIONS.md`
- `docs/enterprise/README.md`

This ledger deliberately separates implementation, production proof, fixture
qualification and external provider gates. None of the external rows above is
claimed complete until its close condition is directly observed.

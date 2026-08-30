# TAVONEL Enterprise Foundation

Status: implementation contract, not a production certification.

This package defines the first enterprise control plane for organization and workspace access, identity-provider metadata, governance policy, immutable administration history, deployment placement and operating economics.

## Implemented boundary

- Organization and workspace RBAC with deny-by-default permission evaluation
- SAML and SCIM metadata contracts; activation requires an external secret reference, provider verification timestamp and runtime provider gate
- Append-only organization audit events and bounded JSONL/CSV export
- Retention, deleted-object grace, audit retention, legal hold, signed export, RTO/RPO, region and dedicated deployment policy
- Daily active users, document volume, GPU seconds/cost, revenue, credits and failure ledger contract
- Separate `/enterprise` control plane and tenant-scoped APIs

## Non-claims

This package does not claim that SAML, SCIM, regional routing, deletion automation, dedicated infrastructure, SLA service levels, DPA execution, penetration testing, SOC 2 or ISO 27001 are active. Those require the gates in `EXTERNAL_GATES.md`.

## API surface

- `GET /api/enterprise/overview`
- `GET|PUT /api/enterprise/identity`
- `GET|PUT /api/enterprise/policies`
- `GET /api/enterprise/audit/export?from=<ISO>&to=<ISO>&format=jsonl|csv`
- `GET /api/enterprise/dashboard?days=30`

Every route requires a valid Supabase user session, a pilot workspace binding, an active enterprise organization membership and the named role permission.

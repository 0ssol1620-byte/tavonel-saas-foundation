# Enterprise External Gates

The code foundation is complete only as software. Production activation remains fail-closed until these gates have named evidence and owners.

## Identity

- Select and contract a SAML/SCIM implementation or provider.
- Store signing/decryption and bearer credentials in an approved external secret manager.
- Verify signed SAML assertions, audience, issuer, clock skew, replay prevention and single logout.
- Verify SCIM bearer rotation, pagination, filtering, deprovisioning, group mapping and idempotency.
- Set `ENTERPRISE_SAML_PROVIDER_ENABLED=true` or `ENTERPRISE_SCIM_PROVIDER_ENABLED=true` only after provider verification is persisted.

## Data lifecycle and placement

- Apply migration `0014` to the dedicated Supabase project and seed organization/workspace ownership through an approved operator procedure.
- Implement and test object/database deletion workers, legal-hold exclusion and signed export expiry.
- Provision physical US/EU/APAC storage and compute paths before offering region selection.
- Provision dedicated network, database, storage, worker and observability resources before assigning a deployment reference.
- Perform a restore exercise and attach measured RTO/RPO evidence.

## Commercial and assurance

- Obtain counsel approval and signatures for SLA and DPA schedules.
- Complete subprocessor agreements, cross-border transfer review and customer notice process.
- Run independent penetration testing and remediate validated findings.
- Establish security program ownership, evidence retention and SOC 2/ISO 27001 readiness assessment.
- Connect metered RunPod/provider cost and Paddle live revenue reconciliation to `enterprise_daily_metrics`; synthetic rows must never be loaded in production.

## Operational acceptance

- Configure alerts for authorization denials, audit export failures, identity drift, queue/GPU errors, cost variance and missing daily metrics.
- Assign on-call, incident commander, privacy, billing and security owners.
- Validate `/enterprise` at supported browsers and mobile widths with a real enterprise tenant.

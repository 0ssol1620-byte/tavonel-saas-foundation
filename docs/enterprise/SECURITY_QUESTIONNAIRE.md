# Enterprise Security Questionnaire Baseline

Status values are deliberately limited to `IMPLEMENTED`, `PARTIAL`, `PLANNED`, and `NOT ASSESSED`.

| Domain | Status | Current evidence boundary |
| --- | --- | --- |
| Tenant access control | IMPLEMENTED | Organization/workspace RBAC schema, server authorization and deny-by-default permission map |
| Administrative audit | IMPLEMENTED | Append-only database trigger, tenant-scoped bounded export |
| SAML SSO | PARTIAL | Metadata and fail-closed activation contract; live IdP integration not verified |
| SCIM provisioning | PARTIAL | Configuration and secret-reference contract; live provisioning not verified |
| Encryption in transit | PARTIAL | Managed-provider TLS expected; enterprise endpoint scan and certificate evidence required |
| Encryption at rest | PARTIAL | Provider-managed controls require current provider evidence |
| Secrets management | PARTIAL | Schema rejects plaintext provider secrets; production manager and rotation exercise required |
| Backup and recovery | PLANNED | RTO/RPO policy exists; restore exercise not complete |
| Data residency | PARTIAL | Policy and workspace region exist; physical routing is not yet enforced |
| Dedicated deployment | PARTIAL | Policy/reference contract exists; infrastructure is not provisioned |
| Vulnerability management | NOT ASSESSED | SAST, dependency, container and penetration-test evidence package required |
| Incident response | PARTIAL | Existing operational documentation must be tested and assigned to on-call owners |
| SOC 2 / ISO 27001 | NOT ASSESSED | No certification claim |

Questionnaire responses must be regenerated from current deployment evidence for each customer review. A code contract is not proof that an infrastructure or organizational control is operating.

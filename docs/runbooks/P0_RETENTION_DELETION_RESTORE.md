# P0 retention, deletion and restore evidence

## Retention policy inputs

Before enabling automatic deletion, the owner must record retention days for quarantine sources, sanitized artifacts, OCR artifacts, generated packages, audit events, billing records and backups. Legal or security holds override automatic deletion and must be auditable.

## Verified deletion

1. Freeze the deletion scope and record request time, subject and workspace.
2. Delete tenant-scoped object keys and database rows through normal service operations.
3. Independently list the storage prefix and query tenant-scoped database records.
4. Record when replicas/backups expire; immediate primary deletion is not backup deletion.
5. Hash the immutable audit record.
6. Call `issueDeletionEvidence`. It refuses a receipt unless storage is empty, database lookup is empty, backup expiry is recorded and the audit digest is valid.

## Restore drill

1. Select a named backup and record its snapshot time and source manifest digest.
2. Restore only into an isolated, non-production destination with outbound customer notifications disabled.
3. Compare row counts and manifest digests, then execute at least one integrity query covering tenant isolation and object references.
4. Record completion time and calculated recovery time.
5. Destroy the isolated restore and record cleanup completion.
6. Call `issueRestoreEvidence`. A digest mismatch, count mismatch, missing integrity check, non-isolated destination or missing cleanup fails the evidence gate.

## Required live proof

Code tests prove contract behavior only. Production readiness requires a dated Supabase/R2 restore drill artifact, operator identity, backup identifier, command/output evidence, RTO result and cleanup evidence without customer content in the repository.

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

---

# Operator drills

**No deletion has ever executed anywhere in this system, and no receipt below exists yet.** The
two scripts here are the instruments, not the evidence. Running the dry runs proves the
instruments agree with themselves; only an `--execute` run against the live project produces a
receipt, and only the founder authorizes that.

Both scripts are dry-run by default and take no argument other than `--execute`. Both refuse
`--execute` outright when any required variable is absent, and both name every variable they
missed rather than failing on the first one.

## Source deletion drill

`nextjs/scripts/db/source-deletion-drill.mjs`

### What it does

Creates its own organization, workspace (`pilot-drill<8 hex>`), governance policy with
`deleted_object_grace_days = 0`, OAuth connection and two document bindings; writes three tiny
probe artifacts into that workspace's `quarantine/` and `immutable/` prefixes; requests deletion
through `request_connector_source_deletion`; runs the production attestation worker
(`runSourceDeletionInventoryAttestation`) and then the production sweeper
(`runSourceDeletionSweep`) until no claim comes back; re-lists both prefixes independently; checks
the `source_deletion_*` row counts; and issues the receipt through `issueDeletionEvidence`.

Three things about that sequence are worth knowing before running it:

- **The synthetic source satisfies the OAuth precondition honestly.**
  `request_connector_source_deletion` requires a row in `foundation_oauth_connections` matching
  the workspace and provider. It does **not** check the connection's status. So the drill creates
  the connection `active` (the `connector_document_bindings` trigger requires that), inserts its
  bindings, then immediately PATCHes it to `revoked` — the deletion RPC is still satisfied and no
  sync worker can ever use it. **No schema change was needed.** Its `client_secret_reference` and
  `refresh_token_reference` name broker paths that hold nothing.
- **Eligibility comes from the drill's own organization.** The drill reads
  `deleted_object_grace_days` back after provisioning and aborts with `DRILL_GRACE_NOT_ZERO` if it
  is anything but 0. It never edits another organization's policy and never sleeps out a grace
  period.
- **Storage emptiness is measured, not reported.** The final listing is a separate
  `listFounderResetObjects` call over both prefixes, so a sweeper that claims three purges while
  one object survives fails with `DRILL_STORAGE_NOT_EMPTY`.

### Commands

```bash
cd nextjs

# 1. Dry run. Touches nothing, needs no credential, writes no file.
node --experimental-strip-types scripts/db/source-deletion-drill.mjs

# 2. The offline suite behind it.
node --experimental-strip-types --test scripts/db/source-deletion-drill.test.mjs

# 3. Founder-authorized only. Deletes objects irreversibly.
#    Every variable must be exported explicitly; a missing one is a refusal, not a default.
export NEXT_PUBLIC_SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export R2_ACCOUNT_ID=...
export R2_BUCKET=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export TAVONEL_DRILL_OPERATOR=...            # who is running it
export TAVONEL_DRILL_ACTOR_USER_ID=...       # an auth.users id the drill acts as
export TAVONEL_DRILL_BACKUP_EXPIRY=...       # RFC 3339 UTC: when the DB backup covering this drill expires
export TAVONEL_DRILL_CONFIRM=DELETE-PROBE-WORKSPACE-OBJECTS
node --experimental-strip-types scripts/db/source-deletion-drill.mjs --execute
```

### Expected output

A dry run prints `{"dryRun": true, "wouldWrite": "…", "ok": true, "steps": [...], "receipt": {…}}`
with the steps in exactly this order, every one `"ok": true`:

```
preflight · provision · grace · request · attest · sweep · verify · evidence
```

and ends with `dry run: nothing was created, deleted or written. The model is not the system.`

An `--execute` run prints one line: the absolute path of
`docs/evidence/production/TAVONEL_SOURCE_DELETION_DRILL_<date>.json`.

### How to abort

- **Before `--execute`:** do nothing. The dry run has no side effects.
- **Mid-run:** `Ctrl-C`. Deletion is at-least-once and every step is idempotent, so the individual
  calls resume cleanly: `request_connector_source_deletion` replays,
  `attest_source_deletion_inventory` returns `replayed` for the same manifest, and already-purged
  objects return `replayed` from `finalize_source_deletion_object`. What a re-run will **not** do
  is re-provision — the preflight listing finds the probe objects and aborts with
  `DRILL_WORKSPACE_NOT_EMPTY`. To finish an interrupted sweep, run the sweeper directly rather
  than the drill.
- **To stop a run that is already deleting:** set `legal_hold_enabled = true` on the drill's own
  organization. `claim_source_deletion_sweep`, `begin_source_deletion_object` and
  `finalize_source_deletion_object` each re-check the hold under the workspace lock and refuse.
- **Leftovers:** an aborted run leaves a probe organization, workspace, connection, bindings and
  any unswept objects. They belong to no customer, and `20260920133000_founder_test_reset.sql` is
  the tool for clearing them.

### What the receipt proves, and what it does not

**Proves:** that on that date, in that project, an inventory attestation was recorded against a
real tombstone; that the sweeper then claimed and purged exactly the attested objects; that an
independent listing of both prefixes came back empty; that the `source_deletion_*` rows are in the
state the migrations promise; and that `issueDeletionEvidence` accepted the result.

**Does not prove:**

- **Anything about a customer workspace.** The subject is a probe workspace holding three
  artifacts the drill wrote seconds earlier. A real tenant has thousands of objects, live compile
  jobs and a non-zero grace period.
- **That the data is gone from backups.** `backupExpiryRecorded` is true because an operator typed
  a date into `TAVONEL_DRILL_BACKUP_EXPIRY`. It is a recorded intention, not an observation.
- **That deletion completes within any SLO.** The drill makes no timing assertion.
- **That the 512-object attestation ceiling is enough for a real source.** Three objects is not a
  test of that bound.

## Restore drill

`nextjs/scripts/db/restore-drill.mjs`

### What it does

Writes one probe object under `synthetic/restore-drill/<date>/<nonce>/`, copies it to a dated
`restored/` location, reads both back, compares size and SHA-256, checks the JSON contract, deletes
both, re-lists the prefix to confirm nothing is left, and issues the receipt through
`issueRestoreEvidence`. Same shape as
`docs/evidence/production/TAVONEL_R2_RESTORE_DRILL_2026-09-01.json`.

### Commands

```bash
cd nextjs

node --experimental-strip-types scripts/db/restore-drill.mjs
node --experimental-strip-types --test scripts/db/restore-drill.test.mjs

export R2_ACCOUNT_ID=...
export R2_BUCKET=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export TAVONEL_DRILL_OPERATOR=...
export TAVONEL_OPERATOR_API_TOKEN=...   # optional; see below
node --experimental-strip-types scripts/db/restore-drill.mjs --execute
```

### Expected output

Steps, all `"ok": true`, in this order:

```
write-source · verify-source · verify-restore · database-backup · cleanup
```

`--execute` prints the path of `docs/evidence/production/TAVONEL_RESTORE_DRILL_<date>.json`.

### How to abort

`Ctrl-C` at any point. Cleanup also runs on every failure path, so an aborted or failed run
deletes both objects before it returns; if it could not, the result carries
`RESTORE_CLEANUP_FAILED` or `RESTORE_CLEANUP_INCOMPLETE` and names the keys, which are then
deleted by hand. Nothing outside `synthetic/restore-drill/` is ever written.

### What the receipt proves, and what it does not

**Proves:** that R2 accepted a write, returned the same bytes, accepted a copy byte-identical to
the original, and that both objects were gone afterwards.

**Does not prove:**

- **That a customer artifact can be restored.** The object is a probe the drill wrote itself. This
  codebase deliberately has no application read path for a customer immutable object —
  `readFoundationQuarantineObject` was removed because it pulled whole sources back through the
  application server — and a drill is not a reason to put one back. Restoring a real artifact
  needs an operator with direct bucket access and is outside this script.
- **Recovery from losing the bucket.** The destination is an isolated prefix in the *same* bucket,
  not the separate `tavonel-restore-drill-<date>` bucket the 2026-09-01 record used; creating a
  bucket needs a Cloudflare API credential this script does not take.
- **That a database backup exists.** `databaseBackupAvailability` is the literal string
  `"not verified"`. With `TAVONEL_OPERATOR_API_TOKEN` set it becomes
  `"not verified (no backup API wired)"` — a token is permission to ask, and nobody has wired
  anything to ask yet. Neither value ever reads as "available".

### Known contract collision — do not paper over it

`nextjs/scripts/db/restore-evidence-check.mjs` validates a schema also called
`tavonel.restore_evidence.v1`, and it is **not** the schema `issueRestoreEvidence` produces. The
checker expects a database-restore receipt with `environment`, `source` / `schemaIdentity` /
`dataIdentity` artifact pairs, a `representativeQuery` and a signed export archive with a trusted
fingerprint. `issueRestoreEvidence` emits `{evidenceId, backupId, snapshotAt, …,
recoveryTimeSeconds}`. Running the checker over this drill's receipt fails at the first field:

```
restore evidence input error: environment must be an object
```

Two incompatible contracts share one version string, and that is a real defect. The drill does
**not** fabricate a provisioning artifact, a representative query or a signed export in order to
go green — inventing files to satisfy a schema is exactly what this repository forbids. Until one
of the two contracts is renamed, `restore-evidence-check.mjs` validates the *database* restore
receipt and this object-copy receipt is validated by `issueRestoreEvidence` alone.

## Running the offline suites

Both drills' tests, and the two `scripts/db` suites that previously had no runner at all, execute
under:

```bash
cd nextjs && pnpm test:scripts      # node --test over scripts/db/*.test.mjs
cd nextjs && pnpm test              # vitest, then the above
```

# Native World cross-session runner — DEFAULT-OFF DRAFT

This is a source-only runner checkpoint against Foundation
`62362e39b4052458fc15f8731dbccf45d9b73f63`, tree
`d95dc8463b9acb9033692cf1752e77f13da7ee54`. No workflow, collector selector,
admission configuration, credential, native capability or production gate changes.
Actual race execution requires a separately reviewed hosted job. Local checks use
contract/process doubles and do not establish PostgreSQL concurrency.

Additional source paths are exactly:

- `nextjs/scripts/db/native-world-race.mjs`
- `nextjs/scripts/db/native-world-race.test.mjs`
- `docs/integration/NATIVE_WORLD_CROSS_SESSION_REHEARSAL_DRAFT.md`

The qualified fixture/schema are unchanged. The runner uses their existing
`setup`, `holder`, `contender`, `member_inserter`, and `assert` roles, and holds the
documented controller advisory lock on a persistent psql connection. It reuses
the repository's strict psql/PG-environment isolation pattern, the existing
Supabase PostgreSQL container, and `evidence-receipt.mjs` receipt-writing rules.
There is no PostgreSQL driver, parser, install, dependency copy, Docker pull/run,
schema rewrite, or permissive qualification adapter.

## Qualified inputs and claim limits

Fixture SHA256:
`561d43d6f1f2a6c26a66e7e050db7b196d209939f337d2c773951d23f031cc62`.

Schema SHA256:
`de039c9204ccb8fcefc659cdc090468ed3f8ae20d97fc18af96228e76897a4db`.

The reported hosted baseline is DB run `37413409719`, job `112106717073`:
62 pgTAP files / 1,644 tests passed twice, including 22 rollback-only Native World
cases. Receipt artifact `11390495928` SHA256 is
`30f91555bea0d321e0ad4b48f7b8ebbc07c22833b08ba3d1e21bcb067f795735`.
Repair run `37413409860`, job `112106655290`, passed types/lint and 459 units.
These existing results do not claim that any cross-session case has run.

Only owner-only synthetic fixture copies receive a test gate and fake verifier.
The public function must retain its false production gate before and after every
case. Success never changes `fullQualification: pending`, authorizes native
processing, implements the missing security/Core verifier, or promotes routing.

## Fresh state and reviewed hosted execution

Execute **one selected case per fresh dedicated qualified stack**. The future CI
owner should use seven independent matrix entries (or equivalent fresh-stack
jobs), reusing the already qualified staging/reset procedure. Do not run this as
a continuation of a shared or customer stack, and do not run other mutation
drills before it. The runner consumes and removes its verified container and
dedicated data volume even on a failed case; its receipt is stored on the runner
host and remains available after teardown.

This design deliberately does not clone the complete database into another
database name. The existing maintenance workflow installs pg_cron, whose
metadata belongs to one configured database per cluster. Preserving the qualified
stack avoids omitting extensions or changing qualified SQL to make a clone work.
[pg_cron setup documentation](https://github.com/citusdata/pg_cron#setting-up-pg_cron).

Prerequisites for each future hosted matrix entry:

1. A fresh Linux GitHub-hosted runner and dedicated existing Supabase database-only
   container using the qualified `supabase/postgres:17.6.1.165` image, PostgreSQL
   17.6, and its dedicated named data volume. No host-bound data directory or
   shared volume is accepted.
2. Stage the exact existing qualified native prerequisites and World schema;
   use the existing reviewed migration/reset procedure. No native create-once
   migration is replayed manually by this runner.
3. The CI owner writes a fresh `tavonel-disposable-<uuid>` into the existing
   `tavonel_ci_fixture.disposable_marker` contract through the just-created local
   stack. Exactly that one row must be present. Marker creation/step wiring is
   outside this source patch; an opt-in boolean alone gives no cleanup authority.
4. The stack must have no private fixture schema, Sources, auth users, preparation
   grants or World commits. The public World gate must still be false. Do not
   weaken this prerequisite if an unrelated drill has left state; create another
   fresh stack and report the mismatch.
5. Select one case using the explicit environment contract below. The host's
   existing root-owned `/usr/bin/docker` client connects only to
   `unix:///var/run/docker.sock`; psql runs as the container's PostgreSQL user via
   its local Unix socket. PG/Docker redirect variables and credential variables
   are not forwarded. No external DSN, password, provider or executable override
   is accepted.

The future reviewed invocation is:

```sh
NATIVE_WORLD_RACE_TEST=1 \
NATIVE_WORLD_RACE_CONTAINER='<exact dedicated supabase_db_project container>' \
NATIVE_WORLD_RACE_MARKER='<fresh marker from the CI local stack>' \
NATIVE_WORLD_RACE_CASE='<one supported case>' \
node nextjs/scripts/db/native-world-race.mjs
```

`RUNNER_ENVIRONMENT=github-hosted` and `GITHUB_ACTIONS=true` come from the runner.
No invocation was executed against Docker/PostgreSQL during this checkpoint.

## Barrier and outcome contracts

| Case | Ordering before controller release | Required outcome |
|---|---|---|
| `grant_revoke` | H ready; H waits on C; T waits on H | `NATIVE_WORLD_AUTHORITY_BINDING_INVALID`, revoked World grant, zero commits |
| `qualification_revoke` | H ready; H waits on C; T waits on H | `NATIVE_WORLD_CURRENT_AUTHORITY_INVALID`, revoked qualification, zero commits |
| `epoch` | H ready; H waits on C; T waits on H | `NATIVE_WORLD_JOB_UNAUTHORIZED`, advanced principal revision, zero commits |
| `delete` | H ready; H waits on C; T waits on H | `NATIVE_WORLD_CURRENT_SCOPE_INVALID`, deleted Source, zero commits |
| `same_replay` | H's write remains uncommitted while H waits on C; T waits on H | H `written`, T `exists`, exactly one complete three-ref commit |
| `changed_replay` | H's write remains uncommitted while H waits on C; T waits on H | H `written`, T `NATIVE_WORLD_REPLAY_CONFLICT`, exactly one complete three-ref commit |
| `member_fk` | T ready; T waits on C; I waits on T's transaction while reaching the real parent FK | T `NATIVE_WORLD_CURRENT_SCOPE_INVALID`, I inserts the unbound member, zero World commits |

The epoch expectation follows the qualified SQL's fresh authorizer **after** the
workspace-row wait. An unexpected refusal or timeout is a failed case and a source
issue to investigate, not a reason to change the qualified fixture/schema or accept
any generic error.

Every release proof is a single observed frame containing database OID, backend
PID/start identity, exactly one backend per role, `pg_locks` rows and
`pg_blocking_pids`. C must own `(90400, case_id)`; H (or T for the FK case) must own
readiness `(90300, case_id)`, be waiting on C's lock, and have C as a blocking PID.
T must actually wait on H for ordinary cases. No mutation or contender outcome may
already be committed before release. The 50ms interval only schedules another
probe; elapsed time, stdout silence and fixed sleeps are never race evidence.
[PostgreSQL blocking-PID documentation](https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-INFO-SESSION-TABLE),
[lock-view documentation](https://www.postgresql.org/docs/current/monitoring-locks.html).

For `member_fk`, the new member PK must still be absent, file 93 must already be
prepared, I must wait on T with a matching transactionid Share/Exclusive conflict,
and the real parent/member relation locks must be present. This proves observed
FK exclusion and bounded-set refusal. It does **not** prove successful World
commitment or release of a third document; the fixture intentionally leaves a
three-file approval and a two-document World context.

After release, every actor must exit successfully; the controller must report
that it unlocked its own lock. Exact refusals/statuses, mutation visibility,
complete reference cardinality and public gate closure are checked independently
of the fixture's `assert` role. That role must emit exactly five successful pgTAP
assertions and one matching plan, with no failure, bailout, skip or TODO.

## Bounds, cleanup and receipts

Each wait/actor phase has a 15-second deadline, ordinary commands are capped at
30 seconds (probe commands at 10 seconds), the run command budget is 120 seconds,
and fixture statements receive a 20-second server timeout. Child stdout/stderr is
bounded to 256 KiB. Deadline exhaustion, early actor exit, malformed/duplicate
role evidence and unexpected output fail closed.

### Target confinement predicates

- **Snapshot, bind once.** The container name and marker are copied and frozen
  when the container operations are constructed; later changes to the config
  object are never read. The preflight resolves the name exactly once
  (`docker inspect --type container <name>`), validates it, and captures the
  immutable 64-hex container ID before any SQL. Every `docker exec`/psql session
  (server settings, marker, pristine, fixture, controller, actors, observer,
  outcome) targets that captured ID. Exec is refused while no ID is bound, after
  any preflight failure (the binding is dropped and the operation set is
  poisoned), and after the container is removed; a second preflight is rejected.
- **Mounts.** Exactly one mount has destination `/var/lib/postgresql/data`; it is
  `Type: volume`, named exactly as the container, `Driver: local`, with source
  `/var/lib/docker/volumes/<name>/_data`. Every other `Mounts` entry and every
  `HostConfig.Tmpfs` path must be absolute and must not equal, contain, or sit
  inside `/var/lib/postgresql/data`, `/var/run/postgresql` or `/run/postgresql`
  (so `/`, `/run`, `/var/lib/postgresql`, `.../data/pg_wal` and trailing-slash
  shadows are rejected). Unrelated extra mounts are allowed and never deleted.
- **Volume.** `docker volume inspect` of the captured name must report the same
  name, `Driver: local`, `Scope: local`, no driver `Options` (null or empty), a
  parseable `CreatedAt`, and a `Mountpoint` equal to the container mount source.
  The frozen `{name, driver, scope, createdAt, mountpoint}` is the volume identity.
- **Server settings.** Before fixture setup (in preflight) and again before cleanup
  stops anything, `server_version`, `data_directory` and `unix_socket_directories`
  are read over the bound session and must be `17.6`, `/var/lib/postgresql/data`
  and exactly `/var/run/postgresql`. A stopped container therefore fails cleanup
  closed and leaves teardown to the CI owner.

Cleanup is allowed only after the preflight above, an exclusively used dedicated
named data volume, the exact marker and pristine state have been verified. It
closes child clients, re-inspects the captured ID (identity, image, data volume
and mount predicates unchanged), rechecks server settings, then stops and runs
plain `docker rm <id>` (no `--volumes`, no force) so anonymous or extra mounts are
never deleted. After verifying the container is gone it requires zero consumers
of the captured named volume, re-inspects it and requires an identical volume
identity, removes only that named volume with `docker volume rm` (no force), and
verifies its absence. Changed identity, a changed volume or a new volume consumer
refuses deletion. Cleanup commands have their own bounded timeouts; cleanup
failure prevents acceptance. Abrupt runner termination still requires the CI
owner's usual unconditional disposable-stack cleanup/host teardown.

The shared create-once receipt writer records the selected case, raw wait graph,
outcomes, fixture TAP lines, cleanup status, input hashes and explicit pending
qualification. A failed assertion, timeout or incomplete cleanup yields `gate:
failed`. A successful selected case yields `passed-one-synthetic-cross-session-case`;
it does not assert coverage of the other six cases. The future CI collector must
require all seven distinct actual-container receipts and their source/run bindings
before describing seven-case coverage. Contract-double unit outputs are not
actual race evidence. `reservationExpiryCrossSession` remains `UNRUN` in this slice.

No existing workflow/selector enables this runner. Independently review both the
runner and the proposed hosted wiring before execution. The initial source-only
checkpoint used Codex; this confinement follow-on used Claude Code Opus 5.5
(`claude-opus-5-5`) and passed its focused contract checks. Actual Docker and
PostgreSQL race execution remains unrun.

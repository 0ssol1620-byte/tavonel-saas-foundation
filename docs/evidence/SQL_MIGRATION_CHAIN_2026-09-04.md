# The migration chain, run on a real PostgreSQL

**Measured:** 2026-09-04 · **Branch:** `agent/industry-leadership-v3`
**Server:** PostgreSQL 17.2 on x86_64-windows, a disposable cluster created with
`initdb --auth=trust` on port 55432. Nothing outside the database named on each run is touched.
**Tools:** `nextjs/scripts/db/apply-migrations.mjs`, `nextjs/scripts/db/corpus-slot-race.mjs`

## Why this exists

Every migration in this repository was checked by asserting on its **text**. A string assertion
cannot tell whether a function body compiles, whether a constraint is satisfiable, or whether an
expression is immutable enough for the column it is attached to. Running the chain found three
defects that the text tests passed, two of which made the feature they belong to unusable.

There is no Docker on this machine and the machine's own PostgreSQL uses scram with a password
nobody here has, hence the disposable cluster.

## Result

    total     42
    applied   42
    failures  none

Migrations `0038`–`0042` — compile-job state, corpus slots and billing semantics — apply to a
real server. That is what could not be said before.

## What running it found

### 1. `0022_retrieval_lexical_search.sql` could not be applied to any PostgreSQL

    ERROR:  generation expression is not immutable

    generated always as (to_tsvector('simple', array_to_string(search_tokens, ' '))) stored

`array_to_string(anyarray, text)` is declared **STABLE**, not IMMUTABLE — it takes `anyarray`, and
for an arbitrary element type the output function it calls may read a GUC (timestamps depend on
`DateStyle` and `TimeZone`). A stored generated column requires an immutable expression.

Confirmed against the catalog rather than inferred:

| function | arguments | volatility |
| --- | --- | --- |
| `array_to_string` | `anyarray, text` | stable |
| `to_tsvector` | `regconfig, text` | immutable |
| `array_to_tsvector` | `text[]` | immutable |

This is a core-function property, not a local one, so it holds on Supabase's PostgreSQL 17.6 too.
The lexical retrieval path had never existed in any database.

**Fixed in place**, not forward: a migration that cannot be applied cannot be repaired by a later
one, because the chain stops at it. Editing it is safe here for a reason that was checked rather
than assumed — see *The live project* below.

The fix wraps the expression in a function declared immutable. That is sound for this column: the
element type is `text`, whose output function is `textout`, which is immutable; STABLE is the
catch-all for element types this column cannot hold.

`array_to_tsvector(text[])` is immutable and would need no wrapper, and was **rejected**: it
produces lexemes without positions, and `lib/lexical-search.ts` ranks with `ts_rank_cd`, a
cover-density measure over positions. Measured, rather than argued:

    foundation_lexical_tsvector(['alpha','beta','alpha'])  ->  'alpha':1,3 'beta':2
    array_to_tsvector(['alpha','beta'])                    ->  'alpha' 'beta'

End-to-end on the server afterwards: the generated column populates
(`'compiler':3 'knowledge':2 'tavonel':1,4`), `ts_rank_cd` discriminates (0.15 against 0.00 for a
non-matching row), and the GIN index is used (`Bitmap Index Scan on
foundation_retrieval_units_search_vector_idx`).

### 2. `0041`'s `enqueue_foundation_compile_job` failed on every call

    ERROR:  column reference "corpus_id" is ambiguous
    It could refer to either a PL/pgSQL variable or a table column.

The function declares OUT columns named `corpus_id` and `batch_index`, which become plpgsql
variables, and its body then says `where corpus_id is null` and `where corpus_id = p_corpus_id`.
A plpgsql body is not parsed until it is called, so the migration applies cleanly and **every**
call fails — both branches, so no compile could be enqueued at all.

Nothing caught it because the tests over it assert the migration's text and fake the RPC.

Repaired in `0042`, which aliases the table and qualifies every column against the alias.

### 3. The corpus slot race, isolated and reproduced

`0041` refuses a slot whose occupant covers a different document set — on the first lookup only.
After `ON CONFLICT DO NOTHING` affects zero rows, the race loser re-reads the slot and returned
the winner's row **unexamined**.

`corpus-slot-race.mjs` makes the interleaving deterministic with two connections rather than
racing threads and hoping:

    A: begin; enqueue(slot 0, documents X)   -- holds the row, uncommitted
    B: enqueue(slot 0, documents Y)          -- finds nothing, inserts, blocks on the slot index
    A: commit                                -- B's insert now conflicts
    B: 0 rows affected, re-reads slot 0, finds A's row

`bBlockedUntilACommitted: true` in every run is the evidence that B really did block on the
index, i.e. that the race path was the one executed.

Because `0041` cannot run at all (defect 2), the race fix was isolated with a **mutant**: the full
chain through `0042`, with only the race-path assertion commented out, verified present in the
installed function body (`prosrc like '%MUTATED AWAY%'`).

| scenario | mutant (0042 minus the race check) | full chain |
| --- | --- | --- |
| same slot, **different** documents, concurrent | **FAIL** — `bReturnedARow: true`, no error | pass — 23505 |
| same slot, same documents, concurrent | pass — one job, both converge | pass |
| standalone job not adopted as a corpus slot | pass | pass |
| slot re-used under drifted batching | pass | pass |
| | **3 / 4** | **4 / 4** |

One scenario moves and three do not, so the harness discriminates this fix and not something
incidental. On the mutant, B is told its part is enqueued while A's documents compile under it —
the reported defect, reproduced.

## The live project

`tavonel-saas-foundation` (`tfcorhjkqcuisqhsjemz`), read-only via the Supabase MCP:

- `list_migrations` returns **four** rows, all named `tavonel_tenant_foundation_0001`.
- `list_tables` shows no `foundation_compile_jobs`, no `foundation_corpora`, no
  `foundation_retrieval_units`.

So the numbered chain has not been applied to the live project, and the tables `0020`–`0022` and
`0038`–`0042` create are absent from it. That is why editing `0022` in place is safe: there is no
deployed state for the edit to diverge from.

**This is a Production GO blocker and is not resolved by this branch.** The corpus compile,
compile-job and retrieval features have no schema in the live database.

## What is still not verified

- **pgvector semantics.** Three retrieval migrations declare `create extension vector`, which
  stock PostgreSQL does not ship. `--shim-vector` installs a domain over `double precision[]` and
  a `vector_dims` so the chain reaches the migrations this exists to check. The distance
  operators are only referenced inside function bodies, which are not resolved until a call that
  never happens here. Every run reports `vectorSemanticsVerified: false`.
- **The pgTAP suite** (`supabase/tests/foundation_corpus_slot_idempotency.sql`) is still
  unexecuted: pgTAP is not available on this machine (`pg_available_extensions` returns none, and
  it is not in the PostgreSQL 17 extension directory). It has been updated to `0042`'s signature
  but remains `EXTERNAL_QA_REQUIRED`. The scenarios it covers are now covered on a real server by
  the race harness instead, including the concurrent case pgTAP cannot express at all.

## Reproducing

```bash
initdb -D "$SCRATCH/pgdata" -U postgres --auth=trust --encoding=UTF8 --no-locale
pg_ctl -D "$SCRATCH/pgdata" -o "-p 55432 -c listen_addresses=127.0.0.1" -l "$SCRATCH/pg.log" start
psql "postgres://postgres@127.0.0.1:55432/postgres" -c "create database tavonel_chain;"
node nextjs/scripts/db/apply-migrations.mjs \
  --dsn postgres://postgres@127.0.0.1:55432/tavonel_chain --shim-vector --json
node nextjs/scripts/db/corpus-slot-race.mjs \
  --dsn postgres://postgres@127.0.0.1:55432/tavonel_chain
```

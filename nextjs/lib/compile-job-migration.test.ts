import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPILE_STATES } from "./compile-job-store";

const migration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0038_foundation_compile_jobs.sql"),
  "utf8",
);

describe("durable compile job schema", () => {
  it("names every lifecycle state the product promises, and the same ones the application knows", () => {
    // Masterplan 6.4 lists thirteen states. A UI that can render a state the database cannot
    // store, or the reverse, is a bug that only appears when a customer hits that state.
    for (const state of COMPILE_STATES) {
      expect(migration).toContain(`'${state}'`);
    }
    expect(COMPILE_STATES).toHaveLength(13);
  });

  it("makes the document set the job's identity, so a resubmission is one compile", () => {
    expect(migration).toContain("idempotency_key text not null");
    expect(migration).toContain("create unique index foundation_compile_jobs_idempotency_idx");
    expect(migration).toContain("(workspace_key, idempotency_key)");
  });

  it("leaves the product's document limit to the application", () => {
    // COMPILE_MAX_DOCUMENTS is the single authority. The check here is structural, and writing
    // the product number in SQL as well is how a limit ends up spelled three ways.
    expect(migration).toContain("cardinality(document_ids) between 1 and 1000");
    expect(migration).not.toMatch(/cardinality\(document_ids\)\s*(<=|between 1 and)\s*12\b/);
  });

  it("keeps the event ledger append-only, because it is what a reconnecting client replays", () => {
    expect(migration).toContain("foundation_compile_job_events is append-only");
    expect(migration).toContain("before update or delete on public.foundation_compile_job_events");
    expect(migration).toContain("event_sequence bigint generated always as identity");
    expect(migration).toContain("primary key (job_id, event_sequence)");
    expect(migration).not.toMatch(/grant\s+(update|delete)\s+on\s+public\.foundation_compile_job_events/i);
  });

  it("refuses to move a settled job, so a redelivery cannot resurrect one", () => {
    expect(migration).toContain("Terminal is terminal");
    expect(migration).toContain("if v_row.state in ('ready', 'failed', 'cancelled') then");
    expect(migration).toContain("v_rank_next < v_rank_current");
  });

  it("will not let a one-click continue step over a security blocker", () => {
    // Masterplan 6.5. The four offers exist so a partial failure is a decision, and the one
    // decision that may not be taken casually is skipping a file that failed sanitation.
    expect(migration).toContain("SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL");
    expect(migration).toContain("if v_security > 0 and p_resolution = 'continue' then");
    // retry_eligible clears ordinary blockers and keeps the security ones.
    expect(migration).toContain("where entry ->> 'kind' = 'security'");
  });

  it("records who resolved a partial failure and when", () => {
    expect(migration).toContain("blocked_resolved_by uuid");
    expect(migration).toContain("foundation_compile_jobs_resolution_is_attributed");
  });

  it("is reachable only by the service role", () => {
    expect(migration).toContain("alter table public.foundation_compile_jobs enable row level security");
    expect(migration).toContain("revoke all on public.foundation_compile_jobs from public, anon, authenticated");
    expect(migration).toContain("revoke all on public.foundation_compile_job_events from public, anon, authenticated");
    for (const fn of [
      "enqueue_foundation_compile_job",
      "advance_foundation_compile_job",
      "resolve_foundation_compile_job_blockers",
    ]) {
      expect(migration).toContain(`revoke all on function public.${fn}(`);
      expect(migration).toContain(`grant execute on function public.${fn}(`);
    }
  });

  it("cannot report ready without the World it produced", () => {
    expect(migration).toContain("foundation_compile_jobs_ready_has_collection");
    expect(migration).toContain("foundation_compile_jobs_terminal_is_settled");
  });
});

const slotMigration = readFileSync(
  resolve(import.meta.dirname, "../../supabase/migrations/0041_corpus_slot_idempotency.sql"),
  "utf8",
);

describe("0041 — a standalone compile is not a corpus part", () => {
  /*
    The collision this migration closes is described in `compile-job-idempotency.test.ts`,
    which reproduces it. These assertions are for the half that cannot run in this process:
    the SQL executes against a database, and `supabase/tests/foundation_corpus_slot_
    idempotency.sql` is where it is actually exercised.
  */

  it("looks a corpus part up by its slot and a standalone compile by its documents", () => {
    expect(slotMigration).toContain("and corpus_id is null\n       and idempotency_key = p_idempotency_key");
    expect(slotMigration).toContain("and corpus_id = p_corpus_id\n       and batch_index = p_batch_index");
  });

  it("refuses a slot whose occupant covers other documents instead of returning it", () => {
    expect(slotMigration).toContain("v_existing.idempotency_key is distinct from p_idempotency_key");
    expect(slotMigration).toContain("errcode = '23505'");
  });

  it("survives two enqueues of one slot racing each other", () => {
    // select-then-insert let both callers past the select and gave the loser an unhandled
    // unique violation. The insert now yields and the loser reads back the winner's row.
    expect(slotMigration).toContain("on conflict do nothing");
    expect(slotMigration).toContain("get diagnostics v_inserted = row_count");
    expect(slotMigration).toContain("if v_inserted = 1 then");
  });

  it("hands the caller the slot it landed in, so the answer can be checked", () => {
    expect(slotMigration).toContain("corpus_id text,\n  batch_index integer");
  });

  it("rewrites stored keys with exactly the derivation the application uses", () => {
    /*
      The backfill and `compileIdempotencyKey` build the same string in two languages. If they
      disagree by one separator, every existing job gets a key nothing will ever match again
      and the next resubmission enqueues a second compile of documents already compiling.
    */
    const source = readFileSync(resolve(import.meta.dirname, "./compile-job-store.ts"), "utf8");
    for (const piece of ["compile-identity/2", "standalone", "corpus-part"]) {
      expect(slotMigration, piece).toContain(`'${piece}'`);
      expect(source, piece).toContain(piece);
    }
    // Order: version, namespace, workspace, [corpus, batch], documents.
    const SEP = String.raw`E'\n'`;
    expect(slotMigration).toContain(
      `'corpus-part' || ${SEP} || job.workspace_key || ${SEP} ||`,
    );
    expect(slotMigration).toContain(`job.corpus_id || ${SEP} || job.batch_index::text`);
    expect(slotMigration).toContain(`'standalone' || ${SEP} || job.workspace_key`);
    expect(source).toContain(String.raw`corpus-part\n${"${workspaceKey}"}`);
    expect(source).toContain(String.raw`${"${slot.corpusId}"}\n${"${slot.batchIndex}"}\n${"${canonical}"}`);
    expect(source).toContain(String.raw`standalone\n${"${workspaceKey}"}\n${"${canonical}"}`);
    // Sorted, de-duplicated, newline-joined on both sides.
    expect(slotMigration).toContain(`string_agg(document_id, ${SEP} order by document_id)`);
    expect(slotMigration).toContain("select distinct unnest(job.document_ids)");
    expect(source).toContain(String.raw`[...new Set(documentIds)].sort().join("\n")`);
  });

  it("is safe to run twice", () => {
    // Recomputed from the row, never derived from the key it replaces.
    expect(slotMigration).not.toContain("idempotency_key || ");
    expect(slotMigration).toContain("Recomputed from workspace_key, document_ids, corpus_id and batch_index");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { representationKinds, sourceFamilies } from "../../shared/uskcEnums";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0049_universal_source_domain.sql"),
  "utf8",
).toLowerCase();

describe("universal source domain migration", () => {
  it("creates the three ledger tables and nothing else", () => {
    for (const table of ["sources", "source_versions", "source_representations"]) {
      expect(migration).toContain(`create table public.${table} (`);
    }
    expect(migration.match(/create table/g)).toHaveLength(3);
  });

  it("is additive: it alters no existing table and drops nothing", () => {
    expect(migration).not.toContain("alter table public.documents");
    expect(migration).not.toContain("alter table public.sanitization_proofs");
    expect(migration).not.toContain("drop table");
    expect(migration).not.toContain("drop column");
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
  });

  it("carries the frozen source-family and representation-kind vocabularies", () => {
    for (const family of sourceFamilies) expect(migration).toContain(`'${family}'`);
    for (const kind of representationKinds) expect(migration).toContain(`'${kind}'`);
  });

  it("pins a source version to one digest and one object key", () => {
    expect(migration).toContain("content_sha256 text not null check (content_sha256 ~ '^sha256:[a-f0-9]{64}$')");
    expect(migration).toContain("byte_length bigint not null check (byte_length >= 1)");
    expect(migration).toContain("function public.reject_source_version_rebinding()");
    expect(migration).toContain("raise exception 'source_version_digest_conflict'");
    expect(migration).toContain("create trigger source_versions_digest_immutable");
  });

  it("never lets an original representation be rewritten, and allows only one per version", () => {
    expect(migration).toContain("function public.reject_original_representation_rewrite()");
    expect(migration).toContain("raise exception 'original_representation_immutable'");
    expect(migration).toContain("create trigger source_representations_original_immutable");
    expect(migration).toContain("source_representations_single_original_idx");
    expect(migration).toContain("check ((kind = 'original') = (cardinality(derived_from) = 0))");
    expect(migration).toContain("check (kind <> 'original' or lossy = false)");
  });

  it("requires every derived representation to name parents that exist under the same version", () => {
    expect(migration).toContain("function public.assert_source_representation_lineage()");
    expect(migration).toContain("raise exception 'representation_lineage_broken'");
    expect(migration).toContain("create trigger source_representations_lineage_resolves");
    expect(migration).toContain("provider_revision text not null");
  });

  it("keeps the ledger service-role only and grants no delete", () => {
    for (const table of ["sources", "source_versions", "source_representations"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
      expect(migration).toContain(`grant select, insert, update on public.${table} to service_role;`);
    }
    expect(migration).toContain("from public, anon, authenticated;");
    expect(migration).not.toContain("to authenticated");
    expect(migration).not.toContain("delete on public.source");
  });

  it("backfills sources idempotently, and only where the 0001 tenant schema was applied", () => {
    expect(migration).toContain("if to_regclass('public.documents') is null then");
    expect(migration).toContain("on conflict (source_id) do nothing;");
    // No version row is invented: `documents` has no byte length and its digest is pre-CDR.
    expect(migration).not.toContain("insert into public.source_versions");
    expect(migration).not.toContain("insert into public.source_representations");
  });
});

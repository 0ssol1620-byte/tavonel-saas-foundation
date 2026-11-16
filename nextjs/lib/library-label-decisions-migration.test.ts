import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
  WO-D23-4's migration, checked where it can be checked without a database. The real proof is
  `supabase/tests/library_label_decisions.sql` (pgTAP, needs Docker: db-rehearsal). This file pins
  what a reader would otherwise take on trust: the function is security definer with an empty
  search_path, only service_role may run it, it creates no table, and it never edits or deletes a
  source row or an existing label.
*/
const FILE = "20261116130000_library_label_decisions.sql";
const migrations = resolve(import.meta.dirname, "../../supabase/migrations");
const sql = readFileSync(join(migrations, FILE), "utf8");
// Comments carry words such as "deleted"; the checks read the statements.
const code = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");

describe("library label decisions migration", () => {
  it("is a security definer function with an empty search_path and a time bound", () => {
    expect(code).toMatch(/create function public\.decide_library_label\(/);
    expect(code).toContain("security definer set search_path = '' set statement_timeout = '3s'");
  });

  it("is executable by service_role only", () => {
    expect(code).toContain("revoke all on function public.decide_library_label(text, uuid, text, text, text, text, uuid, text)\n  from public, anon, authenticated, service_role;");
    expect(code).toContain("grant execute on function public.decide_library_label(text, uuid, text, text, text, text, uuid, text) to service_role;");
    expect(code).not.toMatch(/grant [^;]*\bto\s+(public|anon|authenticated)\b/);
  });

  it("creates no table and changes none", () => {
    expect(code).not.toMatch(/create table|alter table|create policy/i);
  });

  it("appends one person row and never updates or deletes anything", () => {
    expect(code).toMatch(/insert into public\.document_labels/);
    expect(code).toContain("'person', 'person:v1'");
    expect(code).not.toMatch(/\bdelete\b/i);
    expect(code).not.toMatch(/\bupdate\b/i);
    expect(code).not.toMatch(/\b(insert into|update|delete from|truncate)\s+public\.source_fingerprints/i);
    expect(code).not.toMatch(/\b(insert into|update|delete from)\s+public\.document_relations/i);
  });

  it("is idempotent on a key and refuses a conflicting replay, a missing target and an invalid request", () => {
    expect(code).toContain("'sha256:' || pg_catalog.encode(pg_catalog.sha256(");
    expect(code).toContain("raise exception 'library_decision_conflict'");
    expect(code).toContain("raise exception 'library_decision_target_missing'");
    expect(code).toContain("raise exception 'library_decision_request_invalid'");
    expect(code).toContain("p_decision not in ('confirmed', 'rejected')");
    expect(code).toContain("pg_advisory_xact_lock");
  });

  it("uses the same workspace-key pattern as the recorder", () => {
    const recorder = readFileSync(join(migrations, "20261107100000_library_organize_shadow.sql"), "utf8");
    const pattern = "'^pilot-[A-Za-z0-9]{1,32}$'";
    expect(recorder).toContain(pattern);
    expect(code).toContain(pattern);
  });
});

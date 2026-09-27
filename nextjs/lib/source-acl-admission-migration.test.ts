import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Text contract only. The behaviour is measured by supabase/tests/source_acl_admission.sql,
// which runs against Postgres in the db-rehearsal workflow, not here.
const migration = readFileSync("../supabase/migrations/20260927101000_source_acl_admission.sql", "utf8");

describe("per-source ACL admission", () => {
  it("binds snapshots to a workspace and to the exact connector version and provider", () => {
    expect(migration).toMatch(/add column workspace_key text not null/i);
    expect(migration).toMatch(/where source_version_id = new\.source_version_id\s+and workspace_key = new\.workspace_key\s+and provider = new\.provider_id/i);
    expect(migration).toMatch(/SOURCE_ACL_SNAPSHOT_UNBOUND/);
    expect(migration).toMatch(/SOURCE_ACL_SNAPSHOT_FUTURE/);
  });

  it("admits only from the newest fresh snapshot, by exact principal identity", () => {
    expect(migration).toMatch(/a\.captured_at > now\(\) - interval '24 hours'/);
    expect(migration).toMatch(/f\.captured_at = \(select max\(captured_at\) from fresh\)/);
    expect(migration).toMatch(/coalesce\(bool_and\([\s\S]+\), false\)/);
    expect(migration).toMatch(/grant_row->>'kind' = viewer->>'kind'\s+and grant_row->>'principalId' = viewer->>'principalId'/);
  });

  it("keeps every prior serving denial and adds the ACL clause with no fabricated viewer principal", () => {
    for (const clause of [/c\.status <> 'active'/, /public\.connector_source_suspensions/, /sv\.tombstoned is true/, /s\.tombstoned_at is not null/]) {
      expect(migration).toMatch(clause);
    }
    expect(migration).toMatch(/or not public\.source_version_acl_admits\(b\.workspace_key, b\.source_version_id, b\.provider, '\[\]'::jsonb\)/);
  });

  it("keeps both functions server-only", () => {
    expect(migration).toMatch(/revoke all on function public\.source_version_acl_admits\(text, text, text, jsonb\)\s+from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/revoke all on function public\.connector_documents_blocked\(text, text\[\]\)\s+from public, anon, authenticated, service_role/);
    expect(migration).toMatch(/grant execute on function public\.connector_documents_blocked\(text, text\[\]\)\s+to service_role/);
  });

  it("has no application writer: no capture path claims provider ACL evidence", () => {
    const writers = readdirSync("lib").filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => readFileSync(`lib/${name}`, "utf8").includes("source_acl_snapshots"));
    expect(writers).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Text contract only. Behavior (conflicting tied replay, promotion currency, the two-session
// promotion/binding race) is qualified on actual PostgreSQL/PostgREST in
// scripts/journey/source-revision-journey.mjs.
const migration = readFileSync("../supabase/migrations/20261001170000_connector_replay_and_world_source_currency.sql", "utf8");
const body = (name: string) => {
  const start = migration.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return migration.slice(start, migration.indexOf("\n$$;", start));
};

describe("connector replay and World source-currency migration", () => {
  it("compares a replay with every stored field before any side effect", () => {
    const writer = body("record_connector_document_binding_after");
    const conflict = writer.indexOf("raise exception 'CONNECTOR_BINDING_CONFLICT'");
    expect(conflict).toBeGreaterThan(writer.indexOf("if found then"));
    for (const field of ["content_sha256", "byte_length", "mime_type", "provider_revision", "native_id", "oauth_connection_id", "document_id"]) {
      expect(writer.slice(0, conflict)).toContain(`v_existing.${field} is distinct from`);
    }
    expect(conflict).toBeLessThan(writer.indexOf("insert into public.connector_binding_tie_resolutions"));
    expect(conflict).toBeLessThan(writer.indexOf("return 'replay'"));
    // Unchanged decisions carried forward from the published writer.
    expect(writer).toMatch(/CONNECTOR_BINDING_IDENTITY_MISMATCH/);
    expect(writer).toMatch(/if v_newest is distinct from v_expected then\s+return 'contested'/);
    expect(writer).toMatch(/v_now <= v_top_at then\s+return 'contested'/);
  });

  it("checks every connector-bound source of a promotion under the writer's lock, in a fixed order", () => {
    const check = body("assert_world_sources_current");
    expect(check).toContain(`'tavonel.connector_binding_latest.v1' || pg_catalog.chr(10) || p_workspace_key || pg_catalog.chr(10) || v_source`);
    expect(check).toMatch(/order by b\.source_id\s+loop\s+perform pg_catalog\.pg_advisory_xact_lock/);
    expect(check.indexOf("pg_advisory_xact_lock")).toBeLessThan(check.indexOf("connector_source_newest_versions"));
    expect(check).toMatch(/raise exception 'world_source_revision_ambiguous'/);
    expect(check).toMatch(/v_newest is distinct from array\[v_binding\.source_version_id\] then raise exception 'world_source_revision_superseded'/);
    expect(check).not.toMatch(/provider_revision\s*[<>]|recorded_at/);
  });

  it("runs the check and the unchanged transition in one call, forward promotion only, replay untouched", () => {
    const transition = body("transition_foundation_world_atomic_current");
    expect(transition).toMatch(/if p_action is distinct from 'activate' then raise exception 'world_transition_contract_invalid'/);
    expect(transition).toMatch(/if not exists \(select 1 from public\.foundation_world_transition_receipts r where r\.operation_id = p_operation_id\) then\s+perform public\.assert_world_sources_current/);
    expect(transition.indexOf("assert_world_sources_current")).toBeLessThan(transition.indexOf("return public.transition_foundation_world_atomic("));
    expect(migration).not.toMatch(/create or replace function public\.transition_foundation_world_atomic\(/);
    for (const fn of ["record_connector_document_binding_after(jsonb, text[])", "assert_world_sources_current(text, text[])",
      "transition_foundation_world_atomic_current(uuid, text, text, text, text, text, text, text, text, bigint, text, uuid, text, text[])"]) {
      expect(migration).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(migration).toContain(`grant execute on function public.${fn} to service_role;`);
    }
  });
});

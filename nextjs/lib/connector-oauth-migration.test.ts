import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = fileURLToPath(new URL("../../supabase/migrations/0013_connector_oauth.sql", import.meta.url));
const sql = readFileSync(migration, "utf8");

describe("OAuth connector migration", () => {
  it("stores state digests and managed references, never OAuth token values", () => {
    expect(sql).toContain("state_sha256 text not null unique");
    expect(sql).toContain("pkce_verifier_reference text not null");
    expect(sql).toContain("refresh_token_reference text not null");
    expect(sql).not.toMatch(/refresh_token_value|access_token text|client_secret text/i);
  });

  it("consumes authorization state once under a row lock", () => {
    expect(sql).toContain("consume_foundation_oauth_authorization");
    expect(sql).toContain("for update");
    expect(sql).toContain("consumed_at is not null");
    expect(sql).toContain("set consumed_at = clock_timestamp()");
  });

  it("rotates key creation, revocation, and audit in one RPC transaction", () => {
    const rotation = sql.slice(sql.indexOf("create or replace function public.rotate_foundation_api_key"));
    expect(rotation).toContain("pg_advisory_xact_lock");
    expect(rotation.indexOf("set revoked_at = clock_timestamp()"))
      .toBeLessThan(rotation.indexOf("insert into public.foundation_api_keys"));
    expect(rotation).toContain("'api_key_rotated'");
  });

  it("enables RLS and exposes OAuth tables only to service_role", () => {
    for (const table of ["foundation_oauth_authorizations", "foundation_oauth_connections"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
  });
});

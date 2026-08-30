import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/0012_foundation_connections_and_api_keys.sql"), "utf8");

describe("developer control-plane migration", () => {
  it("stores only digests and external secret references", () => {
    expect(sql).toContain("token_sha256 text not null unique");
    expect(sql).not.toMatch(/token_plaintext|secret_value|access_key_value/i);
    expect(sql).toContain("secret_reference text check");
    expect(sql).toContain("configuration::text !~*");
  });

  it("enables RLS and grants no authenticated table access", () => {
    for (const table of ["foundation_api_keys", "foundation_connections", "foundation_connection_batches", "foundation_developer_audit_events"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
  });

  it("rate limits each key and scope with an atomic database counter", () => {
    expect(sql).toContain("create table public.foundation_api_rate_windows");
    expect(sql).toContain("consume_foundation_api_rate_limit");
    expect(sql).toContain("on conflict (key_id, scope, window_started_at) do update");
    expect(sql).toContain("request_count < p_limit");
    const rateFunction = sql.slice(sql.indexOf("create or replace function public.consume_foundation_api_rate_limit"));
    expect(rateFunction).toContain("delete from public.foundation_api_rate_windows");
  });

  it("applies batches under a locked expected cursor and idempotency contract", () => {
    expect(sql).toContain("for update");
    expect(sql).toContain("connection_cursor_conflict");
    expect(sql).toContain("connection_batch_idempotency_conflict");
    expect(sql).toContain("connection_batch_applied");
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
  FD-03's enforcement, checked where it can be checked without a database.

  `20260911130000_included_page_expiry_at_renewal.sql` is the half of the term that lives in SQL:
  when a subscription's next included-page grant is applied, the remainder of the previous period
  expires as its own ledger row. `supabase/tests/foundation_included_page_expiry.sql` is the real
  proof and it needs Docker (db-rehearsal). What is left for this file is the set of properties a
  reader would otherwise have to take on trust -- that the expiry is a row and not an UPDATE, that
  it cannot reach credit the customer bought, that it only runs when a grant actually landed, and
  that this file is still the live definition of the function.
*/

const migrationsDirectory = resolve(import.meta.dirname, "../../supabase/migrations");
const FILE = "20260911130000_included_page_expiry_at_renewal.sql";
const migration = readFileSync(join(migrationsDirectory, FILE), "utf8");
const allMigrations = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();

describe("included-page expiry migration", () => {
  it("expires the remainder as a ledger row with its own reason code", () => {
    expect(migration).toContain("check (kind in ('purchased', 'allowance', 'reversed', 'allowance_expired'))");
    expect(migration).toContain("'allowance_expired', p_offer_code, p_transaction_id, -expired_units)");
    // The row carries what caused it, so the expiry is readable months later without the webhook.
    expect(migration).toContain("(workspace_key, user_id, event_id, kind, offer_code, transaction_id, credit_delta)");
  });

  it("never expires credit that is not this offer's included pages", () => {
    expect(migration).toContain("where workspace_key = p_workspace_key and offer_code is distinct from p_offer_code");
    expect(migration).toContain("expired_units := greatest(0, balance_before - other_offer_credits)");
    // greatest() on the floor as well: a net-negative history of other offers must not become a
    // licence to expire more than the balance holds.
    expect(migration).toContain("select greatest(0, coalesce(sum(credit_delta), 0)) into other_offer_credits");
  });

  it("expires only when a grant actually landed, and only once per grant event", () => {
    // The expiry block sits inside the branch the allowance insert's row_count opens, so a
    // duplicate transaction (row_count 0) neither grants nor expires.
    const grantBranch = migration.slice(migration.indexOf("get diagnostics inserted_count = row_count;\n  if inserted_count = 1 then"));
    expect(grantBranch).toContain("'allowance_expired'");
    expect(grantBranch.indexOf("expired_units := greatest(0")).toBeGreaterThan(-1);
    // Idempotency is the (event_id, kind) constraint, and the balance follows the row that landed
    // rather than the units the function intended to take.
    expect(migration).toContain("unique (event_id, kind)");
    expect(migration).toContain("get diagnostics expiry_inserted = row_count;");
    expect(migration).toContain("if expiry_inserted <> 1 then expired_units := 0; end if;");
    expect(migration).toContain("credit_balance = credit_balance - expired_units + p_credit_delta");
  });

  it("drops the superseded unique constraint by its definition rather than a guessed name", () => {
    // 0005 declared `event_id text not null unique` inline, so the constraint's name is
    // Postgres's. Dropping a name that does not exist would silently leave unique (event_id) in
    // place and the expiry insert would fail in production rather than here.
    expect(migration).toContain("pg_get_constraintdef(oid) = 'UNIQUE (event_id)'");
    expect(migration).toContain("drop constraint if exists foundation_credit_ledger_event_id_kind_key");
  });

  it("keeps the signature, and therefore the service-role-only grant, untouched", () => {
    expect(migration).toContain("create or replace function public.apply_foundation_billing_event_v4(");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public, pg_temp");
    // A restated grant here would be a second place to keep in step with 0035's revoke.
    expect(migration).not.toContain("grant execute on function");
    const parameters = readFileSync(join(migrationsDirectory, "0035_subscription_allowance_ledger.sql"), "utf8")
      .match(/apply_foundation_billing_event_v4\(([\s\S]*?)\)\nreturns jsonb/);
    expect(parameters?.[1]).toBeTruthy();
    expect(migration).toContain(parameters![1]);
  });

  it("is the last migration that defines the billing projection", () => {
    // Single head, the only ordering `supabase db reset` has: whichever file sorts last wins. A
    // later migration copying an older body would revert the expiry without deleting a line.
    const definitions = allMigrations.filter((name) =>
      readFileSync(join(migrationsDirectory, name), "utf8")
        .includes("create or replace function public.apply_foundation_billing_event_v4("),
    );
    expect(definitions).toEqual(["0035_subscription_allowance_ledger.sql", FILE]);
    expect(FILE > "0048").toBe(true);
  });

  it("is re-runnable, because db-rehearsal may replay it", () => {
    // Every top-level statement is either `create or replace`, `drop ... if exists` before `add`,
    // or a lookup guarded by its own `if`. No `create table`, no backfill, no data statement at
    // all -- the indented inserts and updates below are the function's body, not the migration's.
    expect(migration).not.toMatch(/^(insert|update|delete)\s/mi);
    expect(migration.match(/alter table public\.foundation_credit_ledger add constraint/g)?.length).toBe(2);
    expect(migration.match(/alter table public\.foundation_credit_ledger drop constraint if exists/g)?.length).toBe(2);
  });
});

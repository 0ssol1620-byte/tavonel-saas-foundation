import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/0036_maximum_reservation_and_overage.sql"), "utf8");

describe("maximum reservation and PAYG overage migration", () => {
  it("holds standard usage, enforces the disclosed maximum, and records only observed overage", () => {
    expect(migration).toContain("maximum_credits between reserved_credits and 60000");
    expect(migration).toContain("credit_balance < p_reserved_credits");
    expect(migration).toContain("p_actual_credits > reservation.maximum_credits");
    expect(migration).toContain("greatest(0, p_actual_credits - reservation.reserved_credits)");
    expect(migration).toContain("overage_units = overage_units + overage_delta");
    expect(migration).toContain("foundation_compute_overage_not_enabled");
  });

  it("enables overage only from a signed subscription allowance ledger entry", () => {
    expect(migration).toContain("if new.kind = 'allowance'");
    expect(migration).toContain("set overage_enabled = true");
    expect(migration).toContain("elsif new.kind = 'reversed'");
  });
});

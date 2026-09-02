import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/0033_page_based_compute_units.sql"),
  "utf8",
).toLowerCase();

describe("page-based compute units migration", () => {
  it("widens the unit bounds without removing the existing RPC default", () => {
    expect(migration).toContain("p_reserved_credits integer default 2");
    expect(migration).toContain("reserved_credits between 1 and 60000");
    expect(migration).toContain("p_actual_credits > reservation.reserved_credits");
  });
});

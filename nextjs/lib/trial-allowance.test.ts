import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SELF_SERVE_CTA, START_FREE_LABEL, TRIAL_ALLOWANCE } from "./site-navigation";

/*
  The free-evaluation numbers the public copy prints ("Start free — 3 files, no card") are a copy of
  what the database enforces. The `default` row of `foundation_trial_policy` is inserted once, in
  migration 0045, and no later migration may move its limits without this file noticing.
*/
const MIGRATIONS = resolve(process.cwd(), "../supabase/migrations");
const INSERT = readFileSync(resolve(MIGRATIONS, "0045_self_service_trial_and_owner_access.sql"), "utf8");

describe("TRIAL_ALLOWANCE", () => {
  it("matches the default trial policy row the database enforces", () => {
    const match = INSERT.match(
      /insert into public\.foundation_trial_policy \(\s*policy_key, enabled, trial_days, file_limit, page_limit,[^)]*\) values \('default', true, (\d+), (\d+), (\d+),/,
    );
    expect(match, "the 0045 insert no longer has the shape this test reads").not.toBeNull();
    const [, days, files, pages] = match!.map(Number);
    expect(TRIAL_ALLOWANCE).toEqual({ days, files, pages });
  });

  it("is not changed by a later migration", () => {
    const later = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql") && name > "0045")
      .filter((name) => /update\s+public\.foundation_trial_policy[\s\S]{0,200}?(trial_days|file_limit|page_limit)\s*=/i
        .test(readFileSync(resolve(MIGRATIONS, name), "utf8")));
    expect(later, "a migration moves the trial limits: update TRIAL_ALLOWANCE and the copy that prints it").toEqual([]);
  });

  it("prints the allowance beside the start action, never a bigger one", () => {
    expect(START_FREE_LABEL).toBe(`${SELF_SERVE_CTA.label} — ${TRIAL_ALLOWANCE.files} files, no card`);
    expect(START_FREE_LABEL).not.toMatch(/;/);
  });
});

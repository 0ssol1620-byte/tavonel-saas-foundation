import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { foundationWorkspaceId } from "./foundation-pilot";

const ROOT = resolve(__dirname, "..");
const MIGRATIONS = resolve(ROOT, "..", "supabase", "migrations");

type Site = { where: string; source: string; width: number };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const sourceFiles = (dir: string) =>
  walk(resolve(ROOT, dir)).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

const TS_PATTERN = /\/(\^pilot-\[[^\]]+\]\{1,(\d+)\}\$)\//g;
const SQL_PATTERN = /'(\^pilot-\[[^\]]+\]\{1,(\d+)\}\$)'/g;

function sites(files: string[], pattern: RegExp): Site[] {
  const found: Site[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(pattern)) {
      found.push({ where: relative(resolve(ROOT, ".."), file).replaceAll("\\", "/"), source: m[1], width: Number(m[2]) });
    }
  }
  return found;
}

/** Pure helper: the sites whose pattern refuses at least one of the given keys. */
function sitesRefusing(all: Site[], keys: string[]): Site[] {
  return all.filter((s) => {
    const re = new RegExp(s.source);
    return keys.some((k) => !re.test(k));
  });
}

const fixed = [
  "00000000-0000-4000-8000-000000000000",
  "FFFFFFFF-FFFF-4FFF-BFFF-FFFFFFFFFFFF",
  "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a",
  "ABCDEF01-2345-4678-9ABC-DEF012345678",
];
const keys = [...fixed, ...Array.from({ length: 10_000 }, () => randomUUID())].map(foundationWorkspaceId);

// Intake-side tables and the e2e timing probe accept the wider {1,32} key. Anything else at 32 is new and must be listed.
const WIDE_ALLOWED = new Map<string, string>([
  ["nextjs/lib/operations-e2e-timing.ts", "timing probe accepts intake-width keys"],
  ...[
    "0008_foundation_intake_admission", "0026_foundation_intake_replay", "0030_foundation_intake_pilot_quota",
    "0031_foundation_intake_qualification_quota", "0032_foundation_intake_confirmation",
    "0045_self_service_trial_and_owner_access", "0048_intake_size_and_experience_contract",
    "0051_intake_ceiling_and_gate_evidence", "20260927102000_customer_source_deletion",
    "20261104090000_trial_ai_usage", "20261104090500_source_fingerprints_exact_dedup",
    "20261107100000_library_organize_shadow", "20261110040000_intake_admission_paid_over_trial",
  ].map((n) => [`supabase/migrations/${n}.sql`, "intake-side table, {1,32} since the intake admission contract"] as [string, string]),
]);

const tsSites = sites(sourceFiles("lib").concat(sourceFiles("app")), TS_PATTERN);
const sqlSites = sites(
  readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).map((f) => join(MIGRATIONS, f)),
  SQL_PATTERN,
);

describe("tenant key contract (pilot- is a permanent key format, F30-08)", () => {
  it("foundationWorkspaceId always yields pilot-<1..16 alphanumerics>", () => {
    for (const key of keys) expect(key).toMatch(/^pilot-[A-Za-z0-9]{1,16}$/);
    expect(new Set(keys).size).toBeGreaterThan(9_990);
  });

  it("finds the validators it is meant to police", () => {
    expect(tsSites.length).toBeGreaterThanOrEqual(15);
    expect(sqlSites.length).toBeGreaterThanOrEqual(80);
  });

  it("every TypeScript and SQL validator admits every derived key", () => {
    expect(sitesRefusing([...tsSites, ...sqlSites], keys)).toEqual([]);
  });

  it("the distinct widths are exactly {16, 32} and every 32 is on the allowlist", () => {
    const all = [...tsSites, ...sqlSites];
    expect([...new Set(all.map((s) => s.width))].sort((a, b) => a - b)).toEqual([16, 32]);
    const unlisted = all.filter((s) => s.width === 32 && !WIDE_ALLOWED.has(s.where)).map((s) => s.where);
    expect([...new Set(unlisted)]).toEqual([]);
    // The probe-workspace pattern is a different shape on purpose, not a tenant validator.
    expect(readFileSync(resolve(ROOT, "lib/immutable-keys.ts"), "utf8")).toContain("PROBE_WORKSPACE_PATTERN = /^pilot-drill[0-9a-f]{8}$/");
  });

  it("foundationWorkspaceId is the only producer of a pilot- key", () => {
    const producers = [...sourceFiles("lib"), ...sourceFiles("app")]
      .filter((f) => readFileSync(f, "utf8").includes("`pilot-${"))
      .map((f) => relative(ROOT, f).replaceAll("\\", "/"));
    expect(producers).toEqual(["lib/foundation-pilot.ts"]);
  });

  it("failure path: a narrower validator is reported with its site", () => {
    const bad: Site = { where: "synthetic.ts", source: "^pilot-[0-9]{1,8}$", width: 8 };
    expect(sitesRefusing([bad, ...tsSites.slice(0, 1)], keys)).toEqual([bad]);
  });
});

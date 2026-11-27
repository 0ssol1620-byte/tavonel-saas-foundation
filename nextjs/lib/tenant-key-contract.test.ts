import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { foundationWorkspaceId } from "./foundation-pilot";

const ROOT = resolve(__dirname, "..");
const MIGRATIONS = resolve(ROOT, "..", "supabase", "migrations");

type Site = { where: string; source: string; width: number | null };

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

// Every ^pilot- literal, whatever its shape: /regex/, "string"/'string' (new RegExp) and SQL '...'.
const TS_PATTERN = /\/(\^pilot-[^/\n]*\$)\/|["'`](\^pilot-[^"'`\n]*\$)["'`]/g;
const SQL_PATTERN = /'(\^pilot-[^'\n]*\$)'/g;
// The one validator that is deliberately not a tenant-key admitter (see immutable-keys.ts).
const PROBE_WORKSPACE_SOURCE = "^pilot-drill[0-9a-f]{8}$";
const POSIX: Record<string, string> = { "[:digit:]": "0-9", "[:alnum:]": "A-Za-z0-9", "[:alpha:]": "A-Za-z", "[:xdigit:]": "0-9A-Fa-f" };
const compile = (source: string) =>
  new RegExp(source.replace(/\[:(?:digit|alnum|alpha|xdigit):\]/g, (m) => POSIX[m]));

function sites(files: string[], pattern: RegExp): Site[] {
  const found: Site[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(pattern)) {
      const source = m[1] ?? m[2];
      const w = /\{1,(\d+)\}/.exec(source);
      found.push({ where: relative(resolve(ROOT, ".."), file).replaceAll("\\", "/"), source, width: w ? Number(w[1]) : null });
    }
  }
  return found;
}

/** Pure helper: the sites whose pattern refuses at least one of the given keys. */
function sitesRefusing(all: Site[], keys: string[]): Site[] {
  return all.filter((s) => {
    if (s.source === PROBE_WORKSPACE_SOURCE) return false;
    const re = compile(s.source);
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
    "20261117160100_intake_admission_rearm", "20261117160200_intake_admission_rearm_checks",
  ].map((n) => [`supabase/migrations/${n}.sql`, "intake-side table, {1,32} since the intake admission contract"] as [string, string]),
  // WO-D30 (Library label decisions, change proposals): decisions on the Library's sources, taking the same
  // {1,32} workspace key as the intake-side tables above, 20261107100000_library_organize_shadow among them.
  ...["20261116130000_library_label_decisions", "20261116130100_world_change_proposals"]
    .map((n) => [`supabase/migrations/${n}.sql`, "Library decision table, {1,32} like the intake-side tables"] as [string, string]),
  // WO-C-T2: replaces reserve_foundation_intake_admission_unchecked whole, keyed on the payer. The intake
  // admission validator has been {1,32} since 0008 (20261117160100_intake_admission_rearm, above, is its
  // previous body); the replacement keeps that width, it does not widen a tenant key. Provisional file
  // name: if the lead renames the migration at merge, rename this entry with it.
  ["supabase/migrations/20261124000100_workspace_payer_for_members.sql", "intake admission body replaced whole, {1,32} since the intake admission contract"],
  // WO-TRIAL-RELEASE-1: replaces the same body again (the re-arm also clears a refusal); width unchanged.
  ["supabase/migrations/20261127030000_trial_intake_release_on_refusal.sql", "intake admission body replaced whole, {1,32} since the intake admission contract"],
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
    // A site whose width cannot be read is a new validator shape: only the probe pattern may be one.
    expect(all.filter((s) => s.width === null && s.source !== PROBE_WORKSPACE_SOURCE)).toEqual([]);
    expect(all.filter((s) => s.source === PROBE_WORKSPACE_SOURCE).length).toBe(1);
    expect([...new Set(all.filter((s) => s.width !== null).map((s) => s.width as number))].sort((a, b) => a - b)).toEqual([16, 32]);
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

  it("failure path: the scanner itself reports validator shapes other than {1,N}", () => {
    const synthetic = [
      "const a = /^pilot-[a-f0-9]{16}$/;", "const b = /^pilot-[0-9]+$/;", 'const c = new RegExp("^pilot-[0-9]{8,16}$");',
      "check (k ~ '^pilot-[0-9]{16}$')", "check (k ~ '^pilot-[[:digit:]]{1,16}$')",
    ];
    const found = synthetic.flatMap((line) => [...line.matchAll(line.includes("check") ? SQL_PATTERN : TS_PATTERN)].map((m) => m[1] ?? m[2]));
    expect(found).toHaveLength(synthetic.length);
    // /^pilot-[a-f0-9]{16}$/ refuses the key an uppercase UUID derives, and the helper says so.
    const upper: Site = { where: "synthetic.ts", source: found[0], width: null };
    expect(sitesRefusing([upper], [foundationWorkspaceId("ABCDEF01-2345-4678-9ABC-DEF012345678")])).toEqual([upper]);
  });

  it("failure path: a narrower validator is reported with its site", () => {
    const bad: Site = { where: "synthetic.ts", source: "^pilot-[0-9]{1,8}$", width: 8 };
    expect(sitesRefusing([bad, ...tsSites.slice(0, 1)], keys)).toEqual([bad]);
  });
});

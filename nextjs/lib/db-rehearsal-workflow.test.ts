import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Windows checkouts may carry CRLF (autocrlf); the repository stores LF.
const workflow = readFileSync("../.github/workflows/db-rehearsal.yml", "utf8").replace(/\r\n/g, "\n");
const RESERVE = 'sudo sysctl -w net.ipv4.ip_local_reserved_ports="${before:+$before,}54320-54329"';

function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("db-rehearsal local stack port reservation", () => {
  it.each([
    ["db-rehearsal", "supabase db start"],
    ["real-auth-journey", "supabase start"],
  ])("%s reserves the stack ports before any network activity and before the stack binds", (name, command) => {
    const body = job(name);
    // The command line itself, not a mention of it in a comment.
    const start = `\n          ${command}\n`;
    expect(body).toContain(start);
    const reserve = body.indexOf(RESERVE);
    expect(reserve).toBeGreaterThan(-1);
    expect(reserve).toBeLessThan(body.indexOf("actions/checkout@v4"));
    expect(reserve).toBeLessThan(body.indexOf("supabase/setup-cli@v1"));
    expect(reserve).toBeLessThan(body.indexOf(start));
    // Only on a disposable GitHub-hosted runner, and only after reading what is already reserved.
    expect(body.indexOf('test "$RUNNER_ENVIRONMENT" = "github-hosted"')).toBeLessThan(reserve);
    expect(body.indexOf('before="$(cat "$key")"')).toBeLessThan(reserve);
    // Every new port and every previously reserved entry must still be covered afterwards.
    expect(body).toContain('for port in $(seq 54320 54329) $(echo "$before" | tr \',-\' \'  \'); do covered "$port"; done');
    // The holder of a stack port, if any, is recorded right before the bind.
    const evidence = body.lastIndexOf("ss -Htanp '( sport >= :54320 and sport <= :54329 )' || true", body.indexOf(start));
    expect(evidence).toBeGreaterThan(reserve);
  });

  it("never overwrites the reservation, and never stops or kills anything to free a port", () => {
    expect(workflow).not.toMatch(/ip_local_reserved_ports=54320-54329/);
    expect(workflow).not.toMatch(/\b(kill|pkill|fuser|systemctl stop|docker (rm|stop|kill))\b/);
  });

  it("keeps the CLI default ports that the real-Auth contract accepts", () => {
    const contract = readFileSync("scripts/journey/real-auth-ci-contract.mjs", "utf8");
    expect(contract).toContain('"http://127.0.0.1:54321"');
    expect(contract).toContain('database.port, "54322"');
    expect(workflow).not.toMatch(/^\s*port\s*=/m);
  });
});

describe("db-rehearsal model-provider spend proof", () => {
  const body = job("db-rehearsal");
  const replay = body.split("- name: Apply the repair migrations a second time and re-run the suite")[1] ?? "";
  const raceStep = body.split("- name: Race model-provider settlement against another tenant's reserve")[1] ?? "";

  it("replays the queued-expiry recovery migration before the second pgTAP pass", () => {
    const loop = replay.slice(0, replay.indexOf("supabase test db"));
    expect(loop).toContain("supabase/migrations/20261002110000_*.sql");
  });

  it("replays the K20 dispatch-start mark after the queued-expiry recovery", () => {
    const loop = replay.slice(0, replay.indexOf("supabase test db"));
    expect(loop.indexOf("supabase/migrations/20261002120000_*.sql"))
      .toBeGreaterThan(loop.indexOf("supabase/migrations/20261002110000_*.sql"));
  });

  it("races only after every pgTAP pass, against a marker written into the fresh stack", () => {
    expect(raceStep).not.toBe("");
    expect(body.lastIndexOf("supabase test db")).toBeLessThan(body.indexOf("- name: Race model-provider settlement"));
    const write = raceStep.indexOf("insert into tavonel_ci_fixture.disposable_marker values ('$marker');");
    const run = raceStep.indexOf('MODEL_PROVIDER_SPEND_RACE_MARKER="$marker" node nextjs/scripts/db/model-provider-spend-race.mjs');
    expect(raceStep.indexOf('marker="tavonel-disposable-$(cat /proc/sys/kernel/random/uuid)"')).toBeGreaterThan(-1);
    expect(raceStep).toContain('psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "create schema tavonel_ci_fixture;"');
    expect(write).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(write);
  });

  it("pins the script to the runner's psql and to the CI marker", () => {
    const script = readFileSync("scripts/db/model-provider-spend-race.mjs", "utf8");
    expect(script).toContain("const executable = '/usr/bin/psql';");
    expect(script).not.toMatch(/PSQL_BIN|Program Files/);
    expect(script).toContain("from tavonel_ci_fixture.disposable_marker where value = ${quote(marker)}");
  });

  it.each([
    ["no marker", undefined],
    ["a malformed marker", "tavonel-disposable-not-a-uuid"],
    ["a marker with SQL in it", "tavonel-disposable-00000000-0000-0000-0000-000000000000' or true --"],
  ])("refuses to start with %s, before any database connection", (_label, marker) => {
    const env: NodeJS.ProcessEnv = { ...process.env, MODEL_PROVIDER_SPEND_RACE_TEST: "1", PGPORT: "54322", PGPASSWORD: "postgres" };
    delete env.MODEL_PROVIDER_SPEND_RACE_MARKER;
    if (marker !== undefined) env.MODEL_PROVIDER_SPEND_RACE_MARKER = marker;
    const result = spawnSync(process.execPath, ["scripts/db/model-provider-spend-race.mjs"], { env, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("MODEL_PROVIDER_SPEND_RACE_MARKER from the CI fresh-stack step is required");
    expect(result.stdout).not.toContain("PASS");
  });
});

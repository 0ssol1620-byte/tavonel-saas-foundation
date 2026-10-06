import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
    expect(loop.indexOf("supabase/migrations/20261002130000_*.sql"))
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

describe("db-rehearsal exact native SQL acceptance", () => {
  const body = job("db-rehearsal");
  const stage = body.split("- name: Stage exact native SQL drafts after completed-read")[1]?.split("- name: Read the head migration version out of the folder")[0] ?? "";
  const finalGate = body.split("- name: Require both disposable pgTAP passes for exact native SQL")[1]?.split("- name: Retain native SQL acceptance or failure receipt")[0] ?? "";
  const nativeInputs = [
  {
    "path": "supabase/drafts/native-source-ledger-snapshot.sql",
    "sha256": "08fc0baa0cf5f3776c91331218ca4cdf8e1ad41e688dc06c7363b5f85baec258"
  },
  {
    "path": "supabase/drafts/tests/native-source-ledger-snapshot.sql",
    "sha256": "dd462f0b0777310f06793661d3e96d9b3b91f47e6606233600f2997968e6074b"
  },
  {
    "path": "supabase/drafts/native-purpose-authority-schema.sql",
    "sha256": "976346877d4103d7f5c0ab14e560d2971370da4ebececd4dba909853c3fd3268"
  },
  {
    "path": "supabase/drafts/tests/native-purpose-authority-schema.sql",
    "sha256": "381e50a775f2d93c0ae6b5757dedb38c3b9c834fe9aff8d8a21e824dd5b1a6fe"
  },
  {
    "path": "supabase/drafts/native-purpose-candidate-reader.sql",
    "sha256": "84f2e7f54d484c7149237c15ede60df79ef688469da79c29e8b33ccc17ae75e2"
  },
  {
    "path": "supabase/drafts/tests/native-purpose-candidate-reader.sql",
    "sha256": "c5256a58200ac8e3122add1b7b887868d1a8e195256dd97e13ea7e5c54840c25"
  },
  {
    "path": "supabase/drafts/tests/native-purpose-candidate-reader-correction.sql",
    "sha256": "5c30190276057bb2d4875d0e6f2c5984b6ec6b0d381e77e40ade64682eb9d58e"
  }
];
  const gateCode = finalGate.split("node --input-type=module <<'NODE'\n")[1]?.split("\n          NODE")[0]?.split("\n").map(line => line.slice(10)).join("\n") ?? "";

  it("orders create-once staging before reset and preserves both actual pgTAP passes", () => {
    expect(body.indexOf("- name: Stage exact native SQL drafts")).toBeGreaterThan(body.indexOf("- name: Stage the exact completed-read producer draft"));
    expect(body.indexOf("- name: Stage exact native SQL drafts")).toBeLessThan(body.indexOf("- name: Read the head migration version"));
    for (const required of ['test "$RUNNER_ENVIRONMENT" = github-hosted', 'test "$prerequisite_state" = ephemeral',
      'test "$present" -eq 7', 'test "${#existing[@]}" -eq 0', '[[ "$version" > "$previous_version" ]]',
      'cmp -- "$source" "${generated[0]}"', 'cmp -- "$source" "$target"']) expect(stage).toContain(required);
    const replay = body.split("- name: Apply the repair migrations a second time and re-run the suite")[1]?.split("- name: Require both disposable pgTAP passes for exact native SQL")[0] ?? "";
    expect(replay).not.toMatch(/native_|native-/);
    expect((body.match(/supabase test db\n/g) ?? []).length).toBe(2);
  });

  it("pins seven exact reviewed SQL files and the corrected private-positive/public-closed fixtures", () => {
    for (const input of nativeInputs) {
      expect(createHash("sha256").update(readFileSync("../" + input.path)).digest("hex")).toBe(input.sha256);
      for (const code of [stage,gateCode]) {
        expect(code).toContain(input.path); expect(code).toContain(input.sha256);
      }
    }
    const positive = readFileSync("../supabase/drafts/tests/native-purpose-candidate-reader-correction.sql", "utf8");
    for (const assertion of ["99999999-9999-4999-8999-999999999992",
      "healthy ordinary job has NULL pre-output collection_id", "positive pending candidate can return through temporary harness",
      "temporary tests leave public runtime gate unchanged"]) expect(positive).toContain(assertion);
    expect(finalGate).toContain("publicClosedGateEvidence");
    expect(finalGate).toContain("privatePositiveFixtureEvidence");
  });

  it("fails closed on skipped staging or pgTAP and keeps the existing completed-read gate and receipts", () => {
    expect(finalGate).toContain("if: always() && (needs.collector-only-eligibility.outputs.native_database == 'true' || steps.native-sql-drafts.outputs.state != 'absent')");
    for (const required of ["steps.native-sql-drafts.outcome", "steps.pgtap-first.outcome", "steps.pgtap-second.outcome",
      "realConcurrency: 'UNRUN'", "canonicalPinnedRowCrossSessionFk: 'UNRUN'"]) expect(finalGate).toContain(required);
    expect(body).toContain("run: node nextjs/scripts/repair-scope-gate.mjs database-draft");
    expect(body).toContain("path: native-sql-rehearsal-receipt.json");
    expect(body).toContain("name: native-sql-rehearsal-");
  });

  type RecordRow = {kind: string; source: string; path: string; sha256: string; version: string};
  type Stage = {schemaVersion: number; state: string; requestedHead: string; checkoutHead: string; records: RecordRow[]};
  function runGate(overrides: Record<string,string|undefined> = {}, mutate?: (root: string, stage: Stage) => void) {
    const tempRoot = realpathSync(tmpdir());
    const temp = realpathSync(mkdtempSync(join(tempRoot, "native-sql-gate-")));
    if (dirname(temp) !== tempRoot || !basename(temp).startsWith("native-sql-gate-"))
      throw new Error("Fixture cleanup path escaped the intended temporary root");
    try {
      const records = nativeInputs.map((input,i) => {
        const kind = input.path.startsWith("supabase/drafts/tests/") ? "test" : "migration";
        const version = kind === "test" ? "-" : "2026100514000" + i;
        const path = kind === "test" ? "supabase/tests/" + input.path.slice("supabase/drafts/tests/".length).replaceAll("-", "_")
          : "supabase/migrations/" + version + "_" + input.path.slice("supabase/drafts/".length).replaceAll("-", "_");
        for (const target of [input.path,path]) {
          mkdirSync(dirname(join(temp,target)), {recursive:true});
          writeFileSync(join(temp,target),readFileSync("../" + input.path));
        }
        return {kind,source:input.path,path,sha256:input.sha256,version};
      }).sort((a,b) => (a.kind === "migration" ? 0 : 1) - (b.kind === "migration" ? 0 : 1));
      const stage: Stage = {schemaVersion:1,state:"ephemeral",requestedHead:"a".repeat(40),checkoutHead:"b".repeat(40),records};
      mutate?.(temp,stage);
      writeFileSync(join(temp,".native-sql-rehearsal-stage.json"),JSON.stringify(stage));
      const env: NodeJS.ProcessEnv = {...process.env,NATIVE_STAGE_RESULT:"success",NATIVE_STATE:"ephemeral",
        FIRST_PGTAP_RESULT:"success",SECOND_PGTAP_RESULT:"success",NATIVE_REQUESTED_HEAD:"a".repeat(40),
        NATIVE_CHECKOUT_HEAD:"b".repeat(40),...overrides};
      for (const [key,value] of Object.entries(overrides)) if (value === undefined) delete env[key];
      const run = spawnSync(process.execPath,["--input-type=module","-e",gateCode],{cwd:temp,env,encoding:"utf8"});
      const receipt = JSON.parse(readFileSync(join(temp,"native-sql-rehearsal-receipt.json"),"utf8"));
      return {run,receipt};
    } finally { rmSync(temp,{recursive:true,force:true}); }
  }

  it("accepts two successful step outcomes and exact copies without claiming runtime authority or concurrency", () => {
    const {run,receipt} = runGate();
    expect(run.status,run.stderr).toBe(0);
    expect(receipt.gate).toBe("passed-native-sql-only");
    expect(receipt.fullQualification).toBe("pending");
    expect(receipt.realConcurrency).toBe("UNRUN");
    expect(receipt.records).toHaveLength(7);
    expect(receipt.privatePositiveFixtureEvidence.test).not.toBe(receipt.publicClosedGateEvidence.test);
    expect(receipt.checkoutHead).not.toBe(receipt.requestedHead);
  });

  it("requires the exact requested checkout for an admitted native scope", () => {
    const {run,receipt}=runGate({NATIVE_SCOPE_REQUIRED:"true"});
    expect(run.status).not.toBe(0);expect(receipt.gate).toBe("failed");
    expect(receipt.failures.join(" ")).toContain("exact requested head");
  });

  it("accepts required native scope only with matching head and both passes", () => {
    const {run,receipt}=runGate({NATIVE_SCOPE_REQUIRED:"true",NATIVE_CHECKOUT_HEAD:"a".repeat(40)},(_root,stage)=>{stage.checkoutHead="a".repeat(40);});
    expect(run.status,run.stderr).toBe(0);expect(receipt.gate).toBe("passed-native-sql-only");
    expect(receipt.checkoutHead).toBe(receipt.requestedHead);expect(receipt.fullQualification).toBe("pending");
  });

  it.each([
    ["failed staging",{NATIVE_STAGE_RESULT:"failure"}],
    ["skipped staging",{NATIVE_STAGE_RESULT:"skipped"}],
    ["absent staging",{NATIVE_STATE:"absent"}],
    ["skipped first pass",{FIRST_PGTAP_RESULT:"skipped"}],
    ["failed first pass",{FIRST_PGTAP_RESULT:"failure"}],
    ["cancelled second pass",{SECOND_PGTAP_RESULT:"cancelled"}],
    ["missing second pass",{SECOND_PGTAP_RESULT:undefined}],
  ])("rejects %s and retains separate unaccepted fixture evidence",(_label,overrides) => {
    const {run,receipt} = runGate(overrides);
    expect(run.status).not.toBe(0);expect(receipt.gate).toBe("failed");
    expect(receipt.privatePositiveFixtureEvidence.status).toBe("unaccepted");
    expect(receipt.publicClosedGateEvidence.status).toBe("unaccepted");
  });

  it.each([
    ["changed copy",(temp:string,stage:Stage) => writeFileSync(join(temp,stage.records[0].path),"-- changed")],
    ["duplicate source",(_temp:string,stage:Stage) => {stage.records[6]=stage.records[5];}],
    ["missing positive",(_temp:string,stage:Stage) => {stage.records.pop();}],
    ["wrong requested head",(_temp:string,stage:Stage) => {stage.requestedHead="c".repeat(40);}],
    ["undiscoverable fixture",(_temp:string,stage:Stage) => {stage.records[6].path="supabase/drafts/not-discovered.sql";}],
    ["unordered migration",(_temp:string,stage:Stage) => {stage.records[1].version=stage.records[0].version;}],
  ])("rejects %s despite two successful outcomes",(_label,mutate) => {
    const {run,receipt} = runGate({},mutate);
    expect(run.status).not.toBe(0);expect(receipt.gate).toBe("failed");
    expect(receipt.failures.length).toBeGreaterThan(0);
  });
});

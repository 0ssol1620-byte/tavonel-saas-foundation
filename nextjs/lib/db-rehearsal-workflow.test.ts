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

describe("db-rehearsal native World SQL acceptance", () => {
  const body = job("db-rehearsal");
  const stage = body.split("- name: Stage exact native World commit after native prerequisites")[1]?.split("# Artifact names are derived")[0] ?? "";
  const finalGate = body.split("- name: Require both disposable pgTAP passes for native World commit")[1]?.split("- name: Retain native World SQL acceptance")[0] ?? "";
  const gateCode = finalGate.split("node --input-type=module <<'NODE'\n")[1]?.split("\n          NODE")[0]?.split("\n").map(line => line.slice(10)).join("\n") ?? "";
  const inputs = [
    {source:"supabase/drafts/native-world-reduction-commit.sql",sha256:"de039c9204ccb8fcefc659cdc090468ed3f8ae20d97fc18af96228e76897a4db"},
    {source:"supabase/drafts/tests/native-world-reduction-commit.sql",sha256:"561d43d6f1f2a6c26a66e7e050db7b196d209939f337d2c773951d23f031cc62"},
  ];
  const prefix = Buffer.from("\\set ON_ERROR_STOP on\n\\set world_disposable 1\n\\set world_role unit\n\\set world_case none\n");
  const wrapperSha256 = "04a09fc2de7f66193366f3002a31892bf60170c1252ccfe099ff55a6fa0ade5a";
  const hash = (bytes:Buffer|string) => createHash("sha256").update(bytes).digest("hex");

  it("stages only on a disposable hosted runner after all exact native prerequisites and before reset", () => {
    expect(stage).not.toBe("");
    expect(body.indexOf("- name: Stage exact native World commit")).toBeGreaterThan(body.indexOf("- name: Stage exact native SQL drafts"));
    expect(body.indexOf("- name: Stage exact native World commit")).toBeLessThan(body.indexOf("- name: Read the head migration version"));
    for (const required of ['test "$RUNNER_ENVIRONMENT" = github-hosted', 'test "$present" -eq 2',
      'test "$WORLD_PREREQUISITE_RESULT" = success', 'test "$WORLD_PREREQUISITE_STATE" = ephemeral',
      'test "$WORLD_CHECKOUT_HEAD" = "$WORLD_REQUESTED_HEAD"', 'test "$previous_version" = "$WORLD_PREREQUISITE_VERSION"',
      'test "${#existing[@]}" -eq 0', '[[ "$version" > "$previous_version" ]]',
      'cmp -- "$schema" "${generated[0]}"', 'cmp -- "$fixture" <(tail -n +5 "$target")',
      "test ! -e \"$target\"", "prerequisiteStageSha256"]) expect(stage).toContain(required);
    const replay = body.split("- name: Apply the repair migrations a second time and re-run the suite")[1]?.split("- name: Require both disposable pgTAP passes for exact native SQL")[0] ?? "";
    expect(replay).not.toMatch(/native_|native-/);
    expect((body.match(/supabase test db\n/g) ?? []).length).toBe(2);
  });

  it("pins the corrected source bytes and self-contained unit wrapper without altering the SQL fixture", () => {
    for (const input of inputs) {
      expect(hash(readFileSync("../"+input.source))).toBe(input.sha256);
      for (const code of [stage,gateCode]) {expect(code).toContain(input.source);expect(code).toContain(input.sha256);}
    }
    const fixture = readFileSync("../"+inputs[1].source);
    expect(hash(Buffer.concat([prefix,fixture]))).toBe(wrapperSha256);
    for (const code of [stage,gateCode]) expect(code).toContain(wrapperSha256);
    for (const assertion of ["public gate stays false","public function closed","expired_before_entry","settled_past_expiry",
      "NATIVE_WORLD_RESERVATION_EXPIRED", "world_arm_expiry", "rollback;"]) expect(fixture.toString()).toContain(assertion);
    expect(stage).toContain("'\\set world_role unit'");
    expect(stage).toContain("'\\set world_case none'");
    expect(stage).not.toContain("world_role setup");
  });

  it("requires both actual outcomes plus prerequisite acceptance and keeps races/private doubles distinct", () => {
    for (const required of ["if: always() && steps.native-world-sql-drafts.outputs.state != 'absent'",
      "steps.native-world-sql-drafts.outcome", "steps.native-sql-acceptance.outcome", "steps.pgtap-first.outcome", "steps.pgtap-second.outcome",
      "publicClosedGateEvidence", "privateVerifierDoubleEvidence", "realConcurrency: 'UNRUN'", "reservationExpiryCrossSession: 'UNRUN'",
      "Separate barrier-controlled psql sessions/job outside the rollback-only unit transaction"]) expect(finalGate).toContain(required);
    expect(body).toContain("id: native-sql-acceptance");
    expect(body).toContain("path: native-world-sql-rehearsal-receipt.json");
    expect(stage+finalGate).not.toMatch(/world_role (setup|holder|contender|arm_expiry)/);
  });

  type Row = {kind:string;source:string;path:string;sha256:string;copySha256:string;version:string};
  type Stage = {schemaVersion:number;state:string;requestedHead:string;checkoutHead:string;prerequisiteStageSha256:string;prerequisiteVersion:string;records:Row[]};
  function runGate(overrides:Record<string,string|undefined>={},mutate?:(root:string,stage:Stage)=>void) {
    const tempRoot=realpathSync(tmpdir()),temp=realpathSync(mkdtempSync(join(tempRoot,"native-world-sql-gate-")));
    if (dirname(temp)!==tempRoot || !basename(temp).startsWith("native-world-sql-gate-")) throw Error("Fixture cleanup path escaped temporary root");
    try {
      // Gate harness only: these success strings are doubles, never SQL execution evidence.
      const head="a".repeat(40),previousVersion="20261006120003";
      const prerequisite={schemaVersion:1,state:"ephemeral",requestedHead:head,checkoutHead:head,
        records:Array.from({length:7},(_,i)=>({kind:i<3?"migration":"test",source:`prior-source-${i}`,path:`prior-copy-${i}`,version:i<3?`2026100612000${i+1}`:"-"}))};
      const prerequisiteBytes=JSON.stringify(prerequisite);
      writeFileSync(join(temp,".native-sql-rehearsal-stage.json"),prerequisiteBytes);
      writeFileSync(join(temp,"native-sql-rehearsal-receipt.json"),JSON.stringify({...prerequisite,gate:"passed-native-sql-only",firstPgTapResult:"success",secondPgTapResult:"success"}));
      const records=inputs.map((input,i)=>{
        const path=i===0?"supabase/migrations/20261006120004_native_world_reduction_commit.sql":"supabase/tests/native_world_reduction_commit.sql";
        const source=readFileSync("../"+input.source);
        for(const target of [input.source,path]) mkdirSync(dirname(join(temp,target)),{recursive:true});
        writeFileSync(join(temp,input.source),source);
        writeFileSync(join(temp,path),i===0?source:Buffer.concat([prefix,source]));
        return {kind:i===0?"migration":"unit-test",source:input.source,path,sha256:input.sha256,copySha256:i===0?input.sha256:wrapperSha256,version:i===0?"20261006120004":"-"};
      });
      const stage:Stage={schemaVersion:1,state:"ephemeral",requestedHead:head,checkoutHead:head,
        prerequisiteStageSha256:hash(prerequisiteBytes),prerequisiteVersion:previousVersion,records};
      mutate?.(temp,stage);
      writeFileSync(join(temp,".native-world-sql-rehearsal-stage.json"),JSON.stringify(stage));
      const env:NodeJS.ProcessEnv={...process.env,WORLD_STAGE_RESULT:"success",WORLD_STATE:"ephemeral",WORLD_PREREQUISITE_RESULT:"success",
        FIRST_PGTAP_RESULT:"success",SECOND_PGTAP_RESULT:"success",WORLD_REQUESTED_HEAD:head,WORLD_CHECKOUT_HEAD:head,...overrides};
      for(const [key,value] of Object.entries(overrides)) if(value===undefined) delete env[key];
      const run=spawnSync(process.execPath,["--input-type=module","-e",gateCode],{cwd:temp,env,encoding:"utf8"});
      const receipt=JSON.parse(readFileSync(join(temp,"native-world-sql-rehearsal-receipt.json"),"utf8"));
      return {run,receipt};
    } finally {rmSync(temp,{recursive:true,force:true});}
  }

  it("accepts exact copies with simulated successful outcomes while leaving qualification and races pending",()=>{
    const {run,receipt}=runGate();expect(run.status,run.stderr).toBe(0);
    expect(receipt.gate).toBe("passed-native-world-unit-sql-only");expect(receipt.records).toHaveLength(2);
    expect(receipt.fullQualification).toBe("pending");expect(receipt.realConcurrency).toBe("UNRUN");
    expect(receipt.reservationExpiryCrossSession).toBe("UNRUN");
    expect(receipt.publicClosedGateEvidence.assertions).toEqual(["public gate stays false","public function closed"]);
    expect(receipt.privateVerifierDoubleEvidence.qualification).toContain("fake verifier");
    // Both assertion groups live in one owning fixture; do not invent separate test files.
    expect(receipt.publicClosedGateEvidence.test).toBe(receipt.privateVerifierDoubleEvidence.test);
  });

  it.each([
    ["failed staging",{WORLD_STAGE_RESULT:"failure"}], ["skipped staging",{WORLD_STAGE_RESULT:"skipped"}],
    ["absent staging",{WORLD_STATE:"absent"}], ["failed prerequisite",{WORLD_PREREQUISITE_RESULT:"failure"}],
    ["skipped prerequisite",{WORLD_PREREQUISITE_RESULT:"skipped"}], ["failed first pass",{FIRST_PGTAP_RESULT:"failure"}],
    ["skipped first pass",{FIRST_PGTAP_RESULT:"skipped"}], ["cancelled second pass",{SECOND_PGTAP_RESULT:"cancelled"}],
    ["missing second pass",{SECOND_PGTAP_RESULT:undefined}], ["wrong checkout",{WORLD_CHECKOUT_HEAD:"b".repeat(40)}],
  ])("rejects %s and records both fixture groups as unaccepted",(_label,overrides)=>{
    const {run,receipt}=runGate(overrides);expect(run.status).not.toBe(0);expect(receipt.gate).toBe("failed");
    expect(receipt.publicClosedGateEvidence.status).toBe("unaccepted");expect(receipt.privateVerifierDoubleEvidence.status).toBe("unaccepted");
  });

  it.each([
    ["changed schema",(root:string,stage:Stage)=>writeFileSync(join(root,stage.records[0].source),"changed")],
    ["changed migration",(root:string,stage:Stage)=>writeFileSync(join(root,stage.records[0].path),"changed")],
    ["changed fixture",(root:string,stage:Stage)=>writeFileSync(join(root,stage.records[1].source),"changed")],
    ["race preamble",(root:string,stage:Stage)=>writeFileSync(join(root,stage.records[1].path),"\\set world_role setup\n")],
    ["duplicate identities",(_root:string,stage:Stage)=>{stage.records[1]=stage.records[0];}],
    ["missing fixture",(_root:string,stage:Stage)=>{stage.records.pop();}],
    ["wrong requested head",(_root:string,stage:Stage)=>{stage.requestedHead="b".repeat(40);}],
    ["wrong stage version",(_root:string,stage:Stage)=>{stage.schemaVersion=2;}],
    ["unbound prerequisite",(_root:string,stage:Stage)=>{stage.prerequisiteStageSha256="0".repeat(64);}],
    ["unordered migration",(_root:string,stage:Stage)=>{stage.records[0].version=stage.prerequisiteVersion;}],
    ["undiscoverable test",(_root:string,stage:Stage)=>{stage.records[1].path="supabase/drafts/not-discovered.sql";}],
    ["unaccepted prerequisite",(root:string)=>writeFileSync(join(root,"native-sql-rehearsal-receipt.json"),JSON.stringify({gate:"failed"}))],
    ["mutated prerequisite",(root:string)=>writeFileSync(join(root,".native-sql-rehearsal-stage.json"),"{}")],
  ])("rejects %s despite simulated successful step outcomes",(_label,mutate)=>{
    const {run,receipt}=runGate({},mutate);expect(run.status).not.toBe(0);expect(receipt.gate).toBe("failed");expect(receipt.failures.length).toBeGreaterThan(0);
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

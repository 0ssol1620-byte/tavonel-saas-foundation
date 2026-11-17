import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkRound, mulberry32, REFUSAL, SCENARIOS, validateEnvironment } from "./plan-allowance-race.mjs";

const SCRIPT = fileURLToPath(new URL("./plan-allowance-race.mjs", import.meta.url));
const held = (scenario) => ({
  scenario, waited: true,
  a: { admitted: true, error: null },
  b: { admitted: false, error: REFUSAL[scenario] === "exhausted" ? "exhausted" : `ERROR: ${REFUSAL[scenario]}` },
  stored: { STORAGE: 2, SEAT_ACCEPT: 5, SEAT_INVITE: 5, KQU: 1 }[scenario],
  allowance: { STORAGE: 2, SEAT_ACCEPT: 5, SEAT_INVITE: 5, KQU: 1 }[scenario],
});
const rules = (round) => checkRound(round).map((v) => v.invariant);

test("a round that held has no violation, for every scenario", () => {
  for (const scenario of SCENARIOS) assert.deepEqual(checkRound(held(scenario)), [], scenario);
});

test("both sessions admitted is the race the meters exist to prevent", () => {
  const round = held("STORAGE");
  round.b = { admitted: true, error: null };
  round.stored = 3;
  assert.deepEqual(rules(round), ["R2", "R3", "R4"]);
});

test("a round where the second session never waited proves nothing", () => {
  assert.deepEqual(rules({ ...held("SEAT_ACCEPT"), waited: false }), ["R1"]);
});

test("a refusal for another reason is not the meter holding", () => {
  const round = held("SEAT_INVITE");
  round.b = { admitted: false, error: "ERROR: workspace_invite_pending" };
  assert.deepEqual(rules(round), ["R3"]);
});

test("neither admitted is also a violation", () => {
  const round = held("KQU");
  round.a = { admitted: false, error: "ERROR: knowledge_query_meter_contract_invalid" };
  round.stored = 0;
  assert.deepEqual(rules(round), ["R2", "R3", "R4"]);
});

test("environment: needs LOCAL_RACE_TEST=1 and a loopback host", () => {
  assert.throws(() => validateEnvironment({}, "postgres://postgres@127.0.0.1:55439/postgres"), /LOCAL_RACE_TEST=1/);
  assert.throws(() => validateEnvironment({ LOCAL_RACE_TEST: "1" }, "postgres://postgres@10.0.0.5:5432/postgres"), /non-loopback/);
  assert.deepEqual(validateEnvironment({ LOCAL_RACE_TEST: "1" }, "postgres://postgres@127.0.0.1:55439/postgres"), { host: "127.0.0.1", port: 55439 });
});

test("the seeded generator is deterministic", () => {
  const a = mulberry32(11), b = mulberry32(11);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("CLI refuses without the opt-in", () => {
  const env = { ...process.env }; delete env.LOCAL_RACE_TEST;
  const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /LOCAL_RACE_TEST=1/);
});

test("CLI fails closed (exit != 0) when no PostgreSQL answers on the port", () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, LOCAL_RACE_TEST: "1", RACE_PORT: "55479", RACE_ITERATIONS: "1" }, encoding: "utf8", timeout: 60000,
  });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /^PASS \d+ rounds/m);
});

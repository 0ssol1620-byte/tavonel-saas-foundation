import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkIteration, validateEnvironment, mulberry32 } from "./connector-acl-race.mjs";

const S = 1e6;
const T0 = 1_000_000 * S; // an arbitrary database-clock origin, in microseconds
const P1 = "drive-perm-viewer-1", P2 = "drive-perm-viewer-2";
const op = (kind, t0, t1, extra = {}) => ({ kind, t0: T0 + t0 * S, t1: T0 + t1 * S, ...extra });
const snap = (source, idx, c, o = {}) => ({ source, idx, c: T0 + c * S, complete: true, principals: [P1, P2], ...o });
const read = (a, b, o = {}) => ({ tenant: "A", kind: "own", fn: "blocked", viewer: "V1", docs: [0], maxAge: 300, invalid: false, t0: T0 + a * S, t1: T0 + b * S, allowed: true, error: null, raw: "f", ...o });
const tenant = (ws, seqs = {}, snaps = [snap(0, -1, 0), snap(1, -1, 0)]) => ({
  ws, viewers: { V1: { principal: P1 }, V2: { principal: P2 } }, seqs: { s0: [], s1: [], g: [], ...seqs }, snaps,
});
const history = (a, reads, b = tenant("pilot-b0000")) => ({ tenants: { A: a, B: b }, reads });
const rules = (h) => [...new Set(checkIteration(h).violations.map((v) => v.invariant))].sort();

test("a clean, fresh history is clean and every invariant counts assertions", () => {
  const r = checkIteration(history(tenant("pilot-a0000"), [
    read(10, 11), read(12, 13, { fn: "authorize", docs: [0, 1] }),
    read(14, 15, { invalid: true, maxAge: 901, allowed: false, error: "CONNECTOR_AUTH_SCOPE_INVALID" }),
    read(16, 17, { kind: "foreign_viewer", allowed: false }),
  ]));
  assert.deepEqual(r.violations, []);
  for (const k of ["I1", "I2", "I3", "I4", "I5"]) assert.ok(r.counts[k] > 0, k);
});

test("I1: allowed after a principal-link revoke is caught; a revoke still in flight is not", () => {
  const revoked = tenant("pilot-a0000", { g: [op("revoke_link", 20, 21, { viewer: "V1" })] });
  assert.deepEqual(rules(history(revoked, [read(30, 31)])), ["I1"]);
  assert.deepEqual(rules(history(revoked, [read(20.5, 25)])), [], "the revoke may not have committed yet");
  assert.deepEqual(rules(history(revoked, [read(30, 31, { viewer: "V2", docs: [0] })])), [], "another viewer's link is unaffected");
});

test("I1: allowed after a connection revoke, a suspension or a tombstone is caught", () => {
  assert.deepEqual(rules(history(tenant("pilot-a0000", { g: [op("revoke_conn", 20, 21)] }), [read(30, 31)])), ["I1"]);
  assert.deepEqual(rules(history(tenant("pilot-a0000", { s0: [op("suspend", 20, 21)] }), [read(30, 31)])), ["I1"]);
  assert.deepEqual(rules(history(tenant("pilot-a0000", { s0: [op("delete", 20, 21)] }), [read(30, 31)])), ["I1"]);
  assert.deepEqual(rules(history(tenant("pilot-a0000", { s0: [op("delete", 20, 21)] }), [read(30, 31, { docs: [1] })])), [], "the other source is unaffected");
});

test("I1: allowed with a stale snapshot is caught, and a fresher bound makes it legal", () => {
  const h = (maxAge) => history(tenant("pilot-a0000"), [read(400, 401, { maxAge })]);
  assert.deepEqual(rules(h(300)), ["I1"], "400 s old capture, 300 s bound");
  assert.deepEqual(rules(h(900)), [], "same capture within a 900 s bound");
  const aged = tenant("pilot-a0000", { s0: [op("age", 20, 21, { shiftUs: 1200 * S })] }, [snap(0, -1, 0 - 1200), snap(1, -1, 0)]);
  assert.deepEqual(rules(history(aged, [read(30, 31, { maxAge: 900 })])), ["I1"], "ageing moved the capture beyond the bound");
});

test("I1: allowed after a newer failure marker, or a newer capture that omits the viewer, is caught", () => {
  const failed = tenant("pilot-a0000", { s0: [op("snapshot", 20, 21)] }, [snap(0, -1, 0), snap(1, -1, 0), snap(0, 0, 21, { complete: false, principals: [] })]);
  assert.deepEqual(rules(history(failed, [read(30, 31)])), ["I1"]);
  assert.deepEqual(rules(history(failed, [read(20.5, 25)])), [], "the marker may not have committed yet");
  const without = tenant("pilot-a0000", { s0: [op("snapshot", 20, 21)] }, [snap(0, -1, 0), snap(1, -1, 0), snap(0, 0, 21, { principals: [P2] })]);
  assert.deepEqual(rules(history(without, [read(30, 31)])), ["I1"]);
  assert.deepEqual(rules(history(without, [read(30, 31, { viewer: "V2" })])), [], "V2 is named by the newer capture");
});

test("I1: authorize is refused once any capture of the job has been moved", () => {
  const aged = tenant("pilot-a0000", { s1: [op("age", 20, 21, { shiftUs: 20 * S })] }, [snap(0, -1, 0), snap(1, -1, -20)]);
  assert.deepEqual(rules(history(aged, [read(30, 31, { fn: "authorize", docs: [0, 1] })])), ["I1"]);
});

test("I2: invalid max-age, an invalid phase or a disabled flag that is allowed is caught", () => {
  assert.deepEqual(rules(history(tenant("pilot-a0000"), [read(10, 11, { invalid: true, maxAge: 0, allowed: true })])), ["I2"]);
  assert.deepEqual(rules(history(tenant("pilot-a0000"), [read(10, 11, { fn: "authorize", docs: [0, 1], invalid: true, allowed: true })])), ["I2"]);
});

test("I3: a clean fresh state that is blocked fails the non-vacuity check; an in-flight mutation excuses a block", () => {
  assert.deepEqual(rules(history(tenant("pilot-a0000"), [read(10, 11, { allowed: false })])), ["I3"]);
  const busy = tenant("pilot-a0000", { s0: [op("snapshot", 10, 12)] }, [snap(0, -1, 0), snap(1, -1, 0), snap(0, 0, 11, { complete: false, principals: [] })]);
  assert.deepEqual(rules(history(busy, [read(10.5, 11, { allowed: false })])), []);
  const near = tenant("pilot-a0000");
  assert.deepEqual(rules(history(near, [read(299.5, 300.5, { allowed: false })])), [], "the age bound falls inside the window, so a block is legal");
});

test("I4: a foreign viewer that is admitted is caught", () => {
  assert.deepEqual(rules(history(tenant("pilot-a0000"), [read(10, 11, { kind: "foreign_viewer", allowed: true })])), ["I4"]);
});

test("I5: unexpected errors, leaks and refused captures without a connection revoke are caught", () => {
  assert.deepEqual(rules(history(tenant("pilot-a0000"), [read(10, 11, { allowed: false, error: "boom" })])), ["I1", "I3", "I5"].sort());
  assert.deepEqual(rules(history(tenant("pilot-a0000"), [read(10, 11, { raw: "f pilot-b0000" })])), ["I5"]);
  const refused = tenant("pilot-a0000", { s0: [op("snapshot", 20, 21, { refused: true })] });
  assert.deepEqual(rules(history(refused, [])), ["I5"]);
  const ok = tenant("pilot-a0000", { s0: [op("snapshot", 20, 21, { refused: true })], g: [op("revoke_conn", 10, 11)] });
  assert.deepEqual(rules(history(ok, [])), []);
});

test("unbound documents are an observation, never a violation", () => {
  assert.deepEqual(rules(history(tenant("pilot-a0000"), [read(10, 11, { kind: "unbound", allowed: true })])), []);
});

test("validateEnvironment refuses without the opt-in and for a non-loopback host", () => {
  assert.throws(() => validateEnvironment({}, "postgres://postgres@127.0.0.1:55439/postgres"), /LOCAL_RACE_TEST=1/);
  assert.throws(() => validateEnvironment({ LOCAL_RACE_TEST: "1" }, "postgres://postgres@db.example.com:5432/postgres"), /non-loopback/);
  assert.equal(typeof mulberry32(1)(), "number");
});

test("CLI refuses without the opt-in", () => {
  const env = { ...process.env }; delete env.LOCAL_RACE_TEST;
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./connector-acl-race.mjs", import.meta.url))], { env, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /LOCAL_RACE_TEST=1/);
});

test("CLI fails closed (exit != 0) when no PostgreSQL answers on the port", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./connector-acl-race.mjs", import.meta.url))],
    { env: { ...process.env, LOCAL_RACE_TEST: "1", RACE_PORT: "55478", RACE_ITERATIONS: "2" }, encoding: "utf8", timeout: 60000 });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /^PASS/m);
});

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkIteration, validateEnvironment, mulberry32 } from "./job-lease-race.mjs";

const J = "job-" + "a".repeat(32);
const ev = (seq, type, state, attempt, seen = 0, done = 0) => ({ seq, type, state, attempt, itemsSeen: seen, itemsDone: done });
const clean = () => ({
  ops: [
    { phase: 0, op: "enqueue", ws: "w", key: "k", jobId: J, error: null },
    { phase: 0, op: "enqueue", ws: "w", key: "k", jobId: null, error: "unique_violation" },
    { phase: 1, op: "claim", worker: "a", jobId: J, cursor: null },
    { phase: 2, op: "complete", worker: "a", jobId: J, outcome: "progress", accepted: true, cursor: "c1" },
    { phase: 4, op: "claim", worker: "b", jobId: J, cursor: "c1" },
    { phase: 5, op: "complete", worker: "a", jobId: J, outcome: "progress", accepted: false, cursor: null, before: { itemsDone: 2, cursor: "c1" }, after: { itemsDone: 2, cursor: "c1" } },
  ],
  enqueueRows: [{ ws: "w", key: "k", jobId: J }],
  rows: [{ jobId: J, state: "leased", attempt: 1, itemsSeen: 3, itemsDone: 2 }],
  events: { [J]: [ev(1, "enqueued", "queued", 0), ev(2, "state_changed", "leased", 1), ev(5, "progressed", "queued", 0, 3, 2), ev(9, "state_changed", "leased", 1, 3, 2)] },
});
const rule = (h) => [...new Set(checkIteration(h).violations.map((v) => v.invariant))];

test("a consistent history has no violations and counts its assertions", () => {
  const r = checkIteration(clean());
  assert.deepEqual(r.violations, []);
  for (const k of ["I1", "I2", "I3", "I4", "I6"]) assert.ok(r.counts[k] > 0, k);
});

test("double lease: same job claimed twice in one phase, or while held", () => {
  const same = clean(); same.ops.splice(3, 0, { phase: 1, op: "claim", worker: "z", jobId: J, cursor: null });
  assert.ok(rule(same).includes("I2"));
  const held = clean(); held.ops = held.ops.filter((o) => o.op !== "complete" || o.phase === 5);
  assert.ok(rule(held).includes("I2"));
});

test("a stale worker's accepted completion, or one that moved the cursor, is flagged", () => {
  const accepted = clean(); accepted.ops[5] = { ...accepted.ops[5], accepted: true };
  assert.ok(rule(accepted).includes("I3"));
  const moved = clean(); moved.ops[5].after = { itemsDone: 102, cursor: "stale" };
  assert.ok(rule(moved).includes("I3"));
});

test("a takeover claim that does not see the last committed cursor is flagged", () => {
  const h = clean(); h.ops[4].cursor = "other";
  assert.ok(rule(h).includes("I4"));
});

test("a cancelled job that is re-claimed or not left cancelled is flagged", () => {
  const h = clean();
  h.ops = [h.ops[0], h.ops[2], { phase: 2, op: "cancel", jobId: J, applied: true }, { phase: 4, op: "claim", worker: "b", jobId: J, cursor: null }];
  h.rows[0].state = "canceled";
  assert.deepEqual(rule(h).filter((r) => r === "I5"), ["I5"]);
});

test("duplicate enqueue that yields two live jobs or two ids is flagged", () => {
  const two = clean(); two.enqueueRows.push({ ws: "w", key: "k", jobId: "job-" + "b".repeat(32) });
  assert.ok(rule(two).includes("I1"));
  const ids = clean(); ids.ops[1] = { phase: 0, op: "enqueue", ws: "w", key: "k", jobId: "job-" + "b".repeat(32), error: null };
  assert.ok(rule(ids).includes("I1"));
});

test("event ledger: sequence gap in transitions, wrong head, non-increasing seq, stale tail", () => {
  const skip = clean(); skip.events[J][2].attempt = 3; assert.ok(rule(skip).includes("I6"));
  const head = clean(); head.events[J][0].type = "state_changed"; assert.ok(rule(head).includes("I6"));
  const order = clean(); order.events[J][2].seq = 2; assert.ok(rule(order).includes("I6"));
  const tail = clean(); tail.events[J].pop(); assert.ok(rule(tail).includes("I6"));
  const illegal = clean(); illegal.events[J][1].state = "succeeded"; illegal.events[J][2].state = "leased"; assert.ok(rule(illegal).includes("I6"));
});

test("environment: needs LOCAL_RACE_TEST=1 and a loopback host", () => {
  assert.throws(() => validateEnvironment({}, "postgres://postgres@127.0.0.1:55439/postgres"), /LOCAL_RACE_TEST=1/);
  assert.throws(() => validateEnvironment({ LOCAL_RACE_TEST: "1" }, "postgres://postgres@10.0.0.5:5432/postgres"), /non-loopback/);
  assert.deepEqual(validateEnvironment({ LOCAL_RACE_TEST: "1" }, "postgres://postgres@127.0.0.1:55439/postgres"), { host: "127.0.0.1", port: 55439 });
});

test("the seeded generator is deterministic", () => {
  const a = mulberry32(7), b = mulberry32(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("CLI refuses without the opt-in", () => {
  const env = { ...process.env }; delete env.LOCAL_RACE_TEST;
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./job-lease-race.mjs", import.meta.url))], { env, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /LOCAL_RACE_TEST=1/);
});

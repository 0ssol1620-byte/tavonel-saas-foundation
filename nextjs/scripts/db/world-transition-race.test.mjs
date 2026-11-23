import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkIteration, validateEnvironment, mulberry32, KNOWN_REFUSALS } from "./world-transition-race.mjs";

const D1 = "d1000000-0000-4000-8000-000000000001", D2 = "d1000000-0000-4000-8000-000000000002";
const ADMIN = "d1520001-0000-4000-8000-000000000000", MEMBER = "d1520003-0000-4000-8000-000000000000", OWNER = "d1520000-0000-4000-8000-000000000000";
const S1 = "src-" + "1".repeat(64), dg = (c) => "sha256:" + c.repeat(64);
const OP1 = "00000000-0000-4000-8000-000000000001", OP2 = "00000000-0000-4000-8000-000000000002";
const ok = (operationId, o) => ({ operationId, action: "activate", cross: false, actor: ADMIN, docs: [], ok: true, error: null, message: null, raw: "{}", t0: 10, t1: 11, ...o });
const no = (operationId, error, o = {}) => ({ operationId, action: "activate", cross: false, actor: ADMIN, docs: [], ok: false, status: null, error, message: error, raw: "", t0: 10, t1: 11, ...o });
const clean = () => ({
  bIds: ["pilot-bbbb00000000", "collection-" + "b".repeat(32), dg("b")],
  bBefore: "md5-b", bAfter: "md5-b",
  members: { [ADMIN]: [{ rev: 1, role: "admin", state: "active" }], [MEMBER]: [{ rev: 1, role: "member", state: "active" }], [OWNER]: [{ rev: 1, role: "owner", state: "active" }] },
  memberMuts: [],
  supersedes: [],
  ops: [
    ok(OP1, { status: "applied", revision: 1, receiptSha: dg("e"), requestSha: dg("f"), docs: [D1], t0: 10, t1: 11 }),
    ok(OP1, { status: "replayed", revision: 1, receiptSha: dg("e"), requestSha: dg("f"), docs: [D1], t0: 20, t1: 21 }),
    ok(OP2, { status: "applied", revision: 2, receiptSha: dg("c"), requestSha: dg("d"), actor: OWNER, docs: [], t0: 30, t1: 31 }),
    no("00000000-0000-4000-8000-000000000003", "world_transition_forbidden", { actor: MEMBER, t0: 40, t1: 41 }),
    no("00000000-0000-4000-8000-000000000004", "world_transition_forbidden", { cross: true, actor: ADMIN }),
  ],
  final: {
    pointer: { revision: 2, digest: dg("2") }, activeVersions: [dg("2")], eventCount: 2,
    receipts: [
      { operationId: OP1, outcome: "applied", before: 0, after: 1, from: null, to: dg("1"), actor: ADMIN, role: "admin", authRev: 1, receiptSha: dg("e"), requestSha: dg("f"), createdUs: 2000 },
      { operationId: OP2, outcome: "applied", before: 1, after: 2, from: dg("1"), to: dg("2"), actor: OWNER, role: "owner", authRev: 1, receiptSha: dg("c"), requestSha: dg("d"), createdUs: 3000 },
    ],
    bindings: [{ docId: D1, sourceId: S1, versionId: "sv-" + "1".repeat(64), recordedUs: 1000 }],
  },
});
const rule = (h) => [...new Set(checkIteration(h).violations.map((v) => v.invariant))];

test("a consistent history has no violations and counts assertions for every invariant", () => {
  const r = checkIteration(clean());
  assert.deepEqual(r.violations, []);
  for (const k of ["I1", "I2", "I3", "I4", "I5"]) assert.ok(r.counts[k] > 0, k);
});

test("I1: two applied results for one revision, or a pointer that outran the receipts, is a double advance", () => {
  const twice = clean();
  twice.ops.push(ok("00000000-0000-4000-8000-000000000009", { status: "applied", revision: 1, receiptSha: dg("9"), requestSha: dg("8") }));
  assert.ok(rule(twice).includes("I1"));
  const ahead = clean(); ahead.final.pointer = { revision: 3, digest: dg("2") };
  assert.ok(rule(ahead).includes("I1"));
  const broken = clean(); broken.final.receipts[1].from = dg("7");
  assert.ok(rule(broken).includes("I1"));
  const noEvent = clean(); noEvent.final.eventCount = 1;
  assert.ok(rule(noEvent).includes("I1"));
  const twoActive = clean(); twoActive.final.activeVersions = [dg("1"), dg("2")];
  assert.ok(rule(twoActive).includes("I1"));
});

test("I2: an applied promote by a revoked actor is flagged", () => {
  const h = clean();
  h.members[ADMIN] = [{ rev: 1, role: "admin", state: "active" }, { rev: 2, role: "admin", state: "revoked" }];
  h.final.receipts[0].authRev = 2;
  assert.ok(rule(h).includes("I2"));
});

test("I2: a receipt bound to an older revision than the settled one is a stale authorization", () => {
  const h = clean();
  h.members[ADMIN].push({ rev: 2, role: "admin", state: "revoked" }, { rev: 3, role: "admin", state: "active" });
  h.memberMuts = [{ user: ADMIN, t0: 1, t1: 2, rev: 2 }, { user: ADMIN, t0: 3, t1: 4, rev: 3 }];
  assert.ok(rule(h).includes("I2"));
  const overlapping = clean(); // the same history, but a mutation overlaps the call: the settled revision is unknown, no claim
  overlapping.members[ADMIN].push({ rev: 2, role: "admin", state: "revoked" });
  overlapping.memberMuts = [{ user: ADMIN, t0: 9, t1: 100, rev: 2 }];
  assert.deepEqual(rule(overlapping), []);
});

test("I2: a forbidden for an actor who was a settled active admin is a spurious refusal; for a member it is not", () => {
  const h = clean(); h.ops[3].actor = ADMIN;
  assert.ok(rule(h).includes("I2"));
});

test("I3: an applied promote after its source was superseded is flagged (database clock and harness clock)", () => {
  const db = clean(); db.final.bindings.push({ docId: D2, sourceId: S1, versionId: "sv-" + "2".repeat(64), recordedUs: 1500 });
  assert.ok(rule(db).includes("I3"));
  const clock = clean();
  clock.final.bindings.push({ docId: D2, sourceId: S1, versionId: "sv-" + "2".repeat(64), recordedUs: 2500 }); // after the receipt, so the database clock sees nothing wrong
  clock.supersedes = [{ sourceId: S1, docId: D2, outcome: "recorded", t1: 5 }]; // but it had finished before the call started
  assert.ok(rule(clock).includes("I3"));
  const later = clean();
  later.final.bindings.push({ docId: D2, sourceId: S1, versionId: "sv-" + "2".repeat(64), recordedUs: 2500 });
  later.supersedes = [{ sourceId: S1, docId: D2, outcome: "recorded", t1: 15 }];
  assert.deepEqual(rule(later), []);
});

test("I3: a superseded refusal with no newer revision of any named document is unjustified", () => {
  const h = clean(); h.ops.push(no("00000000-0000-4000-8000-000000000005", "world_source_revision_superseded", { docs: [D1] }));
  assert.ok(rule(h).includes("I3"));
  h.final.bindings.push({ docId: D2, sourceId: S1, versionId: "sv-" + "2".repeat(64), recordedUs: 4000 });
  assert.ok(!rule(h).includes("I3"));
});

test("I4: a replay that returns a different receipt, an unmatched replay, a second original, or an accepted changed body is flagged", () => {
  const differ = clean(); differ.ops[1].receiptSha = dg("a");
  assert.ok(rule(differ).includes("I4"));
  const orphan = clean(); orphan.ops.splice(0, 1);
  assert.ok(rule(orphan).includes("I4"));
  const second = clean(); second.ops[1].status = "already_active";
  assert.ok(rule(second).includes("I4"));
  const changed = clean(); changed.ops.push(ok(OP1, { status: "applied", revision: 3, receiptSha: dg("e"), requestSha: dg("b"), mustConflict: true }));
  assert.ok(rule(changed).includes("I4"));
  const refused = clean(); refused.ops.push(no(OP1, "world_transition_idempotency_conflict", { mustConflict: true }));
  assert.deepEqual(rule(refused), []);
  const wrongToken = clean(); wrongToken.ops.push(no(OP1, "world_transition_compare_and_swap_conflict", { mustConflict: true }));
  assert.ok(rule(wrongToken).includes("I4"));
});

test("I5: a refusal naming an identifier of workspace B, an unknown token, or extra text is flagged", () => {
  const leak = clean(); leak.ops[3].message = "world_transition_forbidden pilot-bbbb00000000"; leak.ops[3].error = null;
  assert.ok(rule(leak).includes("I5"));
  const unknown = clean(); unknown.ops.push(no("00000000-0000-4000-8000-000000000006", "world_active_pointer_invariant_broken"));
  assert.ok(rule(unknown).includes("I5"));
  assert.ok(!KNOWN_REFUSALS.has("world_active_pointer_invariant_broken"));
  const deadlock = clean(); deadlock.ops.push(no("00000000-0000-4000-8000-000000000007", null, { message: "deadlock detected" }));
  assert.ok(rule(deadlock).includes("I5"));
  const leakedOk = clean(); leakedOk.ops[0].raw = JSON.stringify({ manifestDigest: dg("b") });
  assert.ok(rule(leakedOk).includes("I5"));
});

test("I5: an accepted cross-tenant call and a change to workspace B are flagged", () => {
  const cross = clean(); cross.ops[4] = ok("00000000-0000-4000-8000-000000000004", { cross: true, status: "applied", revision: 1, receiptSha: dg("5"), requestSha: dg("6") });
  assert.ok(rule(cross).includes("I5"));
  const changed = clean(); changed.bAfter = "md5-other";
  assert.ok(rule(changed).includes("I5"));
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
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./world-transition-race.mjs", import.meta.url))], { env, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /LOCAL_RACE_TEST=1/);
});

test("CLI fails closed (exit != 0) when no PostgreSQL answers on the port", () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("./world-transition-race.mjs", import.meta.url))],
    { env: { ...process.env, LOCAL_RACE_TEST: "1", RACE_PORT: "55477", RACE_ITERATIONS: "2" }, encoding: "utf8", timeout: 60000 });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /^PASS/m);
});

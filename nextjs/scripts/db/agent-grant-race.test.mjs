import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCENARIOS, KNOWN_REFUSALS, BOUND_MS, LOCK_TIMEOUT_MS, checkBound, checkI12A, checkI12B, checkI13, checkI8, checkKill, checkLeaf, mulberry32,
  parseOutcome, planIteration, validateEnvironment,
} from "./agent-grant-race.mjs";

const ok = (value) => ({ ok: true, value, error: null });
const no = (error) => ({ ok: false, value: null, error });
const rules = (violations) => [...new Set(violations.map((v) => v.invariant))].sort();

test("parseOutcome reads the last output line as JSON and an ERROR line as its token", () => {
  assert.deepEqual(parseOutcome({ out: 'SET\n{"state":"confirmed"}', err: "" }), ok({ state: "confirmed" }));
  assert.deepEqual(parseOutcome({ out: "", err: "ERROR:  proposal_open_limit" }), no("proposal_open_limit"));
  assert.equal(parseOutcome({ out: "", err: "" }).ok, false);
  assert.equal(parseOutcome({ out: "not json", err: "" }).ok, false);
});

test("planIteration is a pure function of the seed and orders every scenario once", () => {
  const a = planIteration(mulberry32(7)), b = planIteration(mulberry32(7));
  assert.deepEqual(a, b);
  assert.deepEqual([...a.order].sort(), [...SCENARIOS].sort());
  const orders = new Set(Array.from({ length: 50 }, (_, i) => planIteration(mulberry32(i)).order.join(",")));
  assert.ok(orders.size > 5, "different seeds give different orders");
});

test("I12A: a refused create that waited, nothing left open, is clean", () => {
  assert.deepEqual(checkI12A({ create: no("proposal_agent_grant_revoked"), blocked: true, openRowsOfGrant: 0, grantRevoked: true }), []);
});

test("I12A: a create that waited on the revoke and was admitted is a violation (grant read without for share)", () => {
  assert.deepEqual(rules(checkI12A({ create: ok({ replayed: false }), blocked: true, openRowsOfGrant: 1, grantRevoked: true })), ["I12"]);
});

test("I12A: an open row of a revoked grant is a violation even when the waiter was never seen blocked", () => {
  assert.deepEqual(rules(checkI12A({ create: ok({ replayed: false }), blocked: false, openRowsOfGrant: 1, grantRevoked: true })), ["I12"]);
  assert.deepEqual(rules(checkI12A({ create: no("proposal_agent_grant_revoked"), blocked: false, openRowsOfGrant: 0, grantRevoked: false })), ["I12"]);
});

test("I12B: a created row the revoke withdrew is clean; a row left proposed or a refused create is not", () => {
  const clean = { create: ok({ replayed: false }), revoke: ok({ proposalsWithdrawn: 1 }), rowState: "withdrawn", openRowsOfGrant: 0 };
  assert.deepEqual(checkI12B(clean), []);
  assert.deepEqual(rules(checkI12B({ ...clean, rowState: "proposed", openRowsOfGrant: 1 })), ["I12"]);
  assert.deepEqual(rules(checkI12B({ ...clean, revoke: ok({ proposalsWithdrawn: 0 }) })), ["I12"]);
  assert.deepEqual(rules(checkI12B({ ...clean, create: no("proposal_agent_grant_revoked") })), ["I12"]);
});

test("I8: exactly one confirm wins", () => {
  assert.deepEqual(checkI8({ decides: [ok({ state: "confirmed" }), no("proposal_not_decidable")], finalState: "confirmed" }), []);
  assert.deepEqual(rules(checkI8({ decides: [ok({ state: "confirmed" }), ok({ state: "confirmed" })], finalState: "confirmed" })), ["I8"]);
  assert.deepEqual(rules(checkI8({ decides: [no("proposal_not_decidable"), no("proposal_not_decidable")], finalState: "proposed" })), ["I8"]);
});

test("I13: exactly one of two creates at limit - 1 is admitted", () => {
  const clean = { creates: [ok({ replayed: false }), no("proposal_open_limit")], openBefore: 4, openAfter: 5, limit: 5 };
  assert.deepEqual(checkI13(clean), []);
  assert.deepEqual(rules(checkI13({ ...clean, creates: [ok({ replayed: false }), ok({ replayed: false })], openAfter: 6 })), ["I13"]);
  assert.deepEqual(rules(checkI13({ ...clean, creates: [no("proposal_open_limit"), no("proposal_open_limit")], openAfter: 4 })), ["I13"]);
});

test("LEAF: exactly one of two corrections of one base is recorded, the other is base-not-head", () => {
  const clean = { records: [ok({ replayed: false }), no("review_base_not_head")], correctionsOfBase: 1 };
  assert.deepEqual(checkLeaf(clean), []);
  assert.deepEqual(checkLeaf({ ...clean, records: [no("review_base_not_head"), ok({ replayed: false })] }), []);
  // The mutant without the advisory lock: both see no correction and both insert.
  assert.deepEqual(rules(checkLeaf({ records: [ok({ replayed: false }), ok({ replayed: false })], correctionsOfBase: 2 })), ["LEAF"]);
  assert.deepEqual(rules(checkLeaf({ records: [ok({ replayed: false }), ok({ replayed: true })], correctionsOfBase: 1 })), ["LEAF"]);
  assert.deepEqual(rules(checkLeaf({ ...clean, correctionsOfBase: 0 })), ["LEAF"]);
  assert.deepEqual(rules(checkLeaf({ records: [ok({ replayed: false }), no("deadlock detected")], correctionsOfBase: 1 })), ["ERR", "LEAF"]);
  assert.ok(KNOWN_REFUSALS.has("review_base_not_head"));
  assert.ok(SCENARIOS.includes("LEAF"));
});

test("KILL: a grant committed before revoke-all's commit and revoked with its key is clean; one committed after and live is clean", () => {
  const first = { create: ok({ grantId: "g" }), revoke: ok({ grants: 2 }), createCommittedFirst: true, grantRevoked: true, keyRevoked: true };
  assert.deepEqual(checkKill(first), []);
  assert.deepEqual(checkKill({ ...first, createCommittedFirst: false, grantRevoked: false, keyRevoked: false }), []);
  assert.ok(SCENARIOS.includes("KILLA") && SCENARIOS.includes("KILLB"));
});

test("KILL: the mutant without the lock -- a grant committed before revoke-all's commit left live -- is a violation", () => {
  const survived = { create: ok({ grantId: "g" }), revoke: ok({ grants: 1 }), createCommittedFirst: true, grantRevoked: false, keyRevoked: false };
  assert.deepEqual(rules(checkKill(survived)), ["KILL"]);
  assert.deepEqual(rules(checkKill({ ...survived, grantRevoked: true })), ["KILL"], "a revoked grant whose key is live is a violation");
  assert.deepEqual(rules(checkKill({ ...survived, keyRevoked: true })), ["KILL"], "a live grant whose key is revoked is a violation");
});

test("KILL: a creation after the kill switch that is revoked anyway, a refused creation, a failed revoke-all are violations", () => {
  const after = { create: ok({ grantId: "g" }), revoke: ok({ grants: 1 }), createCommittedFirst: false, grantRevoked: true, keyRevoked: true };
  assert.deepEqual(rules(checkKill(after)), ["KILL"]);
  assert.deepEqual(rules(checkKill({ ...after, create: no("api_key_authorization_changed") })), ["ERR", "KILL"]);
  assert.deepEqual(rules(checkKill({ ...after, revoke: no("deadlock detected") })), ["ERR", "KILL"]);
});

test("BOUND: a waiter refused agent_grant_lock_timeout inside the bound, nothing changed, and a retry that took effect is clean", () => {
  const clean = { waiter: no("agent_grant_lock_timeout"), elapsedMs: LOCK_TIMEOUT_MS + 40, unchanged: true, retry: ok({ grants: 2 }), retryTookEffect: true };
  assert.deepEqual(checkBound(clean), []);
  assert.ok(SCENARIOS.includes("BOUNDA") && SCENARIOS.includes("BOUNDB"));
  assert.ok(KNOWN_REFUSALS.has("agent_grant_lock_timeout"));
});

test("BOUND: the mutant without lock_timeout -- still waiting at the bound, then going on to succeed -- is a violation", () => {
  const hung = { waiter: ok({ grants: 2 }), elapsedMs: Infinity, unchanged: false, retry: ok({ grants: 0 }), retryTookEffect: true };
  assert.deepEqual(rules(checkBound(hung)), ["BOUND"]);
  assert.equal(checkBound(hung).length, 3, "past the bound, not the timeout token, and changed the store");
});

test("BOUND: a half state, a raw lock error, a late answer, a failed or ineffective retry are each a violation", () => {
  const clean = { waiter: no("agent_grant_lock_timeout"), elapsedMs: 2100, unchanged: true, retry: ok({}), retryTookEffect: true };
  assert.deepEqual(rules(checkBound({ ...clean, unchanged: false })), ["BOUND"]);
  assert.deepEqual(rules(checkBound({ ...clean, waiter: no("canceling statement due to lock timeout") })), ["BOUND", "ERR"]);
  assert.deepEqual(rules(checkBound({ ...clean, elapsedMs: BOUND_MS + 1 })), ["BOUND"]);
  assert.deepEqual(rules(checkBound({ ...clean, retry: no("agent_grant_lock_timeout") })), ["BOUND"]);
  assert.deepEqual(rules(checkBound({ ...clean, retryTookEffect: false })), ["BOUND"]);
});

test("LOCK_TIMEOUT_MS is the lock_timeout both functions of migration 20261117130300 set", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261117130300_agent_grant_lock_timeout.sql", import.meta.url), "utf8");
  const set = [...sql.matchAll(/security definer set search_path = '' set lock_timeout = '(\d+)ms' as \$\$/g)].map((m) => Number(m[1]));
  assert.deepEqual(set, [LOCK_TIMEOUT_MS, LOCK_TIMEOUT_MS]);
  assert.ok(BOUND_MS > LOCK_TIMEOUT_MS);
});

test("an unknown refusal (a deadlock, a typo) is flagged in every scenario", () => {
  assert.ok(!KNOWN_REFUSALS.has("deadlock detected"));
  assert.deepEqual(rules(checkI8({ decides: [ok({ state: "confirmed" }), no("deadlock detected")], finalState: "confirmed" })), ["ERR", "I8"]);
  assert.deepEqual(rules(checkI12A({ create: no("deadlock detected"), blocked: false, openRowsOfGrant: 0, grantRevoked: true })), ["ERR"]);
});

test("the harness refuses to run without LOCAL_RACE_TEST=1 or against a non-loopback host", () => {
  assert.throws(() => validateEnvironment({}, "postgres://postgres@127.0.0.1:55439/postgres"), /LOCAL_RACE_TEST=1/);
  assert.throws(() => validateEnvironment({ LOCAL_RACE_TEST: "1" }, "postgres://postgres@db.example.com:5432/postgres"), /non-loopback/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { check, mutatorScript, readerScript } from "./member-scope-race.mjs";

// Two rounds: grant [10,20], revoke [40,50] (scope kind), grant [100,110], revoke [140,150] (membership kind).
const mutations = [
  ["GB", "0", "10"], ["GA", "0", "20"], ["RB", "0", "40"], ["RA", "0", "50"],
  ["GB", "1", "100"], ["GA", "1", "110"], ["RB", "1", "140"], ["RA", "1", "150"],
];
// One reader: read k's window is [S k, S k+1].
const reader = (verdicts) => verdicts.flatMap(([start, verdict], k) => [["S", String(k), String(start)], ["V", String(k), verdict]])
  .concat([["S", String(verdicts.length), String(verdicts.at(-1)[0] + 5)]]);
// Windows end at the next read's start, so [22,25], [60,63], [112,115] and [160,165] are judged; the rest span a mutation.
const clean = [[22, "allow"], [25, "allow"], [60, "deny"], [63, "deny"], [112, "allow"], [115, "allow"], [160, "deny"]];

test("a clean history passes and is not vacuous", () => {
  const { violations, stats } = check(mutations, [reader(clean)]);
  assert.deepEqual(violations, []);
  assert.deepEqual(stats.afterRevoke, [1, 1]);
  assert.equal(stats.insideGrantAllowed, 2);
});

test("a read admitted after a revoke committed is an I1 violation", () => {
  const leaked = clean.map(([t, v]) => (t === 160 ? [t, "allow"] : [t, v]));
  const { violations } = check(mutations, [reader(leaked)]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].invariant, "I1");
});

test("a gate that refuses everything fails I2", () => {
  const { violations } = check(mutations, [reader(clean.map(([t]) => [t, "deny"]))]);
  assert.ok(violations.some((v) => v.invariant === "I2"));
});

test("a read overlapping a mutation is not judged either way", () => {
  // [45, 60]: starts before the revoke's after-stamp, so either verdict is legal.
  const { violations } = check(mutations, [reader([[22, "allow"], [25, "allow"], [45, "allow"], [60, "deny"], [63, "deny"], [112, "allow"], [115, "allow"], [160, "deny"]])]);
  assert.deepEqual(violations, []);
});

test("an incomplete mutation round or an unreadable verdict is refused, not skipped", () => {
  assert.throws(() => check(mutations.slice(0, 7), [reader(clean)]), /incomplete/);
  assert.throws(() => check(mutations, [reader([[22, "maybe"]])]), /unreadable verdict/);
});

test("the scripts alternate both revoke kinds and both read functions", () => {
  const m = mutatorScript(2, () => 0.5);
  assert.match(m, /'listed', array\[\]::uuid\[\]/);
  assert.match(m, /revoke_foundation_workspace_member/);
  const r = readerScript(2);
  assert.match(r, /documents_outside_member_scope/);
  assert.match(r, /member_readable_document_ids/);
});

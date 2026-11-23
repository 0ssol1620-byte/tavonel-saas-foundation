import test from "node:test";
import assert from "node:assert/strict";
import { CASES, EXPECTED, EXPIRY_MS, WAIT_MS, checkCase, main, outcomeWord, runCase } from "./agent-u37-db.mjs";

const ok = (value) => ({ ok: true, value, error: null });
const no = (error) => ({ ok: false, value: null, error });

test("the DB-clock subset names eleven cases, each with a full expectation", () => {
  assert.deepEqual(CASES, ["DB01", "DB02", "DB03", "DB04", "DB05", "DB06", "DB07", "DB08", "DB09", "DB10", "DB11"]);
  for (const id of CASES) assert.ok(Object.keys(EXPECTED[id]).length >= 2, id);
  assert.ok(WAIT_MS > EXPIRY_MS, "the harness waits past the expiry it set");
});

test("every expectation passes its own check", () => {
  for (const id of CASES) assert.deepEqual(checkCase(id, { ...EXPECTED[id] }), [], id);
});

test("mutant: the decide RPC without its expiry branch confirms an expired row -- DB02 fails", () => {
  const v = checkCase("DB02", { ...EXPECTED.DB02, state: "confirmed" });
  assert.equal(v.length, 1);
  assert.match(v[0], /state expected "expired", observed "confirmed"/);
});

test("mutant: create without the principal comparison replays another person's row -- DB09 fails", () => {
  assert.equal(checkCase("DB09", { create: "ok", replay: "ok", rows: 1 }).length, 1);
  // Replay across grants is refused by the grant comparison, so the same mutant leaves DB11 alone.
  assert.deepEqual(checkCase("DB11", { ...EXPECTED.DB11 }), []);
});

test("a missing field, an extra field, an unknown case and no observation are violations, never a pass", () => {
  const { state: _state, ...withoutState } = EXPECTED.DB07;
  assert.deepEqual(checkCase("DB07", withoutState), ["DB07: state not observed"]);
  assert.deepEqual(checkCase("DB07", { ...EXPECTED.DB07, receipt: 1 }), ["DB07: unexpected field receipt"]);
  assert.deepEqual(checkCase("DB99", {}), ["DB99: no such case"]);
  assert.deepEqual(checkCase("DB01", null), ["DB01: no observation"]);
  // Strict equality: a number where a boolean belongs is not the boolean.
  assert.equal(checkCase("DB08", { ...EXPECTED.DB08, replayed: 1 }).length, 1);
});

test("an outcome is ok, a known refusal token, or kept as unknown (an unknown refusal never matches an expectation)", () => {
  assert.equal(outcomeWord(ok({})), "ok");
  assert.equal(outcomeWord(no("proposal_not_decidable")), "proposal_not_decidable");
  assert.equal(outcomeWord(no("deadlock detected")), "unknown:deadlock detected");
  assert.equal(checkCase("DB10", { ...EXPECTED.DB10, second: outcomeWord(no("deadlock detected")) }).length, 1);
});

/** A fake psql that answers the statements runCase sends, as the store would; for the runner's own wiring. */
function fakeDb(answers) {
  const sent = [];
  return { sent, rpc: (sql) => { sent.push(["rpc", sql]); return answers.rpc(sql); }, admin: (sql) => { sent.push(["admin", sql]); return answers.admin(sql); } };
}

test("runCase DB09 sends the second person's id with the first person's key, workspace and body, and reads the row count", async () => {
  const people = { a: { user: "a6e00000-0000-4000-8000-00000000000a", ws: "pilot-a6e0000000004000" }, b: { user: "a6e00000-0000-4000-8000-00000000000b", ws: "pilot-x" } };
  const db = fakeDb({
    rpc: (sql) => (sql.includes(people.b.user) ? no("proposal_idempotency_conflict") : ok({ proposal: { proposal_id: "p" }, replayed: false })),
    admin: () => "1",
  });
  const ids = () => 0.5;
  assert.deepEqual(await runCase("DB09", db, ids, people), EXPECTED.DB09);
  const [first, second] = db.sent.filter(([kind]) => kind === "rpc").map(([, sql]) => sql);
  assert.equal(first.replace(people.a.user, "X"), second.replace(people.b.user, "X"), "only the principal differs");
  assert.ok(second.includes(`'${people.a.ws}'`) && second.includes("'session'"));
});

test("runCase refuses an unknown case", async () => {
  await assert.rejects(runCase("DB99", fakeDb({ rpc: () => ok({}), admin: () => "" }), () => 0.5, {}), /no such case DB99/);
});

test("the harness refuses to run without LOCAL_RACE_TEST=1, on a bad port, or with a receipt directory inside the repository", async () => {
  await assert.rejects(main({}), /LOCAL_RACE_TEST=1/);
  await assert.rejects(main({ LOCAL_RACE_TEST: "1", U37_DB_PORT: "80" }), /U37_DB_PORT/);
  await assert.rejects(main({ LOCAL_RACE_TEST: "1", U37_DB_PORT: "nope" }), /U37_DB_PORT/);
  await assert.rejects(main({ LOCAL_RACE_TEST: "1", U37_DB_RECEIPT_DIR: new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") }),
    /inside the repository/);
});

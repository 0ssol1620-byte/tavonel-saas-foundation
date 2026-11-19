import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyRun, exitCodeFor, isLoopbackDsn, main, psqlEnv } from "./run-sql-tests.mjs";

const OK = "1..2\nok 1 - a\nok 2 - b\n# all 2 passed\n";

test("refuses a non-loopback dsn", () => {
  assert.equal(isLoopbackDsn("postgres://postgres@127.0.0.1:55439/db"), true);
  assert.equal(isLoopbackDsn("postgres://postgres@localhost/db"), true);
  assert.equal(isLoopbackDsn("postgres://u:p@db.abc.supabase.co:5432/postgres"), false);
  assert.equal(isLoopbackDsn("postgres://postgres@127.0.0.1/db?host=db.abc.supabase.co"), false);
  assert.equal(isLoopbackDsn("not a url"), false);
  const err = console.error;
  console.error = () => {};
  try {
    assert.equal(main(["--dsn", "postgres://u@db.abc.supabase.co/postgres"]), 2);
    assert.equal(main([]), 2);
  } finally {
    console.error = err;
  }
});

test("parses ok/not ok lines and plan/finish mismatch as FAIL", () => {
  assert.equal(classifyRun({ status: 0, stdout: OK, stderr: "" }), "PASS");
  assert.equal(classifyRun({ status: 0, stdout: OK.replaceAll("\n", "\r\n"), stderr: "" }), "PASS"); // psql on Windows
  assert.equal(classifyRun({ status: 0, stdout: "ok 1 - a\nnot ok 2 - b\n", stderr: "" }), "FAIL");
  assert.equal(classifyRun({ status: 3, stdout: "ok 1 - a\n", stderr: "ERROR:  TAP FAIL: planned 3 ran 1 failed 0" }), "FAIL");
  assert.equal(classifyRun({ status: 0, stdout: "ok 1 - a\n", stderr: "" }), "FAIL"); // no finish line
});

test("classifies 'function policies_are(...) does not exist' as UNSUPPORTED, not PASS", () => {
  const stderr = "psql:x.sql:9: ERROR:  function policies_are(unknown, unknown, text[]) does not exist";
  assert.equal(classifyRun({ status: 3, stdout: "ok 1 - a\n", stderr }), "UNSUPPORTED");
  assert.equal(classifyRun({ status: 3, stdout: "", stderr: 'ERROR:  malformed array literal: "[1,0,0]"' }), "UNSUPPORTED");
  // an application function that is missing is a real failure, not a gap in the subset
  assert.equal(classifyRun({ status: 3, stdout: "", stderr: "ERROR:  function reserve_foundation_compute_v9(uuid) does not exist" }), "FAIL");
});

test("classifies a syntax error in the test file as FAIL", () => {
  assert.equal(classifyRun({ status: 3, stdout: "", stderr: 'ERROR:  syntax error at or near "selec"' }), "FAIL");
});

test("exit code is 3 for unsupported-only and 1 when any FAIL", () => {
  const r = (result) => ({ file: "x", result });
  assert.equal(exitCodeFor([r("PASS")]), 0);
  assert.equal(exitCodeFor([r("PASS"), r("UNSUPPORTED")]), 3);
  assert.equal(exitCodeFor([r("UNSUPPORTED"), r("FAIL")]), 1);
});

test("the subset file creates no extension and no role", () => {
  const sql = readFileSync(new URL("./pgtap-subset.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /create\s+extension/i);
  assert.doesNotMatch(sql, /create\s+role/i);
});

test("psql env drops libpq variables that redirect the connection past the loopback check", () => {
  const env = psqlEnv({ PGHOSTADDR: "192.0.2.1", PGHOST: "db.example.com", PGSERVICE: "x", PGPORT: "1", PATH: "p" });
  for (const k of ["PGHOSTADDR", "PGHOST", "PGSERVICE", "PGSERVICEFILE", "PGPORT", "PGSYSCONFDIR"]) assert.equal(k in env, false, k);
  assert.equal(env.PATH, "p");
  assert.equal(env.PGCLIENTENCODING, "UTF8");
});

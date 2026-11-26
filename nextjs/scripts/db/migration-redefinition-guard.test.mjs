import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkGuard, currentLegacySet, hashBody, loadAllowlist, scanSql } from "./migration-redefinition-guard.mjs";

const fn = (body) => `create or replace function public.reset_x()\nreturns void\nlanguage plpgsql\nas $$\nbegin\n  ${body};\nend;\n$$;\n`;
const FIRST = fn("perform 1");
const FIRST_HASH = hashBody(FIRST);

function dir(files) {
  const d = mkdtempSync(join(tmpdir(), "mig-guard-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(d, name), sql);
  return d;
}
const check = (files, allowlist) => checkGuard({ migrationsDir: dir(files), allowlist });

test("a single definition needs no marker", () => {
  assert.deepEqual(check({ "20261101000000_a.sql": FIRST }), []);
});

test("a redefinition without a predecessor marker fails", () => {
  const failures = check({ "20261101000000_a.sql": FIRST, "20261102000000_b.sql": fn("perform 2") });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /20261102000000_b\.sql: public\.reset_x: redefinition of 20261101000000_a\.sql without/);
  assert.ok(failures[0].includes(FIRST_HASH));
});

test("a redefinition naming the correct predecessor hash passes", () => {
  const later = `-- predecessor-hash: public.reset_x ${FIRST_HASH}\n-- predecessor: public.reset_x 20261101000000\n${fn("perform 2")}`;
  assert.deepEqual(check({ "20261101000000_a.sql": FIRST, "20261102000000_b.sql": later }), []);
});

test("a redefinition naming a wrong hash fails", () => {
  const later = `-- predecessor-hash: public.reset_x ${"0".repeat(64)}\n${fn("perform 2")}`;
  const failures = check({ "20261101000000_a.sql": FIRST, "20261102000000_b.sql": later });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /is not the body of 20261101000000_a\.sql/);
});

test("a wrong predecessor version fails even with the right hash", () => {
  const later = `-- predecessor-hash: public.reset_x ${FIRST_HASH}\n-- predecessor: public.reset_x 20250101000000\n${fn("perform 2")}`;
  const failures = check({ "20261101000000_a.sql": FIRST, "20261102000000_b.sql": later });
  assert.match(failures.join("\n"), /predecessor 20250101000000 is not the previous definer 20261101000000/);
});

test("parallel whole-body replacement fails: the third definition must name the second body, not the first", () => {
  const second = `-- predecessor-hash: public.reset_x ${FIRST_HASH}\n${fn("perform 2")}`;
  const third = `-- predecessor-hash: public.reset_x ${FIRST_HASH}\n${fn("perform 3")}`;
  const failures = check({ "20261101000000_a.sql": FIRST, "20261102000000_b.sql": second, "20261103000000_c.sql": third });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /20261103000000_c\.sql/);
});

test("the hash ignores CRLF and trailing whitespace but not the body", () => {
  assert.equal(hashBody(FIRST), hashBody(FIRST.replace(/\n/g, "\r\n").replace("begin", "begin   ")));
  assert.notEqual(hashBody(FIRST), hashBody(fn("perform 2")));
  const later = `-- predecessor-hash: public.reset_x ${FIRST_HASH}\r\n${fn("perform 2").replace(/\n/g, "\r\n")}`;
  assert.deepEqual(check({ "20261101000000_a.sql": FIRST.replace(/\n/g, "\r\n"), "20261102000000_b.sql": later }), []);
});

test("scanner handles unquoted schema, quoted names, tagged dollar quotes and comment lines", () => {
  const defs = scanSql(`-- create or replace function public.commented()\ncreate function "Public"."X"(a int) returns int language sql as $f$ select 1; $f$;\ncreate or replace function y() returns int language sql as 'select 1';\n`);
  assert.deepEqual(defs.map((d) => d.name), ["public.x", "public.y"]);
});

test("the allowlist is exact: legacy versions are exempt, new definers are enforced, stale entries fail", () => {
  const files = { "20261101000000_a.sql": FIRST, "20261102000000_b.sql": fn("perform 2") };
  const legacy = { functions: { "public.reset_x": { versions: ["20261101000000", "20261102000000"], reason: "legacy, predates guard" } } };
  assert.deepEqual(check(files, legacy), []);
  // removed from the allowlist while still lacking a predecessor: fails
  assert.equal(check(files, { functions: {} }).length, 1);
  // a NEW definer after the listed ones is enforced
  const withNew = { ...files, "20261103000000_c.sql": fn("perform 3") };
  assert.match(check(withNew, legacy).join("\n"), /20261103000000_c\.sql: public\.reset_x/);
  // stale entry: function no longer multi-defined
  assert.match(check({ "20261101000000_a.sql": FIRST }, legacy).join("\n"), /stale/);
  // listed version that is not a first definer
  const wrong = { functions: { "public.reset_x": { versions: ["20261101000000", "20269999999999"], reason: "legacy, predates guard" } } };
  assert.match(check(files, wrong).join("\n"), /not the first definers/);
  // missing reason
  const noReason = { functions: { "public.reset_x": { versions: ["20261101000000", "20261102000000"], reason: "" } } };
  assert.match(check(files, noReason).join("\n"), /missing reason/);
});

test("the real supabase/migrations tree passes against the committed allowlist, and the allowlist is exactly the current legacy set", () => {
  const allowlist = loadAllowlist(new URL("./migration-redefinition-allowlist.json", import.meta.url));
  assert.deepEqual(checkGuard({ allowlist }), []);
  // every committed entry is a real multi-definer today; a new multi-definer must carry markers instead of joining the list
  const current = currentLegacySet().functions;
  for (const [name, entry] of Object.entries(allowlist.functions)) {
    assert.deepEqual(entry.versions, current[name]?.versions.slice(0, entry.versions.length), name);
  }
});

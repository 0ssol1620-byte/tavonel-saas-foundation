import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments, validate, removeOwnedDirectory, dsnFor, MARKER } from "./local-cluster.mjs";

const ok = { LOCAL_RACE_TEST: "1" };
const BODY = "tavonel-disposable-local-cluster v1";

test("parses up with ordered drafts", () => {
  const o = parseArguments(["up", "--port", "55439", "--draft", "a.sql", "--draft", "b.sql"]);
  assert.deepEqual([o.command, o.port, o.drafts], ["up", 55439, ["a.sql", "b.sql"]]);
  assert.equal(dsnFor(55439), "postgres://postgres@127.0.0.1:55439/postgres");
});

test("rejects bad arguments", () => {
  assert.throws(() => parseArguments(["bogus", "--port", "1"]), /usage/);
  assert.throws(() => parseArguments(["up"]), /--port/);
  assert.throws(() => parseArguments(["up", "--port", "x"]), /integer/);
  assert.throws(() => parseArguments(["up", "--port", "55439", "--nope"]), /unknown/);
  assert.throws(() => parseArguments(["up", "--port", "55439", "--draft"]), /path/);
});

test("refuses without LOCAL_RACE_TEST, non-loopback, bad ports, drafts on down", () => {
  const base = parseArguments(["up", "--port", "55439"]);
  assert.doesNotThrow(() => validate(base, ok));
  assert.throws(() => validate(base, {}), /LOCAL_RACE_TEST/);
  assert.throws(() => validate({ ...base, host: "10.0.0.5" }, ok), /non-loopback/);
  assert.throws(() => validate({ ...base, port: 80 }, ok), /port 80/);
  assert.throws(() => validate({ ...base, port: 70000 }, ok), /port 70000/);
  assert.throws(() => validate({ ...base, command: "down", drafts: ["x.sql"] }, ok), /only valid with up/);
});

test("marker check keeps a foreign directory", () => {
  const foreign = mkdtempSync(join(tmpdir(), "foreign-"));
  writeFileSync(join(foreign, "keep.txt"), "x");
  assert.throws(() => removeOwnedDirectory(foreign), /no cluster marker/);
  assert.ok(existsSync(join(foreign, "keep.txt")));
  writeFileSync(join(foreign, MARKER), "something else");
  assert.throws(() => removeOwnedDirectory(foreign), /no cluster marker/);
  assert.ok(existsSync(foreign));
});

test("outside the temp root is refused even with a marker; marked dir is removed", () => {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  const outside = mkdtempSync(join(tmpdir(), "outside-"));
  writeFileSync(join(outside, MARKER), BODY);
  assert.throws(() => removeOwnedDirectory(outside, root), /outside the temp root/);
  const owned = join(root, "owned");
  mkdirSync(owned);
  writeFileSync(join(owned, MARKER), BODY);
  assert.equal(removeOwnedDirectory(owned, root), true);
  assert.equal(existsSync(owned), false);
});

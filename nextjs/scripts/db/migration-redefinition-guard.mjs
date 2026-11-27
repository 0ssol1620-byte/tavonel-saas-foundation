#!/usr/bin/env node

/**
 * One canonical definition per database function (WO-MIG-GUARD-1).
 *
 *   node nextjs/scripts/db/migration-redefinition-guard.mjs            # check (exit 1 on failure)
 *   node nextjs/scripts/db/migration-redefinition-guard.mjs --print    # latest hash of every multi-defined function
 *
 * Scans supabase/migrations/*.sql for `create [or replace] function <schema.name>(...)`. A function defined by more than one
 * migration needs, in every later definition, a machine-readable line naming the predecessor body it was rebuilt on:
 *
 *   -- predecessor-hash: <schema.name> <sha256 of the previous definition, as normalised here>
 *   -- predecessor: <schema.name> <previous migration version>      (optional; checked when present)
 *
 * The hash covers the whole definition statement (create ... through its terminating `;`) with CR/LF folded to LF, trailing
 * whitespace stripped per line and the statement trimmed. Two migrations that each replace the same body in parallel can then
 * never both pass: the second one's recorded hash is not the first one's body.
 *
 * Legacy multi-definition functions (those that predate this guard) are listed in migration-redefinition-allowlist.json with the
 * versions that defined them when the guard was introduced. The list is exact: a stale entry fails, and a definition by a version
 * that is not listed is enforced like any new one.
 *
 * ponytail: regex scan, not a SQL parser. Dollar-quoted (or `;`-terminated) bodies only; a `create function` written inside a
 * dynamic `execute` string at line start would be counted. Upgrade to a real parser if that ever appears in a migration.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HERE = import.meta.dirname;
export const DEFAULT_MIGRATIONS_DIR = resolve(HERE, "../../../supabase/migrations");
export const DEFAULT_ALLOWLIST = join(HERE, "migration-redefinition-allowlist.json");

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const FN_START = new RegExp(String.raw`^[ \t]*create[ \t]+(?:or[ \t]+replace[ \t]+)?function[ \t]+(${IDENT}(?:[ \t]*\.[ \t]*${IDENT})?)[ \t]*\(`, "gim");
const PRED_HASH = /^[ \t]*--[ \t]*predecessor-hash:[ \t]*(\S+)[ \t]+([0-9a-f]{64})[ \t]*$/gim;
const PRED_VERSION = /^[ \t]*--[ \t]*predecessor:[ \t]*(\S+)[ \t]+(\S+)[ \t]*$/gim;

export function normalizeName(raw) {
  const parts = raw.split(".").map((p) => p.trim().replace(/^"(.*)"$/, "$1").toLowerCase());
  return parts.length === 1 ? `public.${parts[0]}` : parts.join(".");
}

export function normalizeBody(text) {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").trim();
}

export const hashBody = (text) => createHash("sha256").update(normalizeBody(text)).digest("hex");

/** Every function definition in one file, in source order: [{ name, hash }]. */
export function scanSql(sql) {
  const src = sql.replace(/\r\n?/g, "\n");
  const defs = [];
  for (const m of src.matchAll(FN_START)) {
    const start = m.index + m[0].search(/\S/);
    const semi = src.indexOf(";", start);
    const dollar = /\$([A-Za-z_]\w*)?\$/.exec(src.slice(start));
    let end = semi === -1 ? src.length : semi + 1;
    if (dollar && (semi === -1 || start + dollar.index < semi)) {
      const open = start + dollar.index;
      const close = src.indexOf(dollar[0], open + dollar[0].length);
      const after = close === -1 ? -1 : src.indexOf(";", close + dollar[0].length);
      end = after === -1 ? src.length : after + 1;
    }
    defs.push({ name: normalizeName(m[1]), hash: hashBody(src.slice(start, end)) });
  }
  return defs;
}

export function readMarkers(sql) {
  const hashes = new Map();
  const versions = new Map();
  for (const m of sql.matchAll(PRED_HASH)) hashes.set(normalizeName(m[1]), m[2].toLowerCase());
  for (const m of sql.matchAll(PRED_VERSION)) versions.set(normalizeName(m[1]), m[2]);
  return { hashes, versions };
}

const versionOf = (file) => file.split("_")[0];

/** name -> [{ file, version, hash, markers }] in apply (filename) order; one entry per file (its last definition). */
export function scanMigrations(dir) {
  const byName = new Map();
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const last = new Map();
    for (const d of scanSql(sql)) last.set(d.name, d.hash);
    if (last.size === 0) continue;
    const markers = readMarkers(sql);
    for (const [name, hash] of last) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ file, version: versionOf(file), hash, markers });
    }
  }
  return byName;
}

/** Returns an array of human-readable failures; empty means the guard passes. */
export function checkGuard({ migrationsDir = DEFAULT_MIGRATIONS_DIR, allowlist = { functions: {} } } = {}) {
  const failures = [];
  const byName = scanMigrations(migrationsDir);
  const legacy = Object.fromEntries(Object.entries(allowlist.functions ?? {}).map(([k, v]) => [normalizeName(k), v]));

  for (const [name, entry] of Object.entries(legacy)) {
    const defs = byName.get(name) ?? [];
    const listed = entry?.versions ?? [];
    if (typeof entry?.reason !== "string" || entry.reason.trim() === "") failures.push(`allowlist ${name}: missing reason`);
    if (defs.length < 2) failures.push(`allowlist ${name}: stale, function is defined by ${defs.length} migration(s)`);
    else if (listed.length < 2 || listed.some((v, i) => v !== defs[i]?.version)) {
      failures.push(`allowlist ${name}: versions [${listed.join(", ")}] are not the first definers [${defs.slice(0, listed.length).map((d) => d.version).join(", ")}]`);
    }
  }

  for (const [name, defs] of byName) {
    if (defs.length < 2) continue;
    const exempt = new Set(legacy[name]?.versions ?? []);
    for (let i = 1; i < defs.length; i++) {
      const cur = defs[i];
      const prev = defs[i - 1];
      if (exempt.has(cur.version)) continue;
      const where = `${cur.file}: ${name}`;
      const recorded = cur.markers.hashes.get(name);
      if (!recorded) failures.push(`${where}: redefinition of ${prev.file} without "-- predecessor-hash: ${name} <sha256>" (expected ${prev.hash})`);
      else if (recorded !== prev.hash) failures.push(`${where}: predecessor-hash ${recorded} is not the body of ${prev.file} (${prev.hash}); rebuild on the latest body`);
      const v = cur.markers.versions.get(name);
      if (v && v !== prev.version) failures.push(`${where}: predecessor ${v} is not the previous definer ${prev.version}`);
    }
  }
  return failures;
}

export function loadAllowlist(path = DEFAULT_ALLOWLIST) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Current multi-definer set, shaped like the allowlist (used once to seed it). */
export function currentLegacySet(dir = DEFAULT_MIGRATIONS_DIR) {
  const functions = {};
  for (const [name, defs] of [...scanMigrations(dir)].sort(([a], [b]) => a.localeCompare(b))) {
    if (defs.length > 1) functions[name] = { versions: defs.map((d) => d.version), reason: "legacy, predates guard" };
  }
  return { functions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--print")) {
    for (const [name, defs] of scanMigrations(DEFAULT_MIGRATIONS_DIR)) {
      if (defs.length > 1) console.log(`${name} ${defs.at(-1).hash} (${defs.at(-1).file})`);
    }
  } else if (process.argv.includes("--seed")) {
    console.log(JSON.stringify(currentLegacySet(), null, 2));
  } else {
    const failures = checkGuard({ allowlist: loadAllowlist() });
    if (failures.length) {
      console.error(`migration redefinition guard FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
      process.exit(1);
    }
    console.log("migration redefinition guard passes");
  }
}

/**
 * Disposable local PostgreSQL 17 cluster for race harnesses (U10 / U35 / M1-04).
 *
 *   LOCAL_RACE_TEST=1 node scripts/db/local-cluster.mjs up --port 55439 [--draft <file.sql> ...]
 *   LOCAL_RACE_TEST=1 node scripts/db/local-cluster.mjs dsn  --port 55439
 *   LOCAL_RACE_TEST=1 node scripts/db/local-cluster.mjs down --port 55439
 *
 * `initdb --auth=trust` into a fresh directory under os.tmpdir(), loopback only, then the
 * existing apply-migrations.mjs (--shim-vector, so pgvector behaviour is NOT verified), then each
 * draft in the order given. A chain that does not apply exits non-zero; there is no workaround.
 * `down` removes only a directory that carries this tool's marker file.
 * Binaries: PG_BIN (directory) or the Windows default install; PSQL_BIN overrides psql only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MARKER = ".tavonel-local-cluster";
const MARKER_BODY = "tavonel-disposable-local-cluster v1";
const HOST = "127.0.0.1";
const NL = String.fromCharCode(10);
const HERE = import.meta.dirname;

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!["up", "down", "dsn"].includes(command)) throw new Error("usage: local-cluster.mjs up|down|dsn --port <n> [--draft <file>...]");
  const options = { command, port: null, host: HOST, drafts: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === "--port") options.port = rest[++i];
    else if (flag === "--draft") {
      const file = rest[++i];
      if (!file) throw new Error("--draft needs a path");
      options.drafts.push(file);
    } else throw new Error(`unknown argument ${flag}`);
  }
  if (!/^\d+$/.test(String(options.port ?? ""))) throw new Error("--port <n> is required and must be an integer");
  options.port = Number(options.port);
  return options;
}

export function validate(options, env = process.env) {
  if (env.LOCAL_RACE_TEST !== "1") throw new Error("refused: LOCAL_RACE_TEST=1 is required");
  if (options.host !== HOST) throw new Error(`refused: non-loopback host ${options.host}`);
  if (options.port < 1024 || options.port > 65535) throw new Error(`refused: port ${options.port} outside 1024-65535`);
  if (options.command !== "up" && options.drafts.length > 0) throw new Error("--draft is only valid with up");
}

export const dsnFor = (port) => `postgres://postgres@${HOST}:${port}/postgres`;
const pointer = (port) => join(tmpdir(), `tavonel-local-cluster-${port}.json`);

/** Real path of `dir` when it is a marked directory under the temp root; null when it does not exist; throws otherwise. */
export function resolveOwned(dir, root = tmpdir()) {
  if (!existsSync(dir)) return null;
  const real = realpathSync(dir);
  if (!real.startsWith(realpathSync(root) + sep)) throw new Error(`refused: ${dir} is outside the temp root`);
  const marker = join(real, MARKER);
  if (!existsSync(marker) || readFileSync(marker, "utf8") !== MARKER_BODY) throw new Error(`refused: ${dir} carries no cluster marker`);
  return real;
}

/** Remove `dir` only when it is a marked directory this tool created under the temp root. */
export function removeOwnedDirectory(dir, root = tmpdir()) {
  const real = resolveOwned(dir, root);
  if (!real) return false;
  rmSync(real, { recursive: true, force: true });
  return true;
}

function binaries(env) {
  const bin = env.PG_BIN || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/17/bin" : "");
  const exe = (name) => (bin ? join(bin, process.platform === "win32" ? `${name}.exe` : name) : name);
  return { bin, initdb: exe("initdb"), pgCtl: exe("pg_ctl"), psql: env.PSQL_BIN || exe("psql") };
}

const run = (file, args) => execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// The postmaster inherits pg_ctl's pipes, so a piped `start` never returns; discard them (server log goes to -l).
const start = (file, args) => execFileSync(file, args, { stdio: "ignore" });

function up(options, env) {
  const { bin, initdb, pgCtl, psql } = binaries(env);
  const drafts = options.drafts.map((d) => resolve(d));
  for (const d of drafts) if (!existsSync(d)) throw new Error(`draft not found: ${d}`);
  if (existsSync(pointer(options.port))) throw new Error(`a cluster for port ${options.port} is already recorded; run down first`);

  const dir = mkdtempSync(join(tmpdir(), "tavonel-pg-"));
  writeFileSync(join(dir, MARKER), MARKER_BODY);
  const data = join(dir, "data");
  const fail = (message) => {
    // The directory (and its log) is deleted below, so quote the log's tail now.
    let tail = "";
    try { tail = readFileSync(join(dir, "postgres.log"), "utf8").slice(-600).trim(); } catch { /* no log */ }
    if (tail) message += `${NL}postgres.log tail: ${tail}`;
    try { run(pgCtl, ["stop", "-D", data, "-m", "immediate"]); } catch { /* not started */ }
    try { removeOwnedDirectory(dir); } catch { /* keep for inspection */ }
    throw new Error(message);
  };
  try { run(initdb, ["-D", data, "--auth=trust", "-U", "postgres", "-E", "UTF8"]); }
  catch (cause) { fail(`initdb failed: ${cause.stderr ?? cause.message}`); }
  try { start(pgCtl, ["start", "-w", "-D", data, "-l", join(dir, "postgres.log"), "-o", `-p ${options.port} -c listen_addresses=${HOST}`]); }
  catch (cause) { fail(`pg_ctl start failed: ${cause.stderr ?? cause.message}`); }
  writeFileSync(pointer(options.port), JSON.stringify({ dir }));

  const dsn = dsnFor(options.port);
  const left = (why) => { process.stderr.write(`${why}; cluster left up at ${dsn} (dir ${dir}) -- run down${NL}`); process.exit(2); };
  const sep2 = process.platform === "win32" ? ";" : ":";
  const childEnv = { ...env, PATH: bin ? `${bin}${sep2}${env.PATH ?? ""}` : env.PATH };
  const chain = spawnSync(process.execPath, [join(HERE, "apply-migrations.mjs"), "--dsn", dsn, "--shim-vector"], { encoding: "utf8", env: childEnv });
  process.stdout.write(chain.stdout ?? "");
  if (chain.status !== 0) {
    process.stderr.write(chain.stderr ?? "");
    process.stderr.write(`migration chain did not apply; cluster left up at ${dsn} (dir ${dir}) -- run down${NL}`);
    process.exit(chain.status || 1);
  }
  for (const draft of drafts) {
    try { run(psql, [dsn, "-w", "-q", "-v", "ON_ERROR_STOP=1", "-f", draft]); }
    catch (cause) {
      process.stderr.write(`draft ${draft} failed: ${String(cause.stderr ?? cause.message).trim()}${NL}cluster left up at ${dsn} -- run down${NL}`);
      process.exit(1);
    }
    process.stdout.write(`applied draft ${draft}${NL}`);
  }
  let version;
  let fingerprints;
  try {
  version = run(psql, [dsn, "-w", "-At", "-c", "show server_version"]).trim();
  // The fingerprint file reads Supabase's migration tracker, which a bare cluster lacks. An EMPTY tracker keeps the
  // query runnable; its rows are not invented, so the digest covers the schema and carries no 'migration' rows.
  run(psql, [dsn, "-w", "-q", "-v", "ON_ERROR_STOP=1", "-c", "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, name text)"]);
  fingerprints = run(psql, [dsn, "-w", "-At", "-v", "ON_ERROR_STOP=1", "-f", join(HERE, "catalog-fingerprints.sql")]);
  if (!fingerprints.trim()) throw new Error("catalog fingerprints returned no rows");
  } catch (cause) { left(`fingerprint step failed: ${String(cause.stderr ?? cause.message).trim()}`); }
  process.stdout.write(`postgres ${version}${NL}catalog-fingerprints (schema only, empty migration tracker) sha256 ${createHash("sha256").update(fingerprints).digest("hex")}${NL}dsn ${dsn}${NL}`);
}

function down(options, env) {
  const file = pointer(options.port);
  if (!existsSync(file)) throw new Error(`no cluster recorded for port ${options.port}`);
  const { dir } = JSON.parse(readFileSync(file, "utf8"));
  // Full ownership check (temp root + marker body) before stopping or deleting anything.
  const real = resolveOwned(dir);
  if (!real) {
    rmSync(file, { force: true });
    process.stdout.write(`directory ${dir} was already gone; removed the stale pointer for port ${options.port}${NL}`);
    return;
  }
  try { run(binaries(env).pgCtl, ["stop", "-D", join(real, "data"), "-m", "immediate"]); } catch { /* already stopped */ }
  removeOwnedDirectory(real);
  rmSync(file, { force: true });
  process.stdout.write(`removed ${dir}${NL}`);
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    validate(options);
    if (options.command === "dsn") process.stdout.write(dsnFor(options.port) + NL);
    else if (options.command === "up") up(options, process.env);
    else down(options, process.env);
  } catch (error) {
    process.stderr.write(`${error.message}${NL}`);
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

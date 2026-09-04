/**
 * Apply the migration chain to a real PostgreSQL, in order, and stop at the first failure.
 *
 * Written because the migrations were only ever checked by asserting on their text, and
 * `0038`-`0042` carry compile-job state, corpus slots and billing semantics. A string assertion
 * cannot tell whether a function body compiles, whether a constraint is satisfiable, or whether
 * a backfill's SQL is even valid.
 *
 *   node scripts/db/apply-migrations.mjs --dsn postgres://postgres@127.0.0.1:55432/tavonel_mig
 *
 * Runs through `psql`, deliberately: this repository has no PostgreSQL driver, and adding one as
 * a dependency to run a diagnostic is a worse trade than shelling out to the client that ships
 * with the server.
 *
 * There is no Docker on this machine and the machine's own PostgreSQL uses scram with a password
 * nobody here has, so the intended target is a disposable cluster created with
 * `initdb --auth=trust` on a spare port. It creates nothing outside the database it is pointed at.
 *
 * pgvector: three retrieval migrations declare `create extension vector`, and stock PostgreSQL
 * does not ship it. `--shim-vector` installs a domain over double precision[] and a
 * `vector_dims`, and comments out those three lines, so the chain reaches the migrations this
 * exists to check. **Nothing about pgvector's behaviour is verified that way** -- its distance
 * operators are only referenced inside function bodies, which PostgreSQL does not resolve until
 * a call that never happens here. Every run says so in its output.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MIGRATIONS = resolve(import.meta.dirname, "../../../supabase/migrations");
const NEWLINE = String.fromCharCode(10);

const SHIM = `
create domain public.vector as double precision[];
create function public.vector_dims(v public.vector) returns integer
  language sql immutable as $fn$ select array_length($1, 1) $fn$;
`;

/* What Supabase provides that a bare cluster does not, reduced to what the chain references. */
const PREREQUISITES = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$fn$;
create or replace function auth.role() returns text language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$fn$;
`;

function parseArguments(values) {
  const options = { dsn: null, shimVector: false, json: false, keepGoing: false };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--dsn") { options.dsn = values[++index]; continue; }
    if (values[index] === "--shim-vector") { options.shimVector = true; continue; }
    if (values[index] === "--json") { options.json = true; continue; }
    if (values[index] === "--keep-going") { options.keepGoing = true; continue; }
  }
  return options;
}

function psql(dsn, sql) {
  const file = join(mkdtempSync(join(tmpdir(), "tavonel-mig-")), "statement.sql");
  writeFileSync(file, sql, "utf8");
  try {
    execFileSync("psql", [dsn, "-w", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return null;
  } catch (cause) {
    const stderr = String(cause?.stderr ?? cause?.message ?? cause).trim();
    return { message: stderr.split(NEWLINE).slice(0, 4).join(" ") };
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.dsn) {
    process.stderr.write(`usage: node scripts/db/apply-migrations.mjs --dsn <postgres url> [--shim-vector] [--json]${NEWLINE}`);
    process.exit(2);
  }

  const prerequisites = psql(options.dsn, PREREQUISITES);
  if (prerequisites) {
    process.stderr.write(`prerequisites failed: ${prerequisites.message}${NEWLINE}`);
    process.exit(1);
  }
  if (options.shimVector) {
    const shim = psql(options.dsn, SHIM);
    if (shim) {
      process.stderr.write(`vector shim failed: ${shim.message}${NEWLINE}`);
      process.exit(1);
    }
  }

  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
  const applied = [];
  const shimmed = [];
  /*
    Stopping at the first failure is the right default: the chain is ordered, and a later file may
    fail only because an earlier one never ran. Once a failure is found, though, the useful question
    is how much of the rest is independent of it -- which is what --keep-going answers.
  */
  const failures = [];
  let failure = null;

  for (const name of files) {
    let sql = readFileSync(resolve(MIGRATIONS, name), "utf8");
    if (options.shimVector && /create extension if not exists vector/i.test(sql)) {
      sql = sql.replace(/create extension if not exists vector\s*;/gi, "-- shimmed: create extension vector;");
      shimmed.push(name);
    }
    const outcome = psql(options.dsn, sql);
    if (outcome) {
      failures.push({ migration: name, message: outcome.message });
      if (!options.keepGoing) { failure = failures[0]; break; }
      continue;
    }
    applied.push(name);
  }

  const result = {
    total: files.length,
    applied: applied.length,
    lastApplied: applied.at(-1) ?? null,
    vectorShimmed: shimmed,
    vectorSemanticsVerified: false,
    failures,
    failure: failure ?? failures[0] ?? null,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + NEWLINE);
  } else {
    process.stdout.write(`applied ${result.applied}/${result.total}, last ${result.lastApplied}${NEWLINE}`);
    if (shimmed.length > 0) {
      process.stdout.write(`pgvector shimmed in ${shimmed.join(", ")} - vector behaviour NOT verified${NEWLINE}`);
    }
    if (failure) process.stdout.write(`FAILED at ${failure.migration}: ${failure.message}${NEWLINE}`);
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

main();

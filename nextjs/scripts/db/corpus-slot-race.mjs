/**
 * Reproduce the corpus slot race against a real PostgreSQL, with two real connections.
 *
 * The unit suite fakes the RPC, which can show that the *application* checks what comes back but
 * cannot show what the function does when two sessions interleave -- that behaviour lives in
 * ON CONFLICT DO NOTHING and the re-read after it, and only a server has those.
 *
 * The interleaving is made deterministic with an open transaction rather than by racing threads
 * and hoping:
 *
 *   A: begin; enqueue(slot 3, documents X)      -- holds the row, uncommitted
 *   B: enqueue(slot 3, documents Y)             -- finds nothing, inserts, blocks on the index
 *   A: commit                                   -- B's insert now conflicts
 *   B: ON CONFLICT DO NOTHING affects 0 rows, re-reads slot 3, finds A's row
 *
 * That last step is the one under test. Before 0042 it returned A's row to B as success.
 *
 *   node scripts/db/corpus-slot-race.mjs --dsn postgres://postgres@127.0.0.1:55432/tavonel_0042
 *
 * Run it against a database migrated only through 0041 to watch the same scenarios fail: that is
 * the mutation test, and it is why this script reports each scenario rather than only asserting.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const NEWLINE = String.fromCharCode(10);

/*
  Mirrors compileIdempotencyKey in lib/compile-job-store.ts. Duplicated rather than imported
  because that module is TypeScript and this runs under bare node; `mirrors-compile-job-store`
  in lib/compile-job-idempotency.test.ts asserts the two stay identical.
*/
export function compileIdempotencyKey(workspaceKey, documentIds, slot) {
  const canonical = [...new Set(documentIds)].sort().join(NEWLINE);
  const identity = slot
    ? ["corpus-part", workspaceKey, slot.corpusId, String(slot.batchIndex), canonical].join(NEWLINE)
    : ["standalone", workspaceKey, canonical].join(NEWLINE);
  return createHash("sha256").update("compile-identity/2" + NEWLINE + identity).digest("hex");
}

const hex32 = () => randomBytes(16).toString("hex");
const jobId = () => `cjob-${hex32()}`;
const corpusId = () => `corpus-${hex32()}`;

function quote(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `array[${value.map(quote).join(",")}]::text[]`;
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function enqueueSql({ job, workspace, user, documents, key, corpus = null, batchIndex = null, batchCount = null }) {
  return `select * from public.enqueue_foundation_compile_job(${[
    quote(job), quote(workspace), `${quote(user)}::uuid`, quote(documents), quote(key),
    quote(corpus), quote(batchIndex), quote(batchCount),
  ].join(", ")});`;
}

/** A psql session held open on a pipe, so several statements share one transaction. */
class Session {
  constructor(dsn, name) {
    this.name = name;
    this.stdout = "";
    this.stderr = "";
    this.process = spawn("psql", [dsn, "-w", "-q", "-A", "-t", "--no-psqlrc"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stdout.on("data", chunk => { this.stdout += chunk; });
    this.process.stderr.on("data", chunk => { this.stderr += chunk; });
  }

  /** Send SQL and resolve once its sentinel appears, so a blocked statement is observable. */
  send(sql) {
    const marker = `__done_${randomBytes(6).toString("hex")}__`;
    const from = { out: this.stdout.length, err: this.stderr.length };
    this.process.stdin.write(`${sql}${NEWLINE}\\echo ${marker}${NEWLINE}`);
    return {
      marker,
      settled: async (timeoutMs = 10_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (this.stdout.includes(marker)) {
            const out = this.stdout.slice(from.out).replace(marker, "").trim();
            return { out, err: this.stderr.slice(from.err).trim(), timedOut: false };
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        return { out: this.stdout.slice(from.out).trim(), err: this.stderr.slice(from.err).trim(), timedOut: true };
      },
      /** True while the statement has produced neither result nor error -- i.e. it is blocked. */
      pending: async (settleMs = 700) => {
        await new Promise(resolve => setTimeout(resolve, settleMs));
        return !this.stdout.includes(marker);
      },
    };
  }

  close() {
    this.process.stdin.end();
    this.process.kill();
  }
}

function sql(dsn, statement) {
  return execFileSync("psql", [dsn, "-w", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement], {
    encoding: "utf8",
  }).trim();
}

/*
  A fresh workspace per run rather than deleting the previous one's rows: foundation_compile_jobs
  cascades into foundation_compile_job_events, which an append-only trigger correctly refuses to
  delete from. The ledger is not the test's to tidy.
*/
const WORKSPACE = `pilot-${randomBytes(5).toString("hex")}`;
const USER = "77777777-7777-4777-8777-777777777777";

/*
  Same slot, different documents, concurrent. The scenario 0042 exists for: B must be refused,
  because the alternative is telling B its part is enqueued while A's documents compile under it.
*/
async function differentDocumentsRace(dsn) {
  const corpus = corpusId();
  const documentsA = ["docA1", "docA2"];
  const documentsB = ["docB1", "docB2"];
  const slot = { corpusId: corpus, batchIndex: 0 };

  const a = new Session(dsn, "A");
  const b = new Session(dsn, "B");
  try {
    await a.send("begin;").settled();
    const first = await a.send(enqueueSql({
      job: jobId(), workspace: WORKSPACE, user: USER, documents: documentsA,
      key: compileIdempotencyKey(WORKSPACE, documentsA, slot),
      corpus, batchIndex: 0, batchCount: 4,
    })).settled();

    const second = b.send(enqueueSql({
      job: jobId(), workspace: WORKSPACE, user: USER, documents: documentsB,
      key: compileIdempotencyKey(WORKSPACE, documentsB, slot),
      corpus, batchIndex: 0, batchCount: 4,
    }));
    const blocked = await second.pending();

    await a.send("commit;").settled();
    const result = await second.settled();

    const rows = sql(dsn, `select count(*) from public.foundation_compile_jobs where corpus_id = ${quote(corpus)};`);
    return {
      scenario: "same slot, different documents, concurrent",
      bBlockedUntilACommitted: blocked,
      aCreated: first.out.includes("|t|"),
      bRefused: /23505|different compile identity|different document set/.test(result.err),
      bError: result.err.split(NEWLINE)[0] || null,
      bReturnedARow: result.out.length > 0,
      rowsInSlot: Number(rows),
      pass: blocked && result.out.length === 0 && /different compile identity/.test(result.err) && Number(rows) === 1,
    };
  } finally {
    a.close();
    b.close();
  }
}

/* Same slot, same documents, concurrent. A retry, not a conflict: both callers must converge. */
async function sameDocumentsRace(dsn) {
  const corpus = corpusId();
  const documents = ["docS1", "docS2"];
  const slot = { corpusId: corpus, batchIndex: 1 };
  const key = compileIdempotencyKey(WORKSPACE, documents, slot);

  const a = new Session(dsn, "A");
  const b = new Session(dsn, "B");
  try {
    await a.send("begin;").settled();
    const first = await a.send(enqueueSql({
      job: jobId(), workspace: WORKSPACE, user: USER, documents, key,
      corpus, batchIndex: 1, batchCount: 4,
    })).settled();

    const second = b.send(enqueueSql({
      job: jobId(), workspace: WORKSPACE, user: USER, documents, key,
      corpus, batchIndex: 1, batchCount: 4,
    }));
    const blocked = await second.pending();

    await a.send("commit;").settled();
    const result = await second.settled();

    const aJob = first.out.split("|")[0];
    const bJob = result.out.split("|")[0];
    const rows = sql(dsn, `select count(*) from public.foundation_compile_jobs where corpus_id = ${quote(corpus)};`);
    return {
      scenario: "same slot, same documents, concurrent",
      bBlockedUntilACommitted: blocked,
      aCreated: first.out.includes("|t|"),
      bCreated: result.out.includes("|t|"),
      convergedOnOneJob: Boolean(aJob) && aJob === bJob,
      bReturnedIdempotencyKey: result.out.trim().endsWith(key),
      rowsInSlot: Number(rows),
      error: result.err.split(NEWLINE)[0] || null,
      pass: blocked && aJob === bJob && !result.out.includes("|t|") && Number(rows) === 1
        && result.out.trim().endsWith(key),
    };
  } finally {
    a.close();
    b.close();
  }
}

/* A standalone compile over the same documents must never be handed back as a corpus part. */
function standaloneNotAdopted(dsn) {
  const corpus = corpusId();
  const documents = ["docC1", "docC2"];
  const standaloneKey = compileIdempotencyKey(WORKSPACE, documents);
  const standaloneJob = jobId();
  sql(dsn, enqueueSql({
    job: standaloneJob, workspace: WORKSPACE, user: USER, documents, key: standaloneKey,
  }));

  const partKey = compileIdempotencyKey(WORKSPACE, documents, { corpusId: corpus, batchIndex: 0 });
  const partJob = jobId();
  const part = sql(dsn, enqueueSql({
    job: partJob, workspace: WORKSPACE, user: USER, documents, key: partKey,
    corpus, batchIndex: 0, batchCount: 2,
  }));
  const returnedJob = part.split("|")[0];
  return {
    scenario: "standalone job is not adopted as a corpus slot",
    standaloneJob,
    partReturnedJob: returnedJob,
    partCreated: part.includes("|t|"),
    pass: returnedJob === partJob && returnedJob !== standaloneJob && part.includes("|t|"),
  };
}

/* Batching drift: the same documents re-batched to a different index must not take the slot. */
function batchingDrift(dsn) {
  const corpus = corpusId();
  const documents = ["docD1", "docD2"];
  sql(dsn, enqueueSql({
    job: jobId(), workspace: WORKSPACE, user: USER, documents,
    key: compileIdempotencyKey(WORKSPACE, documents, { corpusId: corpus, batchIndex: 0 }),
    corpus, batchIndex: 0, batchCount: 2,
  }));

  // Same corpus and slot, but the key was computed for a different batch index.
  let error = null;
  try {
    sql(dsn, enqueueSql({
      job: jobId(), workspace: WORKSPACE, user: USER, documents: ["docD3"],
      key: compileIdempotencyKey(WORKSPACE, ["docD3"], { corpusId: corpus, batchIndex: 1 }),
      corpus, batchIndex: 0, batchCount: 2,
    }));
  } catch (cause) {
    error = String(cause?.stderr ?? cause?.message ?? cause).split(NEWLINE)[0];
  }
  return {
    scenario: "slot re-used under a drifted batching fails closed",
    error,
    pass: Boolean(error) && /different compile identity/.test(error),
  };
}

async function main() {
  const values = process.argv.slice(2);
  const dsn = values[values.indexOf("--dsn") + 1];
  if (!values.includes("--dsn") || !dsn) {
    process.stderr.write(`usage: node scripts/db/corpus-slot-race.mjs --dsn <postgres url>${NEWLINE}`);
    process.exit(2);
  }

  const results = [
    await differentDocumentsRace(dsn),
    await sameDocumentsRace(dsn),
    standaloneNotAdopted(dsn),
    batchingDrift(dsn),
  ];

  process.stdout.write(JSON.stringify({
    dsn: dsn.replace(/:[^:@/]*@/, ":***@"),
    passed: results.filter(result => result.pass).length,
    total: results.length,
    results,
  }, null, 2) + NEWLINE);
  process.exit(results.every(result => result.pass) ? 0 : 1);
}

// Only when run as a script: the key function above is imported by the unit suite, which must
// not spawn psql to do it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

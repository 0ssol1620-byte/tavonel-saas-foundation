/*
  Where a probe run is kept, and why it is an object rather than a row.

  No migration was written for this. The campaign forbids one, and it would also be the wrong
  shape: a probe result is an append-only artifact with a ceiling on how much of it anyone ever
  reads, which is what object storage is for. `synthetic/` in the Foundation quarantine bucket is
  the prefix the deployment already uses for exactly this kind of non-customer traffic --
  `runSyntheticR2Canary` writes and deletes there, and `assertFoundationSyntheticKey` is the
  guard that keeps anything else out of it.

  One key, rewritten each run, holding the last few runs newest-first. /status needs "the last
  successful probe" and "how the recent ones went"; a listing would be more requests and a longer
  page render for an answer nobody asked for.

  ponytail: this file signs its own requests, and it is the third SigV4 implementation in the
  repository (`r2-synthetic-canary.ts` signs headers, `r2-presign.ts` signs a query). None of them
  exports a signer, and this lane owns neither file. The consolidation -- one exported
  `signedR2Url` that all three call -- is in the lane report as a cross-lane request; it is a
  refactor with no behaviour change and does not belong in a commit that is adding a probe.
*/
import { createHash, createHmac } from "node:crypto";
import {
  FOUNDATION_R2_BUCKET,
  SYNTHETIC_PREFIX,
  assertFoundationSyntheticKey,
  type R2SignerEnv,
} from "./r2-synthetic-canary";
import { PROBE_RUN_SCHEMA, validateProbeRun, type ProbeRun } from "./synthetic-probe";

export const PROBE_HISTORY_KEY = `${SYNTHETIC_PREFIX}probe/history.json`;

/**
 * How many runs are kept.
 *
 * IMPLEMENTED_NOT_PROVEN: twenty is a display decision, not a retention policy. At a five-minute
 * cron it is the last hour and a half, which is enough for /status to say whether the recent runs
 * were clean without turning the object into a log. Nothing depends on the number; a real
 * retention requirement would make this a table.
 */
export const PROBE_HISTORY_LIMIT = 20;

/** Bounded like every other receipt read in this deployment: storage is input. */
const MAX_HISTORY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 3_000;

export type ProbeHistory = {
  schemaVersion: "tavonel.synthetic_probe_history.v1";
  runs: ProbeRun[];
};

const HISTORY_SCHEMA = "tavonel.synthetic_probe_history.v1" as const;

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string) {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * A query-signed URL for one object under `synthetic/`.
 *
 * Query signing rather than header signing so the body never enters the signature: the caller
 * sends `UNSIGNED-PAYLOAD` and R2 verifies the URL. `host` is the only signed header, which keeps
 * this one function correct for both the read and the write.
 */
function signedSyntheticUrl(
  env: R2SignerEnv,
  method: "GET" | "PUT",
  key: string,
  now: Date,
): { ok: true; url: string } | { ok: false; code: string } {
  const blocked = assertFoundationSyntheticKey(env.bucket, key);
  if (blocked) return { ok: false, code: blocked };
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = iso.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": iso,
    "X-Amz-Expires": "60",
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`)
    .join("&");
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", iso, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${env.secretAccessKey}`, dateStamp), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return { ok: true, url: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}` };
}

function validateHistory(value: unknown): ProbeHistory | null {
  if (!value || typeof value !== "object") return null;
  const history = value as Partial<ProbeHistory>;
  if (history.schemaVersion !== HISTORY_SCHEMA || !Array.isArray(history.runs)) return null;
  const runs: ProbeRun[] = [];
  for (const entry of history.runs as unknown[]) {
    const run = validateProbeRun(entry);
    // One bad run does not discard the rest, and it is not repaired into something plausible
    // either: it is dropped, so a reader sees fewer runs rather than an invented one.
    if (run) runs.push(run);
  }
  return { schemaVersion: HISTORY_SCHEMA, runs: runs.slice(0, PROBE_HISTORY_LIMIT) };
}

/**
 * The stored history, or a named refusal.
 *
 * `{ ok: true, history: { runs: [] } }` means the object exists and is empty or has never been
 * written -- that is NOT RUN, and /status renders it as NOT RUN. A read that failed is
 * `{ ok: false, code }` and is rendered as a failed read, never as NOT RUN: "we could not find
 * out" and "it has not run" are different sentences.
 */
export async function readProbeHistory(
  env: R2SignerEnv,
  now = new Date(),
): Promise<{ ok: true; history: ProbeHistory } | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  const signed = signedSyntheticUrl(env, "GET", PROBE_HISTORY_KEY, now);
  if (!signed.ok) return signed;
  let response: Response;
  try {
    response = await fetch(signed.url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return { ok: false, code: "PROBE_HISTORY_READ_FAILED" };
  }
  if (response.status === 404) return { ok: true, history: { schemaVersion: HISTORY_SCHEMA, runs: [] } };
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, code: "PROBE_HISTORY_READ_FAILED" };
  }
  const text = await response.text().catch(() => null);
  if (text === null || text.length > MAX_HISTORY_BYTES) return { ok: false, code: "PROBE_HISTORY_TOO_LARGE" };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, code: "PROBE_HISTORY_NOT_JSON" }; }
  const history = validateHistory(parsed);
  return history ? { ok: true, history } : { ok: false, code: "PROBE_HISTORY_INVALID" };
}

/** Newest first, capped. The run being written is trusted no more than the ones read back. */
export function nextProbeHistory(previous: ProbeHistory | null, run: ProbeRun): ProbeHistory {
  return {
    schemaVersion: HISTORY_SCHEMA,
    runs: [run, ...(previous?.runs ?? [])].slice(0, PROBE_HISTORY_LIMIT),
  };
}

export async function writeProbeHistory(
  env: R2SignerEnv,
  history: ProbeHistory,
  now = new Date(),
): Promise<{ ok: true; bytes: number } | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (history.runs.some((run) => run.schemaVersion !== PROBE_RUN_SCHEMA)) {
    return { ok: false, code: "PROBE_HISTORY_INVALID" };
  }
  const body = JSON.stringify(history);
  if (Buffer.byteLength(body, "utf8") > MAX_HISTORY_BYTES) return { ok: false, code: "PROBE_HISTORY_TOO_LARGE" };
  const signed = signedSyntheticUrl(env, "PUT", PROBE_HISTORY_KEY, now);
  if (!signed.ok) return signed;
  let response: Response;
  try {
    response = await fetch(signed.url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, code: "PROBE_HISTORY_WRITE_FAILED" };
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status !== 200 && response.status !== 204) return { ok: false, code: "PROBE_HISTORY_WRITE_FAILED" };
  return { ok: true, bytes: Buffer.byteLength(body, "utf8") };
}

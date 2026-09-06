import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { failureClasses } from "../../shared/uskcEnums";

export const FOUNDATION_R2_BUCKET = "tavonel-saas-foundation-quarantine";
export const SYNTHETIC_PREFIX = "synthetic/";
export const SYNTHETIC_CANARY_BODY = "TAVONEL foundation synthetic canary. Not customer data.\n";

export type R2SignerEnv = {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type SyntheticCanaryResult = {
  ok: boolean;
  code: string;
  key?: string;
  put?: number;
  head?: number;
  del?: number;
};

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string | Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

export function readR2SignerEnv(env: NodeJS.ProcessEnv = process.env): R2SignerEnv | null {
  const accountId = env.R2_ACCOUNT_ID?.trim() ?? "";
  const bucket = env.R2_BUCKET?.trim() ?? "";
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

export function assertFoundationSyntheticKey(bucket: string, key: string) {
  if (bucket !== FOUNDATION_R2_BUCKET) return "BUCKET_NOT_FOUNDATION";
  if (!key.startsWith(SYNTHETIC_PREFIX) || key.includes("..") || key.includes("//")) return "SYNTHETIC_PREFIX_REQUIRED";
  return null;
}

export function assertFoundationQuarantineKey(bucket: string, workspaceKey: string, documentId: string, key: string) {
  if (bucket !== FOUNDATION_R2_BUCKET) return "BUCKET_NOT_FOUNDATION";
  const expected = `quarantine/${workspaceKey}/${documentId}/source`;
  if (key !== expected || key.includes("..") || key.includes("//")) return "QUARANTINE_OBJECT_KEY_REQUIRED";
  return null;
}

export function authorizeSyntheticCanary(headerValue: string | null, token: string | undefined) {
  if (!token) return false;
  if (!headerValue?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(headerValue.slice("Bearer ".length));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function amzDate(now: Date) {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

async function signedS3Response(
  env: R2SignerEnv,
  method: "PUT" | "HEAD" | "DELETE" | "GET",
  key: string,
  body: Buffer | undefined,
  now = new Date(),
) {
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return signedS3Request(env, method, canonicalUri, "", body, now);
}

async function signedS3Request(
  env: R2SignerEnv,
  method: "PUT" | "HEAD" | "DELETE" | "GET",
  canonicalUri: string,
  canonicalQuery: string,
  body: Buffer | undefined,
  now = new Date(),
) {
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
  const { amzDate: xAmzDate, dateStamp } = amzDate(now);
  const region = "auto";
  const service = "s3";
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": xAmzDate,
  };
  if (body) headers["content-type"] = "text/plain; charset=utf-8";
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    xAmzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${env.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${env.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    return await fetch(`https://${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return null;
  }
}

async function signedS3(
  env: R2SignerEnv,
  method: "PUT" | "HEAD" | "DELETE",
  key: string,
  body: Buffer | undefined,
  now = new Date(),
) {
  return (await signedS3Response(env, method, key, body, now))?.status ?? 599;
}

/**
 * What R2 stored, not merely that it stored something.
 *
 * This was written for the synthetic canary, where only liveness mattered, and then reused for
 * confirmation without widening what it returns. The HEAD response was issued, read for its
 * status, and thrown away -- so a truncated, substituted or mistyped object that returned 200 was
 * indistinguishable from a good one, and confirmation accepted on existence alone.
 *
 * The response already carries everything needed to check that. Returning it costs nothing: the
 * request was always being made.
 */
export async function headFoundationQuarantineObject(
  env: R2SignerEnv,
  workspaceKey: string,
  documentId: string,
  now = new Date(),
) {
  const key = `quarantine/${workspaceKey}/${documentId}/source`;
  const blocked = assertFoundationQuarantineKey(env.bucket, workspaceKey, documentId, key);
  if (blocked) return { ok: false as const, code: blocked };
  const response = await signedS3Response(env, "HEAD", key, undefined, now);
  const status = response?.status ?? 599;
  if (status === 404) return { ok: true as const, exists: false as const };
  if (status !== 200 || !response) return { ok: false as const, code: "HEAD_FAILED", status };
  const contentLength = Number(response.headers.get("content-length") ?? "");
  return {
    ok: true as const,
    exists: true as const,
    key,
    /** Null only when R2 omitted the header; never a stand-in for an unknown size. */
    sizeBytes: Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : null,
    contentType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || null,
    etag: response.headers.get("etag")?.replaceAll('"', "") || null,
  };
}

/*
 * `readFoundationQuarantineObject` was here, and its absence is the change.
 *
 * Confirmation used it to fingerprint a free-evaluation source by downloading the object back
 * through the application server: a full GET, capped at 5 MiB, of an object intake admitted at
 * fifty. Every trial upload in between was stored in R2 and then failed confirmation with a 503
 * the workspace reported as "needs review". The digest now comes from the browser that sent the
 * bytes and from the CDR worker that read them, so no route reads a quarantine object body and
 * the ceiling conflict has nothing left to conflict over.
 */

/**
 * Where the CDR worker records a source it refused.
 *
 * A refused source never gets an immutable version -- that is what refused means -- so the receipt
 * cannot live under `immutable/` with the others and sits beside the source it refused instead.
 * Everything under `quarantine/<workspaceKey>/` belongs to that workspace, which is what makes a
 * prefix listing here tenant-safe: the prefix is derived from the authenticated principal and is
 * never taken from a request.
 */
export const CDR_REJECT_FILENAME = "cdr-reject.json";

export function foundationQuarantineRejectKey(workspaceKey: string, documentId: string) {
  return `quarantine/${workspaceKey}/${documentId}/${CDR_REJECT_FILENAME}`;
}

/** Bounded like the review-receipt hydration in /api/documents, and for the same reason. */
const MAX_LISTED_REJECTS = 20;
const MAX_REJECT_RECEIPT_BYTES = 4_096;
const DOCUMENT_SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * The document ids in this workspace whose source was refused.
 *
 * One `ListObjectsV2` page is enough and deliberately not paged: this is a display path, the cap
 * is disclosed by `truncated`, and a workspace with more than twenty refusals has a problem that
 * a longer list does not solve.
 */
export async function listFoundationQuarantineRejects(
  env: R2SignerEnv,
  workspaceKey: string,
  now = new Date(),
): Promise<{ ok: true; documentIds: string[]; truncated: boolean } | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(workspaceKey)) return { ok: false, code: "QUARANTINE_PREFIX_REQUIRED" };
  const prefix = `quarantine/${workspaceKey}/`;
  const query: Record<string, string> = { "list-type": "2", "max-keys": "1000", prefix };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`)
    .join("&");
  const response = await signedS3Request(env, "GET", `/${env.bucket}`, canonicalQuery, undefined, now);
  if (!response?.ok) return { ok: false, code: "LIST_FAILED" };
  const xml = await response.text();
  const documentIds: string[] = [];
  for (const block of xml.split(/<Contents>/i).slice(1)) {
    const key = /<Key>([^<]+)<\/Key>/i.exec(block)?.[1];
    if (!key || !key.startsWith(prefix) || !key.endsWith(`/${CDR_REJECT_FILENAME}`)) continue;
    const parts = key.slice(prefix.length).split("/");
    if (parts.length !== 2 || !DOCUMENT_SEGMENT.test(parts[0])) continue;
    documentIds.push(parts[0]);
  }
  return {
    ok: true,
    documentIds: documentIds.slice(0, MAX_LISTED_REJECTS),
    truncated: documentIds.length > MAX_LISTED_REJECTS,
  };
}

export type CdrRejectReceipt = {
  schemaVersion: "tavonel.cdr_reject_receipt.v1";
  sourceKey: string;
  observedBytes: number | null;
  declaredBytes: number | null;
  /** One of the frozen `FailureClass` values. Nothing else is accepted, ever. */
  reasonCode: string;
  provider: string;
  occurredAt: string;
};

const FAILURE_CLASSES: ReadonlySet<string> = new Set(failureClasses);

function optionalByteCount(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * A refusal receipt is evidence, so it is validated rather than trusted.
 *
 * The reason code must be a member of the frozen `FailureClass` set and the source key must be
 * the one this workspace and document actually own -- an object dropped into the bucket with a
 * plausible name cannot make the workspace show someone else's refusal, or a reason nobody
 * defined. Anything short of the whole shape is refused; a half-read receipt would be a worse
 * answer than none.
 */
export function validateCdrRejectReceipt(
  value: unknown,
  workspaceKey: string,
  documentId: string,
): CdrRejectReceipt | null {
  if (!value || typeof value !== "object") return null;
  const receipt = value as Partial<CdrRejectReceipt>;
  const observedBytes = optionalByteCount(receipt.observedBytes);
  const declaredBytes = optionalByteCount(receipt.declaredBytes);
  if (
    receipt.schemaVersion !== "tavonel.cdr_reject_receipt.v1" ||
    receipt.sourceKey !== `quarantine/${workspaceKey}/${documentId}/source` ||
    observedBytes === undefined ||
    declaredBytes === undefined ||
    typeof receipt.reasonCode !== "string" ||
    !FAILURE_CLASSES.has(receipt.reasonCode) ||
    typeof receipt.provider !== "string" ||
    receipt.provider.length < 1 ||
    receipt.provider.length > 64 ||
    typeof receipt.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(receipt.occurredAt))
  ) return null;
  return { ...receipt, observedBytes, declaredBytes } as CdrRejectReceipt;
}

/** Reads one refusal receipt. Never the source: the key is pinned to the receipt filename. */
export async function getFoundationQuarantineReject(
  env: R2SignerEnv,
  workspaceKey: string,
  documentId: string,
  now = new Date(),
): Promise<{ ok: true; receipt: CdrRejectReceipt } | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(workspaceKey) || !DOCUMENT_SEGMENT.test(documentId)) {
    return { ok: false, code: "QUARANTINE_OBJECT_KEY_REQUIRED" };
  }
  const response = await signedS3Response(
    env,
    "GET",
    foundationQuarantineRejectKey(workspaceKey, documentId),
    undefined,
    now,
  );
  if (!response) return { ok: false, code: "READ_FAILED" };
  if (response.status === 404) return { ok: false, code: "NOT_FOUND" };
  if (!response.ok) return { ok: false, code: "READ_FAILED" };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_REJECT_RECEIPT_BYTES) return { ok: false, code: "JSON_TOO_LARGE" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, code: "NOT_JSON" };
  }
  const receipt = validateCdrRejectReceipt(parsed, workspaceKey, documentId);
  return receipt ? { ok: true, receipt } : { ok: false, code: "REJECT_RECEIPT_INVALID" };
}

export async function runSyntheticR2Canary(env: R2SignerEnv, now = new Date()): Promise<SyntheticCanaryResult> {
  const key = `synthetic/qualification/canary-${now.getTime()}.txt`;
  const blocked = assertFoundationSyntheticKey(env.bucket, key);
  if (blocked) return { ok: false, code: blocked, key };
  const body = Buffer.from(SYNTHETIC_CANARY_BODY, "utf8");
  const put = await signedS3(env, "PUT", key, body, now);
  if (put !== 200 && put !== 204) return { ok: false, code: "PUT_FAILED", key, put };
  const head = await signedS3(env, "HEAD", key, undefined, now);
  if (head !== 200) return { ok: false, code: "HEAD_FAILED", key, put, head };
  const del = await signedS3(env, "DELETE", key, undefined, now);
  if (del !== 200 && del !== 204) return { ok: false, code: "DELETE_FAILED", key, put, head, del };
  return { ok: true, code: "SYNTHETIC_CANARY_OK", key, put, head, del };
}

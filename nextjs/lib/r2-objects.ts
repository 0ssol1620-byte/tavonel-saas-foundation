import { createHash, createHmac } from "node:crypto";
import { FOUNDATION_R2_BUCKET, type R2SignerEnv } from "./r2-synthetic-canary";
import { assertWorkspaceSanitizedPdfKey } from "./r2-presign";
import { readBoundedSourceBody } from "./bounded-source-body";
import {
  immutableWorkspacePrefix,
  isCollectionCandidateKey,
  isKeyInsideWorkspacePrefix,
  isOcrReviewKey,
  isOcrJsonKey,
  type ImmutableObjectMeta,
} from "./immutable-keys";

/*
  The read bound for one ocr.json, equal to the worker's write bound for it.

  It was 4 MiB, a sixth of what the worker persists (`MAX_PERSISTED_OCR_BYTES`, 24 MiB, in
  quarantine-sidecar/foundation-cdr-worker/src/ocr.ts), so a source the product accepts could be
  read, stored, and then refused at structuring on size alone. Sized from the schema
  (tavonel.ocr_result.v2: 207 B of keys and numbers per region, plus its text, plus the same text
  again in the top-level `text`), 2026-11-04:

    12 pages x 19 regions x 60 chars ........ 75 KB (Latin) / 130 KB (Hangul)
    80 pages x 150 regions x 40 Hangul chars . 5.4 MB  -- over the old 4 MiB, inside the ceiling
    80 pages x 625 regions x 79 Latin chars .. 18.4 MB -- the worker's region and text caps
    the same in Hangul ....................... 34.2 MB -- refused by the worker, never stored

  Every ocr.json the worker can store is therefore readable here, and nothing larger exists to
  read. `intake-ceiling-cross-tree.test.ts` pins the two numbers together. Regions per page in
  production are not measured; the worker's caps stand in for the measurement.
*/
export const MAX_DERIVED_JSON_BYTES = 24 * 1024 * 1024;
export const MAX_COLLECTION_JSON_BYTES = 32 * 1024 * 1024;

/**
 * Which object a JSON_TOO_LARGE refused, how big it was, and the bound it crossed.
 *
 * Carries no key and no content, so it can go into a job event as it is. `bytes` is exact for a
 * buffered body; for a streamed read cut off at the bound it is the declared Content-Length, or
 * null when the store declared none.
 */
export type JsonSizeLimit = { object: "ocr.json" | "candidate-world.json"; bytes: number | null; bound: number };
type TooLarge = { ok: false; code: "JSON_TOO_LARGE"; sizeLimit: JsonSizeLimit };
const tooLarge = (object: JsonSizeLimit["object"], bytes: number | null, bound: number): TooLarge =>
  ({ ok: false, code: "JSON_TOO_LARGE", sizeLimit: { object, bytes, bound } });
const declaredLength = (response: Response) => {
  const value = Number(response.headers.get("content-length") ?? Number.NaN);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string | Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

function amzDate(now: Date) {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

async function signedS3Get(
  env: R2SignerEnv,
  canonicalUri: string,
  canonicalQuery: string,
  now = new Date(),
) {
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const payloadHash = sha256Hex("");
  const { amzDate: xAmzDate, dateStamp } = amzDate(now);
  const region = "auto";
  const service = "s3";
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": xAmzDate,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", xAmzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${env.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${env.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const query = canonicalQuery ? `?${canonicalQuery}` : "";
  try {
    return await fetch(`https://${host}${canonicalUri}${query}`, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return new Response(null, { status: 599 });
  }
}

export async function getWorkspaceSanitizedPdf(env: R2SignerEnv, workspaceId: string, key: string): Promise<
  { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; code: string }
> {
  const blocked = assertWorkspaceSanitizedPdfKey(env.bucket, workspaceId, key);
  if (blocked) return { ok: false, code: blocked };
  const digest = /\/([a-f0-9]{64})\/sanitized\.pdf$/.exec(key)?.[1];
  if (!digest) return { ok: false, code: "KEY_NOT_QUALIFIED" };
  const uri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const response = await signedS3Get(env, uri, "");
  if (!response.ok) return { ok: false, code: response.status === 404 ? "NOT_FOUND" : "SOURCE_READ_FAILED" };
  const body = await readBoundedSourceBody(response, 32 * 1024 * 1024);
  if (!body.ok) return body;
  if (createHash("sha256").update(body.bytes).digest("hex") !== digest) return { ok: false, code: "SOURCE_DIGEST_MISMATCH" };
  return body;
}

async function signedS3PutJson(
  env: R2SignerEnv,
  key: string,
  bytes: Buffer,
  now = new Date(),
) {
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const payloadHash = sha256Hex(bytes);
  const { amzDate: xAmzDate, dateStamp } = amzDate(now);
  const region = "auto";
  const service = "s3";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host,
    "if-none-match": "*",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": xAmzDate,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", xAmzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${env.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${env.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    return await fetch(`https://${host}${canonicalUri}`, {
      method: "PUT",
      headers,
      body: Uint8Array.from(bytes),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return new Response(null, { status: 599 });
  }
}

function parseListContents(xml: string): ImmutableObjectMeta[] {
  const items: ImmutableObjectMeta[] = [];
  const blocks = xml.split(/<Contents>/i).slice(1);
  for (const block of blocks) {
    const key = /<Key>([^<]+)<\/Key>/i.exec(block)?.[1];
    const sizeRaw = /<Size>([^<]+)<\/Size>/i.exec(block)?.[1];
    const lastModifiedRaw = /<LastModified>([^<]+)<\/LastModified>/i.exec(block)?.[1];
    if (!key) continue;
    const size = Number(sizeRaw ?? "0");
    const lastModified = lastModifiedRaw ? decodeXml(lastModifiedRaw) : undefined;
    items.push({ key: decodeXml(key), size: Number.isFinite(size) ? size : 0,
      ...(lastModified ? { lastModified } : {}) });
  }
  return items;
}

function decodeXml(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function assertFoundationListPrefix(bucket: string, workspaceId: string, prefix: string) {
  if (bucket !== FOUNDATION_R2_BUCKET) return "BUCKET_NOT_FOUNDATION";
  const expected = immutableWorkspacePrefix(workspaceId);
  if (!expected || prefix !== expected) return "WORKSPACE_PREFIX_REQUIRED";
  return null;
}

export async function listImmutableWorkspaceObjects(
  env: R2SignerEnv,
  workspaceId: string,
  now = new Date(),
): Promise<{ ok: true; objects: ImmutableObjectMeta[] } | { ok: false; code: string }> {
  const prefix = immutableWorkspacePrefix(workspaceId);
  const blocked = assertFoundationListPrefix(env.bucket, workspaceId, prefix);
  if (blocked) return { ok: false, code: blocked };
  const objects: ImmutableObjectMeta[] = [];
  let continuation: string | undefined;
  for (let page = 0; page < 8; page += 1) {
    const query: Record<string, string> = {
      "list-type": "2",
      // ListObjectsV2 permits 1,000 keys. The old 200-key page made a mature
      // workspace exceed the request budget even though R2 itself was healthy.
      "max-keys": "1000",
      prefix,
    };
    if (continuation) query["continuation-token"] = continuation;
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`)
      .join("&");
    const canonicalUri = `/${env.bucket}`;
    const response = await signedS3Get(env, canonicalUri, canonicalQuery, now);
    if (!response.ok) return { ok: false, code: "LIST_FAILED" };
    const xml = await response.text();
    objects.push(
      ...parseListContents(xml).filter((item) => isKeyInsideWorkspacePrefix(workspaceId, item.key)),
    );
    const truncation = /<IsTruncated>\s*(true|false)\s*<\/IsTruncated>/i.exec(xml)?.[1]?.toLowerCase();
    if (!truncation) return { ok: false, code: "LIST_INVALID" };
    const truncated = truncation === "true";
    continuation = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/i.exec(xml)?.[1];
    if (!truncated) break;
    if (!continuation) return { ok: false, code: "LIST_INVALID" };
    // A partial inventory is not an inventory. Returning the first 8,000 keys as a success can
    // hide a newer source version and make every current-version fence agree on the same stale
    // answer. The caller must move to a durable source ledger before this workspace can grow past
    // the bounded R2 fallback.
    if (page === 7) return { ok: false, code: "LIST_LIMIT_EXCEEDED" };
  }
  return { ok: true, objects };
}

export async function getWorkspaceOcrJson(
  env: R2SignerEnv,
  workspaceId: string,
  key: string,
  now = new Date(),
  maximumBytes = MAX_DERIVED_JSON_BYTES,
): Promise<{ ok: true; json: unknown; byteLength: number } | TooLarge | { ok: false; code: string }> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > MAX_DERIVED_JSON_BYTES) {
    return tooLarge("ocr.json", null, Number.isSafeInteger(maximumBytes) ? maximumBytes : 0);
  }
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!isOcrJsonKey(workspaceId, key)) return { ok: false, code: "OCR_JSON_PREFIX_REQUIRED" };
  if (key.toLowerCase().endsWith(".pdf")) return { ok: false, code: "PDF_BYTES_FORBIDDEN" };
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const response = await signedS3Get(env, canonicalUri, "", now);
  if (response.status === 404) return { ok: false, code: "NOT_FOUND" };
  if (!response.ok) return { ok: false, code: "GET_FAILED" };
  const body = await readBoundedSourceBody(response, maximumBytes);
  if (!body.ok) {
    return body.code === "SOURCE_SIZE_UNQUALIFIED"
      ? tooLarge("ocr.json", declaredLength(response), maximumBytes)
      : { ok: false, code: "GET_FAILED" };
  }
  const bytes = Buffer.from(body.bytes);
  if (bytes.subarray(0, 4).toString("utf8") === "%PDF") return { ok: false, code: "PDF_BYTES_FORBIDDEN" };
  try {
    return { ok: true, json: JSON.parse(bytes.toString("utf8")), byteLength: bytes.length };
  } catch {
    return { ok: false, code: "NOT_JSON" };
  }
}

export async function getWorkspaceOcrReviewJson(
  env: R2SignerEnv,
  workspaceId: string,
  key: string,
  now = new Date(),
): Promise<{ ok: true; json: unknown } | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!isOcrReviewKey(workspaceId, key)) return { ok: false, code: "OCR_REVIEW_PREFIX_REQUIRED" };
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const response = await signedS3Get(env, canonicalUri, "", now);
  if (response.status === 404) return { ok: false, code: "NOT_FOUND" };
  if (!response.ok) return { ok: false, code: "GET_FAILED" };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 16_384) return { ok: false, code: "JSON_TOO_LARGE" };
  try {
    return { ok: true, json: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return { ok: false, code: "NOT_JSON" };
  }
}

export async function putWorkspaceCollectionCandidate(
  env: R2SignerEnv,
  workspaceId: string,
  key: string,
  value: unknown,
  now = new Date(),
): Promise<{ ok: true; status: "written" | "exists"; bytes: number } | TooLarge | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!isCollectionCandidateKey(workspaceId, key)) return { ok: false, code: "COLLECTION_JSON_PREFIX_REQUIRED" };
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.length > MAX_COLLECTION_JSON_BYTES) return tooLarge("candidate-world.json", bytes.length, MAX_COLLECTION_JSON_BYTES);
  const response = await signedS3PutJson(env, key, bytes, now);
  if (response.status === 409 || response.status === 412) return { ok: true, status: "exists", bytes: bytes.length };
  if (!response.ok) return { ok: false, code: "PUT_FAILED" };
  return { ok: true, status: "written", bytes: bytes.length };
}

export async function getWorkspaceCollectionCandidate(
  env: R2SignerEnv,
  workspaceId: string,
  key: string,
  now = new Date(),
): Promise<{ ok: true; json: unknown } | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!isCollectionCandidateKey(workspaceId, key)) return { ok: false, code: "COLLECTION_JSON_PREFIX_REQUIRED" };
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const response = await signedS3Get(env, canonicalUri, "", now);
  if (response.status === 404) return { ok: false, code: "NOT_FOUND" };
  if (response.status === 403) return { ok: false, code: "GET_FORBIDDEN" };
  if (response.status === 599) return { ok: false, code: "GET_TIMEOUT" };
  if (!response.ok) return { ok: false, code: `GET_FAILED_${response.status}` };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_COLLECTION_JSON_BYTES) return tooLarge("candidate-world.json", bytes.length, MAX_COLLECTION_JSON_BYTES);
  try {
    return { ok: true, json: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return { ok: false, code: "NOT_JSON" };
  }
}

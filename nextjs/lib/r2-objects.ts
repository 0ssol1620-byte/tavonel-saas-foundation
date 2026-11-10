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
import { OCR_JSON_MAX_BYTES } from "../../shared/intakeCeiling";

/*
  The read bound for one ocr.json, equal to the worker's write bound for it.

  It was 4 MiB, a sixth of what the worker persists (`MAX_PERSISTED_OCR_BYTES`, 24 MiB, in
  quarantine-sidecar/foundation-cdr-worker/src/ocr.ts), so a source the product accepts could be
  read, stored, and then refused at structuring on size alone. Sized from the schema
  (tavonel.ocr_result.v2: 207 B of keys and numbers per region, plus its text, plus the same text
  again in the top-level `text`) at the line-OCR densities observed on the GDP sample
  (86 / 175 / 876 regions a page, hard-proof 2026-10-27), 30-character lines, 2026-11-04:

    12 pages x 876 regions .......... 2.8 MB (Latin) / 4.1 MB (Hangul)
    80 pages x 175 regions .......... 3.8 MB (Latin) / 5.5 MB (Hangul) -- over the old 4 MiB
    80 pages x 625 regions .......... 13.5 MB / 19.5 MB -- 50,000 regions, the worker's cap
    80 x 625 x 79 Hangul chars ...... 34.2 MB -- refused by the worker, never stored

  Every ocr.json the worker can store is therefore readable here, and nothing larger exists to
  read. `intake-ceiling-cross-tree.test.ts` pins the two numbers together.

  Readable is not compilable. What one compile can carry is decided downstream by the Core
  request bound (`CORE_V2_MAX_REQUEST_BYTES`), and what a route can return by the response
  bound (`OCR_JSON_RESPONSE_MAX_BYTES`); both refuse with a named code before the platform would.

  Derived from the intake ceiling stage (shared/intakeCeiling.ts OCR_JSON_MAX_BYTES): 24 MiB at
  stage 0 (80 pages), the same per page at any other stage. The worker's stage table matches it.
*/
export const MAX_DERIVED_JSON_BYTES = OCR_JSON_MAX_BYTES;
/*
  The largest stored candidate World, and the same number as Core's output budget
  (`akc_product_core.compiler.OUTPUT_BUDGET_BYTES`), so the two sides refuse at one size.

  It was 32 MiB, a constant with no platform behind it: R2 takes a 5 GiB single PUT, and the Core
  answer is streamed (one ran past 80 MiB into this side on 2026-11-09, cjob-749b). Six manuals --
  6,072 regions, cjob-fac5555a, 2026-11-10 -- already crossed it, and a corpus part is twelve
  documents (`COMPILE_MAX_DOCUMENTS`). Re-derived from a measurement (manual-shaped synthetic
  corpus, ~1,012 regions a document, live Core 733f4453; receipts in
  market-20261104/w2/OUT-20261110/):

    documents  Core response   Core peak RSS   this side: stored   this side: peak RSS
        6         87.5 MB          578 MiB
       12        176.2 MB        1,102 MiB         101.1 MB              902 MiB

  192 MiB holds a twelve-document part at that density with ~10% to spare, inside the 2 GB both
  functions run with. It is a size bound, not an integrity check: every digest, receipt and
  validation check is unchanged, and an output over it is still refused by name with its numbers.
  What it does not settle: Core time (12 documents took 28 s locally against a 52 s Core budget)
  and R2 transfer time inside the 8 s object timeouts are unmeasured on the deployed functions.
*/
export const MAX_COLLECTION_JSON_BYTES = 192 * 1024 * 1024;
/**
 * The ocr-review.json read bound, equal to the worker's `MAX_RECEIPT_BYTES` (src/sanitize.ts).
 *
 * The receipt is one fixed record (tavonel.ocr_review_receipt.v2): no field grows with pages.
 * Its largest legal form -- a 512-character Hangul reason and a 160-character request id -- is
 * 2,368 bytes for a 1-, 12- or 80-page source alike.
 */
export const MAX_OCR_REVIEW_JSON_BYTES = 16 * 1024;
/**
 * The largest ocr.json a route may return whole. A non-streamed Vercel function response is
 * bounded at 4.5 MB (documented, not measured here); 4 MiB leaves room for the envelope, and a
 * larger document is a named 413 rather than a platform 500 with no code.
 */
export const OCR_JSON_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Which object a size refusal named, how big it was, and the bound it crossed.
 *
 * Carries no key and no content, so it can go into a job event as it is. `bytes` is exact for a
 * buffered body. A streamed read is cut off at the bound without reading the rest, so there it
 * is the declared Content-Length when that already exceeds the bound, and null otherwise: a
 * compressed or missing length is not reported as a size.
 */
export type JsonSizeLimit = {
  object: "ocr.json" | "ocr-review.json" | "candidate-world.json" | "compile-input" | "core-request";
  bytes: number | null;
  bound: number;
  /** Candidate only: the five largest `package.files[]` by content bytes. Paths, never content. */
  largestPackageFiles?: Array<{ path: string; sizeBytes: number }>;
  /** Candidate only: the artifact's own `validation.counts` (numbers only). */
  validationCounts?: Record<string, number>;
};
type TooLarge = { ok: false; code: "JSON_TOO_LARGE"; sizeLimit: JsonSizeLimit };
const tooLarge = (object: JsonSizeLimit["object"], bytes: number | null, bound: number): TooLarge =>
  ({ ok: false, code: "JSON_TOO_LARGE", sizeLimit: { object, bytes, bound } });
const declaredLengthOver = (response: Response, bound: number) => {
  const value = Number(response.headers.get("content-length") ?? Number.NaN);
  return Number.isSafeInteger(value) && value > bound ? value : null;
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
    // An empty object is a malformed binding, never a size: it stays NOT_JSON -> OCR_BINDING_INVALID.
    if (body.empty) return { ok: false, code: "NOT_JSON" };
    return body.code === "SOURCE_SIZE_UNQUALIFIED"
      ? tooLarge("ocr.json", declaredLengthOver(response, maximumBytes), maximumBytes)
      : { ok: false, code: "GET_FAILED" };
  }
  // A view, not a copy: at 24 MiB a second buffer is not free.
  const bytes = Buffer.from(body.bytes.buffer, body.bytes.byteOffset, body.bytes.byteLength);
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
): Promise<{ ok: true; json: unknown } | TooLarge | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!isOcrReviewKey(workspaceId, key)) return { ok: false, code: "OCR_REVIEW_PREFIX_REQUIRED" };
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const response = await signedS3Get(env, canonicalUri, "", now);
  if (response.status === 404) return { ok: false, code: "NOT_FOUND" };
  if (!response.ok) return { ok: false, code: "GET_FAILED" };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) return { ok: false, code: "NOT_JSON" };
  if (bytes.length > MAX_OCR_REVIEW_JSON_BYTES) return tooLarge("ocr-review.json", bytes.length, MAX_OCR_REVIEW_JSON_BYTES);
  try {
    return { ok: true, json: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return { ok: false, code: "NOT_JSON" };
  }
}

/**
 * Core-chosen text for a job-event detail, at most `maxBytes` of UTF-8, cut on a code point.
 * Control characters and lone surrogates are replaced first: Postgres jsonb refuses `\u0000`
 * and unpaired surrogates, and escaping (6x for a control character) could push the detail past
 * its 8 KiB check -- either way the row is refused and the attribution is lost without a trace.
 */
function boundedDetailText(text: string, maxBytes: number) {
  const safe = text.replace(/[\u0000-\u001f\u007f]/g, "?")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "�");
  let out = "";
  let bytes = 0;
  for (const char of safe) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes) break;
    out += char;
    bytes += size;
  }
  return out;
}

/** The five largest `package.files[]` entries by content bytes. Paths and sizes only. */
function largestPackageFiles(value: unknown) {
  const files = (value as { package?: { files?: unknown } } | null)?.package?.files;
  if (!Array.isArray(files)) return [];
  return files
    .flatMap((file) => {
      const entry = file as { path?: unknown; content?: unknown } | null;
      if (typeof entry?.path !== "string") return [];
      const content = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content ?? null);
      // Five 256 B paths (escaping at most doubles them) always fit the 8 KiB job-event detail.
      return [{ path: boundedDetailText(entry.path, 256), sizeBytes: Buffer.byteLength(content, "utf8") }];
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, 5);
}

/**
 * The candidate's stored bytes, or the size refusal -- with no side effect, so a compile learns
 * the object cannot be stored before it audits a receipt or registers provenance for it. The
 * refusal names the total and the largest package files, so an oversized World is attributable
 * from the job event alone (cjob-157f2f23: 134,576,916 B, producer unobserved).
 */
export function serializeCollectionCandidate(
  value: unknown,
  bound = MAX_COLLECTION_JSON_BYTES,
): { ok: true; body: Buffer } | TooLarge {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (body.length <= bound) return { ok: true, body };
  const refused = tooLarge("candidate-world.json", body.length, bound);
  const largest = largestPackageFiles(value);
  if (largest.length > 0) refused.sizeLimit.largestPackageFiles = largest;
  // Claims / relations / contradictions vs evidence: tells a pair blow-up from region fan-out.
  const counts = (value as { validation?: { counts?: unknown } } | null)?.validation?.counts;
  if (counts && typeof counts === "object") {
    const numeric = Object.entries(counts).filter((entry): entry is [string, number] => Number.isSafeInteger(entry[1]))
      .slice(0, 16).map(([key, count]) => [boundedDetailText(key, 64), count] as const);
    if (numeric.length > 0) refused.sizeLimit.validationCounts = Object.fromEntries(numeric);
  }
  return refused;
}

export async function putWorkspaceCollectionCandidate(
  env: R2SignerEnv,
  workspaceId: string,
  key: string,
  value: unknown,
  now = new Date(),
): Promise<{ ok: true; status: "written" | "exists"; bytes: number } | TooLarge | { ok: false; code: string }> {
  const serialized = serializeCollectionCandidate(value);
  if (!serialized.ok) return serialized;
  return putSerializedCollectionCandidate(env, workspaceId, key, serialized.body, now);
}

/** The PUT half of `putWorkspaceCollectionCandidate`, for bytes `serializeCollectionCandidate` produced. */
export async function putSerializedCollectionCandidate(
  env: R2SignerEnv,
  workspaceId: string,
  key: string,
  bytes: Buffer,
  now = new Date(),
): Promise<{ ok: true; status: "written" | "exists"; bytes: number } | TooLarge | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!isCollectionCandidateKey(workspaceId, key)) return { ok: false, code: "COLLECTION_JSON_PREFIX_REQUIRED" };
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

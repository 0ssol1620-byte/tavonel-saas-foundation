import { createHash, createHmac } from "node:crypto";
import { FOUNDATION_R2_BUCKET, type R2SignerEnv } from "./r2-synthetic-canary";
import {
  immutableWorkspacePrefix,
  isCollectionCandidateKey,
  isKeyInsideWorkspacePrefix,
  isOcrReviewKey,
  isOcrJsonKey,
  type ImmutableObjectMeta,
} from "./immutable-keys";

const MAX_OCR_JSON_BYTES = 4 * 1024 * 1024;
const MAX_COLLECTION_CANDIDATE_JSON_BYTES = 16 * 1024 * 1024;

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
      headers,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return new Response(null, { status: 599 });
  }
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
    if (!key) continue;
    const size = Number(sizeRaw ?? "0");
    items.push({ key: decodeXml(key), size: Number.isFinite(size) ? size : 0 });
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
      "max-keys": "200",
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
    const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
    continuation = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/i.exec(xml)?.[1];
    if (!truncated || !continuation) break;
  }
  return { ok: true, objects };
}

export async function getWorkspaceOcrJson(
  env: R2SignerEnv,
  workspaceId: string,
  key: string,
  now = new Date(),
): Promise<{ ok: true; json: unknown } | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!isOcrJsonKey(workspaceId, key)) return { ok: false, code: "OCR_JSON_PREFIX_REQUIRED" };
  if (key.toLowerCase().endsWith(".pdf")) return { ok: false, code: "PDF_BYTES_FORBIDDEN" };
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const response = await signedS3Get(env, canonicalUri, "", now);
  if (response.status === 404) return { ok: false, code: "NOT_FOUND" };
  if (!response.ok) return { ok: false, code: "GET_FAILED" };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_OCR_JSON_BYTES) return { ok: false, code: "JSON_TOO_LARGE" };
  if (bytes.subarray(0, 4).toString("utf8") === "%PDF") return { ok: false, code: "PDF_BYTES_FORBIDDEN" };
  try {
    return { ok: true, json: JSON.parse(bytes.toString("utf8")) };
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
): Promise<{ ok: true; status: "written" | "exists"; bytes: number } | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!isCollectionCandidateKey(workspaceId, key)) return { ok: false, code: "COLLECTION_JSON_PREFIX_REQUIRED" };
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.length === 0 || bytes.length > MAX_COLLECTION_CANDIDATE_JSON_BYTES) {
    return { ok: false, code: "JSON_TOO_LARGE" };
  }
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
  if (!response.ok) return { ok: false, code: "GET_FAILED" };
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_COLLECTION_CANDIDATE_JSON_BYTES) return { ok: false, code: "JSON_TOO_LARGE" };
  try {
    return { ok: true, json: JSON.parse(bytes.toString("utf8")) };
  } catch {
    return { ok: false, code: "NOT_JSON" };
  }
}

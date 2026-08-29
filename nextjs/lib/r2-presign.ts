import { createHash, createHmac } from "node:crypto";
import { FOUNDATION_R2_BUCKET, type R2SignerEnv } from "./r2-synthetic-canary";
import { immutableWorkspacePrefix } from "./immutable-keys";

export const QUARANTINE_PREFIX = "quarantine/";
export const FOUNDATION_INTAKE_MAX_BYTES = 5 * 1024 * 1024;

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string) {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function assertFoundationQuarantineKey(bucket: string, key: string) {
  if (bucket !== FOUNDATION_R2_BUCKET) return "BUCKET_NOT_FOUNDATION";
  if (!key.startsWith(QUARANTINE_PREFIX) || key.includes("..") || key.includes("//") || key.startsWith("synthetic/")) {
    return "QUARANTINE_PREFIX_REQUIRED";
  }
  return null;
}

/**
 * The one key shape a reader is allowed to fetch for itself.
 *
 * The progress object exists so a person can watch a document being read. Serving it through this
 * application would put the reading -- and eventually the document -- on a path the product says
 * it never travels: "the application server never carries file bytes" is printed on the workspace
 * page. So the browser fetches it the same way it uploaded: directly, with a short-lived
 * capability this server signs but does not carry.
 *
 * The URL is therefore a capability, and the check below is what keeps it narrow. It must name a
 * progress object, inside the caller's own workspace prefix, and nothing else. Widening this
 * function is widening what a signed URL can reach.
 */
export function assertWorkspaceProgressKey(bucket: string, workspaceId: string, key: string) {
  if (bucket !== FOUNDATION_R2_BUCKET) return "BUCKET_NOT_FOUNDATION";
  if (key.includes("..") || key.includes("//")) return "KEY_NOT_QUALIFIED";
  if (!key.startsWith(immutableWorkspacePrefix(workspaceId))) return "KEY_OUTSIDE_WORKSPACE";
  if (!key.endsWith("/ocr-progress.json")) return "KEY_NOT_PROGRESS";
  return null;
}

/** Signs a short-lived GET for one progress object. Read-only, single key, no listing. */
export function presignWorkspaceProgressGet(
  env: R2SignerEnv,
  {
    workspaceId,
    key,
    expiresInSeconds,
    now = new Date(),
  }: {
    workspaceId: string;
    key: string;
    expiresInSeconds: number;
    now?: Date;
  },
) {
  const blocked = assertWorkspaceProgressKey(env.bucket, workspaceId, key);
  if (blocked) return { ok: false as const, code: blocked };
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = iso.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": iso,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`)
    .join("&");
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", iso, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${env.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return { ok: true as const, readUrl: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}` };
}

export function presignFoundationQuarantinePut(
  env: R2SignerEnv,
  {
    key,
    contentType,
    contentLength,
    expiresInSeconds,
    now = new Date(),
  }: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
    now?: Date;
  },
) {
  const blocked = assertFoundationQuarantineKey(env.bucket, key);
  if (blocked) return { ok: false as const, code: blocked };
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = iso.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": iso,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "content-type;host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`)
    .join("&");
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    "content-type;host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", iso, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${env.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const uploadUrl = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return { ok: true as const, uploadUrl, contentLength };
}

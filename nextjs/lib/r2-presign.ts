import { createHash, createHmac } from "node:crypto";
import { FOUNDATION_R2_BUCKET, type R2SignerEnv } from "./r2-synthetic-canary";
import { immutableWorkspacePrefix } from "./immutable-keys";

export const QUARANTINE_PREFIX = "quarantine/";
/** Browser-direct R2 uploads never traverse the application server. Paid/owner workspaces can
 * therefore accept real manuals and technical packages without an arbitrary 5 MiB bottleneck. */
export const FOUNDATION_INTAKE_MAX_BYTES = 250 * 1024 * 1024;
/** Free evaluation stays bounded independently of page/compute quotas. */
export const FOUNDATION_TRIAL_INTAKE_MAX_BYTES = 50 * 1024 * 1024;

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

export function assertWorkspaceProgressKey(bucket: string, workspaceId: string, key: string) {
  if (bucket !== FOUNDATION_R2_BUCKET) return "BUCKET_NOT_FOUNDATION";
  if (key.includes("..") || key.includes("//")) return "KEY_NOT_QUALIFIED";
  if (!key.startsWith(immutableWorkspacePrefix(workspaceId))) return "KEY_OUTSIDE_WORKSPACE";
  if (!key.endsWith("/ocr-progress.json")) return "KEY_NOT_PROGRESS";
  return null;
}

export function assertWorkspaceSanitizedPdfKey(bucket: string, workspaceId: string, key: string) {
  if (bucket !== FOUNDATION_R2_BUCKET) return "BUCKET_NOT_FOUNDATION";
  if (key.includes("..") || key.includes("//")) return "KEY_NOT_QUALIFIED";
  if (!key.startsWith(immutableWorkspacePrefix(workspaceId))) return "KEY_OUTSIDE_WORKSPACE";
  if (!key.endsWith("/sanitized.pdf")) return "KEY_NOT_SANITIZED_PDF";
  return null;
}

function presignWorkspaceGet(
  env: R2SignerEnv,
  input: { workspaceId: string; key: string; expiresInSeconds: number; now?: Date },
  validate: (bucket: string, workspaceId: string, key: string) => string | null,
) {
  const blocked = validate(env.bucket, input.workspaceId, input.key);
  if (blocked) return { ok: false as const, code: blocked };
  const { key, expiresInSeconds, now = new Date() } = input;
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = iso.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": iso,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query).sort().map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`).join("&");
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", iso, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${env.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return { ok: true as const, readUrl: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}` };
}

export function presignWorkspaceSanitizedPdfGet(
  env: R2SignerEnv,
  input: { workspaceId: string; key: string; expiresInSeconds: number; now?: Date },
) {
  return presignWorkspaceGet(env, input, assertWorkspaceSanitizedPdfKey);
}

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
  return presignWorkspaceGet(env, { workspaceId, key, expiresInSeconds, now }, assertWorkspaceProgressKey);
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

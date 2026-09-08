import { createHash, createHmac } from "node:crypto";
import { PROCESSING_CEILING } from "../../shared/intakeCeiling";
/** Re-exported so a route reads one intake module instead of two. */
export { PROCESSING_CEILING, PROCESSING_CEILING_SENTENCE } from "../../shared/intakeCeiling";
import { FOUNDATION_R2_BUCKET, type R2SignerEnv } from "./r2-synthetic-canary";
import { immutableWorkspacePrefix } from "./immutable-keys";

export const QUARANTINE_PREFIX = "quarantine/";
/**
 * What intake admits, which is exactly what the deployment can process.
 *
 * This was 250 MiB, on the correct reasoning that browser-direct R2 transfer removed the
 * application server from the byte path. The mistake was that the 5 MiB constant it replaced was
 * not an application-server bottleneck at all: it lives in the CDR worker and in the Cloud Run
 * rasterizer, in two other trees, and nothing related them. So everything between 5 and 250 MiB
 * was admitted, stored, billed and then permanently refused, and the customer was told the
 * source was being prepared while it was being dropped.
 *
 * Admitting a source the deployment cannot process is not a bigger limit, it is a worse refusal.
 * Both ceilings are now derived from `shared/intakeCeiling.ts`, so the number cannot drift from
 * the processors again, and `r2-presign.test.ts` asserts intake is never above what they read.
 * Raising it for real is decomposition (D1-01's second half), not a larger constant.
 */
export const FOUNDATION_INTAKE_MAX_BYTES = PROCESSING_CEILING.maxSourceBytes;
/** Free evaluation stays bounded independently, and never above what can be processed. */
export const FOUNDATION_TRIAL_INTAKE_MAX_BYTES = Math.min(50 * 1024 * 1024, PROCESSING_CEILING.maxSourceBytes);

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
  // The byte count is signed now, so an impossible one must not reach the signature at all.
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > FOUNDATION_INTAKE_MAX_BYTES) {
    return { ok: false as const, code: "CONTENT_LENGTH_INVALID" };
  }
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = iso.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  /*
   * The byte count enters the signature.
   *
   * It was accepted, charged for, returned to the client -- and never bound to anything. The
   * capability said "one object, this key, this type", the quota accounting summed the declared
   * value, and the bucket enforced neither: a capability issued for 1 MB accepted a body of any
   * size R2 would take. A published quota that a one-line client change bypasses is not a quota.
   *
   * SigV4 verification recomputes the signature from the headers named here, so a body of a
   * different length arrives with a different `Content-Length` and does not verify. The browser
   * sets that header from the body and forbids scripts from overriding it, which is what makes
   * this binding rather than a request.
   *
   * `x-amz-checksum-sha256` is deliberately *not* signed alongside it. R2's S3 compatibility
   * matrix (developers.cloudflare.com/r2/api/s3/api/, "Checksum Types", read 2026-09-06) lists
   * SHA-256 as COMPOSITE only, with FULL_OBJECT unimplemented -- and a single PUT is a
   * full-object checksum. Signing it would put an integrity claim on the wire that nothing
   * verifies, which is worse than not making it. The digest is bound at confirm instead, where
   * this deployment checks it itself.
   */
  const signedHeaders = "content-length;content-type;host";
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": iso,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`)
    .join("&");
  const canonicalHeaders = `content-length:${contentLength}\ncontent-type:${contentType}\nhost:${host}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
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

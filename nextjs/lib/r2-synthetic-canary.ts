import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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

async function signedS3(
  env: R2SignerEnv,
  method: "PUT" | "HEAD" | "DELETE",
  key: string,
  body: Buffer | undefined,
  now = new Date(),
) {
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${env.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
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
    "",
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
  const response = await fetch(`https://${host}${canonicalUri}`, {
    method,
    headers,
    body,
  });
  return response.status;
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

/*
  Large-source bytes (docs/adr/0006-segmented-large-sources.md, "Large-source bytes").

  Above Cloud Run's 32 MiB HTTP/1 request the source cannot be posted to the CDR, and at 50 MiB the
  128 MB isolate cannot hold it next to its multipart copy and the sanitized answer. With
  FOUNDATION_SOURCE_TRANSPORT=presigned the worker never holds the source: it hashes it as a stream
  and hands the CDR a presigned GET for that one quarantine object, valid for SOURCE_URL_TTL_SECONDS.
  The CDR reads it, checks it against the signed digest, and holds no object-store credential.
*/
import { RetryableError } from "./errors";
import { textLayerShadowMode } from "./text-layer-shadow";

/** Long enough for a cold CDR instance to start reading; the CDR refuses anything above 900. */
export const SOURCE_URL_TTL_SECONDS = 300;

export type RemoteSource = { accountId: string; accessKeyId: string; secretAccessKey: string };

export type RemoteSourceEnv = {
  FOUNDATION_SOURCE_TRANSPORT?: string;
  /** The Cloudflare account that owns the bucket: the S3 endpoint is <id>.r2.cloudflarestorage.com. */
  FOUNDATION_R2_ACCOUNT_ID?: string;
  /** An R2 API token with Object Read only on the quarantine bucket. Dashboard secrets, never vars. */
  FOUNDATION_R2_READ_ACCESS_KEY_ID?: string;
  FOUNDATION_R2_READ_SECRET_ACCESS_KEY?: string;
  FOUNDATION_CDR_TEXT_LAYER_FIRST?: string;
};

/**
 * Unset is today's transport (the source in a multipart body). "presigned" needs its account and
 * read key, and cannot run beside the D2 shadow, which posts the source bytes. Every refusal is a
 * configuration error raised before the source is read or a CDR request is paid for.
 */
export function remoteSourceTransport(env: RemoteSourceEnv): RemoteSource | null {
  const raw = (env.FOUNDATION_SOURCE_TRANSPORT ?? "").trim();
  if (raw === "") return null;
  if (raw !== "presigned") throw new RetryableError("FOUNDATION_SOURCE_TRANSPORT must be presigned or unset");
  const accountId = (env.FOUNDATION_R2_ACCOUNT_ID ?? "").trim();
  const accessKeyId = (env.FOUNDATION_R2_READ_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (env.FOUNDATION_R2_READ_SECRET_ACCESS_KEY ?? "").trim();
  if (!/^[a-f0-9]{32}$/u.test(accountId)) throw new RetryableError("FOUNDATION_R2_ACCOUNT_ID must be the 32-hex Cloudflare account id");
  if (!accessKeyId || !secretAccessKey) {
    throw new RetryableError("FOUNDATION_SOURCE_TRANSPORT=presigned needs FOUNDATION_R2_READ_ACCESS_KEY_ID and FOUNDATION_R2_READ_SECRET_ACCESS_KEY");
  }
  if (textLayerShadowMode(env) !== "off") {
    throw new RetryableError("FOUNDATION_SOURCE_TRANSPORT=presigned cannot run with FOUNDATION_CDR_TEXT_LAYER_FIRST, which posts the source bytes");
  }
  return { accountId, accessKeyId, secretAccessKey };
}

/** /v1/disarm-remote beside the configured /v1/disarm, on the same origin and behind the same gate. */
export function remoteDisarmUrl(disarmUrl: string): string {
  if (!disarmUrl.endsWith("/v1/disarm")) throw new RetryableError("TAVONEL_CDR_URL must end in /v1/disarm");
  return `${disarmUrl}-remote`;
}

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(data));
}

/**
 * An AWS Signature V4 query-string presigned GET, host the only signed header: the Web Crypto
 * twin of `nextjs/lib/r2-presign.ts` presignWorkspaceGet. Checked against AWS's published example.
 */
export async function presignedGet(input: {
  host: string; path: string; region: string; accessKeyId: string; secretAccessKey: string; now: Date; expiresInSeconds: number;
}): Promise<string> {
  const iso = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/u, "Z");
  const dateStamp = iso.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": iso,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query).sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`).join("&");
  const canonicalRequest = ["GET", input.path, canonicalQuery, `host:${input.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", iso, scope, hex(await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest)))].join("\n");
  let key = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), dateStamp);
  for (const part of [input.region, "s3", "aws4_request"]) key = await hmac(key, part);
  return `https://${input.host}${input.path}?${canonicalQuery}&X-Amz-Signature=${hex(await hmac(key, stringToSign))}`;
}

/** The presigned GET of exactly one object of the bucket, for SOURCE_URL_TTL_SECONDS. */
export function presignedSourceUrl(remote: RemoteSource, bucket: string, key: string, now: Date): Promise<string> {
  return presignedGet({
    host: `${remote.accountId}.r2.cloudflarestorage.com`,
    path: `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`,
    region: "auto",
    accessKeyId: remote.accessKeyId,
    secretAccessKey: remote.secretAccessKey,
    now,
    expiresInSeconds: SOURCE_URL_TTL_SECONDS,
  });
}

type DigestStreamLike = WritableStream<Uint8Array> & { readonly digest: Promise<ArrayBuffer> };
type DigestStreamConstructor = new (algorithm: "SHA-256") => DigestStreamLike;

/**
 * `sha256:<hex>` of a stream of exactly `size` bytes, holding one chunk at a time.
 *
 * `crypto.DigestStream` is the Workers runtime's incremental hash. Without it the source cannot be
 * hashed without holding it whole, so its absence is a configuration error, never a fallback to
 * `arrayBuffer()`. A stream that is not exactly `size` bytes, or breaks, is a retry: R2 reported the
 * size, so a different length is the read failing, not the document.
 */
export async function streamedSha256(body: ReadableStream<Uint8Array>, size: number): Promise<string> {
  const DigestStream = (crypto as unknown as { DigestStream?: DigestStreamConstructor }).DigestStream;
  if (!DigestStream) throw new RetryableError("crypto.DigestStream is unavailable; the source cannot be hashed as a stream");
  const digest = new DigestStream("SHA-256");
  let seen = 0;
  const counted = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > size) controller.error(new RetryableError("quarantine source is longer than its reported size"));
      else controller.enqueue(chunk);
    },
  });
  try {
    await body.pipeThrough(counted).pipeTo(digest);
  } catch {
    throw new RetryableError("quarantine source could not be read as a stream");
  }
  if (seen !== size) throw new RetryableError("quarantine source length did not match its reported size");
  return `sha256:${hex(await digest.digest)}`;
}

import { createHash, createHmac } from "node:crypto";
import { DOCUMENT_ID_PATTERN, WORKSPACE_ID_PATTERN, immutableWorkspacePrefix } from "./immutable-keys";
import {
  FOUNDATION_R2_BUCKET,
  assertFoundationDeletionKey,
  type R2SignerEnv,
} from "./r2-synthetic-canary";

export type SourceInventoryObject = {
  key: string;
  sizeBytes: number;
};

export type SourceInventoryHashedObject = SourceInventoryObject & {
  sha256: string;
};

const MAX_DOCUMENTS = 128;
const MAX_OBJECTS = 512;
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

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

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

async function signedRequest(
  env: R2SignerEnv,
  method: "GET",
  canonicalUri: string,
  canonicalQuery: string,
  now: Date,
  timeoutMs: number,
  fetcher: typeof fetch,
) {
  const host = `${env.accountId}.r2.cloudflarestorage.com`;
  const payloadHash = sha256Hex(Buffer.alloc(0));
  const { amzDate: xAmzDate, dateStamp } = amzDate(now);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": xAmzDate,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    xAmzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${env.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${env.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    return await fetcher(
      `https://${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`,
      { method, headers, signal: AbortSignal.timeout(timeoutMs) },
    );
  } catch {
    return null;
  }
}

function documentPrefixes(workspaceKey: string, documentId: string) {
  return [
    `quarantine/${workspaceKey}/${documentId}/`,
    `${immutableWorkspacePrefix(workspaceKey)}${documentId}/`,
  ];
}

function validScope(workspaceKey: string, documentIds: readonly string[]) {
  return WORKSPACE_ID_PATTERN.test(workspaceKey)
    && documentIds.length <= MAX_DOCUMENTS
    && documentIds.every((id) => DOCUMENT_ID_PATTERN.test(id))
    && new Set(documentIds).size === documentIds.length;
}

export async function listFoundationSourceInventory(
  env: R2SignerEnv,
  workspaceKey: string,
  documentIds: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; objects: SourceInventoryObject[] } | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET) return { ok: false, code: "BUCKET_NOT_FOUNDATION" };
  if (!validScope(workspaceKey, documentIds)) return { ok: false, code: "SOURCE_INVENTORY_SCOPE_INVALID" };

  const byKey = new Map<string, number>();
  let totalBytes = 0;
  for (const documentId of [...documentIds].sort()) {
    for (const prefix of documentPrefixes(workspaceKey, documentId)) {
      let continuation: string | null = null;
      do {
        const query: Record<string, string> = { "list-type": "2", "max-keys": "1000", prefix };
        if (continuation) query["continuation-token"] = continuation;
        const canonicalQuery = Object.keys(query).sort()
          .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`).join("&");
        const response = await signedRequest(
          env, "GET", `/${env.bucket}`, canonicalQuery, new Date(), 15_000, fetcher,
        );
        if (!response?.ok) return { ok: false, code: "SOURCE_INVENTORY_LIST_FAILED" };
        const xml = await response.text();
        for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gi)) {
          const block = match[1] ?? "";
          const key = decodeXml(/<Key>([\s\S]*?)<\/Key>/i.exec(block)?.[1] ?? "");
          const rawSize = /<Size>(\d+)<\/Size>/i.exec(block)?.[1] ?? "";
          if (!key || !/^\d+$/.test(rawSize)) return { ok: false, code: "SOURCE_INVENTORY_LIST_INVALID" };
          const sizeBytes = Number(rawSize);
          if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_OBJECT_BYTES) {
            return { ok: false, code: "SOURCE_INVENTORY_OBJECT_TOO_LARGE" };
          }
          if (!key.startsWith(prefix) || assertFoundationDeletionKey(env.bucket, workspaceKey, key)) {
            return { ok: false, code: "SOURCE_INVENTORY_OBJECT_OUT_OF_SCOPE" };
          }
          const prior = byKey.get(key);
          if (prior !== undefined && prior !== sizeBytes) {
            return { ok: false, code: "SOURCE_INVENTORY_LIST_CHANGED" };
          }
          if (prior === undefined) {
            byKey.set(key, sizeBytes);
            totalBytes += sizeBytes;
            if (byKey.size > MAX_OBJECTS) return { ok: false, code: "SOURCE_INVENTORY_OBJECT_LIMIT" };
            if (totalBytes > MAX_TOTAL_BYTES) return { ok: false, code: "SOURCE_INVENTORY_TOTAL_TOO_LARGE" };
          }
        }
        const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
        continuation = truncated
          ? decodeXml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/i.exec(xml)?.[1] ?? "")
          : null;
        if (truncated && !continuation) return { ok: false, code: "SOURCE_INVENTORY_CURSOR_MISSING" };
      } while (continuation);
    }
  }
  return {
    ok: true,
    objects: [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([key, sizeBytes]) => ({ key, sizeBytes })),
  };
}

export async function hashFoundationSourceInventoryObject(
  env: R2SignerEnv,
  workspaceKey: string,
  object: SourceInventoryObject,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; object: SourceInventoryHashedObject } | { ok: false; code: string }> {
  if (env.bucket !== FOUNDATION_R2_BUCKET || assertFoundationDeletionKey(env.bucket, workspaceKey, object.key)) {
    return { ok: false, code: "SOURCE_INVENTORY_OBJECT_OUT_OF_SCOPE" };
  }
  if (!Number.isSafeInteger(object.sizeBytes) || object.sizeBytes < 0 || object.sizeBytes > MAX_OBJECT_BYTES) {
    return { ok: false, code: "SOURCE_INVENTORY_OBJECT_TOO_LARGE" };
  }
  const canonicalUri = `/${env.bucket}/${object.key.split("/").map(encodeURIComponent).join("/")}`;
  const response = await signedRequest(env, "GET", canonicalUri, "", new Date(), 30_000, fetcher);
  if (!response || response.status !== 200 || !response.body) {
    await response?.body?.cancel().catch(() => undefined);
    return { ok: false, code: "SOURCE_INVENTORY_READ_FAILED" };
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== object.sizeBytes)) {
    await response.body.cancel().catch(() => undefined);
    return { ok: false, code: "SOURCE_INVENTORY_LIST_CHANGED" };
  }

  const digest = createHash("sha256");
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_OBJECT_BYTES || bytes > object.sizeBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "SOURCE_INVENTORY_LIST_CHANGED" };
      }
      digest.update(next.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, code: "SOURCE_INVENTORY_READ_FAILED" };
  } finally {
    reader.releaseLock();
  }
  if (bytes !== object.sizeBytes) return { ok: false, code: "SOURCE_INVENTORY_LIST_CHANGED" };
  return {
    ok: true,
    object: { ...object, sha256: `sha256:${digest.digest("hex")}` },
  };
}

export function sourceInventoryListingsEqual(
  left: readonly SourceInventoryObject[],
  right: readonly SourceInventoryObject[],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

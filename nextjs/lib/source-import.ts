import { reserveFoundationCompute } from "./compute-reservation";
import { oauthSourceDownloadRequest, type OAuthSourceItem, type OAuthSourceTarget } from "./connector-oauth-adapters";
import { sha256Hex, type OAuthConnectorProvider } from "./connector-oauth";
import { confirmFoundationIntake, reserveFoundationIntake } from "./intake-admission";
import { validateQualifiedDocumentInput } from "./qualified-input";
import { FOUNDATION_INTAKE_MAX_BYTES, presignFoundationQuarantinePut } from "./r2-presign";
import { type R2SignerEnv } from "./r2-synthetic-canary";
import { deterministicSourceDocumentId } from "./source-intake";

// One source object, taken from a provider to quarantine.
//
// This is lifted verbatim in behaviour from the connector sync route, which did it inline
// inside a single HTTP request. The logic was correct and is unchanged: qualify the file,
// derive a deterministic document id from (connection, native id, revision), reserve intake
// admission and compute, presign, upload. What changes is only who calls it -- a job worker
// that can run it for the 4,000th file as easily as the 1st, instead of a request handler
// bounded to maxImports <= 3 by a 60-second function timeout.
//
// The determinism matters more here than it did before. A worker retries; a lease expires and
// another worker re-reads the same page. Because the document id is a pure function of
// (workspace, connection, native id, revision), re-importing an unchanged file resolves to
// the same id and the same quarantine key rather than a duplicate document. That is what
// makes the queue's at-least-once delivery safe.

const NATIVE_EXPORTS: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": { mimeType: "application/pdf", extension: ".pdf" },
  "application/vnd.google-apps.spreadsheet": { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: ".xlsx" },
  "application/vnd.google-apps.presentation": { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" },
  "application/vnd.google-apps.drawing": { mimeType: "image/png", extension: ".png" },
};

export function importDescriptor(item: OAuthSourceItem) {
  if (item.kind !== "file") return null;
  const native = item.mimeType ? NATIVE_EXPORTS[item.mimeType] : undefined;
  const mimeType = native?.mimeType ?? item.mimeType ?? "";
  const filename = native && !item.name.toLowerCase().endsWith(native.extension) ? `${item.name}${native.extension}` : item.name;
  const qualified = validateQualifiedDocumentInput({ originalFilename: filename, declaredMimeType: mimeType });
  return qualified.valid ? { filename: qualified.originalFilename, mimeType: qualified.normalizedMimeType } : null;
}

export type ImportOutcome =
  | { ok: true; nativeId: string; documentId: string; filename: string }
  | { ok: false; nativeId: string; code: string };

export type ImportContext = {
  workspaceKey: string;
  userId: string;
  connectionId: string;
  provider: OAuthConnectorProvider;
  accessToken: string;
  target: OAuthSourceTarget;
  signer: R2SignerEnv;
  fetcher?: typeof fetch;
};

// Imports one qualified source object. Never throws for an expected condition: an
// unqualified file, an oversized file or a provider hiccup is a skip with a stable code, so
// one bad object in a 10,000-file corpus does not fail the whole batch.
export async function importSourceObject(context: ImportContext, item: OAuthSourceItem): Promise<ImportOutcome> {
  const fetcher = context.fetcher ?? fetch;
  const descriptor = importDescriptor(item);
  if (!descriptor) return { ok: false, nativeId: item.nativeId, code: "SOURCE_NOT_QUALIFIED" };
  if (item.sizeBytes !== null && item.sizeBytes > FOUNDATION_INTAKE_MAX_BYTES) {
    return { ok: false, nativeId: item.nativeId, code: "SOURCE_TOO_LARGE" };
  }

  let download: ReturnType<typeof oauthSourceDownloadRequest>;
  try {
    download = oauthSourceDownloadRequest({
      provider: context.provider,
      nativeId: item.nativeId,
      mimeType: item.mimeType,
      target: context.target,
    });
  } catch {
    return { ok: false, nativeId: item.nativeId, code: "SOURCE_NATIVE_TYPE_UNSUPPORTED" };
  }

  const downloadHeaders = new Headers();
  for (const [name, value] of Object.entries(download.headers)) {
    if (typeof value === "string") downloadHeaders.set(name, value);
  }
  downloadHeaders.set("authorization", `Bearer ${context.accessToken}`);

  let source: Response;
  try {
    source = await fetcher(download.url, {
      method: download.method,
      headers: downloadHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return { ok: false, nativeId: item.nativeId, code: "SOURCE_DOWNLOAD_FAILED" };
  }
  if (!source.ok) return { ok: false, nativeId: item.nativeId, code: "SOURCE_DOWNLOAD_FAILED" };

  const bytes = new Uint8Array(await source.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > FOUNDATION_INTAKE_MAX_BYTES) {
    return { ok: false, nativeId: item.nativeId, code: "SOURCE_SIZE_UNQUALIFIED" };
  }

  // Deterministic identity. Same (connection, object, revision) -> same document, so an
  // at-least-once retry re-imports rather than duplicates.
  const sourceIdempotencyKey = await sha256Hex(`${context.connectionId}\u001f${item.nativeId}\u001f${item.revision}`);
  const documentId = await deterministicSourceDocumentId(context.workspaceKey, sourceIdempotencyKey);
  const objectKey = `quarantine/${context.workspaceKey}/${documentId}/source`;

  const admission = await reserveFoundationIntake({
    workspaceKey: context.workspaceKey,
    documentId,
    userId: context.userId,
    objectKey,
    requestedBytes: bytes.byteLength,
    declaredMimeType: descriptor.mimeType,
  });
  if (!admission.ok) return { ok: false, nativeId: item.nativeId, code: admission.code };
  // A deterministic source revision that already reached intake is complete for this sync
  // turn. Never reserve compute again or overwrite its create-once quarantine source.
  if (admission.result.idempotentReplay === true) {
    return { ok: true, nativeId: item.nativeId, documentId, filename: descriptor.filename };
  }

  const compute = await reserveFoundationCompute({
    workspaceKey: context.workspaceKey,
    documentId,
    userId: context.userId,
  });
  if (!compute.ok) return { ok: false, nativeId: item.nativeId, code: compute.code };

  const signed = presignFoundationQuarantinePut(context.signer, {
    key: objectKey,
    contentType: descriptor.mimeType,
    contentLength: bytes.byteLength,
    expiresInSeconds: 300,
  });
  if (!signed.ok) return { ok: false, nativeId: item.nativeId, code: signed.code };

  let uploaded: Response;
  try {
    uploaded = await fetcher(signed.uploadUrl, {
      method: "PUT",
      headers: { "content-type": descriptor.mimeType, "content-length": String(bytes.byteLength) },
      body: bytes,
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return { ok: false, nativeId: item.nativeId, code: "QUARANTINE_UPLOAD_FAILED" };
  }
  if (!uploaded.ok) return { ok: false, nativeId: item.nativeId, code: "QUARANTINE_UPLOAD_FAILED" };

  const confirmed = await confirmFoundationIntake({
    workspaceKey: context.workspaceKey,
    documentId,
    userId: context.userId,
  });
  if (!confirmed.ok) return { ok: false, nativeId: item.nativeId, code: confirmed.code };

  return { ok: true, nativeId: item.nativeId, documentId, filename: descriptor.filename };
}

import { reserveFoundationCompute } from "./compute-reservation";
import { estimateBillablePages } from "./usage-pricing";
import { oauthSourceDownloadRequest, type OAuthSourceItem, type OAuthSourceTarget } from "./connector-oauth-adapters";
import { type OAuthConnectorProvider } from "./connector-oauth";
import { confirmFoundationIntake, reserveFoundationIntake } from "./intake-admission";
import { validateQualifiedDocumentInput } from "./qualified-input";
import { FOUNDATION_INTAKE_MAX_BYTES, presignFoundationQuarantinePut } from "./r2-presign";
import { type R2SignerEnv } from "./r2-synthetic-canary";
import { connectorSourceIdentity, type ConnectorSourceIdentity } from "./connector-source-identity";
import { readBoundedSourceBody } from "./bounded-source-body";
import { recordConnectorDocumentBinding } from "./connector-binding-store";
import { createHash } from "node:crypto";
import { verifyDropboxSource } from "./dropbox-source-integrity";
import { observeSourceVersion, verifySourceVersion, type SourceVersionObservation } from "./source-version-guard";

// One source object, taken from a provider to quarantine.
//
// Qualify and bound the file, validate available provider version/content proof, persist
// the immutable source binding, then reserve intake/compute and upload to quarantine.
// A bounded job worker calls this path repeatedly. Provider version qualification remains
// separate from deterministic identity: a revision-derived ID alone does not prove bytes.
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
  | ({ ok: true; nativeId: string; filename: string } & ConnectorSourceIdentity)
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
  let identity: ConnectorSourceIdentity;
  try { identity = await connectorSourceIdentity({ ...context, nativeId: item.nativeId, revision: item.revision }); }
  catch { return { ok: false, nativeId: item.nativeId, code: "SOURCE_IDENTITY_INVALID" }; }

  let download: ReturnType<typeof oauthSourceDownloadRequest>;
  try {
    download = oauthSourceDownloadRequest({
      provider: context.provider,
      nativeId: item.nativeId,
      revision: item.revision,
      mimeType: item.mimeType,
      target: context.target,
    });
  } catch (error) {
    return { ok: false, nativeId: item.nativeId, code: error instanceof Error && error.message === "SOURCE_REVISION_UNQUALIFIED" ? error.message : "SOURCE_NATIVE_TYPE_UNSUPPORTED" };
  }

  const downloadHeaders = new Headers();
  for (const [name, value] of Object.entries(download.headers)) {
    if (typeof value === "string") downloadHeaders.set(name, value);
  }
  downloadHeaders.set("authorization", `Bearer ${context.accessToken}`);

  let observedVersion: SourceVersionObservation | null;
  try { observedVersion = await observeSourceVersion(context.provider, item, context.target, context.accessToken, fetcher); }
  catch (error) { return { ok: false, nativeId: item.nativeId, code: error instanceof Error ? error.message : "SOURCE_VERSION_READ_FAILED" }; }

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

  const body = await readBoundedSourceBody(source, FOUNDATION_INTAKE_MAX_BYTES);
  if (!body.ok) return { ok: false, nativeId: item.nativeId, code: body.code };
  const bytes = body.bytes;
  if (context.provider === "dropbox") {
    const rejected = verifyDropboxSource(source, bytes, item);
    if (rejected) return { ok: false, nativeId: item.nativeId, code: rejected };
  } else {
    try {
      const current = await observeSourceVersion(context.provider, item, context.target, context.accessToken, fetcher);
      const rejected = verifySourceVersion(observedVersion, current, bytes);
      if (rejected) return { ok: false, nativeId: item.nativeId, code: rejected };
    } catch (error) { return { ok: false, nativeId: item.nativeId, code: error instanceof Error ? error.message : "SOURCE_VERSION_READ_FAILED" }; }
  }

  // Deterministic identity. Same (connection, object, revision) -> same document, so an
  // at-least-once retry re-imports rather than duplicates.
  const { documentId } = identity;
  const objectKey = `quarantine/${context.workspaceKey}/${documentId}/source`;

  const binding = await recordConnectorDocumentBinding({
    workspaceKey: context.workspaceKey, connectionId: context.connectionId, provider: context.provider,
    nativeId: item.nativeId, revision: item.revision,
    contentSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    byteLength: bytes.byteLength, mimeType: descriptor.mimeType,
  });
  if (!binding.ok) return { ok: false, nativeId: item.nativeId, code: binding.code };

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
    return { ok: true, nativeId: item.nativeId, ...identity, filename: descriptor.filename };
  }

  const compute = await reserveFoundationCompute({
    workspaceKey: context.workspaceKey,
    documentId,
    userId: context.userId,
    estimatedPages: estimateBillablePages({ bytes: bytes.byteLength, mimeType: descriptor.mimeType })?.pages ?? 1,
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

  return { ok: true, nativeId: item.nativeId, ...identity, filename: descriptor.filename };
}

import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";
import { reserveFoundationCompute } from "@/lib/compute-reservation";
import { listOAuthSourcePage, oauthSourceDownloadRequest, type OAuthSourceItem, type OAuthSourceTarget } from "@/lib/connector-oauth-adapters";
import { readOAuthSecret, readOAuthSecretBrokerConfig } from "@/lib/connector-oauth-secrets";
import { getOAuthConnectionSecretReference, recordOAuthConnectionSync } from "@/lib/connector-oauth-store";
import { readOAuthProviderRuntime, refreshOAuthAccessToken, sha256Hex } from "@/lib/connector-oauth";
import { requireFoundationSession } from "@/lib/developer-auth";
import { reserveFoundationIntake } from "@/lib/intake-admission";
import { validateQualifiedDocumentInput } from "@/lib/qualified-input";
import { FOUNDATION_INTAKE_MAX_BYTES, presignFoundationQuarantinePut } from "@/lib/r2-presign";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { deterministicSourceDocumentId } from "@/lib/source-intake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { "Cache-Control": "no-store", "X-TAVONEL-API-Version": "1" };

const NATIVE_EXPORTS: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": { mimeType: "application/pdf", extension: ".pdf" },
  "application/vnd.google-apps.spreadsheet": { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: ".xlsx" },
  "application/vnd.google-apps.presentation": { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" },
  "application/vnd.google-apps.drawing": { mimeType: "image/png", extension: ".png" },
};

function importDescriptor(item: OAuthSourceItem) {
  if (item.kind !== "file") return null;
  const native = item.mimeType ? NATIVE_EXPORTS[item.mimeType] : undefined;
  const mimeType = native?.mimeType ?? item.mimeType ?? "";
  const filename = native && !item.name.toLowerCase().endsWith(native.extension) ? `${item.name}${native.extension}` : item.name;
  const qualified = validateQualifiedDocumentInput({ originalFilename: filename, declaredMimeType: mimeType });
  return qualified.valid ? { filename: qualified.originalFilename, mimeType: qualified.normalizedMimeType } : null;
}

function parseBody(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const maxImports = Number(body.maxImports ?? 0);
  if (!Number.isSafeInteger(maxImports) || maxImports < 0 || maxImports > 3) return null;
  const targetValue = body.target;
  if (targetValue !== undefined && (!targetValue || typeof targetValue !== "object" || Array.isArray(targetValue))) return null;
  const rawTarget = (targetValue ?? {}) as Record<string, unknown>;
  const target: OAuthSourceTarget = {};
  for (const key of ["rootPath", "driveId", "siteId"] as const) {
    if (rawTarget[key] !== undefined) {
      if (typeof rawTarget[key] !== "string") return null;
      target[key] = rawTarget[key];
    }
  }
  return { maxImports, target };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!activationPolicy.customerIntake.enabled) return NextResponse.json({ code: "INTAKE_DISABLED" }, { status: 503, headers: HEADERS });
  const auth = await requireFoundationSession(request, "studio");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ code: "OAUTH_CONNECTION_ID_INVALID" }, { status: 400, headers: HEADERS });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 4_096) return NextResponse.json({ code: "REQUEST_TOO_LARGE" }, { status: 413, headers: HEADERS });
  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) return NextResponse.json({ code: "OAUTH_SYNC_INPUT_INVALID" }, { status: 400, headers: HEADERS });

  const binding = await getOAuthConnectionSecretReference(auth.principal.workspaceKey, id);
  const broker = readOAuthSecretBrokerConfig();
  if (!binding.ok) return NextResponse.json({ code: binding.code }, { status: binding.code === "OAUTH_CONNECTION_NOT_FOUND" ? 404 : 503, headers: HEADERS });
  const runtime = readOAuthProviderRuntime(binding.provider);
  const signer = readR2SignerEnv();
  if (!runtime || !broker || !signer) return NextResponse.json({ code: "OAUTH_SYNC_NOT_CONFIGURED" }, { status: 503, headers: HEADERS });

  try {
    const [refreshToken, clientSecret] = await Promise.all([
      readOAuthSecret(broker, binding.refreshTokenReference),
      readOAuthSecret(broker, runtime.clientSecretReference),
    ]);
    const tokenSet = await refreshOAuthAccessToken({ runtime, refreshToken, clientSecret });
    const items: OAuthSourceItem[] = [];
    let cursor: string | null = null;
    let complete = false;
    for (let page = 0; page < 5 && !complete; page += 1) {
      const listed = await listOAuthSourcePage({ provider: binding.provider, accessToken: tokenSet.accessToken, cursor, target: parsed.target });
      items.push(...listed.items.slice(0, 1_000 - items.length));
      cursor = listed.cursor;
      complete = listed.complete || items.length >= 1_000;
    }

    const imported: Array<{ nativeId: string; documentId: string; filename: string }> = [];
    const skipped: Array<{ nativeId: string; code: string }> = [];
    for (const item of items) {
      if (imported.length >= parsed.maxImports) break;
      const descriptor = importDescriptor(item);
      if (!descriptor) continue;
      if (item.sizeBytes !== null && item.sizeBytes > FOUNDATION_INTAKE_MAX_BYTES) {
        skipped.push({ nativeId: item.nativeId, code: "SOURCE_TOO_LARGE" });
        continue;
      }
      const download = oauthSourceDownloadRequest({ provider: binding.provider, nativeId: item.nativeId, mimeType: item.mimeType, target: parsed.target });
      const downloadHeaders = new Headers();
      for (const [name, value] of Object.entries(download.headers)) {
        if (typeof value === "string") downloadHeaders.set(name, value);
      }
      downloadHeaders.set("authorization", `Bearer ${tokenSet.accessToken}`);
      const source = await fetch(download.url, {
        method: download.method,
        headers: downloadHeaders,
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      if (!source.ok) {
        skipped.push({ nativeId: item.nativeId, code: "SOURCE_DOWNLOAD_FAILED" });
        continue;
      }
      const bytes = new Uint8Array(await source.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > FOUNDATION_INTAKE_MAX_BYTES) {
        skipped.push({ nativeId: item.nativeId, code: "SOURCE_SIZE_UNQUALIFIED" });
        continue;
      }
      const sourceIdempotencyKey = await sha256Hex(`${id}\u001f${item.nativeId}\u001f${item.revision}`);
      const documentId = await deterministicSourceDocumentId(auth.principal.workspaceKey, sourceIdempotencyKey);
      const objectKey = `quarantine/${auth.principal.workspaceKey}/${documentId}/source`;
      const admission = await reserveFoundationIntake({
        workspaceKey: auth.principal.workspaceKey,
        documentId,
        userId: auth.principal.userId,
        objectKey,
        requestedBytes: bytes.byteLength,
        declaredMimeType: descriptor.mimeType,
      });
      if (!admission.ok) {
        skipped.push({ nativeId: item.nativeId, code: admission.code });
        continue;
      }
      const compute = await reserveFoundationCompute({ workspaceKey: auth.principal.workspaceKey, documentId, userId: auth.principal.userId });
      if (!compute.ok) {
        skipped.push({ nativeId: item.nativeId, code: compute.code });
        continue;
      }
      const signed = presignFoundationQuarantinePut(signer, { key: objectKey, contentType: descriptor.mimeType, contentLength: bytes.byteLength, expiresInSeconds: 300 });
      if (!signed.ok) {
        skipped.push({ nativeId: item.nativeId, code: signed.code });
        continue;
      }
      const uploaded = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "content-type": descriptor.mimeType, "content-length": String(bytes.byteLength) },
        body: bytes,
        signal: AbortSignal.timeout(25_000),
      });
      if (!uploaded.ok) {
        skipped.push({ nativeId: item.nativeId, code: "QUARANTINE_UPLOAD_FAILED" });
        continue;
      }
      imported.push({ nativeId: item.nativeId, documentId, filename: descriptor.filename });
    }

    const cursorSha256 = `sha256:${await sha256Hex(JSON.stringify(items.map((item) => [item.nativeId, item.revision, item.kind])))}`;
    const recorded = await recordOAuthConnectionSync({
      workspaceKey: auth.principal.workspaceKey,
      userId: auth.principal.userId,
      oauthConnectionId: id,
      cursorSha256,
      scanned: items.length,
      imported: imported.length,
    });
    if (!recorded.ok) return NextResponse.json({ code: recorded.code }, { status: 503, headers: HEADERS });
    return NextResponse.json({
      code: "OK",
      provider: binding.provider,
      scanned: items.length,
      complete,
      imported,
      skipped: skipped.slice(0, 20),
      cursorSha256,
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ code: "OAUTH_SYNC_FAILED" }, { status: 503, headers: HEADERS });
  }
}

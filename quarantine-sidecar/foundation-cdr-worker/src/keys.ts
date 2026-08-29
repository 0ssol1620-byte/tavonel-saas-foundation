import { PermanentReject } from "./errors";

export const SOURCE_KEY_PATTERN = /^quarantine\/([^/]+)\/([^/]+)\/source$/;
export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export type SourceKeyParts = {
  workspaceId: string;
  documentId: string;
};

export function parseQuarantineSourceKey(objectKey: string): SourceKeyParts | null {
  const match = SOURCE_KEY_PATTERN.exec(objectKey);
  if (!match) {
    return null;
  }
  return { workspaceId: match[1], documentId: match[2] };
}

export function isQuarantineSourceKey(objectKey: string): boolean {
  return parseQuarantineSourceKey(objectKey) !== null;
}

export function hasForbiddenPath(objectKey: string): boolean {
  return objectKey.split("/").some((part) => part === "synthetic" || part.includes("tavonel-prod"));
}

export function assertProcessableSourceKey(objectKey: string): SourceKeyParts {
  const parts = parseQuarantineSourceKey(objectKey);
  if (!parts) {
    throw new PermanentReject("object key is not a Foundation quarantine source object");
  }
  if (hasForbiddenPath(objectKey)) {
    throw new PermanentReject("object key is not allowed on the Foundation CDR worker");
  }
  return parts;
}

export function versionKeyFromOutputSha256(outputSha256: string): string {
  const hex = outputSha256.trim().toLowerCase().replace(/^sha256:/u, "");
  if (!/^[a-f0-9]+$/u.test(hex) || hex.length < 32) {
    throw new PermanentReject("CDR output digest is invalid");
  }
  return hex.length > 64 ? hex.slice(0, 32) : hex;
}

export function immutableObjectKey(workspaceId: string, documentId: string, outputSha256: string): string {
  const versionKey = versionKeyFromOutputSha256(outputSha256);
  return `immutable/${workspaceId}/${workspaceId}/${documentId}/${versionKey}/sanitized.pdf`;
}

export function ocrSiblingKey(immutablePdfKey: string): string {
  if (!immutablePdfKey.endsWith("/sanitized.pdf")) {
    throw new PermanentReject("immutable PDF key is not a sanitized.pdf object");
  }
  return `${immutablePdfKey.slice(0, -"/sanitized.pdf".length)}/ocr.json`;
}

/**
 * Where the live reading is reported.
 *
 * This object is deliberately *not* a sibling receipt in the sense the others are. It is mutable,
 * it is overwritten as the read progresses, and it is not evidence of anything: `ocr.json` is the
 * record, and it is still written create-once. The name says so, so that nobody later mistakes it
 * for part of the immutable set.
 */
export function ocrProgressSiblingKey(immutablePdfKey: string): string {
  if (!immutablePdfKey.endsWith("/sanitized.pdf")) {
    throw new PermanentReject("immutable PDF key is not a sanitized.pdf object");
  }
  return `${immutablePdfKey.slice(0, -"/sanitized.pdf".length)}/ocr-progress.json`;
}

export function cdrReceiptSiblingKey(immutablePdfKey: string): string {
  if (!immutablePdfKey.endsWith("/sanitized.pdf")) {
    throw new PermanentReject("immutable PDF key is not a sanitized.pdf object");
  }
  return `${immutablePdfKey.slice(0, -"/sanitized.pdf".length)}/cdr-receipt.json`;
}

export function ocrReviewSiblingKey(immutablePdfKey: string): string {
  if (!immutablePdfKey.endsWith("/sanitized.pdf")) {
    throw new PermanentReject("immutable PDF key is not a sanitized.pdf object");
  }
  return `${immutablePdfKey.slice(0, -"/sanitized.pdf".length)}/ocr-review.json`;
}

export function extractObjectKey(body: unknown): string | null {
  let value: unknown = body;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed.includes("/") ? trimmed : null;
    }
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.key === "string" && record.key.length > 0) {
    return record.key;
  }
  const object = record.object;
  if (object && typeof object === "object") {
    const inner = object as Record<string, unknown>;
    if (typeof inner.key === "string" && inner.key.length > 0) {
      return inner.key;
    }
    const nested = inner.object;
    if (nested && typeof nested === "object") {
      const nestedKey = (nested as Record<string, unknown>).key;
      if (typeof nestedKey === "string" && nestedKey.length > 0) {
        return nestedKey;
      }
    }
  }
  return null;
}

export function sourcePartFromR2Object(object: {
  httpMetadata?: { contentType?: string; contentDisposition?: string };
  customMetadata?: Record<string, string>;
}): { filename: string; contentType: string } {
  const contentType = object.httpMetadata?.contentType?.split(";")[0]?.trim() || "application/pdf";
  const disposition = object.httpMetadata?.contentDisposition || "";
  const filenameStar = /filename\*=UTF-8''([^;]+)/iu.exec(disposition);
  const filenameQuoted = /filename="([^"]+)"/iu.exec(disposition);
  const filenameBare = /filename=([^;]+)/iu.exec(disposition);
  const fromDisposition = filenameStar?.[1]
    ? decodeURIComponent(filenameStar[1])
    : filenameQuoted?.[1] || filenameBare?.[1]?.trim();
  const fromCustom = object.customMetadata?.filename || object.customMetadata?.originalFilename;
  const rawName = fromDisposition || fromCustom || "source.pdf";
  const filename = rawName.replaceAll("\\", "/").split("/").pop() || "source.pdf";
  return { filename, contentType };
}

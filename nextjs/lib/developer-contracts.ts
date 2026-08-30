import { deterministicSourceDocumentId } from "./source-intake";

export const DEVELOPER_SCOPES = [
  "documents:read",
  "documents:intake",
  "collections:read",
  "collections:compile",
  "collections:download",
  "worlds:read",
  "ask:read",
  "connections:read",
  "connections:write",
  "connections:sync",
] as const;

export type DeveloperScope = (typeof DEVELOPER_SCOPES)[number];
export type ConnectionProvider = "file_server" | "s3" | "r2" | "minio";
export type ConnectionMode = "local_agent" | "cloud_pull";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_CONFIG_KEY = /(secret|password|token|credential|access[_-]?key|private[_-]?key)/i;
const CONFIG_KEYS = new Set([
  "bucket",
  "prefix",
  "region",
  "endpointHost",
  "rootLabel",
  "includeGlobs",
  "excludeGlobs",
  "maxFileBytes",
]);

export type ConnectionInput = {
  provider: ConnectionProvider;
  mode: ConnectionMode;
  displayName: string;
  configuration: Record<string, unknown>;
  secretReference: string | null;
};

export type ConnectionEvent = {
  kind: "added" | "changed" | "deleted";
  nativeId: string;
  revision: string;
  contentSha256: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  documentId: string | null;
  sourceIdempotencyKey: string | null;
};

export type ConnectionBatchInput = {
  batchId: string;
  previousCursorSha256: string | null;
  nextCursorSha256: string;
  manifestSha256: string;
  events: ConnectionEvent[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_CONFIG_KEY.test(key) || hasForbiddenKey(child));
}

function validConfiguration(value: unknown) {
  if (!isPlainObject(value) || hasForbiddenKey(value)) return false;
  if (Object.keys(value).some((key) => !CONFIG_KEYS.has(key))) return false;
  if (JSON.stringify(value).length > 8_192) return false;
  const stringKeys = ["bucket", "prefix", "region", "endpointHost", "rootLabel"] as const;
  if (stringKeys.some((key) => key in value && (typeof value[key] !== "string" || value[key].length > 512))) return false;
  if (typeof value.endpointHost === "string" && !/^[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?$/.test(value.endpointHost)) return false;
  for (const key of ["includeGlobs", "excludeGlobs"] as const) {
    const globs = value[key];
    if (globs !== undefined && (!Array.isArray(globs) || globs.length > 50 || globs.some((glob) => typeof glob !== "string" || glob.length > 256))) return false;
  }
  if (value.maxFileBytes !== undefined && (!Number.isSafeInteger(value.maxFileBytes) || Number(value.maxFileBytes) < 1 || Number(value.maxFileBytes) > 524_288_000)) return false;
  return true;
}

export function parseConnectionInput(value: unknown): ConnectionInput | null {
  if (!isPlainObject(value)) return null;
  const provider = value.provider;
  const mode = value.mode;
  const displayName = typeof value.displayName === "string" ? value.displayName.trim() : "";
  const configuration = value.configuration ?? {};
  const secretReference = value.secretReference === null || value.secretReference === undefined
    ? null
    : typeof value.secretReference === "string" ? value.secretReference.trim() : "";
  if (!(["file_server", "s3", "r2", "minio"] as unknown[]).includes(provider)) return null;
  if (mode !== "local_agent") return null;
  if (!displayName || displayName.length > 100 || !validConfiguration(configuration)) return null;
  if (provider === "file_server" && (mode !== "local_agent" || secretReference !== null)) return null;
  if (mode === "local_agent" && secretReference !== null) return null;
  return { provider, mode, displayName, configuration, secretReference } as ConnectionInput;
}

export function parseDeveloperScopes(value: unknown): DeveloperScope[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > DEVELOPER_SCOPES.length) return null;
  if (value.some((scope) => typeof scope !== "string" || !(DEVELOPER_SCOPES as readonly string[]).includes(scope))) return null;
  return [...new Set(value)] as DeveloperScope[];
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export async function sha256Prefixed(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function parseConnectionBatchInput(value: unknown, workspaceKey?: string): Promise<ConnectionBatchInput | null> {
  if (!isPlainObject(value) || !UUID.test(String(value.batchId ?? ""))) return null;
  if (value.previousCursorSha256 !== null && !SHA256.test(String(value.previousCursorSha256 ?? ""))) return null;
  if (!SHA256.test(String(value.nextCursorSha256 ?? "")) || !SHA256.test(String(value.manifestSha256 ?? ""))) return null;
  if (!Array.isArray(value.events) || value.events.length > 5_000 || JSON.stringify(value.events).length > 1_048_576) return null;
  const events: ConnectionEvent[] = [];
  for (const raw of value.events) {
    if (!isPlainObject(raw) || !(["added", "changed", "deleted"] as unknown[]).includes(raw.kind)) return null;
    const nativeId = typeof raw.nativeId === "string" ? raw.nativeId : "";
    const revision = typeof raw.revision === "string" ? raw.revision : "";
    const contentSha256 = raw.contentSha256 === null ? null : typeof raw.contentSha256 === "string" ? raw.contentSha256 : "";
    const sizeBytes = raw.sizeBytes === null ? null : Number(raw.sizeBytes);
    const mimeType = raw.mimeType === null ? null : typeof raw.mimeType === "string" ? raw.mimeType : "";
    const documentId = raw.documentId === null ? null : typeof raw.documentId === "string" ? raw.documentId : "";
    const sourceIdempotencyKey = raw.sourceIdempotencyKey === null ? null : typeof raw.sourceIdempotencyKey === "string" ? raw.sourceIdempotencyKey : "";
    if (!nativeId || nativeId.length > 1024 || !revision || revision.length > 512) return null;
    if (contentSha256 !== null && !/^[a-f0-9]{64}$/.test(contentSha256)) return null;
    if (sizeBytes !== null && (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || sizeBytes > 524_288_000)) return null;
    if (mimeType !== null && (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType) || mimeType.length > 127)) return null;
    if (documentId !== null && !UUID.test(documentId)) return null;
    if (sourceIdempotencyKey !== null && !/^[a-f0-9]{64}$/.test(sourceIdempotencyKey)) return null;
    if ((documentId === null) !== (sourceIdempotencyKey === null)) return null;
    if (documentId !== null && workspaceKey) {
      if (await deterministicSourceDocumentId(workspaceKey, sourceIdempotencyKey!) !== documentId) return null;
    }
    if (raw.kind === "deleted" && (contentSha256 !== null || sizeBytes !== null || mimeType !== null || documentId !== null || sourceIdempotencyKey !== null)) return null;
    events.push({ kind: raw.kind, nativeId, revision, contentSha256, sizeBytes, mimeType, documentId, sourceIdempotencyKey } as ConnectionEvent);
  }
  const manifestSha256 = String(value.manifestSha256);
  if (await sha256Prefixed(canonicalJson(events)) !== manifestSha256) return null;
  return {
    batchId: String(value.batchId),
    previousCursorSha256: value.previousCursorSha256 === null ? null : String(value.previousCursorSha256),
    nextCursorSha256: String(value.nextCursorSha256),
    manifestSha256,
    events,
  };
}

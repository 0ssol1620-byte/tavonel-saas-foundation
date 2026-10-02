import { Buffer } from "node:buffer";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

// Mirrors the bounds in supabase/migrations/20261002100000_connection_source_inventory_reconcile.sql.
// The database re-checks everything; the copies here only keep a malformed request from becoming
// an opaque 503.
export const INVENTORY_LIMITS = Object.freeze({
  maxItems: 100_000,
  maxPages: 400,
  maxItemsPerPage: 500,
  maxNativeIdBytes: 1024,
  maxRevisionBytes: 512,
  maxSizeBytes: 1_099_511_627_776,
  maxMimeTypeLength: 127,
});

// The single MIME rule, byte-identical to connection_inventory_mime_valid in the migration (the
// unit test reads the migration and checks). Case-sensitive ASCII ranges on both sides, so neither
// engine's case folding can widen it.
export const MIME_TYPE_PATTERN = "^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$";
const MIME_TYPE = new RegExp(MIME_TYPE_PATTERN);

export type InventoryItem = {
  nativeId: string;
  revision: string;
  contentSha256: string | null;
  sizeBytes: number;
  mimeType: string | null;
  /** An opaque digest of the permissions the agent observed. Recorded, never enforced. */
  aclObservationSha256: string | null;
};
export type InventoryRequest =
  | { operation: "inventory.begin"; scanId: string; scanEpoch: number; expectedHeadEpoch: number; itemCount: number; pageCount: number }
  | { operation: "inventory.page"; scanId: string; pageIndex: number; items: InventoryItem[] }
  | { operation: "inventory.finalize"; scanId: string; complete: true; itemCount: number; pageCount: number };
export type InventoryPrincipal = { userId?: string | null; keyId?: string | null };
export type InventoryRpcName = "begin_connection_inventory_scan" | "stage_connection_inventory_page" | "finalize_connection_inventory_scan";
export type InventoryRpc = (fn: InventoryRpcName, args: Record<string, unknown>) => Promise<{ status: number; payload: unknown } | null>;
export type InventoryOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; code: string; status: 400 | 403 | 409 | 423 | 503; headEpoch?: number };

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ITEM_KEYS = ["aclObservationSha256", "contentSha256", "mimeType", "nativeId", "revision", "sizeBytes"];
const REQUEST_KEYS: Record<InventoryRequest["operation"], string[]> = {
  "inventory.begin": ["expectedHeadEpoch", "itemCount", "operation", "pageCount", "scanEpoch", "scanId"],
  "inventory.page": ["items", "operation", "pageIndex", "scanId"],
  "inventory.finalize": ["complete", "itemCount", "operation", "pageCount", "scanId"],
};
const ERROR_STATUS: Record<string, 400 | 403 | 409 | 423> = {
  INVENTORY_CONTRACT_INVALID: 400,
  INVENTORY_ITEM_INVALID: 400,
  INVENTORY_PAGE_INDEX_INVALID: 400,
  INVENTORY_NOT_ATTESTED_COMPLETE: 400,
  INVENTORY_ACTOR_INVALID: 403,
  INVENTORY_HEAD_STALE: 409,
  INVENTORY_EPOCH_STALE: 409,
  INVENTORY_SCAN_CONFLICT: 409,
  INVENTORY_SCAN_NOT_FOUND: 409,
  INVENTORY_SCAN_NOT_OPEN: 409,
  INVENTORY_PAGE_CONFLICT: 409,
  INVENTORY_COUNT_MISMATCH: 409,
  INVENTORY_PAGES_INCOMPLETE: 409,
  INVENTORY_DUPLICATE_ITEM: 409,
  INVENTORY_FINALIZE_CONFLICT: 409,
  CONNECTION_NOT_SYNCABLE: 423,
};
const UNAVAILABLE = { ok: false, code: "INVENTORY_UNAVAILABLE", status: 503 } as const;

/** The legacy cursor batch never carries `operation`; anything that does is an inventory request. */
export function isInventoryRequest(body: unknown): boolean {
  return isPlainObject(body) && Object.prototype.hasOwnProperty.call(body, "operation");
}

export function isInventoryMimeType(value: unknown): value is string {
  return typeof value === "string" && value.length <= INVENTORY_LIMITS.maxMimeTypeLength && MIME_TYPE.test(value);
}

export function parseInventoryRequest(body: unknown): { ok: true; request: InventoryRequest } | { ok: false; code: string } {
  const invalid = { ok: false as const, code: "INVENTORY_CONTRACT_INVALID" };
  if (!isPlainObject(body)) return invalid;
  const operation = body.operation;
  if (operation !== "inventory.begin" && operation !== "inventory.page" && operation !== "inventory.finalize") return invalid;
  if (!hasExactKeys(body, REQUEST_KEYS[operation]) || !isUuid(body.scanId)) return invalid;
  const scanId = body.scanId.toLowerCase();

  if (operation === "inventory.page") {
    const { pageIndex, items } = body;
    if (!isInt(pageIndex) || pageIndex < 0 || pageIndex >= INVENTORY_LIMITS.maxPages) return invalid;
    if (!Array.isArray(items) || items.length > INVENTORY_LIMITS.maxItemsPerPage) return invalid;
    const parsed: InventoryItem[] = [];
    for (const value of items as unknown[]) {
      const item = parseInventoryItem(value);
      if (!item) return { ok: false, code: "INVENTORY_ITEM_INVALID" };
      parsed.push(item);
    }
    return { ok: true, request: { operation, scanId, pageIndex, items: parsed } };
  }

  const counts = readCounts(body.itemCount, body.pageCount);
  if (!counts) return invalid;
  if (operation === "inventory.finalize") {
    if (body.complete === false) return { ok: false, code: "INVENTORY_NOT_ATTESTED_COMPLETE" };
    if (body.complete !== true) return invalid;
    return { ok: true, request: { operation, scanId, complete: true, ...counts } };
  }
  const { scanEpoch, expectedHeadEpoch } = body;
  if (!isInt(scanEpoch) || scanEpoch < 1 || !isInt(expectedHeadEpoch) || expectedHeadEpoch < 0 || expectedHeadEpoch >= scanEpoch) return invalid;
  return { ok: true, request: { operation, scanId, scanEpoch, expectedHeadEpoch, ...counts } };
}

export function parseInventoryItem(value: unknown): InventoryItem | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ITEM_KEYS)) return null;
  const { nativeId, revision, contentSha256, sizeBytes, mimeType, aclObservationSha256 } = value;
  if (!isBoundedText(nativeId, INVENTORY_LIMITS.maxNativeIdBytes) || !isBoundedText(revision, INVENTORY_LIMITS.maxRevisionBytes)) return null;
  if (contentSha256 !== null && !(typeof contentSha256 === "string" && SHA256_HEX.test(contentSha256))) return null;
  if (aclObservationSha256 !== null && !(typeof aclObservationSha256 === "string" && SHA256_HEX.test(aclObservationSha256))) return null;
  if (!isInt(sizeBytes) || sizeBytes < 0 || sizeBytes > INVENTORY_LIMITS.maxSizeBytes) return null;
  if (mimeType !== null && !isInventoryMimeType(mimeType)) return null;
  return { nativeId, revision, contentSha256, sizeBytes, mimeType, aclObservationSha256 };
}

/**
 * The workspace always comes from the authenticated principal, never from the body; the RPC then
 * re-checks that the actor holds that workspace and that the connection belongs to it.
 */
export async function applyConnectionInventoryRequest(
  workspaceKey: string,
  connectionId: string,
  principal: InventoryPrincipal,
  request: InventoryRequest,
  rpc: InventoryRpc = supabaseInventoryRpc,
): Promise<InventoryOutcome> {
  // Same precedence as applyFoundationConnectionBatch: an API key acts as the key, not the user.
  const actor = isUuid(principal.keyId)
    ? { p_actor_user_id: null, p_actor_key_id: principal.keyId.toLowerCase() }
    : isUuid(principal.userId)
      ? { p_actor_user_id: principal.userId.toLowerCase(), p_actor_key_id: null }
      : null;
  if (!actor) return { ok: false, code: "INVENTORY_ACTOR_INVALID", status: 403 };
  const scope = { p_scan_id: request.scanId, p_workspace_key: workspaceKey, p_connection_id: connectionId.toLowerCase(), ...actor };
  const call = request.operation === "inventory.begin"
    ? { fn: "begin_connection_inventory_scan" as const, args: { ...scope, p_scan_epoch: request.scanEpoch, p_expected_head_epoch: request.expectedHeadEpoch, p_item_count: request.itemCount, p_page_count: request.pageCount } }
    : request.operation === "inventory.page"
      ? { fn: "stage_connection_inventory_page" as const, args: { ...scope, p_page_index: request.pageIndex, p_items: request.items } }
      : { fn: "finalize_connection_inventory_scan" as const, args: { ...scope, p_complete: request.complete, p_item_count: request.itemCount, p_page_count: request.pageCount } };

  const response = await rpc(call.fn, call.args);
  if (!response) return UNAVAILABLE;
  if (response.status >= 200 && response.status < 300) {
    return isPlainObject(response.payload) ? { ok: true, result: response.payload } : UNAVAILABLE;
  }
  const payload = isPlainObject(response.payload) ? response.payload : {};
  const code = typeof payload.message === "string" ? payload.message : "";
  const status = Object.prototype.hasOwnProperty.call(ERROR_STATUS, code) ? ERROR_STATUS[code] : undefined;
  if (status === undefined) return UNAVAILABLE;
  if (code === "INVENTORY_HEAD_STALE" && typeof payload.details === "string" && /^\d{1,15}$/.test(payload.details)) {
    return { ok: false, code, status, headEpoch: Number(payload.details) };
  }
  return { ok: false, code, status };
}

async function supabaseInventoryRpc(fn: InventoryRpcName, args: Record<string, unknown>) {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
    return { status: response.status, payload: await response.json().catch(() => null) as unknown };
  } catch {
    return null;
  }
}

function readCounts(itemCount: unknown, pageCount: unknown): { itemCount: number; pageCount: number } | null {
  if (!isInt(itemCount) || !isInt(pageCount)) return null;
  if (itemCount < 0 || itemCount > INVENTORY_LIMITS.maxItems || pageCount < 1 || pageCount > INVENTORY_LIMITS.maxPages) return null;
  const shaped = itemCount === 0
    ? pageCount === 1
    : pageCount <= itemCount && itemCount <= pageCount * INVENTORY_LIMITS.maxItemsPerPage;
  return shaped ? { itemCount, pageCount } : null;
}

// Matches the SQL item check: 1..max UTF-8 bytes, no C0 control or DEL. NUL and lone surrogates
// cannot reach Postgres text at all, so they are refused here rather than turning into a 503.
function isBoundedText(value: unknown, maxBytes: number): value is string {
  if (typeof value !== "string" || value === "" || /[\x00-\x1f\x7f]/.test(value)) return false;
  const bytes = Buffer.from(value, "utf8");
  return bytes.length <= maxBytes && bytes.toString("utf8") === value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isPlainObject(value: unknown): value is Json {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Json, sortedKeys: readonly string[]): boolean {
  const own = Object.keys(value).sort();
  return own.length === sortedKeys.length && own.every((key, index) => key === sortedKeys[index]);
}

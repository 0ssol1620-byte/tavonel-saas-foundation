import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { IDEMPOTENCY_KEY_PATTERN, WORKSPACE_ASK_CONCURRENCY, WORKSPACE_EXPORT_CONCURRENCY } from "./workspace-cost-guard";

export type GuardScope = "ask" | "export";
export type GuardAnswer = { status: number; body: Record<string, unknown> };
export type GuardRequest = { key: string | null; identity: string; body: string };
export type OperationLease = {
  ok: true; replay: false;
  complete: (value: GuardAnswer) => Promise<boolean>;
  release: () => Promise<void>;
};
export type OperationVerdict = OperationLease
  | { ok: true; replay: true; value: GuardAnswer }
  | { ok: false; code: string; status: number };

const MAX_RESPONSE_BYTES = 1_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CACHE_MS = 600_000;
const LEASE_MS = 75_000; // Longer than the routes' 60s platform execution bound.
export const WORKSPACE_CACHE_MAX_KEYS = 300;
export const WORKSPACE_CACHE_MAX_BYTES = 16_777_216;
const RESERVED_CIPHERTEXT_BYTES = 1_400_000;
const localKey = randomBytes(32);
type LocalEntry = { owner: string; digest: string | null; expiresAt: number; cacheBytes?: number; value?: GuardAnswer };
const localEntries = new Map<string, LocalEntry>();

const unavailable = (): OperationVerdict => ({ ok: false, code: "WORKSPACE_GUARD_UNAVAILABLE", status: 503 });
function opaque(secret: string | Buffer, purpose: string, value: string) {
  return createHmac("sha256", secret).update(`tavonel-operation-v1:${purpose}\n${value}`).digest("hex");
}
function validAnswer(value: unknown): value is GuardAnswer {
  if (!value || typeof value !== "object") return false;
  const item = value as GuardAnswer;
  return item.status === 200 && Boolean(item.body) && typeof item.body === "object" && !Array.isArray(item.body);
}
function encryptionKey(secret: string) {
  return createHmac("sha256", secret).update("tavonel-operation-v1:response-encryption").digest();
}
function seal(secret: string, binding: string, value: GuardAnswer): string | null {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_RESPONSE_BYTES || !validAnswer(value)) return null;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), nonce);
  cipher.setAAD(Buffer.from(binding));
  return Buffer.concat([nonce, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}
function unseal(secret: string, binding: string, encoded: unknown): GuardAnswer | null {
  if (typeof encoded !== "string" || encoded.length > 1_400_000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const data = Buffer.from(encoded, "base64url");
    if (data.length < 29 || data.length > MAX_RESPONSE_BYTES + 28) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(binding));
    decipher.setAuthTag(data.subarray(-16));
    const value: unknown = JSON.parse(Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString("utf8"));
    return validAnswer(value) ? value : null;
  } catch { return null; }
}

/**
 * Call only after authorization and, for Ask, after resolving the current World.
 * identity binds user/API key + current World. body binds the actual request.
 * Production never falls back to per-process state when its database is unavailable.
 * Applying migration 0055 before application rollout is a release prerequisite.
 */
export async function acquireWorkspaceOperation(
  scope: GuardScope, workspaceKey: string, request?: GuardRequest,
): Promise<OperationVerdict> {
  if (!workspaceKey || workspaceKey.length > 256 || !["ask", "export"].includes(scope)) return unavailable();
  if (request?.key !== null && request?.key !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(request.key)) {
    return { ok: false, code: "IDEMPOTENCY_KEY_INVALID", status: 400 };
  }
  const durable = process.env.VERCEL_ENV === "production" || process.env.TAVONEL_DURABLE_WORKSPACE_GUARDS === "1";
  if (!durable) return acquireLocal(scope, workspaceKey, request);
  const config = readSupabaseAdminConfig();
  if (!config) return unavailable();
  const owner = randomUUID();
  const key = request?.key ? opaque(config.serviceRoleKey, "request-key", JSON.stringify([workspaceKey, scope, request.identity, request.key])) : null;
  const digest = key && request ? opaque(config.serviceRoleKey, "request-body", request.body) : null;
  const binding = JSON.stringify([workspaceKey, scope, key, digest]);
  const base = { p_workspace_key: workspaceKey, p_scope: scope, p_owner_token: owner };
  async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await supabaseAdminRequest(config!, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
    if (!response.ok) throw new Error("operation_guard_rpc_failed");
    return response.json();
  }
  let result: unknown;
  try { result = await rpc("acquire_foundation_operation", { ...base, p_request_key: key, p_body_digest: digest }); }
  catch { return unavailable(); }
  if (!result || typeof result !== "object") return unavailable();
  const receipt = result as Record<string, unknown>;
  if (receipt.code === "REPLAY") {
    const value = unseal(config.serviceRoleKey, binding, receipt.ciphertext);
    return value ? { ok: true, replay: true, value } : unavailable();
  }
  if (receipt.code === "IDEMPOTENCY_CONFLICT" || receipt.code === "IDEMPOTENCY_IN_PROGRESS") {
    return { ok: false, code: receipt.code, status: 409 };
  }
  if (receipt.code === "WORKSPACE_CONCURRENCY_LIMIT" || receipt.code === "WORKSPACE_CACHE_CAPACITY_LIMIT") {
    return { ok: false, code: receipt.code, status: 429 };
  }
  if (receipt.code !== "ACQUIRED" || receipt.ownerToken !== owner || !UUID.test(owner)) return unavailable();
  let released = false;
  return {
    ok: true, replay: false,
    async complete(value) {
      if (released || !key) return false;
      const ciphertext = seal(config.serviceRoleKey, binding, value);
      if (!ciphertext) return false;
      try {
        const completed = await rpc("finish_foundation_operation", { ...base, p_ciphertext: ciphertext });
        if (completed === true) released = true;
        return completed === true;
      } catch { return false; }
    },
    async release() {
      if (released) return;
      released = true;
      // The TTL is a crash-recovery backstop. A failed release never changes an answer
      // into a provider error, and cannot release a newer worker because the token is fenced.
      try { await rpc("finish_foundation_operation", { ...base, p_ciphertext: null }); } catch { /* expires at 75s */ }
    },
  };
}

function acquireLocal(scope: GuardScope, workspaceKey: string, request?: GuardRequest): OperationVerdict {
  const now = Date.now();
  for (const [key, item] of localEntries) if (item.expiresAt <= now) localEntries.delete(key);
  const bucket = opaque(localKey, "bucket", JSON.stringify([workspaceKey, scope]));
  const owner = randomUUID();
  const requestKey = request?.key ? opaque(localKey, "request", JSON.stringify([request.identity, request.key])) : owner;
  const mapKey = `${bucket}:${requestKey}`;
  const digest = request?.key ? opaque(localKey, "body", request.body) : null;
  const previous = localEntries.get(mapKey);
  if (previous) {
    if (previous.digest !== digest) return { ok: false, code: "IDEMPOTENCY_CONFLICT", status: 409 };
    if (previous.value) return { ok: true, replay: true, value: structuredClone(previous.value) };
    return { ok: false, code: "IDEMPOTENCY_IN_PROGRESS", status: 409 };
  }
  const limit = scope === "ask" ? WORKSPACE_ASK_CONCURRENCY : WORKSPACE_EXPORT_CONCURRENCY;
  const held = [...localEntries].filter(([key, item]) => key.startsWith(`${bucket}:`) && !item.value).length;
  if (held >= limit) return { ok: false, code: "WORKSPACE_CONCURRENCY_LIMIT", status: 429 };
  if (request?.key) {
    const keyed = [...localEntries].filter(([key, item]) => key.startsWith(`${bucket}:`) && item.digest !== null);
    const reserved = keyed.reduce((sum, [, item]) => sum + (item.cacheBytes ?? RESERVED_CIPHERTEXT_BYTES), 0);
    if (keyed.length >= WORKSPACE_CACHE_MAX_KEYS || reserved + RESERVED_CIPHERTEXT_BYTES > WORKSPACE_CACHE_MAX_BYTES) {
      return { ok: false, code: "WORKSPACE_CACHE_CAPACITY_LIMIT", status: 429 };
    }
  }
  if (localEntries.size >= 10_000) return unavailable();
  localEntries.set(mapKey, { owner, digest, expiresAt: now + LEASE_MS });
  return {
    ok: true, replay: false,
    async complete(value) {
      const current = localEntries.get(mapKey);
      if (!request?.key || !validAnswer(value) || current?.owner !== owner || current.expiresAt <= Date.now()
          || Buffer.byteLength(JSON.stringify(value)) > MAX_RESPONSE_BYTES) return false;
      const cacheBytes = Math.ceil((Buffer.byteLength(JSON.stringify(value)) + 28) * 4 / 3);
      localEntries.set(mapKey, { owner, digest, expiresAt: Date.now() + CACHE_MS, cacheBytes, value: structuredClone(value) });
      return true;
    },
    async release() {
      const current = localEntries.get(mapKey);
      if (current?.owner === owner && !current.value) localEntries.delete(mapKey);
    },
  };
}

export function resetLocalWorkspaceOperationsForTest() { localEntries.clear(); }

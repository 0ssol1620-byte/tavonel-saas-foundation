import { validateReviewableCollectionArtifact } from "./collection-download";
import { collectionSourceDocumentIds } from "./collection-source-access";
import { loadPreferredCollectionCandidate } from "./collection-storage";
import { checkMemberSourceScope, scopeInputValid, VIEWER_ID } from "./connector-source-access";
import { WORKSPACE_ID_PATTERN } from "./immutable-keys";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { getFoundationActiveWorld } from "./world-store";

/*
  WO-C-T3: the member source scope at the read paths that do not pass through
  checkConnectorSourceAccessForViewer, and the scope's own store calls. The chokepoint itself, and
  checkMemberSourceScope, stay in connector-source-access.ts: every caller of the chokepoint
  inherits the scope from there.

  Owners and admins read every source: each gate answers them without a read, so their paths are
  unchanged. Any other role -- `member`, or one this file does not know -- asks the database.
*/

type ScopeViewer = { workspaceKey: string; userId: string; workspaceRole: string };
const readsEverything = (viewer: ScopeViewer) => viewer.workspaceRole === "owner" || viewer.workspaceRole === "admin";

/**
 * The subset of documentIds a viewer may read, for lists that drop what a member cannot read
 * instead of refusing the whole page. Owners and admins get the input back without a round trip;
 * any other role asks the database. The answer must be a subset of the input or it is refused.
 */
export async function filterMemberReadableDocumentIds(viewer: ScopeViewer, documentIds: readonly string[]): Promise<
  { ok: true; documentIds: Set<string> } | { ok: false; code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE" }
> {
  // Owners and admins: the list exactly as before, no new refusal (the routes check the ids themselves).
  if (readsEverything(viewer)) return { ok: true, documentIds: new Set(documentIds) };
  if (!scopeInputValid(viewer.workspaceKey, viewer.userId, documentIds)) return { ok: false, code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE" };
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false, code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE" };
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/member_readable_document_ids", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ p_workspace_key: viewer.workspaceKey, p_user_id: viewer.userId, p_document_ids: [...new Set(documentIds)] }),
    });
    if (!response.ok) return { ok: false, code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE" };
    const readable: unknown = await response.json();
    const asked = new Set(documentIds);
    if (!Array.isArray(readable) || readable.some(id => typeof id !== "string" || !asked.has(id))) {
      return { ok: false, code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE" };
    }
    return { ok: true, documentIds: new Set(readable as string[]) };
  } catch { return { ok: false, code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE" }; }
}

export type MemberScopeRefusal = { code: "MEMBER_SOURCE_SCOPE_DENIED" | "MEMBER_SOURCE_SCOPE_UNAVAILABLE"; status: 403 | 503 };
const SCOPE_DENIED: MemberScopeRefusal = { code: "MEMBER_SOURCE_SCOPE_DENIED", status: 403 };
const SCOPE_UNAVAILABLE: MemberScopeRefusal = { code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE", status: 503 };

/** A set of sources for a single-item read: null when the viewer may read every one of them. */
export async function memberSourcesRefusal(viewer: ScopeViewer, documentIds: readonly string[]): Promise<MemberScopeRefusal | null> {
  if (readsEverything(viewer)) return null;
  const scope = await checkMemberSourceScope(viewer.workspaceKey, viewer.userId, documentIds);
  return scope.ok ? null : scope.code === "MEMBER_SOURCE_SCOPE_DENIED" ? SCOPE_DENIED : SCOPE_UNAVAILABLE;
}

/**
 * The World gate for read paths that do not pass through checkConnectorSourceAccessForViewer
 * (TC-D2: a member reads a World only when every source behind it is in their scope).
 *
 * Owners and admins pass without a read. For anyone else the sources are those of the version
 * served -- `manifestDigest` when the route names one, else the active World, else the preferred
 * candidate, as loadWorldReadModel picks -- read from the stored package. A World whose sources
 * cannot be established (no package, an invalid one) is refused, never assumed readable.
 */
export async function memberCollectionScopeRefusal(
  viewer: ScopeViewer, collectionId: string, manifestDigest?: string,
): Promise<MemberScopeRefusal | null> {
  if (readsEverything(viewer)) return null;
  const sources = await collectionSourceIds(viewer.workspaceKey, collectionId, manifestDigest);
  if (sources === "unavailable") return SCOPE_UNAVAILABLE;
  if (sources === null) return SCOPE_DENIED;
  return memberSourcesRefusal(viewer, sources);
}

/** A member's scope as the store answers it (get_member_source_scope); never a public DTO. */
export type MemberSourceScopeRecord = { userId: string; kind: "none" | "all" | "listed"; documentIds: string[] };
export type MemberSourceScopeWrite = { userId: string; kind: "all" | "listed"; documentCount: number; idempotentReplay: boolean };
type ScopeStoreFailure = {
  ok: false;
  code: "MEMBER_SOURCE_SCOPE_INPUT_INVALID" | "MEMBER_SOURCE_SCOPE_FORBIDDEN" | "MEMBER_SOURCE_SCOPE_TARGET_FORBIDDEN"
    | "MEMBER_SOURCE_SCOPE_IDEMPOTENCY_CONFLICT" | "WORKSPACE_MEMBER_NOT_FOUND" | "MEMBER_SOURCE_SCOPE_UNAVAILABLE";
  status: 400 | 403 | 404 | 409 | 503;
};
const SCOPE_STORE_ERRORS: ReadonlyArray<[string, ScopeStoreFailure]> = [
  ["member_source_scope_input_invalid", { ok: false, code: "MEMBER_SOURCE_SCOPE_INPUT_INVALID", status: 400 }],
  ["member_source_scope_idempotency_conflict", { ok: false, code: "MEMBER_SOURCE_SCOPE_IDEMPOTENCY_CONFLICT", status: 409 }],
  ["member_source_scope_target_forbidden", { ok: false, code: "MEMBER_SOURCE_SCOPE_TARGET_FORBIDDEN", status: 409 }],
  ["member_source_scope_forbidden", { ok: false, code: "MEMBER_SOURCE_SCOPE_FORBIDDEN", status: 403 }],
  ["workspace_member_not_found", { ok: false, code: "WORKSPACE_MEMBER_NOT_FOUND", status: 404 }],
];
const STORE_UNAVAILABLE: ScopeStoreFailure = { ok: false, code: "MEMBER_SOURCE_SCOPE_UNAVAILABLE", status: 503 };
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function scopeRpc(name: string, body: Record<string, unknown>): Promise<{ ok: true; value: Record<string, unknown> } | ScopeStoreFailure> {
  const config = readSupabaseAdminConfig();
  if (!config) return STORE_UNAVAILABLE;
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
      method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { message?: unknown } | null;
      const message = typeof error?.message === "string" ? error.message : "";
      return SCOPE_STORE_ERRORS.find(([raised]) => message === raised)?.[1] ?? STORE_UNAVAILABLE;
    }
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value) ? { ok: true, value: value as Record<string, unknown> } : STORE_UNAVAILABLE;
  } catch { return STORE_UNAVAILABLE; }
}

/** One member's scope, read for an owner/admin. The database repeats who may read it. */
export async function readMemberSourceScope(input: { workspaceKey: string; actorUserId: string; memberUserId: string }): Promise<
  { ok: true; scope: MemberSourceScopeRecord } | ScopeStoreFailure
> {
  if (!WORKSPACE_ID_PATTERN.test(input.workspaceKey) || !VIEWER_ID.test(input.actorUserId) || !VIEWER_ID.test(input.memberUserId)) {
    return { ok: false, code: "MEMBER_SOURCE_SCOPE_INPUT_INVALID", status: 400 };
  }
  const read = await scopeRpc("get_member_source_scope", {
    p_workspace_key: input.workspaceKey, p_actor_user_id: input.actorUserId, p_member_user_id: input.memberUserId,
  });
  if (!read.ok) return read;
  const { userId, kind, documentIds } = read.value;
  if (typeof userId !== "string" || userId.toLowerCase() !== input.memberUserId.toLowerCase() ||
      (kind !== "none" && kind !== "all" && kind !== "listed") || !Array.isArray(documentIds) ||
      documentIds.length > 2000 || documentIds.some(id => typeof id !== "string" || !CANONICAL_UUID.test(id)) ||
      (kind !== "listed" && documentIds.length > 0) || (kind === "listed" && documentIds.length === 0)) {
    return STORE_UNAVAILABLE;
  }
  return { ok: true, scope: { userId: input.memberUserId, kind, documentIds: documentIds as string[] } };
}

/**
 * Replace one member's scope. Effective for the next request: every read asks the database, so no
 * cache or background job stands between this write and the next check.
 */
export async function setMemberSourceScope(input: {
  workspaceKey: string; actorUserId: string; memberUserId: string;
  kind: "all" | "listed"; documentIds: readonly string[]; requestId: string;
}): Promise<{ ok: true; scope: MemberSourceScopeWrite } | ScopeStoreFailure> {
  if (!WORKSPACE_ID_PATTERN.test(input.workspaceKey) || !VIEWER_ID.test(input.actorUserId) || !VIEWER_ID.test(input.memberUserId) ||
      (input.kind !== "all" && input.kind !== "listed") || (input.kind === "all" && input.documentIds.length > 0) ||
      input.documentIds.length > 2000 || input.documentIds.some(id => typeof id !== "string" || !CANONICAL_UUID.test(id)) ||
      input.requestId.length < 8 || input.requestId.length > 160) {
    return { ok: false, code: "MEMBER_SOURCE_SCOPE_INPUT_INVALID", status: 400 };
  }
  const written = await scopeRpc("set_member_source_scope", {
    p_workspace_key: input.workspaceKey, p_actor_user_id: input.actorUserId, p_member_user_id: input.memberUserId,
    p_kind: input.kind, p_document_ids: input.kind === "all" ? null : [...new Set(input.documentIds)], p_request_id: input.requestId,
  });
  if (!written.ok) return written;
  const { userId, kind, documentCount, idempotentReplay } = written.value;
  if (typeof userId !== "string" || userId.toLowerCase() !== input.memberUserId.toLowerCase() || kind !== input.kind ||
      documentCount !== (input.kind === "all" ? 0 : new Set(input.documentIds).size) || typeof idempotentReplay !== "boolean") {
    return STORE_UNAVAILABLE;
  }
  return { ok: true, scope: { userId: input.memberUserId, kind: input.kind, documentCount: documentCount as number, idempotentReplay } };
}

async function collectionSourceIds(workspaceKey: string, collectionId: string, manifestDigest?: string): Promise<string[] | null | "unavailable"> {
  try {
    let digest = manifestDigest;
    if (digest === undefined) {
      const active = await getFoundationActiveWorld(workspaceKey, collectionId);
      if (active.ok) digest = active.world.manifestDigest;
      else if (active.code !== "ACTIVE_WORLD_NOT_FOUND") return "unavailable";
    }
    const signer = readR2SignerEnv();
    if (!signer) return "unavailable";
    const loaded = await loadPreferredCollectionCandidate(signer, workspaceKey, collectionId, digest);
    if (!loaded.ok) return loaded.code === "NOT_FOUND" ? null : "unavailable";
    const artifact = validateReviewableCollectionArtifact(loaded.value.artifact, collectionId);
    return artifact ? collectionSourceDocumentIds(artifact) : null;
  } catch { return "unavailable"; }
}

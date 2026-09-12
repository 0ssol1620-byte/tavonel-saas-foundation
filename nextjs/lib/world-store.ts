import { COLLECTION_ID_PATTERN, DOCUMENT_ID_PATTERN, WORKSPACE_ID_PATTERN } from "./immutable-keys";
import {
  readSupabaseAdminConfig,
  supabaseAdminRequest,
} from "./supabase-admin";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const WORLD_STATE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export type ActiveWorld = {
  workspaceKey: string;
  collectionId: string;
  manifestDigest: string;
  revision: number;
  updatedAt: string;
  candidateObjectKey: string;
  worldStateId: string;
  coreOutputSha256: string;
};

export type WorldVersionRow = {
  manifest_digest: string;
  world_state_id: string;
  lifecycle_status: "active" | "superseded";
  first_promoted_at: string;
  last_activated_at: string;
  activation_count: number;
};

type WorldMutation = {
  workspaceKey: string;
  collectionId: string;
  actorUserId: string;
  expectedCurrentManifest: string | null;
  reason: string;
};

export type PromoteWorldMutation = WorldMutation & {
  manifestDigest: string;
  candidateObjectKey: string;
  worldStateId: string;
  coreOutputSha256: string;
};

export type RollbackWorldMutation = WorldMutation & {
  targetManifestDigest: string;
};

function validReason(reason: string) {
  return reason.trim().length >= 8 && reason.trim().length <= 500;
}

function validMutationBase(value: WorldMutation) {
  return (
    WORKSPACE_ID_PATTERN.test(value.workspaceKey) &&
    COLLECTION_ID_PATTERN.test(value.collectionId) &&
    /^[0-9a-f-]{36}$/i.test(value.actorUserId) &&
    (value.expectedCurrentManifest === null ||
      SHA256.test(value.expectedCurrentManifest)) &&
    validReason(value.reason)
  );
}

function candidateKey(
  workspaceKey: string,
  collectionId: string,
  manifestDigest: string
) {
  return `immutable/${workspaceKey}/${workspaceKey}/collections/${collectionId}/${manifestDigest.slice(7)}/candidate-world.json`;
}

function expectedCandidateKey(
  value: Pick<
    PromoteWorldMutation,
    "workspaceKey" | "collectionId" | "manifestDigest"
  >
) {
  return candidateKey(
    value.workspaceKey,
    value.collectionId,
    value.manifestDigest
  );
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseWorldVersion(
  value: Record<string, unknown>
): WorldVersionRow | null {
  const activationCount = Number(value.activation_count);
  if (
    typeof value.manifest_digest !== "string" ||
    !SHA256.test(value.manifest_digest) ||
    typeof value.world_state_id !== "string" ||
    !WORLD_STATE_ID.test(value.world_state_id) ||
    (value.lifecycle_status !== "active" &&
      value.lifecycle_status !== "superseded") ||
    !validTimestamp(value.first_promoted_at) ||
    !validTimestamp(value.last_activated_at) ||
    !Number.isSafeInteger(activationCount) ||
    activationCount < 1
  ) {
    return null;
  }
  return {
    manifest_digest: value.manifest_digest,
    world_state_id: value.world_state_id,
    lifecycle_status: value.lifecycle_status,
    first_promoted_at: value.first_promoted_at,
    last_activated_at: value.last_activated_at,
    activation_count: activationCount,
  };
}

export function validatePromoteWorldMutation(value: PromoteWorldMutation) {
  return (
    validMutationBase(value) &&
    SHA256.test(value.manifestDigest) &&
    SHA256.test(value.coreOutputSha256) &&
    WORLD_STATE_ID.test(value.worldStateId) &&
    value.candidateObjectKey === expectedCandidateKey(value)
  );
}

export function validateRollbackWorldMutation(value: RollbackWorldMutation) {
  return validMutationBase(value) && SHA256.test(value.targetManifestDigest);
}

async function rpc(name: string, body: Record<string, unknown>) {
  const config = readSupabaseAdminConfig();
  if (!config)
    return { ok: false as const, code: "WORLD_STORE_NOT_CONFIGURED" };
  let response: Response;
  try {
    response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false as const, code: "WORLD_STORE_WRITE_FAILED" };
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      message?: unknown;
    } | null;
    const message = typeof error?.message === "string" ? error.message : "";
    if (message.includes("world_active_pointer_conflict")) {
      return { ok: false as const, code: "ACTIVE_WORLD_CONFLICT" };
    }
    if (message.includes("world_rollback_target_missing")) {
      return { ok: false as const, code: "ROLLBACK_TARGET_NOT_FOUND" };
    }
    return { ok: false as const, code: "WORLD_STORE_WRITE_FAILED" };
  }
  return {
    ok: true as const,
    result: (await response.json()) as Record<string, unknown>,
  };
}

export async function promoteFoundationCandidate(value: PromoteWorldMutation) {
  if (!validatePromoteWorldMutation(value))
    return { ok: false as const, code: "WORLD_PROMOTION_INVALID" };
  return rpc("promote_foundation_candidate", {
    p_workspace_key: value.workspaceKey,
    p_collection_id: value.collectionId,
    p_manifest_digest: value.manifestDigest,
    p_candidate_object_key: value.candidateObjectKey,
    p_world_state_id: value.worldStateId,
    p_core_output_sha256: value.coreOutputSha256,
    p_actor_user_id: value.actorUserId,
    p_expected_current_manifest: value.expectedCurrentManifest,
    p_reason: value.reason.trim(),
  });
}

export async function rollbackFoundationWorld(value: RollbackWorldMutation) {
  if (!validateRollbackWorldMutation(value))
    return { ok: false as const, code: "WORLD_ROLLBACK_INVALID" };
  return rpc("rollback_foundation_world", {
    p_workspace_key: value.workspaceKey,
    p_collection_id: value.collectionId,
    p_target_manifest_digest: value.targetManifestDigest,
    p_expected_current_manifest: value.expectedCurrentManifest,
    p_actor_user_id: value.actorUserId,
    p_reason: value.reason.trim(),
  });
}

export async function getFoundationActiveWorld(
  workspaceKey: string,
  collectionId: string
) {
  if (
    !WORKSPACE_ID_PATTERN.test(workspaceKey) ||
    !COLLECTION_ID_PATTERN.test(collectionId)
  ) {
    return { ok: false as const, code: "WORLD_ID_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config)
    return { ok: false as const, code: "WORLD_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "workspace_key,collection_id,manifest_digest,revision,updated_at",
    workspace_key: `eq.${workspaceKey}`,
    collection_id: `eq.${collectionId}`,
    limit: "1",
  });
  try {
    const pointerResponse = await supabaseAdminRequest(
      config,
      `/rest/v1/foundation_active_worlds?${query}`
    );
    if (!pointerResponse.ok)
      return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
    const pointers = (await pointerResponse.json()) as Array<
      Record<string, unknown>
    >;
    const pointer = pointers[0];
    if (!pointer) return { ok: false as const, code: "ACTIVE_WORLD_NOT_FOUND" };
    const manifestDigest = String(pointer.manifest_digest ?? "");
    const versionQuery = new URLSearchParams({
      select:
        "candidate_object_key,world_state_id,core_output_sha256,lifecycle_status",
      workspace_key: `eq.${workspaceKey}`,
      collection_id: `eq.${collectionId}`,
      manifest_digest: `eq.${manifestDigest}`,
      limit: "1",
    });
    const versionResponse = await supabaseAdminRequest(
      config,
      `/rest/v1/foundation_world_versions?${versionQuery}`
    );
    if (!versionResponse.ok)
      return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
    const versions = (await versionResponse.json()) as Array<
      Record<string, unknown>
    >;
    const version = versions[0];
    if (!version || version.lifecycle_status !== "active")
      return { ok: false as const, code: "ACTIVE_WORLD_BINDING_INVALID" };
    const world: ActiveWorld = {
      workspaceKey,
      collectionId,
      manifestDigest,
      revision: Number(pointer.revision),
      updatedAt: String(pointer.updated_at),
      candidateObjectKey: String(version.candidate_object_key),
      worldStateId: String(version.world_state_id),
      coreOutputSha256: String(version.core_output_sha256),
    };
    if (
      !SHA256.test(world.manifestDigest) ||
      !SHA256.test(world.coreOutputSha256) ||
      !WORLD_STATE_ID.test(world.worldStateId) ||
      world.candidateObjectKey !==
        candidateKey(workspaceKey, collectionId, world.manifestDigest) ||
      !Number.isSafeInteger(world.revision) ||
      world.revision < 1 ||
      !validTimestamp(world.updatedAt)
    ) {
      return { ok: false as const, code: "ACTIVE_WORLD_BINDING_INVALID" };
    }
    return { ok: true as const, world };
  } catch {
    return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
  }
}

export async function listFoundationWorldVersions(
  workspaceKey: string,
  collectionId: string
) {
  if (
    !WORKSPACE_ID_PATTERN.test(workspaceKey) ||
    !COLLECTION_ID_PATTERN.test(collectionId)
  ) {
    return { ok: false as const, code: "WORLD_ID_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config)
    return { ok: false as const, code: "WORLD_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select:
      "manifest_digest,world_state_id,lifecycle_status,first_promoted_at,last_activated_at,activation_count",
    workspace_key: `eq.${workspaceKey}`,
    collection_id: `eq.${collectionId}`,
    order: "last_activated_at.desc",
    limit: "50",
  });
  try {
    const response = await supabaseAdminRequest(
      config,
      `/rest/v1/foundation_world_versions?${query}`
    );
    if (!response.ok)
      return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
    const rows = (await response.json()) as Array<Record<string, unknown>>;
    const versions = rows.map(parseWorldVersion);
    if (versions.some(version => version === null)) {
      return { ok: false as const, code: "WORLD_VERSION_BINDING_INVALID" };
    }
    return { ok: true as const, versions: versions as WorldVersionRow[] };
  } catch {
    return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
  }
}

/*
  ---------------------------------------------------------------------------------------------
  Discovery, freshness and manifest-activation reads (audit X01, TM04, TM06)
  ---------------------------------------------------------------------------------------------

  Three reads that share this module's posture: every one validates the workspace key against
  WORKSPACE_ID_PATTERN before it is placed in a query string, carries `workspace_key=eq.<key>`
  on every request, and fails closed with a code rather than throwing into a handler. None of
  them accepts a workspace from the caller's body -- the key comes from the authorized
  principal at the route, exactly as getFoundationActiveWorld's callers already pass it.
*/

export type ActiveWorldSummary = {
  collectionId: string;
  manifestDigest: string;
  revision: number;
  updatedAt: string;
};

export const ACTIVE_WORLD_PAGE_MAX = 50;
export const ACTIVE_WORLD_PAGE_DEFAULT = 25;

/**
 * The workspace's active Worlds, one page at a time (audit X01).
 *
 * Keyset paginated on `collection_id` ascending rather than on `updated_at`: the pair
 * (workspace_key, collection_id) is the table's primary key, so the ordering is total and a
 * cursor can never skip or repeat a row when a promotion changes `updated_at` mid-walk. The
 * cursor is the last collection id the caller saw, which is already a public identifier -- it
 * encodes no offset, no timestamp and nothing about rows in another workspace.
 *
 * There is no "list every workspace" form of this function, and no workspace parameter a
 * request body can reach. Cross-tenant listing is not a permission this module can express.
 */
export async function listFoundationActiveWorlds(
  workspaceKey: string,
  options: { limit?: number; cursor?: string | null } = {},
) {
  const limit = options.limit ?? ACTIVE_WORLD_PAGE_DEFAULT;
  const cursor = options.cursor ?? null;
  if (!WORKSPACE_ID_PATTERN.test(workspaceKey)) {
    return { ok: false as const, code: "WORLD_ID_INVALID" };
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > ACTIVE_WORLD_PAGE_MAX) {
    return { ok: false as const, code: "WORLD_PAGE_LIMIT_INVALID" };
  }
  if (cursor !== null && !COLLECTION_ID_PATTERN.test(cursor)) {
    return { ok: false as const, code: "WORLD_PAGE_CURSOR_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "WORLD_STORE_NOT_CONFIGURED" };
  const query = new URLSearchParams({
    select: "collection_id,manifest_digest,revision,updated_at",
    workspace_key: `eq.${workspaceKey}`,
    order: "collection_id.asc",
    // One more than asked for, so "is there another page" is answered by this read rather
    // than by a second count query that could disagree with it.
    limit: String(limit + 1),
  });
  if (cursor) query.set("collection_id", `gt.${cursor}`);
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/foundation_active_worlds?${query}`);
    if (!response.ok) return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
    const rows = (await response.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
    const parsed: ActiveWorldSummary[] = [];
    for (const row of rows.slice(0, limit)) {
      const summary: ActiveWorldSummary = {
        collectionId: String(row.collection_id ?? ""),
        manifestDigest: String(row.manifest_digest ?? ""),
        revision: Number(row.revision),
        updatedAt: String(row.updated_at ?? ""),
      };
      if (
        !COLLECTION_ID_PATTERN.test(summary.collectionId) ||
        !SHA256.test(summary.manifestDigest) ||
        !Number.isSafeInteger(summary.revision) ||
        summary.revision < 1 ||
        !validTimestamp(summary.updatedAt)
      ) {
        // A row that does not parse is a binding failure, not a row to skip: skipping it
        // would hand the caller a page that quietly omits one of their own Worlds.
        return { ok: false as const, code: "ACTIVE_WORLD_BINDING_INVALID" };
      }
      parsed.push(summary);
    }
    const nextCursor = rows.length > limit ? (parsed[parsed.length - 1]?.collectionId ?? null) : null;
    return { ok: true as const, worlds: parsed, nextCursor };
  } catch {
    return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
  }
}

export type ManifestActivationStatus = {
  collectionId: string;
  manifestDigest: string;
  active: boolean;
  activeManifestDigest: string;
  knownToWorkspace: boolean;
  lifecycleStatus: "active" | "superseded" | null;
  activatedAt: string | null;
};

/**
 * Is this manifest digest the one this workspace answers from right now (audit TM06)?
 *
 * A signed Compiled World Package verifies offline, which is the point of signing it, and
 * offline verification cannot be revoked remotely. Nothing here pretends otherwise. What this
 * answers is the question an ONLINE consumer can ask: the copy I hold, is it still current?
 * `active: false` means a different version is the active one now. It does not mean the held
 * copy was withdrawn or deleted, and this endpoint cannot delete anyone's copy.
 */
export async function getManifestActivationStatus(
  workspaceKey: string,
  collectionId: string,
  manifestDigest: string,
) {
  if (!WORKSPACE_ID_PATTERN.test(workspaceKey) || !COLLECTION_ID_PATTERN.test(collectionId)) {
    return { ok: false as const, code: "WORLD_ID_INVALID" };
  }
  if (!SHA256.test(manifestDigest)) {
    return { ok: false as const, code: "MANIFEST_DIGEST_INVALID" };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "WORLD_STORE_NOT_CONFIGURED" };
  try {
    const pointerQuery = new URLSearchParams({
      select: "manifest_digest",
      workspace_key: `eq.${workspaceKey}`,
      collection_id: `eq.${collectionId}`,
      limit: "1",
    });
    const pointerResponse = await supabaseAdminRequest(
      config,
      `/rest/v1/foundation_active_worlds?${pointerQuery}`,
    );
    if (!pointerResponse.ok) return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
    const pointers = (await pointerResponse.json()) as Array<Record<string, unknown>>;
    const pointer = pointers[0];
    if (!pointer) return { ok: false as const, code: "ACTIVE_WORLD_NOT_FOUND" };
    const activeManifestDigest = String(pointer.manifest_digest ?? "");
    if (!SHA256.test(activeManifestDigest)) {
      return { ok: false as const, code: "ACTIVE_WORLD_BINDING_INVALID" };
    }

    const versionQuery = new URLSearchParams({
      select: "manifest_digest,lifecycle_status,last_activated_at",
      workspace_key: `eq.${workspaceKey}`,
      collection_id: `eq.${collectionId}`,
      manifest_digest: `eq.${manifestDigest}`,
      limit: "1",
    });
    const versionResponse = await supabaseAdminRequest(
      config,
      `/rest/v1/foundation_world_versions?${versionQuery}`,
    );
    if (!versionResponse.ok) return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
    const versions = (await versionResponse.json()) as Array<Record<string, unknown>>;
    const version = versions[0];
    const lifecycleStatus =
      version?.lifecycle_status === "active" || version?.lifecycle_status === "superseded"
        ? (version.lifecycle_status as "active" | "superseded")
        : null;
    const activatedAt = validTimestamp(version?.last_activated_at)
      ? String(version.last_activated_at)
      : null;
    const status: ManifestActivationStatus = {
      collectionId,
      manifestDigest,
      // The pointer is the authority on what is being answered from, not the version row's
      // own lifecycle column: a rollback moves the pointer, and reading only the row would
      // report the digest the pointer left behind as still current.
      active: activeManifestDigest === manifestDigest,
      activeManifestDigest,
      // `false` when this workspace never promoted this digest -- a different statement from
      // "it was superseded", so it is reported as its own value rather than folded in.
      knownToWorkspace: lifecycleStatus !== null,
      lifecycleStatus,
      activatedAt,
    };
    return { ok: true as const, status };
  } catch {
    return { ok: false as const, code: "WORLD_STORE_READ_FAILED" };
  }
}

/*
  Freshness (audit TM04), computed from columns that already exist.

  Four different clocks get collapsed into one word -- "current" -- in most products, and
  collapsing them is what lets a reader believe a World reflects a document that arrived after
  the compile ran:

    observedAt   source_versions.observed_at                 -- when the bytes were first seen
    processedAt  foundation_compile_jobs.settled_at           -- when the compile settled
    reviewedAt   foundation_compile_jobs.blocked_resolved_at  -- when a person answered a blocker
    activatedAt  foundation_world_versions.last_activated_at  -- when a person made it the World

  No column is added and no timestamp is derived from another. A null is the literal absence of
  a recorded value -- an unreadable table leaves its own field null rather than substituting a
  neighbouring clock, because a freshness statement that guesses is worse than one that admits
  a gap. `reviewedAt` is specifically the blocker-resolution decision, the only review instant
  this schema records; it is not a general "a person reviewed this World" timestamp, and the
  docs block says so where a reader will look.
*/
export type WorldFreshness = {
  observedAt: string | null;
  processedAt: string | null;
  reviewedAt: string | null;
  activatedAt: string | null;
  activeManifestDigest: string | null;
  candidateAwaitingActivation: boolean;
  candidateManifestDigest: string | null;
};

export const EMPTY_WORLD_FRESHNESS: WorldFreshness = {
  observedAt: null,
  processedAt: null,
  reviewedAt: null,
  activatedAt: null,
  activeManifestDigest: null,
  candidateAwaitingActivation: false,
  candidateManifestDigest: null,
};

async function readFreshnessRows(
  config: NonNullable<ReturnType<typeof readSupabaseAdminConfig>>,
  path: string,
): Promise<Array<Record<string, unknown>> | null> {
  try {
    const response = await supabaseAdminRequest(config, path);
    if (!response.ok) return null;
    const rows = await response.json();
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : null;
  } catch {
    return null;
  }
}

function firstTimestamp(rows: Array<Record<string, unknown>> | null, column: string): string | null {
  const value = rows?.[0]?.[column];
  return validTimestamp(value) ? value : null;
}

/**
 * One freshness block for one World.
 *
 * `candidateManifestDigest` is supplied by callers that have already read the preferred
 * candidate artifact (the World read model does). Without that hint the answer now comes from
 * the digest the compile job recorded (`20260911120200`), and only then from the newest
 * promoted version -- so the remaining blind spot is narrow and named: a candidate compiled
 * before that column existed recorded no digest, and for those the flag still reads false.
 * That limit is real, and it is written down rather than papered over with a guess.
 */
export async function getWorldFreshness(
  workspaceKey: string,
  collectionId: string,
  options: { candidateManifestDigest?: string | null } = {},
): Promise<WorldFreshness> {
  if (!WORKSPACE_ID_PATTERN.test(workspaceKey) || !COLLECTION_ID_PATTERN.test(collectionId)) {
    return { ...EMPTY_WORLD_FRESHNESS };
  }
  const config = readSupabaseAdminConfig();
  if (!config) return { ...EMPTY_WORLD_FRESHNESS };

  /*
    Three independent reads, issued together.

    None depends on another's result, and /ask and /search attach this block on every request --
    running them in sequence would put three extra round trips on the critical path of the most
    latency-sensitive route on the surface for no reason. Only the source-version read below has
    to wait, because it needs the document ids off the compile-job row.
  */
  const [pointerRows, versionRows, jobRows] = await Promise.all([
    readFreshnessRows(
      config,
      `/rest/v1/foundation_active_worlds?${new URLSearchParams({
        select: "manifest_digest",
        workspace_key: `eq.${workspaceKey}`,
        collection_id: `eq.${collectionId}`,
        limit: "1",
      })}`,
    ),
    readFreshnessRows(
      config,
      `/rest/v1/foundation_world_versions?${new URLSearchParams({
        select: "manifest_digest,last_activated_at,created_at",
        workspace_key: `eq.${workspaceKey}`,
        collection_id: `eq.${collectionId}`,
        order: "created_at.desc",
        limit: "50",
      })}`,
    ),
    readFreshnessRows(
      config,
      `/rest/v1/foundation_compile_jobs?${new URLSearchParams({
        select: "settled_at,blocked_resolved_at,document_ids,candidate_manifest_digest",
        workspace_key: `eq.${workspaceKey}`,
        collection_id: `eq.${collectionId}`,
        order: "settled_at.desc.nullslast",
        limit: "1",
      })}`,
    ),
  ]);

  const pointerDigest = String(pointerRows?.[0]?.manifest_digest ?? "");
  const activeManifestDigest = SHA256.test(pointerDigest) ? pointerDigest : null;
  const activeVersion = versionRows?.find(row => row.manifest_digest === activeManifestDigest) ?? null;
  const activatedAt = validTimestamp(activeVersion?.last_activated_at)
    ? String(activeVersion.last_activated_at)
    : null;
  const processedAt = firstTimestamp(jobRows, "settled_at");
  const reviewedAt = firstTimestamp(jobRows, "blocked_resolved_at");

  // The document ids come off a row already filtered by workspace_key, so the source-version
  // read below is tenant-scoped by construction rather than by a second predicate on a table
  // that carries no workspace column of its own.
  const documentIds = Array.isArray(jobRows?.[0]?.document_ids)
    ? (jobRows[0].document_ids as unknown[])
        .filter((id): id is string => typeof id === "string" && DOCUMENT_ID_PATTERN.test(id))
        .slice(0, 200)
    : [];
  const sourceRows =
    documentIds.length === 0
      ? null
      : await readFreshnessRows(
          config,
          `/rest/v1/source_versions?${new URLSearchParams({
            select: "observed_at",
            source_id: `in.(${documentIds.join(",")})`,
            order: "observed_at.desc",
            limit: "1",
          })}`,
        );
  const observedAt = firstTimestamp(sourceRows, "observed_at");

  const hinted = options.candidateManifestDigest ?? null;
  const hintedCandidate =
    hinted !== null && SHA256.test(hinted) && hinted !== activeManifestDigest ? hinted : null;
  /*
    The digest the newest compile recorded (20260911120200). This is what closes the gap the
    docstring above names: a candidate that was compiled and never promoted is invisible to
    `foundation_world_versions`, which only learns a digest at promotion -- the event this flag
    exists to wait for. Null on every job that predates the column, so the answer degrades to
    what it was rather than guessing.
  */
  const recordedDigest = String(jobRows?.[0]?.candidate_manifest_digest ?? "");
  const recordedCandidate =
    SHA256.test(recordedDigest) && recordedDigest !== activeManifestDigest ? recordedDigest : null;
  const newestVersionDigest = String(versionRows?.[0]?.manifest_digest ?? "");
  const newerPromotedVersion =
    SHA256.test(newestVersionDigest) && newestVersionDigest !== activeManifestDigest
      ? newestVersionDigest
      : null;
  // Precedence: the candidate this request already loaded, then the one the newest compile
  // recorded, then the newest promoted-but-not-active version. Most specific first.
  const candidateManifestDigest = hintedCandidate ?? recordedCandidate ?? newerPromotedVersion;

  return {
    observedAt,
    processedAt,
    reviewedAt,
    activatedAt,
    activeManifestDigest,
    candidateAwaitingActivation: candidateManifestDigest !== null,
    candidateManifestDigest,
  };
}

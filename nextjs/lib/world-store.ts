import { COLLECTION_ID_PATTERN, WORKSPACE_ID_PATTERN } from "./immutable-keys";
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

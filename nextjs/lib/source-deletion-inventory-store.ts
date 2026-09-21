import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import type { SourceInventoryHashedObject } from "./source-deletion-inventory-r2";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SOURCE_ID = /^src-[a-f0-9]{64}$/;
const WORKSPACE = /^[A-Za-z0-9_-]{1,80}$/;
const DOCUMENT = /^[A-Za-z0-9_-]{1,80}$/;

export type SourceDeletionInventoryCandidate = {
  deletionId: string;
  workspaceKey: string;
  sourceId: string;
  documentIds: string[];
};

export type SourceDeletionInventoryAttestation = {
  status: "recorded" | "replayed";
  manifestSha256: string;
  artifactCount: number;
};

function candidate(value: unknown): SourceDeletionInventoryCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.deletionId !== "string" || !SHA256.test(row.deletionId) ||
    typeof row.workspaceKey !== "string" || !WORKSPACE.test(row.workspaceKey) ||
    typeof row.sourceId !== "string" || !SOURCE_ID.test(row.sourceId) ||
    !Array.isArray(row.documentIds) || row.documentIds.length > 128 ||
    !row.documentIds.every((id) => typeof id === "string" && DOCUMENT.test(id)) ||
    new Set(row.documentIds as string[]).size !== row.documentIds.length
  ) return null;
  return {
    deletionId: row.deletionId,
    workspaceKey: row.workspaceKey,
    sourceId: row.sourceId,
    documentIds: [...(row.documentIds as string[])].sort(),
  };
}

function attestation(value: unknown): SourceDeletionInventoryAttestation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    (row.status !== "recorded" && row.status !== "replayed") ||
    typeof row.manifestSha256 !== "string" || !SHA256.test(row.manifestSha256) ||
    typeof row.artifactCount !== "number" || !Number.isSafeInteger(row.artifactCount) ||
    row.artifactCount < 0 || row.artifactCount > 512
  ) return null;
  return {
    status: row.status,
    manifestSha256: row.manifestSha256,
    artifactCount: row.artifactCount,
  };
}

async function rpc(name: string, body: Record<string, unknown>) {
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "SOURCE_INVENTORY_STORE_NOT_CONFIGURED" };
  try {
    const response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false as const, code: "SOURCE_INVENTORY_STORE_FAILED" };
    }
    return { ok: true as const, value: await response.json().catch(() => null) as unknown };
  } catch {
    return { ok: false as const, code: "SOURCE_INVENTORY_STORE_FAILED" };
  }
}

export async function readSourceDeletionInventoryCandidate(): Promise<
  { ok: true; candidate: SourceDeletionInventoryCandidate | null } | { ok: false; code: string }
> {
  const result = await rpc("source_deletion_inventory_candidate", {});
  if (!result.ok) return result;
  if (result.value === null) return { ok: true, candidate: null };
  const parsed = candidate(result.value);
  return parsed
    ? { ok: true, candidate: parsed }
    : { ok: false, code: "SOURCE_INVENTORY_CANDIDATE_INVALID" };
}

export async function recordSourceDeletionInventoryAttestation(
  deletionId: string,
  objects: readonly SourceInventoryHashedObject[],
): Promise<
  { ok: true; attestation: SourceDeletionInventoryAttestation } | { ok: false; code: string }
> {
  if (!SHA256.test(deletionId) || objects.length > 512) {
    return { ok: false, code: "SOURCE_INVENTORY_ATTESTATION_INVALID" };
  }
  const result = await rpc("attest_source_deletion_inventory", {
    p_deletion_id: deletionId,
    p_objects: objects.map((object) => ({
      key: object.key,
      sha256: object.sha256,
      sizeBytes: object.sizeBytes,
    })),
  });
  if (!result.ok) return result;
  const parsed = attestation(result.value);
  return parsed
    ? { ok: true, attestation: parsed }
    : { ok: false, code: "SOURCE_INVENTORY_ATTESTATION_INVALID" };
}

import { createHash } from "node:crypto";
import { foundationWorkspaceId } from "./foundation-pilot";
import { deleteFounderResetObject, founderResetPrefixes, listFounderResetObjects, readR2SignerEnv } from "./r2-synthetic-canary";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { FOUNDER_TEST_RESET_EMAIL } from "./founder-test-reset-contract";

export { FOUNDER_TEST_RESET_EMAIL } from "./founder-test-reset-contract";

type PreparedReset = { resetId: string; dbManifestDigest: string; dbCounts: Record<string, number> };
type ActiveReset = PreparedReset & { state: "sealed" | "db_finalized_pending_object_verify"; manifestDigest: string; r2Keys: string[] };
type ResetManifest = PreparedReset & {
  schemaVersion: "tavonel.founder_test_reset_manifest.v1";
  workspaceKey: string;
  prefixes: readonly string[];
  r2Keys: string[];
};

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function manifestDigest(manifest: ResetManifest) {
  return digest({ schemaVersion: manifest.schemaVersion, workspaceKey: manifest.workspaceKey,
    prefixes: manifest.prefixes, r2Keys: manifest.r2Keys,
    dbManifestDigest: manifest.dbManifestDigest, dbCounts: manifest.dbCounts });
}

async function rpc(name: string, body: Record<string, unknown>) {
  const config = readSupabaseAdminConfig();
  if (!config) throw new Error("FOUNDER_TEST_RESET_DB_NOT_CONFIGURED");
  const response = await supabaseAdminRequest(config, `/rest/v1/rpc/${name}`, {
    method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message?.match(/founder_test_reset_[a-z_]+/)?.[0]?.toUpperCase()
      ?? "FOUNDER_TEST_RESET_DB_FAILED");
  }
  return response.json() as Promise<Record<string, unknown>>;
}

function prepared(value: Record<string, unknown>): PreparedReset {
  if (typeof value.resetId !== "string" || typeof value.dbManifestDigest !== "string"
    || !value.dbCounts || typeof value.dbCounts !== "object" || Array.isArray(value.dbCounts)) {
    throw new Error("FOUNDER_TEST_RESET_DB_RESPONSE_INVALID");
  }
  return { resetId: value.resetId, dbManifestDigest: value.dbManifestDigest,
    dbCounts: value.dbCounts as Record<string, number> };
}

async function activeReset(workspaceKey: string, userId: string): Promise<ActiveReset | null> {
  const config = readSupabaseAdminConfig();
  if (!config) throw new Error("FOUNDER_TEST_RESET_DB_NOT_CONFIGURED");
  const query = new URLSearchParams({
    select: "reset_id,state,db_manifest_digest,db_counts,manifest_digest,r2_keys",
    workspace_key: `eq.${workspaceKey}`, user_id: `eq.${userId}`,
    state: "in.(sealed,db_finalized_pending_object_verify)", order: "prepared_at.desc", limit: "1",
  });
  const response = await supabaseAdminRequest(config, `/rest/v1/founder_test_reset_ledger?${query}`, {
    method: "GET", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("FOUNDER_TEST_RESET_DB_FAILED");
  const rows = await response.json() as Record<string, unknown>[];
  const row = rows[0];
  if (!row) return null;
  if ((row.state !== "sealed" && row.state !== "db_finalized_pending_object_verify")
    || typeof row.reset_id !== "string" || typeof row.db_manifest_digest !== "string"
    || typeof row.manifest_digest !== "string" || !row.db_counts || typeof row.db_counts !== "object"
    || !Array.isArray(row.r2_keys) || !row.r2_keys.every((key) => typeof key === "string")) {
    throw new Error("FOUNDER_TEST_RESET_DB_RESPONSE_INVALID");
  }
  return { resetId: row.reset_id, state: row.state, dbManifestDigest: row.db_manifest_digest,
    dbCounts: row.db_counts as Record<string, number>, manifestDigest: row.manifest_digest,
    r2Keys: row.r2_keys as string[] };
}

async function deleteWithRetry(
  signer: NonNullable<ReturnType<typeof readR2SignerEnv>>, workspaceKey: string, key: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await deleteFounderResetObject(signer, workspaceKey, key);
    if (result.ok) return;
    const status = result.status;
    const retryable = status === 0 || status === 429 || (typeof status === "number" && status >= 500);
    if (!retryable || attempt === 2) {
      if (typeof status === "number") console.error("founder reset R2 delete failed", {
        status, providerCode: result.providerCode ?? null,
      });
      throw new Error(typeof status === "number" ? `SOURCE_DELETE_FAILED_HTTP_${status}` : result.code);
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
  }
}

async function drainFounderResetObjects(
  signer: NonNullable<ReturnType<typeof readR2SignerEnv>>, workspaceKey: string,
  sealedKeys: readonly string[], deleted: Set<string>,
) {
  const sealed = new Set(sealedKeys);
  for (let pass = 0; pass < 5; pass += 1) {
    const listed = await listFounderResetObjects(signer, workspaceKey);
    if (!listed.ok) throw new Error(listed.code);
    if (listed.keys.some((key) => !sealed.has(key))) {
      throw new Error("FOUNDER_TEST_RESET_R2_MANIFEST_DRIFT");
    }
    const remaining = listed.keys.filter((key) => sealed.has(key));
    if (remaining.length === 0) return;
    for (let offset = 0; offset < remaining.length; offset += 8) {
      const batch = remaining.slice(offset, offset + 8);
      await Promise.all(batch.map((key) => deleteWithRetry(signer, workspaceKey, key)));
      batch.forEach((key) => deleted.add(key));
    }
  }
  throw new Error("RESET_OBJECTS_REMAIN_AFTER_DELETE");
}

export async function prepareFounderTestReset(user: { id: string; email?: string | null }) {
  const email = user.email?.trim().toLowerCase() ?? "";
  if (email !== FOUNDER_TEST_RESET_EMAIL) throw new Error("FOUNDER_TEST_RESET_ACCOUNT_FORBIDDEN");
  const workspaceKey = foundationWorkspaceId(user.id);
  const prefixes = founderResetPrefixes(workspaceKey);
  const signer = readR2SignerEnv();
  if (!prefixes || !signer) throw new Error("FOUNDER_TEST_RESET_R2_NOT_CONFIGURED");
  const active = await activeReset(workspaceKey, user.id);
  if (active) {
    const listed = await listFounderResetObjects(signer, workspaceKey);
    if (!listed.ok) throw new Error(listed.code);
    const sealed = new Set(active.r2Keys);
    if (listed.keys.some((key) => !sealed.has(key))) throw new Error("FOUNDER_TEST_RESET_R2_MANIFEST_DRIFT");
    return { resetId: active.resetId, manifestDigest: active.manifestDigest, resumable: true,
      manifest: { dbCounts: active.dbCounts, objectCount: active.r2Keys.length,
        remainingObjectCount: listed.keys.length } };
  }
  const db = prepared(await rpc("prepare_founder_test_reset", {
    p_email: email, p_user_id: user.id, p_workspace_key: workspaceKey,
  }));
  const listed = await listFounderResetObjects(signer, workspaceKey);
  if (!listed.ok) throw new Error(listed.code);
  const manifest: ResetManifest = { schemaVersion: "tavonel.founder_test_reset_manifest.v1",
    workspaceKey, prefixes, r2Keys: listed.keys, ...db };
  return { resetId: manifest.resetId, manifestDigest: manifestDigest(manifest), resumable: false,
    manifest: { dbCounts: manifest.dbCounts, objectCount: manifest.r2Keys.length,
      remainingObjectCount: manifest.r2Keys.length } };
}

export async function executeFounderTestReset(
  user: { id: string; email?: string | null }, resetId: string, expectedDigest: string,
) {
  if (!/^[0-9a-f-]{36}$/i.test(resetId) || !/^sha256:[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error("FOUNDER_TEST_RESET_DIGEST_REQUIRED");
  }
  const email = user.email?.trim().toLowerCase() ?? "";
  if (email !== FOUNDER_TEST_RESET_EMAIL) throw new Error("FOUNDER_TEST_RESET_ACCOUNT_FORBIDDEN");
  const workspaceKey = foundationWorkspaceId(user.id);
  const prefixes = founderResetPrefixes(workspaceKey);
  if (!prefixes) throw new Error("FOUNDER_TEST_RESET_R2_NOT_CONFIGURED");
  const row = await rpc("inspect_founder_test_reset", {
    p_reset_id: resetId, p_email: email, p_user_id: user.id, p_workspace_key: workspaceKey,
  });
  const db = prepared(row);
  const state = row.state;
  let r2Keys: string[];
  if (state === "prepared") {
    const signer = readR2SignerEnv();
    if (!signer) throw new Error("FOUNDER_TEST_RESET_R2_NOT_CONFIGURED");
    const listed = await listFounderResetObjects(signer, workspaceKey);
    if (!listed.ok) throw new Error(listed.code);
    r2Keys = listed.keys;
  } else if ((state === "sealed" || state === "db_finalized_pending_object_verify" || state === "completed")
    && Array.isArray(row.r2Keys)
    && row.r2Keys.every((key) => typeof key === "string")) {
    r2Keys = row.r2Keys as string[];
  } else throw new Error("FOUNDER_TEST_RESET_DB_RESPONSE_INVALID");
  const manifest: ResetManifest = { schemaVersion: "tavonel.founder_test_reset_manifest.v1",
    workspaceKey, prefixes, r2Keys, ...db };
  if (manifestDigest(manifest) !== expectedDigest || (state !== "prepared" && row.manifestDigest !== expectedDigest)) {
    throw new Error("FOUNDER_TEST_RESET_MANIFEST_CHANGED");
  }
  let phase = state;
  if (phase === "prepared") {
    await rpc("seal_founder_test_reset", {
    p_reset_id: resetId, p_email: FOUNDER_TEST_RESET_EMAIL, p_user_id: user.id,
    p_workspace_key: workspaceKey, p_db_manifest_digest: db.dbManifestDigest,
    p_manifest_digest: expectedDigest, p_r2_keys: r2Keys,
    });
    phase = "sealed";
  }
  const signer = readR2SignerEnv();
  if (!signer) throw new Error("FOUNDER_TEST_RESET_R2_NOT_CONFIGURED");
  const deleted = new Set<string>();
  if (phase === "sealed") {
    await drainFounderResetObjects(signer, workspaceKey, r2Keys, deleted);
    await rpc("finalize_founder_test_reset", {
      p_reset_id: resetId, p_email: FOUNDER_TEST_RESET_EMAIL, p_user_id: user.id,
      p_workspace_key: workspaceKey, p_manifest_digest: expectedDigest,
    });
    phase = "db_finalized_pending_object_verify";
  }
  for (let verification = 0; verification < 5; verification += 1) {
    if (phase === "completed") {
      const afterCompletion = await listFounderResetObjects(signer, workspaceKey);
      if (!afterCompletion.ok) throw new Error(afterCompletion.code);
      if (afterCompletion.keys.some((key) => !new Set(r2Keys).has(key))) {
        throw new Error("FOUNDER_TEST_RESET_R2_MANIFEST_DRIFT");
      }
      if (afterCompletion.keys.length === 0) {
        return { resetId, workspaceKey, deletedObjectCount: deleted.size, dbCounts: db.dbCounts };
      }
      throw new Error("RESET_OBJECTS_REAPPEARED_AFTER_FINALIZE");
    }
    await drainFounderResetObjects(signer, workspaceKey, r2Keys, deleted);
    await rpc("complete_founder_test_reset", {
      p_reset_id: resetId, p_email: FOUNDER_TEST_RESET_EMAIL, p_user_id: user.id,
      p_workspace_key: workspaceKey, p_manifest_digest: expectedDigest,
    });
    phase = "completed";
  }
  throw new Error("RESET_OBJECTS_REAPPEARED_AFTER_FINALIZE");
}

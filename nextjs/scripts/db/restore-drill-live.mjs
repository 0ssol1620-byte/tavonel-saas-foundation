/**
 * The half of the restore drill that talks to R2.
 *
 * Imported lazily by `restore-drill.mjs`, only after every required variable is present, so a dry
 * run and the unit tests never load a module that can write to a bucket.
 *
 * `databaseBackupAvailability` is the field this file exists to be honest about. Cloudflare R2
 * and Supabase are different platforms with different backup stories, and nothing in this
 * repository can observe the latter without an operator token. Absent the token the answer is the
 * literal string "not verified"; present, the answer is whatever the platform said, including
 * "unavailable".
 */
import { readR2SignerEnv, syntheticNamespace, FOUNDATION_R2_BUCKET } from "../../lib/r2-synthetic-canary.ts";

export function createLiveRestoreOps(env) {
  const signer = readR2SignerEnv(env);
  if (!signer) return { ok: false, code: "RESTORE_R2_NOT_CONFIGURED", missing: ["R2_*"] };
  if (signer.bucket !== FOUNDATION_R2_BUCKET) {
    return { ok: false, code: "RESTORE_BUCKET_NOT_FOUNDATION", missing: ["R2_BUCKET"] };
  }
  const namespace = syntheticNamespace(signer);
  const token = (env.TAVONEL_OPERATOR_API_TOKEN ?? "").trim();

  return {
    ok: true,
    ops: {
      async now() {
        return new Date();
      },
      put: (key, body) => namespace.put(key, body),
      read: (key) => namespace.read(key),
      list: (prefix) => namespace.list(prefix),
      async cleanup(plan) {
        for (const key of [plan.restoredKey, plan.sourceKey]) {
          const removed = await namespace.remove(key);
          if (!removed.ok) return removed;
        }
        return { ok: true };
      },
      async databaseBackupAvailability() {
        const operatorId = env.TAVONEL_DRILL_OPERATOR.trim();
        if (!token) {
          return { ok: true, operatorId, bucket: signer.bucket, availability: "not verified" };
        }
        // An operator token is permission to ask, not an answer. Whoever wires a platform backup
        // API here records what it returned; until then the honest answer with a token present is
        // still that nobody asked, and it is spelled differently so the two cannot be confused.
        return {
          ok: true,
          operatorId,
          bucket: signer.bucket,
          availability: "not verified (no backup API wired)",
        };
      },
    },
  };
}

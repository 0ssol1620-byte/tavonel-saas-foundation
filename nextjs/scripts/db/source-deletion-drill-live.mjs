/**
 * The half of the deletion drill that talks to R2 and PostgREST.
 *
 * Split out so the dry run, the unit tests and `npx tsc --noEmit` never import a module whose
 * only purpose is to perform irreversible work. `source-deletion-drill.mjs` imports this lazily,
 * after it has confirmed every required variable is present, so a machine with no credentials
 * cannot reach this file at all.
 *
 * Every operation here delegates to the module production already uses. Nothing is reimplemented:
 * a drill that runs its own private copy of the sweeper measures the copy.
 */
import { readSupabaseAdminConfig, supabaseAdminRequest } from "../../lib/supabase-admin.ts";
import {
  deleteFoundationSourceObject,
  inspectFoundationSourceObject,
  listFounderResetObjects,
  putFoundationProbeObject,
  readR2SignerEnv,
} from "../../lib/r2-synthetic-canary.ts";
import { runSourceDeletionInventoryAttestation } from "../../lib/source-deletion-inventory.ts";
import { runSourceDeletionSweep } from "../../lib/source-deletion-sweeper.ts";
import { createSourceDeletionSweepStore } from "../../lib/source-deletion-store.ts";

const failed = (code) => ({ ok: false, code });

export function createLiveDrillOps(env) {
  const signer = readR2SignerEnv(env);
  const config = readSupabaseAdminConfig(env);
  const actor = env.TAVONEL_DRILL_ACTOR_USER_ID.trim();

  async function rest(path, init = {}) {
    if (!config) return failed("DRILL_SUPABASE_NOT_CONFIGURED");
    try {
      const response = await supabaseAdminRequest(config, path, {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return failed(`DRILL_REST_${response.status}`);
      }
      const text = await response.text();
      return { ok: true, value: text ? JSON.parse(text) : null };
    } catch {
      return failed("DRILL_REST_FAILED");
    }
  }

  const insert = (table, rows) =>
    rest(`/rest/v1/${table}`, { method: "POST", body: JSON.stringify(rows) });
  const rpc = (name, args) =>
    rest(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  const count = async (table, query) => {
    const result = await rest(`/rest/v1/${table}?${query}&select=*`);
    return result.ok ? { ok: true, value: Array.isArray(result.value) ? result.value.length : 0 } : result;
  };

  return {
    async now() {
      return new Date();
    },

    async listWorkspaceObjects(workspaceKey) {
      if (!signer) return failed("DRILL_R2_NOT_CONFIGURED");
      return listFounderResetObjects(signer, workspaceKey);
    },

    async provision(plan) {
      if (!signer) return failed("DRILL_R2_NOT_CONFIGURED");
      const organizationId = crypto.randomUUID();
      const steps = [
        () =>
          insert("enterprise_organizations", {
            organization_id: organizationId,
            name: `TAVONEL deletion drill ${plan.workspaceKey}`,
            slug: plan.organizationSlug,
            created_by: actor,
          }),
        () =>
          insert("enterprise_workspaces", {
            workspace_key: plan.workspaceKey,
            organization_id: organizationId,
            display_name: "Deletion drill probe",
          }),
        // deleted_object_grace_days 0 is what makes the tombstone eligible immediately. It is set
        // on this drill's own organization and nowhere else; the drill re-reads it before it
        // requests anything, so a policy default that overrode it would stop the run.
        () =>
          insert("enterprise_governance_policies", {
            organization_id: organizationId,
            deleted_object_grace_days: 0,
            legal_hold_enabled: false,
            updated_by: actor,
          }),
        () =>
          insert("foundation_oauth_connections", {
            oauth_connection_id: plan.oauthConnectionId,
            workspace_key: plan.workspaceKey,
            provider: plan.provider,
            display_name: "Deletion drill probe",
            provider_account_id: `drill-${plan.workspaceKey}`,
            granted_scopes: ["drive.readonly"],
            // Deliberately dangling. The broker holds no secret under these names, which is the
            // point: the connection exists to satisfy the deletion RPC's identity check and must
            // never be usable to fetch anything.
            client_secret_reference: `vault://tavonel/drill/${plan.workspaceKey}/client`,
            refresh_token_reference: `vault://tavonel/drill/${plan.workspaceKey}/refresh`,
            created_by: actor,
            updated_by: actor,
          }),
      ];
      for (const run of steps) {
        const result = await run();
        if (!result.ok) return result;
      }

      for (const [index, documentId] of plan.documentIds.entries()) {
        const object = plan.objects.find((candidate) =>
          candidate.key === `quarantine/${plan.workspaceKey}/${documentId}/source`);
        if (!object) return failed("DRILL_PLAN_MISSING_QUARANTINE_OBJECT");
        const bound = await insert("connector_document_bindings", {
          source_version_id: `sv-${object.sha256.slice("sha256:".length)}`,
          source_id: plan.sourceId,
          workspace_key: plan.workspaceKey,
          oauth_connection_id: plan.oauthConnectionId,
          provider: plan.provider,
          native_id: `drill-native-${index}`,
          provider_revision: "drill-rev-1",
          document_id: documentId,
          content_sha256: object.sha256,
          byte_length: object.sizeBytes,
          mime_type: "text/plain",
        });
        if (!bound.ok) return bound;
      }

      // Revoked the moment the bindings exist. request_connector_source_deletion checks the
      // connection's workspace and provider but not its status, so the drill's connection can be
      // dead to every sync worker and still satisfy the deletion precondition.
      const revoked = await rest(
        `/rest/v1/foundation_oauth_connections?oauth_connection_id=eq.${plan.oauthConnectionId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "revoked", revoked_at: new Date().toISOString() }),
        },
      );
      if (!revoked.ok) return revoked;

      for (const object of plan.objects) {
        const put = await putFoundationProbeObject(signer, plan.workspaceKey, object.key, object.body);
        if (!put.ok) return put;
      }
      return { ok: true };
    },

    async graceDays(workspaceKey) {
      const workspace = await rest(
        `/rest/v1/enterprise_workspaces?workspace_key=eq.${workspaceKey}&select=organization_id`,
      );
      if (!workspace.ok) return workspace;
      const organizationId = workspace.value?.[0]?.organization_id;
      if (!organizationId) return failed("DRILL_WORKSPACE_MISSING");
      const policy = await rest(
        `/rest/v1/enterprise_governance_policies?organization_id=eq.${organizationId}&select=deleted_object_grace_days,legal_hold_enabled`,
      );
      if (!policy.ok) return policy;
      const row = policy.value?.[0];
      if (!row || row.legal_hold_enabled !== false) return failed("DRILL_POLICY_UNUSABLE");
      return { ok: true, days: row.deleted_object_grace_days };
    },

    async requestDeletion(plan) {
      const result = await rpc("request_connector_source_deletion", {
        p_workspace_key: plan.workspaceKey,
        p_source_id: plan.sourceId,
        p_oauth_connection_id: plan.oauthConnectionId,
        p_provider: plan.provider,
        p_reason: "provider_deleted",
      });
      if (!result.ok) return result;
      const value = result.value ?? {};
      return {
        ok: true,
        status: value.status,
        deletionId: value.deletionId,
        eligibleAt: value.eligibleAt,
      };
    },

    attest: () => runSourceDeletionInventoryAttestation(),

    async sweepOnce() {
      if (!signer) return failed("DRILL_R2_NOT_CONFIGURED");
      return runSourceDeletionSweep({
        store: createSourceDeletionSweepStore(),
        inspectObject: (candidate) =>
          inspectFoundationSourceObject(signer, candidate.workspaceKey, candidate.objectKey),
        deleteObject: (candidate) =>
          deleteFoundationSourceObject(signer, candidate.workspaceKey, candidate.objectKey),
      });
    },

    async sweepStatus() {
      const result = await rpc("source_deletion_sweep_status", {});
      if (!result.ok) return result;
      const incomplete = result.value?.inventoryIncomplete;
      return typeof incomplete === "boolean"
        ? { ok: true, inventoryIncomplete: incomplete }
        : failed("DRILL_SWEEP_STATUS_INVALID");
    },

    async dbCounts(plan) {
      const scope = `workspace_key=eq.${plan.workspaceKey}`;
      const reads = await Promise.all([
        count("source_deletion_objects", scope),
        count("source_deletion_objects", `${scope}&purged_at=not.is.null`),
        count("source_deletion_inventory_attestations", scope),
        count("source_deletion_receipts", `${scope}&action=eq.object_purged`),
        count("source_deletion_receipts", `${scope}&action=eq.tombstoned`),
      ]);
      const broken = reads.find((read) => !read.ok);
      if (broken) return broken;
      const [objects, purged, attestations, purgeReceipts, tombstoneReceipts] = reads.map((r) => r.value);
      return { ok: true, objects, purged, attestations, purgeReceipts, tombstoneReceipts };
    },

    async backupExpiry() {
      return {
        ok: true,
        operatorId: env.TAVONEL_DRILL_OPERATOR.trim(),
        recordedAt: env.TAVONEL_DRILL_BACKUP_EXPIRY.trim(),
      };
    },
  };
}

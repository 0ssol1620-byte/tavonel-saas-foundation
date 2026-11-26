import { INTAKE_APPROVAL_ROLLOUT_ENABLED } from "./intake-approval-rollout";

/**
 * Dropbox path reconciliation, switched apart from the upload-approval lineage (WO-E-CON-1, lead
 * decision E-2).
 *
 * Reconciliation is reconcile_dropbox_source_page (migration 20261007100000): a DeletedMetadata
 * names a path and no id, so the removal is resolved to the id last observed at that path and
 * waits for the listing boundary -- a move split across pages keeps its source. Off, Dropbox runs
 * main dbe22b1e's path: the adapter maps a DeletedMetadata's path_lower to its nativeId and the
 * worker suspends it by that id at once.
 *
 * Until now the only way to reach reconciliation was the whole-set upload-approval switch
 * (lib/intake-approval-rollout.ts), which also changes every upload route. This switch turns on
 * Dropbox reconciliation alone; uploads keep reading INTAKE_APPROVAL_ROLLOUT_ENABLED and nothing
 * else. The implication the other way is kept: the approval lineage's migration set includes
 * 20261007100000, and "approval on, reconciliation off" is a state that has never shipped or been
 * tested, so turning the lineage on still turns reconciliation on.
 *
 * Code-owned, reads no environment: turning it on is a reviewed code change shipped after
 * migration 20261007100000 is applied in production. Without the migration the sync fails closed
 * as DROPBOX_SOURCE_RECONCILIATION_MIGRATION_MISSING and retries with its checkpoint unmoved.
 *
 * A function rather than a derived constant so every Dropbox read of the decision -- the adapter's
 * mapping and the worker's two branches -- sees the same answer at the moment it is read.
 */
export const DROPBOX_RECONCILIATION_SWITCH = false;

export function dropboxReconciliationEnabled(): boolean {
  return DROPBOX_RECONCILIATION_SWITCH || INTAKE_APPROVAL_ROLLOUT_ENABLED;
}

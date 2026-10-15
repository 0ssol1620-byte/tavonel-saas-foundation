import { INTAKE_TRIAGE_ROLLOUT_ENABLED } from "./intake-triage-rollout";

/**
 * Coordinated rollout switch for the whole-set intake approval lineage: the tables and RPCs of
 * supabase/migrations 20261003120000, 20261003130000 and 20261004100000
 * (docs/runbooks/INTAKE_APPROVAL_MIGRATIONS.md).
 *
 * Off -- the production default: upload capability, confirm, release and compile run main's
 * per-file path (reserve_foundation_compute_v3, confirm_foundation_intake_admission,
 * settle_foundation_compute_v3) and call no approval RPC, so they work against a database those
 * migrations have not reached. The approval routes answer INTAKE_APPROVAL_DISABLED.
 *
 * On: an upload must reference a whole-set approval, and an approval function the database does
 * not have fails closed as INTAKE_APPROVAL_LINEAGE_UNAVAILABLE.
 *
 * Code-owned like the triage switch: it reads no environment, so turning it on is a reviewed code
 * change shipped after the founder approves and runs the production apply. Triage is built on
 * approvals, so enabling triage enables this lineage too.
 */
const APPROVAL_LINEAGE_SWITCH = false;

export const INTAKE_APPROVAL_ROLLOUT_ENABLED: boolean = APPROVAL_LINEAGE_SWITCH || INTAKE_TRIAGE_ROLLOUT_ENABLED;

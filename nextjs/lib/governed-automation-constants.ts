/*
  Governed automation: the shared vocabulary of ADR docs/adr/0010-governed-automation.md (WO-B-00, merged
  with WO-KS-0). Every later work order of the approval policy, the steward, standing approvals, Skills and
  the Knowledge Steward reads its names, lists and start values from here, and every migration's text test
  compares its CHECK lists with the lists below. The pure check at the end (world transition input, ADR
  §10.1) is the one parser every executor and route of an Active-changing proposal uses.

  This module depends on nothing at all (a source test pins it), so a client panel can read it without
  pulling in a Node built-in. Lists, numbers and pure checks only: no secret, no flag value, no copy shown to
  customers, no I/O.

  Every number here is a start value, uncalibrated: chosen for v1, not measured.
*/

// ---------------------------------------------------------------------------------------------------------
// Migration slots (ADR §6.1). The lead assigns timestamps at merge; the order below is binding.
// "existing" is what 20261117130000_agent_proposals.sql already holds at the base head.
// ---------------------------------------------------------------------------------------------------------

export const GOVERNED_MIGRATION_ORDER = ["existing", "B-01", "B-02", "KS-1", "B-03"] as const;
export type GovernedMigrationSlot = (typeof GOVERNED_MIGRATION_ORDER)[number];

/** True when `slot` is applied at or before `through` in the binding order. An unknown slot is refused, never ordered. */
export function appliedThrough(slot: GovernedMigrationSlot, through: GovernedMigrationSlot): boolean {
  const at = GOVERNED_MIGRATION_ORDER.indexOf(slot);
  const until = GOVERNED_MIGRATION_ORDER.indexOf(through);
  if (at < 0 || until < 0) throw new TypeError("unknown migration slot");
  return at <= until;
}

// ---------------------------------------------------------------------------------------------------------
// Action types, risk tiers, bindings, proposers (ADR §2)
// ---------------------------------------------------------------------------------------------------------

export const GOVERNED_ACTION_TYPES = [
  "library_label", "compile_plan", "ontology_label_patch", "world_activation", "world_rollback", "competency_questions_set", "ontology_patch",
] as const;
export type GovernedActionType = (typeof GOVERNED_ACTION_TYPES)[number];

/** Which migration adds the type to world_change_proposals_action_type_check. */
export const ACTION_TYPE_INTRODUCED_BY: Readonly<Record<GovernedActionType, GovernedMigrationSlot>> = {
  library_label: "existing", compile_plan: "existing", ontology_label_patch: "existing",
  world_activation: "B-01", world_rollback: "B-01", competency_questions_set: "KS-1", ontology_patch: "KS-1",
};

/** The action types a CHECK holds once `through` is applied, in GOVERNED_ACTION_TYPES order. */
export function actionTypesThrough(through: GovernedMigrationSlot): GovernedActionType[] {
  return GOVERNED_ACTION_TYPES.filter((type) => appliedThrough(ACTION_TYPE_INTRODUCED_BY[type], through));
}

/**
 * R0 read: no confirmation. R1 candidate-only: a person confirms; Active never changes. R2 Active-changing:
 * a person confirms; never a standing rule, never a steward. R3 external side effect, money or deletion: no
 * action type of that tier exists and none may be added under this ADR.
 */
export const RISK_TIERS = ["R0", "R1", "R2", "R3"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const ACTION_RISK_TIER: Readonly<Record<GovernedActionType, RiskTier>> = {
  library_label: "R1", compile_plan: "R1", ontology_label_patch: "R1", competency_questions_set: "R1", ontology_patch: "R1",
  world_activation: "R2", world_rollback: "R2",
};

export const BINDING_KINDS = ["active_manifest", "source_inventory", "correction_leaf", "question_set"] as const;
export type BindingKind = (typeof BINDING_KINDS)[number];

/** world_change_proposals_binding_pairing_check, one pair per action type. */
export const ACTION_BINDING_KIND: Readonly<Record<GovernedActionType, BindingKind>> = {
  library_label: "active_manifest", compile_plan: "source_inventory", ontology_label_patch: "correction_leaf",
  world_activation: "active_manifest", world_rollback: "active_manifest", competency_questions_set: "question_set",
  ontology_patch: "correction_leaf",
};

/**
 * The binding digest of a world_activation proposal (and of a question set) when the collection has no
 * Active World / no live set: every binding column and RPC parameter is `^sha256:[a-f0-9]{64}$`, so "none"
 * is this fixed value, never a null and never a made-up digest of something.
 */
export const NO_BINDING_DIGEST = `sha256:${"0".repeat(64)}`;

export const PRINCIPAL_KINDS = ["session", "steward", "agent"] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

/**
 * Who may create a proposal of each type, as the B-01/KS-1 CHECKs hold it. world_activation is session-only
 * until WO-AN-21 adds the passkey step-up and widens this one row to session + agent in its own migration.
 */
export const ACTION_PROPOSER_KINDS: Readonly<Record<GovernedActionType, readonly PrincipalKind[]>> = {
  library_label: ["session", "agent"],
  compile_plan: ["session", "steward", "agent"],
  ontology_label_patch: ["session", "agent"],
  world_activation: ["session"],
  world_rollback: ["session"],
  competency_questions_set: ["session", "agent"],
  ontology_patch: ["session", "agent"],
};

/** Server-derived idempotency key namespaces. A person's key never starts with one of these. */
export const RESERVED_IDEMPOTENCY_PREFIXES = ["agt_", "stw_", "skl_"] as const;

// ---------------------------------------------------------------------------------------------------------
// Approval policy (ADR §3)
// ---------------------------------------------------------------------------------------------------------

export const APPROVER_ROLES = ["member", "admin", "owner"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

/** Rank for "at least": member < admin < owner. */
export const APPROVER_ROLE_RANK: Readonly<Record<ApproverRole, number>> = { member: 1, admin: 2, owner: 3 };

export type ApprovalPolicyValue = Readonly<{ minRole: ApproverRole; distinctApprover: boolean }>;

/**
 * The policy when no row exists = today's behaviour. world_activation is `admin`, not `member`, because the
 * activation RPC (transition_foundation_world_atomic, 20260920120000) refuses any actor below admin: a lower
 * default would let a member confirm a proposal that can only fail.
 */
export const DEFAULT_APPROVAL_POLICY: Readonly<Record<GovernedActionType, ApprovalPolicyValue>> = {
  library_label: { minRole: "member", distinctApprover: false },
  compile_plan: { minRole: "member", distinctApprover: false },
  ontology_label_patch: { minRole: "member", distinctApprover: false },
  competency_questions_set: { minRole: "member", distinctApprover: false },
  ontology_patch: { minRole: "member", distinctApprover: false },
  world_activation: { minRole: "admin", distinctApprover: false },
  world_rollback: { minRole: "admin", distinctApprover: false },
};

/** The lowest role a policy row may name for the type (a row may tighten, never loosen below today). */
export const APPROVAL_POLICY_FLOOR: Readonly<Record<GovernedActionType, ApproverRole>> = {
  library_label: "member", compile_plan: "member", ontology_label_patch: "member",
  competency_questions_set: "member", ontology_patch: "member", world_activation: "admin", world_rollback: "admin",
};

/** Who may write the policy row of each type. */
export const POLICY_SETTER_MIN_ROLE: Readonly<Record<GovernedActionType, ApproverRole>> = {
  library_label: "admin", compile_plan: "admin", ontology_label_patch: "admin",
  competency_questions_set: "admin", ontology_patch: "admin", world_activation: "owner", world_rollback: "owner",
};

/**
 * The policy row that decides each type (ADR §3, B4). Every Active change -- forward or back -- is decided by
 * the one `world_activation` row: a separate rollback row would let a four-eyes activation policy be walked
 * around by a one-person rollback. A type read through another key has that key's default, floor and setter
 * (source test), so it decides exactly as the key does.
 */
export const APPROVAL_POLICY_KEY: Readonly<Record<GovernedActionType, GovernedActionType>> = {
  library_label: "library_label", compile_plan: "compile_plan", ontology_label_patch: "ontology_label_patch",
  world_activation: "world_activation", world_rollback: "world_activation",
  competency_questions_set: "competency_questions_set", ontology_patch: "ontology_patch",
};

/** The action types foundation_approval_policies.action_type's CHECK holds once `through` is applied: the keys only. */
export function policyActionTypesThrough(through: GovernedMigrationSlot): GovernedActionType[] {
  return actionTypesThrough(through).filter((type) => APPROVAL_POLICY_KEY[type] === type);
}

/** An absent policy row reads as this revision; every stored row is >= 1. */
export const ABSENT_POLICY_REVISION = 0;

// ---------------------------------------------------------------------------------------------------------
// Standing approvals (ADR §4)
// ---------------------------------------------------------------------------------------------------------

/** The only action type a standing rule may confirm, and only for steward-origin proposals. */
export const STANDING_RULE_ACTION_TYPES = ["compile_plan"] as const satisfies readonly GovernedActionType[];
export const STANDING_RULE_MATCHED_PRINCIPALS = ["steward"] as const satisfies readonly PrincipalKind[];
export const STANDING_RULE_PERIODS = ["month"] as const;
export const STANDING_RULE_STATES = ["active", "exhausted", "expired", "revoked"] as const;
export const STANDING_RULE_CREDIT_CAP_MAX = 100_000;
export const STANDING_RULE_MAX_LIFETIME_DAYS = 90;
export const STANDING_RULE_SCOPE_MAX_COLLECTIONS = 50;
export const STANDING_RULE_SCOPE_MAX_DOCUMENTS = 128;
export const STANDING_RULE_SCOPE_MAX_BYTES = 4_096;

// ---------------------------------------------------------------------------------------------------------
// Steward items (ADR §5)
// ---------------------------------------------------------------------------------------------------------

export const STEWARD_ITEM_KINDS = [
  "candidate_awaiting_activation", "source_revised", "source_access_lost", "extraction_held", "active_conflict", "proposal_waiting",
] as const;
export type StewardItemKind = (typeof STEWARD_ITEM_KINDS)[number];

/** Categorical order, most urgent first. No numeric score exists anywhere. */
export const STEWARD_PRIORITY_CLASSES = ["critical", "important", "actionable", "info"] as const;
export type StewardPriorityClass = (typeof STEWARD_PRIORITY_CLASSES)[number];

export const STEWARD_ITEM_PRIORITY: Readonly<Record<StewardItemKind, StewardPriorityClass>> = {
  source_access_lost: "critical", source_revised: "important", extraction_held: "important", active_conflict: "important",
  candidate_awaiting_activation: "actionable", proposal_waiting: "info",
};

/** The dedupe key's prefix per kind; the rest is ids only (never a title). */
export const STEWARD_DEDUPE_PREFIX: Readonly<Record<StewardItemKind, string>> = {
  candidate_awaiting_activation: "cand:", source_revised: "rev:", source_access_lost: "acl:",
  extraction_held: "held:", active_conflict: "conf:", proposal_waiting: "prop:",
};

/** The kinds that may produce a steward proposal; a conflict or a held extraction waits for a person. */
export const STEWARD_PROPOSING_KINDS = ["source_revised", "source_access_lost"] as const satisfies readonly StewardItemKind[];

export const STEWARD_ITEM_STATES = ["new", "acknowledged", "snoozed", "held", "resolved", "reopened"] as const;
export type StewardItemState = (typeof STEWARD_ITEM_STATES)[number];

/** What a signed-in person may do. `reopened` behaves as `new`. */
export const STEWARD_PERSON_TRANSITIONS: Readonly<Record<StewardItemState, readonly StewardItemState[]>> = {
  new: ["acknowledged", "snoozed", "held", "resolved"],
  reopened: ["acknowledged", "snoozed", "held", "resolved"],
  acknowledged: ["snoozed", "held", "resolved"],
  snoozed: ["acknowledged", "held", "resolved"],
  held: ["acknowledged", "resolved"],
  resolved: ["reopened"],
};

/** What only the sweep does: wake a snooze at snoozed_until; reopen a resolved item whose subject revision changed. */
export const STEWARD_SWEEP_TRANSITIONS: Readonly<Partial<Record<StewardItemState, readonly StewardItemState[]>>> = {
  snoozed: ["new"],
  resolved: ["reopened"],
};

export const STEWARD_SUBJECT_KEY = /^[A-Za-z0-9:._-]{1,200}$/;
export const STEWARD_FACTS_MAX_BYTES = 4_096;
export const STEWARD_RESOLUTION_NOTE_MAX = 500;
export const STEWARD_SNOOZE_DAYS = [1, 7] as const;
export const STEWARD_SWEEP_MAX_WORKSPACES = 20;
export const STEWARD_SWEEP_MAX_UPSERTS = 200;
export const STEWARD_PROPOSAL_WAITING_AFTER_HOURS = 24;
export const STEWARD_OPEN_PROPOSALS_PER_WORKSPACE = 100;
export const STEWARD_PAGE_MAX = 50;

// ---------------------------------------------------------------------------------------------------------
// Notifications and suggestion feedback (ADR §5.4)
// ---------------------------------------------------------------------------------------------------------

export const NOTIFICATION_MODES = ["immediate", "daily_digest", "weekly_review", "critical_only", "silent"] as const;
export const NOTIFICATION_EVENT_TYPES = [
  "world.candidate_awaiting_activation", "steward.item.created", "steward.item.reopened", "steward.item.resolved",
] as const;
export const NOTIFICATION_ENDPOINTS_PER_WORKSPACE = 10;
export const NOTIFICATION_URL_MAX = 2_048;
export const SUGGESTION_FEEDBACK_ACTIONS = ["accepted", "dismissed", "snoozed", "muted_topic"] as const;
export const AUTOPILOT_CARD_TYPES = ["first_value", "change", "gap", "connection", "cost", "automation"] as const;
export const AUTOPILOT_CARDS_MAX = 3;

// ---------------------------------------------------------------------------------------------------------
// Skills (ADR §7)
// ---------------------------------------------------------------------------------------------------------

export const SKILL_LIFECYCLE_STATES = ["draft", "shadow_tested", "approved", "superseded", "revoked"] as const;
export const SKILL_INSTALL_STATES = ["active", "paused", "revoked"] as const;
export const SKILL_RUN_STATES = ["running", "succeeded", "failed", "refused"] as const;
export const SKILL_RUN_PRINCIPAL_KINDS = ["session", "agent"] as const satisfies readonly PrincipalKind[];
export const SKILL_OPERATIONS = [
  "world.read_object", "world.diff_versions", "world.search", "evidence.get", "steward.list_items", "proposal.file",
] as const;
export const SKILL_PERMISSIONS = ["world:read", "evidence:read", "steward:read", "proposal:write"] as const;
/** The proposals a Skill run may file: R1 types a person confirms in Changes, never a Knowledge Steward type in v1. */
export const SKILL_FILABLE_ACTION_TYPES = ["compile_plan", "library_label", "ontology_label_patch"] as const satisfies readonly GovernedActionType[];
export const SKILL_NETWORK_VALUES = ["none"] as const;
export const SKILL_BUDGET_MAX = { steps: 20, timeoutMs: 20_000 } as const;
export const SKILL_MANIFEST_MAX_BYTES = 16_384;
export const SKILL_RUN_PROPOSALS_MAX = 8;

// ---------------------------------------------------------------------------------------------------------
// Knowledge Steward (ADR §8, workorders/knowledge-steward.md)
// ---------------------------------------------------------------------------------------------------------

export const COMPETENCY_QUESTIONS_MAX = 25;
export const COMPETENCY_QUESTION_TEXT = { min: 8, max: 300 } as const;
export const PURPOSE_STATEMENT_MAX = 300;
export const ONTOLOGY_PATCH_OPS = ["relabel", "add_object", "add_relation", "remove_relation", "retype"] as const;
export const ONTOLOGY_PATCH_OPS_MAX = 20;
export const ONTOLOGY_PATCH_EVIDENCE_PER_OP_MAX = 16;
/** world_change_proposals_input_check from KS-1 on (8,192 before). */
export const PROPOSAL_INPUT_MAX_BYTES_FROM_KS1 = 16_384;

// ---------------------------------------------------------------------------------------------------------
// Agent scopes and the consent rule (ADR §9). One scope = one consent sentence; a grant only ever sees tools
// whose sentence it was shown. A tool no shown sentence covers gets a new scope, never a new meaning for an
// old one.
// ---------------------------------------------------------------------------------------------------------

export const AGENT_SCOPE_PLAN = [
  { scope: "agent:read", introducedBy: "existing", optional: false, ratePerMinute: 120 },
  { scope: "agent:propose", introducedBy: "existing", optional: false, ratePerMinute: 10 },
  { scope: "agent:brief", introducedBy: "B-02", optional: true, ratePerMinute: 120 },
  { scope: "agent:steward", introducedBy: "KS-1", optional: true, ratePerMinute: 60 },
  { scope: "agent:skills", introducedBy: "B-03", optional: true, ratePerMinute: 30 },
] as const satisfies ReadonlyArray<Readonly<{ scope: string; introducedBy: GovernedMigrationSlot; optional: boolean; ratePerMinute: number }>>;
export type PlannedAgentScope = (typeof AGENT_SCOPE_PLAN)[number]["scope"];

/** The agent scope list the scope CHECK and the rate-limit RPC hold once `through` is applied. */
export function agentScopesThrough(through: GovernedMigrationSlot): PlannedAgentScope[] {
  return AGENT_SCOPE_PLAN.filter((row) => appliedThrough(row.introducedBy, through)).map((row) => row.scope);
}

/** Which proposal types an agent may file, and under which scope. world_activation waits for WO-AN-21. */
export const AGENT_PROPOSABLE: Readonly<Partial<Record<GovernedActionType, PlannedAgentScope>>> = {
  compile_plan: "agent:propose", library_label: "agent:propose", ontology_label_patch: "agent:propose",
  competency_questions_set: "agent:steward", ontology_patch: "agent:steward",
};

// ---------------------------------------------------------------------------------------------------------
// Flags (ADR §2.3). House style: exactly "true" is on; a cohort is a comma list of exact workspace keys.
// No flag here, or anywhere, turns on activation without a person.
// ---------------------------------------------------------------------------------------------------------

export const GOVERNED_FLAGS = {
  approvalPolicy: "TAVONEL_APPROVAL_POLICY_ENABLED",
  steward: "TAVONEL_STEWARD_ENABLED",
  stewardCohort: "TAVONEL_STEWARD_COHORT",
  autopilot: "TAVONEL_AUTOPILOT_ENABLED",
  autopilotCohort: "TAVONEL_AUTOPILOT_COHORT",
  standingApprovals: "TAVONEL_STANDING_APPROVALS_ENABLED",
  skills: "TAVONEL_SKILLS_ENABLED",
  skillsCohort: "TAVONEL_SKILLS_COHORT",
  notifyEmail: "TAVONEL_NOTIFY_EMAIL_ENABLED",
} as const;
export const GOVERNED_COHORT_MAX = 20;

// ---------------------------------------------------------------------------------------------------------
// World transition proposals (ADR §10.1, blockers B2 and B4). The proposal binds, at creation, the Active
// state the approver saw: state, revision and manifest digest. The executor passes exactly these to
// transition_foundation_world_atomic (20260920120000) and never a value re-read at run time, so two approved
// proposals from the same state cannot both apply (the second meets the pointer CAS), and a resume repeats
// the first call byte for byte (same request hash, same operation id).
// ---------------------------------------------------------------------------------------------------------

export const WORLD_TRANSITION_ACTION_TYPES = ["world_activation", "world_rollback"] as const satisfies readonly GovernedActionType[];
export type WorldTransitionActionType = (typeof WORLD_TRANSITION_ACTION_TYPES)[number];

/** The p_action each kind passes to the existing transition. A rollback uses the existing rollback branch (B4). */
export const WORLD_TRANSITION_SQL_ACTION: Readonly<Record<WorldTransitionActionType, "activate" | "rollback">> = {
  world_activation: "activate", world_rollback: "rollback",
};

/** The stored input's keys, sorted. Nothing else is stored and nothing is filled in later. */
export const WORLD_TRANSITION_INPUT_KEYS = [
  "collectionId", "expectedCurrentManifestDigest", "expectedCurrentRevision", "expectedCurrentState", "reason", "toManifestDigest",
] as const;

export type WorldTransitionInput = Readonly<{ collectionId: string; toManifestDigest: string; reason: string } & (
  | { expectedCurrentState: "empty"; expectedCurrentRevision: 0; expectedCurrentManifestDigest: null }
  | { expectedCurrentState: "active"; expectedCurrentRevision: number; expectedCurrentManifestDigest: string }
)>;

const TRANSITION_DIGEST = /^sha256:[a-f0-9]{64}$/;
const TRANSITION_COLLECTION_ID = /^collection-[a-f0-9]{32}$/;
/** char_length(p_reason) between 8 and 500 in the SQL counts code points; a UTF-16 length above 1,000 cannot fit. */
const REASON_CODE_POINTS = { min: 8, max: 500 } as const;

const isTransitionDigest = (value: unknown): value is string =>
  typeof value === "string" && TRANSITION_DIGEST.test(value) && value !== NO_BINDING_DIGEST;

/**
 * The stored input of a world transition proposal, or null. Refuses, never defaults: an unknown kind, a key
 * missing or extra, a wrong type, NaN/Infinity/a fraction/an unsafe integer, the (state, revision, digest)
 * pairings the transition RPC refuses (`world_transition_expected_state_invalid`), a rollback from an empty
 * collection (`world_active_pointer_missing`), a target equal to the expected Active digest (a proposal that
 * changes nothing), the no-binding digest standing for a real World, and a reason the RPC would refuse or that
 * is not stored exactly as passed (surrounding whitespace). Total: a hostile value that throws on read is a refusal.
 */
export function parseWorldTransitionInput(actionType: WorldTransitionActionType, raw: unknown): WorldTransitionInput | null {
  try {
    if (!(WORLD_TRANSITION_ACTION_TYPES as readonly unknown[]).includes(actionType)) return null;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const keys = Object.keys(raw).sort();
    if (keys.length !== WORLD_TRANSITION_INPUT_KEYS.length || keys.some((key, i) => key !== WORLD_TRANSITION_INPUT_KEYS[i])) return null;
    const value = raw as Record<string, unknown>;
    const { collectionId, toManifestDigest, reason } = value;
    const state = value.expectedCurrentState;
    const revision = value.expectedCurrentRevision;
    const current = value.expectedCurrentManifestDigest;
    if (typeof collectionId !== "string" || !TRANSITION_COLLECTION_ID.test(collectionId)) return null;
    if (!isTransitionDigest(toManifestDigest)) return null;
    if (typeof reason !== "string" || reason.length > REASON_CODE_POINTS.max * 2 || reason.trim() !== reason) return null;
    const points = [...reason].length;
    if (points < REASON_CODE_POINTS.min || points > REASON_CODE_POINTS.max) return null;
    if (state === "empty") {
      if (actionType === "world_rollback" || revision !== 0 || current !== null) return null;
      return { collectionId, toManifestDigest, reason, expectedCurrentState: "empty", expectedCurrentRevision: 0, expectedCurrentManifestDigest: null };
    }
    if (state !== "active" || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) return null;
    if (!isTransitionDigest(current) || current === toManifestDigest) return null;
    return { collectionId, toManifestDigest, reason, expectedCurrentState: "active", expectedCurrentRevision: revision, expectedCurrentManifestDigest: current };
  } catch {
    return null;
  }
}

/** The proposal's binding digest (kind active_manifest): the stored expected Active digest, NO_BINDING_DIGEST when empty. */
export function worldTransitionBindingDigest(input: WorldTransitionInput): string {
  return input.expectedCurrentState === "empty" ? NO_BINDING_DIGEST : input.expectedCurrentManifestDigest;
}

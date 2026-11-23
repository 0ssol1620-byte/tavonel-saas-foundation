# ADR-0010 — Governed automation: one proposal spine for approval policy, the steward, standing approvals, Skills and the Knowledge Steward

- **Status:** design adopted for build by the implementer of WO-B-00 (merged with WO-KS-0, lead ruling 1 of
  2026-11-18). The independent review (r20, reviewer acting as attacker and verifier) found four blockers; the
  lead ruled on each (2026-11-18) and the rulings are written in here as M15–M17 and §15.2 (closing round,
  2026-11-23). Every option this ADR considered has a disposition row in §15.2. Nothing here is built or proven.
  Every number is a start value, uncalibrated. No gate is marked passed: U17, U31, U37, M9-03, M9-04, M9-05
  stay **OPEN**.
- **Base read:** Foundation `codex/v34-fnd-int` at `e9364899`. Every `file:line` below is at that head.
- **Sources:** `workorders/all-features/B-autopilot-steward-governance-skills.md` (cluster B, cited `[B §n]`),
  `workorders/all-features/A-agent-write-ontology.md` (cluster A, `[A §n]`), `LEAD-RULINGS-WAVE0.md`
  (`[LR n]`), ADR-0009 (agent proposals v1), `workorders/agent-native.md` (`[AN §n]`), blueprint
  `TAVONEL_CANONICAL_MASTERPLAN_V5_6_V34_2026-11-16.md` (`[MP n]`).
- **Companion:** `D:/CodexProjects/v34-lanes/workorders/knowledge-steward.md` — the Knowledge Steward detail
  (CQ sets, coverage, ontology patch, steward tools, invariants, crosswalk). Where it and this ADR differ,
  this ADR wins.
- **Constants:** `nextjs/lib/governed-automation-constants.ts` (import-free). Every list and start value
  named here is defined there once; migration text tests compare their CHECK lists with it
  (`actionTypesThrough(slot)`, `agentScopesThrough(slot)`).

## 0. Decision in one paragraph, and what this ADR changes in the cluster files

Four held routes (`/governance`, `/steward`, `/autopilot`, `/skills`) and the Knowledge Steward are views of
**one spine**: *something proposes → the policy says who may confirm → a person, or a standing rule a person
made, confirms → the existing executor runs → a signed receipt is recorded → the trail shows it*. The spine
exists (`world_change_proposals`, `PROPOSAL_EXECUTORS`, `decideProposal`, action receipts; ADR-0009). This
ADR fixes the one contract both clusters build on: the decision function, the lock order, the migration
order, the single `world_activation` executor, one flip owner per route, one agent tool and scope table, one
consent rule, the steward state machines and the Knowledge Steward contract. **TAVONEL runs no model** for
any of it (`[MP 229]`, `[MP 1368]`, `[MP 1486]`, `[LR 16]`): every sentence is a server template over durable
facts; conversation happens in the customer's own AI client on the customer's bill.

### 0.1 What is unchanged from the cluster files

Everything not listed in §0.2. In particular: the risk-tier idea, standing approvals as narrowly scoped
`compile_plan` confirmations, the six steward item kinds and states, the Skill lifecycle, the capability
receipt (`[B §2]`), the flip-on-capability-receipt rule (`[LR 2,3]`), the ontology patch op set and
Product-side placement (`[A §3.1]`, `[LR 16]`).

### 0.2 Amendments (each with its reason; the lead decides on each, `[LR 1]`)

| # | Cluster text | Amended to | Reason (attack row in §15) |
|---|---|---|---|
| M1 | `[B WO-B-01]` `decide_world_change_proposal` takes `p_approver_role` from the caller; `[B WO-B-GOV-1]` flag off passes role `owner` | The RPC reads the decider's role itself from `foundation_workspace_members` under a share lock; no role parameter exists | A caller-supplied role turns any TS defect, and the flag-off path, into "owner approved" (S-2) |
| M2 | `[B WO-B-GOV-1]` flag off = policy not evaluated | A stored policy row is **always** enforced by the RPC; `TAVONEL_APPROVAL_POLICY_ENABLED` gates only writing policies and the governance surface | A flag that removes a restriction fails open; with no rows the behaviour is today's either way (S-3) |
| M3 | `[B WO-B-01]` separate `consume_foundation_standing_approval` RPC, called before execution | No separately callable consume RPC: the standing-rule check and debit happen **inside** `decide_world_change_proposal`, in the same transaction as the confirmation | Two transactions give confirm-without-debit or debit-without-confirm (S-1) |
| M4 | `[B WO-B-01]` new binding kind `active_pointer`; `[A WO-AN-21]` binding `active_manifest` | `world_activation` pairs with the **existing** `active_manifest`; "no Active World" is `NO_BINDING_DIGEST` (`sha256:` + 64 zeros) | One meaning ("the collection's Active digest"), no new enum value; every binding column is `^sha256:` (S-21, S-22) |
| M5 | `[B §1.1]` default policy `member` for every type | `world_activation` default and floor = `admin` | `transition_foundation_world_atomic` refuses actors below admin (`20260920120000:256-268`); a `member` default lets a member "confirm" a proposal that can only fail (S-4) |
| M6 | `[B WO-B-GOV-2]` executor `run` calls `promoteFoundationCandidate` directly; `undo` calls `rollbackFoundationWorld` | `run` goes through the **same gate chain as the promote route** (plan gate `authorizeWorldActivation`, `checkActivationRateLimit(…, "world_activation")`, source currency via `transition_foundation_world_atomic_current`), extracted from the route into one function both use. **No undo**: going back is a **`world_rollback` proposal** (M17), or the direct rollback route when no policy requires approval | A direct store call skips three gates the route enforces (S-5); an undo is a one-person Active change that would bypass four-eyes and, later, step-up (S-6) |
| M15 | (r20 B2) the activation proposal stored only the target digest; `run` re-read the Active pointer | A `world_activation` / `world_rollback` proposal **binds at creation** the Active state the approver saw — `expectedCurrentState`, `expectedCurrentRevision`, `expectedCurrentManifestDigest` — next to the target and the reason (§10.1). The executor passes **exactly those stored values** to `transition_foundation_world_atomic`; it never re-reads the pointer. A mismatch is the RPC's CAS refusal, recorded as the named outcome `failed` / `ACTIVE_WORLD_CONFLICT` (fail closed). Parser: `parseWorldTransitionInput` (constants module) | With a re-read, two approved proposals A→B and A→C both apply (C lands on B, which nobody approved), and a resume after a failed record sends a different request hash under the same operation id → `world_transition_idempotency_conflict` (r20 B2) |
| M16 | (r20 B3) §4 runtime: a standing rule confirms through "the same `decideProposal` path as the rule's creator" | Rule execution is an **internal server path** (worker secret, `isInternalWorkerAuthorized`), never a session: the creator's user id is the actor, the creator's membership is checked **in SQL** at execution time, and every check the session path makes is mapped to its SQL counterpart in the §4.1 table; a check with no counterpart is listed **OPEN**, never dropped | `decideProposal` needs the creator's live session (`requireProposalSession`, `revalidateFoundationSession`, the bearer `runCompile` forwards); the only way to call it from a sweep is to forge one (r20 B3) |
| M17 | (r20 B4) "going back is a new `world_activation` proposal to the previous digest" | Going back under a policy that requires approval is its **own proposal kind `world_rollback`** (R2, session-only, binding `active_manifest`, B-01) that calls the **existing rollback transition** (`p_action = 'rollback'`) through the rollback route's gate chain. It is decided by the **`world_activation` policy row** (`APPROVAL_POLICY_KEY`): one policy governs every Active change. No undo | The promote chain is forward-only: `transition_foundation_world_atomic_current` refuses a candidate whose sources were superseded (`assert_world_sources_current`), which is exactly the previous World in the common case; the rollback branch exists for that and requires a `superseded` target and an existing pointer (`20260920120000:357-366`) (r20 B4) |
| M7 | `[A WO-AN-21]` adds action type `world_activation` and its own executor/migration | One executor, owned by WO-B-GOV-2 (`[LR 1]`). WO-AN-21 adds only: the passkey step-up at confirmation, the scope `agent:activation`, the tool `propose_activation`, and a migration that widens the `world_activation` proposer CHECK from `session` to `session, agent`. From the day WO-AN-20's step-up guards the promote route, **every** `world_activation` confirmation requires it (session- and agent-origin) | Otherwise the proposal path becomes a step-up bypass of promote (S-7) |
| M8 | `[B WO-B-02]` steward cap via the existing `p_open_limit` | `create_world_change_proposal` keeps its signature; WO-B-02 replaces its **body** so `p_open_limit` is accepted for `steward` (counted per workspace under its own advisory key), a steward principal must be an active member, and a session key in a reserved namespace (`agt_`, `stw_`, `skl_`) is refused | The base RPC refuses `p_open_limit` for non-agents (`20261117130000:354`), so the cap as written cannot exist; a TS-side cap races; a session key `stw_…` would pre-empt a steward key (S-8, S-9) |
| M9 | `[B WO-B-APL-2]` rule scope and credits checked in TS | The RPC checks the proposal's `input.documentIds` ⊆ the rule scope, and refuses a debit below the stored quote `input.quote.rechargeCredits` | A TS defect would confirm out-of-scope compiles or debit 0 (S-10, S-11) |
| M10 | `[B WO-B-APL-4]` brief/steward items under `agent:read` plus a `CONSENT_OUTDATED` re-consent mechanism; `[A §3.1]` one scope `agent:steward` | **Consent rule C1** (§9): one scope = one consent sentence; a grant only ever sees tools whose sentence it was shown. Brief and steward items get scope `agent:brief` (B-02), the Knowledge Steward `agent:steward` (KS-1), Skills `agent:skills` (B-03), activation `agent:activation` (WO-AN-21). No consent-version column, no `CONSENT_OUTDATED` | Changing an old scope's sentence gives old grants tools they never consented to; a new scope makes the opt-in explicit and needs no new mechanism (S-12) |
| M11 | `[A WO-KS-5]` grant POST `{clientLabel, steward?: boolean}` | `{clientLabel, optionalScopes?: string[]}` ⊆ the optional scopes of §9 | The body shape stays fixed while three more optional scopes arrive |
| M12 | `[B WO-B-SKL-5]` `run_skill` runs read and propose Skills; propose needs `agent:propose` | v1: the agent runs **read-mode** Skills only; a propose-mode install answers `NOT_FOUND`-equivalent through the agent | The tool manifest has one mode per tool; a tool that sometimes files proposals would be declared read-only falsely (S-16) |
| M13 | `[A WO-AN-16]` flips `/governance` | WO-AN-16 writes the agent-proposal half of the governance capability evidence; **WO-B-GOV-FLIP** is the only flipper (`[LR 1]`) | One flip owner per route |
| M14 | `[B WO-B-STW-FLIP]` flips `/steward` | **WO-KS-9** flips `/steward` on the A2 receipt (WO-KS-8); WO-B-STW-FLIP later only reconciles copy for what cluster B adds | `[LR 1]` |

## 1. Context

- `requireProposalSession` admits any active member's session to confirm any proposal
  (`nextjs/lib/change-proposals.ts:212-216`); there is no per-workspace approval policy, no four-eyes and no
  activation by proposal.
- The DB already allows `principal_kind = 'steward'` on proposals
  (`supabase/migrations/20261117130000_agent_proposals.sql:302-304`); no code creates one.
- Activation exists only as the promote/rollback routes over `transition_foundation_world_atomic`, which
  requires an owner or admin actor and serialises per collection on an advisory lock
  (`20260920120000_atomic_world_activation.sql:256-268`).
- `/api/agent-mcp` has nine tools (six read, three propose), flag off at build 1 (ADR-0009).
- No steward item, standing rule, Skill registry, competency question or structural ontology patch exists.

## 2. Vocabulary (constants module, §§ "Action types", "Flags")

### 2.1 Action types, tiers, bindings, proposers

| Action type | Tier | Binding kind | Who may propose | Migration | Standing rule | Agent scope to propose |
|---|---|---|---|---|---|---|
| `library_label` | R1 | `active_manifest` | session, agent | existing | no | `agent:propose` |
| `compile_plan` | R1 | `source_inventory` | session, steward, agent | existing | **yes, steward-origin only** | `agent:propose` |
| `ontology_label_patch` | R1 | `correction_leaf` | session, agent | existing | no | `agent:propose` |
| `world_activation` | **R2** | `active_manifest` (`NO_BINDING_DIGEST` when empty) | **session** (agent only after WO-AN-21, M7) | B-01 | **never** | `agent:activation` (reserved, WO-AN-21) |
| `world_rollback` | **R2** | `active_manifest` (never empty: a rollback needs an Active World) | **session** only (no agent scope; widening it needs its own ADR) | B-01 | **never** | — |
| `competency_questions_set` | R1 | `question_set` (`NO_BINDING_DIGEST` when no live set) | session, agent | KS-1 | no | `agent:steward` |
| `ontology_patch` | R1 | `correction_leaf` | session, agent | KS-1 | no | `agent:steward` |

R0 = Skill runs in read mode (no proposal, no confirmation; an installed grant suffices). R3 (external side
effect, money, deletion) has **no** action type and none may be added under this ADR. A Skill run may file
only `compile_plan`, `library_label`, `ontology_label_patch` (`SKILL_FILABLE_ACTION_TYPES`). The steward
proposes only `compile_plan`. No R2 type is reachable by a standing rule, the steward or a Skill (source
test `governed-automation-constants.test.ts`, "activation is never automatic"). The WO-AN-5 source test that
`TAVONEL_*AUTO_ACTIVATION*` is absent stays.

### 2.2 State machines

- **Proposal** (unchanged, ADR-0009): `proposed → confirmed | rejected | expired | stale | withdrawn`;
  `confirmed → executed | failed`; `executed → undone` (types with an undo only; `world_activation` and
  `world_rollback` have none).
  Policy and standing-rule refusals are **exceptions**: the row stays `proposed`.
- **Steward item:** person transitions `STEWARD_PERSON_TRANSITIONS` — `new|reopened → acknowledged|snoozed|held|resolved`,
  `acknowledged → snoozed|held|resolved`, `snoozed → acknowledged|held|resolved`, `held → acknowledged|resolved`,
  `resolved → reopened`. Sweep-only transitions `STEWARD_SWEEP_TRANSITIONS` — `snoozed → new` at
  `snoozed_until`; `resolved → reopened` when `subject_revision` changes. `reopened` behaves as `new`. A
  revision change on a non-resolved item updates `subject_revision`/`facts`/`last_seen_at` and keeps the state.
- **Standing rule:** stored `active` (with `revoked_at`, `expires_at`, `credits_used`, `period_start`);
  `exhausted` (this period), `expired`, `revoked` are derived. `exhausted → active` when the period rolls.
- **Skill version:** `draft → shadow_tested → approved → superseded | revoked`. **Install:**
  `active ⇄ paused`, `→ revoked`. **Run:** `running → succeeded | failed | refused` (once).
- **CQ set:** append-only; one live set per (workspace, collection); a new set supersedes the live one in the
  same transaction.

### 2.3 Flags and the two levers per feature

House style: exactly `"true"` is on; a cohort is a comma list of ≤ 20 exact workspace keys, malformed or
wider → nobody. Every new flag defaults off. With every flag off and no policy row, every existing test keeps
today's outcome.

| Feature | Lever 1 — flag (reversible, redeploy) | Lever 2 — immediate |
|---|---|---|
| Approval policy | `TAVONEL_APPROVAL_POLICY_ENABLED` off: policies can no longer be written and the surface 404s; **stored policies keep binding** (M2) | none: a restriction is never lifted by an operator switch; an owner/admin sets a policy back to its floor (an event row) |
| Steward | `TAVONEL_STEWARD_ENABLED` / `_COHORT`: sweep route and inbox 404, no new items or steward proposals | none needed: the steward executes nothing; open steward proposals wait for a person, who may reject them |
| Standing approvals | `TAVONEL_STANDING_APPROVALS_ENABLED` off: no matching | `revoke_all_foundation_standing_approvals(null)` via `POST /api/internal/standing-approvals/revoke-all` (worker secret): every rule revoked, irreversible |
| Autopilot surface | `TAVONEL_AUTOPILOT_ENABLED` / `_COHORT` | n/a (reads only) |
| Skills | `TAVONEL_SKILLS_ENABLED` / `_COHORT`: routes 404, runs refused | operator sets a version `revoked` (every run of it refused); owner/admin revokes an install |
| Digest email | `TAVONEL_NOTIFY_EMAIL_ENABLED` off: no send | owner/admin disables an endpoint |
| Agent tools | `TAVONEL_AGENT_PROPOSALS_ENABLED` (ADR-0009) | `revoke_all_foundation_agent_grants` (ADR-0009) |

Use lever 2 when a credential or rule may be in the wrong hands, lever 1 when the feature must pause.

## 3. Approval policy (S1) — evaluated inside the one decision path

`foundation_approval_policies (workspace_key, action_type, approver_min_role, require_distinct_approver,
revision ≥ 1, updated_by, updated_at; pk (workspace_key, action_type))` — CHECKs: `action_type` ∈
`policyActionTypesThrough(slot)` (the policy **keys**: every type except `world_rollback`, which is decided by
the `world_activation` row, `APPROVAL_POLICY_KEY`, M17); `approver_min_role` ∈ (`member`,`admin`,`owner`);
`action_type <> 'world_activation' or approver_min_role in ('admin','owner')` (floor, `APPROVAL_POLICY_FLOOR`). Absent row =
`DEFAULT_APPROVAL_POLICY` at revision `ABSENT_POLICY_REVISION` (0) = today. `foundation_approval_policy_events`
append-only. Writer: `set_foundation_approval_policy(p_workspace_key, p_actor_user_id,
p_authorization_revision, p_action_type, p_min_role, p_distinct, p_expected_revision)` — actor active at that
revision and of `POLICY_SETTER_MIN_ROLE[type]` (owner for `world_activation`, admin otherwise); CAS on
`p_expected_revision` (0 for "no row yet"), else `approval_policy_revision_conflict`; row + event, one
transaction.

**`decide_world_change_proposal` — one callable signature** (drop and recreate in B-01; pgTAP
`count(pg_proc) = 1`): the base parameters unchanged, plus trailing `p_policy_revision bigint default null`,
`p_standing_rule_id uuid default null`, `p_rule_credits integer default null`. A call with the base named
arguments still resolves. Body, in order:

1. Input validation (base), plus: `p_standing_rule_id` and `p_rule_credits` both null or both set; set ⇒
   `p_decision = 'confirm'` and `p_rule_credits ≥ 0`.
2. Grant row `for share` (agent rows) → grant owner's membership `for share` (base).
3. Decider's membership row `for share` (`workspace_key = p_workspace_key and user_id = p_decided_by`).
4. Proposal row `for update` (base); `proposal_not_found` / `proposal_not_decidable` (base).
5. `expired`, then `withdrawn` (base verdicts, written as today).
6. **Confirm only** — policy row of `APPROVAL_POLICY_KEY[v_row.action_type]` `for share` (or the default; a
   `world_rollback` row reads the `world_activation` row — in SQL a `case` over the stored type, pgTAP asserts
   it):
   - `coalesce(p_policy_revision, 0) <> coalesce(row.revision, 0)` → raise `approval_policy_changed`.
   - decider not `active`, or role rank < `approver_min_role` (or the floor when no row) → raise
     `approval_role_insufficient`.
   - `require_distinct_approver and p_decided_by = v_row.principal_id` → raise
     `approval_distinct_approver_required`. (`principal_id` is the grant's person for an agent row and the
     collection's steward for a steward row: neither confirms their own row under four-eyes. Tested.)
   - Standing rule given (§4): rule checks and debit, or raise.
7. `stale` (base), `rejected`, `confirmed` (base); a rule confirmation also writes `decided_via_rule_id`.

Rejection is never refused by policy and needs no membership row (today's behaviour). No caller supplies a
role (M1). Enforcement does not read any flag (M2). The TS side (WO-B-GOV-1) reads the policy for the
preview (`approval.viewerMayConfirm`) and passes the revision it read; the RPC is the authority.

**Direct activation routes** (`app/api/collections/[id]/promote/route.ts`, `…/world/rollback/route.ts`):
when a `world_activation` policy row exists with `require_distinct_approver` or a min role above the
caller's, they answer 409 `ACTIVATION_REQUIRES_APPROVAL` with the proposal path — a `world_activation`
proposal from promote, a `world_rollback` proposal from rollback (M17); with no row they behave exactly as
today (test).

## 4. Standing approvals (S2)

`foundation_standing_approvals (rule_id, workspace_key, created_by, authorization_revision, action_type
check (= 'compile_plan'), scope jsonb, period check (= 'month'), credit_cap 1..100000, period_start,
credits_used 0..credit_cap, expires_at ≤ created_at + 90 days, created_at, revoked_at)`; scope = object with
exactly one of `collectionIds` (1..50) or `documentIds` (1..128), ≤ 4,096 bytes.
`foundation_standing_approval_uses (rule_id, proposal_id unique → world_change_proposals, credits ≥ 0,
used_at)`. `world_change_proposals.decided_via_rule_id uuid null → foundation_standing_approvals`, CHECK
`decided_via_rule_id is null or (action_type = 'compile_plan' and principal_kind = 'steward')`.

Inside `decide_world_change_proposal` step 6, when `p_standing_rule_id` is set (after the policy row, M3):

1. Rule row `for update`; not found or `workspace_key <> p_workspace_key` → `standing_rule_revoked` (no
   existence disclosure across workspaces).
2. `revoked_at is not null` → `standing_rule_revoked`; `expires_at <= clock_timestamp()` → `standing_rule_expired`.
3. `created_by <> p_decided_by` → `proposal_request_invalid` (a rule confirms only as its creator).
4. Proposal `action_type <> 'compile_plan'` or `principal_kind <> 'steward'` → `standing_rule_out_of_scope`
   (agent- and session-origin rows are never matched; `world_activation` can never be).
5. Creator's membership (locked at step 3) not active at `rule.authorization_revision` →
   `standing_rule_creator_inactive`. Creator's role below the policy for `compile_plan`, or the policy
   requires a distinct approver → `standing_rule_policy_insufficient` (a rule is its creator's own approval).
6. Scope: every id of `v_row.input->'documentIds'` is in `scope.documentIds`, or (collection scope) occurs in
   `foundation_collection_artifact_provenance.document_ids` of a scope collection of this workspace → else
   `standing_rule_out_of_scope` (M9).
   Then source access as the creator (M16, §4.1 T7): `public.connector_documents_blocked(p_workspace_key,
   documentIds)` (`20260927102000`) true → `standing_rule_source_access_denied`; and, until a per-viewer SQL
   check is registered, any id with a row in `public.connector_document_bindings` → the same refusal (a rule
   never confirms a connector-sourced document it cannot check per person).
7. `p_rule_credits < (v_row.input->'quote'->>'rechargeCredits')::integer` → `proposal_request_invalid` (M9).
8. Roll `period_start` forward by whole months while `period_start + 1 month <= clock_timestamp()`,
   resetting `credits_used`; `credits_used + p_rule_credits > credit_cap` → `standing_rule_budget_exhausted`.
9. Insert the use row, add the credits, set `decided_via_rule_id`; the verdict continues at step 7 of §3.

Any refusal raises: nothing is written and the proposal stays `proposed` for a person (no retry loop).
`create_foundation_standing_approval(p_workspace_key, p_actor_user_id, p_authorization_revision, p_scope,
p_credit_cap, p_expires_at)`: actor active at the revision and allowed to confirm `compile_plan` under the
current policy; four-eyes policy → refused (`standing_rule_policy_insufficient`). `revoke_…(p_workspace_key,
p_rule_id, p_actor_user_id)`: creator, or owner/admin. `revoke_all_…(p_workspace_key text default null)`.

### 4.1 Rule execution: an internal server path, never a session (M16, r20 B3)

Runtime (WO-B-APL-2): `POST /api/internal/standing-approvals/run` (worker secret, `isInternalWorkerAuthorized`,
`lib/internal-worker-auth.ts`), called by the steward sweep with `{workspaceKey, proposalId}` only. It does
**not** call `requireProposalSession`, `revalidateFoundationSession`, `decideProposal` or any route handler, and
it never builds a `Request` carrying a person's credential. The actor is `rule.created_by` (a user id read
from the rule row, never from the request); `decide_world_change_proposal` is called with
`p_decided_by = rule.created_by`, `p_standing_rule_id`, the binding the server computes, and the confirm-time
quote as `p_rule_credits`, and the membership, scope, budget and policy checks happen **in SQL** inside that
call (§3, §4 steps 1–9). Execution then runs the compile **as the creator's user id** through an internal
compile entry (T14) that re-checks the creator's membership in SQL immediately before it enqueues.

Each check the session path makes (`decideProposal` → `compilePlanExecutor` → `runCompile` →
`POST /api/compile-jobs`, at `e9364899`), and what replaces it on the rule path:

| # | Session-path check (TS, `file`) | Rule path: the SQL check that replaces it | Status |
|---|---|---|---|
| T1 | `requireProposalSession` → `getRequestUser`: a signed-in person (`change-proposals.ts:212`, `developer-auth.ts:331`) | identity is the rule row's `created_by`; `created_by = p_decided_by` (§4 step 3); the caller is the worker secret, not a person | replaced |
| T2 | `foundationPilotAccess(user.id)`: the env access mode / pilot allow-list (`foundation-pilot.ts:65`) | none in SQL (it reads env). The internal path calls the same id-based function with `created_by` before the RPC; a refusal leaves the row `proposed` | **OPEN** (no SQL counterpart; env-based) |
| T3 | `resolveWorkspaceAuthority`: membership row active (`developer-auth.ts:44`) | decider's membership `for share`, `state = 'active'` (§3 step 3) | replaced |
| T4 | `authorizeFoundationSessionProduct(…, "observer")`: account grant / billing plan / trial (`self-service-trial.ts:87`) | none in SQL. The internal path calls the same id-based function with `created_by`; between that read and the RPC a plan change is not seen | **OPEN** (needs a SQL plan read; until then a read-then-decide window) |
| T5 | `revalidateFoundationSession`: identity incl. `authorizationRevision` and role unchanged (`developer-auth.ts:358`) | creator's membership `authorization_revision = rule.authorization_revision` under the share lock (§4 step 5) — any role change, revoke or re-invite bumps it | replaced (stricter: pinned to rule creation, not to a session) |
| T6 | `resolveRow`: executor, stored input parses, documents non-empty (`change-proposals.ts:342`) | §4 step 4 (`action_type = 'compile_plan'`, `principal_kind = 'steward'`); step 6 reads `input->'documentIds'` (an empty or non-array value is out of scope); step 7 reads the stored quote. The TS parse also stays (no session needed) | replaced + kept |
| T7 | `checkDocuments` → `checkConnectorSourceAccessForViewer(ws, ids, user)` (`connector-source-access.ts:106`) | §4 step 6: `connector_documents_blocked(ws, ids)` and "no connector-bound document" → `standing_rule_source_access_denied`. The per-viewer ACL (`connector_documents_blocked_for_viewer`) is **not registered** in any migration at `e9364899`, so connector documents are refused outright on this path | **OPEN** for connector documents (refused until the per-viewer function is registered); uploads replaced |
| T8 | preview digest the client rendered (`change-proposals.ts:636-637`) | no client exists; the rule's scope (step 6) and quote floor (step 7) are the approval, and the use row records the proposal id whose `input_sha256` is immutable | replaced |
| T9 | `isResumable`: confirmed by this person ≥ `PROPOSAL_RESUME_AFTER_MS` ago (`change-proposals.ts:356`) | resume selects `state = 'confirmed' and decided_via_rule_id is not null and decided_at <= now() - interval` in SQL; such a row has `decided_by = rule.created_by` (§4 step 3 refused anything else) | replaced |
| T10 | agent-origin flag and receipt signer (`change-proposals.ts:630-642`) | §4 step 4 refuses every non-steward row (`standing_rule_out_of_scope`); the v2 receipt signer is server config, read by the internal path, and an unsigned outcome is never recorded | replaced (N/A for steward rows) |
| T11 | `preconditions`: re-quote, refuse over balance (`proposal-compile-plan.ts:273`) | the quote is the SQL `quote_foundation_compile_recharge`, called server-side; §4 step 7 floors the debit at the stored quote | kept (server read, no session) + floor in SQL |
| T12 | `currentBinding` → binding compared by the RPC (`proposal-compile-plan.ts:263`) | unchanged: the server computes it, the RPC compares (`stale`) | kept |
| T13 | base RPC checks (expired, withdrawn, stale, decidable) | unchanged (§3 steps 4–7) | kept |
| T14 | `runCompile` forwards the **confirming person's bearer** to `POST /api/compile-jobs`, whose `authorizeFoundationRequest(request, "collections:compile", "observer")` resolves a person (`proposal-compile-plan.ts:164`, `app/api/compile-jobs/route.ts:42`) | an internal compile entry (WO-B-APL-2) taking `{workspaceKey, userId: created_by, documentIds}`: membership re-checked in SQL (`state = 'active' and authorization_revision = rule.authorization_revision`, else `failed` / `standing_rule_creator_inactive`), then the route's id-based gates (intake lineage, customer-source admission, source access as in T7, trial capacity) and the enqueue | **OPEN** (does not exist at `e9364899`; WO-B-APL-2 builds it; until then no rule executes) |

Fail closed: while any row above is OPEN in a way that blocks execution (T14), the flag
`TAVONEL_STANDING_APPROVALS_ENABLED` cannot be turned on (the autopilot capability receipt of WO-B-APL-FLIP names each row). A rule-confirmed row that
was confirmed but could not record is resumed by the next sweep after `PROPOSAL_RESUME_AFTER_MS` (T9; no second
debit: the row is no longer `proposed`, and the use row is unique per proposal). The receipt gains
`approvedBy: {kind:'standing_rule', ruleId, createdBy, createdAt}` (`tavonel.action_receipt.v2`; the verifier
accepts v1 and v2). Accepted residual: the actual re-charge can exceed the confirm-time quote
(`[AN §9.2 #19]`, WO-AN-24); the rule bounds what it confirms, not what the meter later charges.

## 5. Steward (S3) and notifications

### 5.1 Store (WO-B-02)

`foundation_steward_items` as `[B WO-B-02]` (kinds, priority classes and states from the constants;
`subject_key` `^[A-Za-z0-9:._-]{1,200}$` — ids only; `facts` object ≤ 4,096 bytes, ids/digests/counts only;
`state = 'snoozed' ⇔ snoozed_until is not null`; `state = 'resolved' ⇒ resolved_at, resolved_by not null`;
`unique (workspace_key, dedupe_key)`), `foundation_steward_item_events` append-only,
`foundation_collection_stewards`, `foundation_steward_checkpoints`, `foundation_notification_endpoints`,
`foundation_notification_preferences`, `foundation_suggestion_feedback`, the outbox extension — all as
`[B WO-B-02]`, with these contract additions:

- `link_foundation_steward_item_proposal(p_workspace_key, p_dedupe_key, p_proposal_id)` — the item and the
  proposal must both be in `p_workspace_key` (an FK only proves existence; S-13); idempotent for the same
  proposal; a different proposal for the same `subject_revision` → `steward_item_proposal_conflict`.
- The endpoint cap (≤ 10 active per workspace) is enforced by a trigger that first takes
  `pg_advisory_xact_lock(hashtextextended('notify_endpoints:' || workspace_key, 0))` (S-14).
- `wake_foundation_snoozed_items` locks rows `for update skip locked` (a locked item wakes next turn).
- The two list RPCs the agent reads (`list_foundation_steward_items_page` and the brief's reads) are declared
  `stable` (WO-B-APL-4 asserts `provolatile in ('s','i')`).
- `create_world_change_proposal`: body replaced, signature unchanged (M8) — steward rows: principal is an
  active member (`for share`, else `proposal_principal_inactive`), `p_open_limit` required (100,
  `STEWARD_OPEN_PROPOSALS_PER_WORKSPACE`), counted per workspace under
  `hashtextextended('wcp_open_steward:' || p_workspace_key, 0)`; session keys matching `^(agt|stw|skl)_` →
  `proposal_request_invalid`.
- Scope CHECK and `consume_foundation_api_rate_limit` scope list += `agent:brief` (body otherwise identical).

### 5.2 Steward proposals (WO-B-STW-2)

Idempotency key `stw_` + base64url(sha256(`"steward-proposal/1\n" + workspaceKey + "\n" + dedupeKey + "\n" +
subjectRevision`)) = 47 characters, inside `PROPOSAL_IDEMPOTENCY_KEY`. Sequence per item, each step its own
transaction: upsert item → create proposal (replay returns the first row) → link. A crash between steps is
repaired by the next sweep (the same key replays). `active_conflict` and `extraction_held` never propose
(`STEWARD_PROPOSING_KINDS`; constitution: never auto-resolve an authoritative conflict).

### 5.3 What the sweep reads

Durable facts only (`[B WO-B-STW-1]` table). No numeric score; order is `STEWARD_PRIORITY_CLASSES` then
`first_seen_at`. A store error stops the turn with no checkpoint advance.

### 5.4 Notifications

As `[B WO-B-STW-4]`: no secret stored (signing key derived from `TAVONEL_CHANGE_NOTIFY_SECRET`, endpoint id
and `key_version`; rotating that secret rotates every endpoint — stated in the runbook); webhook body is the
public DTO without facts or titles; digest email = fixed templates with counts per kind and one link.

## 6. Migrations and locks

### 6.1 Order (binding, `[LR 1]`)

`B-01 approval_policy_standing` → `B-02 steward_notify` → `KS-1 knowledge_steward` → `B-03 skill_registry`.
The lead assigns timestamps at merge after the joint head; file order = merge order. Shared objects and
their writers — **each later writer's text is a superset of the earlier one's**, and each migration's text
test compares its lists with `actionTypesThrough(slot)` / `agentScopesThrough(slot)`:

| Shared object | B-01 | B-02 | KS-1 | B-03 |
|---|---|---|---|---|
| `world_change_proposals_action_type_check`, `…_binding_kind_check`, `…_binding_pairing_check`, proposer CHECK per type | + `world_activation`, `world_rollback` (session only), each paired with `active_manifest` | — | + `competency_questions_set`, `ontology_patch`, binding `question_set`; both require `collection_id`; input bound 8,192 → 16,384 | — |
| `create_world_change_proposal` body (signature unchanged) | pairing list | steward cap, principal check, reserved key namespaces | pairing list, input bound | — |
| `decide_world_change_proposal` | **drop + recreate** (§3, §4) | — | — | — |
| `foundation_approval_policies.action_type` CHECK | 4 types | — | + 2 KS types | — |
| scope CHECK + `consume_foundation_api_rate_limit` list | — | + `agent:brief` | + `agent:steward` | + `agent:skills` |
| `record_foundation_review_patch_if_leaf` | — | — | `create or replace`, sees both record tables under the same leaf lock | — |

Each migration: `security definer`, `set search_path = ''`, revoke from public/anon/authenticated/service_role
then grant execute to service_role, RLS on with a restrictive deny-all policy, generated constraint names
asserted before drop (pattern `20261117130000:35`), a rollback draft that restores the catalog fingerprint
and refuses while data of the new kind exists, a founder-reset superset, pgTAP. WO-AN-21's migration
(after WO-AN-20's) only widens the `world_activation` proposer CHECK and adds `agent:activation`.

### 6.2 Lock order

Existing sequences at the base head (`20261117130000` header and `130200` header): create proposal = key
advisory → grant `share` → membership `share` → open-cap advisory → insert; decide = grant `share` →
membership `share` → proposal `update`; revoke grant = grant `update` → keys → proposals; revoke-all =
kill-switch (two-int, exclusive) → grants → keys → proposals; create grant = kill-switch (shared) → workspace
advisory → membership `update`; world transition = pointer advisory → actor membership `share` → receipt →
pointer row.

New sequences (a function never waits for a lock that appears earlier in its own sequence while holding a
later one):

| Function | Sequence |
|---|---|
| `decide_world_change_proposal` | grant `share` → grant owner's membership `share` → decider's membership `share` → **proposal `update`** → policy row `share` → **standing rule `update`** → insert use |
| `set_foundation_approval_policy` | actor membership `share` → policy row `update` (insert … on conflict) → insert event |
| `create_ / revoke_foundation_standing_approval` | actor membership `share` → rule row `update` |
| `revoke_all_foundation_standing_approvals` | rule rows `update`, ordered by `rule_id` |
| `create_world_change_proposal` (B-02/KS-1 bodies) | key advisory → (agent: grant `share` → membership `share`) or (steward: principal membership `share`) → open-cap advisory (per person for agents, per workspace for the steward) → insert |
| `upsert_foundation_steward_item` | item advisory `('steward_item:' ‖ workspace ‖ ':' ‖ dedupe_key)` → item row → insert event. **Never a proposal lock** |
| `transition_foundation_steward_item` | actor membership `share` → item row `update` → insert event |
| `link_foundation_steward_item_proposal` | item advisory → item row `update` → (FK) proposal row `key share` |
| `wake_foundation_snoozed_items` | item rows `update skip locked` |
| `assign_foundation_collection_steward` | actor membership `share` → assignee membership `share` → steward row |
| `create_competency_question_set` (KS-1) | set advisory `('cq_set:' ‖ workspace ‖ ':' ‖ collection)` → live set row `update` → insert |
| `record_foundation_ontology_patch_if_leaf`, `record_foundation_review_patch_if_leaf` (KS-1) | the **same** leaf advisory key `review_patch_leaf:…` → read both tables → insert |
| `install_ / upgrade_ / rollback_ / revoke_foundation_skill_install` (B-03) | actor membership `share` → install advisory `('skill_install:' ‖ workspace ‖ ':' ‖ skill)` → install row |
| `start_foundation_skill_run` | run key advisory → (agent: grant `share` → membership `share`) or (session: membership `share`) → install row `share` → insert |
| `finish_foundation_skill_run` | run row `update` |

Why no cycle with decide/revoke/create:

- **Standing rule after the proposal row.** Decide holds the proposal and waits for a rule; every other rule
  locker (create/revoke/revoke-all) holds at most a membership share lock and never waits for a proposal row,
  so it never waits for decide. A revoke that commits first makes decide's `for update` re-read the revoked
  version (READ COMMITTED re-check) → `standing_rule_revoked`; a decide that commits first makes the revoke
  wait and then revoke a rule whose use is already recorded — never a use after a committed revoke.
- **Policy row after the proposal row.** `set_foundation_approval_policy` holds a membership share lock and
  the policy row; it never waits for a proposal, grant or rule. Share locks on membership never conflict
  with each other.
- **Steward items never take a proposal lock in the same transaction as their own advisory key, except the
  FK key-share of `link`.** Key share conflicts only with decide's `for update` on that proposal; decide
  never waits for an item lock or an item advisory key, so link waits for decide and never the reverse.
  Upsert and transition both end on the item row: upsert holds its advisory key, transition never takes it.
- **Grant kill switch** is untouched: none of the new functions takes it, so they never wait on it.
- **Accepted residual (liveness, S-17).** `change_foundation_workspace_member_role` locks the actor's then
  the subject's membership row `for update` (`20260920110000`); decide and `assign_…` take two membership
  rows in their own order. A role change between the same two people racing a decide can deadlock;
  PostgreSQL aborts one with 40P01; both fail closed (`PROPOSAL_STORE_FAILED`, no state written). The B-01
  race harness shows the aborted side wrote nothing.
- **Accepted (S-18).** A decide that reads an absent policy while a first policy row commits linearises
  before that policy; the TS passed revision 0 and the RPC compared against 0.

## 7. Skills (B-03 and the runtime)

As `[B WO-B-03]`, `[B WO-B-SKL-1..5]`, with: `publisher = 'tavonel'` only; `network: 'none'` only;
operations `SKILL_OPERATIONS`; permissions `SKILL_PERMISSIONS`; `proposal.file` only for
`SKILL_FILABLE_ACTION_TYPES`; a run's derived proposal key namespace `skl_`; the runtime re-reads install
liveness before each `proposal.file` step (S-15: an in-flight run never files after its install was revoked);
`agent:skills` scope (M10); agent runs read-mode Skills only (M12).

## 8. Knowledge Steward (A2)

Contract in `workorders/knowledge-steward.md`, built by WO-KS-1..9. Fixed here: CQ sets and the ontology
patch are R1; the patch runs **Product-side** (`[LR 16]`; option (b) Core `evaluate_ontology_patch` goes
through contract → shadow → benchmark → canary later; Protected Core untouched by either); coverage is
deterministic over the artifact's own chunks with `threshold: {value: 0, calibrated: false}`; no
TAVONEL-hosted model runs; v1 is single-person (the speaker is the approver; the two fields stay separate for
WO-KS-11); no transcript is stored (the conversation stays in the customer's host; SR-ADR03 stays with
WO-KS-10/11); agent-first, web always available (SR-ADR12, WO-KS-6).

## 9. Agent tool table, scopes and consent (one table every writer follows)

**Rule C1.** One scope = one consent sentence. A grant only ever sees (in `tools/list`) and calls tools whose
scope it holds, and it holds only scopes whose sentence was shown when it was created. A tool whose purpose
no existing sentence covers gets a **new scope** with a new sentence; an existing sentence is never widened.
A tool a credential cannot use is not listed, and `tools/call` on it answers JSON-RPC `-32602` "Unknown tool".
Count assertions are per scope set (exact list for each), not one global number.

| Tool | Mode | Scope | Action type | Writer (serial order) |
|---|---|---|---|---|
| `get_workflow_status`, `get_proposal`, `get_compile_job`, `list_candidates`, `get_candidate_objects`, `list_documents` | read | `agent:read` | — | existing |
| `propose_compile`, `propose_library_labels`, `propose_label_correction` | propose | `agent:propose` | `compile_plan`, `library_label`, `ontology_label_patch` | existing |
| `list_competency_questions`, `get_knowledge_coverage`, `get_candidate_relations`, `prepare_expert_question` | read | `agent:steward` | — | WO-KS-5 |
| `propose_competency_questions`, `propose_ontology_patch` | propose | `agent:steward` | `competency_questions_set`, `ontology_patch` | WO-KS-5 |
| `get_brief`, `list_steward_items` | read | `agent:brief` | — | WO-B-APL-4 |
| `list_skills`, `run_skill` (read-mode Skills only) | read | `agent:skills` | — | WO-B-SKL-5 |
| `propose_activation` | propose | `agent:activation` | `world_activation` | WO-AN-21 (after WO-AN-20) |
| tools of WO-AN-22, 27, 28, 29 | per C1 | per C1 | per C1 | those work orders |

Serial writers (merged order across both clusters; when an earlier writer has not been dispatched and a
later one is ready, the later goes first and the earlier rebases):

- `nextjs/lib/agent-mcp-tools.ts`: WO-AN-8 → WO-KS-5 → WO-B-APL-4 → WO-B-SKL-5 → WO-AN-21 → WO-AN-22 → WO-AN-27 → WO-AN-28 → WO-AN-29.
- `nextjs/lib/agent-consent.ts`, `nextjs/lib/agent-access.ts` (`AGENT_SCOPES`, rates): WO-KS-5 → WO-B-APL-4 → WO-B-SKL-5 → WO-AN-21 → WO-AN-27.
- `nextjs/lib/change-proposals.ts`: WO-B-GOV-1 → WO-B-GOV-2 → WO-KS-4 → WO-B-STW-2 → WO-B-APL-2 → WO-AN-21 → WO-AN-22 → WO-AN-27 (WO-AN-10's two read helpers at any point).
- `nextjs/components/change-proposals-panel.tsx`: WO-AN-10 → WO-B-GOV-2 → WO-KS-6 → WO-AN-21.

Grant creation body: `{clientLabel, optionalScopes?: string[]}` (M11); `optionalScopes` ⊆ the rows of
`AGENT_SCOPE_PLAN` with `optional: true` that are live in the build; anything else → 400; each checkbox
shows its sentence. Rate limits per minute: `agent:brief` 120, `agent:steward` 60, `agent:skills` 30 (start
values, `AGENT_SCOPE_PLAN`).

**Consent sentences (exact; each writer adds its own key to `AGENT_PROPOSAL_CONSENT` with this text):**

| Scope | Sentence |
|---|---|
| `agent:brief` | "It can read your brief and the open steward items about documents you can read." |
| `agent:steward` | "It can read the questions a World should answer and how well the World's evidence answers them, and suggest those questions and changes to the World's structure: names, types and relations, each tied to evidence." |
| `agent:skills` | "It can run the read-only Skills installed in this workspace on documents you can read." |
| `agent:activation` | "It can suggest making a candidate World active. It becomes active only when you confirm with your passkey in TAVONEL." |

The existing sentences (`sees`, `suggests`, `cannotChange`, `cannotReach`, `disconnect`, `securityNote`) are
unchanged. Every tool description of a propose tool keeps the SR21 sentence "Never claim the customer
approved; only the customer's confirmation in TAVONEL does." where it names a confirmation.

## 10. Executors and flip owners

| Thing | Single owner | Others |
|---|---|---|
| `world_activation` executor (`lib/proposal-world-activation.ts`) | WO-B-GOV-2: `parse` = `parseWorldTransitionInput("world_activation", …)` (§10.1); `documentsOf` = the candidate's provenance set (`list_collection_candidates`); binding `active_manifest` = `worldTransitionBindingDigest(input)`; `prepare` refuses unless the digest is a readable candidate and reads the expected Active state **once, here**; `run` = the promote route's gate chain with the proposal id as operation id and the **stored** expectations (§10.1); **no `undo`** (M6) | WO-AN-21 adds the step-up requirement and nothing else (M7) |
| `world_rollback` executor (same file, M17) | WO-B-GOV-2: `parse` = `parseWorldTransitionInput("world_rollback", …)` (state `active` only); `documentsOf` = the target version's provenance set (what `checkRollbackSourceAccess` reads); `prepare` refuses unless the target is a `superseded` version of the collection, readable by the proposer; `run` = the **rollback route's** gate chain (`authorizeFoundationProduct(…, "activation")`, owner/admin, `checkActivationRateLimit(…, "world_activation")`, `checkRollbackSourceAccess`) then `rollbackFoundationWorld` — the existing `p_action = 'rollback'` branch, no source-currency gate (going back to superseded sources is its purpose); **no `undo`** | session-only; no agent scope |
| `/governance` flip | WO-B-GOV-FLIP | WO-AN-16 supplies the agent-proposal evidence (receipts, activity export, enterprise audit export) to the GOV-FLIP capability receipt; flips nothing (M13) |
| `/steward` flip | WO-KS-9 (on WO-KS-8's receipt) | WO-B-STW-FLIP afterwards only reconciles copy for cluster B's additions (M14) |
| `/autopilot` flip | WO-B-APL-FLIP | — |
| `/skills` flip | WO-B-SKL-FLIP | — |

Every flip states capability only, never an outcome, a gain or a customer result (`[LR 2]`).

### 10.1 World transition proposals bind the state the approver saw (M15, M17; r20 B2, B4)

**Stored input** (exactly these keys, `WORLD_TRANSITION_INPUT_KEYS`; parser `parseWorldTransitionInput`, which
refuses and never defaults): `collectionId`, `toManifestDigest`, `expectedCurrentState` (`empty` | `active`),
`expectedCurrentRevision`, `expectedCurrentManifestDigest`, `reason`. The pairings are the transition RPC's own
(`20260920120000:209-227`): `empty` ⇔ revision `0` and digest `null`; `active` ⇔ a safe integer revision ≥ 1
and a `sha256:` digest. Refused as well: a `world_rollback` from `empty` (the RPC raises
`world_active_pointer_missing`), a target equal to the expected digest (a proposal that changes nothing),
`NO_BINDING_DIGEST` standing for a real World, a reason the RPC would refuse (code points 8..500) or one with
surrounding whitespace (the stored reason is the RPC's `p_reason` byte for byte, and it is hashed into the
request). `prepare` reads the Active pointer once, at creation, and stores what it read; the preview shows it,
so the person confirming confirms *from that state*. The binding digest is the stored expected digest
(`NO_BINDING_DIGEST` when `empty`), so the decide RPC already turns a moved pointer into `stale` before
execution.

**Execution.** `run` calls the transition with `p_operation_id = proposal_id`, `p_action =
WORLD_TRANSITION_SQL_ACTION[type]`, `p_expected_current_state/revision/manifest_digest` = **the stored values**,
`p_actor_user_id = row.decided_by`, `p_reason` = the stored reason. It never reads the pointer at run time.
Outcomes:

| What the RPC finds | Recorded as |
|---|---|
| pointer equals the stored triple | `executed`, the transition receipt's `receiptSha256` in the action receipt |
| pointer moved (`world_transition_compare_and_swap_conflict`; also the A→B, A→C race and an A→B→A revision change, which a digest alone would miss) | `failed`, code `ACTIVE_WORLD_CONFLICT` — fail closed, nothing applied; a new proposal from the new state is the way forward |
| target is not a `superseded` version / pointer missing (rollback) | `failed`, `ROLLBACK_TARGET_CONFLICT` / `ROLLBACK_TARGET_NOT_FOUND` |
| any other refusal of a gate in the chain | `failed` with that gate's code |

**Resume after a failed record is idempotent under that binding.** The first invocation and every resume send
the same `(operation_id, action, workspace, collection, target, candidate binding, expected state, expected
revision, expected digest, actor, reason)`: all of it is stored on the proposal or derived from the target's
immutable candidate key, so `foundation_world_transition_request_sha256` is identical and the RPC answers
`replayed` with the first receipt instead of `world_transition_idempotency_conflict`
(`20260920120000:272-300`). The resume first **reads the transition receipt by `operation_id = proposal_id`**
(a read; WO-B-GOV-2 adds it to `lib/world-store.ts`): when it exists **and its `request_sha256`,
`workspace_key`, `collection_id` and `actor_user_id` equal those of the stored call** the outcome is `executed`
with that receipt, whatever happened to the actor's role since (the replay branch re-checks the actor's
`authorization_revision` and would otherwise turn an effect that did happen into a failure); a receipt under
that operation id that does not match (the direct routes accept a client-chosen operation id, and a proposal
id is visible once created) is `failed` / `WORLD_TRANSITION_IDEMPOTENCY_CONFLICT`, never `executed`; when no
receipt exists the call above runs once more with the stored values. After any refusal from the RPC the executor reads
the receipt again before recording, so an effect that committed is never recorded as `failed`. Only the
confirmer resumes (`isResumable`), so `p_actor_user_id` cannot differ between attempts.

**Policy.** Both kinds are decided by the `world_activation` policy row (`APPROVAL_POLICY_KEY`): an owner who
sets four-eyes on activation has set it on rollback too. Default and floor `admin`, setter `owner`, as the
transition RPC requires (`20260920120000:262-270`).

## 11. DTO pairs (internal row type ≠ public type; never one type with a filter)

| API | Internal | Public (what it may carry) |
|---|---|---|
| `GET/PUT /api/governance/policy` | `ApprovalPolicyRow` (+ events) | `PublicApprovalPolicy {actionType, tier, minRole, distinctApprover, revision, updatedAt, updatedByIsViewer}` |
| proposal DTO extension | policy row + decider role | `approval {minRole, distinctApprover, viewerMayConfirm}` — the viewer's own answer only |
| `GET /api/governance/trail` | per-source rows | `GovernanceTrailRow {at, kind, id, actorUserId, actorEmail (workspace members only), action, digests, receiptSha256}` |
| `/api/autopilot/rules[...]` | `StandingRuleRow`, `StandingRuleUseRow` | `PublicStandingRule {ruleId, actionType, scopeSummary {collections, documents}, creditCap, creditsUsedThisPeriod, periodEndsAt, expiresAt, state, createdByIsViewer}` |
| `/api/steward/items[...]` | `StewardItemRow` (with facts) | `PublicStewardItem {itemId, kind, priorityClass, state, collectionId, subjectKey, proposalId, counts, firstSeenAt, lastSeenAt, snoozedUntil, ownedByViewer}` — no facts object, no title |
| `/api/notifications/endpoints` | `NotificationEndpointRow` | `PublicNotificationEndpoint {endpointId, origin, eventTypes, keyVersion, createdAt, disabledAt}`; the derived key once, on create/rotate |
| webhook body | outbox row | `{type, deliveryId, workspaceKey, collectionId, itemId, kind, priorityClass, at}` |
| `/api/notifications/preferences` | row | `{mode, quietHours, emailEnabled}` (own only) |
| `/api/autopilot/brief`, `get_brief` | `AuthorizedFacts` | `AutopilotBrief` (`[MP 35013]` fields; `confidence ∈ {verified, unknown}`; ≤ 3 cards; fact ids only) |
| `/api/skills[...]` | `SkillVersionRow`, `SkillInstallRow`, `SkillRunRow` | `PublicSkill {skillId, version, intent, permissions, network, mode}`, `PublicSkillInstall`, `PublicSkillRun {runId, state, proposalIds, receiptAvailable}` — no signature internals |
| `/api/worlds/[id]/questions`, `list_competency_questions` | `CompetencyQuestionSetRow` | `{setDigest, purpose, purposeStatement, questions [{cqId, text}]}` — text returned as data, rendered in `<q><bdi>` |
| `/api/worlds/[id]/coverage`, `get_knowledge_coverage` | evaluator output | `{manifestDigest, setDigest, threshold {value, calibrated:false}, rows [{cqId, status, reason, evidenceIds ≤ 8, linkedObjectIds ≤ 16}]}` |
| agent tools (all new) | the session public DTO | a separate agent view type per tool (`lib/agent-proposal-view.ts` pattern) |

## 12. Refusal codes requested from the catalog lane (`nextjs/lib/api-error-codes.ts` is not edited here)

| Code | HTTP | SQL marker |
|---|---|---|
| `APPROVAL_ROLE_INSUFFICIENT` | 403 | `approval_role_insufficient` |
| `APPROVAL_DISTINCT_APPROVER_REQUIRED` | 403 | `approval_distinct_approver_required` |
| `APPROVAL_POLICY_CHANGED` | 409 | `approval_policy_changed` |
| `APPROVAL_POLICY_REVISION_CONFLICT` | 409 | `approval_policy_revision_conflict` |
| `ACTIVATION_REQUIRES_APPROVAL` | 409 | — |
| `PROPOSAL_PRINCIPAL_INACTIVE` | 409 | `proposal_principal_inactive` |
| `STANDING_RULE_REVOKED`, `…_EXPIRED`, `…_BUDGET_EXHAUSTED`, `…_CREATOR_INACTIVE`, `…_POLICY_INSUFFICIENT`, `…_OUT_OF_SCOPE`, `…_SOURCE_ACCESS_DENIED` | 409 (rule APIs; on matching they only leave the row `proposed`) | `standing_rule_*` |
| `ACTIVE_WORLD_CONFLICT`, `ROLLBACK_TARGET_CONFLICT`, `ROLLBACK_TARGET_NOT_FOUND` (existing, `lib/world-store.ts`) | recorded in a `failed` world-transition outcome (§10.1) | `world_transition_compare_and_swap_conflict`, `world_rollback_target_*` |
| `STEWARD_ITEM_STATE_CHANGED`, `STEWARD_ITEM_TRANSITION_ILLEGAL`, `STEWARD_ITEM_PROPOSAL_CONFLICT` | 409 | `steward_item_*` |
| `NOTIFY_ENDPOINT_LIMIT` / `NOTIFY_ENDPOINT_URL_UNSAFE` | 429 / 400 | `notify_endpoint_limit` |
| `SKILL_UPGRADE_REQUIRES_REAPPROVAL` | 409 | `skill_upgrade_requires_reapproval` |
| `SKILL_INPUT_INVALID` / `SKILL_BUDGET_EXCEEDED` / `SKILL_NOT_INSTALLED` | 400 / 409 / 404 | `skill_*` |
| `GOVERNANCE_TRAIL_TOO_LARGE` / `GOVERNANCE_TRAIL_WINDOW_INVALID` | 413 / 400 | — |
| `CQ_SET_NOT_HEAD` | 409 | `cq_set_not_head` |
| `PATCH_TARGET_NOT_EDITABLE`, `PATCH_EVIDENCE_NOT_FOUND`, `PATCH_EVIDENCE_ORPHANED`, `PATCH_OBJECT_UNCONNECTED`, `PATCH_NO_CHANGE`, `PATCH_RETYPE_BREAKS_EDGE`, `PATCH_ARTIFACT_INVALID` | 400 (agent: `NOT_FOUND` folding where the target is unreadable) | — |

Until the catalog adds them, work orders use route-local constants the catalogue scan does not read (as
WO-AN-* did).

## 13. Deferred (each with its reason)

| Deferred | Reason | What must exist first |
|---|---|---|
| Agent endpoint ON in production | cluster A (WO-AN-11..15) | the canary of ADR-0009 |
| Activation proposed by an agent | needs a server-verified step-up an agent cannot perform | WO-AN-20, then WO-AN-21 (M7) |
| Third-party Skills, a Skills store, payouts | rights, KYC, payout legal (D29, EG-10 waived by owner and OPEN) | counsel / founder decision |
| Propose-mode Skills through the agent | tool mode honesty (M12) | a tool-manifest decision in a later ADR |
| Expert assertions, customer vocabulary, team routing (SR12, SR13 `add_rule`/`narrow_scope`, SR10) | Core contract and team seats | WO-KS-10/11/12 |
| Structural patches in Core | Protected Core ladder | contract → shadow → benchmark → canary |
| Outcome intelligence `/outcomes` | organic cohort (D26) | users over calendar time |
| Matched-task trial with people (U17/M9-05) | people and consent | founder scope decision |
| Email at volume | paid plan = recurring spend | founder confirmation in chat |

## 14. OPEN (not provable by this ADR)

U17, U31, U37, M9-03/04/05 stay OPEN. Production apply of B-01/B-02/KS-1/B-03; real hosts on the agent path;
the action-receipt signer in production; the spend ceiling (WO-AN-24); every start value. On the standing-rule
path (§4.1): T2 (env access mode, no SQL counterpart), T4 (plan level, no SQL read), T7 for connector
documents (per-viewer SQL not registered; refused meanwhile), T14 (internal compile entry, not built; no rule
executes until it exists).

## 15. Attack and dispositions

**Independence.** The work order asks for a separate attacker and verifier agent. The implementing session
could not start agents, so the brief is at `D:/CodexProjects/v34-lanes/receipts/WO-B-00/ATTACK-BRIEF.md`; the
lane's independent reviewer acted as attacker and verifier against the code at `e9364899` (review round r20,
`receipts/review-WO-B-00/r20/`; its findings and the lead's rulings are in `receipts/blockers/WO-B-00.md`).
§15.1 is the implementer's own pass: **not independent**, recorded so the reviewer can check it, not as
evidence. §15.2 holds the r20 findings with their rulings and one disposition row for every option this ADR
considered. Whether WO-B-01, WO-B-02 and WO-KS-1 are dispatchable is the reviewer's verdict on this closing
round, not this document's.

### 15.1 Implementer's self-attack (checked against the code at `e9364899`)

| # | Attack | Where in the code | Disposition |
|---|---|---|---|
| S-1 | Confirm and standing-rule debit in two transactions: decide commits, consume refuses → confirmed without a valid rule; or consume commits, decide finds `stale` → budget spent on nothing | `[B WO-B-01]` text; `decideProposal` calls one RPC per transaction (`change-proposals.ts:612`) | **Adopted** M3, §4 |
| S-2 | Role supplied by the caller; flag-off passes `owner` | `[B WO-B-01]`, `[B WO-B-GOV-1]` | **Adopted** M1 |
| S-3 | Flag off silently drops a stored four-eyes policy | `[B WO-B-GOV-1]` | **Adopted** M2 |
| S-4 | `world_activation` default `member` | `20260920120000:256-268` requires owner/admin | **Adopted** M5 |
| S-5 | Executor bypasses plan gate, rate ceiling, source currency | promote route `:118-132`, `transition_foundation_world_atomic_current` (`20261001170000:159`) | **Adopted** M6 |
| S-6 | Activation undo = one-person Active change under four-eyes | `[B WO-B-GOV-2]` undo | **Adopted** M6 (no undo) |
| S-7 | After WO-AN-20 the proposal path skips step-up | `[A WO-AN-20/21]` | **Adopted** M7 |
| S-8 | Steward cap impossible: `p_open_limit` only for agents | `20261117130000:354` | **Adopted** M8 |
| S-9 | Session key `stw_…` pre-empts a steward key (idempotency conflict, steward proposal denied) | `change-proposals.ts:487` refuses only `agt_` | **Adopted** M8 (DB) + STW-2 (TS) |
| S-10 | Rule scope only in TS | `[B WO-B-APL-2]` | **Adopted** M9 |
| S-11 | `p_rule_credits = 0` never exhausts the budget | `[B WO-B-01]` | **Adopted** M9 (floor = stored quote); residual: meter can exceed quote (WO-AN-24) |
| S-12 | A widened consent sentence covers old grants that never saw it | `agent-consent.ts` keys are fixed text | **Adopted** M10 (C1) |
| S-13 | Steward item linked to another workspace's proposal (FK proves existence only) | `[B WO-B-02]` | **Adopted** §5.1 link RPC |
| S-14 | Endpoint cap trigger races (two inserts see 9) | `[B WO-B-02]` | **Adopted** §5.1 advisory lock |
| S-15 | In-flight Skill run files proposals after its install is revoked | `[B WO-B-SKL-3]` | **Adopted** §7; residual: each proposal still needs a person |
| S-16 | `run_skill` declared read while able to file proposals | `capability-manifest.ts:85` one mode per tool | **Adopted** M12 |
| S-17 | Decide's two membership share locks vs role change's actor-first `for update` → deadlock | `20260920110000` role change | **Accepted residual** (liveness only; 40P01, both fail closed; harness proves no write) |
| S-18 | Absent-policy decide races the first policy insert | §3 | **Accepted** (linearises before the policy) |
| S-19 | A sole owner lowers four-eyes, acts, restores it | §3 | **Accepted residual**: four-eyes binds members and admins, not a sole owner; every change is a signed trail event (WO-B-GOV-4) |
| S-20 | Four-eyes makes the collection steward unable to confirm steward rows | §3 step 6 | **Adopted as semantics**, tested in WO-B-GOV-1 |
| S-21 | "No Active World" cannot be a binding (`^sha256:` CHECKs) | `20261116130100:35`, decide `:434` | **Adopted** M4 (`NO_BINDING_DIGEST`) |
| S-22 | Two `world_activation` executors (B and A) | `[B WO-B-GOV-2]`, `[A WO-AN-21]` | **Adopted** M4/M7 |
| S-23 | Link's FK key-share waits on decide's `for update` | §6.2 | **Accepted**, no cycle (decide never waits on items) |
| S-24 | Cross-tenant rule use (rule id from another workspace) | §4 step 1 | **Adopted**: workspace equality, same refusal as revoked |
| S-25 | Hostile text in a steward fact, CQ, Skill input or label reaches a template slot | `[B §3]` last rule | **Adopted** as invariant: facts are ids/digests/counts (≤ 4 KB, CHECK), subject keys are id-pattern, CQ text and labels are data rendered in `<q><bdi>`, Skill inputs are ids/enums; WO-B-06 runs ≥ 100 generated cases |

### 15.2 Dispositions

**(a) Independent review r20 — findings, the check against `e9364899`, the lead's ruling (2026-11-18).**

| # | Finding | Checked against the code | Ruling and where it is written |
|---|---|---|---|
| R-1 | The dispositions section is empty | §15.2 held only a placeholder at `acff6a77` | **Adopted**: this section — the r20 rows here, every considered option in (b) |
| R-2 | The activation proposal stores the digest, not the revision the approver saw: two approved proposals A→B and A→C both apply (C on top of B); a resume after a failed record hits an idempotency conflict | The transition's request hash covers expected state, revision and digest (`20260920120000:70-83`, `:247-252`); a replay with a re-read expectation differs → `world_transition_idempotency_conflict` (`:272-284`); the CAS compares revision and digest (`:323-328`) | **Adopted** M15: state, revision and digest bound at creation, the executor passes the stored values and never a re-read, a mismatch is `failed` / `ACTIVE_WORLD_CONFLICT`; resume reads the receipt by operation id (§10.1). Parser and its property tests: `parseWorldTransitionInput` |
| R-3 | The standing-rule runtime "runs the same `decideProposal` path as the rule's creator", which needs the creator's live session | `requireProposalSession` (`change-proposals.ts:212`), `revalidateFoundationSession` (`:639`), `isResumable` keyed to the viewer (`:356`), `runCompile` forwards the request's bearer (`proposal-compile-plan.ts:167`) | **Adopted** M16: internal worker-secret path, creator's membership checked in SQL, creator's user id as actor, no session forged; TS-check → SQL-check table §4.1 with T2, T4, T7 (connector), T14 OPEN |
| R-4 | "Going back is a new activation proposal" fails for the common case: the promote chain is forward-only and refuses superseded sources | `transition_foundation_world_atomic_current` runs `assert_world_sources_current` (`20261001170000:159-173`, `world_source_revision_superseded` `:152`); the rollback branch exists for a `superseded` target (`20260920120000:357-366`) | **Adopted** M17: `world_rollback` is its own proposal kind over the existing rollback transition, decided by the `world_activation` policy row (§2.1, §3, §10, §10.1) |

**(b) Every option this ADR considered — one row each.**

| # | Question | Option | Decision | Reason |
|---|---|---|---|---|
| O-1 | Who supplies the decider's role | caller passes `p_approver_role` | Rejected | any TS defect or the flag-off path becomes "owner approved" (S-2) |
| O-2 | | the RPC reads it from `foundation_workspace_members` under a share lock | **Adopted** (M1) | the database is the authority; nothing to forge |
| O-3 | What the policy flag does | flag off = policy not evaluated | Rejected | a switch that lifts a stored restriction fails open (S-3) |
| O-4 | | stored policy always enforced; the flag gates writing policies and the surface | **Adopted** (M2) | no row = today either way; a restriction is never lifted by an operator switch |
| O-5 | Where the standing-rule debit happens | separate consume RPC before execution | Rejected | two transactions: confirm-without-debit or debit-without-confirm (S-1) |
| O-6 | | inside `decide_world_change_proposal`, same transaction | **Adopted** (M3) | one commit decides both |
| O-7 | Binding kind of an activation | new kind `active_pointer` | Rejected | a second name for "the collection's Active digest" (S-21, S-22) |
| O-8 | | existing `active_manifest`, `NO_BINDING_DIGEST` when empty | **Adopted** (M4) | one meaning; every binding column stays `^sha256:` |
| O-9 | | a null binding for "no Active World" | Rejected | every binding column and parameter is `^sha256:` (`20261116130100:35`) |
| O-10 | Default role for `world_activation` | `member` | Rejected | the transition refuses non-admins; a member could confirm what can only fail (S-4) |
| O-11 | | `admin` default and floor, `owner` sets the policy | **Adopted** (M5) | the transition RPC's own floor (`20260920120000:262-270`) |
| O-12 | How the activation executor runs | direct `promoteFoundationCandidate` call | Rejected | skips plan gate, rate ceiling and source currency (S-5) |
| O-13 | | the promote route's gate chain, extracted into one function both use | **Adopted** (M6) | the proposal path is never weaker than the route |
| O-14 | How a World goes back | `undo` on the executed activation | Rejected | a one-person Active change past four-eyes and later step-up (S-6) |
| O-15 | | a new `world_activation` proposal to the previous digest | Rejected | the forward chain refuses superseded sources — the common case (r20 B4) |
| O-16 | | its own kind `world_rollback` over the existing rollback transition | **Adopted** (M17) | the transition already has a checked rollback branch; four-eyes applies |
| O-17 | | the direct rollback route only | Kept **only with no approval policy** (§3) | under a policy it is a one-person Active change, so it answers `ACTIVATION_REQUIRES_APPROVAL` |
| O-18 | Which policy decides a rollback | its own `world_rollback` policy row | Rejected | four-eyes on activation could be walked around by a one-person rollback |
| O-19 | | the `world_activation` row (`APPROVAL_POLICY_KEY`) | **Adopted** (M17) | one policy for every Active change; source test pins equal defaults/floor/setter |
| O-20 | What an activation proposal binds | the target digest; the executor re-reads the pointer | Rejected | A→B and A→C both apply; resume hits an idempotency conflict (r20 B2) |
| O-21 | | digest bound, revision re-read at run time | Rejected | A→B→A passes a digest check; a re-read is still a re-read |
| O-22 | | state, revision and digest stored at creation; the executor passes the stored values | **Adopted** (M15) | the CAS refuses any state the approver did not see; the replay hash is stable |
| O-23 | | binding digest = a hash of (state, revision, digest) | Rejected | changes the meaning of `active_manifest` (O-8) and the decide RPC compares against the pointer's digest; the transition's CAS already checks the revision |
| O-24 | How a resume after a failed record runs | re-run the transition with re-read expectations | Rejected | different request hash under the same operation id → `world_transition_idempotency_conflict` |
| O-25 | | re-run with the stored values only | Rejected alone | the replay branch re-checks the actor's authorization and would record an applied effect as `failed` |
| O-26 | | read the receipt by operation id first; else the stored-value call; re-read the receipt after any refusal | **Adopted** (§10.1) | the effect, not the error, decides the recorded outcome |
| O-27 | Number of `world_activation` executors | one in cluster B and one in WO-AN-21 | Rejected | two paths to the same Active change (S-22) |
| O-28 | | one (WO-B-GOV-2); WO-AN-21 adds step-up, scope, tool, proposer widening | **Adopted** (M7) | the step-up then binds every confirmation |
| O-29 | Steward open-proposal cap | as written, via `p_open_limit` | Rejected | the base RPC refuses `p_open_limit` for non-agents (`20261117130000:354`) |
| O-30 | | counted in TS | Rejected | races |
| O-31 | | body of `create_world_change_proposal` replaced, signature unchanged | **Adopted** (M8) | counted under an advisory key in the same transaction |
| O-32 | Rule scope and credit floor | checked in TS | Rejected | a TS defect confirms out of scope or debits 0 (S-10, S-11) |
| O-33 | | checked in SQL inside decide | **Adopted** (M9) | |
| O-34 | How a standing rule executes | the same `decideProposal` path as the creator | Rejected | needs the creator's live session (r20 B3) |
| O-35 | | mint a session or token for the creator | Rejected | a forged identity; the constitution's self-approval and secret rules |
| O-36 | | internal worker-secret path; creator's membership in SQL; creator's id as actor | **Adopted** (M16) | no session needed; every session check mapped in §4.1, unmapped ones OPEN |
| O-37 | | ask the creator to click each time | Rejected | that is not a standing rule; it is today's path, which stays available |
| O-38 | Source access on the rule path | the TS per-viewer check by user id | Rejected | not SQL (the ruling); its SQL function is not registered |
| O-39 | | `connector_documents_blocked` in SQL, connector-bound documents refused until a per-viewer SQL check exists | **Adopted** (§4 step 6) | fail closed; uploads keep working |
| O-40 | | no access check on the rule path | Rejected | a lost source would compile |
| O-41 | Plan gate on the rule path | id-based TS read before the RPC, listed OPEN | **Adopted for now** (§4.1 T4) | no SQL plan read exists; the window is named, not hidden |
| O-42 | Consent for new agent tools | consent-version column and `CONSENT_OUTDATED` | Rejected | a changed sentence covers old grants that never saw it (S-12) |
| O-43 | | a new scope per new sentence (rule C1) | **Adopted** (M10) | opt-in is explicit; no new mechanism |
| O-44 | Grant body | `{clientLabel, steward?: boolean}` | Rejected | one boolean per future scope |
| O-45 | | `{clientLabel, optionalScopes?: string[]}` | **Adopted** (M11) | fixed shape as scopes arrive |
| O-46 | `run_skill` through the agent | read and propose Skills | Rejected | a tool declared read would file proposals (S-16) |
| O-47 | | read-mode Skills only | **Adopted** (M12) | one mode per tool |
| O-48 | `/governance` flip owner | WO-AN-16 | Rejected | two flippers for one route |
| O-49 | | WO-B-GOV-FLIP only | **Adopted** (M13) | `[LR 1]` |
| O-50 | `/steward` flip owner | WO-B-STW-FLIP | Rejected | the A2 receipt comes from WO-KS-8 |
| O-51 | | WO-KS-9 | **Adopted** (M14) | `[LR 1]` |
| O-52 | Where the ontology patch runs | Core `evaluate_ontology_patch` now | Rejected | Protected Core ladder (contract → shadow → benchmark → canary) |
| O-53 | | Product-side | **Adopted** (§8) | `[LR 16]` |
| O-54 | Who writes steward and brief sentences | a TAVONEL-hosted model | Rejected | `[MP 229]`, `[LR 16]`; no model on customer data |
| O-55 | | server templates over durable facts | **Adopted** (§0) | |
| O-56 | Decide vs role-change lock order (S-17) | reorder the existing role-change locks | Rejected | edits a shipped function outside this cluster for a liveness-only gain |
| O-57 | | accept: one side aborts with 40P01, nothing written | **Accepted residual** | both sides fail closed; B-01 race harness shows it |
| O-58 | A sole owner lowers four-eyes, acts, restores it (S-19) | forbid policy changes by a sole owner | Rejected | would lock a one-person workspace out of its own settings |
| O-59 | | accept; every change is a signed trail event | **Accepted residual** | visible, not prevented |

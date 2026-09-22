# Router shadow rollout

How the adaptive model router goes from "implemented, zero rows" to "running in shadow on real
production traffic", and what it has to produce before anyone may call `canary`.

Status on 2026-09-21: every control-plane table is empty
(`adaptive_router_policy_revisions`, `adaptive_router_rollout_heads`, `adaptive_router_assignments`,
`adaptive_router_evidence_receipts`, `adaptive_router_state_events`,
`foundation_model_attempt_receipts`). Shadow is the first rung of
`compatibility contract -> shadow -> benchmark -> canary -> rollout -> deprecate`, and no rung
above it has been reached. Nothing in this document is a measured result.

---

## 1. The scope, and how many of them there are

A rollout is bound to a **scope digest**, not to a workspace. The digest covers four fields
(`adaptiveRouterScopeDigest`, `lib/adaptive-router-control-plane-store.ts`):

| field | source at request time |
| --- | --- |
| `workspaceKey` | the authenticated principal |
| `collectionId` | the route parameter |
| `endpoint` | `"ask"` or `"search"` — the calling route |
| `retrievalProfileDigest` | `contentAddressedRetrievalProfileIdentity(profile).digest` |

`resolve_adaptive_router_policy_v1` selects rollout heads by `scope_digest = $1` and raises
`adaptive_router_policy_unavailable` unless **exactly one** head matches. Consequences:

- **There is no workspace-wide or default scope.** A scope is per collection *and* per endpoint,
  so a workspace with `N` collections needs `2N` policy revisions and `2N` rollout heads to be in
  shadow everywhere. Seeding one collection puts one collection in shadow; the rest keep the
  fixed control, which is the intended behaviour, not a gap.
- The profile digest is in the scope, so a change to the retrieval profile (a new BGE revision, a
  changed chunking or instruction field) silently produces a *different* scope. The old head stops
  matching and the request path falls back to `policy_unavailable` -> fixed control. That is
  fail-safe, but it means **a profile change ends a shadow run**; re-seed after it.
- Making a scope broader (workspace-wide, endpoint-agnostic) is not an additive change: the digest
  is the join key for the policy row, the head row and the attempt lineage trigger. It would be a
  new `adaptiveRouterScopeDigest` version, a new policy schema version and a migration. Do not do
  it to save typing; seed the scopes you actually want in shadow.

## 2. Candidates: what shadow can and cannot compare

`resolveConfiguredProductionRetrievalRuntime` builds the candidate set through
`buildAdaptiveRouterCandidateSet` (`lib/retrieval-runtime-config.ts`). Until 2026-09-21 it built
**exactly one** candidate — the fixed BGE control (`BAAI/bge-m3` + `BAAI/bge-reranker-v2-m3` on
RunPod TEI). That made shadow unreachable, and worse than unreachable:

> `loadAdaptiveRouterPlan` rejects a resolved policy whose `orderedCandidateKeys` contain no key
> other than the control (`challengerKeys.length === 0`). The rejection is
> `ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID`, which `resolveConfiguredProductionRetrievalRuntime`
> returns as `ok: false`, which `/search` and `/ask` return as **HTTP 503
> RETRIEVAL_RUNTIME_UNAVAILABLE**. Seeding a shadow policy without a declared challenger takes the
> scope offline. It does not "just collect evidence".

A challenger is now declared in `TAVONEL_ADAPTIVE_RETRIEVAL_CHALLENGER_JSON`, and it is
deliberately narrow:

- **model and revision are inherited from the control and cannot be restated.** Only `provider`,
  `endpointId`, `region`, `retentionDays`, `price`, `estimatedLatencyMs`, `circuit` and
  `indexStatus` are declarable.
- The reason is the compiled index. A query is answered from one pgvector index built in the
  control's embedding space. A candidate from another model family produces vectors that are not
  comparable to that index, and `assessCandidate` would reject it for
  `RETRIEVAL_PROFILE_MISMATCH` anyway. **A second embedding family needs a second compiled index
  in its own space before it can be a retrieval challenger — that is an indexing workstream, not a
  configuration entry.**
- Therefore, plainly: **today shadow can only measure a second endpoint of the same model.** It
  measures availability, latency, circuit behaviour, price and dispatch path. It says nothing
  about answer quality, and the report refuses to imply otherwise.
- A challenger is never dispatched in shadow (`shadowEvaluation.dispatchAllowed` is `false`), and
  challenger entries carry the control's runtime, so if a later rollout state ever selected one
  for execution, `selectAdaptiveProductionRetrievalRuntime` refuses with
  `CONTROL_INTEGRITY_MISMATCH` rather than answering from an unbound adapter.

If no second endpoint exists yet, the honest options are (a) deploy a second TEI endpoint of the
same pinned revision and shadow the dispatch path, or (b) leave the router at fixed control and
say so. Seeding a policy to make a table non-empty is not option (c).

## 3. What a shadow rollout is, as rows

Three writes, in this order, all as `service_role`. `scripts/router/seed-shadow-rollout.mjs` does
all three; this is what it does, so a reader can verify it rather than trust it.

1. **`adaptive_router_evidence_receipts`** — one row. Required because
   `adaptive_router_policy_revisions.evidence_receipt_id` is `not null`. For shadow entry the
   receipt states `stage: "shadow_entry"`, `measurement: "none"`, `thresholdResults: {}`, and
   `corpusDigest` / `evaluatorDigest` are digests of explicit "none" declarations. It is a
   structural row, not a claim. `evidence_digest` is derived **in PostgreSQL** by
   `adaptive_router_canonical_digest_v1(receipt, ARRAY['evidenceDigest'],
   'tavonel.adaptive_router_evidence.v1')`; the table's `check` recomputes it, so a client-side
   digest that disagrees is rejected rather than trusted.
2. **`adaptive_router_policy_revisions`** — one row, `policy_revision = 1`. The JSONB body carries
   `routerPolicy` (`mode: "shadow"`, `canaryPermille: 0`, `orderedCandidateKeys`) plus the five
   digests the runtime recomputes on every request:
   `scopeDigest`, `candidateSetDigest`, `indexStateDigest`, `thresholdsDigest` and the derived
   `policyDigest`. **`orderedCandidateKeys` must contain the control key**, first: the
   `foundation_model_attempt_decisions` lineage trigger requires both `control_id` and `chosen_id`
   to be members, and in shadow the chosen candidate *is* the control. Omit it and every model
   attempt raises `model_attempt_decision_control_binding_invalid`, dense retrieval degrades to
   lexical, and the rollout produces no evidence.
3. **`transition_adaptive_router_rollout_v1`** with `p_expected_state = 'none'`,
   `p_next_state = 'shadow'`, `p_expected_rollout_revision = 0`. This is the only writer of
   `adaptive_router_rollout_heads` (a trigger rejects any other write), and it appends
   `adaptive_router_rollout_revisions` and `adaptive_router_state_events` in the same transaction.
   It is idempotent on `operation_id`: a replay returns `status: "replayed"` with the original
   receipt digest.

Rollout states are `shadow | canary | active | rolled_back | disabled`. The permitted graph is
`none->shadow`, `shadow->{canary,disabled}`, `canary->{active,rolled_back,disabled}`,
`active->{rolled_back,disabled}`, `rolled_back->disabled`. There is no edge back into `shadow`:
a scope that is disabled needs a new policy revision, because policy rows are append-only.

Every identifier the seed script writes (`policy_id`, `receipt_id`, `operation_id`, `event_id`) is
derived from the scope, so re-running it is a no-op rather than a second rollout.

## 4. What one production request persists in shadow

Assuming the scope is in shadow, the collection has a compiled index, and the adaptive control
config is deployed:

| # | write | by | when it fails |
| --- | --- | --- | --- |
| 1 | `adaptive_router_assignments` — one row per `(policy revision, request digest, workspace digest)` | `resolve_adaptive_router_policy_v1`, server side | the RPC raises; the loader returns `policy_unavailable` and the request keeps the fixed control |
| 2 | `foundation_model_attempt_decisions` — `chosen_id` = control, `shadow_id` = the candidate the policy preferred, plus policy/rollout/assignment lineage | `attemptLifecycle.admit`, before the provider call | dispatch is refused with `MODEL_ATTEMPT_DECISION_UNAVAILABLE`; dense retrieval degrades to lexical and the answer is still returned, named in `degradations` |
| 3 | `foundation_model_attempt_outcomes` | `recordTerminal`, after the provider call | the result is withheld and the request degrades |
| 4 | `foundation_model_attempt_receipts` | the route, after the pipeline, only when a model was actually attempted | the route returns 503 `MODEL_ATTEMPT_RECEIPT_UNAVAILABLE` — a paid result is never released without its receipt |

The assignment is keyed by a digest of the request id, and the request id is
`sha256(collectionId + "\n" + normalized query)`. Two identical questions therefore share one
assignment row. Assignment count is a count of *distinct questions*, never of requests; the report
prints attempts separately for that reason.

Rows 2–4 are the same rows a fixed-control request writes. **The only thing that makes a row
shadow evidence is `shadow_id`.** `lib/retrieval-pipeline.test.ts` asserts it is written.

Failure posture: a router evidence failure degrades the answer (rows 2–3) or withholds a paid
result (row 4); it never fails a lexical-only answer. The one fail-closed path is a *malformed*
control plane response (`ADAPTIVE_ROUTER_CONTROL_PLANE_INVALID` / `_FAILED`) — see §2 — which does
503 the endpoint. That is deliberate: a policy the runtime cannot verify must not select a model.

## 5. Preconditions for `shadow -> canary`

`transition_adaptive_router_rollout_v1` enforces these, and refuses with the named exception:

- `p_expected_state = 'shadow'`, `p_next_state = 'canary'`, and the CAS arguments must equal the
  live head row **exactly** — revision, policy revision and all six digests
  (`adaptive_router_transition_compare_and_swap_conflict`).
- The policy revision's columns must equal the arguments
  (`adaptive_router_policy_binding_invalid`).
- The bound evidence receipt must cover the policy validity window
  (`adaptive_router_evidence_binding_invalid`) **and be current at the moment of the transition**
  (`adaptive_router_evidence_not_current`). The shadow-entry receipt satisfies the first and, if
  still inside its window, the second — which is why the receipt's *content* is the real gate, not
  the SQL. A canary must cite a receipt whose `thresholdResults` carry real, independently
  evaluated shadow outcomes.
- No `global_kill_switch` and no `policy` revocation may be in effect
  (`adaptive_router_kill_switch_engaged`).
- Canary executes the challenger for a share of traffic, so it needs `candidateBasisPoints > 0`.
  Policy rows are immutable: that is a **new policy revision (2)** with its own digests, its own
  evidence receipt, and a CAS transition that names it. Editing revision 1 is impossible by
  trigger.

Beyond the database, `evaluateAdaptiveRouterActivation` (`lib/router-activation-gate.ts`) is the
operator preflight: it requires five independent, unique, passing, chronologically consistent
evidence receipts (`arena`, `oracle`, `familyHoldout`, `shadow`, `canary`) sealed under one
contract digest. Run it before calling the transition.

**One authority.** Candidate execution is switched on by `adaptive_router_rollout_heads.state`
plus `candidateBasisPoints`, inside `resolve_adaptive_router_policy_v1`. The TypeScript gate is
*not* wired into the request path and must not be: two switches that can disagree produce "code
says off, database says active". `lib/router-activation-authority.test.ts` enforces that no
module under `app/`, `lib/` or `components/` imports it.

Kill switch, at any time:

```sql
insert into public.adaptive_router_revocations
  (revocation_id, revocation_kind, evidence_digest, reason, effective_at)
values (gen_random_uuid(), 'global_kill_switch', '<an existing evidence_digest>',
        'reason, 8-500 chars', now());
```

It takes effect on the next request: `resolve_adaptive_router_policy_v1` raises
`adaptive_router_kill_switch_engaged`, the loader reports `policy_unavailable`, and every scope
returns to the fixed control. It does not wait for a deploy.

## 6. Commands

Preconditions in the environment the command runs in (the same values production has, or the
digests will not match): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`TAVONEL_RETRIEVAL_EMBEDDER_URL`, `TAVONEL_RETRIEVAL_RERANKER_URL`, `TAVONEL_RUNPOD_API_KEY`,
`TAVONEL_RETRIEVAL_MODEL_REGISTRY_JSON`, `TAVONEL_ADAPTIVE_RETRIEVAL_CONTROL_JSON`,
`TAVONEL_ADAPTIVE_RETRIEVAL_CHALLENGER_JSON`.

```bash
cd nextjs

# 1. Dry run. Prints the scope digest, the candidate keys, every row it would write, and nothing
#    else. It refuses, with the reason, if no challenger is declared or no embedder is admitted.
pnpm router:seed:shadow -- --workspace <workspaceKey> --collection <collectionId> --endpoint both

# 2. Seed. Idempotent; a second run inserts nothing and replays the transition receipt.
pnpm router:seed:shadow -- --workspace <workspaceKey> --collection <collectionId> \
  --endpoint both --execute

# 3. Read the evidence back (after real traffic).
pnpm router:shadow:report -- --hours 24
pnpm router:shadow:report -- --hours 168 --markdown > shadow-evidence.md
```

Inspecting the same thing in SQL, for a reviewer who will not run the script:

```sql
-- rollout state per scope
select policy_id, state, rollout_revision, policy_revision, scope_digest, valid_from, valid_until
  from public.adaptive_router_rollout_heads order by updated_at desc;

-- every accepted transition, with its receipt digest
select policy_id, rollout_revision, from_state, to_state, receipt_digest, recorded_at
  from public.adaptive_router_state_events order by recorded_at desc;

-- assignments: one per distinct question per policy revision
select policy_id, variant, count(*) , max(assigned_at)
  from public.adaptive_router_assignments group by 1, 2;

-- the shadow signal: how often the policy preferred something other than what answered
select d.endpoint, d.attempted_role,
       count(*) as attempts,
       count(*) filter (where d.shadow_id is not null) as with_shadow_proposal,
       count(*) filter (where o.outcome = 'succeeded') as succeeded
  from public.foundation_model_attempt_decisions d
  left join public.foundation_model_attempt_outcomes o using (attempt_id)
 where d.admitted_at >= now() - interval '24 hours'
 group by 1, 2;

-- what a canary would be citing
select receipt_id, evidence_digest, receipt->>'stage' as stage,
       receipt->'thresholdResults' as thresholds, valid_from, valid_until
  from public.adaptive_router_evidence_receipts order by recorded_at desc;
```

Transition to canary, once the evidence exists and a person has approved it. Every argument must
equal the live head row; read it first, and note the **new** policy revision:

```sql
select * from public.transition_adaptive_router_rollout_v1(
  gen_random_uuid(),           -- p_operation_id (idempotency key; keep it)
  gen_random_uuid(),           -- p_event_id
  '<policy_id>'::uuid,
  <rollout_revision from the head row>,
  'shadow', 'canary',
  <new policy_revision with candidateBasisPoints > 0>,
  '<policy_digest>', '<evidence_digest>', '<thresholds_digest>', '<scope_digest>',
  '<candidate_set_digest>', '<index_state_digest>',
  <control_revision>, <candidate_revision>, <rollback_revision>,
  '<valid_from>'::timestamptz, '<valid_until>'::timestamptz,
  'canary after shadow evidence <digest>, approved by <name> on <date>'
);
```

## 7. What this does not do

- It does not make the router adaptive. Shadow executes the control for every request, always.
- It does not compare model quality. See §2.
- It does not calibrate a threshold. No threshold in this repository is calibrated.
- It does not authorise canary. That is a founder decision over a real evidence receipt.

# Unwired inventory — 2026-09-22

Lane `wiring`, branch `agent/no1-wiring-20260922`, base `origin/main` 9370681.

What this is: every exported symbol under `nextjs/lib`, `shared/` and `server/` that is
(a) imported by no non-test file, (b) behind an env flag or activation-policy row that is off
in production, or (c) a migration RPC with no TypeScript caller — with a recommendation for each.

No network call, no provider call, no migration application and no deployment was performed
while producing it.

## How the sweep was run

Module/importer graph (379 modules scanned, 27 with zero non-test importers):

```bash
git -C . ls-files nextjs/lib shared server nextjs/app/api        # candidate modules
git -C . ls-files "*.ts" "*.tsx" "*.mts" "*.mjs" "*.js"          # every possible importer
```

Every relative and `@/`-aliased `import … from`, `export … from` and `import()` specifier in the
second list was resolved to a basename and matched against the first. An importer counts as
non-test unless its path matches `.test.` · `.spec.` · `__tests__` · `/eval/` · `/tests/`.
`nextjs/app/api/**` is excluded from the orphan set: a Next.js route file is reached by the
router, not by an import.

Env flags:

```bash
git grep -hoE '(process\.env\.|env\.|env\[")(TAVONEL_[A-Z0-9_]+|NEXT_PUBLIC_[A-Z0-9_]+)' \
  -- nextjs shared server scripts | grep -oE '(TAVONEL|NEXT_PUBLIC)_[A-Z0-9_]+' | sort | uniq -c
```

Migration RPCs with no TypeScript caller:

```bash
git grep -hoE 'create (or replace )?function (public\.)?[a-z0-9_]+' -- 'supabase/migrations/*.sql' \
  | grep -oE '[a-z0-9_]+$' | sort -u > rpcs.txt                  # 157 functions
while read r; do git grep -qF "$r" -- nextjs shared server scripts || echo "$r"; done < rpcs.txt
```

## Counts

| Recommendation | Rows | Where |
| --- | --- | --- |
| WIRE NOW | 1 | §1 — done in this lane |
| WIRED this lane, founder-approved | 1 | §4 — spend reconciliation endpoint |
| WIRE WITH FLAG | 4 | §4 (3), §6 (1) |
| KEEP OFF (founder) | 18 | §2 (10), §4 (3), §6 (5) |
| DELETE | 8 | §3 |
| KEEP AS-IS — not a gap | 5 | §4 |
| Already wired, re-verified here | 5 | §1 |

The single largest structural fact: **17 of the 27 zero-importer modules are not a wiring gap at
all.** `shared/` and `server/` are the *legacy root runtime*, and `shared/activationPolicy.ts`
disables all four of its capabilities with the reason "Production … is owned by the separately
deployed Next.js policy." They are unwired because the product moved, which is a deprecation
decision, not a wiring one.

---

## 1. Paid-provider spend and circuit — the 2026-09-20 audit's headline finding

The router frontier audit (`verification/ROUTER_FRONTIER_AUDIT_2026-09-20.md` §3, §5) recorded
`runReservedModelProviderCall` / `reserveModelProviderSpend` / `settleModelProviderSpend` as having
no production caller, the RunPod adapters as calling their endpoints directly, and ambiguous
post-dispatch failures as settling zero. **All three were closed on `origin/main` between the audit
and this lane's base commit.** Re-verified here rather than re-implemented.

| Symbol | File | What it does | Why it exists | Status |
| --- | --- | --- | --- | --- |
| `runReservedModelProviderCall` | `nextjs/lib/model-provider-spend.ts` | Reserve → dispatch → measured settle | `supabase/migrations/20260920131000_model_provider_spend_control.sql` | WIRED — reached via `runGovernedModelProviderCall` |
| `runGovernedModelProviderCall` | `nextjs/lib/model-provider-dispatch.ts` | The sole paid-provider execution boundary: circuit read → spend hold → circuit admission → one callback → settle + outcome | audit §3/§4 closure items 2 and 4 | WIRED — `retrieval-model-provider-governance.ts` |
| `governEmbedderAdapter` / `governRerankerAdapter` | `nextjs/lib/retrieval-model-provider-governance.ts` | Wraps both RunPod adapters | — | WIRED — `createProductionEmbedderAdapter` / `…RerankerAdapter` |
| `markModelProviderSpendIndeterminate`, `reconcileModelProviderSpend` | `nextjs/lib/model-provider-spend.ts` | Post-dispatch ambiguity keeps the hold for reconciliation instead of settling a false zero | audit §3 | WIRED (mark) / **NOT WIRED (reconcile)** — see §4 |
| `buildPublicRetrievalRoute` | `nextjs/lib/model-attempt-receipt.ts` | Maps internal degradation strings to `routeClass` + bounded `degradationClasses` | audit §5 public-DTO boundary | WIRED — `/search` and `/ask` |

Three properties that were checked, not assumed:

- **No silent bypass.** A ledger or circuit failure returns a code from
  `runGovernedModelProviderCall`; the governance wrapper turns that into an adapter
  `status: "error"`, and `retrieval-pipeline.ts:231` degrades to lexical+structure with
  `dense retrieval skipped: <code>` (reranker: `reranker not applied: <code>`). The paid call does
  not happen, and the degradation is named in the existing vocabulary.
- **The internal code never reaches the customer.** `degradationClasses()` matches only the three
  prefixes and emits `dense_unavailable` / `reranker_unavailable` / `structure_unavailable`. A raw
  `MODEL_PROVIDER_GLOBAL_SPEND_BREAKER_OPEN` cannot cross the public DTO.
- **`runtime.decision` is out of the public DTO already.** In both `/search` and `/ask` it appears
  only as `modelRoute:` into `persistRetrievalModelAttempt` (the internal receipt). The responses
  carry `routeClass` and `degradations` only. MCP/CLI parity
  (`nextjs/lib/b30-api-mcp-cli-parity.test.ts`) and the OpenAPI document were therefore not touched.

**WIRE NOW — done in this lane** (commit `5aaaaa3`):

| Symbol | File | Gap | Fix |
| --- | --- | --- | --- |
| `readModelProviderCircuitSnapshot` | `nextjs/lib/model-provider-circuit-store.ts` | Durable breaker state was written by dispatch and read by no operator surface; `evaluateOperationalSli` monitored `coreV2`/`r2`/`db` only, so an open breaker looked green | `evaluateOperationalSli` takes already-read snapshots and emits `modelProviders` + two warning reasons; `/api/operator/status/v1` and `/api/internal/sli-alerts` supply them |

Semantics chosen deliberately: an open breaker is **warning → `degraded`, never `blocked`**. The
customer still gets an answer with a named degradation, so blocking the status page would be a
worse description of reality than degrading it. An unreadable circuit reports `unavailable`, never
`closed` — a broken operator read is never a green one.

---

## 2. Legacy root runtime — `shared/` and `server/`, off by activation policy

`shared/activationPolicy.ts` sets `customerIntake`, `cdr`, `ocrGpu` and `candidatePromotion` all to
`enabled: false`. The root `package.json` still builds this tree
(`esbuild server/_core/index.ts`), but the deployed product is `nextjs/` (`next build`). Everything
in this section is unwired because the runtime was superseded.

**Recommendation for the whole section: KEEP OFF (founder).** The switch and preconditions are in
§5. Nothing here should be wired by an agent.

| Symbol(s) | File | What it does | Risk of wiring | Effort |
| --- | --- | --- | --- | --- |
| `decideGpuDispatch`, `settleGpuReservation` | `server/foundation/gpuDispatchService.ts` | Credit-budget guarded GPU dispatch decision | Runaway GPU spend on a second, ungoverned dispatch path | days |
| `bindImmutableSourceProof`, `metadataOnlyObjectStoreAdapter` | `server/foundation/immutableObjectProofAdapter.ts` | Binds a quarantine upload to an immutable object proof | Duplicate source-of-truth for artifact immutability | days |
| `createCheckoutIntent` | `server/foundation/paddleCheckout.ts` | Checkout intent; every `livePriceId` is `null` | Pricing is a founder call | hours |
| `verifyPaddleWebhookSignature`, `projectPaddleEntitlement` | `server/foundation/paddleWebhook.ts` | Paddle webhook verification and entitlement projection | Billing truth; needs the live secret | hours |
| `aclSnapshotSha256`, `intersectAcl` | `shared/aclSnapshot.ts` | Derived knowledge may never out-permit its sources | Cross-tenant leak if wired to the wrong read | days |
| `assertCandidateIsNotActive`, `evaluateAtomicPromotion` | `shared/candidateWorldContract.ts` | Atomic candidate→active promotion | World-state partial publish | days |
| `bindGpuReceiptToProof`, `decideCandidateReview` | `shared/documentProcessing.ts` | GPU receipt / CDR proof binding | Same as above | days |
| `decideOcrReleaseQualification` | `shared/ocrReleaseQualification.ts` | Synthetic RunPod OCR release qualification | Paid provider | hours |
| `projectJobToCoreWire`, `roundTripCompileJob`, … | `shared/productCoreFieldMap.ts` | Core v2 wire field map + round-trip | Second serialization authority | days |
| `evaluateTrialCreditEligibility` | `shared/trialCredits.ts` | `trialCreditPolicy.enabled === false`, with the reason in the file | Anti-abuse and identity are unbuilt; the file says so | days |

---

## 3. Template scaffolding — `server/_core`

Zero importers, zero tests, and no relation to the product. These arrived with the project
template (`template.json`, `client/`, `vite.config.ts`) and integrate third-party paid APIs that
nothing calls.

**Recommendation: DELETE** (8 rows). Each is an unreviewed credential-bearing outbound path kept
alive only by the legacy root build, which is exactly the surface "unlicensed component in
production" exists to stop. Deleting is subtractive and needs the founder's go-ahead on retiring
the root build, not an agent's.

| File | Exports | Note |
| --- | --- | --- |
| `server/_core/llm.ts` | `invokeLLM`, `listLLMModels` | A second, ungoverned LLM path with no spend ledger |
| `server/_core/imageGeneration.ts` | `generateImage`, `listImageModels` | Not a product capability |
| `server/_core/voiceTranscription.ts` | `transcribeAudio` | Not a product capability |
| `server/_core/map.ts` | `makeRequest`, geocoding/directions types | Not a product capability |
| `server/_core/heartbeat.ts` | `createHeartbeatJob`, … | Superseded by the synthetic probe |
| `server/_core/dataApi.ts` | `callDataApi` | Superseded by `supabase-admin.ts` |
| `server/storage.ts` | `storagePut`, `storageGet`, `storageGetSignedUrl` | Superseded by the R2 signer |
| `nextjs/lib/landing-frames.ts` | `LANDING_FRAMES` | Nothing renders it; the landing rebuild replaced it. Its test still asserts the files exist |

---

## 4. `nextjs/lib` — the live runtime's own orphans

| Symbol(s) | File | What it does | Why it exists | Risk | Effort | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| `reconcileModelProviderSpend` | `nextjs/lib/model-provider-spend.ts` | Resolves a reservation parked as `pending_reconciliation` against the provider invoice | `…_model_provider_spend_control.sql`; audit §3 closure item 2 | Needs a real invoice; inventing units would be fabricated cost data | ~1 day | **WIRED 2026-09-22** — `app/api/internal/model-provider/reconcile/route.ts`, bearer-guarded, POST-only so nothing can schedule it, human-supplied units |
| `issueDeletionEvidence` | `nextjs/lib/operations-p0.ts` | Refuses a deletion receipt unless storage is empty, DB lookup is empty, backup expiry is recorded and the audit digest is valid | `docs/runbooks/P0_RETENTION_DELETION_RESTORE.md` step 6; `nextjs/app/privacy/page.tsx:134` publicly states nothing calls it | Irreversible customer-data deletion | ~1 day | **WIRE WITH FLAG** — belongs to the `deletion` lane, not this one; pairs with `refresh_source_deletion_inventory` (§6) |
| `handleScimProvisioningRequest`, `handleSsoCallbackBoundary` | `nextjs/lib/enterprise-identity-route-boundary.ts` | SCIM provisioning and SSO callback boundaries; both take `runtimeEnabled` | Enterprise identity | Auth bypass; needs per-tenant IdP config | ~1 day | **WIRE WITH FLAG** — routes exist to be added, but only with a tenant IdP registry the founder supplies |
| `generateGroundedAnswer`, `GeneratorAdapter` | `nextjs/lib/generator-adapter.ts` | Verifies every citation against the ContextPacket before an answer counts as grounded | File's own STATUS note: enforcement contract, no provider integration exists | Model choice, paid API, unsupported claims | days | **KEEP OFF (founder)** — needs a model decision and an Arena receipt |
| `evaluateAdaptiveRouterActivation`, `hashAdaptiveRouterEvidenceContract` | `nextjs/lib/router-activation-gate.ts` | Refuses adaptive-router activation without arena/oracle/holdout/shadow/canary receipts | v5 lines 1770–1815, 2283–2300 | Activating a router with no holdout evidence | — | **KEEP OFF (founder)** — decided: operator preflight only. §5 |
| `projectSourceLedger`, `recordSourceLedger`, `readSourceVersion` | `nextjs/lib/source-domain-store.ts` | Universal source-domain ledger projection and durable write | `docs/UNIVERSAL_SOURCE_DOMAIN_2026-09-06.md` §; `docs/uskc/USKC_LANE_REPORT_AB.md` §10.1 | A second identity authority for sources | days | **KEEP OFF (founder)** — USKC program item, replacement ladder applies |
| `activationCohorts`, `cohortCounts`, `experimentReading` | `nextjs/lib/activation-cohorts.ts` | Pure cohort readings over server records, §15.3/§15.4 | Deduplicated cohorts, deliberately separate from `funnel-events.ts` | Growth analytics only | hours | **KEEP AS-IS** — analysis library; wiring means a founder-approved analytics surface |
| `KEYWORD_SEEDS`, `validateKeywordRecord`, `hardGateBlockers` | `nextjs/lib/keyword-map.ts` | Search-demand seeds with every numeric field `null` and `measurement: "UNMEASURED"` | WG-068/069/070 are account-gated founder items | Publishing an unmeasured number | — | **KEEP AS-IS** — refuses to carry a figure it cannot source |
| `B33_TASKS`, `validateB33HomeTaskStudy` | `nextjs/lib/b33-home-task-study.ts` | Home-page task study definition; `B33_FOUNDER_REVIEW` | Founder visual review | — | — | **KEEP AS-IS** — study spec, not runtime |
| `PROMPT_INJECTION_FIXTURES`, `quotedFieldsRemoved` | `nextjs/lib/prompt-injection.fixtures.ts` | §40 red-team corpus, nine classes | S-78/S-79 | — | — | **KEEP AS-IS** — test corpus by construction |
| `buildLexicalSearchQuery` | `nextjs/lib/lexical-search.ts` | Parameterized Postgres FTS query | `supabase/migrations/0022_…` and `0023_retrieval_search_rpc.sql:12` name it the source of truth the RPC mirrors; `retrieval-search-rpc-migration.test.ts:50` asserts the mirror | Deleting it removes the specification the deployed RPC is tested against | — | **KEEP AS-IS** — *not* dead code. Same for `dense-search.ts` |

---

## 5. Env flags read anywhere, and their production-default behaviour

| Flag | Read at | Production default | Effect when unset |
| --- | --- | --- | --- |
| `TAVONEL_RETRIEVAL_EMBEDDER_URL` | `retrieval-runtime-config.ts:72` | set | No dense retrieval; `RUNTIME_NOT_CONFIGURED` → `lexical_structure` |
| `TAVONEL_RETRIEVAL_RERANKER_URL` | same | set | No rerank; → `rrf_fused_order` |
| `TAVONEL_RUNPOD_API_KEY` | same | set (Production scope only) | Both adapters null; preview deployments degrade |
| `TAVONEL_RETRIEVAL_MODEL_REGISTRY_JSON` | `retrieval-model-registry.ts:1` | set | Registry admission fails closed; both roles degrade |
| `TAVONEL_ADAPTIVE_RETRIEVAL_CONTROL_JSON` | `retrieval-runtime-config.ts:178` | **unset** | Adaptive routing off; fixed control path. **Do not set — §5 preconditions below** |
| `TAVONEL_DURABLE_WORKSPACE_GUARDS` | `workspace-operation-guard.ts:74` | implied by `VERCEL_ENV=production` | Durable guards on in production regardless |
| `TAVONEL_BILLING_LAUNCH_APPROVED` | `commercial-state.ts:50` | **unset** | Billing launch not approved. Founder-only |
| `TAVONEL_CSP_ENFORCE_NONCE` | `csp-policy.ts:151` | **unset** | Nonce enforcement off; report-only. Preview-first per the file's own runbook |
| `TAVONEL_PROBE_OCR_HEALTH` | `synthetic-probe.ts:301` | **unset** | OCR probe `not_probed`, reason `gpu_spend_gate` |
| `TAVONEL_PROBE_FIXTURE_E2E` | `synthetic-probe.ts:338` | **unset** | Fixture E2E not run; `not_enabled` |
| `NEXT_PUBLIC_LANDING_EXPERIMENT` | `landing-experiments.ts:129` | **unset** | Absolute off: arm-B strings render nowhere |
| `NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED` | `app/layout.tsx:256` | **unset** | Vercel `<Analytics />` not mounted |
| `TAVONEL_EXPORT_SIGNING_*` (3) | export signing | set | Signed export refuses |
| `TAVONEL_OAUTH_SECRET_*` (3) | connector secret broker | set | Connector OAuth refuses |
| `TAVONEL_LEGAL_*` (6) | legal imprint | set | Imprint renders incomplete |
| `TAVONEL_API_KEY`, `TAVONEL_BASE_URL`, `TAVONEL_ORIGIN`, `TAVONEL_URL`, `TAVONEL_PUBLIC_ORIGIN`, `TAVONEL_RECIPE_BASE_URL`, `TAVONEL_RELEASE_COMMIT_SHA` | clients, scripts | set | — |
| `TAVONEL_VERIFY_PYTHON`, `TAVONEL_UPDATE_LANDING_SNAPSHOT`, `TAVONEL_QUALIFICATION_WORKSPACE`, `TAVONEL_RUNPOD_SMOKE_TIMEOUT_MS` | verification scripts | unset | Tooling only, never a request path |

### KEEP OFF — the exact switch and its preconditions

**Adaptive router** — switch: set `TAVONEL_ADAPTIVE_RETRIEVAL_CONTROL_JSON` to a
`tavonel.adaptive_retrieval_control.v1` object *and* have the control-plane store return a
digest-bound current policy (`adaptive-router-control-plane-store.ts`). Both are required; either
alone leaves the fixed path. Preconditions, all founder-owned, all currently unmet — this is what
`evaluateAdaptiveRouterActivation` refuses without:

1. Arena receipt: frozen inputs, settings and price snapshot, per candidate family.
2. Oracle Dataset built and frozen.
3. Family-level train / calibration / **holdout** split, with the holdout gate passed.
4. Shadow comparison report with oracle regret and trust-violation counts.
5. Canary stage receipt.
6. A human-approved policy version recorded in the control plane.

Anything less and `evaluateAdaptiveRouterActivation` returns a refusal. It is operator preflight
by decision; do not call it from a request path.

**Billing launch** — switch: `TAVONEL_BILLING_LAUNCH_APPROVED=true`. Preconditions: live Paddle
price IDs (all `livePriceId` are `null` today), the webhook secret, and pricing — three founder
calls listed in the constitution's "not an agent's call".

**Trial credits** — switch: `trialCreditPolicy.enabled` in `shared/trialCredits.ts`. The file
states its own preconditions: verified identity, anti-abuse persistence, sanitized-only
processing, explicit activation approval.

**Legacy root runtime capabilities** — switch: the four `enabled` flags in
`shared/activationPolicy.ts`. Precondition: a founder decision that the legacy root runtime is
production again. It is not, and the recommendation is deprecation, not activation.

**CSP nonce enforcement** — switch: `TAVONEL_CSP_ENFORCE_NONCE=1`, **Preview first**, per the
runbook inside `csp-policy.ts:122`. Precondition: a clean devtools console on every route the
build serves.

**OCR probe** — switch: `TAVONEL_PROBE_OCR_HEALTH=1`. Precondition: the GPU spend gate, which is
exactly the budget the probe would start charging against on a schedule.

---

## 6. Migration RPCs with no TypeScript caller

157 functions defined across `supabase/migrations`. Of those, 55 have no reference from
`nextjs`, `shared`, `server` or `scripts`. **48 are correctly uncalled**: triggers and RLS helpers
invoked by the database (`guard_*`, `prevent_*`, `reject_*`, `assert_*`, `enforce_*`,
`is_workspace_owner`, `founder_test_reset_*`), or SQL-internal helpers called by the RPC next to
them (`commit_model_provider_circuit_event_v1` and `model_provider_circuit_state_json_v1` are both
called by `commit_model_provider_circuit_admission_v1` / `…_outcome_v1`, which TypeScript does
call). The remaining 6 are real:

**Correction, 2026-09-22 (second pass).** The first pass of this table listed
`capture_connector_checkpoint` as a real uncalled RPC because its name does not carry a
`guard_`/`prevent_`/`trigger_` prefix. It is a trigger —
`create trigger foundation_jobs_checkpoint after update of state on public.foundation_jobs` —
and the connector sync path is wired end to end, with exactly the ACK-after-durable property:

- `/api/v1/oauth-connectors/connections/[id]/sync` → `enqueueConnectorSync` (`lib/job-store.ts:70`)
  → `enqueue_connector_sync`, which seeds the new job's `cursor_token` from
  `foundation_connector_checkpoints`, so a replayed sync resumes at the watermark.
- `/api/internal/jobs/run` → `runSourceImportBatch` → `loadConnectorSyncPage`
  (`lib/connector-sync-page.ts`), which persists the observed page **before** importing any item,
  so a crash re-reads the same page rather than re-listing a provider whose contents moved.
- items imported → `completeJobBatch(… cursorToken)` (`lib/sync-worker.ts:298`, whose comment
  states the rule: "Only now, with the batch durably admitted, does the checkpoint move") →
  `complete_foundation_job_batch` sets `succeeded` + `cursor_token` → the trigger writes the
  checkpoint **in the same transaction**, so a rollback rolls back the success and its watermark
  together.

Coverage already existed for two of the three properties this lane was asked to test — replayed
page (`lib/sync-worker.test.ts:138`), ACK-after-durable (`:178`, `:226`), and at the database
level `supabase/tests/connector_checkpoints.sql` ("failed checkpoint rolls back success",
"expired lease preserves watermark", "different target never inherits watermark"). The third,
`connector_checkpoint_target_mismatch`, was raised in two places and asserted in neither; this
lane added that assertion. No application code was written, because a second checkpoint path in
TypeScript would duplicate a database-transactional guarantee with a weaker one.

| RPC | Migration | What it does | Recommendation |
| --- | --- | --- | --- |
| `refresh_source_deletion_inventory` | `20260920132000_legal_hold_deletion_sweeper.sql` | Rebuilds the deletion inventory a legal-hold sweep acts on | **WIRE WITH FLAG** — with `issueDeletionEvidence`; `deletion` lane owns it |
| ~~`capture_connector_checkpoint`~~ | `20260909210203_connector_sync_checkpoints.sql` | **Reclassified: it is a trigger, already wired.** See the correction above | — |
| `append_enterprise_audit_event` | `0014_enterprise_control_plane.sql`, hardened by `0054_audit_rpc_server_only.sql` | Append-only enterprise audit event | **KEEP OFF (founder)** — pairs with the SCIM/SSO boundary in §4 |
| `reserve_foundation_compute_v2` | `0036_maximum_reservation_and_overage.sql` | Legacy compute reservation | **KEEP OFF (founder)** — superseded by `reserve_model_provider_spend_v1`; deprecate rather than wire |
| `settle_foundation_compute_v2` | same | Legacy compute settlement | **KEEP OFF (founder)** — same |
| `foundation_enable_subscription_overage` | same, `0044_foundation_trigger_hardening.sql` | Enables overage billing | **KEEP OFF (founder)** — pricing |
| `apply_foundation_billing_event_v2` | `0009_…`, `0010_…`, `0011_…` | Billing event application with replay guard | **KEEP OFF (founder)** — billing launch |

`reserve_foundation_compute_v2` / `settle_foundation_compute_v2` deserve the sharper note: they are
a **second** reservation ledger, parallel to the model-provider ledger this lane just put behind the
operator SLI. Two ledgers that can each authorize spend is the failure mode the audit's §3 was
about. They should be deprecated through the ladder, not wired.

---

## 7. What this lane did not do, and why

- **Did not re-implement audit §3.** It was already closed on `origin/main`; re-doing it would have
  produced a second dispatch path, which is the opposite of the point.
- **Did not touch `/search` or `/ask` DTOs.** `runtime.decision` was already internal-only. The
  MCP/CLI parity test and the OpenAPI document needed no change, and changing them to make a diff
  look bigger would have risked a contract that is currently correct.
- **Did not delete anything in §3.** Deletion is subtractive and touches the root build; it needs
  the founder's decision to retire the legacy root runtime. The rows are named and ready.
- **Did not set any flag.** Every off flag in §5 is off for a reason that is a founder call.
- **Did not write a TypeScript connector checkpoint.** The founder approved wiring
  `capture_connector_checkpoint`; the second pass found it already wired as a database trigger
  inside the completion transaction. Duplicating that in application code would have replaced one
  transactional guarantee with two records that can disagree. The one missing assertion was added
  instead, and the correction is recorded in §6.

# Router frontier audit — 2026-09-20

## Scope and verdict

This audit covers the local model/retrieval registry, runtime selection and fallback behavior,
model-provider spend reservation/settlement, operational visibility, evaluation/promotion
boundaries, and API/MCP/CLI parity. It made no network or paid-provider calls.

**Verdict: RELEASE BLOCKER for any claim that the TAVONEL v5 adaptive economic router is
production-ready.** The fixed BGE retrieval path has useful fail-closed selection and explicit
degradation behavior, but it is not the v5 router. The spend-control contract is not wired around
the provider adapters, and the repository has no Model Arena / Oracle Dataset / shadow report /
family-holdout promotion path.

This does not block describing the current path narrowly as a fixed, registry-gated retrieval
configuration with named lexical/structure and fused-order degradations. It does block active
adaptive routing, cost-governed paid-provider dispatch, or evidence-backed model promotion.

## Authority used

The governing requirements are in
`D:/CodexProjects/ai-knowledge-compiler/docs/north-star/TAVONEL_MASTERPLAN_v5.0.md`:

- registry capability, license, data-policy, price snapshot and lifecycle fields: lines 613–647;
- route constraints and holdout-before-production: lines 1028–1116;
- correlated provider failure must open a circuit: lines 1188–1190;
- retrieval filter order: lines 1313–1326;
- observability and cost/budget gates: lines 1599–1660;
- Arena before active Router, then shadow and circuit/cost gates: lines 1770–1815;
- definition of done for immutable attempt lineage, Oracle/shadow/holdout, provider policy,
  invoice reconciliation and runaway-cost breaker: lines 2118–2163;
- no active routing before family holdout and no internal routing data in public DTOs: lines
  2283–2300.

## Findings

### 1. Fixed retrieval selection is fail-closed, but registry eligibility is incomplete

`nextjs/lib/retrieval-model-registry.ts:34-40` admits only role/provider/model/revision plus a
generic `eligible` flag, approval state and freshness timestamps. Selection correctly rejects
missing, malformed, duplicate, unapproved, mismatched and stale rows
(`nextjs/lib/retrieval-model-registry.ts:95-139`). However, no typed or enforced fields exist for
license state, provider data policy, capability receipts, price snapshot, context/output limits or
lifecycle. A row can therefore be `eligible: true` without demonstrating the v5 prerequisites.

`nextjs/lib/retrieval-runtime-config.ts:98-149` selects only two hard-coded BGE components and
constructs adapters after admission. This is a fixed retrieval configuration, not a
multi-family/adaptive router, and it has no shadow/challenger/canary/champion state.

### 2. Fallback truth is visible, but provider-wide failure control is absent

The current retrieval behavior is honest at the response boundary:

- missing/ineligible dense retrieval is named as `lexical_structure`, and missing/ineligible
  reranking as `rrf_fused_order` (`nextjs/lib/retrieval-runtime-config.ts:124-137`);
- `/search` publishes degradations (`nextjs/app/api/collections/[id]/search/route.ts:149-174`);
- `/ask` identifies both compiled retrieval and the excerpt fallback
  (`nextjs/app/api/collections/[id]/ask/route.ts:113-125, 160-175`).

The adapters still call the RunPod endpoints directly
(`nextjs/lib/embedder-adapter-runpod.ts:111-125` and
`nextjs/lib/reranker-adapter-runpod.ts:83-105`). They return per-call errors, but there is no
durable provider-health state, correlated-failure classifier, circuit-open check, retry budget or
provider-wide stop in front of subsequent calls.

### 3. Spend reservation/settlement is a strong isolated contract, but it is not runtime wiring

The migration provides private price, budget, reservation and immutable ledger tables
(`supabase/migrations/20260920131000_model_provider_spend_control.sql:7-103`), requires exactly one
active price and both global and tenant accounting windows (lines 222–239), and checks global and
tenant committed cost under serialized admission (lines 289–320). The TypeScript wrapper refuses
dispatch without a valid reserved receipt (`nextjs/lib/model-provider-spend.ts:157-170`).

A repository-wide symbol search found no production import or call of
`runReservedModelProviderCall`, `reserveModelProviderSpend`, or `settleModelProviderSpend` outside
`nextjs/lib/model-provider-spend.ts` and its tests. The direct adapter calls above therefore bypass
the breaker and ledger entirely. Schema presence does not provide spend control.

The failure path is also unsafe for invoice accuracy: any exception from the provider callback
releases the full reservation with zero actual units
(`nextjs/lib/model-provider-spend.ts:185-189`). A timeout or connection reset after provider
acceptance is ambiguous, so zero is not proven. Expired reservations likewise record zero spend
(`supabase/migrations/20260920131000_model_provider_spend_control.sql:173-185, 393-407`). No
provider-invoice reconciliation path was found. These behaviors fail the immutable actual-cost
lineage and internal-ledger/provider-invoice reconciliation gates.

### 4. Router quality governance is missing

No implementation artifact named for a Model Arena, Router Oracle Dataset, shadow comparison,
oracle regret, trust-violation report, family train/calibration/holdout split, router policy
version, or canary promotion gate exists in the product runtime. `nextjs/eval/ask-eval` and
`nextjs/eval/k08-live-engine` are useful retrieval/engine evaluations, but they do not establish
multi-family router eligibility or promotion.

Because `selectProductionRetrievalRuntime` names the fixed selector as production while the v5
promotion evidence is absent, the safe interpretation is “fixed retrieval runtime only.” It must
not be represented as the v5 adaptive router.

### 5. Observability is request-local, not immutable routing/cost lineage

Search and Ask return candidate counts, reranker application, gate rejections, degradations and
the model selection decision. This is useful request-local evidence. It is not a durable attempt
receipt binding input, output, registry/policy version, provider failure class, actual usage and
cost. The default operational SLI monitors only `coreV2`, `r2` and `db`
(`nextjs/lib/operational-sli.ts:26`), so model-provider health, breaker state, reservation leakage,
settlement lag and router quality are absent from the operator view.

The authenticated API response also includes `runtime.decision` directly
(`nextjs/app/api/collections/[id]/search/route.ts:174` and
`nextjs/app/api/collections/[id]/ask/route.ts:125`). That object carries registry IDs, approval IDs
and validity timestamps. Keep detailed routing/approval evidence in an internal receipt or
operator surface; expose only bounded degradation/route-class information through public API,
MCP and CLI DTOs, consistent with the masterplan's public-DTO boundary.

### 6. API/MCP/CLI read parity is locally proven, with a fixture limitation

`nextjs/lib/b30-api-mcp-cli-parity.test.ts:101-136` proves the published MCP and CLI artifacts use
the same bearer principal, search request/envelope, pagination limits and read envelopes. It also
tests malformed success refusal and stable authorization failures. The test uses a local HTTP
fixture rather than invoking the Next.js routes, so it establishes client transport/schema parity,
not deployed endpoint behavior or end-to-end router/spend wiring.

## Required closure before adaptive-router release

1. Define a versioned model/provider registry contract that enforces exact model/revision,
   capability receipts, license state, data-policy eligibility, price snapshot and lifecycle.
2. Put every paid adapter invocation behind reservation admission and measured settlement. Preserve
   ambiguous outcomes for reconciliation; do not release them as proven zero spend.
3. Add durable attempt receipts that bind input/output digests, registry and policy versions,
   failure class, retry/recovery relation, actual usage and cost.
4. Add provider/account health aggregation and a durable circuit breaker that stops correlated
   dispatch before another provider call.
5. Build and freeze the Arena inputs/settings, family-level train/calibration/holdout split,
   Oracle Dataset and shadow comparison. Require human-approved policy version and passing holdout
   gates before canary; keep customer traffic free of uncontrolled exploration.
6. Add internal operator metrics/alerts for provider health, open breaker, reservation age,
   settlement/reconciliation lag, cost, oracle regret, trust violations and catastrophic misses.
7. Keep API/MCP/CLI response parity while redacting internal registry/policy/approval detail from
   public DTOs.

## Verification performed

No provider call, deployment, migration application or external mutation was performed.

Passed:

```text
pnpm exec vitest run lib/retrieval-model-registry.test.mjs lib/retrieval-runtime-config.test.ts lib/model-provider-spend.test.ts lib/b30-api-mcp-cli-parity.test.ts
3 Vitest files, 29 tests passed
```

Vitest did not collect the `.test.mjs` registry file, so it was run explicitly:

```text
node --experimental-strip-types --test lib/retrieval-model-registry.test.mjs
4 tests passed
```

Repository-wide TypeScript verification was attempted:

```text
pnpm exec tsc --noEmit
failed with pre-existing errors in app/trust/page.tsx and lib/public-trust-contract.test.ts
```

The TypeScript failures are outside this audit's router/retrieval/spend scope. No implementation
file was changed because the missing pieces require a cross-cutting registry, persistence and
promotion design; adding an isolated selector or another unwired breaker wrapper would create
false assurance.

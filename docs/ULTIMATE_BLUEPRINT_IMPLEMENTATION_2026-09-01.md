# TAVONEL Ultimate Blueprint implementation ledger

Authority: `D:\TAVONEL_ULTIMATE_WEB_PRODUCT_DESIGN_BLUEPRINT_2026-09-01.md`  
Target: `D:\CodexProjects\tavonel-saas-foundation`  
Started: 2026-09-01 KST

This ledger distinguishes repository implementation, current verification, and external evidence.
An implemented surface is not a qualified production capability unless the live dependency and
evidence gate are also complete.

## Non-negotiable product contract

- TAVONEL is the Knowledge Compiler for AI.
- Compiled World is the primary product object.
- Every claim has a state; every promoted object has an evidence path.
- Authenticated product surfaces never invent semantic topology.
- Active, Candidate, Research, and unavailable states remain visually distinct.
- Motion explains a real state transition and reduced motion preserves the same information.
- Portable artifacts, human review, and immutable receipts remain first-class product concepts.

## P0 trace

| Blueprint requirement | Implementation target | Completion proof |
| --- | --- | --- |
| Explore-first hero CTA | `/`, `/explore` | CTA resolves without login; deterministic sample disclosure |
| Public Compiled World demo | `/explore` | source -> claim -> answer -> exact evidence interaction |
| Qualified / Research vocabulary | shared claim-state contract | one vocabulary across public and workspace surfaces |
| Evidence and real product snapshot | homepage | actual capability state; no unsupported metric or topology |
| Global World status | workspace shell | Active, Candidate, Review visible on every primary route |
| Sources / Compiles / World / Review / Ask IA | nested workspace routes | direct deep links and keyboard navigation |
| Billing / Integrity secondary | workspace settings | absent from primary task navigation |
| State-based workspace home | `/workspace` | one dominant next action for empty, running, candidate, active |
| Truth Strip | workspace shell | live capability states and fail-closed details |
| No synthetic workspace topology | compile/world surfaces | read/not-yet until real nodes and relations exist |
| Real semantic object inspector | World Studio | selected object reaches evidence in one or two interactions |
| Route decomposition | `app/workspace/**` | monolith becomes compatibility/controller boundary |
| Source and review UX | run/review routes | source region required for consequential review decision |
| Shared visual grammar | public and workspace | same state tokens, evidence tether, object vocabulary |

## P1 trace

| Blueprint requirement | Implementation target | Completion proof |
| --- | --- | --- |
| Preflight | Sources/Compile | observed source/OCR/review boundary; cost stays unquoted until the server issues a reservation |
| Run theater | `/workspace/runs/:runId` | actual event state only; batch and focused views |
| World Studio lenses | Map/Table/Evidence/History/Files | real read model and explicit read/not-yet states |
| Review Studio | `/workspace/review` | attention order, evidence, impact preview, receipt |
| Grounded Ask | `/workspace/ask` | answer/abstain with exact source path |
| Connector experience | Connections | gallery, wizard, health and explicit unavailable states |
| Developer quickstart | Developer | API/CLI/MCP quickstart before key administration |
| Activity Center | `/workspace/activity` | persistent operational events and receipt links |
| Command palette | workspace shell | navigation and recent-object actions with keyboard support |
| Intentional mobile shell | all primary product routes | no squeezed desktop; source/result split and state retained |
| Enterprise boundary | `/enterprise`, `/workspace/admin` | public buyer surface separated from control plane |

## P2 trace

| Blueprint requirement | Honest deliverable | External gate |
| --- | --- | --- |
| Customer proof | consent-gated empty state and evidence intake contract | named customer consent and approved claim record |
| Reproducibility portal | public receipt/manifest explanation and verified samples | qualified reproducibility corpus |
| Benchmark registry | registry surface that rejects unqualified records | approved public benchmark receipts |
| Failed experiment archive | research status surface | release-approved experiment receipts |
| Downloadable sample worlds | deterministic JSON sample with SHA-256 `Content-Digest` | independent signature verification remains an external gate |
| Category content | Knowledge Compiler explainer routes | legal/claim review before promotion |
| Public SDK/examples | versioned examples and clean-install proof | published package/release channel |
| Trust Center | capability, processor, incident, retention states | operational owners and external audit evidence |
| Enterprise architecture visuals | deterministic architecture diagrams | deployment-specific approval; no fabricated certification |

## Verification gates

- TypeScript and ESLint
- full Vitest suite
- production build
- Playwright launch and product journeys
- keyboard and WCAG 2.2 AA checks
- 1920, 1440, 1280, 1024, 768, 390, and 360 pixel captures
- reduced-motion pass
- Lighthouse budgets
- deployed public route and authenticated workflow evidence
- founder visual review remains a human gate

## Current verification evidence

Recorded on 2026-09-01 KST against the production build in this repository:

- `pnpm check`: TypeScript and ESLint passed.
- `pnpm test`: 102 files and 697 tests passed.
- `pnpm build`: 44 static pages generated; all new public, workspace, and API routes compiled.
- Playwright: 180 passed and 12 intentional non-mobile skips across 1920, 1440, 1280, 1024, 768, 390, 360, and reduced-motion projects.
- Public proof routes, deterministic downloads, mobile Runs SSE state, Activity audit rows, keyboard command palette, and full-page captures were exercised.
- Lighthouse uses direct DevTools throttling with unchanged budgets because Lighthouse 12.8 Lantern re-times the already-painted RSC hero image at hydration completion under the installed Chrome.
- Production deployment `dpl_5Gsq2TCZrCFnhbcTZZAeExVbyd3V` reached Ready on `tavonel.com`; ten public/readiness routes returned 200, reproducibility downloads returned attachment bytes, and the unauthenticated Runs SSE boundary returned 401.
- Authenticated Workspace journeys use a production build with a test session and intercepted tenant APIs; they are not presented as live customer-session evidence.
- Detailed visual evidence and the remaining human gate are recorded in `VISUAL_QA_REPORT.md`.

External customer consent, qualified benchmark records, approved failed-experiment receipts, published package-channel proof, independent sample signature verification, and external audit evidence are not fabricated. Their public surfaces fail closed until those records exist.

## 2026-09-20 competitive-frontier delta

**Status:** strategy and evidence update; no product capability is claimed by this section.
**Method:** primary product documentation and vendor-owned product/trust pages reviewed on
2026-09-20 KST. Vendor statements are recorded as vendor claims unless the cited page exposes a
testable product contract. Recommendations below are TAVONEL decisions to evaluate; they are not
current implementation status.

### Decision-level finding

Multi-provider access, ordered fallback, spend limits, request analytics, and prompt-difficulty
routing are now commodity platform capabilities. TAVONEL must not position a generic model router,
RAG citations, or a knowledge graph alone as its moat. The defensible product is the complete,
auditable transition from hostile source material to a permissioned, temporal Compiled World:

`immutable source -> exact evidence region -> stable semantic identity -> authority/time/applicability -> review decision -> atomic world activation -> impact-bounded recompilation -> signed consumption receipt`

The existing blueprint already contains most of this architectural thesis. Its commercial gap is
proof: one buyer-relevant workflow must expose the full chain, measure it under a declared SLO, and
bind quality, latency, human review, and cost to the same immutable run.

### Verified frontier facts

| Product | Verified fact from a primary source | Implication, not a competitor claim |
| --- | --- | --- |
| Vercel AI Gateway | Its unified API supports provider ordering, provider timeouts, model fallbacks, and provider metadata. Vercel says default provider choice considers recent uptime and latency. Budgets can be scoped to team, project, API key, or user; the documentation explicitly says the cap is soft because the request that crosses it completes. [Provider options](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options), [model fallbacks](https://vercel.com/docs/ai-gateway/models-and-providers/model-fallbacks), [budgets](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets) | Provider abstraction and outage fallback cannot carry TAVONEL's differentiation. Any gateway used beneath TAVONEL still needs TAVONEL-owned reservation, settlement, and route receipts. |
| Cloudflare AI Gateway and Agents | Dynamic Routes are versioned flows with conditional, percentage, model, rate-limit, and budget nodes plus rollback. AI Gateway exposes analytics, logging, caching, retry/fallback, rate limits, and spend limits. Cloudflare Workflows provide durable steps, retries, event waits, and approval gates; Agents expose MCP and durable approval patterns. [Dynamic routing](https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/), [AI Gateway](https://developers.cloudflare.com/ai-gateway/), [Agents with Workflows](https://developers.cloudflare.com/agents/concepts/workflows/), [human in the loop](https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/) | Edge routing, durable execution, and human approval are available infrastructure. TAVONEL should own the knowledge/evidence state machine and treat an infrastructure workflow engine as replaceable. |
| Amazon Bedrock | Intelligent Prompt Routing predicts response quality and routes between exactly two models in the same family; AWS documents that it cannot use application-specific performance data and may be suboptimal for specialized workloads. Bedrock evaluates models, prompt routers, and RAG with automatic, judge-model, or human methods. Knowledge Bases `RetrieveAndGenerate` returns citations to source chunks; invocation logging can capture request, response, and metadata to CloudWatch or S3. [Prompt routing](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-routing.html), [evaluation](https://docs.aws.amazon.com/bedrock/latest/userguide/evaluation.html), [knowledge-base retrieval](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-how-retrieval.html), [invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html) | TAVONEL's Arena can remain defensible only when it uses document-specific, trust-level outcomes and preserves same-condition evidence that a generic prompt router does not ingest. |
| Microsoft Foundry | Model Router offers Cost, Balanced, and Quality modes, model subsets, automatic failover, Azure Monitor distribution metrics, and a response field identifying the serving model. Microsoft explicitly recommends workload-specific comparison and reevaluation, and retaining direct deployments when deterministic selection is required. Foundry agent tracing uses OpenTelemetry and records model/tool spans, tokens, duration, and latency. [Router behavior](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-router-how-it-works), [router evaluation](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/evaluate-model-router), [agent tracing](https://learn.microsoft.com/en-us/azure/foundry/observability/concepts/trace-agent-concept) | TAVONEL should adopt the same evaluate-before-route discipline, then go further by tying every route to document slice, target trust level, policy constraints, and observed trusted output. |
| Google Vertex AI | Model Garden provides a consistent discovery/deploy path with integrated tuning, evaluation, and serving. Agent Engine integrates evaluation plus Cloud Trace, Monitoring, and Logging. Google documents managed RAG and a grounding check that returns claim-level support and citations, while its security-control matrix distinguishes data residency, CMEK, VPC Service Controls, and Access Transparency by feature. [Model Garden](https://cloud.google.com/vertex-ai/generative-ai/docs/model-garden/explore-models), [Agent Engine](https://cloud.google.com/vertex-ai/generative-ai/docs/reasoning-engine/overview), [grounding check](https://docs.cloud.google.com/generative-ai-app-builder/docs/check-grounding), [security controls](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/security-controls) | Citation and grounding scores are useful inputs, not compiled truth. TAVONEL must retain source coordinates, contradiction, authority, temporal scope, identity, and activation state beyond a scalar grounding score. |
| OpenAI Platform and enterprise | The Responses API exposes file and URL citation annotations and built-in file search. Batch completes within 24 hours at a documented 50% discount. API data is not used for training by default; retention behavior differs by endpoint and feature, and background mode is not Zero Data Retention compatible. OpenAI also documents enterprise controls including SAML SSO and Enterprise Key Management. [Responses/file citations](https://platform.openai.com/docs/api-reference/responses-streaming/response/output_item), [Batch](https://platform.openai.com/docs/api-reference/batch/object), [API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint), [enterprise privacy](https://openai.com/enterprise-privacy/) | Provider policy is capability-specific. TAVONEL's registry and router must fail closed on retention, region, tool, and storage constraints at the exact endpoint/feature level rather than attach a provider-wide "enterprise" label. |
| Glean | Glean describes a real-time enterprise knowledge graph across content, people, and activity; permission-aware search/chat, citations, APIs, MCP, and more than 100 connectors are first-class surfaces. Its documentation describes item-level permission handling and per-user enforcement. [Knowledge Graph](https://docs.glean.com/security/knowledge-graph), [Developer Platform](https://developers.glean.com/), [MCP](https://docs.glean.com/administration/platform/mcp/about) | Broad connectivity and permission-aware retrieval are an established buying expectation. TAVONEL needs a sharper wedge than "all company knowledge": source change, evidence-grade compilation, and reproducible downstream context. |
| Hebbia | Hebbia's Matrix presents multi-step, multimodal document analysis in a grid, dynamically uses text and vision models, and says citations remain available throughout the workflow. Its Trust Center lists SOC 2 Type II and ISO/IEC 42001:2023 artifacts; access to some reports is gated. [Matrix](https://www.hebbia.com/product), [Trust Center](https://trust.hebbia.ai/) | Structured, citation-linked bulk analysis is already a premium workflow pattern. TAVONEL must show what remains stable and reproducible after the analysis: object identity, versioned world state, decisions, and selective recompilation. |
| Harvey | Harvey documents multi-source analysis over Vault, DMS, web, uploaded files, and legal sources; sentence-level citations, review tables, reusable workflows, user groups, and source-aware exports are product surfaces. Its public updates also describe human verification states and document-management sync. [April 2026 update](https://www.harvey.ai/blog/the-brief-april-2026), [November 2025 update](https://www.harvey.ai/blog/the-brief-november-2025), [citation-backed research](https://www.harvey.ai/blog/introducing-harvey-deep-research) | Domain workflow and source UX can dominate a horizontal architecture story. TAVONEL needs an explicit first ICP and a task-specific proof path, while keeping the compiler substrate horizontal. |

### Evidence-backed gap register

The following rows distinguish repository evidence observed during this review from proposed work.

| Area | Verified TAVONEL state | Gap against the frontier | Recommendation and acceptance evidence |
| --- | --- | --- | --- |
| Routing | The north-star architecture defines a Model Arena, Router Oracle Dataset, shadow router, and minimum cost to trusted output. This checkout's public blueprint does not claim a qualified router result, and `docs/policy/DECISION_LOG_2026-09-16.md` explicitly withholds Arena numbers pending an exact-version rerun. | The hyperscalers already ship general cost/quality routing, subsets, failover, and routing telemetry. | Keep the router internal until a frozen corpus compares direct models, managed routers, and TAVONEL policy under identical prompts and source artifacts. A route receipt must pin source/page slice, model endpoint and revision, policy version, target trust level, region/retention constraints, predicted cost, actual cost, latency, failures, and final validation outcome. Report oracle regret by slice; never publish a single global winner. |
| Enterprise trust | The blueprint preserves tenant isolation, exact evidence, signed exports, human promotion, and fail-closed public surfaces. Current artifacts distinguish implemented code from production proof. | Buyers now encounter permission-aware retrieval, SSO/governance, data residency, customer-managed keys, trace observability, DLP, and public trust centers elsewhere. A design promise without a machine-checkable control status will lose enterprise diligence. | Create one versioned control matrix for every customer-data path: authn/authz, source ACL sync, revoke propagation, retention/deletion, region, subprocessor/model endpoint, encryption/key ownership, logs, incident owner, and evidence receipt. Publicly show only `verified`, `contracted`, `not verified`, or `unavailable`, with observation time. External certification stays gated until independently obtained. |
| Knowledge compiler proof | The product contract contains source-linked evidence, stable semantic objects, review, Compiled World states, activation/rollback, and signed downloads. | Glean, Hebbia, Harvey, Bedrock, Vertex, and OpenAI all expose some combination of graph/context, citations, or source-grounded output. Those terms no longer distinguish the category by themselves. | Make the public proof a change event, not a static answer: compile a licensed sample, expose exact region and digest, change one source fact, show impacted and unaffected objects, require/replay review, activate a new world atomically, and verify a signed export. Acceptance requires a downloadable manifest and independent verifier result, not a film or screenshot. |
| Product design | The blueprint's Explore-first proof and Evidence tether are correct, and the brand system forbids invented proof. | Premium competitors lead with a recognizable job: enterprise search, financial/legal document review, or legal work product. "Knowledge Compiler" remains abstract until the visitor sees who compiles what, for which decision, and why a citation is insufficient. | Choose one beachhead workflow by evidence, not taste. The landing path should state the buyer, input, consequential task, compiled object, verification action, and time-to-first-proof. Keep Cinematic Intelligence as pacing and composition; use Calm Precision for the actual source/evidence/review instrument. Do not add logos, ROI, adoption, accuracy, or certification until the claims registry admits them. |
| Go to market | The repository has topic clusters and a claims registry, while customer stories and benchmarks correctly fail closed. | The absence of fabricated proof is correct but leaves no commercial evidence loop. Broad horizontal category language competes with better-known enterprise-search and vertical-workflow categories. | Run a design-partner program around one repeatable, high-cost verification workflow. Before intake, define baseline labor, current error/rework mode, source count and type, decision owner, and required evidence. Afterward measure time-to-verified-world, review minutes, abstentions, corrections, and accepted outputs. Publish only consented, denominator-bearing results with the receipt and scope. |
| SLO | `nextjs/lib/operational-sli.ts` evaluates current probe freshness, required checks (`coreV2`, `r2`, `db`), a bounded run window, and request latency; the runbook says notification delivery and acknowledgement remain separately gated. This is an internal operational signal, not a customer SLO. | Competitors expose routing/failover and trace telemetry, while enterprise buyers need the reliability of the result and permission boundary, not only endpoint health. | Define service levels over the compiler transaction: admitted-source durability, compile terminal success, evidence resolvability, world activation atomicity, ACL-revoke propagation, change-to-active freshness, signed-export verification, and provider-spend breaker behavior. Each SLI needs numerator, denominator, exclusions, observation source, window, freshness, error budget, owner, and rollback action. Do not publish targets until a sustained production-like observation window exists. |
| Economics | `pilot-unit-economics.ts` correctly refuses operational values without observations and calculates direct cost per trusted page. The model-provider spend boundary reserves and settles priced calls and can fail closed on missing price/accounting or open global/tenant breakers. | Gateway dashboards report request/token spend, but TAVONEL's stated objective is trusted output. The checkout has a schema and controls; it does not establish current customer-level margins or a qualified cross-provider comparison. | Make the immutable run receipt the join key for quality and money. Measure cost per admitted page, trusted page, activated object, verified answer, and changed object recompiled; include provider/API/GPU, storage, network, retries, human review, support, payment fees, refunds, and idle/cold-start cost. Report p50/p95 and an uncertainty band. Keep gross-margin and pricing decisions blocked until observed pilot inputs satisfy the existing evidence schema. |
| Defensibility | The architecture combines stable identity, evidence lineage, temporal/authority resolution, dependency impact, selective recompilation, and versioned world state. | Each individual component has an adjacent competitor. The moat is vulnerable if it exists only as architecture or hidden tests. | Build a cumulative, rights-cleared evaluation asset: source snapshots, adversarial changes, authoritative conflicts, ACL changes, expected semantic identities, impact sets, abstentions, review decisions, and signed world manifests. Protect private routing/cost features while publishing the protocol and independently verifiable outputs. Defensibility is the compound dataset, policy, receipts, and workflow adoption—not model access. |

### Measurable scorecard required before category or enterprise claims

No target value is assigned here because this review did not observe a qualified production window.
The next evidence campaign must emit, at minimum:

| Dimension | Required measure |
| --- | --- |
| Trust yield | trusted pages / admitted pages, with rejected, abstained, and review-required denominators |
| Evidence integrity | resolvable cited claims / cited claims; digest, version, page and region must all resolve |
| Change correctness | expected impacted objects found; unaffected control objects preserved; stale active objects after activation |
| Permission safety | revocations propagated within the declared window; zero unauthorized retrievals in the negative matrix |
| Reliability | terminal compile success, queue age, retry rate, provider failover success, atomic activation/rollback success |
| Latency | p50/p95/p99 intake-to-candidate, review-to-active, Ask latency, and change-to-active freshness by workload slice |
| Routing | quality/trust delta, cost delta, latency delta, failure delta, and oracle regret versus fixed-model and managed-router baselines |
| Human effort | review minutes and corrected/accepted/abstained objects per 100 pages |
| Unit economics | all-in direct cost per trusted page, active object, verified answer, and selective recompile; contribution margin by offer |
| Adoption | time-to-first-verified-world, weekly verified workflows, return usage, export verification, and expansion within the same permission boundary |

### Priority order

1. **Prove one compiler transaction.** Release a rights-cleared change-and-recompile specimen with
   exact evidence, independent signed-export verification, and no unsupported performance claim.
2. **Calibrate before routing.** Run same-condition baselines against direct providers and at least one
   managed router. Freeze model IDs, prompts, pricing snapshots, input modes, policy, and evaluators.
3. **Turn controls into buyer evidence.** Produce the versioned enterprise control matrix and collect
   sustained SLI observations; keep certifications and SLA language gated.
4. **Join trust and cost.** Use the run receipt to calculate cost per trusted output and human review,
   then set pilot offer boundaries and breakers from observed distributions.
5. **Narrow the first market.** Select the beachhead only after design-partner evidence identifies a
   repeated source-verification problem with an owner, budget, and measurable consequence.

This delta does not change the blueprint's protected core, human-promotion boundary, claims gate,
or founder visual-review gate.

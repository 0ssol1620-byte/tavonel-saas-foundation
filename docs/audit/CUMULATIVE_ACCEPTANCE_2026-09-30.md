# Cumulative acceptance reconciliation

Current Auth qualification: exact Foundation ca104ea passed actual disposable GoTrue + optimized Next + Chromium, 35 assertions, at 17:31 UTC. See [REAL_AUTH_ROUTING_AND_EXPIRY_2026-09-30.md](REAL_AUTH_ROUTING_AND_EXPIRY_2026-09-30.md). Earlier preparation/pending statements below are historical. Google OAuth, production source admission and full intake/review/publication remain unqualified; whole-requirement counts are unchanged.

Foundation qualification pin: `5af5baf9dfc2a2db144f5e72f0f3a7af8f0af0ea`. Core documentation pin: `36f8f99bf298c4177bb9c7808920eda81d7c6632`; implementation `19e9d0a78c111b513f687cd48ac8f60edd8268e6`. This reconciles the historical checkpoint ledger; older statements about missing immutable-input verification, never-executed SQL, blocked builds and wholly mocked storage are superseded only within the explicit local scopes below. No production activation, merge or deployment has occurred.

## Acceptance totals

Across all 55 requirements: **2 verified-complete / 36 partial / 11 unassessed / 6 external-dependent**. K scope: 0/20/7/4. UX scope: 2/16/4/2. Counts are unweighted; partial evidence is not whole-requirement acceptance. Unassessed means no new complete acceptance assessment, not absent code. External-dependent items can still contain actionable offline engineering. Core's narrower 0/18/9/4 K count is a separate lane assessment and does not replace this global ledger.

## Current evidence boundaries

- Selected-revision frontend: 87 affected Chromium cases at 1440/390/360, zero retries, with explicit synthetic signed-in HTTP fixtures. Exact review/model/decisions, correction, publish digest, comparison, late replies and history are bound to the inspected immutable revision. Actual rendered PDF fixture screenshots inspected. The full unit run qualified the initial implementation (404 files/5,874 passed); the later bounded pin follow-up passed 93 relevant contracts, build/types/lint and the repeated 87 browser cases. These are distinct qualification scopes.
- Joined real downstream boundary: independently revalidated **109 assertions / 103 Foundation migrations**, with actual Core HTTP artifacts, PostgreSQL 17, PostgREST JWT verification, signed S3 requests to SeaweedFS, Next development handlers and Chromium-origin requests. Includes lost committed reply/replay, historical restore, stale publication refusal, forged/expired token and revoked membership refusal. Identity `/auth/v1/user` remains a synthetic adapter; browser fetches are not hydrated review/publish interactions. Two vector migrations use an explicit shim, not real pgvector semantics.
- Separate real S3 qualification: six tests passed using the unchanged production signer and actual service responses. No Cloudflare R2 compatibility/durability or production IAM claim. `pnpm check` and all changed journey harness lint checks passed after integration. Disposable services were stopped through owned-process cleanup.
- Public build, responsive screenshots, truth/locale/accessibility and Product QA evidence remain the previously recorded exact-run evidence. New backend harnesses do not silently renew every earlier build/browser/performance acceptance. Parent monitors exact Foundation head CI separately.
- Core hosted retry: the API image build/scan/SBOM passed on PR merge checkout `3c43aa1f6afbfd65f1390255b6718d7a99e1185f` (head `36f8f99` into target `f2fc5d8`). Full migrations reached 0039, then scheduler privilege verification failed `effective_table_acl_exact`. Linux visuals and scheduler/web/cpu-document image jobs had no allocated runner and zero steps. Core is restored private; ACL repair belongs to the Core lane. No further public retry is underway.

## Every engineering requirement

| ID | Status | Verified portion; remaining acceptance |
|---|---|---|
| K01 | Partial | Exact code/environment/test receipts; complete supported deployment baseline and replay corpus remain. |
| K02 | Partial | Stable collection and scoped logical-source/revision bindings; legacy migration and latest-revision reconciliation remain. |
| K03 | Partial | Source scope/journal/snapshot safeguards; centralized policy, tombstone and inventory reconciliation remain. |
| K04 | Partial | Real Core receipt/projection and two immutable revisions through Foundation HTTP/SQL/S3; deployed compatibility remains. |
| K05 | Partial | Deterministic fragment reduction and single-host durable replay; comprehensive shard/corpus and distributed claims remain. |
| K06 | Partial | Full/incremental oracle, unchanged-byte OCR/geometry/authority invalidation and grounding regressions; comprehensive corpus acceptance remains. |
| K07 | Partial | Actual SQL/HTTP concurrency, CAS/ABA, rollback and committed-response-loss replay; full job/source crash and production durability remain. |
| K08 | Partial | Bounded watcher/pending replay; source-to-publish liveness and continuous reconciliation remain. |
| K09 | Partial | Current source/session/role guards, actual JWT/RLS and membership refusals; provider session, cache/export and full ACL audit remain. |
| K10 | Partial | Real downstream Next/browser/Core/SQL/S3 boundary; genuine intake/compile/review/publish customer UI remains. |
| K11 | Partial | Native/PDF anchor and citation integrity regressions; universal parser/IR contract acceptance remains. |
| K12 | Partial | Existing format paths and bounded native/PDF tests; full format/golden corpus remains. |
| K13 | Unassessed | Spreadsheet structure and golden corpus acceptance not newly qualified. |
| K14 | External-dependent | Authorized recognition quality/security corpus and any exact paid OCR scope remain prerequisites. |
| K15 | Partial | Resolver/grounding regressions; production integration and locked holdout remain. |
| K16 | Unassessed | Comprehensive merge/split dependency propagation not newly qualified. |
| K17 | Partial | Existing temporal/contradiction semantics; multilingual/version evaluation remains. |
| K18 | Unassessed | Ontology breaking-change migration/recovery acceptance not newly qualified. |
| K19 | Partial | Synthetic consumer consistency plus actual JWT/API refusal; joined same-principal/snapshot API/MCP/CLI proof remains. |
| K20 | Partial | Input budgets and existing cost guards; real reservation/settlement/duplicate-charge and exhausted-budget qualification remain. |
| K21 | Partial | Actual SQL revocation/restore and retained S3 bytes; derived search/history/cache/export/backup authority remains. |
| K22 | Partial | Redirect, bounded hash, snapshot/S3 and fail-closed source checks; complete archive/parser/injection audit remains. |
| K23 | Unassessed | Operational dashboards, SLO and source/job liveness acceptance not newly qualified. |
| K24 | Partial | Exact clean-install version/hash checks; supported install/upgrade/rollback matrix remains. |
| K25 | Unassessed | Small corpus tests do not qualify 10k-document/hot-entity/load acceptance. |
| K26 | External-dependent | Locked authorized customer/competitor comparison and exact cost scope missing. |
| K27 | Unassessed | HWP/HWPX feasibility and format acceptance not newly qualified. |
| K28 | External-dependent | Live connector/OAuth grants and provider qualification remain; no grants created. |
| K29 | Partial | Reproducible local/CI audit receipts; full release evidence bundle and remaining gates remain. |
| K30 | External-dependent | Separate exact production/release decision required after readiness; no merge/deploy. |
| K31 | Unassessed | Adaptive native/OCR routing quality corpus not newly qualified. |

## Every UX requirement

| ID | Status | Verified portion; remaining acceptance |
|---|---|---|
| UX01 | Partial | Public truth/locale/claims guards; complete capability ledger across authenticated surfaces remains. |
| UX02 | Partial | Source-first public journey; full vocabulary and representative-user acceptance remain. |
| UX03 | Complete: public scope | Committed source evidence hero, exact source route, truthful read-only claim and no autoplay qualified. |
| UX04 | Complete: public scope | Responsive public workbench/filter/empty/reset/source-result panes qualified. |
| UX05 | Partial | Public source reader and fixture private evidence/keyboard/history/errors; joined real private inspector remains. |
| UX06 | Partial | Localized evaluation metadata/required fields/503 input retention; complete availability and live response combinations remain. |
| UX07 | Partial | Public keyboard/focus/44px touch/zoom/width contracts; full authenticated surface qualification remains. |
| UX08 | Partial | Sanitized analytics/consent contracts; complete browser consent funnel and privacy observations remain. |
| UX09 | Partial | Existing explicit source scope guards; per-connector exclusions/transfer/change consent journey remains. |
| UX10 | Partial | Existing quota/cost guards; estimate/unknown/excluded pages and real reservation/settlement UX remain. |
| UX11 | Partial | Interrupted replies, input retention, journal and real restore replay; full execution resume/duplicate-charge journey remains. |
| UX12 | Partial | Exact selected-revision review/correction and evidence-free publication refusal; joined hydrated real-boundary review/provenance remains. |
| UX13 | Partial | Exact comparison/history, stale refusal and actual browser API restore/replay; hydrated manual publish/diff/restore remains. |
| UX14 | Partial | Exact distribution hashes/versions and synthetic consumers; same-principal/snapshot three-consumer actual evidence remains. |
| UX15 | External-dependent | Authorized representative corpus/evaluation agreement and exact spend scope missing. |
| UX16 | Partial | Actual membership refusal and retained-object restore; search/history/cache/export revocation experience remains. |
| UX17 | Partial | Global reducer and actual artifact read; larger unified corpus discovery remains. |
| UX18 | Partial | Bounded watch/change sample; complete continuous update/reprocess/liveness experience remains. |
| UX19 | Unassessed | Organization invite/least-access/revoke/audit UI not newly qualified. |
| UX20 | Unassessed | Schema editing/impact preview/version migration/recovery UX not newly qualified. |
| UX21 | External-dependent | Selfserve implementation/qualification remains, then separate production activation decision. |
| UX22 | Partial | Public reproducibility links; locked benchmark/failure evidence and publication rights remain. |
| UX23 | Unassessed | Large-document/corpus evidence/ACL/version experience not newly qualified. |
| UX24 | Unassessed | Large-change summary/filter consistency against basic list not newly qualified. |

## Remaining critical path and ownership

1. Auth lane: joined hydrated workspace/callback/intake/review/publish with real local Core/SQL/S3 and explicitly scoped identity adapter; genuine GoTrue session/refresh remains a distinct runtime prerequisite. Integration owner reviews returned commits and revalidates selected-revision/error/ACL acceptance without editing that harness concurrently.
2. Core lane: repair exact scheduler ACL mismatch privately; hosted Linux visuals and three final-image scans remain external runner qualification. No permission/billing/visibility bypass or repeated public debugging.
3. Authorized engineering after joined journey: watcher/latest-revision/policy/tombstone reconciliation; then actual same-context API/MCP/CLI, derived revocation and reservation/settlement recovery. Existing unit evidence is not a substitute for those joined contracts.
4. Larger corpus/format/schema/scale and operational evidence remain substantive engineering; representative recognition/benchmark/provider/production qualification retains separately stated dependencies.

G0 remains partial; G1/G2/G3/G5 are not accepted; G4 lacks external holdout/pilot evidence. No gate is closed by the latest 109 assertions. No new whole-requirement closure is claimed, so totals remain unchanged.

Estimate boundaries: integration review of a returned bounded Auth increment is hours-scale if it passes, not a date promise. Full authorized offline engineering retains the previous low-confidence 6–12 sustained single-lane week estimate; current parallel execution does not justify dividing that mechanically. Customer/provider/production qualification has no defensible completion date without prerequisites and acceptance inputs. No new live data, credentials, account grants or paid infrastructure were used.

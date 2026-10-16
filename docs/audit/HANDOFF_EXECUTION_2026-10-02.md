# Handoff execution ledger — 2026-10-02

Scope: the Claude Code execution of `TAVONEL_CLAUDE_HANDOFF_2026-10-02_KO.md` against the 55 requirements in [MASTERPLAN_IMPLEMENTATION_2026-09-30.md](MASTERPLAN_IMPLEMENTATION_2026-09-30.md) and [CUMULATIVE_ACCEPTANCE_2026-09-30.md](CUMULATIVE_ACCEPTANCE_2026-09-30.md). Those two files are frozen and are not edited here. This ledger records what changed, which commit carries it, which evidence class backs it, and a **proposed** classification. The proposal is not adopted until the founder confirms it.

Pins: Foundation base `02b8631482ad656567aa9dc4d9fc6117cc5755c5` → PR #141 head `cf57e1f6c353e3ad4d211ccb26531db79b4afe75` (draft, open, unmerged). Core base `cbfd19dc208fdc7d7c336ef4a182dc6c03f0f963` → PR #91 head `4c234df4c8a9c815158449ae32f0a09711ae7209` (private, draft, unmerged). No merge, deployment, production migration, production flag change, credential, customer document or paid provider call was used.

## Evidence classes

| Class | Meaning here |
|---|---|
| unit/mock | Vitest/pytest with fixture fetches, in-memory stand-ins or fake providers |
| synthetic local runtime | Real code paths over local files or in-process services on synthetic fixtures |
| CI disposable stack | GitHub-hosted runner with a throwaway Supabase/PostgreSQL, CDR/ClamAV or OCR runtime |
| real-auth CI journey | Disposable genuine GoTrue + production-mode Next + Chromium + shipped MCP/CLI on GitHub-hosted runner |
| production | None. No item in this ledger has production evidence. |

## Exact-head CI receipts (Foundation, `cf57e1f6`)

| Workflow | Run | Result and counts |
|---|---|---|
| CI | [37016627659](https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/37016627659) | success. nextjs `pnpm test` 416 files / 6,184 passed / 1 skipped (6,185); root 31 files / 237 passed; build passed |
| Launch QA | [37016627269](https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/37016627269) | success. Product QA (1440/390/360/reduced-motion/audit) 1,072 passed / 279 skipped; Browser QA chromium 32 passed + consent 34 passed / 6 skipped; firefox 31 passed / 1 skipped; webkit 30 passed / 2 skipped; Lighthouse budgets success; Launch gate success |
| DB rehearsal (PR) | [37016626932](https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/37016626932) | success. pgTAP `Files=49, Tests=1130, Result: PASS`; repair migrations applied a second time, suite re-run `Files=49, Tests=1130, PASS`; model-provider spend race on a marker-verified disposable stack `{"status":"PASS","checks":11,"serverVersion":"17.6"}` |
| malware-scan-qualification | [37016627523](https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/37016627523) | success. Real CDR image + digest-pinned clamd, TAP `# tests 4 / # pass 4 / # fail 0`; any SKIP/TODO fails the step |
| foundation-ocr-cpu-raster | [37016627096](https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/37016627096) | success. `201 passed`, zero-skip enforced |
| CodeQL | 37016627305 | success |
| DB rehearsal (manual dispatch) incl. Real local Auth journey | [37019205020](https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/37019205020) | success. Ledger artifact `real-auth-journey-cf57e1f6c353e3ad4d211ccb26531db79b4afe75` (file sha256 `4e8b1a4db9844f38a619919677099e4051284a346c13a1f19fa8e6d6a106f2e2`): 131 entries / 115 distinct assertions; `consumerTransportVerified`, `selectedRevisionUiVerified`, `hydratedReviewPublishVerified`, `sourceRevisionLineageVerified` true; `googleOAuthVerified`, `productionSourceAdmissionVerified`, `productionAuthCookieUsed` false; `consumerTransport.coreQualified` false, `retrievalQualityMeasured` false. The "Local Chromium signed-storage transport" job in this dispatch was skipped. |

The selector repair `0a5cc6d0` (closing the handoff §4 failure, 4/4 width conditions) had all checks green on its own head (Launch QA 37008785251, CI 37008785439, DB rehearsal 37008785413, malware 37008785376, CodeQL 37008785248).

The 131-entry consumer ledger is a **re-confirmation** on the integrated head. The same journey first passed on `a023d0ff` in run 36996092661 before this handoff (handoff §5). It reads Core-produced fixtures stored unchanged in S3; it does not run Core, upload, OCR or compile.

## Foundation changes by lane

Review verdicts: independent reviews were run in this session by reviewer agents separate from each lane's author, and are reported by the integrator; most are not written into commit messages, so this table is their record. Test-only CI fixes were reviewed by the integrator. An agent review is not founder approval and does not substitute for the self-approval rule on classification, merge or deployment.

| Lane | Requirement | Commits | What changed | Independent review | Tests (env, counts) | Evidence class |
|---|---|---|---|---|---|---|
| integration | UX05 test | `0a5cc6d0` | Overlay located by `data-evidence-bbox`; 20 % offset / 10 % height and previous-document clearing assertions unchanged | Integrator review (test-only selector change): APPROVE | Launch QA on `0a5cc6d0` all green | CI (browser) |
| B | K20, UX10 | `43210b30`, `23115371` (on integration line) | `lifecycle_v3` lets the queue sweep expire never-admitted reservations; client returns terminal `MODEL_PROVIDER_RESERVATION_EXPIRED` and never dispatches it; queue-expiry migration joins apply-twice; spend race runs only against a stack carrying a fresh random marker, psql pinned | Separate reviewer agent: `43210b30`, `23115371` APPROVE (files also carried from the earlier Foundation-clone review) | pgTAP `model_provider_spend_recovery.sql` (35) inside 49/1,130 PASS; race 11 checks PASS; vitest in CI 6,184 | unit/mock + CI disposable stack |
| B2 | K20 (also K07 crash behaviour) | `ce8d7d38`, `fb339b64`, merge `e8db674e` | Durable `dispatch_started_at` mark set once before the provider call; a marked expired hold is parked as `DISPATCH_OUTCOME_UNKNOWN` (still charged) instead of refunded; replay of a marked key never re-dispatches; migration renumbered to `20261002130000` | Separate reviewer agent: `ce8d7d38`, `fb339b64` APPROVE | pgTAP `model_provider_dispatch_start_mark.sql` (plan 38) inside 49/1,130 PASS; fake-provider crash test (in-memory ledger stand-in, kill at five boundaries + restart) inside CI 6,184 | unit/mock + CI disposable stack |
| U | UX06 | `7a1edbe0`, `22134f25`, `36af5313`, merges `74387446`, `cf57e1f6` | Per-status recovery copy in English and Korean; 403/415 keep Send disabled, focus the status, next tab stop is the mailto fallback; e2e asserts the 503 public copy, not the server body | Separate reviewer agent: `7a1edbe0`, `22134f25` reviewed with `05283237` → CHANGES REQUIRED (stale-ready A→B→A, fixed in `282308d0`) → APPROVE; CI fix `36af5313` reviewed by integrator (test-only): APPROVE | Launch QA green on `cf57e1f6` (Browser QA + Product QA); contact responses are mocked | unit/mock + CI browser (mocked responses) |
| U | UX05 | `05283237`, `282308d0`, `0fea94ad` | PDF evidence viewer derives ready state per (data, page, width); late/failed renders never paint over newer ones; A→B→A width flap no longer revives a wiped render; test made deterministic | Separate reviewer agent: `05283237` CHANGES REQUIRED (stale ready after A→B→A width flap) → fix `282308d0` APPROVE (regression test fails on `05283237`); `0fea94ad` reviewed by integrator (test-only): APPROVE | Vitest in CI 6,184; Product QA green | unit/mock + CI browser |
| O | K23 (lane tag K24) | `c58d884f`, merge `c30360e6` | Read-only job-liveness evaluator over `foundation_jobs` (bounded counts, capped ages, fixed reason codes), PostgREST GET store, `GET /api/internal/sli` behind worker/cron secret. No processing-gate reader exists, so `jobLiveness` is always `unknown` (`processing_gate_unknown`), never green | Separate reviewer agent: `c58d884f` APPROVE | Lane: vitest 3.2.6, 7 files / 87 tests; in CI 6,184. Every store test uses a fixture fetch | unit/mock |
| J | K04, K07, K10, K14, K22, K31 | `110bd80f`, `d9640a4b`, `b3100f17`, merge `642f8e89` | CPU raster OCR worker (pinned onnxruntime 1.20.1 / rapidocr 3.9.2); native text boxes mapped with PDFium `FPDF_PageToDevice` so /Rotate, CropBox and nonzero MediaBox land on the displayed page; off-page boxes yield no region (never clamped); models downloaded from pinned URLs and SHA-256-verified before load; real CDR/ClamAV suite cannot pass on skip | Separate reviewer agent: `110bd80f`, `d9640a4b` CHANGES REQUIRED (CropBox clamp of native boxes, silent-green skip of the real CDR suite, unverified models) → `b3100f17` APPROVE | CI OCR 201 passed / 0 skipped; CI CDR/ClamAV 4/4; lane local 201 passed (Python 3.12.14) and CDR worker npm 116 passed | CI disposable stack (real OCR runtime, real CDR/ClamAV) on synthetic PDFs |
| S | K02, K03, K08, K28, UX09, UX18 | `b916bc73`, `e061a182`, merge `37ae350e` | Begin/page/finalize inventory scan sessions on `POST /api/v1/connections/[id]/sync`; epoch CAS; exact-replay idempotency; finalize requires complete scan and exact counts; missing items become `unobserved` (tombstone candidate only, no tombstone/purge/ACL write); ACL observation hash grants nothing; 64 MiB staging cap; 6 h scan expiry; RLS deny + service-role RPC only. **The source agent does not yet send scan operations.** | Separate reviewer agent: `b916bc73` CHANGES REQUIRED (3-argument `throws_ok`, founder-reset fence hole, quadratic staging) → `e061a182` APPROVE | pgTAP `connection_source_inventory_reconcile.sql` (85) and grant matrix (70) inside 49/1,130 PASS; vitest in CI 6,184 | unit/mock + CI disposable stack |
| S2 | K21 (reset), K03 | `f822f6e4` | Founder test reset counts, fingerprints and deletes the four inventory tables ahead of `foundation_connections` (previously the reset failed after R2 purge once a scan existed) | Separate reviewer agent: `f822f6e4` APPROVE | pgTAP `founder_test_reset_connection_inventory.sql` (plan 16) inside 49/1,130 PASS; static test pins 37 → 41 tables | CI disposable stack |
| O2 | — | none | Lane opened; no commit (`lane/O2` = `37ae350e`) | — | — | — |

## Core changes (summary only)

Core is private; its exact security findings live in the private Core ledger `docs/audit/HANDOFF_EXECUTION_2026-10-02_CORE.md` on Core `lane/DOC`. In summary: native CSV/XLSX structure preservation (K11/K12/K13/K22; HWP/HWPX unsupported, CSV strict UTF-8 with comma dialect), runtime incremental tests against full-rebuild oracles that show **no work is saved yet** (K06), and Core access-control fixes recorded against K09/K21. Core hosted CI allocated no runner at the base `cbfd19dc` (every job 0 steps) and has executed since `4b3cadac`; on `4c234df` every test file this handoff added passed, and the Core workflows are still red on gates outside this handoff's diff. Details and run IDs are in the private ledger.

## Proposed classification (founder confirmation required)

Rule applied: an item moves to complete only when every acceptance criterion in CUMULATIVE_ACCEPTANCE (and its masterplan row) is met by the cited evidence. None is.

| ID | Frozen | Proposed | Justification and what is missing |
|---|---|---|---|
| K02 | Partial | Partial | Inventory sessions bind to connection identity; legacy migration and latest-revision reconciliation still missing |
| K03 | Partial | Partial | Server-side inventory ledger with incomplete-scan distinction (CI pgTAP); policy ledger, tombstone application and agent-side scan sending missing |
| K04 | Partial | Partial | Native bbox geometry corrected on the OCR worker; deployed Foundation→Core compatibility unproven |
| K06 | Partial | Partial | Core runtime oracle tests (private ledger); incremental recompile saves no work (strict xfails), corpus acceptance missing |
| K07 | Partial | Partial | Crash before/after provider acceptance now safe in fake-provider + pgTAP; whole job/source crash and production durability missing |
| K08 | Partial | Partial | No source-to-publish liveness; agent does not send scans |
| K09 | Partial | Partial | Core access-control fixes (private ledger); cache/export/historical snapshot leak audit and workspace entitlement inside a tenant missing |
| K10 | Partial | Partial | Real OCR and CDR/ClamAV run in CI; joined upload → CDR → OCR → Core compile → review → consumers not run |
| K11, K12 | Partial | Partial | Core native CSV/XLSX contracts; format golden corpus missing, HWP/HWPX unsupported |
| **K13** | Unassessed | **Partial** | First assessment: cell, type, merged/sparse, formula + cached value and number-format preservation tested in Core (unit + in-process worker e2e on hosted runner). Header/unit semantics and golden corpus missing |
| K14 | External | External | CPU OCR runs with digest-checked models, but model-weight licence receipts are missing (founder/legal) and no authorized quality corpus exists |
| K19 | Partial | Partial | 131-entry ledger shows identical facts and citations across session API, key API, MCP and CLI for one principal and one active snapshot over local genuine Auth. Snapshot is a stored Core fixture (`coreQualified=false`), not a joined compile; production identity absent. Strongest candidate for a scoped completion; founder decides whether a "local scope" completion is acceptable, as UX03/UX04 were for "public scope" |
| K20 | Partial | Partial | Queue-expiry, dispatch-start mark and cross-tenant race proven on disposable PostgreSQL; no real provider, exhausted-budget journey or production settlement |
| K21 | Partial | Partial | Founder reset now covers inventory; derived search/cache/export/backup revocation missing |
| K22 | Partial | Partial | Real CDR/ClamAV boundary in CI; bounded CSV preflight in Core; full archive/injection audit missing |
| **K23** | Unassessed | **Partial** | First assessment: liveness evaluator and SLI read route (unit/mock only). No dashboard, no SLO, no live-database proof; the processing gate has no authoritative source, so liveness is always `unknown` |
| K24 | Partial | Partial | Lane tag only; install/upgrade/rollback rehearsal untouched |
| K25 | Unassessed | Unassessed | Lane tag only; no 10,000-document / hot-entity evidence |
| K27 | Unassessed | Unassessed | HWP/HWPX declared unsupported without the safety/accuracy/licence feasibility study the criterion requires |
| K28 | External | External | No live connector/OAuth grant; server inventory is a prerequisite only |
| K31 | Unassessed | Unassessed | Native vs raster region placement fixed; adaptive routing quality corpus not assessed |
| UX05 | Partial | Partial | Interruption-safe viewer; joined real private inspector missing |
| UX06 | Partial | Partial | Terminal 403/415 and per-status copy in two locales; responses mocked, live availability combinations missing |
| UX09, UX18 | Partial | Partial | Server half only; client sends no scan operations, no consent journey |
| UX10 | Partial | Partial | Terminal expired-reservation code; no estimate/unknown/excluded-cost UX |
| UX12, UX13 | Partial | Partial | Hydrated accept + publish re-confirmed with actual SQL; correction provenance and hydrated diff/restore not in the ledger |
| UX14 | Partial | Partial | Same as K19; masterplan criterion names actual deployment, which is absent |

Proposed totals: **2 complete / 38 partial / 9 unassessed / 6 external** (K: 0/22/5/4; UX: 2/16/4/2). Deltas: K13 and K23 Unassessed → Partial. No item moves to complete. G0–G5 dispositions are unchanged.

## Open blockers and the exact owner

| Blocker | Why it blocks | Owner |
|---|---|---|
| Joined upload → CDR → OCR → Core compile → review → API/MCP/CLI proof | Core cannot run inside Foundation public CI without Core source access | Founder: grant a read-only Core deploy key to Foundation CI, or approve a Core-side joined workflow |
| Core workflows red on gates outside this diff | Release requires a green Core head | Core lane + founder (details in private ledger) |
| Authoritative processing-gate source | Liveness stays `unknown` until one exists | Founder decision + ADR |
| Derived-document permission inheritance | Derived artifacts must not outlive source ACL | Core/Foundation engineering (authorized, not started) |
| Pipeline store → `/v1/ask` snapshot wiring | No in-repo writer of the partitioned snapshot format | Core engineering |
| Workspace-level entitlement inside a tenant | Principal carries no workspace | Core engineering + founder on the entitlement model |
| Incremental recompile saves no work | Re-parse and re-resolve of untouched documents | Core engineering |
| Agent-side inventory scan operations | Server sessions exist; agent still sends cursor batches only | Source lane |
| Model-weight licence receipts (RapidOCR models) | Code, weights, dataset and API terms are separate licences | Founder / legal |
| 11 production legal / encryption / operator evidence gates | External release gates | Founder |
| Real Google OAuth | `googleOAuthVerified=false` | Founder (provider credentials) |
| Production source admission | `productionSourceAdmissionVerified=false` | Founder |
| Classification change in this ledger | Self-approval rule | Founder |
| Merge to main and deployment | Irreversible production action | Founder |

## Rollback

Every change is on unmerged draft PR branches. Foundation migrations added in this range (`20261002100000`, `20261002110000`, `20261002120000`, `20261002130000`) were applied only to disposable CI databases; no production database was touched. Reverting the PR #141 merge commits restores the base without data migration impact.

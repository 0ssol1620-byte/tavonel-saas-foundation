# TAVONEL masterplan implementation status

Current cumulative acceptance is reconciled in [CUMULATIVE_ACCEPTANCE_2026-09-30.md](CUMULATIVE_ACCEPTANCE_2026-09-30.md), pinned to Foundation `5af5baf` and Core `36f8f99`. Sections below retain chronological checkpoint evidence; earlier unverified-boundary statements must be read with that current reconciliation. Global totals remain 2 complete / 36 partial / 11 unassessed / 6 external-dependent. No release gate is newly accepted.

This is a local implementation checkpoint, not a release or a claim of full masterplan completion. Production flags, credentials, paid compute and customer data were not changed. Base Foundation: `7a7b4fed9e7d45ec596057f7f1cc5d0672465326`. Core productization reference: `f2fc5d856f7efb09221aede309e1e6f2e07671a9` on `codex/tavonel-p0p2-productization`.

## Work delivered locally

- Stable same-membership collection identity, optional explicit logical collection key, full OCR input revision fingerprint, attempt/parent response binding, fail-closed stored parent validation
- Bounded source-agent watch/retry, private durable pending journal, exact replay after lost response, scope binding, local single-writer lock, empty/incomplete inventory safeguards, sealed local upload copies, S3 conditional revision reads, input budgets
- Source-first English/Korean landing and Explore, artifact-derived evidence, question/history state, evaluation entry and explicit purchase limitations
- Core document extraction fragments and deterministic global reducer, tested beyond the 12-document boundary; bounded whole-collection durable integration in progress behind closed qualification flags

## Verification ledger

| Check | Outcome at this checkpoint | Scope and caveat |
|---|---|---|
| Stable identity and parent boundary suite | 75 passed | Focused Foundation tests, not deployed customer E2E |
| Source-agent offline Python suite | 23 passed | Mocked API and temporary documents; no live customer run |
| New UI component SSR suite | 7 passed | No screenshot or interaction acceptance |
| Foundation aggregate unit suite | 5823 passed, 1 skipped, 0 failed | 400 files on final frozen source; production/browser/SQL are separate gates |
| Core fragment/reducer/oracle suite | 26 passed including replay extension | Real engine fixtures, not quality benchmark or scale proof |
| TypeScript | Passed on frozen source | Browser/build/SQL gates remain separate |
| ESLint | Passed | Preset-relative plugin resolution; no rules disabled |
| Browser/E2E | Public/synthetic desktop qualification passed below | Private customer and signed-export acceptance remain separate |
| Migration | Checkpoint CI rehearsal executed and passed | Actual PostgreSQL45files/952assertions/replay; no production apply |
| Production build and complete customer path | Build passed; customer path unverified | Desktop optimized build153pages and CI production build; no release readiness claim |

## Engineering task reconciliation

| ID | Classification | Current disposition / remaining condition |
|---|---|---|
| K01 | Engineering remaining | Baselines and targeted regressions recorded; full deployment configuration still unverified |
| K02 | Engineering remaining | Stable identity and optional logical key locally implemented; existing data migration qualification pending |
| K03 | Engineering remaining | Source state/scope/pending commit journal strengthened; full centralized inventory/policy/tombstone reconciliation not newly completed |
| K04 | Engineering remaining | Foundation parent and revision contract implemented and tested; deployed Core compatibility unverified |
| K05 | Engineering remaining | Real Core fragment/reducer implementation and 13-document fixtures; durable checkpoint integration and PostgreSQL rehearsal passed; shard invariance/customer-path qualification remains |
| K06 | Engineering remaining | Full/incremental semantic oracle and fault injection in progress/tested locally; comprehensive corpus acceptance pending |
| K07 | Engineering remaining | Existing durable jobs being extended for one global collection; unchanged SQL rehearsal passed45files/952assertions; broader crash/concurrent publish qualification remains |
| K08 | Engineering remaining | Bounded polling/recovery implemented; end-to-end watcher-to-publish and liveness monitoring not complete |
| K09 | Engineering remaining | Existing authorization gates preserved; complete proof/ACL/cache audit not yet established |
| K10 | Engineering remaining | Actual private customer-path integration pending |
| K11 | Engineering remaining | Existing IR contracts inspected; universal parser/anchor contract not newly completed |
| K12 | Engineering remaining | Existing PDF/Office paths remain; full proposed format qualification pending |
| K13 | Engineering remaining | Structured spreadsheet preservation and golden corpus pending |
| K14 | External dependency + engineering | No new paid OCR run; quality/security qualification pending |
| K15 | Engineering remaining | Existing resolver present; production integration and locked holdout pending |
| K16 | Engineering remaining | Comprehensive merge/split dependency propagation pending |
| K17 | Engineering remaining | Existing temporal/contradiction semantics used; full multilingual/version evaluation pending |
| K18 | Engineering remaining | Ontology migration and breaking-change qualification pending |
| K19 | Engineering remaining | Existing MCP/API/CLI retained; full identical-context consumer proof pending |
| K20 | Engineering remaining | Input byte/event/region bounds added; complete cost reservation/settlement validation pending |
| K21 | Engineering remaining | Existing deletion gates retained; derived cache/backup/restore qualification pending |
| K22 | Engineering remaining | Source walk/snapshot/revision safeguards added; complete parser/archive/injection audit pending |
| K23 | Engineering remaining | Sanitized agent outcomes present; operational dashboards/SLO/liveness pending |
| K24 | Engineering remaining | Desktop isolated integration starting; install/upgrade/rollback acceptance pending |
| K25 | Engineering remaining | 13-document boundary covered; 10k-document/hot-entity/load tests pending |
| K26 | External dependency + engineering | Customer/competitor AI benchmark not executed; no performance superiority claim |
| K27 | Engineering remaining | HWP/HWPX feasibility not completed |
| K28 | External dependency + engineering | No additional customer OAuth grants or new connector qualification |
| K29 | Engineering remaining | Full operational evidence bundle pending |
| K30 | External release decision | No public release, merge, deployment or production activation |
| K31 | Engineering remaining | Adaptive native/OCR routing plan retained; no new comprehensive routing qualification |

## Product and UX reconciliation

Public UX03–08 have implementation changes and focused tests; actual responsive, accessibility, motion and browser acceptance remains required. UX01–02 truth and language contracts are being reconciled with the new design. UX09–16 authenticated intake/review/publish/cost/revocation paths, UX17–18 integrated corpus/update experience and UX19–24 expanded organization/schema/selfserve/scale flows must be completed and tested against actual backend capabilities. Existing screens do not count as newly qualified flows.

Keep engineering security and correctness ahead of cosmetic test updates. Superseded film/layout assertions can change with the approved design, but factual sample labeling, permission boundaries, source evidence, language parity and route metadata remain real acceptance criteria.

## Final review additions

Source-agent authenticated calls and uploads reject redirects, descriptor hashing enforces a streaming bound, S3 requires explicit inventory completeness and revision-conditional reads, and original file basenames are retained. Independent review found and corrected these issues before publication. Connector source identity across revisions remains a separate unfinished mapping; revision-specific document UUIDs must not be reused for new bytes.

Final public UI regression-focused suites passed326tests, then metadata/SEO/canonical/analytics suites passed502tests. Core deadline/pgTAP fixture-contract focused suites passed396tests, but SQL assertions themselves have not run in PostgreSQL. Database operator script tests passed53tests. Final aggregate: 400 test files passed; 5823 tests passed and 1 skipped; no failures.

Desktop integration received and verified approved Git checkpoint heads Foundation `8a74202bc519c472541049cbb4b1de4b864bbf71` and Core `57e55037872d6df30857c83714452b23783b8dab` in separate isolated checkouts. Existing dirty user work is preserved. Draft PRs are Foundation #141 (main) and Core #91 (productization reference), not merged or deployed. Official Windows Library materialization was not retried.

## Desktop follow-up — 2026-09-30

Final follow-up checks: Foundation aggregate **401 files / 5835 tests passed**, no failed/skipped tests in the desktop run; TypeScript and ESLint passed. Scoped connector integration/identity focused tests passed84. Public workbench passed32 browser tests across width/reduced-motion projects. Full public launch suite passed93 with3 existing signed-export skips across Chromium/Firefox/WebKit; the mobile-navigation subset passed18. Internal crawler checked182 paths with no broken links. Export skips are unverified signed-download acceptance, not success. Exact-head CI Lighthouse budgets passed (359005b); local NO_NAVSTART was a tooling failure, not accepted measurement evidence. Source-agent suite passed23; Core fragment/API/bridge focused suite passed22. No customer-path or paid benchmark completion is implied.

- Production checkpoint build passed locally: 153 static pages; font retrieval is available on this computer. GitHub build evidence also passed. Type generation, TypeScript and ESLint passed after checkpoint integration.
- Checkpoint database rehearsal passed in GitHub's actual PostgreSQL/Supabase: 45 files, 952 assertions, including `global_collection_compile.sql` and replay. Evidence: https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/36705266585/job/109853914618 . This covers the unchanged migration, not broader concurrent customer-path acceptance. No desktop database migration or production migration was applied.
- Real Chromium captured 42 full-page screenshots (six public routes at 1920,1440,1280,1024,768,390,360), plus reduced-motion Explore. No horizontal overflow or page exceptions observed. Desktop landing and mobile Explore screenshots inspected. Screenshots are local observations, not founder approval or authenticated-path acceptance.
- Mobile menu test now requires the approved paper surface's 3px blue focus ring and 3px offset; keyboard escape, navigation closure and ability to leave the disclosure remain enforced. Local HTTP test builds use the existing test-only `PLAYWRIGHT_LOCAL_HTTP` setting at build time; production CSP remains unchanged.
- Clean-install verifier derives CLI/MCP version from channel metadata, requires exact version/API output and verifies all six copied executable hashes before running them. Version drift does not bypass integrity checks.
- Windows source-agent lock uses descriptor size instead of reading the locked byte before acquisition. OS contention still refuses the second writer. Offline suite passed all 23 tests with actual temporary symlink fixtures under the existing normal user token; restricted Windows sandbox lacked symlink privileges.
- Scoped v2 connector compiles resolve immutable upload UUIDs through verified durable bindings to stable logical source IDs. Collection selection and Core native identity use that logical ID; immutable source filenames, keys and authorization retain the revision-specific upload UUID. Missing/corrupt/duplicate mapping or two revisions of one logical source fail closed. No quarantine UUID is reused for new bytes. Direct uploads retain their existing identity. Historical migration, v1 legacy path qualification, latest-revision reconciliation and policy lineage remain unfinished.
- Core fragment/API/bridge tests passed locally (22 tests), using isolated Python 3.12.6 and the repository's FastAPI pin. Core GitHub CI did not allocate a runner: exact annotation states recent account payments failed or a spending limit needs increase. No billing/security/credential changes made.

These results do not complete K01–K31, UX01–24 or G0–G5. Customer documents, paid quality comparison, live OAuth qualification, deployed Core compatibility, broader concurrent publication/ACL/revocation/restore tests, installation/upgrade/rollback and selfserve acceptance remain pending. Production flags remain closed. No merge or deployment is authorized by test success.

## Complete UX and release-gate qualification

Conservative acceptance sub-status across55requirements:2verified-complete (UX03/04 public scope),36partial,11not newly started/assessed in this wave,6externally blocked as their primary disposition. Engineering:0complete/20partial/7not newly assessed/4external. UX:2complete/16partial/4not newly assessed/2external. Counts are unweighted and do not imply a percentage of engineering effort completed. Existing code can be present in a not-assessed item.

- Not newly assessed:K13,K16,K18,K23,K25,K27,K31;UX19,UX20,UX23,UX24.
- Primary external blockers:K14,K26,K28,K30;UX15,UX21. Offline work inside blocked items remains authorized; no credentials/spend/customer-data/production action is implied.
- Critical path:stable source/revision lineage→real two-revision incremental parent→crash/duplicate/concurrent publish→same-context consumers→revocation/restore/cost→scale/format quality.
- Planning estimate only:current public QA corrections30–90minutes absent further defects (moderate confidence); all remaining offline engineering roughly6–12weeks for one sustained lane (low confidence, not measured completion-date evidence). Customer/paid-provider/production qualification has no defensible date until the exact inputs, authority and acceptance scope are available. No promise of completing the masterplan today.

Classification applies to the complete requirement; partial evidence does not close it. Engineering remaining is authorized work. Paid OCR/model comparisons, customer documents, live OAuth grants, representative user evidence, and production activation name actual external dependencies; they do not excuse offline engineering. The K01–K31 table above now carries an explicit classification for every item.

| ID | Classification | Verified portion and exact remaining condition |
|---|---|---|
| UX01 | Engineering remaining | Truth/locale/security regressions pass; complete cross-surface capability ledger still required. |
| UX02 | Engineering + external user evidence | Source-first journey implemented; complete vocabulary audit and representative user acceptance. |
| UX03 | Implemented and verified: public scope | Actual committed source hero, digest-linked route, explicit read-only label, async image/no autoplay; no customer-quality claim. |
| UX04 | Implemented and verified: public scope | Seven-width screenshots and unusual-width browser workbench checks; question filter/empty reset and mobile source/result panes. |
| UX05 | Engineering remaining | Public PDF digest/pixels/zoom/tamper and exact deep links verified; common private inspector and interruption/history acceptance remain. |
| UX06 | Engineering remaining | Evaluation and purchase limitations implemented; complete locale/form-error and availability-gate combinations. |
| UX07 | Engineering remaining | Visible3px focus, dialogs/escape/mobile nav verified; full Product QA contrast/zoom/touch/width qualification ongoing. |
| UX08 | Engineering remaining | Sanitized analytics/consent unit contracts retained; complete browser consent funnel without raw question/source/key capture. |
| UX09 | Engineering remaining | Existing source scope gates; qualify explicit target/exclusions/transfer/change-detection consent per connector. |
| UX10 | Engineering remaining | Quota/refused-intake controls verified; page estimate/reservation/settlement and unknown/excluded-cost reporting. |
| UX11 | Engineering remaining | Lost reply/server failure and bounded journal recovery tested; full interrupted execution/resume and duplicate-charge proof. |
| UX12 | Engineering remaining | Existing review flows; prove evidence-free publish refusal and correction provenance. |
| UX13 | Engineering remaining | Parent/attempt and SQL publication guards pass; manual publish/diff/restore with current ACL and concurrency. |
| UX14 | Engineering remaining | Clean-install exact CLI/MCP versions and hashes verified; actual same-principal/snapshot query and evidence across3consumers. |
| UX15 | External dependency | Authorized customer corpus/evaluation agreement and exact spend authority required; none processed. |
| UX16 | Engineering remaining | Deletion/tombstone guards retained; search/history/cache/export revocation acceptance. |
| UX17 | Engineering remaining | Global reducer/13document/SQL checkpoint verified; unified corpus lookup across larger fragment boundaries. |
| UX18 | Engineering remaining | Bounded watch/public derived change sample tested; continuous source→snapshot and full/selected reprocess/liveness. |
| UX19 | Engineering remaining | Existing server auth/roles; qualify organization invite/least-access/revoke/audit journeys. |
| UX20 | Engineering remaining | Schema code is not UX acceptance; example edit/impact preview/version migration/recovery. |
| UX21 | Engineering + external release decision | Selfserve gates closed; complete lifecycle/recovery and G5 readiness before separate production activation. |
| UX22 | Engineering + external dependency | Public reproducibility links exist; locked comparable benchmark/failure records, authorized comparisons and publication rights. |
| UX23 | Engineering remaining | 13document fixtures/input bounds are not scale proof; large-doc/corpus evidence/ACL/version consistency. |
| UX24 | Engineering remaining | Public change views exist; large-change summary/filter consistency against basic list. |

| Gate | Disposition | Exact condition still required |
|---|---|---|
| G0 | Partial | Commit/environment/data/cost scope pinned; supported deployment configuration and full replay corpus baseline. |
| G1 | Not accepted | Synthetic vertical intake→compile→evidence→signed export→MCP/API/CLI, then separately authorized customer path. |
| G2 | Not accepted | Stable identity partial proof; continuous reconciliation, full-rebuild oracle and rollback. |
| G3 | Not accepted | Full concurrency/revocation/recovery/cost/observability acceptance beyond existing tests/SQL rehearsal. |
| G4 | External evidence missing | Locked holdout and independent authorized pilot time/cost/user feedback. |
| G5 | Not accepted | Complete consent/process/connect/limits/billing/cancel/export lifecycle; separate exact production activation. |

Exact CI aggregate at359005b:401files,5834passed+1skipped=5835total. The desktop aggregate separately recorded5835passed/0skipped; these are distinct runs. No skip is release acceptance. Exact CI Lighthouse evidence: https://github.com/0ssol1620-byte/tavonel-saas-foundation/actions/runs/36707876662/job/109862831762 . Thresholds were not relaxed.

Current engineering lane: Product QA functional classification, real mobile touch corrections, authenticated negative paths, source-reader interruption/history, followed by synthetic cross-revision consumer qualification. Core runner allocation remains blocked by account billing; local validation continues. No Core visibility change, production flag change, merge or deployment has occurred.

## Desktop qualification of the follow-up corrections

- Full Product QA on the frozen optimized local test build: **980passed,235conditional skips,0failed**,1215cases across1440/390/360/reduced-motion/audit/audit-768/audit-1280,6minutes with3workers and0retries. Skips are not accepted requirements; project-specific duplicate/width cases and customer/signed-export prerequisites remain distinguished. The initial run was936passed/36failed/235skipped;32failed cases referenced superseded film/entry contracts and4exposed actual360px inspector overflow. A subsequent extended test found and repaired a real history-restoration bug.
- Full launch suite on Chromium/Firefox/WebKit: **93passed,3existing signed-export skips,0failed**. Existing browser/export prerequisites are not silently waived.
- Original-source browser suite: **20passed** across1440/390/360/reduced motion. Real PDF bytes/digest, rendered ink, region identity, zoom containment, tamper refusal,503→manual retry, interrupted request, Back/Forward and repeated source restoration are exercised.
- Real defects fixed: new Home/pricing links now keep the44px touch floor; act navigation wraps within an explicitly bounded grid at360px rather than creating6px page overflow; URL restoration sets view state without pushing a new history entry and discarding Forward navigation. Neither overflow clipping nor relaxed touch/focus/performance thresholds was used.
- Superseded hero-film assertions now exercise committed source evidence, source route, eager/dimensioned/async image, mobile aspect preservation, reduced motion and keyboard actions. Locked film asset hashes and factual/locale/ACL/security guards remain tested; no test file was removed.
- Full Foundation unit run after the layout/contract corrections: **401files/5835passed**. After the history change, **27relevant files/532tests passed**; TypeScript and ESLint passed on the final source. Optimized local HTTP test build compiled153pages; production CSP and production flags remain unchanged.
- Latest43public captures show0document overflow/page errors. Actual desktop landing, mobile landing/Explore and360px source-inspector images inspected. Inspector diagnostic now measures360px viewport/360px document with no escaping elements. Founder/user visual approval is not implied.
- Core local product API/bridge/fragments/retrieval/semantics/image-contract qualification: **31passed**, using Python3.12.6, exact FastAPI0.140.13 and Pydantic2.13.4. One upstream Starlette/httpx deprecation warning; this is not full Core CI or paid quality acceptance.
- Exact-head Lighthouse at359005b passed all existing budgets in CI. The incremental UI head requires its own CI confirmation; local NO_NAVSTART was not counted as a successful measurement or product budget failure.

No new database source was changed in this follow-up. No customer data, new credentials, paid compute, production activation, merge or deployment was used. Next authorized engineering remains stable revision lineage/historical mapping and a synthetic cross-revision vertical consumer path; broader concurrency, ACL/revocation/restore/cost and large-corpus/format qualification remain explicit unfinished requirements.

## Public evaluation acceptance follow-up

The Korean evaluation form region previously exposed an English-only accessible name. It now derives its accessible name from the visible localized heading through aria-labelledby. Public evaluation-only changes do not touch authenticated backend/Core lanes.

Focused actual Chromium acceptance passed12cases at1440/390/360 for English and Korean: document language, exact canonical/OG/hreflang destinations, localized named region,3required fields/no file input,503refusal preserving the message and explicit retry. Contact requests were intercepted locally with synthetic values; no inquiry was sent externally. Relevant copy/locale/metadata/consent/truth unit contracts passed123tests in6files. TypeScript and ESLint passed; the optimized local test build compiled153pages. Actual Korean360px evaluation capture inspected. Broader live availability combinations and customer/production qualification remain unfinished;55item acceptance counts are unchanged.

## Sequential customer/Core integration

Customer lane commit d34cdf6f68bb25ec77e77f026962c0bb4d5ab309 was reviewed and cherry-picked onto the public evaluation follow-up without conflicts. Exact submitted-revision review, evidence-free publication refusal and historical restore's current source/session/role/entitlement guards are included. The complete boundary and remaining conditions are recorded in AUTHENTICATED_SYNTHETIC_JOURNEY_2026-09-30.md; no real authenticated customer E2E is claimed.

Integration focused tests passed79in6files, followed by frozen hermetic Foundation aggregate403files/5862passed/0failed/0skipped. Machine report SHA256:4686f5a8b906345258e3adc049a18e575c82c4423238eeccb7e7cdd12fddd6af. TypeScript and all app/components/lib ESLint passed. Source and permission refusals were retained. First focused invocation from the repository root failed2path-dependent catalogue tests; rerunning from the required nextjs directory passed all79. No failed invocation was counted as a pass.

The isolated Core integration independently passed54Product-Core and131identity/semantic-diff/recompilation boundary tests, Ruff and strict mypy for4changed source modules. Core source remains exclusively in the separate Core repository. Core's approved visibility cycle is complete and PRIVATE was verified after the terminal exact-head CI/security failures. Broader source lineage/concurrency/deletion/charge and real boundary qualification remain open;55item acceptance counts are unchanged.

Final integrated optimized localhost test build compiled153pages. Targeted actual-browser suites passed31cases with0retries: cross-tenant credential-boundary/refusal/no-leak checks now include the historical restore write route; fixture World lifecycle at1440/390 and compile reload/second-tab/disconnection/resume remain green. The credential refusal HTTP calls hit the real local server; authenticated success paths in these browser suites remain mocked. No real tenant/SQL/R2/Core or charge acceptance is implied. Full public ProductQA at0290adf passed separately in CI; it was not rerun in full for this backend-only successor.

## Workspace review/error UX qualification

Browser-only mutation/Ask handlers now catch network and unreadable-response errors, preserve pending input, release busy controls and explain uncertain outcomes. Lost activation/rollback replies do not claim that the active pointer is unchanged; readers are told to reload/check state before submitting again. No automatic mutation retry or backend route/permission change was added. Correction input is cleared only after the follow-up candidate read returns, so a recorded decision with an interrupted read does not erase the proposed edit.

New regression cases failed4/4 on the unchanged earlier build and passed after the fix. Frozen source World lifecycle suite passed45at1440/390/360 with0retries, including correction-read interruption and explicit Ask retry. Four focused360px error-state cases passed again with actual screenshot attachments. Relevant review/workspace unit contracts passed87in7files, TypeScript and ESLint passed, optimized localhost build compiled153pages. Final hermetic aggregate after the real-Core receipt integration:404files/5874passed/0failed/0skipped. No whole UX11/12/13 requirement is closed by this bounded fixture qualification, and55item acceptance totals are unchanged.

Selected-revision frontend defect is now fixed and qualified; see SELECTED_REVISION_UI_ACCEPTANCE_2026-09-30.md. Evidence/model/decision reads, publication digest, comparison and history navigation are bound to the inspected immutable revision. Current-source ACL and CAS refusals remain. UX12/UX13 are now newly assessed-partial, not whole-requirement complete. Updated global totals:2verified-complete /36partial /11not newly assessed /6external. Core cumulative lane counts0complete /18partial /9not newly qualified /4external use a narrower K qualification scope and do not replace this global matrix.

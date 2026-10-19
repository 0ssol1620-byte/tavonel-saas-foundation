# ICP decision — 2026-10-17: knowledge-owning teams with changing document sets, pilot purchase

Decision register row **D-02** (source PHASE1-CRITIC D-02; aliases U-F-2, KB-F1), class
`agent-now`, lane `ICP-RECORD`. Written 2026-10-19 by an agent. This record changes no wording
anywhere: no page, no constant, no price, no test, no claim, no evidence artifact, and not the
KB1 pre-registration file. It states who TAVONEL is designed and sold for, why, and what that
binds for the specimen set, the Korean benchmark and copy.

Until now no file in this repository named the ICP. The 2026-09-01 blueprint already said so:
"TAVONEL needs an explicit first ICP and a task-specific proof path, while keeping the compiler
substrate horizontal" (`docs/ULTIMATE_BLUEPRINT_IMPLEMENTATION_2026-09-01.md:132`). This record is
that ICP. It names the buyer only. The compiler substrate stays horizontal.

## The decision

**The question**, register D-02 `question`, verbatim:

> 설계 대상 ICP와 한국어 벤치마크 착수

**The adopted default**, register D-02 `adoptedDefault`, verbatim:

> 안 1: 자주 바뀌는 문서 묶음을 가진 지식 소유 팀, 한국 조직 포함, 파일럿 구매. KB1 T1(K1·K3·K4)부터
> 시작한다

**How it executes**, register D-02 `executesVia`, verbatim:

> [G9] NEW: ICP-RECORD — 안 1을 docs/gtm 결정 기록으로 남기고 KB1-PREREG `blocked_on`에서 D-02를 빼고
> sha 재발행. T1 실행은 KB-A7(D-32 뒤)

**Prerequisites**, register D-02: `KB-A1/A2/A4/A5/A6 (구현됨)`; `D-32 (주석자, T1 실행 때)`.

**Who decided.** The founder adopted every default in the decision register on 2026-10-17:
"파운더 결정은 모두 실서비스에서 업계 1위 될 수 있도록 너가 추천한 방향으로 진행해서 완료할 수
있도록해줘" (register header, 근거). That message adopts D-02's default. It approves no wording, sets
no price and no pilot term, and does not consent to any customer data use. This record is written by
an agent. It records the adoption and approves nothing itself.

Register D-02 `statusToday` before this record: `ICP 미기록; KB1 harness 구현(워크트리)`. After it:
the ICP is recorded here. The KB1 harness is unchanged. The pre-registration edit named in
`executesVia` was not made in this lane (see "The KB1 pre-registration").

D-02 merges two source decisions. They are worded differently, and the merged default keeps both:

| Source | Question | Recommendation, verbatim |
|---|---|---|
| UX-PLAN F-2 (`UX-PLAN-2026-10-17.md:828`) | 설계 대상 ICP | 안 1: 바뀌는 문서 묶음(규정·매뉴얼·기술문서, 한국어 포함)을 가진 지식 소유 팀, 파일럿 구매 |
| KOREAN-BENCHMARK-DESIGN KB-F1 (`KOREAN-BENCHMARK-DESIGN-2026-10-17.md:323`) | 한국 조직을 ICP로 보고 한국어 벤치마크를 시작하는가? | 예. T1(K1·K3·K4)부터 시작한다 |

The merged wording is "한국 조직 포함" (Korean organisations included). The ICP is not limited to
Korea, and Korean organisations are inside it.

## The ICP

Option 1 of `UX-PLAN-2026-10-17.md` §2.2 (lines 124–149). The table rows are quoted from its
option 1 column:

| | Option 1 (adopted) |
|---|---|
| Who pays | 규정·매뉴얼·기술문서처럼 **자주 바뀌는 문서 묶음**을 가진 팀의 책임자. 운영, 컴플라이언스, 지원 문서 담당이다. 파일럿 → Enterprise 순서로 산다 |
| Documents they hold | 스캔이 섞인 규정집과 매뉴얼, 표가 있는 사양서, **한국어 문서**(창업자와 첫 시장이 한국) |
| Fit with today's sales path | **맞다.** 유일한 구매 경로가 상담이다(`activation-policy.ts:85`) |
| Fit with capability limits | 맞는 편이다. 80쪽·5 MiB 상한과 경계 있는 코퍼스는 v4 §19.10의 기준과 같다 |
| Whether the moat shows | 근거 좌표, 버전, 변경이 이 팀의 고통과 바로 대응한다. 다만 재컴파일은 아직 "Direction"이라 약속할 수 없다 |
| First-screen specimen | 열화 스캔, 표 페이지, 한국어 문서가 **이 팀이 실제로 가진 문서**다 |

In one line: the buyer is the lead of a team that owns a frequently changing document set
(regulations, manuals, technical documentation), Korean organisations included. That team buys a
pilot first and Enterprise after it.

**Not chosen: option 2** (AI and platform engineers buying self-serve, $29 Developer → $99 Team,
`UX-PLAN-2026-10-17.md` §2.2). Its own row records why it does not fit today: "`selfService:false`,
`liveCheckout:false`".

**Revisit trigger**, `UX-PLAN-2026-10-17.md:149`, verbatim: "안 2는 `isLiveCommerce()`가 참이 되는
날 다시 정한다. 그날 바뀌는 것은 §6의 CTA 표와 Developer 카드뿐이고, 템플릿·토큰·specimen은
그대로다." `isLiveCommerce()` is `nextjs/lib/commercial-state.ts:89`.

## Why: the sources' reasons, re-checked against main `4c80bb30`

Every reason below comes from a source document. This record adds no reason of its own. Foundation
paths were read at this branch's base, main `4c80bb30`. The three commits above it on this branch
touch only `docs/`.

1. **The only paid path today is a pilot arranged in conversation.**
   `nextjs/lib/activation-policy.ts:85`: `customerData: { enabled: false, reason: "… Compiling
   your own sources is set up with us rather than enabled by a plan purchase." }`. The plan buttons
   route to contact: "Scope an Enterprise pilot" and "Talk to us about ${plan.name}"
   (`nextjs/components/pricing-page-client.tsx:964`, `:1311`). Team is `saleChannel: "contact"`
   (`nextjs/lib/billing-catalog.ts:39-57`).
2. **The capability limits fit a bounded corpus.** Live `GET /api/v1/capabilities` on 2026-10-17
   carries `at_most_80_pages_per_source`, `at_most_5_mib_per_source` and
   `no_table_or_formula_extraction` (receipt
   `korean-benchmark-receipts/LIVE-CAPABILITIES-20261017.json`, 11 occurrences each).
3. **It is the wedge the masterplan already chose.** The masterplan's "Initial wedge"
   (`docs/north-star/TAVONEL_MASTERPLAN_v4.0.md:4678-4695`) says "첫 paid pilot은 좁게". It lists
   three candidates: technical documentation/customer support, manufacturing manuals, and
   policy/compliance. Its selection criteria are: stale/version conflict pain, answer/evidence need,
   regular change, accessible decision maker, bounded corpus, and pilot success measurable.
   Option 1's 규정·매뉴얼·기술문서 are those three candidates. v5 PART 21
   (`TAVONEL_MASTERPLAN_v5.0.md:1664`) sets only the public abstraction and names no ICP. v5 does not
   contradict v4 §19.10, so under CLAUDE.md precedence v4 governs here.
4. **Korean organisations belong in it** (KB-F1 reason, `KOREAN-BENCHMARK-DESIGN-2026-10-17.md:323`).
   The site already has a Korean locale: decision G-D "한국어 로케일 → 도입"
   (`design-system/tavonel/decision.md:154` in the ai-knowledge-compiler repo). Today that means
   four `/ko` pages (`SERVICE-DEFINITION-2026-10-17.md` C21; `nextjs/app/ko/` holds `page.tsx`,
   `contact`, `evaluation`, `pricing`). v5 §8.2 already planned Korean real documents (`DART 150`,
   `TAVONEL_MASTERPLAN_v5.0.md:688-700`). And while nothing is measured, the only public sentence
   available is "측정하지 않았다".

## What this record binds, and what it does not

**Binds:**

- From now on, "the ICP" in any GTM document, study design or copy brief means option 1 as written
  above.
- **Blind comparison panel (D-08, P2-38).** "20명 중 10명 이상은 §2.2에서 고른 ICP에 속해야 한다"
  (`UX-PLAN-2026-10-17.md:684`). That clause now has a definite referent: at least 10 of the 20
  forced-choice evaluators come from teams that own a frequently changing document set. How they are
  recruited and screened, what they are paid, and the consent wording stay founder-hands (FH-10).
- **Korean benchmark.** KB1 starts, at tier T1 only (see below).

**Does not:**

- change any live string, price, plan card, trial condition or CTA;
- set a pilot price, pilot contract term or Enterprise scope. CLAUDE.md keeps "customer data
  consent, pilot contract terms, pricing" founder-only, and the register's 2026-10-17 adoption does
  not name a number;
- open self-serve, or change the Developer or Team card;
- retarget `/solutions`. Its five pages split by job role
  (`nextjs/app/solutions/[slug]/page.tsx:23, 58, 106, 152, 190`) and no register row rewrites them.
  A later rewrite would go through the G1 copy rules: the site says what the code does, with a
  failing test per sentence (register S6-17);
- allow any customer document into a benchmark or a specimen. D-31: "고객 문서는 동의 절차 뒤에만
  쓴다". KB-F8 excludes `D:\#센서 고객사 제공 자료`;
- support any Korean quality sentence (see "Copy").

## What changes for the specimen set

**No document is added or removed.** The set is D-05's, and D-02 changes only why it is that set.

- **The set (D-05, D-04).** Approved: NACA RM L50C03 page 1 (one-page extract), and 기상청
  「2026년 9월 기후특성」 page 1. D-04: the table slot stays off the first screen until the table lane
  reaches rollout (D-29). The strip starts with two slots, degraded scan and Korean.
- **What D-02 adds is the reason.** The slots are "이 팀이 실제로 가진 문서" (option 1, specimen row).
  The Korean slot is in the strip because Korean organisations are in the ICP, and D-04 already makes
  it one of the two slots. The rules that keep that slot honest are D-05's and do not move:
  - no board-level 공공누리 marking (SP-F2);
  - no synthetic fixture (SP-F6);
  - the reading is published as read, errors included.
- **If option 2 is ever chosen**, the set does not change: "같은 셋이 쓰이지만 동기가 약하다"
  (option 2 column), and "템플릿·토큰·specimen은 그대로다" (`UX-PLAN-2026-10-17.md:149`).
- **The Korean degraded scan** (국가기록원 공문서) is still a search task (specimen A6), not a slot.
  `SPECIMEN-CANDIDATES-2026-10-17.md` summary (line 17): slot (1) is already filled by NACA.
- **No new step.** The pipeline stays as follows, and none of it starts because of this record:
  - P2-23 (rights snapshots, implemented);
  - P2-31 (reading in the evaluation tenant, which needs FH-01/D-30);
  - P2-32 (`specimen-sources.json` and failure-path tests).

## What changes for the Korean benchmark

**KB-F1 is answered yes.** KB1 starts with tier T1. The figures below are from
`KOREAN-BENCHMARK-DESIGN-2026-10-17.md` §4 and §5.8, with the sizing receipt
`korean-benchmark-receipts/KO-BENCH-SIZING-20261017.json`. Every hour figure is an estimate with no
receipt.

| Tier | Categories | Pages (confirm + calibration) | Annotation hours (estimate) | Status |
|---|---|---|---|---|
| **T1** | K1, K3, K4 × (50 + 10) | 180 | about 192 (K1 34, K3 64, K4 94) | adopted, runs after D-32 |
| T2 | K1–K6 × (100 + 20) | 720 | about 788 | not adopted; "T2는 파일럿 실측 뒤 다시 판단한다" (D-32) |

**Why these three categories serve this ICP**, from the design's category table (lines 148–151):

- **K1**, born-digital Korean body text: "가장 흔한 한국어 PDF. 대조 기준선".
- **K3**, tables: the capability says `no_table_or_formula_extraction`, so TEDS and in-table CER are
  measured separately.
- **K4**, scanned official documents with seals and approval boxes: "한국 조직 문서의 대표 유형".

**Not measured in T1:** K2, K5 and K6. HWP/HWPX is not measured either, because it is not supported
(D-33, KB-F7). Every unmeasured category is published as "측정 안 함", never left blank (§5.10).

**Gates that still stand before any T1 run:**

- D-10 seals the pre-registration with n ≥ 50 and family ≥ 10 per category.
- D-31 fixes the corpus rights policy.
- D-32 contracts the annotators: two native speakers and one independent adjudicator. GPU spend is
  capped at USD 50, and the API arm is approved separately after a price snapshot at run time.
- After those three, KB-A7 runs the pilot (a 30-page calibration set, with annotation time measured)
  and replaces the hour estimates with measured medians. Then T1 runs.

**What T1 can say once it runs.** The worst-case 95% CI half-width at n = 50 is ±13.9 points
(§5.8). So T1 can say roughly what level a category sits at. It cannot rank small differences.

**Risk the design names.** The Korean pass runs with the angle classifier off (`I-9`), so it may
fail heavily on K4. A failure is published as a result, on the same principle that keeps the 36.9%
low-quality-scan row (§7).

### The KB1 pre-registration

`KB1-PREREG.json` (sha256 `cb51fd44b8e9cb5fcd680d8dd75e5f0ae9166934275e4916c212612ce1fe1dff`, status
`DRAFT_PROPOSED`) lists D-02 in `blocked_on` with `"status": "OPEN"`. **This record answers that
entry.** The file itself was **not** edited in this lane, for three reasons:

1. Two receipts pin the current bytes:
   - Lane P2-27's acceptance check reads "blocked_on에 D-02·D-10·D-31·D-32가 있고 sha가 일치한다"
     (`PHASE2-LANES.json`).
   - `core-lanes/KB-A1/KB-A1-RECEIPT.json` records `prereg_sha256` `cb51fd44…`.

   Rewriting the file in place would leave both receipts pointing at bytes that no longer exist.
2. The pre-registration's own procedure changes it by writing a new revision, not by editing the
   draft. Step 6 reads "status를 FOUNDER_APPROVED_SEALED로 바꾼 새 revision을 쓰고 그 sha256과 UTC
   시각을 … receipt로 남긴다".
3. D-10 (lane PREREG-SEAL) already writes that revision and reissues the sha sidecar, and D-02 is a
   prerequisite of D-10. Folding the D-02 resolution into that one revision gives one new sha
   instead of two.

**Handed to PREREG-SEAL (D-10):** in the new revision, drop D-02 from `blocked_on`, or mark it
resolved, and cite this file and its commit. D-10, D-31, D-32 and the `agent_build` entries stay
until their own lanes close them.

## What changes for copy

**No string changes because of this record.** What it binds for copy that addresses this ICP:

- **Korean quality is S0 only.** The allowed sentence is "한국어 문서 품질은 아직 측정하지
  않았습니다. 한국어 PDF는 BEST_EFFORT로 처리됩니다. HWP/HWPX는 지원하지 않습니다."
  (`KOREAN-BENCHMARK-DESIGN-2026-10-17.md` §5.9). Under D-33 it is published on `/sources` only, not
  on the `/ko` first screen, which is a hedge-free surface (register C1, lane P2-33).
- **What stays barred:**
  - "한국어 지원", "한국어에 강함" and "업계 1위" (`KB1-PREREG.json` `not_claimable_ko`, §5.9 S0);
  - any internal KB1 number in public copy before a category meets the sealed publication bar (§5.9
    S1);
  - any S2 sentence without its receipt link.
- **"Your documents" is true only on the pilot path.** The intake sentence stays on the same screen
  as the H1 (`SERVICE-DEFINITION-2026-10-17.md` §4.2). Today that sentence is "We arrange intake for
  your own sources with you." (`nextjs/components/landing-v2/landing-page.tsx:107`). The pilot
  layer's publishable sentence, "Compiling your own sources is set up with us." (§4.3), is already
  the S6-17 G1-COPY replacement.
- **Change is this ICP's pain, but recompilation cannot be promised.** "Selective recompilation" is
  `state: "Direction"`: "Demonstrated on the public sample. Not offered as a shipped capability in
  TAVONEL today." (`nextjs/lib/capabilities.ts:78`). Option 1's own row says the same: "재컴파일은
  아직 "Direction"이라 약속할 수 없다". Copy aimed at teams with changing document sets says what is
  live: evidence coordinates, revisions and changes on the public World. It does not say that a
  change to their documents recompiles automatically.
- **No promise past the manifest limits.** The limits are 80 pages and 5 MiB per source, and no
  table or formula extraction (live capabilities receipt). Korean UI and docs sit in the "계획" layer
  (`SERVICE-DEFINITION-2026-10-17.md` §4.3). Copy does not imply Korean coverage beyond the four
  `/ko` pages.

## Founder hands

Each of these is outside an agent's authority. The register adoption sets none of them.

1. **Pilot price and contract terms: FOUNDER-SET.** Question: "What does the knowledge-owning-team
   pilot cost, for how long, over what corpus size, and on what terms does it convert to
   Enterprise?" CLAUDE.md keeps pilot contract terms and pricing founder-only. No number for them
   exists in the sources.
2. **Annotator hourly rate: FOUNDER-SET.** Question: "What hourly rate are the two KB1 annotators
   and the adjudicator paid?" KB-F3 says "시간 단가는 창업자가 정한다", and FH-11 contracts them.
3. **FH-11 (D-32).** Contract two native Korean annotators and one independent adjudicator for
   about 192 hours (estimate), and confirm the USD 50 GPU cap. T1 does not run before this.
4. **FH-10 (D-08).** Recruit the blind panel. Screening for at least 10 of 20 ICP members is part of
   the recruiting route, and the consent wording is the founder's.
5. **FH-01 (D-30).** Open the evaluation tenant. Specimen reading (P2-31) needs it, and this record
   does not.
6. **Any pilot customer document used for a benchmark or a specimen.** This needs customer consent,
   which is founder-only (D-31, KB-F8).

## Sources

`R` = `D:\CodexProjects\ai-knowledge-compiler\outputs\tavonel-research-replan-20261013\ux-program-20261017`.
sha256 over the file bytes on 2026-10-19.

| Path | sha256 |
|---|---|
| `R\DECISION-REGISTER-2026-10-17.md` (row D-02, line 44; §5 C1) | `5935276d245d230857fa632dcb6555d25756470d37f404fc6c3c00dc71d7c6dc` |
| `R\DECISION-REGISTER-2026-10-17.json` (object `id: "D-02"`) | `86234c9397cec2d0ac8160276e525943857e7b2ec21e5e3a3b9891cc394120d3` |
| `R\PHASE1-CRITIC-2026-10-17.md` (D-02, line 242; D-04, D-05) | `667010c53a226f980241fc61b3581112cabae954867affc35e24eebf3f8efa81` |
| `R\UX-PLAN-2026-10-17.md` (§2.2 lines 124–149; §7.3 line 684; F-2 line 828) | `f51bce9b9e8761e476f3f99ded841a36443a8eff73e817fc8c8a51616f7b8c42` |
| `R\KOREAN-BENCHMARK-DESIGN-2026-10-17.md` (§1 line 44; §4 lines 148–151; §5.8–5.10; KB-F1 line 323) | `f7fa20afe1e80aa62e1fd753a31b1a84e320299af191c8ec619272dcfa137b7e` |
| `R\SERVICE-DEFINITION-2026-10-17.md` (C21; §4.2; §4.3) | `c7783dd718713b7564697ce6df7e6abbad9ffc2489624b3ad3705e610b528dee` |
| `R\SPECIMEN-CANDIDATES-2026-10-17.md` (summary; SP-F2, SP-F6; A6) | `ebc63763565857897104ea5f527b7b85df6bc9212a38fb5f186d46bd7027bb94` |
| `R\KB1-PREREG.json` (`blocked_on`, `not_claimable_ko`, procedure step 6) | `cb51fd44b8e9cb5fcd680d8dd75e5f0ae9166934275e4916c212612ce1fe1dff` |
| `R\korean-benchmark-receipts\KO-BENCH-SIZING-20261017.json` | `af4850f3ea6b8d44f54b0f2a91bf8f9a1b455817683cebfd62bec42e66aa537d` |
| `R\korean-benchmark-receipts\LIVE-CAPABILITIES-20261017.json` | `e1e5a4207fe2ec2a823fff74e5c67c1cbf4cc23ea6548c7db9955b3e428ef7a5` |
| ai-knowledge-compiler `docs/north-star/TAVONEL_MASTERPLAN_v4.0.md` (lines 4678–4695) | `c996c372ca4702af1f11a67da61fee90c54c332b9238a89f0e1df7942d1b5e5a` |
| ai-knowledge-compiler `docs/north-star/TAVONEL_MASTERPLAN_v5.0.md` (lines 688–700, 1664) | `35e6bcec1ed5bab30b86478d8d44e20e66d71adb1bcf9f921804cf99f06b19b7` |
| ai-knowledge-compiler `design-system/tavonel/decision.md` (G-D, line 154) | `ca8cd7d8f5fa34b4573b5466ed67a008fc540f7bfcab8c49d0288e9314919be6` |

Foundation files, cited at main `4c80bb30`:

- `nextjs/lib/activation-policy.ts:85`
- `nextjs/lib/billing-catalog.ts:22-57`
- `nextjs/lib/capabilities.ts:78`
- `nextjs/lib/commercial-state.ts:89`
- `nextjs/components/pricing-page-client.tsx:964, 1311`
- `nextjs/components/landing-v2/landing-page.tsx:107`
- `nextjs/app/solutions/[slug]/page.tsx:23, 58, 106, 152, 190`
- `nextjs/app/ko/`
- `docs/ULTIMATE_BLUEPRINT_IMPLEMENTATION_2026-09-01.md:132`

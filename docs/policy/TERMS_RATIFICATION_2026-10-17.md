# Terms ratification — 2026-10-17: the live /terms, /privacy, /refunds and /subprocessors are ratified as published

Decision register row **D-16** (source PHASE1-CRITIC D-16; alias J-FD-05; journey defect D-10),
class `agent-now`, lane `TERMS-RATIFY`. This record changes no wording anywhere: no page, no
policy file, no constant, no test. It pins what was ratified and lists what it does not settle.

## The decision

**The question**, register D-16 `question`, verbatim:

> 이미 라이브인 약관 템플릿과 환불 14일·10% 비준

**The adopted default**, register D-16 `adoptedDefault`, verbatim:

> 지금 비준하거나 고친다. 법률 항목 중 가장 먼저 처리한다

**How it executes**, register D-16 `executesVia`, verbatim:

> [G5] NEW: TERMS-RATIFY — "현행 라이브 문자열 그대로 비준"을 창업자 2026-10-17 위임 메시지와 함께
> 결정 기록으로 남긴다. `billing-catalog.ts:81-100`과 refunds 페이지 바이트 변경 0(C5)

**Why "ratify", not "revise"**, register §5 C5, verbatim:

> 고칠 원문이 없고 법률 문구는 CLAUDE.md상 창업자 전용이다. → 현행 라이브 문자열 그대로 비준(바이트
> 변경 0)만 채택하고 오늘 위임 메시지를 근거로 기록한다. 수정은 창업자나 counsel 원문이 생길 때만

**Who decided.** The founder, on 2026-10-17, by adopting every default in the decision register:
"파운더 결정은 모두 실서비스에서 업계 1위 될 수 있도록 너가 추천한 방향으로 진행해서 완료할 수
있도록해줘" (register header, 근거). That message adopts D-16's default. It does not approve any
page's wording, it is not a statement that the founder has read these pages, and it is not a
counsel opinion. This record is written by an agent; it records the adoption and approves nothing
itself.

Register D-16 `statusToday` before this record: `라이브 게시 중, 비준 기록 없음`. After it: the
ratification record exists, and the four pages are byte-for-byte what they were.

## What is ratified

The strings tavonel.com served on 2026-10-17 from production deployment
`dpl_7fEfTdmcPi8FfDyrXs17dMiF9gm2`. Vercel `get_deployment` reports that deployment as
`target: production`, `readyState: READY`, `githubCommitRef: main`,
`githubCommitSha: 4c80bb3028fb73dc88e929c25baf0bec97bee4e7`, with `tavonel.com` among its aliases.
All four pages captured on 2026-10-17 reference that deployment ID.

### Source files, pinned at `4c80bb30`

sha256 is `git show 4c80bb30:<path> | sha256sum` (repository bytes, not a Windows CRLF checkout).

| Page | File | sha256 at `4c80bb30` | What it contributes |
|---|---|---|---|
| /terms | `nextjs/app/terms/page.tsx` | `cab8de97c4609d3eeb99aff9ce4bdb13109843cf314cb78234a1776dfb7a7c1d` | Page; renders the published terms file and refuses to render if its bytes do not match the manifest |
| /terms | `nextjs/public/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md` | `de4c156109056fd8ac16c7ff674e94304fe05a409477371ffc547c05c173f7d6` | The self-service terms text; equals the manifest's `terms.sha256` |
| /terms | `nextjs/public/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md` | `086d6680cf9999a1c86141348e36abfbd18d5000e610ba854cd53e6efd59eab5` | The processing addendum linked from /terms and /privacy; equals the manifest's `processing.sha256` |
| /terms, /privacy | `nextjs/public/policy/processing-terms-2026-09-30.json` | `a53a31b0c4eba8c64f74467b1b63351dd39e118bf20c4babe16756d99f289baf` | Manifest: version `2026-09-30` and the two document hashes |
| /terms | `nextjs/components/legal-operator-disclosure.tsx` | `3d6b244694dc0ac19b54a6acfce423eb6c81358693a2e222e0530e96c94df4e5` | Operator disclosure block |
| /terms | `nextjs/lib/legal-operator.ts` | `c4ec7f045c27561aa62c7734d4eb0a3fc8222426c9629f2ea5a0f1a36cc2a58c` | Reads the operator details from `TAVONEL_LEGAL_*` env (see below) |
| /privacy | `nextjs/app/privacy/page.tsx` | `349046598fe174494b8f6503854f8be52e209e6d64229c2adee263691e56ec5a` | Page |
| /refunds | `nextjs/app/refunds/page.tsx` | `3da61277279faea83a20b76c7db923eb9b879230306f93704aa4f7b0556990aa` | Page; two templates, chosen by `liveChargesEnabled` |
| /refunds | `nextjs/lib/billing-catalog.ts` | `95406c3bcaf6f2db7f2e5f25046a32a987c56596869bf5a2fb1b225fae94f28c` | `REFUND_WINDOW_DAYS = 14` (`:99`), `REFUND_MAX_CONSUMED_FRACTION = 0.1` (`:100`), plan labels and `includedPages` 500 / 2,500 (`:25`, `:28`, `:42`, `:45`) |
| /refunds | `nextjs/lib/commercial-state.ts` | `19c991d632f04f992d4a43ce32fdbe18721d0296021e65e53aee09210ebc9ebc` | `readCommercialState()`, which picks the refunds template |
| /subprocessors | `nextjs/app/subprocessors/page.tsx` | `c96505dd17154c72223ca4b7efc6aef1a917874105fcb0f12f5b33a9dbb30f44` | Page, including the provider table |
| /privacy, /refunds, /subprocessors | `nextjs/lib/operations.ts` | `e1f68144171f74d3678dd51f4eb3bd9bf16c78d304948c78e79310ee09eea7eb` | `LEGAL_EFFECTIVE_DATE = "2026-08-30"` (`:10`), `LEGAL_LAST_UPDATED = "2026-09-30"` (`:21`), `LEGAL_DRAFT_NOTICE` (`:44`) |
| all four | `nextjs/components/policy-layout.tsx` | `a12a154887f7590fa5e3c13e52b6f44f8eff9a76f9efa4e3e053a6f27446c0a8` | Shared layout and date line |

The register names `billing-catalog.ts:81-100`: that range is the refund comment block (`:81-98`)
and the two constants (`:99-100`).

### Live captures

`GET https://tavonel.com/{terms,privacy,refunds,subprocessors}` on 2026-10-17T11:37:34Z, all HTTP 200.
Files and sha256 are in the lane receipt (`records\TERMS-RATIFY\live\`). Each capture was checked
for strings from the pinned sources:

- /terms shows both manifest hashes above and the "Service operator" heading.
- /privacy and /subprocessors show `Effective 2026-08-30 · Last updated 2026-09-30` and
  `LEGAL_DRAFT_NOTICE`; /privacy names the Personal Information Protection Act (PIPA); /subprocessors
  shows the Google Cloud row "Seoul (asia-northeast3), set in the service configuration".
- /refunds serves the **live** template: "Within 14 calendar days of a payment … provided fewer than
  10% of your plan's included pages have been consumed when you ask: 50 pages on Developer, 250 on
  Team." The pilot template's "Nothing can be charged" does not appear. The capture is byte-identical
  (sha256 `e5437a6d62d64efa53e9d0dbc5d3a5bc1adc1cf880d47ff5ba433216972edf1e`) to the journey capture
  taken at 2026-10-17T01:36:35Z (`journey-live-20261017\refunds.html`).

### Two things the source hashes do not pin

- **The refunds template.** `refunds/page.tsx` holds two templates. `readCommercialState()` serves the
  live one only when `VERCEL_ENV` is production (or unset), `COMMERCIAL_MODE` is `live`,
  `PADDLE_SANDBOX` is not `true` and `TAVONEL_BILLING_LAUNCH_APPROVED` is `true`
  (`commercial-state.ts`). Production serves the live template today. D-16 asked about that
  template. The pilot template sits in the same file under the same hash and is not changed here,
  but it is not the text being served, and it carries no refund figures.
- **The operator details.** The business name, representative, registration number, address, phone
  and email come from the `TAVONEL_LEGAL_*` production env through `readLegalOperator()`. The
  source hash does not cover them. The live /terms capture records what was served at retrieval
  time. This record does not repeat those details.

## What this record does not do

- **It does not tick a box in another record.** `docs/policy/REFUND_THRESHOLD_DRAFT.md` keeps
  "Founder ratified the two numbers directly (FD-04) — the delegation did not supply this" unchecked.
  The 2026-10-17 message adopts register defaults in bulk. It is not a direct reading of the two
  numbers, and an agent cannot supply that confirmation (§6 step 2 of that record). If the founder
  wants that box ticked, the founder does it.
- **It does not edit stale sentences it found.** Two sentences at `4c80bb30` describe a state that
  no longer holds. They are left as written and are reported here:
  - `billing-catalog.ts:96-97`: "Nothing can be charged yet either -- `liveChargesEnabled` is false".
  - `REFUND_THRESHOLD_DRAFT.md`: the clause is "currently unreachable"; and the checklist line
    "`/refunds` live template renders them" is unchecked, although `refunds/page.tsx:118-131`
    renders `REFUND_WINDOW_DAYS` and `REFUND_MAX_CONSUMED_FRACTION`.

  Production serves the live template, so the refund clause is published. Plan purchase is still
  closed: `/api/status/v2` reported `purchasePlan.enabled: false` at 2026-10-17T01:36:34.945Z
  (`journey-live-20261017\api-status-v2.json`).
- **It does not settle a legal question.** Every item below stays open.

## Still open — founder-only (counsel review stays the founder's)

The task named two places to look for open legal items. **SERVICE-DEFINITION §7 names none**: its five
unverified items are production env values, production DB counts, the CDR image digest and Vercel and
Supabase state, post-login screens, and the RunPod endpoints. **The register names these:**

1. **D-16 / C5.** Any revision of these four pages waits until the founder or counsel supplies the
   text. An agent writes no new legal sentence.
2. **C4 / D-14.** The hold and consent wording reuses only the live sentence "Developer is held for
   you."; no new consent or terms sentence is written (lane P2-29).
3. **D-31.** DART stays refused in the corpus rights manifest until counsel confirms.
4. **D-34 / FH-20 (optional, releases a hold).** Counsel reviews the §2.2 terms of Reducto,
   LlamaIndex, LandingAI and Unstructured before any written benchmarking permission is requested.
5. **C13.** New pricing numbers and new legal sentences stay out of agent-written copy, even under
   the 2026-10-17 adoption.

**The records these four pages rest on name these**, and they bind the same pages:

6. **Refund clause, `REFUND_THRESHOLD_DRAFT.md` §5.** Five questions for a lawyer are unanswered:
   digital-content withdrawal exceptions and checkout acknowledgement; whether a share of a metered
   allowance is "digital content fully delivered"; whether a promoted world is a delivered
   deliverable; whether a per-renewal reset must be stated; which jurisdictions are in scope at
   launch. Its checklist line "Legal reviewed §2 and answered §5; jurisdictions in scope named" is
   open.
7. **/terms, /privacy, /refunds wording, `DECISION_LOG_2026-09-16.md` SD-07.** Governing law, court,
   liability cap, warranty disclaimer, indemnity, change notice, the PIPA/GDPR framing and the single
   refund rule were set by delegated decision. That record says "the founder's counsel review is
   still required and is recorded as pending".
8. **DPA, `DPA.md` "Still open".** Open: §9 recovery objectives; §10 completed SCC and UK Addendum
   annexes, including the transfer impact assessment; §13 signature blocks and registered details
   on the executed version. The same section says "none of the 2026-09-16 wording has been read by
   a lawyer". Signing the
   DPA is listed with the founder under "Not decided here" in `DECISION_LOG_2026-09-16.md`.
9. **Before live sales, `OPERATIONS_READINESS_2026-08-30.md:17`.** "Korean counsel review before live
   sales". **Before a real charge, `PROVIDER_PROVISIONING_STATUS.md:13`.** "merchant review, tax/legal
   review" among the conditions for accepting a real charge.

## Sources

Register, service definition and journey files are under
`D:\CodexProjects\ai-knowledge-compiler\outputs\tavonel-research-replan-20261013\ux-program-20261017\`.
Repository paths are in this repository at `4c80bb30`.

| Source | sha256 |
|---|---|
| `DECISION-REGISTER-2026-10-17.md` (header 근거; row D-16; §5 C4, C5, C13; FH-20) | `5935276d245d230857fa632dcb6555d25756470d37f404fc6c3c00dc71d7c6dc` |
| `DECISION-REGISTER-2026-10-17.json` (row `D-16`) | `86234c9397cec2d0ac8160276e525943857e7b2ec21e5e3a3b9891cc394120d3` |
| `SERVICE-DEFINITION-2026-10-17.md` (§7) | `c7783dd718713b7564697ce6df7e6abbad9ffc2489624b3ad3705e610b528dee` |
| `PHASE1-CRITIC-2026-10-17.md` (`:143`, `:256`) | `667010c53a226f980241fc61b3581112cabae954867affc35e24eebf3f8efa81` |
| `JOURNEY-MAP-2026-10-17.md` (defect D-10 `:207`; FD-05 `:493`) | `c73694fda0f32f6a5d004c8f838b741a0c5f78762a3b2fea4b3006277ddff4f1` |
| `journey-live-20261017\refunds.html` | `e5437a6d62d64efa53e9d0dbc5d3a5bc1adc1cf880d47ff5ba433216972edf1e` |
| `journey-live-20261017\api-status-v2.json` | `e2d2721b3459963ab0dda01d53211bf8a2e155bc2274ed8c39076a10ecbf2f4d` |
| `docs/policy/REFUND_THRESHOLD_DRAFT.md` | `4f6b934ebafb60d00fe0721163cd978dd50806c7434da778664d7a9de2808a73` |
| `docs/policy/DECISION_LOG_2026-09-16.md` | `4f10008f341f0f0949cb279fd2b6e165c032f9fd80328d7b7c24dac42cdced55` |
| `docs/policy/DPA.md` | `1738cf7f60bc6108d7efcc707bdf3fb26d3a9e75654b85da7d7642b2cf7e0785` |
| `docs/OPERATIONS_READINESS_2026-08-30.md` | `016f0dd90fbf6e71ef4204f107653ac44f66e6ebc523ac906a36565f60f75ac1` |
| `docs/PROVIDER_PROVISIONING_STATUS.md` | `4a85dfdf2819712a6cadb62874bf735f42e64e21b71350a26a0d681574be5d67` |

Because this file is under `docs/policy/`, it is part of the `policyBundle` digest the next
`release:manifest` computes (`nextjs/scripts/release-manifest.mjs`). Nothing else reads it.

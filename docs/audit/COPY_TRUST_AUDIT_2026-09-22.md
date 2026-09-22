# 공개 카피 신뢰 감사 — 2026-09-22

**레인** `copy` · **브랜치** `agent/no1-copy-20260922` · **베이스** `origin/main` (9370681)

## 무엇을 감사했는가

tavonel.com에서 구매자가 첫인상을 형성하는 표면의 모든 문장을 읽었다: 홈(`/`, `/ko`),
`/product`, `/knowledge-compiler`, `/explore`, `/pricing`, `/enterprise`, `/solutions`,
`/integrations`, `/sources` 히어로, `/developers` 히어로, `/trust` 히어로, 전역 내비게이션과
푸터, 모든 CTA, `/workspace` 온보딩 빈 상태. 카피가 페이지가 아니라 타입 레코드에 사는
경우(`lib/landing-v2-copy.ts`, `lib/site-navigation.ts`, `lib/activation-policy.ts`,
`lib/explore-story.ts`, `lib/billing-catalog.ts`, `components/pricing-page-client.tsx`)에는
그 모듈을 읽었다.

판정 기준은 이 저장소가 이미 코드로 쓰고 있는 배치 원칙이다 —
`shared/intakeCeiling.ts`와 `shared/capabilityManifest.ts`가 말하는 대로, **한계는 고객이
그것을 만나는 자리에 공개한다**: 역량 표, 거절 문구, 가격 세부, 계약 조항. 히어로가 아니다.
그래서 이 감사는 공개 사실을 하나도 지우지 않는다. 옮기고, 그 외의 자리에서 헤지를 멈춘다.

`CLAUDE.md`의 증거 규칙이 구속한다: 영수증 없는 수치 주장 금지, 완료율을 "accuracy"로
부르지 않기, 모든 비율은 분모와 함께, 경쟁사 수치는 인용이지 재현이 아님, 실패한 가설은
공개한다.

## 결과 요약

| 분류 | 건수 | 처리 |
|---|---|---|
| **A** 공개 가치 없는 자기 훼손 헤지 | 5 | 재작성 |
| **B** 세부 표면에 속하는 공개 | 1 | 이동 + 링크 |
| **C** 올바른 자리에 있는 필수 공개 | 13 | 유지 |
| **D** 영수증이 없는 주장 | 2 | 제거 / 사실에 결박 |

> 참고. 이 저장소의 카피는 이미 여러 차례 감사(BA-0xx, BQ-1xx, G1-0xx, G2-0xx, C1–C4)를
> 거쳤고 `lib/public-copy-purge.test.ts`가 방어적 어휘를 이미 막고 있다. 남은 것은 그
> 스윕이 잡지 못하는 **헤지 레지스터**다 — 주장을 방어하는 문장이 아니라 자기 동사를
> 약하게 만드는 문장. A/D 항목 대부분이 여기서 나왔다.

---

## A — 공개 가치 없는 자기 훼손 헤지 (재작성)

### A1 · 홈 Scene 07, 컴파일러 계약 행

`nextjs/lib/landing-v2-copy.ts:449` (EN) / `:662` (KO)

```
note: "See which behavior is available and which remains qualified."
note: "사용 가능한 동작과 아직 조건이 붙은 동작을 구분합니다."
```

"remains qualified"는 우리 내부 상태 어휘다. 독자는 이 링크 뒤에 무엇이 있는지 알고 싶지,
그중 얼마가 아직 조건부인지 세러 가는 것이 아니다. 그리고 목적지 페이지
(`/product/continuous-knowledge`)는 여덟 조항 **각각의 상태를 이미 표시한다** — 즉 이 문장은
세부 표면이 하는 일을 미리 사과한 것이다.

**재작성**

```
note: "Read the eight clauses of the compile contract and the state each one holds here."
note: "컴파일 계약의 여덟 개 조항과 각 조항이 여기서 갖는 상태를 읽습니다."
```

상태는 여전히 예고된다. 사라진 것은 "아직"뿐이다.

### A2 · 홈 Scene 07, 접근 행

`nextjs/lib/landing-v2-copy.ts:451` (EN) / `:664` (KO)

```
note: "Use the access path only after the public result answers your questions."
note: "공개 결과를 확인한 뒤 접근 경로를 이용합니다."
```

사이트의 전환 행동에 "아직 오지 마세요"라는 조건이 붙어 있었다. Scene 09가 이미
"Read a finished Compiled World first. Bring your own sources when you are ready."로 같은
순서를 권한다 — 권유는 한 번이면 되고, CTA 옆은 그 자리가 아니다.

**재작성**

```
note: "Talk through your own sources and the intake path that fits them."
note: "직접 가진 원문과 그에 맞는 반입 경로를 함께 논의합니다."
```

### A3 · 홈 Scene 08, 신뢰 경계 헤드라인과 지지문

`nextjs/lib/landing-v2-copy.ts:458` (EN) / `:671-672` (KO)

```
headline: "Read what this deployment actually does."
headline: "이 배포판이 실제로 하는 일을 읽어 보세요."
support: "이 배포판이 실제로 하는 네 가지이며, 각각 확인할 수 있는 곳에 적혀 있습니다."
```

"actually" / "실제로"는 독자가 제기하지 않은 의심을 대신 제기한다. 네 개의 증명이 각각
검증 가능한 페이지로 링크된다는 사실이 그 일을 이미 하고 있다.

**재작성** — `actually` / `실제로` 삭제. 영어 지지문은 원래 그 단어가 없어 그대로다.

```
headline: "Read what this deployment does."
headline: "이 배포판이 하는 일을 읽어 보세요."
support: "이 배포판이 하는 네 가지이며, 각각 확인할 수 있는 곳에 적혀 있습니다."
```

### A4 · `/workspace` 온보딩 체크리스트 상태

`nextjs/components/workspace-getting-started.tsx:82`

```
<small className="workspace-step-state">{step.done ? "Done" : "Not yet"}</small>
```

체크리스트의 미완료 상태는 할 일이지 사과가 아니다. "Not yet"은 사용자가 무언가를 놓친
것처럼 읽힌다 — 방금 가입한 워크스페이스의 첫 화면에서.

**재작성** `{step.done ? "Done" : "To do"}`

### A5 · `/integrations` 미지원 시스템 문단

`nextjs/app/integrations/page.tsx:203-206`

```
That is the whole list. {NO_CONNECTOR…} have no connector here, none of them is on a
published roadmap, and nothing on this site says when one would arrive. Where such a
system keeps its files in one of the cloud drives below, or exports to a directory or a
bucket, that path works today; the system's own API is not read.
```

"no connector here"가 이미 답이다. "none of them is on a published roadmap"과 "nothing on
this site says when one would arrive"는 같은 부재를 두 번 더 말하고, 두 번째는 제품이 아니라
**이 사이트에 대한 메타 발언**이다. Confluence를 찾아온 독자에게 필요한 것은 답이지 부재의
삼중 확인이 아니다. 대안 경로 문장과 "the system's own API is not read"는 실제 정보이므로
남는다.

**재작성**

```
That is the whole list. {NO_CONNECTOR…} have no connector here. Where such a system keeps
its files in one of the cloud drives below, or exports to a directory or a bucket, that
path works today; the system's own API is not read.
```

---

## B — 세부 표면에 속하는 공개 (이동 + 링크)

### B1 · 홈 Scene 05, 재컴파일 계약 주석

`nextjs/lib/landing-v2-copy.ts:387` (EN) / `:619` (KO)

```
"Recompiling only what depends on a changed source is the compiler contract. This
 deployment compares two complete compiles rather than performing a selective rebuild."
"바뀐 원문에 의존하는 부분만 다시 컴파일하는 것은 컴파일러의 계약입니다. 이 배포판은
 선택적 재빌드를 수행하지 않고 두 번의 전체 컴파일을 비교합니다."
```

"When new sources arrive, the knowledge is compiled again."라는 헤드라인 아래 작은 글씨가
**여기서 돌지 않는 것**을 말한다. 같은 장면의 `support`가 이미 "Each snapshot of this World is
a complete compile of the corpus as it stood"라고 메커니즘을 긍정문으로 말하므로, 두 번째
문장은 그것을 결함으로 다시 진술한 것이다.

그리고 이 경계의 **완전한** 답은 이미 세부 표면에 있다 —
`app/product/continuous-knowledge/page.tsx:178-188`이 다이어그램에서 어느 두 단계가 실행되고
어느 것이 점선인지, 그리고 05번 조항이 무엇을 말하는지 문장으로 공개한다. `contractHref`가
이미 그 페이지를 가리킨다. 그러므로 옮길 곳을 새로 만들 필요가 없다.

**재작성** — 메커니즘이 앞, 계약이 뒤, 경계는 그대로.

```
"Every snapshot here is a complete compile of the corpus, and the comparison names what
 the arriving filings changed. A selective rebuild — recompiling only what depends on a
 changed source — is the compiler contract, published clause by clause."
"여기의 모든 스냅샷은 자료 전체를 컴파일한 결과이고, 비교 결과가 도착한 공시 문서가 무엇을
 바꿨는지 알려 줍니다. 바뀐 원문에 의존하는 부분만 다시 컴파일하는 선택적 재빌드는
 컴파일러의 계약이며, 조항별로 공개되어 있습니다."
```

약화 여부 확인: "selective rebuild"라는 단어와 "complete compile"이라는 단어가 둘 다
남는다. 선택적 재빌드가 여기서 돈다고 읽힐 문장은 없다. `lib/landing-v2-copy.test.ts:204`의
규칙 7 가드(`contractNote`가 "selective rebuild"를 포함할 것,
`support`가 "complete compile"을 포함할 것)는 **수정하지 않았고 그대로 통과한다.**

---

## C — 올바른 자리에 있는 필수 공개 (유지)

각각 고객이 그 한계를 실제로 만나는 자리에 있다. 하나도 건드리지 않았다.

| # | 위치 | 문장(발췌) | 왜 여기인가 |
|---|---|---|---|
| C1 | `app/sources/page.tsx:138-143` | "**A tier is earned by a measurement.** A format moves up when a native reader for it exists and a qualification run produces a receipt with the date it was produced." | 지원 등급 표 자체가 독자가 찾아온 이유다. |
| C2 | `app/sources/page.tsx:153-159` | "**Legacy binary HWP** … has no reader here, and an unlisted format cannot be held for review: the upload route refuses it before any file is stored." | 한국어 독자가 정확히 이 답을 찾으러 온다. |
| C3 | `app/sources/page.tsx:165-174` | "**A format is not a connector.** … Supported, for a connected system, means the whole lifecycle: create, update, rename, move, delete, permission change, tombstone behaviour…" | 형식 등급을 커넥터 보증으로 오독하는 것을 막는 유일한 문단. |
| C4 | `app/integrations/page.tsx:95` | "The agent runs on your host under your scheduler, so your scheduler is where a failed run surfaces … It has no inbound port, no health endpoint and no callback to us." | 에이전트 운영 fold — 독자가 세부를 선택해서 연 자리. |
| C5 | `app/integrations/page.tsx:84` | "We do not monitor it: an agent that stopped looks to us like a source with no changes." | 같은 fold. 책임 경계는 구매 입력값이다. |
| C6 | `app/knowledge-compiler/page.tsx:121-125` | "When it is not the right tool … **BEYOND THE SOURCES**: Retrieval here is a matching test, not a judgement about whether what matched answers you." | 카테고리 가이드가 카테고리의 끝을 말하는 섹션. |
| C7 | `app/trust/page.tsx:17-18`, `:140` | "Draft v1 (2026-09-11) — under review; not a signed agreement" | 법적 라벨은 문서와 함께 이동해야 한다. `trust-page-answers.test.ts`가 분리를 막는다. |
| C8 | `app/trust/page.tsx:68-73` | "Deployment-specific architecture, control evidence, assurance scope, and questionnaire responses are provided through a qualified review." | 조달 독자가 이 페이지에 온 이유. |
| C9 | `app/enterprise/page.tsx:109`, `:114-117` | "Processing your own documents is arranged with us and is not enabled by purchasing a plan." / DPA 초안 라벨 | 파일럿을 논의하러 온 독자의 결정 입력값. |
| C10 | `app/solutions/page.tsx:94-95` | "A described use is not a completed customer case, and none of these five pages is written as one." | BA-040이 이미 lede에서 마지막 줄로 옮겨 둔 상태. 이번 감사도 같은 판단. |
| C11 | `lib/explore-story.ts` `entityDisclaimer` | "In the recorded evaluation, 3 of 16 baseline labels were true positives." | 수치가 영수증(`entity-extraction-eval.json`)에 결박되어 있고, 그 칩 바로 옆이다. |
| C12 | `lib/explore-story.ts` `changeTimelineNote` | "every object in the World is rebuilt at every step, so the recompiled figure is the whole World rather than a selectively rebuilt subset" | 다섯 단계 타임라인이 증분 컴파일처럼 보이는 그 화면에 있어야 한다. |
| C13 | `lib/activation-policy.ts:57-59` `customerIntake` / `cdr` / `ocrGpu` / `candidatePromotion` | "Activation is always an explicit human decision." 외 | 이미 역량 진술이다. `enabled` 플래그와 함께 손대지 않았다. |

`/pricing`의 두 게이트(`PURCHASE_GATES`), 환불 한계선, 처리 상한, `lib/docs-content.ts`의
레이트 리밋 주석, `lib/workspace-failure-copy.ts`의 거절 문장도 같은 이유로 모두 유지다.

---

## D — 영수증이 없는 주장 (제거 / 사실에 결박)

### D1 · `/pricing` 플랜 카드 라벨

`nextjs/components/pricing-page-client.tsx:823`

```
<p className="fine"><b>Coming, not yet sold</b></p>
```

"Coming"은 **납품 약속**이다. 이 저장소에 그 약속을 뒷받침하는 로드맵도 날짜도 없고,
`/integrations`는 같은 종류의 약속을 하지 않기 위해 공들여 쓰여 있다. 카드가 하려는 일 —
Team 플랜의 차별점 중 아직 팔지 않는 것을 이름으로 밝히기 — 은 약속 없이도 된다.

**재작성** `<b>Not sold with this plan</b>`

`notYetSold` 식별자와 그 항목(`Shared members and roles`,
`Per-member source permissions`)은 그대로다. 공개는 유지되고 약속만 사라진다.

### D2 · 배포 게이트 문장 — 사이트에서 가장 많이 렌더되는 문장

`nextjs/lib/activation-policy.ts:85` (EN) / `nextjs/lib/site-navigation.ts:217` (KO)

```
"Customer-data compilation remains closed until every security precondition has current
 production evidence and an exact-workspace approval receipt."
"이 배포판에서는 아직 고객의 파일을 컴파일하지 않습니다. 완성된 공개 Compiled World는
 오늘 전체를 읽을 수 있고, 직접 가진 원문의 반입은 저희와 협의해 진행합니다."
```

이 한 문장은 `/pricing`, `/security`, `/status`, `/login`, `/workspace`, `/integrations`의
공지, 그리고 랜딩의 마지막 장면 마이크로텍스트에 렌더된다. `/api/status`도 그대로 서빙한다.

두 가지가 문제다.

1. **독자가 열 수 없는 영수증을 인용한다.** "current production evidence"와 "an
   exact-workspace approval receipt"는 우리 릴리스 절차의 어휘이고, 그 기록은 이 사이트가
   서빙하지 않는다. `activation-policy.test.ts`의 RESOLVED A-6 규칙이 금지하려던 바로 그
   모양이다 — 근거를 링크하거나, 언급을 빼거나. (기존 정규식이 이 표현을 잡지 못했을 뿐이다.)
2. **BA-118이 고친 것이 되돌아왔다.** 그 결정은 "the founder", "the security suite", "an
   approval receipt"를 빼고 독자의 용어로 쓰라는 것이었는데, 이 브랜치의 문장은 같은 내부
   어휘를 다시 들고 있다. 그리고 한국어 번역은 옛 문장에 남아 있어 두 언어가 이미
   **서로 다른 사실을 말하고 있었다.**

**재작성** — 같은 두 사실, 독자 순서로. 게이트는 그대로 닫혀 있다.

```
"A finished Compiled World is open to read in full today, with its evidence attached.
 Compiling your own sources is set up with us rather than enabled by a plan purchase."
"완성된 Compiled World는 오늘 근거까지 전부 읽을 수 있습니다. 직접 가진 원문의 컴파일은
 요금제 구매가 아니라 저희와 함께 설정합니다."
```

무엇이 바뀌지 않았는지가 중요하다.

- `enabled: false` — 손대지 않았다. 이 플래그로 방어하는 모든 라우트가 그대로 거절한다.
- 역량 그리드(`lib/capabilities.ts`)는 여전히 상태 칸에 **`Closed`**를 찍고, 이 문장은 그
  옆의 주석이다. 즉 한계는 고객이 만나는 자리에서 그대로 공개된다.
- `/pricing`의 `PURCHASE_GATES`는 이 문자열을 그대로 읽는다. lead가 "What you can compile
  today"이므로 새 문장이 그 질문에 직접 답한다.
- `/integrations`의 공지는 굵은 글씨로 "Connecting your own sources is arranged with us."를
  먼저 말하고 이 문장을 잇는다 — connect와 compile이 각각 자기 문장을 갖게 됐다.
- 두 언어가 이제 같은 사실을 같은 순서로 말한다. 영어에 숫자가 없어
  `landing-v2-start.test.ts`의 무숫자 규칙도 그대로 통과한다.

---

## 코드에 반영한 것

| 파일 | 항목 |
|---|---|
| `nextjs/lib/activation-policy.ts` | D2 (EN) |
| `nextjs/lib/site-navigation.ts` | D2 (KO, `KO_CHROME.customerDataGate`) |
| `nextjs/lib/landing-v2-copy.ts` | A1 · A2 · A3 · B1 (각각 EN/KO) |
| `nextjs/components/workspace-getting-started.tsx` | A4 |
| `nextjs/components/pricing-page-client.tsx` | D1 |
| `nextjs/app/integrations/page.tsx` | A5 |

각 모듈에 변경 이유를 `COPY-TRUST, 2026-09-22` 주석으로 남겼다. 이 저장소의 관례대로,
무엇이 사라졌고 왜 사라졌는지는 그 문장 옆에 있다.

## 바꾼 테스트 — 그리고 그 이유

**고의로 바꾼 문장을 고정하고 있던 테스트만** 고쳤다.

1. `nextjs/lib/customer-data-live-path.test.ts`
   — `expect(reason).toMatch(/remains closed/i)` 와 `/production evidence/i`.
   이 두 정규식이 D2의 내부 어휘를 **고정하고 있던 장치**였다. `enabled === false` 단언은
   그대로 두고(게이트는 이 테스트가 지키는 것이다), 문자열 규칙을 "협의 경로를 이름으로
   말할 것"과 "요금제 구매가 컴파일을 연다고 말하지 말 것"으로 교체했다. 즉 같은 보호를
   내부 어휘가 아니라 **독자에게 위험한 방향**에 대고 건다.

2. `nextjs/lib/page-seo.test.ts`
   — `LANDING_V2_COPY.ko.start.microtext`가 `"이 배포판에서는 아직 고객의 파일을
   컴파일하지 않습니다"`를 포함할 것. 바로 그 문장이 D2(KO)에서 바꾼 문장이다. 케이스의
   취지(게이트가 한국어 페이지에, 한국어로, 한 번만 있을 것)는 유지하고 고정 조각만
   새 문장으로 옮겼다. 나머지 두 단언(`microtext: activationPolicy.customerData.reason`,
   `microtext: KO_CHROME.customerDataGate`)은 동일성 검사라 그대로다.

**바꾸지 않은 것 중 확인이 필요했던 것**

- `nextjs/lib/landing-v2-copy.test.ts:201-207` (규칙 7, selective rebuild) — B1의 재작성이
  `"selective rebuild"`와 `"complete compile"`을 모두 유지하므로 **수정 없이 통과**한다.
- `nextjs/lib/public-copy-purge.test.ts`, `lib/brand-copy.test.ts`,
  `lib/landing-v2-start.test.ts`, `lib/landing-v2-use.test.ts`,
  `lib/landing-v2-trust.test.ts`, `lib/trust-page-answers.test.ts`,
  `lib/capabilities.test.ts` — 모두 무수정 통과.

## 추가한 테스트

`nextjs/lib/copy-trust-guard.test.ts`.

`public-copy-purge.test.ts`가 막는 것은 **방어적 주장** 레지스터("not customer proof",
"no certification")다. 이 가드는 그 옆의 **헤지** 레지스터를 막는다 — 주장을 방어하는 문장이
아니라 자기 동사를 약하게 만드는 문장. 두 스윕은 서로를 포함하지 않는다: 방어적 주장이
하나도 없으면서 히어로에서 "does not yet …"이라고 말하는 페이지가 가능하고, 이번 감사가
찾은 것이 정확히 그것이다.

- 금지 구절 22개: `we cannot`, `we can't`, `we are unable`, `not yet`, `does not yet`,
  `no guarantee`, `cannot promise`, `may fail`, `might fail`, `unproven`,
  `implemented_not_proven`, `best effort`, `best-effort`, `remains qualified`,
  `still required`, `coming soon`, `at this time`, `for the time being`, `we hope to`,
  `we plan to`, `on our roadmap`, `published roadmap`.
- 대상: 첫인상 카피 모듈 10개 + 브리프가 지정한 마케팅 라우트 10개.
- 허용 목록: 한계가 곧 답인 표면 22개(`/sources`, `/trust`, `/security`, `/status`,
  `/benchmarks`, `/reproducibility`, `/research*`, `/product/continuous-knowledge`,
  `/product/document-understanding`, `/contact`, 법적 페이지 4개, `lib/docs-content.ts`,
  `lib/api-error-codes.ts`, `lib/compiler-contract.ts`, `lib/workspace-failure-copy.ts`,
  `lib/evidence-record.ts`, `lib/changelog.ts`, `lib/operations.ts`). **각 항목은 어떤
  한계를 싣는지 문장으로 적어야 하고, 두 목록에 동시에 오를 수 없다** — 헤지하는 히어로를
  허용 목록에 추가해서 "고치는" 길을 막는 조항이다.
- 그리고 허용 목록과 무관하게 절대 공개되지 않아야 하는 것 하나: 저장소 내부 상태 어휘
  `IMPLEMENTED_NOT_PROVEN`. 그것은 `docs/audit/V4_MIGRATION_MATRIX.md`의 단어이지
  구매자가 읽는 페이지의 단어가 아니다.

단어가 아니라 구절만 막는다. `not`, `fail`, `cannot`, `review`는 평범한 영어이고, 그것을
금지하는 규칙은 아무도 쓸 수 없는 카피를 만든다 — purge 테스트가 같은 이유로 같은 선을
긋는다.

## 검증

- `vitest run` 전체 — 4,969 케이스 중 4,968 통과. 유일한 실패는
  `lib/journey-acceptance.test.ts`의 해시뱅 개행 검사로, `scripts/*.mjs` 세 개가 이 Windows
  워크트리에서 CRLF로 체크아웃된 결과다. 이 레인이 만지지 않은 파일이며 카피와 무관하다.
- `lib/copy-trust-guard.test.ts` 단독 — 23/23 통과.
- 카피 고정 테스트 11개 파일 단독 — 전부 통과.
- `tsc --noEmit` — 이 레인의 변경으로 인한 오류 0. 남는 두 건은
  `@vercel/functions/oidc` 모듈 미설치로, 소스 트리에서도 동일한 기존 오류다.
- `eslint` — 이 체크아웃에서 실행 불가(`eslint-plugin-react-hooks`가 설치되어 있지 않아
  소스 트리 `tavonel-saas-foundation/nextjs`에서도 같은 오류가 난다). CI에서 실행된다.

## 남은 것 (이 레인이 하지 않은 판단)

- `/product/document-understanding:78`의 "while the grid that arranged them is not yet
  recovered" — 역량을 만나는 자리의 공개(C)로 두었지만, 같은 사실을 "the grid that arranged
  them stays in the source"로 쓸 수 있다. 역량 매니페스트에서 파생되는 문장이므로 그 레인의
  판단이 필요하다.
- `/status`의 `NOT_RUN = "Not yet reported"` — 프로브 표의 상태 라벨이고 허용 표면이지만,
  "Not probed"가 더 정확하다. 상태 페이지 소유 레인의 판단.

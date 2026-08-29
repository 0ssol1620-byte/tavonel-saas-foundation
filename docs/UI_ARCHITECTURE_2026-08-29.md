# TAVONEL UI Architecture — 정본 기록

**기준일:** 2026-08-29 KST
**범위:** `nextjs/` 공개 표면(랜딩·로그인·워크스페이스) 전체
**상태:** 이 문서가 UI의 **정본(canonical)** 이다.

---

## 0. 이 문서가 대체하는 것

`TAVONEL_CINEMATIC_COMPILATION_REPLAY_MASTER_SPEC_v2.0_FINAL_KO_2026-08-23` §1.4는 Home을
**56초 Compilation Replay**로 정의했다. 그 정의는 **더 이상 유효하지 않다.**

- 구현: `components/replay-stage.tsx`, `lib/cinematic/*` — **삭제됨** (commit `e3c69dd`)
- 복구 지점: `a4b3c2f`
- 대체: 이 문서 §2의 8-scene 스크롤

**§1.4를 근거로 replay를 되살리지 마라.** 되살리려면 이 문서를 먼저 고쳐야 한다.

master spec의 나머지 조항 중 **살아남은 것과 죽은 것**을 명시한다. 조용히 남겨두면
다음 사람이 어느 쪽을 따를지 알 수 없다.

| Master spec 조항 | 상태 | 비고 |
|---|---|---|
| §1.4 Home = 56초 replay | **폐기** | 8-scene 스크롤로 대체 |
| §6.11 Wanted Sans = display/text face | **유지** | `public/fonts`에서 self-host, OFL |
| §6.12 paper 84% / instrument dark 8% 화면 예산 | **폐기** | 전면 dark instrument로 전환 |
| §6.12 금지: glassmorphism · full-screen gradient · glow · 장식 shadow | **유지** | 깊이는 luminance와 hairline만 |
| §7.1 motion law | **유지** | "reality·understanding·control이 바뀔 때만 움직인다" |
| §7.2 네 개의 duration / §7.4 easing | **부분 유지** | 토큰 이름은 바뀌었고 규칙은 같다 |
| §13.3 금지 문구 목록 | **유지, 그리고 강제됨** | `lib/brand-copy.test.ts` |
| §3.2 world 형성 전 고유명사 금지 | **소멸** | 그 규칙이 적용되던 replay가 없다 |

---

## 1. 원칙

1. **색은 상태 전용이다.** 중립색이 전부를 짊어진다. 페이지의 모든 색상은 knowledge world에
   대해 구체적인 무언가를 뜻한다 — verified · changed · needs-review · reused. 장식으로 색을
   쓰지 않는다. 회색 벌판의 amber 점이 *정보*로 읽히는 이유가 이것이다.
2. **깊이는 luminance와 hairline뿐이다.** 1px 규칙선 하나와 ground 값의 단차로 표면을 나눈다.
   패널은 카드가 아니라 계기판처럼 보여야 한다.
3. **모션은 상태를 보고한다.** 루프도 없고 hover용 움직임도 없다. 실제로 무언가 바뀐 자리에만
   전이가 있고, `prefers-reduced-motion`은 전이만 걷어내지 내용은 걷어내지 않는다.
4. **제품은 로그인해도 정체성이 바뀌지 않는다.** 랜딩·로그인·워크스페이스가 같은 ground,
   같은 hairline, 같은 상태 색, 같은 mono 목소리를 쓴다.

토큰은 `app/tavonel.css` 상단 한 곳에만 있다. 여기 옮겨 적지 않는다 — 두 곳에 적으면 어긋난다.

---

## 2. 랜딩 — 8 scene

하나의 지속되는 canvas world 위에 8개 scene이 얹힌다. Scene은 쌓인 섹션이 아니라 **한 world의
상태**이고, 하단 instrument bar가 그 상태를 계속 읽어준다.

```
Act I    01 The mess  ->  02 Compile  ->  03 The compiled world
---      interlude (scene 03을 이어받는다)
Act II   04 Something changes  ->  05 Rebuild & verify
Act III  06 The answer  ->  07 Evidence & boundary  ->  08 Access
```

| # | id | world mode | bar state | world | 성격 |
|---|---|---|---|---|---|
| 01 | `#s1` | `scatter` | SCATTERED | v0 | 픽션 |
| 02 | `#s2` | `structure` | COMPILING | v0 | 픽션 |
| 03 | `#s3` | `current` | COMPILED | v184 | 픽션 |
| — | interlude | — | (03을 이어받음) | | 픽션 |
| 04 | `#s4` | `change` | CHANGED | v184 | 픽션 |
| 05 | `#s5` | `recompile` | VERIFIED | v185 | 픽션 |
| 06 | `#s6` | `answer` | CURRENT | v185 | 픽션 |
| 07 | `#s7` | `current` | CURRENT | v185 | **실제** |
| 08 | `#s8` | `current` | CURRENT | v185 | **실제** |

### 2.1 왜 이 순서인가

이전 버전은 문서 개정으로 시작해 selective recompilation에 아홉 scene을 썼다. 그것은
**엔지니어링의 어려운 절반이자 가치의 작은 절반**이고, 그걸로 시작하면 첫 방문자에게서 돌아오는
반응은 하나다: *그래서?* 재컴파일은 재컴파일할 대상이 존재한 뒤에야 흥미로워진다.
Act I이 먼저 world를 벌고, Act II가 그것을 지킨다.

### 2.2 왜 12개가 아니라 8개인가

12 scene · 13.3 화면 · 1,901 단어였다. 실측으로 확인한 **중복 5쌍**이 있었다.

| 중복 | 해소 |
|---|---|
| connect + compile + work-that-stops가 모두 "준비작업이 사라진다"를 주장 | scene 02로 통합. 소스 원장 6행 → 칩 6개 |
| rebuild console과 publish record가 같은 숫자 9개를 두 번 인쇄 | publish record 삭제. 콘솔이 이미 전부 말한다 |
| console의 "26 of 26 passed"와 check grid | check grid만 남김 |
| scene 05의 evidence chain과 scene 09의 source line | chain에서 Status 행 제거 |
| boundary chain의 상태 pill과 capability grid의 open/closed | chain에서 pill 제거. chain은 *무엇을 하는가*, grid는 *지금 열려 있나* |

면책 문구는 4곳 → 2곳(hero, footer).

**결과: 8 scene · 10.3 화면 · 1,616 단어.** 잘려나간 것은 반복되는 주장뿐이고 새 정보는 없다.

### 2.3 픽션과 실제의 경계

**scene 01–06은 선언된 허구 fixture다.** hero와 footer 두 곳에서 화면상으로 말한다.

**scene 07–08은 아니다.**
- 07 source boundary와 evidence는 이 배포의 실제 자세를 기술한다. 작동하지 않은 결과
  (*Blind quality detection failed*)를 포함하는 것이 이 섹션의 신뢰성이다.
- 08 capability grid는 **`/api/status`를 로드 시점에 읽는다.** 주장하지 않는다.

### 2.4 fail-closed capability grid

`readCapabilities()`는 구조적으로 fail-closed다. 모든 행은 `unknown`에서 시작하고,
**성공한 응답만이** 행을 `open`으로 옮긴다. status endpoint에 닿지 못하거나 응답이 망가지면
grid는 "모른다"고 말하지 결코 "사용 가능"으로 기울지 않는다.

`Knowledge architecture`와 `Selective recompilation` 두 행은 `Concept`이 아니라 **`Direction`** 이다.
페이지가 그 둘을 깊이 시연하면서 **출시된 기능이라고는 주장하지 않는** 자리가 정확히 그 둘이고,
과장이 가장 매력적이고 가장 해로운 자리도 그 둘이기 때문이다.

**고객 도메인에 맞춰 ontology를 자동 설계하는 것이 완성된 production feature라고 어디서도
주장하지 않는다.** 마케팅 표면은 "TAVONEL이 지식이 어떻게 맞물리는지 알아낸다"고 말하고,
기술적 detail은 구조 그 자체로 보여준다.

---

## 3. 숫자는 표류할 수 없다

페이지가 인쇄하는 모든 숫자는 `lib/demo-world.ts`에서 파생된다. 배경 field는
`lib/world-graph.ts`가 seeded LCG(`seed 20260829`)로 만들어 모든 기기에서 동일하다.

두 모듈 모두 **copy가 의존하는 항등식을 테스트가 고정한다.**

```
3 + 39            = 42 rebuilt
42 + 128,427 + 1  = 128,470
area별 fact 합계   = 128,470
wavefront는 Engineering · Product · Customers에 결코 닿지 않는다
                    (node budget 양 끝 190 / 560 모두에서)
```

edge list를 고치면 숫자가 움직이고 테스트가 붉어진다. 사실 주장을 하는 시각물의 올바른
실패 방식이다.

---

## 4. 로그인 — `/login`

이전에는 sign-in 페이지가 없었다. 랜딩 nav가 Google 팝업을 열었고, 실패는 마케팅 페이지 위
토스트로 떴다. 돌아갈 길도 없고 *무엇에* 로그인하는지 설명도 없었다. 프라이빗 파일럿이 사람을
잃는 지점이 정확히 여기다.

두 가지 일을, 이 순서로 한다.

1. 무엇을 얻고 무엇이 잠겨 있는지 말한다 — **`/api/status`에서 실시간으로 읽어서**, 이 배포에
   없는 기능을 약속하지 않는다.
2. 컨트롤 하나로 들여보낸다.

**auth가 설정되지 않은 배포에서는 버튼이 클릭 시 실패하는 대신 비활성 상태로 이유를 말한다.**
비활성 버튼은 primary accent를 잃고 inert하게 보인다 — 죽은 컨트롤이 살아 있는 것처럼 보이면
안 된다.

---

## 5. 워크스페이스 — 실제 탭

사이드바는 loader를 호출하거나 토스트를 띄우는 버튼 네 개였다. **뷰가 전환되지 않았고**,
모든 패널이 한 페이지에 쌓여 있었으며, "Activity"는 아무것도 하지 않았다.

이제 진짜 탭이고, 선택은 URL(`?tab=`)에 반영되어 링크·새로고침·뒤로가기가 동작한다.

| 탭 | 내용 |
|---|---|
| `overview` | 라이브러리(불변 문서 메타데이터) · knowledge canvas(후보) |
| `knowledge` | **knowledge architecture** — `WorldExplorer` |
| `billing` | 구독·크레딧 잔액 · **크레딧 구매** · 고객 포털 |
| `integrity` | 네 개 게이트 |

### 5.1 WorldExplorer — 랜딩과 제품 사이의 가장 큰 간극

랜딩은 "AI가 추론할 수 있는 구조화된 world"에 scene 하나를 통째로 쓰는데, 로그인하면 그
구조가 **어디에도 없었다.**

`components/world-explorer.tsx`는 compiler가 실제로 반환한 collection artifact만 읽는다 —
그것이 만든 directory plan, 도출한 ontology node/edge, 검증한 counts. 예시는 하나도 없다.

그 제약이 빈 상태의 이유다. **컴파일된 collection이 없으면 보여줄 architecture가 없고,**
공간을 채우려고 지어내면 워크스페이스가 테넌트에게 없는 구조를 주장하게 된다. 대신 빈 상태는
다음 행동(첫 문서 업로드)을 제공한다.

목록이 40개에서 잘리면 **몇 개가 생략됐는지 말한다.** 말없이 끊긴 목록은 "짧은 완전한 목록"으로
읽힌다.

### 5.2 결제

`lib/use-checkout.ts` 하나가 랜딩과 워크스페이스 양쪽을 담당한다. 돈이 움직이는 경로이므로
**복사본을 두지 않는다** — 두 벌은 반드시 어긋난다.

훅이 보존하는 보장들(이 함수의 존재 이유이지 부수적 성질이 아니다):

- 서버에 무언가 요청하기 전에 세션 토큰이 필요하다.
- **가격 allow-list는 서버가 소유한다.** 클라이언트는 offer code를 보내지 가격을 보내지 않는다.
- 응답에 client token · environment · price id · custom data가 모두 있어야 열린다.
  부분 응답은 우회 대상이 아니라 실패다.
- **checkout 완료는 아무것도 바꾸지 않는다.** 서명되고 멱등하게 저장된 webhook만이 entitlement를
  움직이며, 성공 메시지도 접근 권한이 살아났다고 암시하지 않고 그렇게 말한다.

이전에는 워크스페이스에 구매 경로가 없어서, 크레딧이 떨어진 로그인 사용자가 마케팅 페이지로
되돌아 나가야 했다. 이제 `billing` 탭에서 끝난다.

### 5.3 고쳐진 결함

- **게이트 목록의 상태 글리프가 정확히 반대였다** — 열린 게이트에 빈 원(`○`), 닫힌 게이트에
  채운 원(`●`). 이제 공개 capability grid와 같은 OPEN/CLOSED pill을 쓴다.
- policy key가 그대로 UI에 새어나와 "customer Intake", "ocr Gpu"로 보였다. → `GATE_LABELS`.
- 로그인한 표면에 **sign out이 없었다.**

---

## 6. 자산

새 webfont host를 부르지 않는다.

| 자산 | 형태 | 라이선스 |
|---|---|---|
| Wanted Sans Variable | `public/fonts`에서 self-host, subset [90]/[89] | SIL OFL 1.1 |
| IBM Plex Mono | `next/font/google` | SIL OFL 1.1 |
| World field · lattice · logomark | Canvas 2D / inline SVG | 원본 |
| 아이콘 | lucide-react (워크스페이스에 한함) | ISC |

**사진은 없다.** 이전 판은 interlude에 스톡 사진 한 장을 썼는데, `UNSPLASH · FREE LICENSE`
크레딧이 **모든 주장이 실제 증거로 되돌아간다**고 논증하는 페이지 안에서 신뢰를 깎았다.
빌려온 것으로 읽힌다. 1,240셀 lattice가 같은 구도를 그리되 **밝은 셀이 실제 데이터**이고,
1/17 크기이며, 제품의 것이다.

일반 규칙: **provenance를 논하는 페이지에서는 모든 자산이 보여줄 수 있는 provenance를 가져야
한다.** 여기서 procedural이 licensed를 이기는 근거는 비용도 바이트도 아니고 논증이다.

---

## 6.5. 감사 이후 (2026-08-29 2차)

전면 검수에서 15개를 찾아 모두 반영했다. 아래는 그 결과 **규칙이 된 것**만 적는다.

### 6.5.1 fail-closed는 랜딩만의 규칙이 아니다

`readCapabilities`가 `lib/capabilities.ts`로 나왔고, `lib/capabilities.test.ts`가 그 동작을
**강제한다** — 읽기 실패 · 빈 응답 · 형태가 깨진 응답 · *직전에 성공한 응답이 손에 있는데
읽기가 실패한 경우* 어디에서도 `open`이 나오지 않아야 한다. mutation test로 붉어지는 것을 확인했다.

**같은 규칙이 워크스페이스에도 적용된다.** 이전에는 로그아웃 상태에서 크레딧 잔액이 `0`으로
**단정**됐다 — 랜딩이 피하려고 만든 바로 그 오보를, 남의 돈에 대해 하고 있었다. 이제 값이 없으면
`not read yet`이고, 그것이 0이 아니라는 문장을 함께 낸다.

**금지: `?? 0` 같은 기본값으로 없는 값을 채우기.** 숫자를 못 쓰면 못 쓴다고 쓴다.

### 6.5.2 세션이 확인되기 전에는 워크스페이스를 그리지 않는다

`/workspace`에 인증 게이트가 없어 로그아웃 사용자가 전체 셸과 "Sign out"까지 봤다. 보안 구멍은
아니었지만(모든 API가 서버에서 토큰을 검증한다) 사람이 막히는 자리였다. 이제 세션이 없으면
`/login`으로 보낸다.

### 6.5.3 결제 경로는 테스트가 지킨다

`lib/use-checkout.test.ts`가 네 보장을 전부 확인한다 — 세션 선행 · offer code만 전송(가격 없음) ·
부분 응답이면 열지 않음 · 성공 문구가 접근 권한 활성화를 암시하지 않음. 역시 mutation test를 거쳤다.

### 6.5.4 두 개의 흐린 색은 라벨을 맡지 않는다

`--text-lo`(3.89:1)와 `--text-xlo`(2.54:1)가 WCAG AA 미달인 채로 80개 규칙에서 쓰였고, 그중에
증거 사슬의 필드명 · capability grid의 상태 단어 · 로그인 페이지 설명 전체가 있었다.
**5.20:1 / 4.87:1로 올렸고**, 진짜 장식용은 `--decor`로 분리했다(취소선, 트리 글리프, 비활성 컨트롤).

**금지: 라벨에 `--decor` 쓰기.** 값을 설명하는 텍스트는 텍스트 스케일에서 가져온다.

### 6.5.5 씬 이름은 하나다

instrument bar 라벨과 화면 eyebrow가 세 씬에서 달랐다. 규칙: **eyebrow가 씬 이름, bar가 상태
판독이고, 이름은 한 문자열이다.** `brand-copy.test.ts`가 대조한다.

### 6.5.6 린터가 있다

`npm run check`가 `tsc --noEmit && eslint app components lib`다. 첫 실행에서
**탭 리팩터링 때 사라진 기능 하나**를 찾았다 — `verifyLatestCandidates`가 버튼을 잃고 고아가 돼
있었다. `knowledge` 탭에 복구했다. **린터 없이 리팩터링하면 이런 것이 조용히 나간다.**

### 6.5.7 시스템 밖으로 떨어지던 표면들

| 파일 | 없을 때 나오던 것 |
|---|---|
| `app/not-found.tsx` | Next 기본 404 — 워드마크도 돌아갈 링크도 없음 |
| `app/error.tsx` · `app/global-error.tsx` | "Application error: a client-side exception has occurred" |
| `app/icon.svg` | 브라우저 탭의 기본 지구본 |
| `app/opengraph-image.tsx` | 링크 공유 시 이미지 없는 텍스트 카드 |
| `app/robots.ts` | 색인 정책 없음 = 크롤링 허용 |
| `app/*/layout.tsx` | 세 페이지가 같은 탭 제목 |

`error.tsx`의 문구는 "무엇이 실패했나"가 아니라 **"내 데이터는 어떻게 됐나"**에 답한다. 이 제품에서
그 답은 실제로 안심시킬 수 있는 내용이다 — 문서는 불변이고, 크레딧은 서명된 webhook으로만 움직이고,
승격은 사람이 한다. 렌더 실패가 그 셋 중 어느 것에도 닿을 수 없다.

`robots.ts`는 **닫는 쪽이 되돌릴 수 있는 방향**이라서 닫았다. 여는 건 한 줄이지만, 이미 크롤링된
페이지를 색인에서 빼는 건 아니다.

### 6.5.8 남겨둔 것 하나

**한국어화(i18n)는 하지 않았다.** 결함이 아니라 제품 전략이고, 카피가 `brand-copy.test.ts`와
fixture에 걸려 있어 구조 작업이 선행돼야 한다. 초기 파일럿 사용자가 한국어권이면 지금이 가장 싼
시점이다 — 결정이 필요하다.

---

## 7. 검증

```bash
cd nextjs
npm run check           # tsc --noEmit && eslint app components lib
npx vitest run          # 21 files / 110 tests
npm run build
```

`lib/brand-copy.test.ts`는 §13.3 금지 문구를 **실제로 강제한다.** 이 규칙은 원래
`lib/cinematic/copy.ts` 헤더의 주석이었고 "여기 있는 무엇도 그쪽으로 표류해선 안 된다"고
적혀 있었지만 **아무것도 확인하지 않았다.** replay를 지우면 살아 있는 브랜드 규칙이 죽은
코드와 함께 사라졌을 것이다.

이 가드는 삭제 전에 **mutation test를 거쳤다** — `app/page.tsx`에 금지 문구를 주입하면
해당 문구를 지목하며 붉어진다. **붉어질 수 없는 규칙은 규칙이 아니다.**

시각 검증은 headless Chrome(CDP)에서 1440×900과 390×844로 수행한다. 브라우저 창 preset은
스크린샷만 축소할 뿐 CSS viewport를 바꾸지 않으므로 믿지 않는다.

---

## 8. 하지 말 것

- master spec §1.4를 근거로 replay를 되살리기 — 이 문서를 먼저 고쳐라
- capability grid 기본값을 "available"로 두기
- `Direction` 두 행을 `Concept`이나 출시 주장으로 승격
- 고객 최적화 ontology 자동 설계를 완성된 기능으로 서술
- `demo-world.ts` 밖에서 숫자를 직접 쓰기
- checkout 흐름을 복사하기
- 목록을 말없이 잘라내기
- 스톡 이미지·고객 로고·인증·벤치마크 추가
- 브라우저에서 페이지를 열어보지 않고 배포
- `?? 0` 등으로 없는 값을 그럴듯한 숫자로 채우기
- 값을 설명하는 라벨에 `--decor` 사용
- 세션 확인 전에 워크스페이스 셸 그리기
- 린터 없이 리팩터링

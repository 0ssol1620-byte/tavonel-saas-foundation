# ADR-0006 — 게이트를 건드리지 않은 배포는 출시 결정을 이어받는다 (D-05)

- **상태:** 제안(PR "fix(gate): a deploy that does not touch the customer-data gate keeps its release (D-05)").
  병합, migration 적용, 운영 기록은 이 문서가 하지 않는다.
- **날짜:** 2026-10-27. `origin/main` `4252beadfe78eadf45567e1b40a9f80a0d4a1319` 위에서 썼다.
- **결함:** 여정 결함 D-05(`JOURNEY-MAP-2026-10-17.md` 202행), 결정 등록부 D-15의 "NEW: SHA-BINDING ADR".
- **결정 소유자:** 창업자. 이 ADR은 출시 행을 기록하지 않는다. 창업자 승인 영수증
  (`founder_approval_receipt_recorded`)은 지금처럼 창업자가 직접 기록하고, 평가 시점부터 30일 뒤 만료된다.

## 문제

gate v2에서 출시 결정(`customer_data_release_decisions`)과 작업공간 grant는 모두
`VERCEL_GIT_COMMIT_SHA`에 묶여 있다(`nextjs/lib/customer-data-admission.ts:28`).
`main`에 병합하면 production이 자동 배포되고 SHA가 바뀐다. 새 SHA에는 출시 행이 없으므로 모든
작업공간이 `SCOPED_RELEASE_NOT_FOUND`로 닫힌다. 누군가 새 행을 기록해야 다시 열린다.

2026-10-27에 실제로 일어났다. PR #174(`4252bead`)가 배포된 뒤 창업자 본인의 브라우저에서
`POST /api/access/bootstrap`이 `{"code":"ACCESS_READY_SOURCE_PENDING","sourcePending":"release_pending",…}`를
돌려주었고, 업로드가 막혔다. PR #174는 홈 화면, 벤치마크 페이지, 그림 파일만 바꿨고 게이트 코드는
한 줄도 바꾸지 않았다.

## 결정

**출시 결정을 "게이트 표면(gate surface)"의 digest에도 묶는다.** 읽을 때 상속하고, 기계가 행을 쓰지 않는다.

1. **게이트 표면.** 커밋의 추적 파일 중 `nextjs/scripts/gate-surface-rules.json`의 `presentational`
   목록에 해당하는 경로를 뺀 나머지 전부다. 목록에 없는 경로는 기본적으로 표면이다.
   `alwaysSurface`(정책 문서, `route.*`, 표면 계산 코드)는 목록에 걸려도 표면이다. 규칙 파일과
   계산 코드(`nextjs/scripts/gate-surface.mjs`)도 표면이다. 그래서 목록을 넓히는 PR은 그 자체로
   digest를 바꾸고, 한 번은 새 출시 기록이 필요하다.
   presentational은 고객 데이터를 서버가 어떻게 다루는지도, 그 앞의 동의·업로드·원본·키·계정 화면도 바꿀 수
   없는 경로로 한정한다(R1 보안 리뷰 B1). 문서, 테스트와 e2e, 정적 미디어, `nextjs/components/landing-v2/`,
   `nextjs/app/(benchmarks|changelog)/`, 그리고 페이지 데이터 파일 몇 개다. 나머지 컴포넌트, 전역 CSS,
   `nextjs/content/`, `public/developer/`의 고객 실행 클라이언트, 서버 쪽 specimen reader는 표면이다.
   presentational 목록에 걸리는 배포 코드는 `fetch`, `sendBeacon`, `process.env`, `"use server"`,
   `server-only`, `supabase`, `node:` import를 쓸 수 없다. `release-gate-check.test.mjs`가 막는다.
2. **digest.** `git ls-tree -r <sha>`의 (mode, type, blob id, path) 중 표면에 속한 줄을 정렬해
   sha256을 낸다(`tavonel.gate_surface.v1`). 작업 트리 바이트가 아니라 blob id를 쓰므로, Windows
   CRLF 체크아웃과 Vercel 빌드가 같은 값을 낸다. 규칙은 **그 커밋 안의** 규칙 파일에서 읽는다. 따라서
   digest는 커밋 하나만으로 정해진다. 규칙 파일이 없는 커밋(이 PR 이전 전부)은 `null`이다.
3. **배포가 자기 digest를 안다.** `nextjs/next.config.mjs`가 빌드할 때 자기 커밋의 digest를 계산하고
   `env.TAVONEL_GATE_SURFACE_SHA256`로 inline한다. Vercel production 빌드(`VERCEL_ENV=production`)가
   아니거나, `VERCEL_GIT_COMMIT_SHA`가 없거나 `HEAD`와 다르거나, git이 없거나, 규칙 파일이 없으면 `""`이다.
   그래서 push만 한 브랜치의 preview 빌드는 production 출시를 이어받지 못한다(R1 보안 리뷰 B2). 그러면 상속은 없고 지금과 똑같이 정확한 SHA의 행만 읽는다.
   빌드 로그에 `customer-data gate surface: …` 한 줄을 남긴다.
4. **출시 행이 표면을 이름 붙인다.** 새 열 `gate_surface_sha256`(migration `20261027120000`)은
   production 행에만 둘 수 있다. 값이 있으면 receipt digest의 canonical 형식에 들어간다. 값이 없으면
   canonical 형식은 이전과 바이트 단위로 같다. 그래서 이미 기록된 receipt도 그대로 검증된다.
5. **결정은 여전히 "가장 최근 행"이다.** 모든 reader(`readVerifiedScopedCustomerDataGate`,
   `issueProcessingWorkspaceGrant`, `release-gate-check`)는 같은 질의(`releaseDecisionQuery`)를 보낸다.
   이 SHA를 이름 붙이거나 이 표면을 이름 붙인 행 중 가장 최근 것이 결정이다. 나중의 거절, 나중의
   정확한 SHA 결정은 상속보다 우선한다. `verifyStoredRelease`가 행을 다시 계산한다. 행의 SHA가
   배포 SHA와 같거나, 행의 표면이 배포 표면과 같고 production 행일 때만 덮는다.
6. **grant는 출시가 기록된 revision을 이름 붙인다.** 상속받은 배포에서 grant의 `release_revision`은
   창업자가 기록한 SHA다. 그래서 DB의 `issue_customer_data_workspace_grant`는 **바뀌지 않는다.** 그
   함수는 여전히 그 revision의 최신 행이 허용이고 30일 안이며 receipt가 같은지 잠금 아래에서 다시 확인한다.
7. **trigger가 계속 권한을 쥔다.** `guard_customer_data_release_stage`는 이름과 기존 두 거절을 그대로
   두고 다음을 더한다.
   - scope 전체 advisory lock을 (scope, revision) lock보다 먼저 잡는다. 표면 하나가 여러 revision을
     덮으므로, 결정 순서가 revision을 넘어 전순서가 되어야 한다.
   - 표면을 적지 않은 production 거절은 그 revision의 최신 표면을 물려받는다. revision을 거절하면 그
     revision이 출시한 표면도 거절된다.
   - 그래도 표면이 없는 production 거절은, 그 revision의 어떤 행보다 새롭고 허용되고 30일이 안 지난 표면
     출시가 scope에 있으면 거부한다(`refusal_requires_surface`, R1 보안 리뷰 B3). 그 revision은 표면 출시를
     읽고 있을 수 있다. 그 SHA만 닫으면 다음 같은 표면 배포나 출시한 SHA로의 rollback이 다시 열린다. 거절은
     `release-gate-check`가 보고한 그 SHA의 digest를 넣어 기록한다. 자기 행이 더 새로운 SHA는 이전처럼
     표면 없이 거절할 수 있다.
   - 허용되고 30일이 안 지난 표면 출시가 있으면 그 scope에서 qualification을 받지 않는다
     (`qualification_over_surface_release`). qualification은 자기 SHA의 최신 행이 되므로, 상속받은
     배포 위에서 다른 모든 작업공간을 닫는다. 20260930070000의 이유가 revision을 넘어 적용된 것이다.
   - 기록 전에 읽는 문장은 READ COMMITTED에서만 받는다. 기존 규칙과 같다.

## 검토한 선택지

| 선택지 | 판단 | 이유 |
|---|---|---|
| (a) 매니페스트 digest + main CI가 상속 행을 기록 | 일부 채택(digest), 기록자는 기각 | digest로 묶는 생각은 채택했다. 하지만 CI가 production DB에 쓰려면 GitHub에 production service-role 비밀이 새로 생긴다. 지금 CI에는 그런 비밀이 없다. 또 기계가 창업자 사실(`founder_approval_receipt_recorded`)을 새 행에 복사하게 된다. 배포와 CI 기록 사이에는 닫히는 창도 남는다. 읽을 때 상속하면 셋 다 없다. `release-manifest.mjs`의 site digest는 `nextjs/` 전체를 덮어서 홈 화면 수정에도 바뀐다. 그래서 별도 표면을 정의했다. |
| (b) CI가 11개 사실을 job 결과로 평가해 행을 기록 | 기각 | 11개 중 `encryption_at_rest_verified`, `dpa_and_privacy_notice_published`, `retention_controls_configured` 같은 사실은 CI job 결과로 관찰할 수 없다. job 결과를 그 증거로 적으면 증거를 지어내는 것이다. (a)와 같은 비밀 문제도 있다. |
| (c) revision 범위 출시 | 기각 | 범위 안의 커밋이 게이트를 바꿨는지 아무것도 확인하지 않는다. 게이트를 바꾼 커밋도 조용히 상속한다. |
| 아무것도 안 함(배포마다 기록) | 기각 | 오늘의 결함이다. 기록이 늦으면 모든 작업공간이 닫히고, sweeper가 48시간 안의 갱신 구독을 멈춘다. |

## 위협 모델

- **실수로 게이트를 바꾼 배포.** 표면 경로가 하나라도 바뀌면 digest가 바뀌고 아무것도 상속하지 않는다.
  닫힌 쪽으로 실패한다. 새 경로는 기본이 표면이다.
- **presentational 목록 넓히기.** 규칙 파일이 표면이므로 넓히는 PR 자체가 digest를 바꾼다. 리뷰에서
  보이고, 한 번은 창업자 기록이 필요하다.
- **digest 위조.** inline 값을 위조하려면 `next.config.mjs`(표면)를 바꾸거나 Vercel env를 바꿔야 한다.
  Vercel env에 접근할 수 있는 사람은 `SUPABASE_SERVICE_ROLE_KEY`도 읽을 수 있다. 그 사람은 출시 행을
  직접 넣을 수도 있다. 그러니 이 변경이 새 권한을 만들지 않는다. main에 악의로 병합할 수 있는 사람은
  게이트를 지울 수도 있다. digest는 실수를 막는 장치이지 내부자 방어가 아니다.
- **비밀.** CI에 새 비밀이 없다. digest는 커밋 트리의 해시이고 비밀이 아니다. 빌드 로그에 찍어도 된다.
- **qualification 그림자.** trigger가 막는다(위 7).
- **거절 우회.** 표면을 적지 않은 거절도 자기 revision의 표면을 물려받고, 상속 중일 수 있는 SHA의 표면 없는
  거절은 DB가 거부한다(위 7).
- **preview 빌드.** production 빌드만 digest를 주장하므로, 병합하지 않은 브랜치의 preview는 상속하지 않는다. 리더는 "가장 최근 행" 규칙 하나만 쓴다.
- **만료.** 상속은 원래 행의 `evaluated_at`을 쓴다. 30일 한도, grant 만료, `founder_approval_receipt_recorded`의
  30일 신선도 규칙이 전부 그대로다.

## 남는 한계

- **presentational 코드는 같은 origin에서 돈다.** `landing-v2/`와 benchmarks·changelog 페이지는 동의 route와
  같은 origin의 브라우저에서 실행된다. 금지 토큰 테스트는 실수를 막는 장치이지 import 그래프 증명이 아니다.
  표면 모듈을 import해서 새로 호출하는 변경은 잡지 못한다. 이 경로의 변경도 독립 리뷰를 거친다.

- **보수적인 목록.** 오늘의 규칙을 최근 `main` 병합 16개(`4252bead`까지)에 적용하면 3개(#173, #171, #158)가
  상속한다. R1 리뷰 전 목록으로는 #174를 더해 4개였다. 목록을 좁힌 뒤 #174는 상속하지 않는다. 전역 CSS
  `nextjs/app/wanted-sans-korean.css`, `nextjs/components/changelog-list.tsx`, 서버 쪽
  `nextjs/lib/specimen-sources.ts`를 바꿨기 때문이다.
  홈 페이지(`nextjs/app/page.tsx`, `nextjs/lib/landing-v2-*.ts`)는 표면이다. 그 파일들이 고객 데이터에
  닿지 않는다고 리뷰가 확인하면 목록을 넓힐 수 있다. 그 PR 뒤에 한 번 다시 기록해야 한다.
- **Vercel 빌드의 git.** 빌드 로그에 "Cloning github.com/…"이 찍히고 `vercel-ignore-build.mjs`가 같은
  체크아웃에서 `git diff`를 쓴다. 하지만 `next build` 단계에서 `git ls-tree`가 되는지는 이 PR이 배포되기
  전에는 확인하지 못했다. 안 되면 digest는 `""`이고 동작은 오늘과 같다(정확한 SHA만).
- **첫 상속은 다음 기록부터다.** 이 PR 이전 커밋에는 표면이 없다. 이 PR이 배포된 SHA에 대해 창업자가
  `gate_surface_sha256`을 넣어 한 번 기록해야, 그 다음 배포부터 상속이 시작된다.

## 롤백

- 코드: 이 PR을 revert하면 reader는 다시 정확한 SHA만 읽는다. 이전 코드는 `gate_surface_sha256`을
  select하지 않으므로, 표면이 들어간 receipt를 표면 없이 다시 계산해 `SCOPED_RELEASE_INVALID`로 닫힌다.
  revert한 뒤에는 표면 없이 다시 기록한다. 같은 이유로, **이 코드가 배포되기 전에는 표면을 넣은 행을
  기록하지 않는다.** 지금 배포된 `4252bead`용 기록은 표면 없이 한다.
- DB: 열과 trigger 변경은 추가형이다. 되돌릴 필요가 없다. 되돌린다면 `guard_customer_data_release_stage`를
  20260930070000 본문으로 다시 만들면 된다. 열은 남겨도 이전 코드는 읽지 않는다.
- 순서: migration을 먼저 적용하고 코드를 배포한다(`docs/runbooks/RELEASE_ORDER.md`). 코드가 먼저 가면
  `gate_surface_sha256` select가 실패해 `SCOPED_GATE_STORE_FAILED`로 닫힌다.

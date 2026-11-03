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
   presentational은 **실행되지 않는 내용**뿐이다(R5 보안 리뷰 B1). markdown(MDX loader는 설정되어 있지 않다),
   `docs/`와 `nextjs/public/`의 이미지·폰트·영상·자막·PDF·텍스트, 그리고 표면인 specimen reader가 검증한 뒤 읽는 JSON 데이터
   두 종류(`nextjs/lib/specimen-sources.json`, `nextjs/public/proof-collection/specimens/*.run.json`)다. 실행되거나 코드로 import될 수
   있는 확장자(`ts`, `tsx`, `mts`, `cts`, `js`, `jsx`, `mjs`, `cjs`, `mdx`, `css`, `svg`, `html`, 그리고 빌드 도구·설정 loader·스크립트가
   읽는 JSON과 YAML)는 디렉터리와 상관없이 표면이다. 그래서 `nextjs/components/landing-v2/`, `nextjs/app/(benchmarks|changelog)/`,
   그 페이지 데이터 lib(`changelog.ts`, `compiler-release.ts`, `gdp-pdf-page-data.ts`), e2e, 모든 테스트, `scripts/repair-scope.mjs`도
   R5부터 표면이다. `alwaysSurface`는 presentational 규칙에 걸려도 표면으로 남길 내용, 곧 정책 문서(`docs/policy/`,
   `nextjs/public/policy/`), `.well-known`, 고객이 따르는 설치·안전 계약(`nextjs/public/developer/`, R2 보안 리뷰 S4), 고객이
   내려받는 평가 기록지의 데이터 취급 안내(`nextjs/public/evaluation/`, R6 보안 리뷰 N3)다. `.well-known` 규칙은 지금은 중복이다
   (`security.txt`의 확장자는 public presentational 규칙에 없다). 나중에 public 규칙에 `txt`가 들어와도 보안 연락처가
   presentational이 되지 않도록 남긴다.
   **R4까지의 방식과 버린 것.** R4까지는 `landing-v2`와 benchmarks·changelog page를 presentational로 두고, 그 배포 코드가
   `fetch`, `process.`, `globalThis`, `eval(`, `Function(`, Node builtin, 허용 밖 패키지를 쓰지 못하게 하는 정규식 가드를 걸었다.
   R5 보안 리뷰는 import도 `process` 토큰도 없는 `global["pro" + "cess"].getBuiltinModule("node:fs")`가 가드를 통과하고, prebuild
   vitest 안에서 기록 파일을 다른 digest로 덮어쓰는 것을 재현했다. 실행되는 코드에 대한 denylist는 안전하게 만들 수 없다.
   그래서 가드를 넓히지 않고 **실행되는 파일을 presentational에서 없앴다.** 토큰 가드, import walk, prebuild 제외 목록
   (`PREBUILD_EXCLUDED_SUITES`)은 지켜야 할 대상이 없어져서 지웠다. 대신 `release-gate-check.test.mjs`가 (1) 예전에
   presentational 코드가 있던 모든 디렉터리에서 모든 코드 확장자가 표면인지, (2) 이 checkout HEAD 트리의 presentational 파일
   중 코드 확장자가 0개이고 JSON은 위 데이터 두 종류뿐인지, (3) 리뷰의 reflective payload를 예전 presentational page 9개 어디에
   넣어도 digest가 바뀌는지 확인한다. 이 테스트와 그 vitest wrapper(`lib/release-gate-check-script.test.ts`)는 코드이므로 표면이다.
   **digest는 production 빌드가 실행하는 첫 명령이다(R4).** R3까지는 `next.config.mjs`가 digest를 계산했다. 그 전에
   prebuild(`pnpm check`, hermetic vitest)가 빌드 머신에서 저장소 코드를 실행했다. 그 코드가 git이 보지 못하는 입력
   (`node_modules`, `.env*`)을 고치거나 fsmonitor·skip-worktree로 변경을 숨기면 digest는 출시 값과 같았다. R3·R4 리뷰는
   그 경로를 하나씩 찾았다(계산된 경로의 page import, presentational 이름의 symlink). 그래서 경우를 세지 않고 순서를 바꿨다.
   `package.json`의 `prebuild`는 `node scripts/gate-surface.mjs --deploy`로 시작한다. 그 앞에서 저장소 코드는
   Vercel `ignoreCommand`(`vercel-ignore-build.mjs`, 표면, Node builtin만 import)만 돈다. `pnpm install`에는 root와
   nextjs 모두 lifecycle script가 없다. deploy 단계는 git plumbing만 쓰고(`--no-replace-objects`, `-c core.fsmonitor=false`),
   결과(`null` 포함)를 작업 트리 밖(`os.tmpdir()`의 SHA별 파일)에 한 번만 쓴다. 같은 SHA로 다시 돌면 `wx`가 실패해 빌드가 멈춘다.
   `next.config.mjs`는 그 파일을 읽기만 하고 다시 계산하지 않는다. `release-gate-check.test.mjs`가 `package.json`과
   `vercel.json`을 읽어 이 순서, install hook이 없음, `buildCommand`·`installCommand` override가 없음, deploy 스크립트와
   ignoreCommand의 import가 builtin뿐임을 확인한다.
   **digest 뒤에 도는 코드.** deploy 단계 뒤의 `pnpm check`, hermetic vitest, `next build`는 기록된 digest를 바꿀 수 없다.
   그러나 같은 컨테이너 안에서 기록 파일이나 `next build`가 컴파일할 바이트(표면 파일, `node_modules`)는 바꿀 수 있다. 그래서 이
   단계는 표면 코드만 실행해야 한다. R5부터는 저장소의 모든 실행 파일이 표면이므로 이 조건은 규칙 자체에서 나온다. 제외할 suite도
   없다. presentational 파일을 코드로 읽는 길은 표면 코드가 그것을 module로 load하는 것뿐이고, 그 load 자체가 표면 변경이다.
   symlink(mode 120000)와 gitlink(160000) 항목은 이름과 상관없이 표면이다. presentational 이름의 링크가 다른 디렉터리를 가리킬
   수 있기 때문이다(R4 보안 리뷰 B2).
   **deploy 단계의 도구(R5 보안 리뷰 B2).** pnpm은 PATH 맨 앞에 `nextjs/node_modules/.bin`을 넣고, Vercel은 build cache의
   `node_modules`를 빌드 전에 복원한다. 그래서 deploy 단계는 `node`와 `git`을 저장소나 `node_modules`에서 가져오지 않는다.
   `process.execPath`가 저장소 루트나 `node_modules` 아래이면, 또는 PATH에서 처음 찾히는 `node`가 그런 디렉터리에 있으면
   빌드를 멈춘다. git은 PATH를 앞에서부터 걸으며 저장소 루트·`node_modules` 아래 항목과 상대 경로를 건너뛰고, 처음 찾은 절대
   경로로 부른다. 링크를 푼 경로로도 같은 판정을 한다. 찾지 못하면 빌드를 멈춘다. 이것은 심층 방어다. 경계는 아래 "남는 한계"의
   build cache 설정이다. cache가 복원한 `node_modules/.bin/node`가 node 자체를 바꿔치기하면 이 검사는 돌지 않으므로 막지
   못한다(R6 보안 리뷰 N1). 그래서 deploy 단계는 `VERCEL_FORCE_NO_BUILD_CACHE`가 `1`이 아니면 `none`을 기록한다.
2. **digest.** `git ls-tree -r -z <sha>`의 (mode, type, blob id, path) 중 표면에 속한 항목을 하나씩
   JSON 배열 `[mode,type,object,path]` 한 줄로 쓰고, 줄을 정렬해 sha256을 낸다
   (`tavonel.gate_surface_digest.v2`). 작업 트리 바이트가 아니라 blob id를 쓰므로, Windows
   CRLF 체크아웃과 Vercel 빌드가 같은 값을 낸다. 규칙은 **그 커밋 안의** 규칙 파일에서 읽는다. 따라서
   digest는 커밋 하나만으로 정해진다. 규칙 파일이 없는 커밋(이 PR 이전 전부)은 `null`이다.
   - **단사성.** `-z` 레코드는 NUL로 끝나고 Git 경로에는 NUL이 없다. mode, type, object에는 탭도 공백도
     없으므로 첫 탭이 경계다. `JSON.stringify`는 LF를 포함한 모든 제어 문자를 escape한다. 그래서 어느 줄에도
     날 LF가 없고, LF로 나누면 줄이 정확히 복원되며, 각 줄은 자기 항목 하나로만 parse된다. 정렬된 줄 목록과
     표면 항목의 multiset은 일대일이다. 경로가 UTF-8로 손실 없이 decode되지 않으면(fatal decoder) 그 트리는
     `null`이다. 손실 decode는 서로 다른 바이트 경로 둘을 같은 문자열로 만들 수 있기 때문이다.
   - v1(`d8b3ec3c`까지)은 `mode type object<TAB>path` 줄을 LF로 이었다. LF가 든 경로 하나가 이웃 줄
     여럿을 흉내 낼 수 있어서, 표면 파일을 지우거나 더해도 digest가 같았다(R2 보안 리뷰 S1). 회귀 테스트가
     합성 트리와 실제 Git 커밋 양쪽에서 이 충돌을 재현하고, v2가 두 트리를 구별하는지 확인한다.
3. **배포가 자기 digest를 안다.** production 빌드의 첫 명령 `gate-surface.mjs --deploy`가 자기 커밋의 digest를 계산해
   기록하고, `nextjs/next.config.mjs`가 그 기록을 읽어 `env.TAVONEL_GATE_SURFACE_SHA256`로 inline한다. 기록이 없거나
   SHA가 다르면 `""`이다. Vercel production 빌드(`VERCEL_ENV=production`)가
   아니거나, `VERCEL_GIT_COMMIT_SHA`가 없거나 `HEAD`와 다르거나, git이 없거나, 규칙 파일이 없으면 `""`이다.
   `git status --porcelain`이 비어 있지 않아도 `""`이다. digest는 HEAD의 blob id에서 나오므로, 수정된 추적
   파일이나 추적하지 않는 파일이 있는 작업 트리(로컬 `vercel build --prod` 뒤 `--prebuilt` 배포 등)는 자기가
   빌드한 바이트를 주장할 수 없다(R2 보안 리뷰 S6). `git ls-files -v`에 skip-worktree(`S`)나 assume-unchanged(소문자)
   항목이 있어도 `""`이다. 이 표시는 수정된 파일을 `git status`에서 숨기기 때문이다(R3 보안 리뷰 B1). stage한 변경은
   `git status`가 이미 보고한다(R4에서 중복이던 `diff-index` 호출을 지웠다).
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
   - 기록 전에 읽는 문장은 READ COMMITTED에서만 받는다. 기존 규칙과 같다. 다른 격리 수준의 qualification은
     `qualification_requires_read_committed`(이름 그대로), 표면 없는 production 거절은
     `refusal_requires_read_committed`로 거부한다.

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
- **정규화 충돌.** LF가 든 경로로 표면 파일을 몰래 지우거나 더하는 공격은 digest v2의 JSON 줄 인코딩이
  막는다(위 2). UTF-8이 아닌 경로가 있는 트리는 digest가 없다.
- **preview 빌드.** production 빌드만 digest를 주장하므로, 병합하지 않은 브랜치의 preview는 상속하지 않는다. 리더는 "가장 최근 행" 규칙 하나만 쓴다.
- **만료.** 상속은 원래 행의 `evaluated_at`을 쓴다. 30일 한도, grant 만료, `founder_approval_receipt_recorded`의
  30일 신선도 규칙이 전부 그대로다.

## 남는 한계

- **production build cache는 신뢰하지 않는 입력이다.** git은 `node_modules`, `.env*`, build cache를 볼 수 없다. R4까지 이 문서와
  PR 본문은 "digest는 저장소 코드가 돌기 전에 계산하므로 그 입력이 digest를 속일 수는 없다"고 썼다. **사실이 아니었다**(R5 보안
  리뷰 B2). Vercel은 clone 직후, ignoreCommand와 install보다 먼저 이전 배포의 build cache를 복원한다. 앞선 production 빌드가 digest
  뒤에 `node_modules/.bin/git`을 남기면, 다음 빌드의 deploy 단계가 그 `git`으로 digest를 계산할 수 있었다. 가짜 `git`은 출시한
  commit의 tree를 보고하면 되고, payload 커밋을 되돌린 뒤에도 cache에 남는다.
  R5는 두 가지로 줄였다. (1) 실행되는 presentational 코드가 없으므로 digest 뒤에 도는 코드는 모두 표면이다. cache에 쓸 수 있는
  것은 리뷰를 거친 표면 코드와 registry 의존성뿐이다. (2) deploy 단계가 저장소·`node_modules` 안의 `node`와 `git`을 쓰지 않는다
  (위 1번). 그래도 cache 안의 다른 파일(예: `node_modules` 안의 패키지 코드, `.next/cache`)은 `next build`가 읽는다. 그래서
  **이 출시 방식은 production 빌드가 build cache를 쓰지 않는다는 설정에 기댄다.** Vercel Production env
  `VERCEL_FORCE_NO_BUILD_CACHE=1`이다. 이것은 창업자/운영 설정이고, 이 PR은 설정하지 않았다. 설정되기 전에는 표면을 넣은 행을
  기록하지 않는다(runbook 순서 2번). 설정되어 있으면 빌드 로그에 "Restored build cache"가 찍히지 않는다.
  R6 보안 리뷰 N1이 재현한 대로, cache가 복원한 `node_modules/.bin/node`는 deploy 단계를 통째로 대신하고 기록을 위조한다. 그
  node 아래에서는 (2)의 검사가 돌지 않으므로 deploy 단계는 이것을 막을 수 없다. 막는 것은 이 설정뿐이다. 그래서 R6부터 deploy
  단계는 `VERCEL_FORCE_NO_BUILD_CACHE`가 `1`이 아니면 `none`을 기록하고 설정 이름을 적은 메시지를 찍는다. 위조를 막지는
  못하지만, 설정이 빠진 정직한 빌드가 조용히 상속을 주장하지는 않는다.
- **Vercel 설정의 build command.** 이 순서는 Vercel 기본 build command(`pnpm run build`, prebuild가 먼저 돈다)와 기본 install
  command를 전제한다. 2026-11-02 `vercel project inspect`로 본 설정은 둘 다 기본값이다. 대시보드 설정은 저장소 밖이라 테스트가
  보지 못한다(R5 보안 리뷰 N1). 바꾸면 D-05는 무효다. deploy 단계가 돌지 않으면 기록이 없으므로 digest는 `""`(닫힌 쪽)이지만,
  바뀐 install command는 deploy 단계보다 먼저 저장소 밖의 명령을 돌릴 수 있다. 그래서 runbook이 기록 전에 확인한다(순서 2번).
- **markdown은 내용으로만 읽힌다는 전제.** `.md`가 presentational인 것은 MDX나 markdown loader가 설정되어 있지 않고 어떤 표면
  코드도 `.md`를 module로 load하지 않기 때문이다. 그런 loader나 load를 더하는 변경은 표면(`next.config.mjs`, 표면 코드)이고, 그
  PR은 `.md`를 presentational에서 빼야 한다. 테스트는 규칙과 HEAD 트리를 고정할 뿐, 미래의 loader를 막지는 않는다.
- **runbook의 digest 대조는 기록 뒤에도 한다.** DB와 gate는 행에 적힌 digest를 믿는다. `release-gate-check`는
  상속을 보고하기 전에 그 행 `release_revision`의 digest를 로컬 Git으로 다시 계산한다. 다르거나 계산할 수
  없으면 `surface_mismatch`(released 아님)로 보고한다(R2 보안 리뷰 S5). 런타임 gate는 git이 없어 이 대조를
  하지 못한다. 그래서 잘못 붙여 넣은 digest는 운영자가 check를 돌릴 때 드러난다.

- **보수적인 목록.** R5 규칙을 최근 `main` 병합 16개(`4252bead`까지)에 적용하면 1개(#158, 문서만 바꿈)가 상속한다.
  R4 규칙으로는 3개(#173, #171, #158)였다. #173과 #171은 changelog 항목(`nextjs/lib/changelog.ts`)을 바꿨고, 그 파일은 이제
  코드라서 표면이다. 그러니 changelog 글 하나도 새 창업자 기록이 필요하다. 문구를 표면 밖으로 옮기려면 항목을 데이터 파일로
  빼고 그 파일을 presentational에 넣어야 한다. 그 경우 렌더되는 링크와 문자열의 검증이 표면 코드에 있어야 하고 diff도 작지 않아서
  이번에는 하지 않았다. 홈 랜딩 문구는 이미 표면인 `nextjs/lib/landing-v2-copy.ts`에 있다.
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

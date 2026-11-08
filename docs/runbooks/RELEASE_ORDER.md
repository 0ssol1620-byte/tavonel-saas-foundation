# Release order: migrations first, then deploy

**Scope.** Every release that carries a file under `supabase/migrations/`. Written on 2026-09-11
for the four migrations of that day's release, but the rule is not specific to them.

## The rule

1. **Apply the release's migrations to production Supabase.**
2. **Then** merge to `main` / let Vercel deploy the application.

Never the other way round, and never both at once on the assumption that one will win.

## Why the order is not a preference

A merge to `main` deploys the application automatically (Vercel). Nothing applies a production
migration automatically — there is **no production-migration job in CI**; `db-rehearsal.yml`
applies the files to a throwaway Postgres on a runner and is deliberately unable to reach the
live project. So the two halves of a release move on different clocks, and only one of them is
automatic. The order has to be held by a person.

The blast radius is not one feature. `20260911120200_compile_job_candidate_manifest_digest.sql`
adds a ninth parameter to `advance_foundation_compile_job`, and the worker calls that function on
every state change of every compile. A deploy that lands before the migration makes every advance
answer `PGRST202` — which stalls **the whole compile queue**, for every tenant, not one document.

## What holds each direction

Both directions are defended in code, and neither defence is a reason to skip the order.

- **Migration first, deploy later** (the correct order): the ninth parameter is declared
  `default null`, so the worker that is still sending eight arguments keeps working between the
  two steps. `supabase/tests/foundation_compile_candidate_digest.sql` asserts that the
  eight-argument call still resolves after the migration.
- **Deploy first, migration later** (the mistake): `lib/compile-job-worker.ts` retries once
  without the digest argument and logs at error level with the stable message
  `candidate_manifest_digest not recorded: migration 20260911120200 not applied`. The queue keeps
  moving and the gap is loud. `candidateAwaitingActivation` reads conservatively from the digest,
  so a compile that finishes inside that window records none — grep for that message after any
  release and apply the migration.

The fallback is a seatbelt, not permission to drive at the wall.

## The 2026-09-11 release, in order

| # | migration | what it changes |
|---|---|---|
| 1 | `20260911120000_compute_settlement_expired_terminal` | settlement refuses an expired reservation |
| 2 | `20260911120100_oauth_reauthorization_audit_action` | a new audit action value |
| 3 | `20260911120200_compile_job_candidate_manifest_digest` | the ninth parameter above — the one with the queue-wide blast radius |
| 4 | `20260911130000_included_page_expiry_at_renewal` | expires the previous month's remainder at the next grant |

Filename order is apply order. Migration 4 is a customer-visible balance change on each account's
first renewal after it lands — see the release's open risks before applying it, not after.

## After applying

- Confirm the four versions are in `supabase_migrations.schema_migrations`.
- Deploy.
- Grep the application logs for `migration 20260911120200 not applied`. A hit means the order was
  reversed somewhere; the fix is to apply the migration, not to restart the worker.

## Every deploy under gate v2: a release decision for the exact SHA

**Applies when** production runs `TAVONEL_CUSTOMER_DATA_GATE_VERSION=v2`. Under v1 (or unset) the
per-workspace v1 receipt governs and this section has nothing to check. The production value was
not read when this section was written (2026-10-17).

### Why every deploy

- v2 binds each release decision and each workspace grant to `VERCEL_GIT_COMMIT_SHA`
  (`nextjs/lib/customer-data-admission.ts`). The policy says so in as many words: "A deployment or
  rollback without those matching receipts deliberately refuses new processing"
  (`docs/audit/SCOPED_CUSTOMER_DATA_LAUNCH_POLICY_2026-09-29.md`, "Deployment lifecycle"). A merge
  to `main` deploys a new SHA; nothing records that SHA's decision automatically. A rollback
  deploys an older SHA, which needs its own current decision as well.
- Until the deployed SHA has a production decision for `direct_upload`, production checkout
  answers `CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE`. A qualification decision is not a release:
  checkout answers `PROCESSING_QUALIFICATION_NOT_BILLABLE` (`nextjs/app/api/billing/checkout/route.ts`).
- The gate-enforcement sweeper (`/api/internal/billing/gate-enforce`, every 15 minutes per
  `nextjs/vercel.json`) pauses a paid subscription at Paddle once its next charge is within
  48 hours and the gate does not admit the workspace (`NEAR_BILLING_WINDOW_MS`,
  `nextjs/lib/billing-gate-enforcement.ts`). A late decision therefore pauses renewals, and
  resuming is the customer's own act.
- A decision is valid for at most 30 days from its `evaluated_at` (`shared/scopedCustomerDataGate.ts`).
  A SHA that stays deployed longer needs a new decision before then.

### Order

1. Apply the release's migrations (above).
2. Deploy.
3. Record the production release decision for the deployed SHA. **Founder act.**
4. Run the check below. Exit 0 before relying on file processing or checkout on that SHA.

Who records the decision, with what tooling, how soon after a deploy, and whether a deploy may
serve before it is recorded, is founder decision D-15 (journey map FD-04). This repository has no
recorder. The check below records, renews and refuses nothing. Evidence must be real: no
precondition is recorded as `satisfied: true` to make the check pass (launch policy, "Bounded
processing cohort").

### The check (read-only)

```sh
cd nextjs
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  pnpm release:gate-check --sha <deployed 40-hex SHA> [--scope connector] [--warn-days 7]
```

- `--sha` is the Git commit of the production deployment (Vercel deployment details), not the
  `HEAD` of a local checkout.
- One GET per scope against `customer_data_release_decisions`, with the gate's own select, order
  and limit; the row is re-verified with the gate's own `verifyStoredRelease`. No POST, PATCH or
  RPC is sent (`nextjs/scripts/release-gate-check.test.mjs` counts them). The report carries no
  evidence text, operator or reason.
- The default scope is `direct_upload`, the self-serve path. Add `--scope connector` only when
  connectors are part of the release. `--warn-days` (default 7, 0–30) sets the expiry warning.

| exit | meaning | next step |
|---|---|---|
| 0 | every requested scope is released for this SHA and none expires within the window | none |
| 1 | `missingScopes` or `expiringScopes` is not empty | read each scope's `status` below |
| 2 | the check could not run (arguments, credentials, store); no report is printed | fix and run again; never read it as "missing" |

| `status` | meaning |
|---|---|
| `released` | a verified production decision for this SHA; `expiresAt` and `remainingHours` say when it lapses |
| `expiring` | released, but `remainingHours` falls within `--warn-days`; record a new decision before it lapses |
| `missing` | no row for this scope and SHA; `requiredFacts` lists the 12 (direct upload) or 17 (connector) facts a decision needs, `founder_approval_receipt_recorded` among them |
| `refused` | the latest row is `allowed = false`; `missingFacts` names the unmet facts. A refusal stands until a later decision |
| `invalid` | the latest row does not verify (schema, stage, digest or timestamps). The ledger is insert-only: record a new decision, never edit the row |
| `expired` | the latest row is older than 30 days |
| `qualification_only` | a bounded qualification for one operator workspace (`workspaceKey`, `expiresAt`), never a release for anyone else |

## 추가 2026-10-27 — D-05: 게이트를 건드리지 않은 배포는 출시를 이어받는다

위 내용은 바꾸지 않았다. 설계와 이유는 `docs/adr/0006-release-continuity-by-gate-surface.md`에 있다.

### 무엇이 바뀌나

- production 출시 행에 `gate_surface_sha256`을 넣을 수 있다(migration `20261027120000`). 값은 그 SHA의
  게이트 표면 digest다: `cd nextjs; node scripts/gate-surface.mjs --sha <40자 SHA>`. 그 커밋이 로컬에 있어야 한다.
- 표면을 넣어 기록한 출시는 **digest가 같은 이후 배포 전부**를 덮는다. 원래 행의 `evaluated_at`부터 30일까지다.
  `nextjs/scripts/gate-surface-rules.json`이 presentational로 정한 경로만 바꾼 배포는 새 기록이 필요 없다.
  그 경로는 **실행되지 않는 내용**뿐이다: markdown, `docs/`와 `nextjs/public/`의 이미지·폰트·영상·자막·PDF·텍스트, specimen 데이터
  JSON 두 종류(`nextjs/lib/specimen-sources.json`, `public/proof-collection/specimens/*.run.json`).
- 표면 경로를 하나라도 바꾼 배포는 digest가 달라서 아무것도 상속하지 않는다. 이전처럼 그 SHA에 대한 새 기록이
  필요하다. 실행되거나 코드로 import될 수 있는 파일(`ts`, `tsx`, `js`, `mjs`, `cjs`, `mdx`, `css`, `svg`, `html`, JSON, YAML 등)은
  디렉터리와 상관없이 표면이다(R5). 그래서 landing-v2·benchmarks·changelog 페이지와 그 데이터 lib, e2e, 모든 테스트, 스크립트,
  설정, `package.json`도 표면이다. changelog 글 하나를 더하는 배포도 새 기록이 필요하다. 정책 문서, `.well-known`,
  `public/developer/` 폴더 전체(고객이 실행하는 클라이언트와 설치·안전 계약 `.md`), `public/evaluation/`의 평가 기록지(고객 데이터
  취급 안내, R6 보안 리뷰 N3)는 내용이라도 표면이다.
  production 빌드의 첫 명령(`prebuild`의 `node scripts/gate-surface.mjs --deploy`)이 다른 저장소 코드보다 먼저 digest를
  계산하고, `next.config.mjs`는 그 기록을 읽기만 한다. 그 뒤의 prebuild(`pnpm check`, hermetic vitest)와 `next build`는 표면 코드만
  돌린다. symlink와 gitlink도 이름과 상관없이 표면이다.
- Vercel **production** 빌드이고 작업 트리가 깨끗할 때(`git status --porcelain`이 빔)만 digest를 주장한다.
  preview와 로컬 빌드, 수정되거나 추적하지 않는 파일이 있는 빌드는 `none`이고 정확한 SHA만 읽는다.
  skip-worktree나 assume-unchanged가 걸린 항목이 하나라도 있거나 index가 HEAD와 다른 빌드도 `none`이다.
  git은 무시되는 입력(`node_modules`, `.env*`, build cache)을 볼 수 없다. **production build cache는 신뢰하지 않는 입력이다.**
  이 출시 방식은 Production env `VERCEL_FORCE_NO_BUILD_CACHE=1`(창업자/운영 설정)에 기댄다. 아래 순서 2번에서 확인한다.
  deploy 단계는 저장소나 `node_modules` 안의 `git`을 건너뛰고, 저장소나 `node_modules` 안의 node에서 돌거나 PATH의 첫 `node`가
  그런 곳에 있으면 빌드를 멈춘다(심층 방어). **그러나 cache가 복원한 `node_modules/.bin/node`가 node를 바꿔치기하는 것은 deploy
  단계가 막을 수 없다.** 그 node 아래에서는 deploy 단계의 검사가 아예 돌지 않는다(R6 보안 리뷰 N1). 그것을 막는 것은
  `VERCEL_FORCE_NO_BUILD_CACHE=1`이다. 그래서 deploy 단계는 이 설정이 `1`이 아니면 `none`을 기록하고, 설정 이름을 적은 메시지를
  찍는다.
  그래서 push만 한 브랜치나 로컬에서 `--prebuilt`로 올린 빌드는 production 출시를 이어받지 못한다.
- digest는 v2 형식(`tavonel.gate_surface_digest.v2`, 표면 항목마다 JSON 배열 한 줄)이다. `d8b3ec3c`까지의 v1 형식으로
  계산해 둔 값은 쓰지 않는다. 값은 늘 아래 명령으로 다시 계산한다.
- 결정은 여전히 가장 최근 행이다. 대상은 이 SHA를 이름 붙인 행과 이 표면을 이름 붙인 행이다. 표면을
  적지 않은 거절은 그 revision 자기 행의 표면을 물려받는다. 자기 표면 행이 없는 SHA, 즉 상속 중일 수 있는
  SHA를 표면 없이 거절하면 DB가 `refusal_requires_surface`로 거부한다. 그 SHA만 닫으면 다음 같은 표면 배포나
  출시한 SHA로의 rollback이 다시 열리기 때문이다. 아래 "거절" 절차대로 표면을 넣어 기록하면 같은 표면의 모든 배포가 닫힌다.
- 허용된 표면 출시가 30일 안에 있으면 그 scope에서는 qualification을 기록할 수 없다(`qualification_over_surface_release`).
  나중의 거절이 그 표면 출시를 끝냈어도 30일 동안은 그렇다. 닫힌 쪽이다.

### 순서

1. migration `20261027120000_release_gate_surface_continuity`를 production에 적용한다. **창업자 작업.**
2. **배포 전에 Vercel 설정을 확인한다. 창업자/운영 작업.** 하나라도 아니면 D-05는 무효다. 표면을 넣은 행을 기록하지 않고
   오늘처럼 SHA마다 기록한다.
   - `vercel project inspect tavonel-saas-foundation`에서 Root Directory가 `nextjs`이고 **Build Command와 Install Command가 둘 다
     기본값**이다(R5 보안 리뷰 N1). 대시보드에서 바꾼 command는 저장소 밖이라 테스트가 보지 못한다. 바꾼 build command는 deploy
     단계를 건너뛰고, 바꾼 install command는 deploy 단계보다 먼저 다른 명령을 돌릴 수 있다.
   - Production 환경 변수에 `VERCEL_FORCE_NO_BUILD_CACHE=1`이 있다(R5 보안 리뷰 B2). production build cache는 신뢰하지 않는
     입력이고, 이 출시 방식은 이 설정에 기댄다. 이 PR은 설정하지 않았다.
   - deploy 단계는 cache가 복원한 `node_modules/.bin/node`가 자기를 대신 실행하는 것을 막을 수 없다. 막는 것은 이 설정이다
     (R6 보안 리뷰 N1). 그래서 deploy 단계는 이 설정이 `1`이 아니면 `none`을 기록하고
     `gate-surface --deploy: VERCEL_FORCE_NO_BUILD_CACHE is not 1 …` 메시지를 찍는다. 설정이 빠진 정직한 빌드는 조용히 상속을
     주장하지 않는다. 다만 바꿔치기된 node는 이 검사도 건너뛰므로, 설정 자체는 여기서 눈으로 확인한다.
3. 이 코드를 배포한다. **이 코드의 첫 production 빌드 로그에 `customer-data gate surface (deploy step): sha256:…` 줄이
   `pnpm check` 출력보다 먼저 찍혀야 한다.** 로그에 "Restored build cache"가 없어야 한다(있으면 2번 설정이 빠졌다).
   production 빌드인데 `none (exact-SHA release only)`이면 바로 앞 stderr 줄이 원인을 적는다.
   - `VERCEL_FORCE_NO_BUILD_CACHE is not 1 …`: 2번 설정이 빠졌다.
   - `gate-surface --deploy: records none: …`: 다음 중 하나다. 경로만 적고 파일 내용은 적지 않는다.
     - `HEAD is …, not VERCEL_GIT_COMMIT_SHA …`
     - `git status is not clean: <경로들>`
     - skip-worktree나 assume-unchanged 항목
     - git 실패
     - HEAD의 digest 없음
   - 그때는 기능이 꺼진 것이다. 오늘처럼 SHA마다 기록하고, 원인을 고친 뒤 다음 production 빌드에서 다시 확인한다.
   - preview 빌드는 항상 `none`이다.

   **2026-11-04 진단**(ADR 0006 "추가 2026-11-04")
   - Vercel production 빌드에는 shallow `.git`과 git이 있다. `HEAD`는 `VERCEL_GIT_COMMIT_SHA`와 같다.
   - `main` `1008bd22`의 `none`은 깨끗하지 않은 checkout 때문이었다. 두 줄이 나왔다.
     - `?? vercel.json`: Vercel이 clone 직후 루트에 쓰는 파일이다. 이제 루트 `.gitignore`가 무시한다.
     - ` M supabase/tests/foundation_approved_connection_batch_binding.sql`: 섞인 줄끝 blob이었다. 이제 LF만으로 저장한다.
   - 이 두 변경이 병합된 뒤의 production checkout은 deploy 단계가 요구하는 깨끗한 상태를 채운다.
     LF 새 clone에 루트 `vercel.json` 사본을 두고 확인했다.
   - 병합 뒤에도 `git status is not clean`이 찍히면, 그 줄의 경로가 새 원인이다.
   빌드가 `gate-surface --deploy:`로 시작하는 메시지로 멈추면(exit 1) 그 메시지가 원인이다. 위의 `records none:` 줄은 빌드를 멈추지 않는다. node나 git이 저장소·`node_modules` 안에서
   찾혔거나(cache나 PATH를 확인한다), 같은 SHA의 기록 파일이 이미 있다(메시지가 경로를 적는다. 로컬 `vercel build --prod`를
   두 번 돌린 경우면 그 파일을 지우고 다시 빌드한다).
4. **필수: 세 값이 같은지 대조한다**(R5 보안 리뷰 N2). 첫 빌드만이 아니라, 표면을 넣은 행을 기록하기 전과 상속을 출시로
   보고하기 전마다 한다. 런타임 gate는 위조를 스스로 알 수 없으므로 이 대조가 값싼 탐지 장치다.
   깨끗한 checkout 수정(2026-11-04)이 병합된 뒤 첫 production 빌드에서 (a)가 `sha256:…`이고 (a)·(b)·(c)가 같아야 한다.
   이것이 이 수정의 유일한 end-to-end 증명이다. 그 전의 확인은 preview 진단과 로컬 LF clone뿐이다.
   - (a) 빌드 로그의 `customer-data gate surface (deploy step): …` 줄
   - (b) 같은 로그에서 `next build`가 시작한 뒤 찍히는 `customer-data gate surface: …` 줄. prebuild의 vitest suite가 next.config를
     import하며 찍는 같은 이름의 줄은 hermetic env라서 `none`이다. 그 줄과 헷갈리지 않는다.
   - (c) 로컬에서 `pnpm release:gate-check --sha <배포 SHA>` 보고서 맨 위의 `gateSurfaceSha256`(DB 자격 증명이 없으면
     `cd nextjs; node scripts/gate-surface.mjs --sha <배포 SHA>`)
   셋 중 하나라도 다르면 기록하지 않는다. 그 SHA를 표면 digest와 함께 거절하고(아래 "거절") 원인을 찾는다.
5. 그 SHA의 production 결정을 `gate_surface_sha256`을 넣어 기록한다. **창업자 작업**(SQL editor에서 Run).
   receipt는 evaluator로 계산하고, 손으로 치거나 복사하지 않는다.

   저장소 루트에서 실행한다. 저장소에 있는 TS loader를 쓰므로 네트워크에서 받는 도구가 없다.

   ```sh
   node --experimental-strip-types --import ./nextjs/scripts/router/register-ts-loader.mjs --input-type=module -e 'const m = await import("./shared/scopedCustomerDataGate.ts"); console.log(JSON.stringify(m.evaluateScopedRelease(JSON.parse(process.argv[1])), null, 2))' '{"scope":"direct_upload","releaseRevision":"<SHA>","gateSurfaceSha256":"<digest>","now":"<evaluatedAt ISO>","evidence":[<12개 사실>]}'
   ```

   출력이 `"allowed": true`일 때만 넣는다. 열은 기존 production 행과 같고 `gate_surface_sha256`만 추가된다.
6. `pnpm release:gate-check --sha <배포 SHA>`가 exit 0인지 본다. 상속한 SHA는 `released`이고
   `inheritedFrom`에 창업자가 기록한 SHA가 찍힌다. 보고서 맨 위의 `gateSurfaceSha256`이 `null`이면
   그 커밋을 fetch하지 않았거나 규칙 파일 이전 커밋이다. 그때는 정확한 SHA만 읽으므로, 덮인 SHA도 `missing`으로 보일 수 있다.
   상속을 보고하기 전에 check는 행의 `release_revision` digest를 로컬 Git으로 다시 계산한다. 결과가 행의
   `gate_surface_sha256`과 다르거나, 그 revision을 fetch하지 않아 계산할 수 없으면 `surface_mismatch`
   (`SCOPED_RELEASE_SURFACE_MISMATCH`)이고 exit 1이다. 앞의 경우는 다른 빌드의 digest를 붙여 넣은 행이다.
   그 표면을 거절하고(아래 "거절") 올바른 digest로 다시 기록한다. 뒤의 경우는 `git fetch` 뒤 다시 돌린다.
   **상속한 행은 이 재계산을 통과한 뒤에만 출시로 센다.** 런타임 gate는 행에 적힌 digest를 그대로 믿고 다시
   계산하지 않는다. 그래서 표면을 넣은 행을 기록할 때마다, 그리고 상속을 출시로 보고하기 전에 이 check가 exit 0으로
   `released`와 `inheritedFrom`을 내는지 확인한다.

migration은 다시 적용할 수 없다. 두 번째 적용은 `column "gate_surface_sha256" already exists`로 실패하고
`begin/commit` 안에서 통째로 롤백된다. SQL editor에 두 번 붙여 넣어도 상태는 바뀌지 않는다.

### 거절 (표면 출시 기간)

1. `pnpm release:gate-check --sha <거절할 배포 SHA>`를 실행하고 보고서 맨 위의 `gateSurfaceSha256`을 본다.
   DB 자격 증명 없이 digest만 필요하면 `cd nextjs; node scripts/gate-surface.mjs --sha <거절할 배포 SHA>`로 바로
   계산한다. 긴급 거절이 digest를 찾느라 늦어지지 않게 하는 명령이다.
2. 값이 있으면 거절 행의 `gate_surface_sha256`에 그 값을 넣어 기록한다. **창업자 작업.** 그러면 이 SHA와 같은
   표면의 모든 배포, 그리고 출시한 SHA로의 rollback이 닫힌다.
   - trigger가 이것을 강제하지 않는 경우가 하나 있다. 그 SHA가 표면 출시보다 **새로운** 자기 행(표면 없는 정확한
     출시)을 가지면 DB는 표면 없는 거절도 받는다. 그 SHA만 닫히고, 같은 표면의 다른 배포와 출시한 SHA로의
     rollback은 표면 출시를 계속 읽는다. 열린 쪽으로 새는 것은 아니지만(정확한 SHA 시절과 같은 의미), 표면 전체를
     닫으려면 이 경우에도 값을 넣어 기록한다.
3. 값이 `null`이면(규칙 파일 이전 커밋) 그 배포는 표면을 읽지 않는다. 표면 없이 거절해서 DB가
   `refusal_requires_surface`로 거부하면, 살아 있는 표면 출시의 digest를 넣어 거절한다. 그 표면 전체가 닫힌다.
   닫힌 쪽이다. 필요한 배포는 그 뒤에 다시 기록한다.
4. 거절은 READ COMMITTED(SQL editor 기본값)에서 기록한다. 다른 격리 수준이면 DB가 표면 없는 거절을
   `refusal_requires_read_committed`로, qualification을 `qualification_requires_read_committed`로 거부한다.

표면 없이 기록된 예전 정확한 SHA 거절은, 같은 표면을 이름 붙인 **나중의** 허용 출시에 진다. 최신 행이 결정이라는
규칙 그대로다. 표면이 같으므로 창업자의 새 결정이 같은 코드에 대한 것이다. 예전 거절을 유지하려면 그 표면을
넣어 다시 거절한다.

### 하지 말 것

- 이 코드가 배포되기 **전**에 표면을 넣은 행을 기록하지 않는다. 이전 코드는 표면 없이 receipt를 다시
  계산하므로 그 행을 `SCOPED_RELEASE_INVALID`로 읽고 닫힌다.
- presentational 목록을 넓혀서 기록을 피하지 않는다. 목록을 넓히는 PR은 규칙 파일을 바꾸므로 그 자체로
  digest가 바뀐다. 리뷰를 거친 뒤 한 번 다시 기록한다.

## 추가 2026-11-04 — W1-A2: trial AI 사용량 열 (`20261104090000_trial_ai_usage`)

- 추가만 한다. `foundation_trial_policy`에 `ai_access_days`(14), `ai_page_limit`(200), `ai_world_limit`(1),
  `ai_daily_query_limit`(200), `foundation_self_service_trials`에 `ai_query_day`, `ai_query_count`를 더하고,
  두 테이블에 client 역할 거부 policy와 service_role 전용 함수 `foundation_trial_ai_access`를 만든다.
  W1-A3의 내부 운영 receipt 테이블 `foundation_operations_receipts`(어떤 역할도 table 권한 없음)와 그 writer
  `record_foundation_operations_receipt`(service_role 전용)도 같은 파일에서 만든다. 고객이 export하는
  `enterprise_audit_events`와는 다른 테이블이다.
- 순서: **migration 먼저, 배포 나중.** 코드가 먼저 도착해도 깨지지 않는다. flag가 꺼져 있으면 shadow 읽기가
  실패해서 아무것도 세지 않을 뿐이고(402는 그대로), flag가 켜져 있으면 503 `TRIAL_AI_ACCESS_CHECK_FAILED`로 닫힌다.
- `TAVONEL_TRIAL_AI_ACCESS_ENABLED`는 이 migration이 production에 적용되고, 창업자 F-2(trial 약관 문구·상한)가
  승인된 뒤에만 `true`로 둔다. 상한 값은 `foundation_trial_policy` 한 행을 바꾸면 배포 없이 바뀐다.
- 되돌리기: env flag를 지운다(즉시, build 없음). 열과 테이블은 남겨 둔다(expand만, down migration 없음).
- migration 순서(2026-11-05 갱신): #186은 #190 다음에 merge한다. 그래서 production에는 #190의 `20261105000000`이
  이 파일 `20261104090000`보다 먼저 적용된다. 둘은 서로 다른 객체만 만든다(#190은 `foundation_api_keys`와 그 RPC,
  이 파일은 trial 열과 receipt 테이블). 그래서 적용 순서가 결과를 바꾸지 않는다. 다만 `supabase db push`는 이미 적용된
  버전보다 이른 버전을 out-of-order로 거부한다. production 이력은 원래 repo와 어긋나 있으므로, 파일을 하나씩 적용하고
  이력에 기록한다. 빈 DB(CI db-rehearsal)는 파일명 순서대로 적용한다. 적용 순서와 버전은 캠페인 ledger에 적는다.
- 리셋 범위 `20261105010000_founder_test_reset_operations_receipts`(R2-m2): founder test reset이
  `foundation_operations_receipts`도 세고, fingerprint에 넣고, 지운다. 이 파일은 `20261104090000`(테이블) **뒤에**
  적용한다. W1-B1(#187)의 `20261104091000_founder_test_reset_source_fingerprints`도 같은 세 함수 본문을 바꾼다.
  migration은 timestamp 순서로 적용되므로 이 파일이 항상 그 뒤에 온다. 그래서 이 파일의 본문은 #187 본문의 상위집합이다
  (#187 줄 + receipts 줄). merge 순서는 #190 → #187 → #186이다. 두 pgTAP(`founder_test_reset_operations_receipts.sql`,
  `founder_test_reset_source_fingerprints.sql`)과 `founder-test-reset-migration.test.ts`가 이 본문에서 함께 통과한다.
- trial 키 규칙(F-2 문구용): **trial 주체 하나당 살아 있는 키 1개. 수동 키든 MCP 키든 같다.** 키를 실제로 만드는 두 곳에서
  검사한다: `POST /api/developer/keys`와 원격 MCP token 발급(`/api/mcp/oauth/token`). consent(`authorize`)는 키를 만들지
  않으므로 검사하지 않는다. 같은 client의 재연결은 대체되는 자기 키를 세지 않는다. 그래서 재연결 뒤에도 키는 1개다.
  수동 키가 살아 있으면 MCP 연결이 402 `TRIAL_LIMIT_REACHED`이고, 반대도 같다. 가진 키를 revoke하거나 만료(MCP 토큰은
  1시간)되면 풀린다. UI 안내 문구는 A2.2 전에 이 규칙에 맞춘다.

### 수동 단계 — RunPod billing 1회 확인 (cost cap을 켜기 전)

`TAVONEL_RUNPOD_DAILY_COST_CAP_USD`를 production에 넣기 **전에** 사람이 한 번 한다. 에이전트는 호출하지 않는다.

1. production 값의 `TAVONEL_RUNPOD_API_KEY`로 `GET https://api.runpod.io/v2/billing?bucketSize=day&lastN=2`를 1회 읽는다.
2. receipt를 남긴다: 요청 시각(UTC), HTTP status, 각 record의 `startTime`·`totalAmount`. key와 응답 원문 전체는
   남기지 않는다. 캠페인 receipts 디렉터리에 저장하고 ledger에 경로를 적는다.
3. 확인할 것: status가 200이다(403이면 key scope가 billing을 허용하지 않는다). `records`가 배열이다.
   오늘 bucket의 `startTime`이 now를 포함하는 하루 구간이다(UTC 자정이 아니어도 된다. 코드는 구간으로 고른다).
4. 셋 중 하나라도 아니면 cap을 넣지 않는다. 넣어도 점검은 매일 00 UTC에 `RUNPOD_BILLING_UNREADABLE` warning만 보낸다.
## 추가 2026-11-05 — W1-A1 원격 MCP: rollback은 무엇이 즉시이고 무엇이 아닌가

리뷰 R1 M4. Vercel에서 env 값은 deployment에 묶인다. `TAVONEL_REMOTE_MCP_ENABLED`나
`TAVONEL_REMOTE_MCP_COHORT`를 바꿔도, 그 값은 **새 build가 production이 될 때** 반영된다. 새 build는 과금되고
수 분이 걸린다. 그래서 "env만 바꾸면 즉시 꺼진다"는 말은 틀렸다. 즉시 쓸 수 있는 손잡이는 아래 1과 2다.

`tvnl_mcp_` 토큰(원격 MCP OAuth로 발급된 키)은 `/api/mcp`를 통해서만 인증된다. `/api/v1`에 직접 보내면
`401 API_KEY_AUDIENCE_INVALID`로 거부된다. 따라서 스위치가 꺼진 deployment가 서빙되는 순간, 남은 토큰은 어디에서도
쓸 수 없다.

### 순서 (사고 시)

1. **원격 MCP 키 일괄 revoke — 즉시, build 없음.**
   ```
   curl -sS -X POST https://<production host>/api/internal/remote-mcp/revoke-all \
     -H "Authorization: Bearer $FOUNDATION_WORKER_SECRET"
   ```
   응답 `{"code":"REVOKED","revoked":N,"byWorkspace":{...},"revokedAt":"..."}`을 캠페인 원장에 그대로 남긴다.
   인증은 호출마다 키 행을 읽으므로, revoke된 키는 다음 호출부터 401이다. 손으로 만든 키(`tvnl_live_`)는 건드리지
   않는다. 대상은 저장된 `token_kind = 'mcp'`이고 이름이 아니다(R2 N1). 그래서 예전에 `MCP:`로 이름 붙인 수동 키도
   남는다.

   **이것만으로는 멈추지 않는다.** 스위치가 켜진 deployment가 서빙되는 동안 client는 다시 OAuth를 거쳐 새 키를
   받는다. 그러니 2를 이어서 한다.

2. **Vercel Instant Rollback — build 없음, 과금 build 없음.** 원장에 기록해 둔 직전 production deployment ID로 되돌린다.
   그 deployment가 스위치가 꺼진 env로 build되었으면, 원격 MCP는 그 즉시 404가 된다. 되돌린 뒤 1을 한 번 더 실행해,
   그 사이에 발급된 키를 정리한다.

3. **영구 조치: env 변경 + redeploy (과금 build 1회).** `TAVONEL_REMOTE_MCP_ENABLED`를 지우거나
   `TAVONEL_REMOTE_MCP_COHORT`에서 workspace를 뺀다. 이 deployment가 production이 될 때까지는 1과 2가 유효하다.

### 하지 말 것

- `TAVONEL_PROCESSING_WORKSPACE_COHORT`로 원격 MCP를 좁히지 않는다. 원격 MCP의 cohort는
  `TAVONEL_REMOTE_MCP_COHORT`(1–3개)다. processing cohort를 바꾸면 업로드 처리 허용 범위가 함께 바뀐다(R1 M5).
- 이 절차를 처음 쓰는 날이 사고 날이 되지 않게 한다. A1.3 canary 전에 preview에서 1–2를 한 번 실행하고,
  걸린 시간을 receipt로 남긴다(로컬 shadow 측정: `REMOTE-MCP-SECURITY-<sha>.json`의 `bulkRevoke`).

### 배포 순서 (R2 N1, migration `20261105000000_api_key_token_kind.sql`)

이 PR의 코드는 key를 인증할 때 `token_kind` 열을 읽는다. **migration을 code보다 먼저 적용한다.** 열이 없는 DB에서
이 code가 돌면 PostgREST가 select를 거부하고, 모든 API key 인증이 `API_KEY_INVALID`가 된다(fail closed지만 장애다).
migration은 additive다. 기존 행은 전부 `live`가 되고, create RPC의 새 마지막 인자 `p_token_kind`의 기본값도 `live`이므로,
옛 code가 새 DB에서 돌아도 그대로 동작한다. rollback 때 migration을 되돌릴 필요는 없다.

### A1.3 canary 전제 조건 (이 PR 범위 밖, 모두 충족 전에는 cohort를 열지 않는다)

- [ ] preview rollback drill: 위 1(일괄 revoke)과 2(Instant Rollback)를 preview에서 한 번 실행하고 걸린 시간을 receipt로
      남긴다. preview build는 과금되므로 founder 승인 후에만 한다.
- [ ] 실제 Claude와 ChatGPT 연결 receipt: 각 vendor client가 public https URL로 OAuth와 MCP handshake를 끝낸 기록.
      모델 ID나 client 버전은 receipt에 고정한다.
- [ ] `/api/mcp*`(OAuth register, authorize, token 경로 포함)에 IP별 rate limit을 둔다(리뷰 R2가 요구한 전제).
- [ ] production에 `TAVONEL_REMOTE_MCP_COHORT`(1–3개)와 `FOUNDATION_WORKER_SECRET`(32자 이상)이 설정되어 있다.
      값은 출력하지 않고, 설정되어 있다는 사실만 확인한다.
- [ ] migration `20261105000000`이 production DB에 적용되어 있다(위 배포 순서).

## 추가 2026-11-05 — compile job 이벤트의 종결 guard (migration `20261105080000`)

- `foundation_compile_job_events`에 BEFORE INSERT trigger를 단다. job이 `ready`/`failed`/`cancelled`이면 그와 다른 state의 행을
  `compile_job_post_terminal_event`로 거절한다. 원인 사례: cjob-157f2f23 seq 159 (`failed` 뒤의 `structuring`).
- **순서는 자유다.** 앱은 거절을 "기록되지 않은 이벤트"로 다루고(`COMPILE_JOB_ALREADY_SETTLED`, 경고 로그 1줄),
  migration이 없으면 거절이 일어나지 않을 뿐이다. 같은 PR의 lease CAS는 기존 컬럼(`updated_at`)만 쓰므로 migration이 필요 없다.
- 적용은 **창업자 작업**이다. 동작은 CI db-rehearsal이 `supabase/tests/compile_job_post_terminal_event.sql`로 검증한다.

## 추가 2026-11-08 — W2-E2 Ask 답변 가능성 게이트 shadow (migration 없음)

- 새 flag는 `TAVONEL_ASK_ANSWERABILITY_MODE`(부록 A)다. 기본값은 `off`이고, `off`면 게이트를 계산하지 않는다. `shadow`면 판정을 계산해
  `tavonel.answerability_shadow.v1` 로그 한 줄로 남긴다. 그 줄은 답 receipt의 `outputSha256`, `questionSha256`에 묶이고, 개수만 담으며
  질문의 단어는 담지 않는다. 응답 본문, receipt, signed receipt(`answerability: null`)는 바뀌지 않는다. `on`을 포함한 다른 값은
  `off`로 처리하고 `TAVONEL_ASK_ANSWERABILITY_MODE_INVALID` 오류를 로그에 남긴다.
- **순서는 자유다.** migration도, 새 API 오류 코드도, DB 쓰기도 없다. production에서 `shadow`로 켜는 것은 env 변경이고,
  재배포가 필요하므로 과금 build 1회다. 별도 batch로 하지 말고 다음 wave batch에 묶는다.
- **holdout 판정은 `NOT_SUPPORTED`다**(`nextjs/eval/ask-quality/e2/receipts/holdout-*.json`, C2 실패: 답할 수 있는 질문 21/191을
  거절했고, Wilson 상한은 0.162로 허용치 0.10을 넘었다). 그래서 `on`(cohort 안에서 abstain)은 만들지 않았다. 새 사전 등록과 새 holdout에서
  `SUPPORTED`가 나오고 리뷰를 거친 변경이 있기 전에는 제안하지 않는다.
- rollback: flag를 지우거나 `off`로 둔다. 코드를 되돌릴 필요는 없다(off 경로는 계산을 하지 않는다).

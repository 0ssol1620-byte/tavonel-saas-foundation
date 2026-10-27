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
  그 경로는 문서, e2e와 production 빌드에서 돌지 않는 테스트, 정적 미디어(이미지·영상·폰트·PDF), `nextjs/components/landing-v2/`,
  `nextjs/app/(benchmarks|changelog)/`, 그리고 changelog·compiler-release·GDP 페이지 데이터뿐이다.
- 표면 경로를 하나라도 바꾼 배포는 digest가 달라서 아무것도 상속하지 않는다. 이전처럼 그 SHA에 대한 새 기록이
  필요하다. 표면에는 migration, `shared/`, `nextjs/lib/`의 서버 코드, API route, 의존성, 정책 문서, 규칙 파일
  자체가 들어간다. 동의·업로드·원본·키·계정 화면을 포함한 `landing-v2/` 밖의 모든 컴포넌트, 전역 CSS,
  `nextjs/content/`, 그리고 `public/developer/` 폴더 전체(고객이 실행하는 클라이언트와 설치·안전 계약 `.md`)도
  표면이다. presentational 가드 테스트(`scripts/release-gate-check.test.mjs`)와 그 wrapper도 표면이다.
  production 빌드는 digest를 계산하기 전에 빌드 머신에서 prebuild(`pnpm check`, hermetic vitest)를 실행한다.
  그래서 `vitest.config.ts` include에 걸리는 테스트 전부, prebuild 스크립트, vitest·eslint·tsconfig·next 설정,
  `package.json`도 표면이다. presentational 모듈을 import하는 테스트 25개는 production 빌드의 prebuild에서
  빠지고(`run-hermetic-vitest.mjs`의 `PREBUILD_EXCLUDED_SUITES`) CI에서만 돈다.
- Vercel **production** 빌드이고 작업 트리가 깨끗할 때(`git status --porcelain`이 빔)만 digest를 주장한다.
  preview와 로컬 빌드, 수정되거나 추적하지 않는 파일이 있는 빌드는 `none`이고 정확한 SHA만 읽는다.
  skip-worktree나 assume-unchanged가 걸린 항목이 하나라도 있거나 index가 HEAD와 다른 빌드도 `none`이다.
  git은 무시되는 입력(`node_modules`, `.env*`)을 볼 수 없다. 그 입력은 빌드가 표면 코드만 실행한다는 규칙으로만 지킨다.
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
2. 이 코드를 배포한다. **이 코드의 첫 production 빌드 로그에 `customer-data gate surface: sha256:…` 줄이 비어 있지 않은
   digest로 찍혀야 한다.** 이 줄을 확인하기 전에는 표면을 넣은 행을 기록하지 않는다.
   production 빌드인데 `none (exact-SHA release only)`이면 빌드에서 git을 쓸 수 없거나 작업 트리가 깨끗하지 않다는
   뜻이다(예: prebuild가 무시되지 않는 파일을 남김). 그때는 기능이 꺼진 것이므로 오늘처럼 SHA마다 기록하고, 원인을
   고친 뒤 다음 production 빌드에서 다시 확인한다. preview 빌드는 항상 `none`이다.
3. 빌드 로그의 digest와 `node scripts/gate-surface.mjs --sha <배포 SHA>`(nextjs에서)의 출력이 같은지 본다.
4. 그 SHA의 production 결정을 `gate_surface_sha256`을 넣어 기록한다. **창업자 작업**(SQL editor에서 Run).
   receipt는 evaluator로 계산하고, 손으로 치거나 복사하지 않는다.

   저장소 루트에서 실행한다. 저장소에 있는 TS loader를 쓰므로 네트워크에서 받는 도구가 없다.

   ```sh
   node --experimental-strip-types --import ./nextjs/scripts/router/register-ts-loader.mjs --input-type=module -e 'const m = await import("./shared/scopedCustomerDataGate.ts"); console.log(JSON.stringify(m.evaluateScopedRelease(JSON.parse(process.argv[1])), null, 2))' '{"scope":"direct_upload","releaseRevision":"<SHA>","gateSurfaceSha256":"<digest>","now":"<evaluatedAt ISO>","evidence":[<12개 사실>]}'
   ```

   출력이 `"allowed": true`일 때만 넣는다. 열은 기존 production 행과 같고 `gate_surface_sha256`만 추가된다.
5. `pnpm release:gate-check --sha <배포 SHA>`가 exit 0인지 본다. 상속한 SHA는 `released`이고
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

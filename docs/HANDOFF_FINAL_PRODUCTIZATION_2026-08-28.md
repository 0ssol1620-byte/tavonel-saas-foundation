# TAVONEL Final Productization — Complete Continuation Handoff

**문서 버전:** 1.0  
**작성일:** 2026-08-28 KST  
**작성자:** Manus AI  
**목적:** 새로운 세션 또는 새로운 작업자가 TAVONEL의 현재 상태를 재구성하지 않고 즉시 안전하게 이어서 작업할 수 있도록, 실행 완료 사항·검증 증거·저장소·provider 상태·보안 경계·잔여 작업·정확한 재개 명령을 하나의 비밀정보 없는 기준 문서로 제공한다.  
**Canonical source:** `0ssol1620-byte/tavonel-saas-foundation` private GitHub repository의 `main`  
**현재 작업 범위:** 격리된 TAVONEL SaaS Foundation 및 product-convergence source-only contracts  
**절대 범위 밖:** 기존 `tavonel` production 애플리케이션, `ai-knowledge-compiler` production 사용, 기존 activation production deployment, customer data, live checkout, live intake, GPU paid execution

> **핵심 운영 원칙:** TAVONEL은 파일과 업무 시스템의 정보를 검증 가능한 Living Knowledge World로 컴파일하는 Knowledge Infrastructure를 목표로 한다. 현재 구현은 제품 계약과 provider qualification을 준비한 상태이며, 고객 문서 바이트·결제·R2 browser capability·OCR/GPU dispatch·candidate promotion은 각각 독립된 증거와 contextual approval 없이는 열리지 않는다.

---

## 1. 새로운 세션에서 가장 먼저 읽을 파일

새 작업자는 반드시 다음 순서로 읽는다. 모든 문서는 현재 Foundation `main`에 포함되어야 하며, 문서에 없는 secret을 추측하거나 다른 프로젝트에서 가져오지 않는다.

| 순서 | 파일 | 용도 |
|---:|---|---|
| 1 | `docs/HANDOFF_FINAL_PRODUCTIZATION_2026-08-28.md` | 이 전체 인계서. 현재 기준 상태와 재개 순서 |
| 2 | `todo.md` | 변경 이력이 보존되는 canonical task tracker |
| 3 | `docs/HANDOFF_2026-08-27.md` | 기존 Foundation continuation handoff와 외부 승인 경계 |
| 4 | `docs/PROVIDER_PROVISIONING_STATUS.md` | Supabase, R2, CDR, RunPod provider 증거 |
| 5 | `docs/SECURITY_BOUNDARIES.md` | customer bytes·tenant·credential·activation 경계 |
| 6 | `docs/PRODUCT_CONVERGENCE_AUDIT_2026-08-28.md` | 세 저장소 read-only audit와 KEEP/PORT/REPLACE/ARCHIVE 분류 |
| 7 | `docs/CANONICAL_RESPONSIBILITY.md` | Core Engine/Product Platform 책임 동결 |
| 8 | `docs/MIGRATION_INVENTORY_2026-08-28.md` | R3/R4 staged migration inventory |
| 9 | `shared/activationPolicy.ts` | 모든 live capability의 authoritative fail-closed policy |
| 10 | `shared/productCoreCompileEnvelope.ts` | Product-to-Core source-only compile boundary |

`docs/evidence/`에는 이번 인계에 필요한 비밀정보 없는 RunPod JSON 결과와 세 저장소 audit summary가 보존되어 있다. 인증 토큰, HMAC, OAuth secret, API key, database password는 repository에 존재하지 않아야 한다.

---

## 2. 현재 canonical repository와 GitHub 상태

### 2.1 Foundation repository

| 항목 | 현재 값 |
|---|---|
| Repository | `https://github.com/0ssol1620-byte/tavonel-saas-foundation` |
| Visibility | Private |
| Default branch | `main` |
| Canonical local path | `/home/ubuntu/tavonel-saas-foundation` |
| Latest convergence commit before this handoff | `bfad0127507d2fa46ffb0db0e816db8c2a0ec81f` |
| Latest previous commit | `bfad012` — `align foundation with product convergence masterplan` |
| Remote | `origin` → Foundation private repository |
| Source files before this handoff | 215 tracked files; handoff/evidence additions increase this count after commit |
| Production deployment | Foundation-specific WebDev checkpoint/deployment 없음. GitHub `main`이 source of truth |

이번 문서를 작성할 때 Foundation working tree에는 `todo.md` 수정과 handoff/evidence 파일이 아직 commit 전일 수 있다. 최종 절차에서 `git diff --check`, 전체 검증, `git status`, commit, push, remote verification을 순서대로 실행한다.

### 2.2 절대 혼동하면 안 되는 기존 프로젝트

기존 managed project `tavonel-knowledge-compiler`와 이전 public/managed domain은 이 Foundation의 canonical source가 아니다. 기존 production checkpoint, Vercel alias, Cloudflare production resource, 기존 CDR service, 기존 activation repository를 Foundation 작업에 재사용하거나 수정하지 않는다. Foundation은 별도의 private GitHub repository와 별도의 provider project/bucket 경계를 가진다.

---

## 3. 저장소 권한 모델

최종 제품 구조는 저장소를 물리적으로 history-merge하는 방식이 아니라 **1 Product Platform + 1 Core Engine**의 두 권한 축으로 수렴한다.

### 3.1 최신 read-only repository snapshots

| 저장소 | 최신 remote `main` commit | 역할 | 변경 여부 |
|---|---|---|---|
| `0ssol1620-byte/ai-knowledge-compiler` | `bd0fb334aa6f1272f41a3351a99140a7b1be2593` | **Core Engine**. CIR, stable identity, semantic/structural/temporal/authority diff, typed dependency graph, impact analysis, selective recompilation, equivalence oracle, world semantics | 이번 작업에서 clone/read-only audit만 수행. 변경하지 않음 |
| `0ssol1620-byte/tavonel-compiled-world-activation` | `e017cb65b8dd0a666740aa53a671a4ae10171dda` | **Activation migration donor/evidence reference**. `/world` UX, direct file/ZIP pilot, R2 immutable gates, RunPod release/receipt safety, CDR evidence | 이번 작업에서 clone/read-only audit만 수행. production/activation mutation 없음 |
| `0ssol1620-byte/tavonel-saas-foundation` | `bfad012` 이전 및 이 handoff commit 이후 | **Product Platform donor**. tenant/RLS, billing/credits, upload contracts, fail-closed policy, Foundation CDR/RunPod qualification records | 현재 작업 대상. Foundation에만 문서·source-only contract 추가 |

감사 결과는 `docs/evidence/repository-audit/three-repo-summary-2026-08-28.txt`에 보존되어 있다. 감사용 shallow clone은 `/home/ubuntu/tavonel-repo-audit`에 있었으며 canonical repository가 아니다.

### 3.2 책임 동결

**Core Engine**은 CIR/Knowledge IR, parser/evidence contract, stable identity, diff, dependency graph, impact, selective recompilation, full rebuild equivalence, world validation과 agent lineage semantics를 소유한다. Core는 Auth, tenant membership, billing, browser upload, R2 credential, provider secret, customer bytes, product session, UI routing을 소유하지 않는다.

**Product Platform**은 Next.js product/marketing, Auth/workspace/tenant, Supabase/RLS, billing/credits/entitlements, R2 quarantine metadata/capability issuance, connector orchestration, job/outbox control plane, abuse/quota/cost gate, candidate persistence, active-world pointer, UI/API/MCP surface를 소유한다. Product는 Core 내부 알고리즘을 직접 import하여 deployment coupling을 만들지 않으며, customer bytes를 proxy하지 않는다.

**Activation donor**는 기존 R2/RunPod/CDR/security/UI evidence의 provenance source다. Activation의 production alias, database, secret, bucket, endpoint, customer data는 이번 Foundation 작업의 mutation target이 아니다.

**Foundation donor**는 tenant/RLS/credit/billing/upload contract와 global fail-closed policy의 source다. Foundation의 provider adapter는 여전히 intentionally disconnected 상태다.

상세 기준은 `docs/CANONICAL_RESPONSIBILITY.md`에 있다.

---

## 4. Product definition과 productization masterplan 결정

첨부된 `TAVONEL_FINAL_PRODUCTIZATION_MASTERPLAN_2026-08-28.md`를 기준으로 다음 메시지를 고정한다.

> **TAVONEL은 파일·클라우드·업무 시스템에 흩어진 정보를 검증 가능한 Living Knowledge World로 컴파일하고, 원천이 변할 때 영향을 받은 지식만 다시 계산하여 AI와 사람이 항상 현재의 지식 상태를 사용하게 만드는 Knowledge Infrastructure다.**

외부 메시지는 다음 세 문장을 중심으로 한다.

| 층위 | 문구 |
|---|---|
| Customer outcome | **Stop searching. Start knowing.** |
| Category | **Knowledge that maintains itself.** |
| Trust promise | **Always current. Always grounded.** |

TAVONEL이 판매하는 것은 GPU·토큰·OCR·vector search가 아니라, 검색/비교/재정리 업무 제거, stale knowledge 위험 감소, source-level traceability, 영향 범위만 재계산하여 운영비를 억제하는 결과다.

제품의 장기 wedge는 단일 change detection, graph, RAG freshness, OCR이 아니라 다음의 결합이다.

```text
SOURCE / EVIDENCE REGION
→ STABLE SEMANTIC IDENTITY ACROSS REVISIONS
→ SEMANTIC + STRUCTURAL + TEMPORAL + AUTHORITY DIFF
→ TYPED DEPENDENCY IMPACT
→ SELECTIVE RECOMPILATION
→ FULL-REBUILD EQUIVALENCE / INTEGRITY GATES
→ CANDIDATE WORLD
→ ATOMIC ACTIVE WORLD PROMOTION
→ QUERY / AGENT CONSUMPTION LINEAGE
```

이 메시지는 현재 product contract의 방향이지, 모든 runtime provider가 live라는 의미가 아니다.

---

## 5. 완료된 Foundation 작업

### 5.1 안전 architecture와 domain contracts

완료된 source-only 기능은 다음과 같다.

| 영역 | 완료 사항 | 현재 제한 |
|---|---|---|
| Activation policy | customer intake, CDR, OCR/GPU, candidate promotion을 authoritative policy로 관리 | 모든 live flag는 false |
| Tenant domain | profiles, workspaces, memberships, plans, entitlements, document metadata, proofs, candidates, billing, credit reservations vocabulary | 실제 signup/user/customer data 없음 |
| Authorization | server-side tenant membership/role/quota evaluation | browser trust 없음 |
| Upload contract | tenant-scoped short-lived capability shape, exact key/length/digest/MIME metadata completion | live signer와 browser upload capability 없음 |
| Quarantine | `UPLOADING → QUARANTINED → SCANNING/CDR → SANITIZED → IMMUTABLE/REJECTED` state vocabulary | customer bytes 처리 없음 |
| CDR proof | source digest, sanitized output MIME, immutable object key, sanitizer version binding | metadata-only contract와 Foundation synthetic path만 있음 |
| GPU receipt | proof/input/output/release digest, output object key, worker completion binding | 실제 GPU endpoint/job 없음 |
| Human review | workspace owner/admin만 candidate approve/reject 가능 | approve가 active-world promotion을 열지 않음 |
| Paddle | server-controlled price lookup, raw-body HMAC, event dedupe/order contracts | vendor catalog, webhook, checkout, secret 없음 |
| Credits | trial/pack economics, reservation, settlement, release, margin pause, abuse caps | 실제 credit issuance/payment 없음 |
| Product–Core boundary | `tavonel.compile.job.v1`, `tavonel.compile.receipt.v1` source-only contract | Core worker endpoint 없음 |

### 5.2 Pricing/economics policy

현재 제안은 subscription access + prepaid compute credit의 hybrid model이다. recurring unlimited GPU credit은 제공하지 않는다.

| Pack | Gross price | Credits | 상태 |
|---|---:|---:|---|
| Starter | `$12` | 100 | presentation/contract only |
| Builder | `$30` | 300 | presentation/contract only |
| Scale | `$75` | 800 | presentation/contract only |

Trial policy는 **2 credits, 7일, 최대 1 job**, verified identity와 identity/workspace one-time control, no automatic unlimited capacity가 원칙이다. 실제 credit issuance는 verified Auth와 billing webhook projection이 생기기 전까지 하지 않는다.

초기 cost assumptions는 pricing promise가 아니다. 기존 문서의 보수적 GPU mapping은 4090 1 credit/45 GPU-sec, A100 1/18 sec, H100 1/12 sec이며, per-job 2–10 credits, workspace daily cap 20 credits, server-owned timeout ≤90 sec, reservation TTL ≤300 sec, flex workers min 0/max 1, automatic GPU upgrade 금지, margin-floor breach 시 dispatch pause를 전제로 한다. 실제 공개 가격과 최종 mapping은 synthetic P50/P95와 all-in cost를 측정한 뒤 재조정해야 한다.

### 5.3 Supabase foundation

전용 project는 다음과 같다.

| 항목 | 값 |
|---|---|
| Project name | `tavonel-saas-foundation` |
| Project ref | `tfcorhjkqcuisqhsjemz` |
| Region | Seoul / `ap-northeast-2` |
| State | `ACTIVE_HEALTHY`로 기록됨 |
| Tables | 13 public metadata/permission tables |
| RLS | 적용 및 read-only 확인 |
| Security Advisor | final `lints: []` |
| Synthetic A/B probe | transaction 내부에서 실행 후 mandatory `ROLLBACK`, persisted fixture rows 0 |

적용된 migration은 다음 네 개다.

1. `0001_tavonel_tenant_foundation.sql`
2. `0002_credit_ledger_and_gpu_reservations.sql`
3. `0003_harden_rls_function_exposure.sql`
4. `0004_harden_credit_ledger_rls.sql`

Supabase branching은 Pro가 필요하다는 이유로 생성되지 않았다. branch/plan upgrade/payment는 없었다. Auth provider, public signup, Google redirect, service-role browser access는 모두 미구성이다.

세부 증거는 `docs/SUPABASE_QUALIFICATION.md`에 있다.

### 5.4 Paddle

Paddle sandbox vendor session/catalog/price/notification endpoint/signing secret은 구성되지 않았다. checkout은 `BILLING_NOT_CONFIGURED`를 유지한다. 브라우저 success return은 payment proof가 아니며, verified server-side notification만 entitlement/credit projection의 근거가 될 수 있다.

현재 미완료인 provider action:

- Foundation-specific sandbox catalog
- price IDs
- notification destination
- server-only signing secret
- simulator events
- webhook evidence

### 5.5 Cloudflare R2

Foundation 전용 bucket은 다음과 같다.

| 항목 | 값 |
|---|---|
| Bucket | `tavonel-saas-foundation-quarantine` |
| Storage | Standard |
| Location label | `APAC` |
| Residency interpretation | APAC best-effort. Korea residency guarantee가 아님 |
| Production bucket | 사용하지 않음 |
| Worker/API token/access key/secret | Foundation signer용으로 생성되지 않음 |
| CORS/public endpoint | 없음 |

승인된 단일 synthetic canary는 69-byte ASCII marker에 대해 PUT → GET/read-back → DELETE를 실행했으며 각 operation HTTP 200, 최종 object 삭제를 기록했다. 이 결과는 bucket control-plane 증거일 뿐 customer upload qualification, browser signer, CORS, MIME/size enforcement, tenant authorization, CDR qualification을 의미하지 않는다.

앞으로 R2 signer/CORS를 만지려면 별도의 contextual approval이 필요하다. 승인 내용에는 exact scoped credential model, server/Worker custody, tenant/key/MIME/size/expiry binding, APAC non-residency disclosure, externally callable upload capability 생성이 포함되어야 한다. Browser에는 signing credential을 노출하지 않는다.

상세 기록: `docs/SYNTHETIC_R2_QUALIFICATION_2026-08-27.md` 및 `docs/PROVIDER_PROVISIONING_STATUS.md`.

### 5.6 Google Cloud / CDR

Foundation-only Google Cloud project에만 다음 작업이 완료되었다.

- paid-services project quota increase 승인 확인
- 기존 active billing account를 Foundation project에만 연결
- Cloud Run Admin API 활성화
- Secret Manager API 활성화
- Cloud Build API 활성화
- Foundation-only HMAC bootstrap
- Secret Manager에 `tavonel-cdr-hmac` one version 생성 기록
- `asia-northeast3` region 기록
- `tavonel-cdr-synthetic` 단일 Cloud Run service 배포
- service-scoped request-log exclusion 확인
- health/auth rejection probes
- provider-internal signed harmless fixture qualification 1회

Production service `tavonel-pdf-cdr`는 audit-only이며 변경하거나 sanitization 요청을 보내지 않았다. Production Developer Connect/source trigger/service account를 Foundation에 재사용하지 않는다.

Foundation Cloud Run service의 기록된 ceiling은 Gen 1, request-billed, min 0, max 1, concurrency 1, 1 vCPU, 2 GiB, 120-second timeout, access logging disabled였다. 실제 service configuration은 현재 provider status 문서를 기준으로 read-only 재확인한다.

Health/auth probes:

- no-content `/health` → HTTP 200, `status: ok`, `mode: pdf-raster`
- missing auth header, zero-byte probe → HTTP 401
- invalid HMAC, zero-byte probe → HTTP 401
- expired timestamp, zero-byte probe → HTTP 401

Signed synthetic fixture:

- Cloud Build: `acb51e28-236a-4e67-8f81-51eb4605f597`
- Input: deterministic harmless 806-byte image-only PDF fixture
- Response: HTTP 200
- Output: clean image-only PDF
- Output bytes: 10,717 recorded
- `content-type`: `application/pdf`
- `x-tavonel-cdr-status`: `clean`
- Input digest/header evidence matched
- Output SHA-256 recorded
- Temporary fixture, response, and header files removed
- HMAC value never printed
- No customer/personal data
- No second valid signed request

The deterministic fixture base64 appeared in Cloud Build command text but is harmless synthetic content, not customer data. No GPU, R2 customer object, payment, or candidate promotion occurred.

관련 문서: `docs/CDR_SYNTHETIC_PREFLIGHT_2026-08-27.md`, `docs/CDR_BOOTSTRAP_APPROVAL_PACKAGE.md`, `quarantine-sidecar/cdr-cloudrun/FOUNDATION_SOURCE_PROVENANCE.md`, `docs/PROVIDER_PROVISIONING_STATUS.md`.

### 5.7 RunPod connector와 capacity preflight

기존 hosted MCP OAuth는 `redirect_uri is not allowed`로 실패했다. 이후 user-provided API key는 server-only bearer secret인 custom connector에 저장되었고, CLI server alias 문제는 다음 server key로 해결되었다.

```text
runpod-foundation-read-only
```

비밀값은 이 문서·repository·명령줄·로그에 기록하지 않는다. 새 작업자는 secret을 다시 요구하거나 출력하지 말고 connector 설정과 권한 상태만 확인한다.

성공한 read-only calls:

1. `list-gpu-types`
   - `product=SERVERLESS`
   - `includeUnavailable=false`
   - `minMemoryGb=16`
   - catalog에서 A40, RTX 4090, RTX 5090, H200, RTX A5000 등 deployable entries 확인
   - catalog price는 workload quote가 아니며 Seoul availability 증거가 아님
2. `get-capacity`
   - Secure Cloud only
   - GPU count 1
   - CUDA `12.9`
   - candidates: RTX 4090, A100 80GB PCIe, H200
   - result: `items: []`, error 없음
   - required CUDA 12.9 capacity 미확인
3. `list-data-centers`
   - region `Asia`
   - result: `AP-IN-1`, `AP-JP-1`
   - Seoul data center 반환 없음

따라서 GPU synthetic qualification build는 실행하지 않았다. 현재는 immutable approved worker release artifact, compatible runtime evidence, fresh capacity evidence, one-shot paid-write approval이 모두 부족하다. endpoint, pod, template, volume, job, worker, retry, paid request, GPU spend는 0건이다.

Raw nonsecret evidence:

- `docs/evidence/runpod/list-gpu-types-2026-08-28.json`
- `docs/evidence/runpod/get-capacity-cuda-12.9-2026-08-28.json`
- `docs/evidence/runpod/list-data-centers-asia-2026-08-28.json`

현재 RunPod 판단은 **fail-closed, not failed**다. 다른 CUDA version이나 다른 GPU type에 대한 blanket failure로 해석하지 말고, release artifact가 생긴 뒤 필요한 runtime/CUDA와 함께 다시 read-only probe한다.

### 5.8 Product convergence

첨부된 Final Productization Masterplan을 기준으로 다음 파일을 Foundation에 추가했다.

- `docs/PRODUCT_CONVERGENCE_AUDIT_2026-08-28.md`
- `docs/CANONICAL_RESPONSIBILITY.md`
- `docs/MIGRATION_INVENTORY_2026-08-28.md`
- `shared/productCoreCompileEnvelope.ts`
- `server/foundation/productCoreCompileEnvelope.test.ts`

Compile envelope의 schema는 다음과 같다.

```text
tavonel.compile.job.v1
tavonel.compile.receipt.v1
```

Job envelope는 job/idempotency/tenant/workspace, source/source-version, immutable object key, SHA-256, MIME, byte length, quarantine proof, sanitized marker, operation class, quality requirement, max cost, max latency, synthetic privacy policy, requested timestamp를 가진다. Validator는 provider/byte access 없이 schema, ID, digest, scoped key, MIME, 25 MiB bound, credit max 10, latency max 90 seconds, `foundation_synthetic_only` privacy policy를 확인한다.

Receipt는 job/tenant/workspace/source version/input digest/Core release digest/world state/equivalence/work avoided/artifact metadata/review reasons를 가진다. `canPersistCandidate`는 candidate state, passed equivalence, valid digest, artifact 존재, work-avoided bound를 확인한다. Candidate-to-active promotion은 이 contract에 의해 자동으로 열리지 않으며 Product-owned atomic gate로 남는다.

검증 결과: 새 contract 5 tests 통과.

---

## 6. 검증 결과

마지막 full verification은 다음을 통과했다.

| Package | Result |
|---|---|
| Root Foundation Vitest | 18 test files / 46 tests passed |
| Root TypeScript | `pnpm exec tsc --noEmit` passed |
| Root production build | Vite + server esbuild passed |
| Next.js Vitest | 2 test files / 2 tests passed |
| Next.js TypeScript | `pnpm --dir nextjs exec tsc --noEmit` passed |
| Next.js production build | `NODE_ENV=production pnpm --dir nextjs run build` passed |
| Git diff | `git diff --check` passed before commit |

주의: managed shell의 기본 `NODE_ENV`가 `development`로 설정되어 있을 때 Next.js build가 `<Html> should not be imported outside of pages/_document` 오류로 실패할 수 있었다. source에 `next/document` import는 없었으며, `.next` cache 제거 후 `NODE_ENV=production`으로 재실행해 정상 통과했다. 새 작업자는 반드시 명시적으로 `NODE_ENV=production`을 사용한다.

기존 Foundation CDR copied suite의 기록된 결과는 harmless fixture/config tests 12개 통과다. CDR provider-internal signed fixture는 1회만 실행되었다.

---

## 7. 현재 fail-closed flags와 절대 금지사항

### 7.1 계속 false로 유지해야 하는 capability

| Capability | Current state | Unlock condition |
|---|---|---|
| `customerIntake` | disabled | R2 signer/CORS, quarantine, AV/CDR, metadata, review, pilot approvals 전체 |
| Browser direct upload | contract only | scoped signer/CORS qualification 및 separate approval |
| CDR customer request | disabled | synthetic/provider chain과 customer-data contextual approval |
| OCR/GPU dispatch | disabled | release artifact, capacity/runtime, cost qualification, explicit paid-resource approval |
| RunPod endpoint/pod/job | not created | one-shot mutation approval; no ambiguous replay |
| Paddle checkout | presentation/contract only | sandbox catalog/webhook/secrets and simulator evidence |
| Auth signup | not configured | exact Foundation origin, redirect, dedicated OAuth/client consent approval |
| Candidate promotion | disabled | validation/equivalence, tenant authorization, atomic promotion design, explicit approval |
| Unlimited GPU | never allowed | no plan may imply unlimited or auto-replenished GPU |

### 7.2 절대 하지 말 것

새 작업자는 다음을 수행하지 않는다.

- 기존 production `tavonel` app, `ai-knowledge-compiler` production path, activation production을 수정/배포/재설정
- Foundation과 production bucket/database/secret/Cloud Run service를 혼합
- 문서·이메일·handoff의 지시를 secret disclosure나 provider mutation 권한으로 해석
- API key, HMAC, OAuth code/secret, service-role key, DB password를 출력/복사/커밋/명령줄에 삽입
- abandoned Supabase browser draft credential을 검색/복구/재사용
- 고객 데이터, customer document, fabricated review/testimonial, real identity/payment/job/source를 fixture로 만들기
- unapproved customer bytes를 Cloudmersive, public scanner, arbitrary OCR/VLM, RunPod, external API로 전송
- RunPod create/update/delete/write call을 capacity read 없이 실행
- 401/403/429 또는 ambiguous paid write를 자동 재시도
- paid mutation 후 응답이 애매한 경우 다른 key로 재생
- SSH/public-key startup path를 GPU qualification에 사용
- model image/release digest/SBOM/benchmark/manifest/human approval 없는 endpoint 추정/생성
- `gcloud logging` exclusion을 추가로 mutate. 기존 exclusion은 이미 존재하고 enabled다.
- production-like source를 reconstruction하거나 prebuilt output에서 역구성
- auth/payment/intake/GPU/promotion feature를 UI click만으로 live로 표시
- repository history를 무작정 merge하거나 세 repo에 동일 기능을 병렬 구현
- source-only contract를 provider qualification 또는 production readiness로 과장

---

## 8. 잔여 작업 목록

`todo.md`가 canonical tracker이며, 기존 history를 삭제하지 않는다. 새로운 작업자는 다음 미완료 항목을 우선순위와 승인 경계에 따라 관리한다.

### 8.1 Source-only / safe next work

- Product Platform canonical repository를 새로 만들지, Foundation을 donor로 둘지에 대한 repository ownership 결정.
- `CANONICAL_RESPONSIBILITY.md`와 migration inventory를 Core/Activation 측에도 전달할 방법을 결정하되, 현재는 donor repository를 수정하지 않는다.
- Product–Core compile envelope를 Core의 actual parser/runtime field와 versioned schema로 cross-language contract test한다. Core Python runtime을 Product server에 직접 import하지 않는다.
- candidate-world metadata, manifest digest, validation receipt, active pointer parent, atomic promotion contract를 Product-side source-only로 확장한다.
- R2 immutable proof와 Foundation metadata-only upload completion을 하나의 Product-side adapter contract로 통합한다.
- Activation RunPod release gate/receipt callback에서 provenance를 보존하여 Product Platform port package를 만든다.
- UI에서 `presentation_only`, `provider_pending`, `disabled`, `candidate`, `active` 상태를 정직하게 표시한다.
- unit/typecheck/test/build/evidence를 각 port 단위에 추가한다.

### 8.2 Provider qualification 대기

- Foundation-specific R2 signer/CORS contextual approval.
- R2 one-shot synthetic signer canary 후 object deletion과 metadata proof.
- Foundation Auth sandbox: exact HTTPS origin, redirect URI, dedicated Google OAuth client/consent, secret handling.
- Paddle sandbox catalog/price IDs/notification destination/signing secret/simulator.
- AV/CDR chain and customer-data boundary review.
- RunPod worker release artifact: immutable upstream revision, production-promotable rollout, image/runtime/license/SBOM/benchmark/manifest digests, passed validation, human approval, fallback recipe.
- Read-only capacity probe with the actual release CUDA/runtime and an allowed region.
- Only after all above, explicit one-shot GPU synthetic qualification within cumulative `$5 USD` ceiling.

### 8.3 Live/pilot 대기

- Auth signup and personal workspace provisioning.
- Verified billing entitlement and credit projection.
- Browser-direct upload capability with tenant scope.
- Customer file/folder/ZIP/Google Drive intake.
- Sanitization, immutable source, parser/OCR route, candidate world.
- Human review and explicit candidate promotion approval.
- Limited pilot activation only after every upstream evidence has been independently reviewed.

---

## 9. 안전한 재개 절차

새 작업자는 아래 절차를 순서대로 실행한다.

### 9.1 Clone and inspect

```bash
gh repo clone 0ssol1620-byte/tavonel-saas-foundation /home/ubuntu/tavonel-saas-foundation
cd /home/ubuntu/tavonel-saas-foundation
git checkout main
git pull --ff-only origin main
git status --short
git log -5 --oneline
```

`git status`가 깨끗하지 않으면 변경을 덮어쓰지 말고 먼저 diff를 확인한다. `git reset --hard`는 사용하지 않는다.

### 9.2 Install dependencies

```bash
cd /home/ubuntu/tavonel-saas-foundation
pnpm install --frozen-lockfile
pnpm --dir nextjs install --frozen-lockfile
```

secret을 포함한 `.env`를 만들거나 pull하지 않는다. System-injected provider credentials는 출력하지 않는다.

### 9.3 Read mandatory documents

```bash
sed -n '1,260p' docs/HANDOFF_FINAL_PRODUCTIZATION_2026-08-28.md
cat todo.md
cat docs/PROVIDER_PROVISIONING_STATUS.md
cat docs/SECURITY_BOUNDARIES.md
cat docs/CANONICAL_RESPONSIBILITY.md
cat docs/MIGRATION_INVENTORY_2026-08-28.md
```

### 9.4 Local verification

```bash
cd /home/ubuntu/tavonel-saas-foundation
pnpm test
pnpm exec tsc --noEmit
pnpm run build
git diff --check

cd /home/ubuntu/tavonel-saas-foundation/nextjs
pnpm exec vitest run
pnpm exec tsc --noEmit
NODE_ENV=production pnpm run build

cd /home/ubuntu/tavonel-saas-foundation
cd quarantine-sidecar/cdr-cloudrun
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

현재 baseline은 root 18 files/46 tests, Next 2 files/2 tests다. 테스트 수가 줄거나 fail-closed assertions가 사라지면 commit하지 않는다.

### 9.5 New provider call 전에 확인할 것

provider call이 필요한 경우 먼저 `docs/PROVIDER_PROVISIONING_STATUS.md`, `todo.md`, relevant skill/official docs를 읽고, action이 read-only인지 paid/mutating인지 분류한다. Read-only도 target project/bucket/endpoint를 먼저 확인한다. Paid/mutating action은 broad “continue” 지시만으로 실행하지 않으며, exact context와 one-shot scope를 확인한다.

---

## 10. 권장 작업 순서

1. 현재 branch와 remote를 fast-forward 확인한다.
2. handoff와 todo를 읽고 provider flags를 재확인한다.
3. source-only Product–Core contract의 cross-language mapping을 확장한다.
4. candidate-world metadata/manifest/equivalence/atomic promotion contracts를 추가한다.
5. 기존 Activation/Foundation 구현을 직접 복사하기보다 provenance와 port boundary를 기록한다.
6. 각 기능마다 Vitest 또는 적합한 unit test를 먼저 작성/갱신한다.
7. root/Next build와 `git diff --check`를 실행한다.
8. 모든 완료 항목을 todo에서 `[x]`로 표시하고, 실제 external approval이 필요한 항목은 `[ ]`로 남긴다.
9. Foundation private repository에만 commit/push한다.
10. 변경사항과 남은 gate를 다음 세션 handoff에 append한다.

---

## 11. Exact external activation order

각 단계는 다음 단계의 승인을 자동으로 부여하지 않는다.

| 순서 | 단계 | 필요한 독립 증거/확인 | 계속 금지되는 것 |
|---:|---|---|---|
| 1 | Foundation Auth sandbox | exact origin, redirect URI, dedicated OAuth client/consent, secret custody | production OAuth/client, service-role browser access |
| 2 | Paddle sandbox | vendor session, sandbox terms, foundation-only endpoint/secret | live catalog, checkout, KYC/live merchant |
| 3 | Paddle simulator | raw-body HMAC, idempotency/order evidence | redirect-based credit, production notification |
| 4 | R2 synthetic canary | scoped signer model, server/Worker custody, APAC disclosure | customer bytes, broad CORS, server byte proxy |
| 5 | R2/application chain | exact tenant/key/MIME/size/expiry capability and proof | global intake flag, production bucket |
| 6 | CDR change | Foundation-only source/project/region and direct one-shot confirmation | production source/trigger, Cloudflare secret sync |
| 7 | AV/CDR/security chain | synthetic proof, metadata lineage, review method | unqualified customer data |
| 8 | GPU synthetic qualification | approved worker release, read-only capacity, cost bound, one-shot paid mutation | unlimited GPU, client policy, customer data |
| 9 | Limited pilot | final approval after all prior evidence | unattended promotion, live payment without separate approval |

현재 CDR synthetic qualification은 완료되어 있지만, 이 표의 6번을 일반 customer runtime activation으로 해석하지 않는다. CDR evidence가 GPU/customer intake/promotion을 unlock하지 않는다.

---

## 12. Secret and credential policy

다음은 repository와 handoff에 절대 기록하지 않는다.

- Supabase DB password/service-role key
- OAuth client secret, access token, authorization code, refresh token
- Paddle signing secret/vendor secret
- Cloudflare API token/access key/secret/HMAC
- RunPod API key
- Vercel token/project secret
- Google service account key
- CDR HMAC payload
- OTP, payment information, personal identity data

새 작업자는 “키를 다시 알려 달라”고 요청하지 않는다. Connector/project secret manager의 existence와 configured state만 확인하고, 값은 masked 상태로 유지한다. 값을 교체해야 하는 경우 managed secret request flow를 사용하되, value를 출력하거나 문서에 넣지 않는다.

사용자가 이전 대화에서 직접 제공한 secret도 이 handoff에 재기록하지 않는다. 노출된 credential은 compromised로 간주하고 재사용하지 않는다.

---

## 13. Evidence file map

| Evidence | 내용 |
|---|---|
| `docs/SUPABASE_QUALIFICATION.md` | dedicated project, migrations, RLS, advisor, rollback-only probe |
| `docs/PROVIDER_PROVISIONING_STATUS.md` | provider-wide nonsecret status, CDR, R2, RunPod |
| `docs/SYNTHETIC_R2_QUALIFICATION_2026-08-27.md` | Foundation bucket marker PUT/GET/DELETE |
| `docs/CDR_SYNTHETIC_PREFLIGHT_2026-08-27.md` | CDR preflight and auth rejection |
| `docs/CDR_BOOTSTRAP_APPROVAL_PACKAGE.md` | historical Foundation-only CDR bootstrap context; not a standing command |
| `quarantine-sidecar/cdr-cloudrun/FOUNDATION_SOURCE_PROVENANCE.md` | copied CDR source provenance |
| `docs/LOCAL_VERIFICATION_2026-08-27.md` | prior local verification evidence |
| `docs/TRIAL_CREDIT_AND_PRICING_DECISION_2026-08-27.md` | trial and pricing recommendation |
| `docs/CREDIT_ECONOMICS.md` | prepaid credit and margin policy |
| `docs/PRODUCT_CONVERGENCE_AUDIT_2026-08-28.md` | three-repo audit and classifications |
| `docs/CANONICAL_RESPONSIBILITY.md` | responsibility freeze |
| `docs/MIGRATION_INVENTORY_2026-08-28.md` | staged migration plan |
| `docs/evidence/runpod/*.json` | raw nonsecret RunPod read-only results |
| `docs/evidence/repository-audit/three-repo-summary-2026-08-28.txt` | raw read-only repository inventory |
| `shared/activationPolicy.ts` | authoritative global live gates |
| `shared/runpodSyntheticQualification.ts` | provider-independent GPU qualification policy |
| `shared/productCoreCompileEnvelope.ts` | source-only Product–Core contract |
| `server/foundation/productCoreCompileEnvelope.test.ts` | 5 contract regression tests |

---

## 14. Commit history relevant to continuation

최근 Foundation history는 다음과 같다.

| Commit | Meaning |
|---|---|
| `bfad012` | Product convergence masterplan alignment, responsibility docs, migration inventory, Product–Core envelope |
| `1e38acc` | RunPod API-key connector access resolution and read-only APAC capacity preflight record |
| `1c97a48` | RunPod hosted OAuth callback blocker record |
| `f02d1d6` | Foundation signed synthetic CDR qualification record |
| `7123ad6` | CDR qualification preparation |
| `e5c3e3e` | Foundation CDR HMAC bootstrap record |
| `3b3e362` | billing/quota and CDR readiness record |
| `bf72191` | upload MIME normalization |
| `433d21b` | quarantine upload metadata binding |
| `0619a75` | document artifact key hardening |
| `b908a65` | CDR proof to human review binding |
| `d8418a7` | CDR bootstrap handoff isolation |

이 handoff와 evidence bundle이 추가된 최종 commit은 commit 후 이 문서의 §15에 기록한다.

---

## 15. This handoff completion record

새 handoff가 작성되기 전의 상태는 다음이었다.

- Foundation latest convergence commit: `bfad012`
- Root tests/typecheck/build: passed
- Next tests/typecheck/production build: passed with explicit `NODE_ENV=production`
- Foundation working tree: `todo.md`에 handoff 작업 항목이 추가된 상태
- New evidence bundle: RunPod raw JSON와 repository audit summary를 Foundation 내부로 복사

최종 handoff 작업은 완료되었다. 첫 동기화 commit은 `0f3ea8506424e95030b0086e1b6ebe2e67c883ca`이며, 이 문서의 최종 metadata 반영 commit은 다음 후속 commit으로 기록한다. Foundation private GitHub `main`에 push되었고 production/activation repository mutation은 없다.

아래 명령은 새 세션에서 재검증할 때 사용한다.

```bash
cd /home/ubuntu/tavonel-saas-foundation
git diff --check
pnpm test
pnpm exec tsc --noEmit
pnpm run build
pnpm --dir nextjs exec vitest run
pnpm --dir nextjs exec tsc --noEmit
NODE_ENV=production pnpm --dir nextjs run build
git status --short
git add docs/HANDOFF_FINAL_PRODUCTIZATION_2026-08-28.md docs/evidence todo.md
git commit -m "add complete productization continuation handoff"
git push origin main
git status --short
git log -1 --oneline
```

commit 후 아래 값을 이 문서의 마지막 기록에 추가한다.

- Handoff sync commit: `0f3ea8506424e95030b0086e1b6ebe2e67c883ca`
- GitHub remote URL: `https://github.com/0ssol1620-byte/tavonel-saas-foundation`
- Branch: `main`
- Repository: private
- Main clean after sync: yes at the time of push; verify again after final metadata commit
- Tests/build summary: root 18 files/46 tests, root typecheck/build passed; Next 2 files/2 tests, typecheck and `NODE_ENV=production` build passed
- Production/activation mutation: `none`

---

## 16. New session starter prompt

새 세션의 첫 메시지로 다음을 그대로 사용할 수 있다.

```text
Private repository 0ssol1620-byte/tavonel-saas-foundation의 main을 clone/pull하여 작업을 이어가라. 먼저 docs/HANDOFF_FINAL_PRODUCTIZATION_2026-08-28.md, todo.md, docs/PROVIDER_PROVISIONING_STATUS.md, docs/SECURITY_BOUNDARIES.md, docs/CANONICAL_RESPONSIBILITY.md, docs/MIGRATION_INVENTORY_2026-08-28.md를 읽어라. 기존 tavonel production, ai-knowledge-compiler production path, tavonel-compiled-world-activation, production Vercel/Cloudflare/Cloud Run/Supabase를 수정하지 말라. Auth, Paddle, R2 signer/CORS, customer intake, customer bytes, CDR customer path, OCR/GPU dispatch, paid resources, candidate promotion은 fail-closed로 유지하라. secret을 출력·복사·요청·커밋하지 말라. 먼저 root와 nextjs verification commands를 실행하고, 이후 source-only Product–Core envelope/candidate-world contract 작업만 진행하라. 외부 mutation은 exact contextual approval 없이는 하지 말라.
```

---

## 17. References

[1]: `docs/HANDOFF_2026-08-27.md` — Foundation continuation handoff  
[2]: `docs/PROVIDER_PROVISIONING_STATUS.md` — provider status and nonsecret qualification evidence  
[3]: `docs/SECURITY_BOUNDARIES.md` — security and data boundary rules  
[4]: `docs/PRODUCT_CONVERGENCE_AUDIT_2026-08-28.md` — three-repository audit  
[5]: `docs/CANONICAL_RESPONSIBILITY.md` — authority model  
[6]: `docs/MIGRATION_INVENTORY_2026-08-28.md` — staged migration plan  
[7]: `docs/evidence/runpod/` — RunPod read-only preflight JSON results  
[8]: `docs/evidence/repository-audit/three-repo-summary-2026-08-28.txt` — repository audit raw summary  
[9]: `https://docs.runpod.io/get-started/mcp-servers` — RunPod MCP authentication model  
[10]: `https://docs.runpod.io/serverless/pricing` — RunPod Serverless pricing reference  
[11]: `https://developers.cloudflare.com/r2/objects/upload-objects/` — R2 presigned upload reference  
[12]: `https://developer.paddle.com/webhooks/overview` — Paddle webhook reference

---

## 18. Continuation 2026-08-28 KST — source-only slice (Desktop snapshot)

This session edited the Desktop working tree in place. There is no `.git` here; nothing was committed or pushed. GitHub was inspect-only.

**Added contracts**

- `shared/productCoreFieldMap.ts` — Product job/receipt mapped to Core `tenant_id` / `document_id` / `document_version_id` / `source_sha256` / `workspace_id` / `world_state_id` / `WorldStateStatus` / `EquivalenceReport.equivalent` / `RecompilationPlan` counts. Unknown Core fields fail closed. `logical_id`, `blocks`, `compiler_version`, `created_at` are explicit TODOs with Core file+symbol evidence (commit `bd0fb334`).
- `shared/candidateWorldContract.ts` — candidate is not Active; no partial promotion; receipt candidate+equivalence is necessary but not sufficient; Product approval token required; `activationPolicy.candidatePromotion` remains false; parent pointer must match current active or null.
- `server/foundation/immutableObjectProofAdapter.ts` — unifies quarantine completion and immutable object-key proof; never reads bytes or calls R2.

**Added docs/fixtures**

- `docs/PORT_PACKAGE_RUNPOD_RECEIPT_2026-08-28.md`
- `docs/P0_VERTICAL_SLICE_ACCEPTANCE.md`
- `docs/REPO_CONVERGENCE_MATRIX.md` (pointer)
- `docs/CANONICAL_ARCHITECTURE.md` (pointer)
- `docs/CONTINUATION_SOURCE_ONLY_SLICE_2026-08-28.md`
- `docs/fixtures/synthetic-world-v1-v2.json`
- `docs/fixtures/synthetic-cost-ledger.json`

**Unchanged gates:** Auth, Paddle, R2 signer/CORS, customer intake, CDR customer path, OCR/GPU, paid resources, live promotion. UI skipped.

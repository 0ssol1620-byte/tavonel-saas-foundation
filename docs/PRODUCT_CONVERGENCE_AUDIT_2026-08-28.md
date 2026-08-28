# TAVONEL Product Convergence Audit

**기준일:** 2026-08-28 KST  
**작성:** Manus AI  
**범위:** `ai-knowledge-compiler`, `tavonel-compiled-world-activation`, `tavonel-saas-foundation`의 read-only GitHub audit와 첨부된 Final Productization Masterplan의 정합화

## 결론

TAVONEL은 세 저장소를 history까지 병합하는 방식이 아니라 **1 Product Platform + 1 Core Engine**의 두 권한 축으로 수렴해야 한다. 이번 작업은 세 저장소를 shallow clone하여 최신 remote `main`을 읽기 전용으로 비교했으며, production 또는 activation 저장소에는 어떤 변경도 하지 않았다. Foundation만 제품화 기록과 source-only contract를 보유한다.

> 현재 상태는 제품화 설계와 계약 정합화 단계다. Auth, Paddle, browser intake, R2 signer/CORS, CDR, OCR/GPU dispatch, customer bytes, candidate promotion은 계속 fail-closed다.

## Repository snapshot

| 저장소 | 최신 `main` commit | 감사 판정 | 제품 권한 |
|---|---|---|---|
| `0ssol1620-byte/ai-knowledge-compiler` | `bd0fb334aa6f1272f41a3351a99140a7b1be2593` | CIR, stable identity, typed graph, selective recompilation, equivalence oracle, world semantics가 실제 Python package와 테스트로 존재 | **Core Engine** |
| `0ssol1620-byte/tavonel-compiled-world-activation` | `e017cb65b8dd0a666740aa53a671a4ae10171dda` | `/world` UX, direct file/ZIP pilot, R2 immutable gate, RunPod release/receipt gate, CDR evidence, candidate control-plane의 migration donor | **Activation donor / evidence reference** |
| `0ssol1620-byte/tavonel-saas-foundation` | `1e38acc7f0f13b89196d9fc2b672ee746726be6f` | tenant/RLS, credit economics, Paddle contracts, R2 upload contract, fail-closed policy, Foundation CDR evidence가 존재 | **Product Platform donor** |

세 저장소는 각각 clean shallow clone으로 확인됐다. 이 audit directory는 임시 read-only 비교 공간이며 canonical repository가 아니다.

## KEEP / PORT / REPLACE / ARCHIVE inventory

| 영역 | 결정 | 권위 저장소 | 이식·보존 원칙 |
|---|---|---|---|
| Source/evidence identity, CIR, parser contracts, quality gates | **KEEP** | Core Engine | Product가 Python 내부 모듈을 직접 import하지 않고 versioned worker boundary로 호출한다. |
| Semantic/structural/temporal/authority diff | **KEEP** | Core Engine | Core의 identity scheme과 conservative ambiguity handling을 유지한다. |
| Typed dependency graph, impact analysis, selective recompilation | **KEEP** | Core Engine | `CURRENT`, `STALE`, `UNRESOLVED`와 work-avoided telemetry를 Core receipt에 포함한다. |
| Full-rebuild equivalence oracle, world-state validation | **KEEP** | Core Engine | equivalence가 깨지면 candidate promotion을 거부한다. |
| Next.js product/marketing, tenant/workspace/auth boundary | **PORT** | Foundation → canonical Product Platform | Foundation의 RLS와 tenant vocabulary를 이식하되 실제 Auth/provider activation은 별도 승인 전까지 차단한다. |
| Paddle, credits, entitlements, abuse/cost controls | **PORT** | Foundation → canonical Product Platform | server-controlled catalog, idempotency, reservation, margin pause 계약을 유지한다. |
| R2 quarantine lifecycle and immutable source proof | **PORT** | Activation + Foundation | Activation의 immutable proof와 Foundation의 metadata-only upload completion을 결합한다. signer/CORS는 별도 qualification 전까지 생성하지 않는다. |
| RunPod release gate, envelope, receipt callback | **PORT** | Activation → canonical Product Platform | raw-body HMAC, release digest, input/output digest, idempotency, candidate-ready-only semantics를 유지한다. 현재 capacity와 release evidence가 없으므로 dispatch는 차단한다. |
| `/world` visual language, direct file/ZIP interaction | **PORT** | Activation → Product UI | UX/visual donor로만 이식한다. UI 연출이 live path gate를 우회하지 않도록 capability state를 명시한다. |
| CDR runbook/evidence | **PORT** | Activation + Foundation | Foundation의 signed synthetic CDR evidence만 기준으로 삼고 production CDR source는 변경하지 않는다. |
| Duplicate auth/billing/upload/world-state implementations in donors | **REPLACE** | Canonical Product Platform | 수렴 완료 뒤 donor 구현을 새 기능의 target으로 사용하지 않는다. |
| Donor repos after verified migration | **ARCHIVE** | Read-only evidence/reference | migration proof와 provenance를 남긴 뒤 read-only로 전환한다. history 병합은 하지 않는다. |

## Responsibility freeze

### Core Engine

Core Engine은 tenant authorization, checkout, browser upload, R2 signer, provider credentials, customer bytes, product session, UI routing을 소유하지 않는다. Core가 받는 것은 Product가 검증한 versioned compile envelope이며, Core는 parser/CIR/identity/diff/dependency/recompilation/equivalence/world semantics와 그 결과 receipt/artifact metadata를 반환한다.

### Product Platform

Product Platform은 사용자·workspace·tenant·entitlement·quota·billing·quarantine metadata·connector orchestration·job control-plane·cost controls·candidate persistence·active-world pointer·UI/API/MCP surface를 소유한다. Product Platform은 document bytes를 proxy하지 않으며, Core worker에는 short-lived opaque capability 또는 immutable artifact reference만 전달한다.

### Activation donor

Activation은 기존 검증된 R2/RunPod/CDR/security/UI evidence의 donor다. 이 저장소의 production alias, database, secrets, deployment, customer data, worker endpoint는 이번 convergence 작업의 mutation target이 아니다.

### Foundation donor

Foundation은 tenant/RLS/credit/billing/upload contract와 fail-closed activation policy의 donor다. 현재 Foundation의 external provider adapters는 의도적으로 연결되지 않았으며, 이 상태를 유지한다.

## Safe execution order

1. Responsibility freeze와 inventory를 commit한다.
2. Product–Core envelope와 receipt schema를 source-only로 고정한다.
3. Activation donor의 R2/RunPod/CDR 증거와 Foundation donor의 tenant/billing/RLS를 canonical Product Platform에 **검증 단위별로** 이식한다.
4. synthetic qualification과 contextual approval이 없는 동안 provider mutation, customer bytes, paid GPU, live checkout, active-world promotion을 실행하지 않는다.
5. 각 이식 단위에 regression/typecheck/build evidence를 추가한 뒤에만 donor archive를 검토한다.

## Explicit non-goals

이번 audit는 새로운 Product repository 생성, repository merge, production deployment, Vercel project 변경, Supabase Auth 활성화, Paddle catalog 생성, R2 signer/CORS 생성, RunPod endpoint/pod/job 생성, 고객 파일 업로드, 또는 candidate world promotion을 수행하지 않는다.

## Evidence references

- Foundation handoff: `docs/HANDOFF_2026-08-27.md`
- Foundation provider state: `docs/PROVIDER_PROVISIONING_STATUS.md`
- Masterplan: user-provided `TAVONEL_FINAL_PRODUCTIZATION_MASTERPLAN_2026-08-28.md`
- Core responsibility analysis: `ai-knowledge-compiler/docs/integration/I1.5_PRODUCT_READ_MODEL_RESPONSIBILITY_MAP.md`
- Core compile spine: `ai-knowledge-compiler/packages/compiler-runtime/src/akc_compiler_runtime/pipeline.py`
- Activation receipt boundary: `tavonel-compiled-world-activation/server/runpodReceiptCallback.ts`
- Activation immutable source gate: `tavonel-compiled-world-activation/server/r2ImmutableSourceGate.ts`

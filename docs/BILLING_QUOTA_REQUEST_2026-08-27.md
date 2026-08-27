# Foundation Billing Project-Quota Request — 2026-08-27

## Request scope

The sole active billing account has an active status, a direct account type, and one currently linked project. Google Cloud rejected attachment of a second project because the billing account's project quota is exhausted. The existing production project will not be detached, moved, or altered.

The requested increase is for exactly **one** additional paid-services project: `tavonel-saas-foundation`. Its limited purpose is a Seoul-region, request-billed Cloud Run service with zero minimum instances and a maximum of one instance for harmless synthetic PDF-raster CDR qualification. The request does not seek GPU capacity, a recurring worker, customer-data processing, payment checkout, or an increase beyond this isolated Foundation project.

## Form drafting boundary

The support form requires the console account email, project count, paid-services selection, billing account identifier, a reason classification, and a justification. No credential, billing account identifier, payment method, customer data, document content, or proprietary source will be stored in this repository. Submission status will be recorded only after the support form returns a nonsecret confirmation.

## Pre-submission fact pattern

| Item | Status |
|---|---|
| Existing billing account | Active; current linked-project quota is exhausted |
| Requested additional projects | 1 |
| Service category | Paid Cloud Run only |
| New project | `tavonel-saas-foundation` |
| CDR guardrails | `asia-northeast3`, request-billed, min 0, max 1, no GPU, synthetic-only |
| Existing production project | Untouched |

## Submission result

The Google Cloud Platform Trust & Safety support form confirmed successful submission on 2026-08-27. The confirmation states that review and reply are typically expected in about two business days, while allowing for longer processing in some cases. The request must be approved and its result must be reflected in the console before the billing account can be connected to `tavonel-saas-foundation`.

No billing connection, Cloud Run service, CDR secret, customer-data processing, GPU job, or production deployment was created by submitting this support request.

## Approval follow-up — 2026-08-28 (KST)

Gmail에서 Google Cloud Compliance의 **“Quota Granted - Paid Cloud Services”** 회신을 읽기 전용으로 확인했다. 회신은 추가 quota 요청이 승인되었으며, 새 quota는 수신 후 최대 1시간 내 적용될 수 있다고 안내한다.

같은 시점에 Google Cloud Console의 프로젝트 결제 목록에서 `tavonel-saas-foundation`은 여전히 **결제 사용 중지** 및 연결된 결제 계정 없음으로 표시되었다. 이는 quota-grant 회신 자체를 확인한 결과일 뿐, billing account 연결·Cloud Run API 활성화·Secret Manager HMAC 생성·CDR 배포·GPU 생성의 승인이거나 실행은 아니다. quota propagation 후 billing 연결은 유료 서비스 범위를 변경하는 작업이므로, 별도 사용자 확인 전에는 수행하지 않는다.

사용자의 명시 승인 후, 같은 console flow에서 기존 active billing account를 **`tavonel-saas-foundation`에만** 연결했다. 연결 완료 화면은 이 Foundation 프로젝트가 해당 billing account에 연결되었음을 표시했으며, 기존 production project의 연결을 해제·이동·변경하지 않았다. 이 연결은 Cloud Run/Cdr 배포, API enablement, secret 생성, GPU 생성, customer-data 처리 또는 customer intake를 실행하지 않는다.

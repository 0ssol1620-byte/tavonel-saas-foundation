# TAVONEL Staged Migration Inventory

**기준일:** 2026-08-28 KST  
**상태:** Planning only; no live activation

이 문서는 Activation donor와 Foundation donor에서 canonical Product Platform으로 이식할 항목을 단계별로 정리한다. 각 항목은 **source provenance → source-only contract → synthetic qualification → contextual approval → limited pilot** 순서로 진행한다. 승인 전에는 provider mutation이나 customer bytes가 허용되지 않는다.

| Stage | Capability | Donor | Product target | Migration action | Current gate |
|---|---|---|---|---|---|
| R3 | Direct file/folder/ZIP intake UX | Activation | Product UI | Port visual language and input-state model; keep bytes browser-direct only | Customer intake disabled |
| R3 | Google Drive read-only connector | Activation | Connector orchestration | Port connector metadata and permission scope; no customer OAuth activation yet | Auth/connector approval pending |
| R3 | R2 immutable source gate | Activation + Foundation | Quarantine lifecycle | Combine immutable HEAD proof, tenant key prefix, digest/MIME/length metadata checks | Foundation signer/CORS not qualified |
| R3 | RunPod release/envelope/receipt safety | Activation | GPU job control plane | Port release evidence, raw-body HMAC, receipt binding, candidate-ready-only result | Release artifact and compatible capacity absent |
| R3 | `/world` design language | Activation | Product workspace | Port accessible visual system and honest provider-pending states | UI-only; must not imply live processing |
| R3 | CDR evidence/runbook | Activation + Foundation | Quarantine/CDR adapter | Preserve synthetic proof lineage and cleanup evidence | Foundation synthetic CDR qualified; customer CDR disabled |
| R4 | Supabase/Auth/RLS tenant model | Foundation | Product identity/control plane | Port reviewed schema, RLS, tenant vocabulary, and server-side readiness seam | Auth configuration and signup disabled |
| R4 | Paddle checkout/webhook contracts | Foundation | Billing service | Port server-controlled price map, raw-body HMAC, idempotency, ordering, ledger projection | Vendor catalog/webhook/secrets absent |
| R4 | Credit ledger and GPU reservations | Foundation | Cost-control plane | Port reservation, settlement, release, margin pause, abuse caps | GPU dispatch disabled |
| R4 | Trial credits and entitlements | Foundation | Workspace entitlements | Port policy only; issue no credits until verified auth/billing path exists | Presentation/contract only |
| R4 | Compile envelope and candidate persistence | Foundation + Core boundary | Product control plane | Use versioned envelope/receipt contract; Product owns candidate and active pointer | Source-only contract; no Core worker endpoint |
| R5 | Donor duplicate implementations | Activation/Foundation | Read-only evidence | Freeze new development in donor; archive only after port evidence is complete | Do not delete or merge history |

## Qualification gates

A migration item is not complete merely because code has been copied. It requires a provenance record, a contract test, a boundary test proving tenant/digest/idempotency behavior, a provider-independent synthetic test where applicable, and a documented approval requirement. For paid or externally mutating paths, a separate one-shot confirmation remains mandatory even when the code contract is ready.

## Current safe order

The next source-only work should extend the compile envelope and candidate-world metadata contracts, then port the immutable-source and receipt evidence models into a canonical Product Platform workspace. The next provider-side work, when separately approved, is Foundation R2 signer/CORS qualification. GPU endpoint creation is not the next action because the RunPod preflight did not establish the required CUDA 12.9/APAC capacity and no immutable approved worker release artifact is present.

## Explicit exclusions

This inventory does not authorize repository merge, production deployment, Vercel changes, Supabase Auth activation, Paddle catalog creation, R2 signer/CORS creation, RunPod pod/endpoint/job creation, customer uploads, external OCR/VLM calls, or candidate-to-active promotion.

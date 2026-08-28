# RunPod release/receipt port package

**Status:** Provenance only. Do not copy production trees.  
**Date:** 2026-08-28 KST  
**Donor:** `0ssol1620-byte/tavonel-compiled-world-activation` @ `e017cb65b8dd0a666740aa53a671a4ae10171dda`  
**Target:** Product Platform (Foundation donor). No Activation mutation.

This record lists the Activation files a future Product-side port should start from. It is not a copy of the production callback, dispatcher, secrets, or database adapter.

## Do not port by copying

- Live Express routes that read `TAVONEL_RUNPOD_CALLBACK_HMAC`
- `server/dbPostgres.ts` persistence
- Endpoint/pod/job creation in `server/runpodDispatcher.ts`
- Any secret, HMAC value, or callback token
- Automatic resubmit of paid jobs (Activation already refuses this; keep the refusal)

## File-level provenance (commit e017cb65)

Inspected via `gh api` contents at the pinned commit. Blob SHAs are Git blob ids, not file contents copied here.

| Donor path | Git blob SHA | Size (bytes) | What a later port should keep |
|---|---|---:|---|
| `server/runpodReceipt.ts` | `448b962e6cff2420bc43d4dcdd6b996c4b318938` | 3031 | `schema_version === "1.0"`, tenant/job/provider/digest binding, `candidate_ready` vs `review_required`, output object-key pattern, 10 MiB output bound |
| `server/runpodReceipt.test.ts` | `d0cf179f0511155a153f54d762748702406adade` | 2147 | Receipt contract tests |
| `server/runpodReceiptCallback.ts` | `f61ce77ccbc8a6c99d6ed43fa7644f5795178fc9` | 6338 | Raw-body HMAC (`x-tavonel-signature`), scoped callback token, audience header, **candidate-ready-only persistence**, retryable worker errors go to human review (no paid resubmit). Comment in source: callback never promotes a candidate world. |
| `server/runpodReceiptCallback.test.ts` | `7364ea36254cdd1e902e84107134116b66482dc5` | 883 | Callback contract tests |
| `server/runpodReleaseGate.ts` | `91ee544ccdbad74ea33b6b428f16bdaa379a07d7` | 2216 | Immutable upstream revision, promotable rollout, license/runtime/benchmark/manifest sha256, human approval reference, fallback recipe |
| `server/runpodReleaseGate.test.ts` | `2c5cd2c79de2431dca41da103f98931638acfc84` | 2095 | Release gate tests |
| `server/runpodReleaseConfig.ts` | `bdc6b350216ccbd168091df0c5de05d841776ddf` | 1028 | Env JSON parse of approved release evidence; fail closed if missing/invalid |
| `server/runpodReleaseConfig.test.ts` | `90d2667972004b8b53d5b14ed18d82df66a6095f` | 1253 | Release config tests |
| `server/runpodParserEnvelope.ts` | `f0fddc623c02363581c8980c77f9413fa283d8a4` | 2880 | Parser job envelope bound to release/input digest (port contract, not bytes) |
| `server/runpodParserEnvelope.test.ts` | `cb3509bf8c7591d3dc9c8dd57aef6b0faf76df05` | 2544 | Parser envelope tests |
| `server/runpodDispatcher.ts` | `3fc314ca90014223e34426c0fa7f1e9f393a973b` | 8178 | **Do not copy live dispatch.** Port only the fail-closed admission ordering after a Product-owned release gate exists. |
| `server/runpodCanary.ts` | `04b949d65156c01e080059783cc42dfb6adfdb05` | 2270 | Synthetic canary shape only; Foundation already has `shared/runpodSyntheticQualification.ts` |
| `server/r2ImmutableSourceGate.ts` | `626f08235f537f1fcb3be62055553430e337df2b` | 2386 | HEAD-metadata proof semantics. Product now has a metadata-only adapter; do not copy the S3 `HeadObjectCommand` caller until a separately approved signer exists. |

## Receipt fields to preserve later

From `RunpodCompletionReceipt` (snake_case wire): `ok`, `schema_version`, `job_id`, `tenant_id`, `provider`, `worker_kind`, `model_revision`, `runtime_image_digest`, `input_sha256`, `output_sha256`, `output_bytes`, `output_object_key`, `idempotency_key`, `idempotent_replay`, `error.code`, `error.retryable`.

Resolution states: `candidate_ready` | `retry_scheduled` (mapped to human review) | `review_required`.

## Current Foundation gate

Foundation RunPod remains **fail-closed, not failed**. No worker release artifact, no compatible CUDA/APAC capacity, no endpoint. `shared/activationPolicy.ts` `ocrGpu.enabled` stays false. This document does not authorize GPU spend.

## Related Product contracts

- `shared/runpodSyntheticQualification.ts` — provider-independent $5 ceiling policy
- `shared/productCoreCompileEnvelope.ts` — Product-to-Core job/receipt
- `shared/candidateWorldContract.ts` — candidate is never Active; promotion stays policy-disabled

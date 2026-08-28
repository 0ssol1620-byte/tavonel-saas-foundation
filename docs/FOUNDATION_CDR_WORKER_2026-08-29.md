# Foundation CDR Worker (2026-08-29 KST)

This commit adds `quarantine-sidecar/foundation-cdr-worker`, a Foundation-only Cloudflare Worker named `tavonel-foundation-cdr`. It is source only. This commit does **not** deploy the Worker, does **not** flip `activationPolicy.cdr.enabled`, and does **not** touch production `tavonel`, `tavonel-pdf-cdr`, `tavonel-prod-quarantine`, or `tavonel-quarantine-sidecar`.

## Why a Worker

Vercel already presigns a browser-direct PUT to `quarantine/{workspaceId}/{documentId}/source` on bucket `tavonel-saas-foundation-quarantine`. There is no post-PUT complete hook. The Worker must GET bytes from R2 itself through the native `FOUNDATION_QUARANTINE` binding. Vercel must never GET or POST file bytes.

## What this Worker does

1. Consume queue `foundation-quarantine-created` (or accept `POST /v1/sanitize` with JSON `{ objectKey }` only).
2. Load the R2 object when the key matches `quarantine/{workspaceId}/{documentId}/source`.
3. Refuse objects larger than 5 MiB before calling CDR.
4. POST the bytes as multipart field `source` to the **synthetic** Cloud Run CDR at `/v1/disarm`, with HMAC headers.
5. On HTTP 200, `x-tavonel-cdr-status: clean`, matching input digest, and a reconstructed PDF, write:

   `immutable/{workspaceId}/{workspaceId}/{documentId}/{versionKey}/sanitized.pdf`

   using `onlyIf.etagDoesNotMatch = "*"` (create-once). If the object already exists, treat that as success. Leave the quarantine source object untouched.

Pilot has no separate tenantId. Repeating `workspaceId` matches the `immutable/{tenantId}/{workspaceId}/` prefix.

## What this Worker does not do

- No Cloudflare Containers, ClamAV, Durable Objects, `TAVONEL_R2_*` S3 keys, `TAVONEL_QUARANTINE_SIDECAR_HMAC`, or Cloudmersive.
- No production Worker port from `tavonel-quarantine-sidecar`.
- No GPU / `ocrGpu`. GPU remains blocked until an immutable worker release pack exists.
- No Vercel complete route that fetches R2 bytes.

## Fail-closed until a live harmless object

`nextjs/lib/activation-policy.ts` keeps `cdr.enabled = false` until a harmless Foundation-bucket `/source` object yields clean CDR headers **and** a sibling immutable PDF. Do not flip that flag in this change.

GPU remains blocked (`ocrGpu.enabled` false).

## Dashboard steps before the Worker can run

The Worker process is inert until an operator does **all** of the following in the Foundation Cloudflare account. Secret **names** only; never paste values into chat or git.

1. **HMAC secret (dashboard-only)**  
   Copy the value of GCP Secret Manager `projects/tavonel-saas-foundation/secrets/tavonel-cdr-hmac` into the Cloudflare Worker secret named `TAVONEL_CDR_HMAC`. Do not put it in `wrangler.jsonc` vars. Do not commit `.dev.vars`.

2. **R2 binding**  
   Bind `FOUNDATION_QUARANTINE` to bucket `tavonel-saas-foundation-quarantine` only. Never bind `tavonel-prod-quarantine`.

3. **Queue**  
   Create queue `foundation-quarantine-created` and attach this Worker as consumer (`max_batch_size` 1).

4. **R2 event notification**  
   On bucket `tavonel-saas-foundation-quarantine` only, create an object-create notification with prefix `quarantine/` targeting that queue. Do not attach notifications to production buckets.

5. **Deploy (not done here)**  
   `wrangler deploy` for `tavonel-foundation-cdr` is a later, explicit operator action. This repository commit does not deploy.

6. **Health**  
   `GET /health` is 200 only when the HMAC is present (≥32 chars), the CDR URL looks like the synthetic Cloud Run (not `tavonel-pdf-cdr`), the bound bucket name is the Foundation quarantine bucket, and the optional synthetic `/health` fetch succeeds. It never echoes the HMAC.

## Synthetic CDR contract

- Disarm: `https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/v1/disarm`
- Health: `https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/health`
- Provider var: `tavonel_pdf_raster`
- The Worker refuses any `TAVONEL_CDR_URL` whose host contains `tavonel-pdf-cdr`.

## Operator reminder

Do not enable `cdr.enabled` until the harmless Foundation `/source` object produces clean headers and the sibling immutable PDF. Do not open GPU. Do not point this Worker at production.
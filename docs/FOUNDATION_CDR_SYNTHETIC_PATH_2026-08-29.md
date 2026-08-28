# Foundation CDR synthetic path — 2026-08-29

Worker `tavonel-foundation-cdr` is live. HMAC is a Cloudflare encrypted secret (not a plaintext variable). Production `tavonel-quarantine-sidecar`, `tavonel-pdf-cdr`, and `tavonel-prod-quarantine` were not used.

## Health

`GET https://tavonel-foundation-cdr.tavonel-controlplane.workers.dev/health` returned `status: ok`, `provider: tavonel_pdf_raster`, `hmacConfigured: true`. The HMAC value is not recorded here.

## Synthetic object (not customer data)

- Bucket: `tavonel-saas-foundation-quarantine` only
- Source key: `quarantine/pilot-synthetic/canary-20260829/source`
- `POST /v1/sanitize` returned `status: clean`
- Immutable sibling: `immutable/pilot-synthetic/pilot-synthetic/canary-20260829/1a22f6da96d5550a4de2c810f7cb9db69a4d4247a242b835403c169e87c8d5fd/sanitized.pdf`
- Input sha256: `sha256:d89be9ff76f631c05fe57768ab12879bfc023c32c26ec1e2498c1ada1bd18f65`
- Output sha256: `sha256:1a22f6da96d5550a4de2c810f7cb9db69a4d4247a242b835403c169e87c8d5fd`
- Source object was left in quarantine. Application server did not GET/POST file bytes.

## Still closed

- `ocrGpu` / paid RunPod: no immutable worker release pack
- `candidatePromotion`: remains false

# Foundation OCR slice (2026-08-29 KST)

This commit adds the missing OCR path after CDR: Worker (or sidecar) OCRs the immutable PDF and writes reviewable candidates JSON. Vercel still never GET/POSTs file bytes. No paid RunPod endpoint was created.

## What shipped

- `workers/foundation-ocr/` — FastAPI on port 8001, CPU text extraction (`pypdfium2`), HMAC on `POST /v1/ocr`, 18 MiB PDF cap, fail closed on non-PDF. No SSH, no port 22, no CUDA in the GHCR image. RunPod may later schedule this same image on a GPU SKU.
- `.github/workflows/foundation-ocr-image.yml` — buildx `linux/amd64` push to `ghcr.io/0ssol1620-byte/tavonel-foundation-ocr`. Digest lands in the job summary and a workflow artifact after the first green run (`docs/evidence/ocr/FOUNDATION_OCR_IMAGE_PENDING.md`).
- Foundation CDR Worker (`tavonel-foundation-cdr`) optionally POSTs the immutable PDF to `FOUNDATION_OCR_URL` after a successful create-once `sanitized.pdf` write, then writes sibling `ocr.json`. If the URL is empty, OCR is skipped and CDR remains clean.
- Next.js `GET /api/documents` lists immutable object keys (sizes, whether `ocr.json` exists) for the signed-in pilot workspace. Optional `GET /api/documents/[id]/candidates` returns `ocr.json` text only. Neither route returns PDF bytes.
- Qualification helper builds a `SyntheticRunPodQualificationRequest` from `docs/evidence/ocr/release.json`. The template keeps `immutableReleaseEvidenceVerified: false` until CI writes a digest. The helper does not call RunPod.

## GHCR image

`ghcr.io/0ssol1620-byte/tavonel-foundation-ocr`

Digest is pending the first green workflow run. Do not invent one.

## Still closed

- `activationPolicy.ocrGpu.enabled` remains **false** until GHCR digest + capacity evidence + `$5` one-shot qualification exist.
- `candidatePromotion.enabled` remains **false**. Promotion is always an explicit human decision.
- `creditGuardrails.liveGpuDispatchEnabled` remains **false**.
- No RunPod create/update/delete was issued by this slice.
- Production `tavonel`, `tavonel-pdf-cdr`, `tavonel-prod-quarantine`, and `tavonel-quarantine-sidecar` were not touched.

## Bytes path

Browser PUT → Foundation quarantine → CDR Worker → immutable `sanitized.pdf` → (optional) OCR Worker via Worker R2 GET → sibling `ocr.json`. Vercel issues JSON capability and later lists metadata only.

# Foundation OCR image digest — pending first green GHCR run

Workflow: `.github/workflows/foundation-ocr-image.yml`

Image name: `ghcr.io/0ssol1620-byte/tavonel-foundation-ocr`

The image digest (`sha256:…`) is **not** in this repository yet. After the first green `foundation-ocr-image` run it appears in:

1. GitHub Container Registry for that image
2. The workflow job summary
3. Artifact `foundation-ocr-image-digest`

Copy that digest into `docs/evidence/ocr/release.json` (`imageDigest`) only after the green run. Do not invent a digest. `ocrGpu.enabled` stays false until digest + capacity + `$5` one-shot qualification exist. No RunPod mutation is authorized by this file.

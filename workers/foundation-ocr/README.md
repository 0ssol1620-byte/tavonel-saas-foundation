# tavonel-foundation-ocr

Foundation OCR worker. FastAPI on port **8001**. CPU text extraction from PDF via pypdfium2.

This image is CPU-capable so GHCR build does not need CUDA. RunPod can still schedule the same image on a GPU SKU later. This tree does **not** expose 22, does **not** install OpenSSH, and has no SSH ENTRYPOINT.

`GET /health` returns `{status: ok, port: 8001, ssh: false}` and does not require HMAC (so the container HEALTHCHECK works without baking a secret into the image).

`POST /v1/ocr` accepts multipart field `source` (`application/pdf`, 18 MiB cap) and requires HMAC env `TAVONEL_OCR_HMAC` (unpadded base64url SHA-256 of `timestamp.requestId.inputSha256`, same algorithm as CDR). Never put that secret in the image.

Raster PDFs produced by Foundation CDR typically have no text layer. This slice extracts embedded text only; GPU OCR stays closed until a GHCR digest, capacity evidence, and a $5 one-shot qualification exist.

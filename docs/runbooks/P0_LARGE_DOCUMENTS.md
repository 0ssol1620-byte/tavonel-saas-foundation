# P0 large-document admission and splitting

## Purpose

Keep the existing 5 MiB intake boundary fail-closed while permitting large PDFs to enter through a separately verified split workflow. This contract does not claim that a splitter is deployed; it defines the admission receipt every splitter must satisfy.

## Procedure

1. Hash the original bytes with SHA-256 and retain the immutable source digest.
2. Call `POST /api/operations/p0/admission` with the workspace, document UUID, safe filename, MIME type, byte count, page count and digest.
3. Reject the source when the response is not `ok: true`. Never silently truncate or rasterize it.
4. For `decision: split`, produce parts in the returned page order. Each part must be no larger than 5 MiB and no more than 80 pages.
5. Measure actual part bytes. Recursively divide an oversized part; estimates are not proof.
6. Reject encrypted, malformed or reordered output. Hash every part and bind it to the source digest and page range.
7. Admit each verified part through the normal quarantine/CDR path.
8. Compile only after all expected parts have terminal `ocr_ready` receipts. A missing part moves the source to operator review.

## Evidence

Retain the admission response, original digest, splitter version, ordered part manifest, per-part digest and byte count, CDR receipt, OCR receipt, and final collection digest. Direct uploads remain subject to the same source-digest requirement.

## Rollback

Disable the split producer, leave original sources quarantined, and reject new large-document admissions. Do not merge incomplete part sets or charge credit for rejected/terminally failed work.

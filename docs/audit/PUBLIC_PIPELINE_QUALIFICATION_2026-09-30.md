# Production pipeline qualification — 2026-09-30

Status: public English and operator-authored Korean/English fixtures now pass
production OCR. Customer website-to-export qualification remains outstanding.

The operator used the founder's standing test authorization and the public W3C
dummy PDF served by `/api/proof-pdf`. No customer document was used in this probe.
Input: 13,264 bytes, SHA-256
`3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4`.

The real quarantine queue produced a clean CDR receipt and a 7,515-byte sanitized
PDF at 00:02:49 UTC. Its SHA-256 was
`f4c89c26a669e290786df19dddb3147a6827887c6d6e9ca7a941024f76d2ce42`.
The OCR result was stored at 00:05:20 UTC and the reserved operator computation
was subsequently `settled` in the production database. This was a direct storage
qualification probe, not a website upload or a customer compilation test.

The OCR JSON reports `status: ok`, one page, but only one region containing
`yme` at confidence 0.55334. An HTTP success and this status do not establish
content fidelity. Source-versus-sanitized rendering and the OCR runtime are being
investigated. Do not use this result as a successful OCR quality, compilation,
signed-export, or AI-consumer receipt.

Raw receipts and the public fixture are retained outside the repository in
`D:/CodexProjects/tavonel-private-audit/scoped-admission-20260930/`.
Customer processing and live charging have not been activated by this probe.

## GPU compatibility repair and repeat

The original worker used an RTX PRO 6000 Blackwell MIG device. The same deployed
image and local reproduction read the fixture correctly on a compatible GPU.
The operator removed `BLACKWELL_96` from endpoint `cohlugjzf0dk9i`, preserved the
other GPU pools and image, and cycled the idle worker. The configured worker cap
was restored to one, with zero minimum workers and a 120-second idle timeout.

Endpoint version 17 ran the repeated quarantine/CDR/OCR request on an NVIDIA
GeForce RTX 4090 in `EUR-NO-1`. The result was exactly `Dummy PDF file`, one page,
one region, confidence 0.99922, and the compute reservation settled. The new
sanitized PDF hash is
`ffeeeb7700659d489772d8934671820cd2ad3d54274cab10ad9bd3e8c71b390c`.
Its bytes differ from the prior sanitization, so this is the same original-input
and deployed-image comparison, not a byte-identical sanitized-input comparison.

The observed repair supports a GPU/runtime compatibility diagnosis. It does
not establish general multilingual OCR accuracy, customer document compilation,
or signed-export acceptance. The active image digest remains
`1392dac4e3d743f720deaa4721594a06fef6f0e8d7a6dac5e81b66324dfe6406`;
its source/build provenance is under review before a replacement is deployed.

## Mixed Korean/English regression

A second operator-authored, noncustomer PDF contains an English heading, two
Korean sentences and a Korean line with a date, amount and quantity. Input hash:
`bb14fc26aec18fe2b18a9d532539f370d6e3e292ee76dbd6819c8cfdd555cbae`.
The source and sanitized PDF were rendered and visually checked: all four lines
remain legible. Production OCR on the compatible GPU returns only the English
heading and a corrupted numeric line, losing the Korean sentences.

This is a failed multilingual qualification. The recovered runtime invokes its
Korean reader only under a text heuristic, which does not cover this sparse mixed
page. Its decision and merge behavior require correction and a production repeat.
The English canary success must not be generalized to Korean customer material.

## Corrected multilingual runtime: production repeat

The corrected runtime was built from `908baab57057376fc6ea7aaa8e2384915bda9790`
by GitHub Actions run `36652489742`. Its immutable image is
`ghcr.io/0ssol1620-byte/tavonel-foundation-ocr-gpu@sha256:0e916aa661ad7d54215de85f1f1b63349756ee2c9f58db663f3181dc8b704101`.
The workflow passed 34 worker tests and container provider/non-root checks.
Both readers must pass CUDA recognition self-tests before the worker becomes ready.

Removing the `BLACKWELL_96` pool alone was insufficient: RunPod's live GPU catalog
places the Blackwell 24 GB MIG SKU in `AMPERE_24`. The endpoint is now restricted
to `ADA_24`, whose current catalog contains RTX 4090, with minimum zero and maximum
one worker. Version 19 ran the new image on RTX 4090 in `US-TX-3`.

The same original four-line multilingual fixture was newly uploaded through the
operator's reserved quarantine/CDR/OCR path. The sanitized PDF hash was
`39fc84ce0cc939dcd22e157c2943a5f633059e086bc58f91f3bdff347f15d44e`.
OCR returned all four lines, including both Korean sentences, date `2026-0930`,
amount `125,000원`, and quantity `37개`. It matches the authored text when whitespace
is removed; spacing itself is not exact. This closes the specific sparse mixed-page
regression, not a general accuracy benchmark.

The follow-up production database read requested Supabase reauthentication, so
compute settlement for this repeat has not been independently confirmed.
The raw OCR and qualification JSON are retained in the private audit directory as
`multilingual-fixed-ocr.json` and `multilingual-fixed-qualification.json`.
This was a synthetic storage-pipeline probe, not an authenticated customer website
upload, compilation, signed export, AI-consumer test or live payment.

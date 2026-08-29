# Foundation GPU OCR full-sequence evidence (2026-08-29 KST)

## Result

Qualified. A signed-in user ran the production workspace proof UI with a real,
one-page public PDF. The browser verified the pinned SHA-256, requested the
normal tenant-scoped upload capability, and PUT 13,264 bytes directly to the
Foundation quarantine bucket. Vercel did not carry the uploaded quarantine
bytes.

Document `7b7d397d-dceb-4736-85a4-bfa491d9ceae` produced create-once
`sanitized.pdf` (9,003 bytes) and sibling `ocr.json` (336 bytes). The
authenticated candidates API verified `status=ok`, one page, 14 text
characters, matching immutable digest and key, and
`candidatePromotion=false`.

## Runtime evidence

- Production deployment: `dpl_8ZHGsyCEoAugkDDB1B2rSEA7njxD`, clean commit
  `f4c63fa6cb1ca6938ef30696a9636061682cc481`, `READY`, production alias set.
- RunPod endpoint: `cohlugjzf0dk9i` with image digest
  `sha256:3d1845563c7d80bad01d6a050be4e9d7b2c34dbee7ccbe90cb246255194f47a8`.
- RunPod metrics: one completed request, one cold start (`29.81s`), and
  `2.03s` total execution time in the observed one-hour window.
- Scale-to-zero evidence: 0 running workers, 0 in-progress jobs, 0 waiting
  jobs, `$0.00000/s`; balance moved from `$15.80` to `$15.79`.
- RunPod's Logs table retained no success row after scale-to-zero. Terminal
  execution proof is therefore the completed metric plus immutable
  `ocr.json`, not an inferred health or routing signal.

## Guard evidence

The initial 121-page DART PDF was correctly rejected by CDR because it exceeded
the 80-page and total render-pixel budgets. It entered quarantine but produced
no immutable or GPU output. The successful proof used the fixed W3C public PDF
route, which accepts no user URL or customer bytes and verifies the exact
fixture digest before returning it to the browser.

`candidatePromotion` remains false. The legacy production stack and FOLYNTA
worktree were not changed. Foundation `ocrGpu` was opened only after this
evidence was complete; the separate legacy credit-dispatch guard remains
closed. Full machine-readable keys, timestamps, sizes, metrics, and checks are in
`FOUNDATION_GPU_OCR_FULL_SEQUENCE_2026-08-29.json`.

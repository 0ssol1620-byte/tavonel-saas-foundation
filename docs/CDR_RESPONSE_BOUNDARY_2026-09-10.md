# CDR response boundary candidate — 2026-09-10

Current service read-only check: tavonel-cdr-validation-0909 still latestReadyRevision00002-c2c at https://tavonel-cdr-validation-0909-jw7bqc3nla-du.a.run.app. Foundation global workload identity pool listing returned none. No IAM change, token issuance, file invocation or production cutover occurred.

Implemented before IAM integration: CDR successful response now reads incrementally with18MiB ceiling, validates declared length and cancels the stream on excess/failure. Rejection JSON detail limited4KiB. Disarm fetch refuses redirects and carries60second timeout. Output digest and persisted receipt verification remain unchanged. Three oversized-stream scenarios (no length, false low length, oversized declared length) prove cancellation and zero persistence. Existing86tests pass. Worker strict typecheck passes after adding its missing explicit @types/node dependency; both existing package locks updated. Receipts .chatgpt2codex/cdr-response-bound-tests-0910.log and cdr-response-bound-types-final-0910.log. Initial typecheck missing-node-type failure preserved.

Not proven: live Worker timeout/stream behavior, IAM broker/WIF, actual source-to-CDR-to-OCR path, scanner update operations, real customer E2E. All remain required. CDR health/legacy status-error paths require further transport cleanup review. Candidate only; no customerData activation.

Reference consulted: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/ (bounded response consumption and cancellation). No new Worker binding/API type introduced.

# Real Auth CI input fixtures

These two JSON files contain only the existing synthetic policy/board corpus: payment terms change from 30 to 45 days. They were regenerated through the actual Foundation HTTP adapter and local Python Core at `6ae628202317f71f9f09c0863aad1f4e0c900794`, using the existing five-case `local-core.integration.test.ts` suite, which passed on 2026-09-30. No customer data or production receipt is included.

The fixed user UUID `a1111111-1111-4111-8111-111111111111` maps to `pilot-a111111111114111`. Real Auth CI creates exactly that synthetic identity through the actual GoTrue admin API and fails if the provider does not honor the fixture UUID. Artifacts remain unchanged; they are not rebound to arbitrary users or mutated to pass a browser gate.

- `initial.json` SHA-256: `bb23c36c80dd3e27592f0bca8087ae0e942ccbd72b116217388b58c0ef7be7c7`.
- `updated.json` SHA-256: `3ef6926c2ed6261703eb060fe0659d05ab9e5113ab05921f9db742acac354a92`.

This is fixture provenance, not evidence that the real Auth CI workflow has executed. Core itself is not started by that bounded Auth job; its existing actual-service qualification remains separate.

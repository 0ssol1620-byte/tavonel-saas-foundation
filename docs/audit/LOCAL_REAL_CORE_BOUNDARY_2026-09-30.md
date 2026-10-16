# Local real Core boundary qualification — 2026-09-30

This follows authenticated synthetic journey commit `d34cdf6f68bb25ec77e77f026962c0bb4d5ab309`. It replaces the Core service double at one boundary, without claiming the complete authenticated vertical is verified.

## Isolated inventory

- Foundation clone: `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\customer-journey`, based on public checkpoint `a0c4fa9302d8d050a9936c060631002184e6055d`.
- New, unmodified Core clone: `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\core-journey`, cloned with `--no-hardlinks` from the read-only local Core reference. Actual Core commit: `20a6ae06c7221f88a9a033b9f5923464516ef280`. This is an available local source revision, not a claim about a deployed or current upstream release.
- Python 3.12.6, FastAPI 0.140.13 and httpx 0.28.1 are available through the existing read-only interpreter `C:\Users\yspow\Documents\Codex\2026-09-30\task\.core-venv\Scripts\python.exe`. No dependencies were installed into that environment. Core imports point exclusively at the new clone; bytecode writes are disabled.
- PostgreSQL 17 executables exist under `C:\Program Files\PostgreSQL\17\bin`. The integration owner's stopped cluster `task\qa-postgres-isolated` was neither started nor changed. No PostgreSQL/auth/storage service was assumed available. Docker, Supabase CLI and psql were not on PATH.
- No real Supabase Auth, R2-compatible storage, OCR/CDR service or hybrid retrieval service was qualified by this change. Those remain explicit boundaries to replace.

## Implemented and verified

`scripts/journey/local-core-server.py` binds an ephemeral loopback port and forwards HTTP to the actual Core FastAPI application, compiler and SQLite durable journal using FastAPI TestClient. It is a disposable adapter, not a replacement compiler. It requires explicit synthetic fixture settings, disables customer data and inherits a restricted environment without provider credentials. The journal lives in a fresh temporary directory. The runner closes the server and removes that directory; no shared services are started.

The Foundation integration suite dispatches actual signed `/v2/compile` requests and validates actual receipts. It verifies initial compilation and real package hashes, process restart followed by durable replay with a newly bound request receipt, incremental compilation from real previous units with full-rebuild equivalence, anonymous/wrong-HMAC refusal, and refusal of a real response modified in transit. The synthetic policy changes from 30 days to 45 days. No publish or live storage mutation is performed.

Real execution found a Foundation interoperability defect: Python's canonical JSON includes floating-point spellings such as `1.0`, while parsing and reserializing in JavaScript changes that to `1`. The previous receipt verifier rejected genuine Core responses. The new bounded structural wire canonicalizer preserves numeric tokens, sorts keys by Python Unicode code-point ordering and rejects duplicate/malformed JSON. Receipt checking still requires the exact output digest; tampered responses remain refused. Twelve focused parser cases cover numeric spelling, Unicode/string handling, ambiguity and excessive nesting.

## Exact remaining Core dependency

At Core commit `20a6ae06c7221f88a9a033b9f5923464516ef280`, `packages/product-core/src/akc_product_core/compiler.py` emits `deterministicMaterialization`, `sourceCoverage` and `evidenceCoverage`, but omits the required boolean `immutableInputsOnly` in candidate validation. Foundation's shared `readCompiledWorldValidationChecks` therefore correctly refuses projection. The integration test asserts this refusal; it does not inject a green check or label the candidate promotable.

Before real review/publish can be qualified, the Core owner must provide an immutable-input validation result derived from the actual validated input contract, with corresponding Core tests. Rerun this harness against that coordinated Core revision and replace the explicit missing-field assertion with real projection/read-model/promotion qualification. A complete real authenticated flow also requires disposable SQL/RLS/Auth and object storage, then intake/CDR/OCR and retrieval; their availability is independent of the receipt fix.

## Reproduction

From the Foundation `nextjs` directory in PowerShell:

```powershell
$env:TAVONEL_LOCAL_CORE_DIR='C:/Users/yspow/Documents/Codex/2026-09-30/task-2/core-journey'
$env:TAVONEL_LOCAL_CORE_PYTHON='C:/Users/yspow/Documents/Codex/2026-09-30/task/.core-venv/Scripts/python.exe'
pnpm exec vitest run --config scripts/journey/vitest.local.config.ts
pnpm exec vitest run lib/core-runtime-v2.test.ts lib/canonical-json-wire.test.ts lib/collection-compile-run.test.ts --maxWorkers=2
pnpm check
```

The optional integration configuration uses one worker and requires those explicit local paths. It is outside the default hermetic suite so default runs do not silently skip service-dependent assertions. Production Core environment parsing still requires HTTPS; loopback HTTP is supplied only through the explicit test transport argument.

## Masterplan scope

Validation: real Core integration 5/5 passed; focused Foundation regressions 88/88 passed; `pnpm check`, standalone harness lint and TypeScript checks passed. The complete hermetic suite ran with two workers and passed 404 files / 5,874 tests, with zero failures or skips. Its machine-readable report is `C:\Users\yspow\Documents\Codex\2026-09-30\task-2\real-core-foundation-vitest.json`. Disposable Core processes and temporary journal directories were checked and cleaned up. The Core clone remains unmodified.

Report SHA-256: `650db135e29ab3c3fb2ae775768a43a0fb5396fc11eb2ebeddf3d5f338fed719`.

K04/Core compile receipt and replay plus cross-revision equivalence: verified for the named local Core revision and synthetic fixtures. K07/K09/K10/K19/K21 and UX11–UX16 retain the preceding report's partial status. Real Core-to-Foundation publication is blocked by the exact missing validation field above; no entire K or UX item is newly marked complete. G1/G3 remain partial, and no authenticated browser journey was run.

The next critical path is coordinated Core validation qualification, then a separate disposable PostgreSQL/RLS/Auth and storage harness. Estimate: 1–3 working days for these next local boundaries if existing migrations and dependencies suffice, with low confidence until inventoried; this is not a completion estimate for the entire masterplan.

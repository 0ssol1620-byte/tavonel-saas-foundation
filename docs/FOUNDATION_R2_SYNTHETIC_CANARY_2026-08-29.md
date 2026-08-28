# Foundation R2 synthetic canary (2026-08-29 KST)

One Foundation-only canary ran against `tavonel-saas-foundation-quarantine` via `POST /api/uploads/synthetic-canary`.

Result: `SYNTHETIC_CANARY_OK` (PUT 200, HEAD 200, DELETE 204). Object key stayed under `synthetic/` and was deleted.

`activationPolicy.customerIntake` remains false. Production `tavonel` and production R2 buckets were not used.

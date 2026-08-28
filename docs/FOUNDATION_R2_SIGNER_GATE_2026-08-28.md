# Foundation R2 signer/CORS gate — 2026-08-28 KST

## Verified (Cloudflare-bindings, read)

| Item | Result |
|---|---|
| Foundation bucket | `tavonel-saas-foundation-quarantine` exists, Standard, location `APAC`, jurisdiction `default` |
| Production bucket | `tavonel-prod-quarantine` listed and **not modified** |
| Other buckets | `tavonel-dev-storage`, `tavonel-v5-synthetic-canary-20260826` listed and **not modified** |
| Existing Worker | `tavonel-quarantine-sidecar` (`5abf87e1ba6e41138ebe05b6388f101e`) inspected by name/id only and **not modified** |
| Customer intake | remains globally disabled |

## Prepared, not applied

`docs/r2-foundation-cors.json` is the exact origin-scoped CORS policy for the Foundation Vercel origins only. It does not use `*`, does not make the bucket public, and is not attached to production.

The Cloudflare-bindings connector can list/get buckets and Workers. It cannot set CORS, create an R2 API token, or issue a presigned PUT. Wrangler is not installed on the workstation. Therefore the signer credential and bucket CORS mutation are **not** completed.

## Still required before browser-direct upload

1. Apply `docs/r2-foundation-cors.json` only to `tavonel-saas-foundation-quarantine` (dashboard or Wrangler).
2. Create a Foundation-only R2 token with object read/write on that bucket, store it in managed secret storage (never git/chat).
3. One-shot synthetic signer canary: PUT→HEAD→DELETE of a `synthetic/` marker from the Foundation origin, then delete the object.
4. Keep `customerIntake.enabled === false` until that canary and Auth/Paddle gates are independently evidenced.

Previous 2026-08-27 bucket control-plane canary remains valid for object round-trip only; it did not qualify CORS or a browser signer.

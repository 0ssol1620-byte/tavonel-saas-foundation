# Foundation R2 CORS applied — 2026-08-28 KST

Applied on Cloudflare account `ossol1620@gmail.com` to bucket `tavonel-saas-foundation-quarantine` only.

| Origin | Result |
|---|---|
| `https://tavonel-saas-foundation.vercel.app` | Allowed |
| `https://tavonel-saas-foundation-phillips-projects-a8cf32fc.vercel.app` | Allowed |

Methods: GET, PUT, HEAD, DELETE. Allowed headers: Content-Type, Content-Length, Content-MD5. ExposeHeaders: ETag, Content-Length. MaxAgeSeconds: 3600. No wildcard origin. Bucket remains private.

Untouched: `tavonel-prod-quarantine`, `tavonel-dev-storage`, `tavonel-v5-synthetic-canary-20260826`. No public access, no API token in this step, no customer object, intake still disabled.

This qualifies origin-scoped CORS only. Browser-direct signer still needs a bucket-scoped token in managed secret storage and a synthetic canary.

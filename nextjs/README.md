# TAVONEL Next.js + Vercel Deployment Package

This folder is a standalone **Next.js App Router** package prepared for a separate Vercel project. It intentionally does not replace or deploy to the existing `tavonel` production project.

Set the Vercel project root directory to `nextjs`. The Vercel configuration targets Seoul (`icn1`) and applies `Cache-Control: no-store` to every API path. Billing requires the managed sandbox variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FOUNDATION_BILLING_HMAC`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_API_KEY`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, and the five `PADDLE_PRICE_*` mappings. Never place service-role, API, R2, CDR, HMAC, or webhook secrets in `NEXT_PUBLIC_*` variables; only Paddle's client-side token is public by design.

`/api/uploads/capability` is metadata-only and enforces a small JSON request cap. `/api/paddle/webhook` verifies the raw body’s `Paddle-Signature` HMAC before applying an idempotent Supabase projection. Checkout metadata is HMAC-bound to the authenticated user, workspace, and allow-listed Paddle price. No API route accepts or forwards document byte streams.

Completed separate-Core collection candidates can be downloaded from the signed-in workspace through `GET /api/collections/[id]/download`. The endpoint reloads the tenant-scoped immutable R2 artifact, requires a completed Core receipt with `candidatePromotion=false`, verifies every package path, byte count, and SHA-256 digest, then returns a no-store ZIP. It does not qualify semantic accuracy or promote the candidate.

Google OAuth is enabled for private-pilot users and protected APIs verify the Supabase bearer session. Paddle remains sandbox-only, but now includes overlay checkout, immutable event receipts, ordered subscription projection, prepaid-credit purchase and conservative refund/chargeback reversal, plus fresh customer-portal sessions. Live payment must not be enabled without a separate approval and qualification pass.

Run `pnpm install`, then `pnpm test && pnpm run check && pnpm run build`. Do not release this package, configure live payment, or enable document intake until the provider checklist and synthetic qualification gates have passed.

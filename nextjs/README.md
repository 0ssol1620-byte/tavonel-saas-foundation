# TAVONEL Next.js + Vercel Deployment Package

This folder is a standalone **Next.js App Router** package prepared for a separate Vercel project. It intentionally does not replace or deploy to the existing `tavonel` production project.

Set the Vercel project root directory to `nextjs`. The Vercel configuration targets Seoul (`icn1`) and applies `Cache-Control: no-store` to every API path. Before any deployment, add only the approved sandbox variables through managed project secrets: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PADDLE_WEBHOOK_SECRET`, and, only after a separately approved signer design, R2 server credentials. Never place service-role, R2, CDR, or webhook secrets in `NEXT_PUBLIC_*` variables.

`/api/uploads/capability` is metadata-only, enforces a small JSON request cap, and responds with a no-store 503 while customer intake is disabled. `/api/paddle/webhook` verifies the raw body’s `Paddle-Signature` HMAC and returns 503 until a dedicated entitlement store has been approved. No API route accepts or forwards document byte streams.

Run `pnpm install`, then `pnpm test && pnpm run check && pnpm run build`. Do not release this package, configure live payment, or enable document intake until the provider checklist and synthetic qualification gates have passed.

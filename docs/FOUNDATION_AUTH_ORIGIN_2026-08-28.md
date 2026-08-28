# Foundation Auth origin — 2026-08-28 KST

Isolated Vercel project, not the existing `tavonel` production app.

| Item | Value |
|---|---|
| Team | Phillip's projects (`team_pUMlEXiyu9hN7t5zeTKmTRHp`) |
| Project | `tavonel-saas-foundation` (`prj_MYQRt5iqntJbzktlmjEouOo6aLtl`) |
| Git link | `0ssol1620-byte/tavonel-saas-foundation` / `main` / `nextjs` |
| Deployment | `dpl_G6QxATnRKMKYYX8wAuN3EJsjAXZW` READY, Seoul `icn1` |
| Canonical HTTPS origin | `https://tavonel-saas-foundation.vercel.app` |
| Team alias | `https://tavonel-saas-foundation-phillips-projects-a8cf32fc.vercel.app` |
| Git main alias | `https://tavonel-saas-foundation-git-main-phillips-projects-a8cf32fc.vercel.app` |
| Proposed Auth redirect | `https://tavonel-saas-foundation.vercel.app/auth/callback` |
| Proposed Paddle webhook | `https://tavonel-saas-foundation.vercel.app/api/paddle/webhook` |

Homepage HTTP 200. `/api/status` reports `auth: not_configured`, `billing: sandbox_not_configured`, and all four live flags false.

This origin does **not** enable Google OAuth, Supabase Auth, signup, checkout, R2 signer, intake, or GPU. Those remain separate gates.

# Foundation Paddle sandbox catalog — 2026-08-29 KST

Sandbox (Test mode) only. Live merchant was not enabled.

| Product | Paddle product id | One-time price |
|---|---|---|
| TAVONEL Starter | `pro_01m14fcvebgd78pqfn5ankykz3` | $12 |
| TAVONEL Builder | `pro_01m14fdwn2xjvfbfq1ebjcxbtp` | $30 |
| TAVONEL Scale | `pro_01m14feve6jq23gy9r1sbmjtk2` | $75 |

Notification destination `ntfset_01m14ftah3b5035z5njtq5tkt0` → `https://tavonel-saas-foundation.vercel.app/api/paddle/webhook` (Active, all events). Signing secret stored only as Vercel env `PADDLE_WEBHOOK_SECRET` on project `tavonel-saas-foundation` (Production + Preview). Secret not recorded here. Redeploy was not run.

Still fail-closed: live checkout, live catalog, customer intake, GPU dispatch, candidate promotion.

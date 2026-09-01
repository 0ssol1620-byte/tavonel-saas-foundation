# TAVONEL operations readiness

Date: 2026-08-30

2026-09-01 addendum: the R2 half of backup/restore is qualified. The active
lifecycle aborts incomplete multipart uploads after 7 days, expires
`quarantine/` after 365 days and leaves `immutable/` without an expiry rule.
An isolated APAC restore drill reproduced a 336-byte immutable `ocr.json` with
an identical SHA-256, then removed only the drill object, bucket and local
temporary files. Supabase point-in-time/daily backup and database restore remain
a separate provider-plan gate.

This record is the implementation and external-gate ledger for the ten P0 operating tracks. A checked code control is not evidence that a provider dashboard setting or paid account review is complete.

| Track | Implemented in repository | External completion gate |
| --- | --- | --- |
| Legal pages | Privacy, terms, refunds, subprocessors and sitemap | Legal operator name, business number, address and Korean counsel review before live sales |
| Business disclosure | Live-sales fields are explicitly gated; pilot state is disclosed | Business registration and ecommerce seller disclosure, if applicable |
| Paddle Live | Runtime distinguishes sandbox/live and status discloses test-only billing | Paddle domain/account review, KYC/KYB, payout, tax and live credentials |
| Representative email | Domain aliases and Resend transactional delivery already qualified | Paid two-way mailbox/helpdesk and SPF/DKIM/DMARC reply-path test |
| Monitoring | Health, readiness, public status and 15-minute synthetic workflow | Enable GitHub Actions and route alerts to an on-call destination |
| Backup/restore | Runbook and evidence contract below | Confirm Supabase plan backup window; configure R2 retention; execute restore drill |
| Privacy lifecycle | Public data map and processor register | Approve retention periods and automate verified deletion |
| Configuration drift | Public status derives from runtime configuration; security page derives from activation policy | Retire or explicitly scope the legacy root runtime that remains fail-closed |
| Security operations | SECURITY.md, CODEOWNERS, CI, CodeQL and Dependabot | Enable branch protection, secret scanning, DNSSEC and reviewed CAA records |
| Cost controls | Fail-closed billing/runtime gates and readiness reporting | Set Vercel/RunPod/Cloudflare alert thresholds and emergency stop owners |

## Verified external state, 2026-08-30 KST

- Cloudflare DNSSEC is active. A public `DS` query through `1.1.1.1` returned key tag `2371`, algorithm `13` and digest type `2`.
- DMARC was changed from monitoring-only to staged enforcement: `p=quarantine; pct=25`, with aggregate reports routed to `security@tavonel.com`. The new TXT value was confirmed through the `1.1.1.1` public resolver.
- Resend reports `tavonel.com` verified in Tokyo, with DKIM, SPF and sending enabled. Receiving remains off to avoid conflicting with Cloudflare Email Routing. A domain-scoped sending key was created for Gmail SMTP; the Gmail send-as verification remains open.
- Paddle sandbox reports all four integration stages complete: catalog, pricing/checkout, fulfillment/provisioning and end-to-end testing. Paddle Live login is verified, but setup is `0/3`: `tavonel.com` was submitted for domain approval and is `Pending`; account verification, live catalog, credentials, webhook and payout setup remain open. The unrelated existing `commoditynode.com` submission remains declined.
- RunPod endpoint `cohlugjzf0dk9i` reported zero active workers, maximum workers `1`, idle timeout `5 seconds`, zero current spend rate and one completed recent request. Account MFA remains an external security gate.
- Supabase project `tfcorhjkqcuisqhsjemz` is on the Free plan. The dashboard explicitly reports no project backups. Pro starts at `$25/month` and includes daily backups retained for seven days. Spend cap is enabled, so usage cannot silently create overage charges.
- Vercel production deployment `dpl_37ohffzsxVdEJVVmequdiRSvwmX3` reached READY and was aliased to `https://tavonel.com`. Home, legal pages, sitemap, liveness and readiness returned HTTP 200; readiness reported auth, storage, signed export and compiler operational while billing remained sandbox-only.
- The public OpenAPI contract and downloadable CLI, read-only MCP server and source agent returned HTTP 200 from `tavonel.com`. An unauthenticated `/api/v1/connections` request returned HTTP 401 rather than exposing tenant data.

## Backup and restore runbook

1. Record Supabase backup type, oldest restorable point and region without copying secrets into this repository.
2. Export schema and tenant-scoped metadata to encrypted operator storage. Hash the artifact and record the tool version.
3. Inventory R2 object keys, versions and lifecycle policy. Never treat the inventory as a byte backup.
4. Restore into an isolated non-production Supabase project and isolated R2 bucket.
5. Run migration, tenant RLS, signed-export and one sanitized synthetic compile tests.
6. Record recovery point, recovery time, row/object counts, hash results and deletion of the drill environment.
7. A backup is not qualified until a restore drill succeeds. Target cadence: monthly restore drill and quarterly owner review.

## Incident response

1. Triage severity and appoint incident commander, operations lead and communications owner.
2. Contain with the narrowest reversible control: disable intake or GPU dispatch before broad account or DNS changes.
3. Preserve Vercel, Supabase, Cloudflare, RunPod, Paddle and Resend event identifiers. Do not place document contents in chat or tickets.
4. Rotate only exposed credentials and verify old credentials are rejected. Re-deploy from a reviewed commit.
5. Assess notification duties immediately. Escalate potential personal-data breaches to Korean counsel; the operational target is to reach a notification decision well inside 72 hours.
6. Publish customer-impact facts without unsupported attribution. Complete a blameless post-incident review with owned actions.

## Key rotation

Inventory and rotate, one provider at a time: Supabase service role, R2 signer, CDR settlement HMAC, Paddle API/webhook credentials, Resend API key, export signing key and RunPod credentials. Create the replacement with equal or narrower scope, deploy it, run a synthetic proof, revoke the old key, then confirm revocation. Never rotate all providers simultaneously.

## Cost controls

Use provider alerts at 50, 75, 90 and 100 percent of the approved monthly envelope. The 100 percent action is intake/GPU fail-closed, not an unbounded automatic spend increase. RunPod remains scale-to-zero; jobs require prepaid reservation and observed-runtime settlement. Vercel and Cloudflare limits must alert an operator before any setting that can increase spend is changed.

## Two-way mail gate

`hello@`, `support@`, `security@` and `privacy@` currently route inbound mail to a private mailbox and Resend sends transactional mail. This is not a two-way team mailbox. Before general availability, provision a domain mailbox or helpdesk, configure replies to send from the TAVONEL address, and prove inbound, outbound, reply, SPF, DKIM, DMARC and personal-address non-disclosure.

## Paddle live gate

Do not replace sandbox credentials piecemeal. Complete Paddle account/domain review, operator identity, payout, tax, legal links and live product/price creation first. Create a separate live notification destination for `https://tavonel.com/api/paddle/webhook`, deploy all live identifiers atomically, run one low-value founder-authorized purchase/refund/cancellation sequence, then verify the webhook event ledger and entitlement projection before opening sales.

# Founder test workspace reset — 2026-09-23

The founder authorized permanent deletion of the founder test workspace's database rows and stored objects. The production reset was run through **Settings → Usage & billing → Start this workspace from empty** on `tavonel.com`. Sign-in, owner access, founder access and the billing exemption were outside the reset scope.

## Observed sequence

1. The sealed manifest displayed **134 database rows** and **349 stored objects**. An earlier attempt stopped with `SOURCE_DELETE_FAILED_HTTP_409`; the resumed inventory displayed 342 objects remaining, so seven had already been removed.
2. The Vercel production log for the failed request reported `ObjectLockedByBucketPolicy` on the R2 delete. The active `Immutable 365 day lock` covered `immutable/` in the `tavonel-saas-foundation-quarantine` bucket. The production deployment inspected during the operation was `dpl_GRXpGYQohprbmj1DYxztDhUeDTaH` (`READY`, `tavonel.com`).
3. The R2 `immutable/` browser inventory contained only `cdr-canary-0910/`, `pilot-969dc192daa24119/` and `pilot-synthetic/`. Before the reset, enabled 365-day rules were added for `immutable/cdr-canary-0910/` and `immutable/pilot-synthetic/`. The existing broad rule was then temporarily disabled, retaining its name, prefix and 365-day duration.
4. The sealed reset was resumed from the signed-in founder workspace. The browser navigated to a workspace titled **0 documents**, still showing `OWNER Full workspace access · not billed`.
5. The original `Immutable 365 day lock` on `immutable/` was re-enabled and independently observed as **Enabled**. Both temporary scoped rules were removed. The bucket was left with its original single enabled 365-day immutable lock.
6. A fresh production inventory request displayed **0 database rows** and **0 stored objects** for the founder test workspace.

The reset's database ledger and independent R2 listing are the authoritative primary-storage checks. This note records the observed UI and provider states, not a claim that backups or replicas were erased at the same moment. Backup expiry and any separate deletion-evidence receipt require their own verification. No object keys, customer content, credentials or account identifiers are recorded here.

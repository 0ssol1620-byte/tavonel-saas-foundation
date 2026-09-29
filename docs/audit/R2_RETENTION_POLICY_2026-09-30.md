# R2 retention policy and storage canary — 2026-09-30

Operator: Codex under the founder's explicit launch/policy/test authorization in this thread.
Account: b74ca1a71497588b939c11b7614ff39d. Bucket: tavonel-saas-foundation-quarantine.

## Applied and re-read

- Replaced the blanket `immutable/` 365-day age lock with a 28-day age lock, named
  `Immutable 28 day recovery protection`. The planned self-service deletion eligibility
  remains 30 days after request. This is a scheduling design, not a measured completion SLA.
- Removed the `quarantine/` 365-day automatic expiration rule because it did not consult
  application legal holds. Automatic abort of incomplete multipart uploads after seven days
  remains. Source deletion must use the governed application sweeper.
- Production governance query before change: two policies, zero active legal holds, zero
  source deletion tombstones. No customer content was deleted by this policy change.
- Original lock/lifecycle API responses and target JSON are saved outside the repository at
  `D:/CodexProjects/tavonel-private-audit/scoped-admission-20260930/` for reversible restoration.

## Observed storage canary

The operator wrote only the literal synthetic text `TAVONEL retention canary. Synthetic test data only.`
into new workspace prefix `pilot-drill27d38d8a`. SHA-256:
`344535ff6166dcf3bf0cfebb00b947090ef70b7581a458b3fae63dca35d48615`.

- The quarantine probe was deleted and an independent GET returned `The specified key does not exist`.
- The immutable probe's delete CLI returned exit 0 and `Delete complete`, but a fresh GET still
  returned byte-identical content. Therefore command success was NOT accepted as purge evidence.
- A narrowly scoped expiration rule covers only this exact synthetic immutable object after
  29 days, beyond the 28-day lock. It does not cover a customer prefix.
- The canary used Wrangler 4.143.1 and the Cloudflare management API OAuth context. It proves
  storage behavior only. It does not prove the application's S3 credentials, tombstone RPC,
  full deletion sweeper, shared World closure, or backup expiration.

The attempted direct application-helper canary did not write an object: Vercel env pull masked
sensitive R2 key values, and R2 refused that masked credential with InvalidArgument. This is not
an observed production credential defect. No secret value is recorded in this report.

## Implementation consequence and remaining proof

The application sweeper now performs an independent post-delete HEAD and refuses to finalize
or issue a purge receipt if the object remains or verification fails. New unit cases cover both.
The pre-existing locked/unlocked application drill still needs production execution after the
source lifecycle migrations, backoff and shared World inventory are qualified and deployed.
The 28-day policy does not make a newly created locked canary immediately deletable, and this
report does not assert that it does. Customer processing and charging remain disabled.
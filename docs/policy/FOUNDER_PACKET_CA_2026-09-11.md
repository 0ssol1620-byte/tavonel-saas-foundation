# DRAFT — not in force — founder decision required

**Founder packet — competitive-audit remediation campaign, 2026-09-11 KST.**

Every item below is a decision an agent must not make. Nothing here has been acted on; each entry
says what is true today, what the decision is, and what the evidence is. Nothing in this packet is
published or linked from the site.

Ordered by what blocks the most other work, not by size.

- Compiled: 2026-09-11 KST, lane L9 (trust).
- Campaign: `TAVONEL-COMPETITIVE-AUDIT-20260911-V1`, executing
  `D:\TAVONEL_COMPETITIVE_AUDIT_2026-09-11_KO.md`.
- Cross-references: `DPA_DRAFT.md`, `INCIDENT_RESPONSE_RUNBOOK_DRAFT.md`,
  `SUPPORT_TARGETS_DRAFT.md`, `REFUND_THRESHOLD_DRAFT.md`.

---

## 1. ADR-0001 — shared workspace membership · audit S01, U01, I03

**Decision:** authorize the membership build, or keep Team on `contact` and say so for another
quarter.

**Today.** One user, one workspace; the workspace key is a pure function of the user id, with no way
to admit a second user. `nextjs/lib/workspace-tenancy.test.ts` fails CI the moment that stops being
true, the moment `BILLING_OFFERS.studio_access.saleChannel` stops being `"contact"`, or the moment a
route or migration introduces an invitation or seat table. `docs/adr/0001-…` is the full design,
status Proposed, decision owner founder. Nothing is implemented.

Three audit items are blocked on this and cannot be closed without it:

- **S01** — no roles, no SSO, no seat model. Published accurately on `/security` and `/trust`.
- **U01** — Team is `contact` because invitations, roles and seat accounting do not exist.
- **I03** — source-level access is enforced (answer, source-byte read, export, promotion each
  re-check it, and a check that cannot complete is a refusal) but its **grain is the workspace, not
  the member**. The audit's "two users, two sources, different ACL" test is not a state the system
  can be put into. `/security` now says this in those words.

**The smallest end-to-end design** (from the read-only pass, R5), if authorized — and it has to be
end to end, because a half-built invite either silently does nothing or reintroduces a cross-tenant
leak, which is stop-the-line item #1:

1. `invite` — an owner creates an invitation bound to an email and a role, with an expiry.
2. `accept` — the invited account binds to the **stored** workspace id, not to a derived one. This
   is the part that forces stored workspace identity and is why the ADR is large.
3. Roles `owner` / `admin` / `reviewer` / `member`, as the audit's 완료 판단 asks.
4. Per-role gates on the existing routes: who compiles, who reviews, who promotes, who exports, who
   manages keys and connections.
5. An audit event per membership act, and **revocation that takes effect on the next request** with
   no background reindex.
6. `supabase/tests/tenant_rls_matrix.sql` extended to a per-member, per-source matrix, run against a
   real Postgres — which is what finally closes I03.

**Do not confuse this with the enterprise control plane.** Migrations 0014/0015 already contain
`enterprise_organizations` / `enterprise_organization_memberships` with a role enum, a permission
function, and five routes gated on it — and no route implements `members:write`, so an owner cannot
add a second member. That is a *different* workspace concept from the derived key the product uses.
Conflating them is the most likely mistake here, and finishing the enterprise one does not fix U01.

**Evidence:** `docs/adr/0001-stored-workspace-identity-and-team-membership.md`;
`nextjs/lib/workspace-tenancy.test.ts`; `nextjs/lib/billing-catalog.ts`;
`nextjs/lib/connector-source-access.ts`; `supabase/migrations/0014_enterprise_control_plane.sql`.

**If the answer is "not now":** nothing changes and nothing is misstated. The copy is already
honest. Only say so, so the four dependent items can be recorded as deferred rather than open.

---

## 2. Packaging — Developer cannot activate what it is sold · audit P05, founder queue F-8

**Decision:** move the promotion gate down to Developer, restate what Developer includes, or open
Team to self-serve (which requires item 1 first).

**Today, read off the routes:**

| Act | Required plan |
|---|---|
| Compile a candidate | `observer` (Developer, $29) |
| Ask | `observer` |
| Promote a candidate to active | **`studio`** (Team, $99) |
| Roll back a world version | **`studio`** |
| Connect an OAuth source, or sync a connection | **`studio`** |

And `studio.saleChannel` is `"contact"`, so **Team cannot be bought at all**. The consequence: a
self-serve Developer customer can compile a candidate and cannot make it active, and cannot connect
a cloud source. Developer's published bullets are "Compile your own worlds", "Evidence, Ask and
signed export", "API and MCP access".

This is a packaging contradiction, not a copy bug: the fix is either a different gate or a different
bullet list, and only the founder decides which. An agent must not change an entitlement.

**Evidence:** `nextjs/app/api/collections/[id]/promote/route.ts:85,200`;
`nextjs/app/api/collections/[id]/world/rollback/route.ts:72`;
`nextjs/app/api/v1/oauth-connectors/**` and `nextjs/app/api/v1/connections/[id]/sync/route.ts:13`;
`nextjs/app/api/collections/[id]/ask/route.ts:148`; `nextjs/lib/billing-catalog.ts:15-60`.

---

## 3. Spreadsheet billable unit · audit P01

**Decision:** pick the unit. Two mechanically fair options; **not** a third.

**Today.** `page-count.ts` returns `{ pages: null, reason: "XLSX_BILLABLE_UNIT_UNDECIDED" }` for
xlsx and ods, and the workspace UI names those files instead of folding them into the estimate. The
honest mechanism is already built — the service refuses to invent a unit rather than quietly
charging by file size. What is missing is the number.

The cost of leaving it: a customer with an all-spreadsheet corpus cannot get a quote at all.

- **(a) Rendered PDF pages after conversion.** Same unit as everything else, computed after the
  sanitizer's conversion step, so it is shown as confirmed after the read rather than quoted
  up front.
- **(b) Populated-cell buckets**, with a published table.

**Do not ship a byte-size estimate.** That is precisely what `page-count.ts` was written to refuse.

Once chosen, it wires into `countXlsxPages`, gets a scenario row in the pricing page's usage fold,
and `page-count.test.ts` is updated. None of that is a founder act; the unit is.

---

## 4. RPO and RTO targets, and a drill cadence · audit O01

**Decision:** set a recovery point objective and a recovery time objective, or record that they stay
unset.

**What is now on record** (published on `/security` this campaign): on 2026-09-10 the production
database was restored from its 2026-09-08 16:33:31 UTC backup into a separate temporary project in
the same region; the catalog of the original and the restored copy was compared object by object and
all 431 matched; the temporary project was deleted when the check finished.

**What that is not.** It covered the database, not the document bytes in object storage, not a full
service recovery, and not a run through the customer-facing application — the execution record says
so itself. One drill demonstrates restorability. It is not an RPO, not an RTO, and not an ongoing
practice.

So `/security` and `/trust` now state the drill as a fact and keep "recovery objectives — not yet
answered" as an absence. Three things need a decision:

1. The RPO (how much data a customer may lose).
2. The RTO (how long they may be down).
3. A drill cadence. Quarterly is the usual answer and is itself a commitment — a published cadence
   that is missed is worse than none.

`DPA_DRAFT.md` §9 leaves the same gap, deliberately.

**Evidence:** `D:\TAVONEL_APPROVED_EXECUTION_2026-09-10.md`; the catalog-fingerprint receipt
`approved-db-catalog-receipt-20260910.json`; `docs/runbooks/P0_RETENTION_DELETION_RESTORE.md`.

---

## 5. Incident notification window · audit S03

**Decision:** pick the window, knowing who has to meet it.

`INCIDENT_RESPONSE_RUNBOOK_DRAFT.md` is written: severity tiers (SEV1 cross-tenant leak, data loss,
credential compromise, unsupported published claim, revoke past SLO, runaway spend → SEV3
contained), roles, evidence-preservation-before-remediation, a post-incident record format, and a
tabletop plan. One clause is left blank because it is the one with contractual weight.

| Window | Requires | Costs |
|---|---|---|
| 24 h from awareness | Someone reachable out of hours | The usual processor commitment; unmeetable today |
| 72 h from awareness | A daily check | Matches the GDPR **controller** deadline, leaving a controller-customer none of its own |
| "Without undue delay" | Nothing new | Honest at this team size; reads as evasive in procurement |

There is no out-of-hours path today: a SEV1 reported at 02:00 is found in the morning. **No window
shorter than that is truthfully publishable**, which is a second decision — add a rota, or accept
the honest longer window.

Whatever is chosen goes into `DPA_DRAFT.md` §8 and onto `/trust` in the same change.

---

## 6. DPA — commission the legal review · audit S02

**Decision:** engage a lawyer, and settle the four clauses an agent must not draft.

`DPA_DRAFT.md` exists as a reviewable starting text. It mirrors `/privacy`, incorporates
`/subprocessors` by reference rather than copying it, and mirrors the Seoul / global-infrastructure
disclosure. Four `[FOUNDER + LEGAL]` clauses are unwritten on purpose:

1. **Breach notification window** — item 5 above.
2. **Sub-processor change-notice period and objection right.** `/subprocessors` currently commits to
   recording a material change "before it applies to live customer processing", with no number of
   days. A DPA normally names one.
3. **Deletion completion time.** Needs a measured run of the real deletion path first (item 7). The
   draft commits to the act and not to the clock, and a reviewer should know that was chosen.
4. **International transfer mechanism.** If any customer is in the EEA or the UK, this needs the
   SCCs or the UK Addendum annexed with the module and role mapping chosen, plus a transfer impact
   assessment. None exists. If the customer base is Korea-only, the analysis is simpler. **This is
   the clause most likely to be wrong if drafted by analogy.**

Until the review is recorded, `/trust`'s "no DPA is published" row is correct and stays.

---

## 7. Deletion completion time · audit S04

**Decision:** authorize a measured deletion run, then decide whether to publish the number.

`/privacy` now states the mechanics honestly: what happens immediately (a disconnect deletes the
stored provider refresh token before the revoke and errors rather than reporting success; a removed
source is suspended and refused on the next answer, read, export and promotion), that everything
else is a verified request carried out by a person because no route deletes an object, a source or a
workspace, and that no completion time, no backup-expiry day count and no log retention period is
published because none has been measured.

To publish a number, someone has to delete a synthetic workspace and time each stage — object
storage purge, database rows, provider backup expiry per the provider's own stated schedule, logs.
`docs/runbooks/P0_RETENTION_DELETION_RESTORE.md` already specifies the shape;
`issueDeletionEvidence` in `nextjs/lib/operations-p0.ts` is the receipt gate and **nothing calls
it**, which is why the page promises no receipt.

Backup-tier timing is partly outside our control, so the published number has to reflect the
provider's schedule rather than an assumption about it.

---

## 8. Support response target · audit O06

**Decision:** approve, lower, or decline to publish.

`SUPPORT_TARGETS_DRAFT.md` proposes the smallest target one person can hit: best-effort
acknowledgement within one business day, KST business hours, no resolution target, security reports
read first. Deliberately not "24 hours" — one business day and 24 hours differ by a weekend, and the
weekend is exactly when the promise would break.

Declining to publish a target is a legitimate answer. Publishing a target nobody measures is not:
the draft requires the acknowledgement time to be recorded and already meeting the target before it
goes live.

---

## 9. Refund bright line · audit P07

**Decision:** fix the percentage, and commission the consumer-law check.

`REFUND_THRESHOLD_DRAFT.md` proposes: full refund within 14 days unless **more than 20% of the
plan's included pages have been processed** in the current period, **or** a compiled world has been
promoted to active, whichever comes first — with mandatory consumer rights unaffected and the defect
path assessed separately, as now.

At Developer, 20% is 100 of 500 pages: a genuine evaluation fits inside it, a full corpus run does
not. **The 20% is a proposal with nothing measured behind it.**

Unreachable today — `liveChargesEnabled` is false and `/refunds` renders the pilot template — but
the current vague sentence ships verbatim the moment checkout opens, so it is worth settling before
launch day rather than on it. The legal questions (digital-content withdrawal exceptions, whether a
metered allowance is "content delivered" or partial performance, jurisdictions in scope) are in the
draft's §5.

---

## 10. LICENSE for the public repository · audit R8-GH02

**Decision:** pick one of three. **This has a live legal edge and it is on a public repository.**

`tavonel-saas-foundation` is public, has **no LICENSE file** (verified: the contents API returns
404), and its own tracked root `package.json` declares `"license": "MIT"`. So a dependency scanner
or a downstream consumer reading `package.json` today concludes MIT and may fork or redistribute on
that belief, while GitHub's UI and default copyright law say all rights reserved.

The repository's own README documents the conflict and instructs contributors not to resolve it
unilaterally, which is why no agent has touched either file and none should.

- **(a) Add a real MIT LICENSE**, accepting that the code becomes genuinely reusable under MIT terms
  — and noting that this settles copyright only and **never patent freedom to operate**.
- **(b) Change `package.json` to match the all-rights-reserved intent** (`"UNLICENSED"` or a
  proprietary marker).
- **(c) Publish a different licence.**

After the decision, a licence scanner should report the same value from both files.

---

## 11. GitHub Actions billing on the private repository · audit R8-GH03

**Decision:** pay the failed invoice or raise the Actions spending limit. Nobody else can.

Every recent workflow run on `ai-knowledge-compiler` completes with conclusion `failure` in five to
eight seconds. The check-run annotation is GitHub's own: "The job was not started because recent
account payments have failed or your spending limit needs to be increased."

This affects **every** workflow on every push and PR, including the security-relevant ones —
dependency audit, IP privilege guard, filesystem and IaC — with CodeQL and dependency-review
skipped downstream. Practically: none of the open PRs on that repository has any CI signal at all.

The risk while it is blocked: the repository is effectively un-gated, and its stated CI and security
checks are silently not running. It currently reads as *failure* rather than as falsely green, which
is the safer of the two, but a red badge that means "unpaid" is one a human can misread as "my code
is broken" and force-merge past.

**Until it is resolved, treat every red badge there as `unknown`, not as `broken`.** Do not disable
required checks to work around it.

---

## 12. Customer-data activation · the gate list

**Decision:** none yet, and the list below is the reason. `activationPolicy.customerData.enabled` is
`false` and stays false until a founder approval receipt exists.

`docs/CUSTOMER_DATA_GATE_2026-09-06.md` enumerates seventeen preconditions with evidence per row.
Current standing, from that document: **2 EXIST, 8 PARTIAL, 7 MISSING.**

The seven MISSING, because these are the actual work items and not a checklist to tick:

| # | Precondition | What is missing |
|---|---|---|
| 2 | `encryption_at_rest_verified` | Platforms encrypt at rest; no dated verification record exists here, and a provider's marketing page is not a receipt |
| 8 | `compile_receipts_signed_and_audited` | Ed25519 signing exists for the trust export only; `CompileReceipt` is unsigned and no compile path writes an audit event |
| 9 | `deletion_tombstone_propagation_verified` | Google Drive lists with `trashed = false`, so a trashed file leaves the listing with no downstream signal. Connector qualification is **BLOCKED** on this |
| 11 | `data_export_and_delete_available` | No route exports or deletes customer sources; deletion is an on-request process |
| 14 | `per_provider_isolation_verified` | Nothing tests that one provider's credential or content cannot reach another provider's code path |
| 16 | `per_source_acl_preserved` | ACL snapshot storage is defined; no connector captures an ACL and no retrieval path filters by one. Storage is not enforcement |
| 17 | `founder_approval_receipt_recorded` | **MISSING by design.** Recording it is not an agent's act, in this campaign or any other |

The most load-bearing PARTIAL, worth naming separately: **#1 `tenant_isolation_suite_passed`** —
`supabase/tests/tenant_rls_matrix.sql` is written and a contract test asserts it *covers* ten
browser-readable relations by reading the SQL as text, but **no runner executes it**. The isolation
suite has never run against Postgres in this repository. That is also why audit **S07** (a
cross-tenant attack pass) is prepared this campaign as a spec against fixtures only.

Also worth a decision: **#13** — Microsoft Graph asks for `Files.Read.All` and `Sites.Read.All`,
which is tenant-wide read, not least privilege for one workspace.

---

## 13. Releases other lanes are blocked on

Recorded here so the packet is complete; the detail belongs to those lanes' own reports.

- **CDR release for text inputs** — lane L5 (input). A release decision, not a code change.
- **Core V2 release for the lane L3 / L4 flags** — Core V2 is deployed by CLI from
  `codex/tavonel-p0p2-productization` and is not git-linked, so a release is a deliberate act. The
  L3 equivalence gate and the L4 identity work land behind it.
- Neither is an agent's call, and neither was touched.

---

## 14. Items this campaign did not implement, recorded rather than dropped

Not silently deferred — each is in the lane contract's own list: D02–D09 (native Office wiring,
needs the Core V2 release), I01/I02/I05 (provider and graph targets), U01/S01 (this packet's item 1),
P01 unit (item 3), P05/F-8 (item 2), S05 (Korean data residency) and S06 (customer-managed keys),
O03/O05 (load and failure injection — need auth and spend), U04 (a fresh-account funnel run),
G01/G02/G05 (market data, customer consent, i18n), B05 (nav order needs click data), ST01/ST02,
E01 (needs committed Arena artifacts), S07 (live cross-tenant attack pass), TM05, K06.

**S05 and S06 are worth a sentence each**, because a buyer asks for both and both are honestly
published as absent today: there is no Korean data-residency guarantee (R2 location hints are
best-effort, and `/privacy` says so) and there is no customer-managed key (`/security` and
`/trust` say so). Neither absence was created by this campaign and neither was hidden by it.

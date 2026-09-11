# TAVONEL Data Processing Agreement

<!-- One line on purpose: `lib/trust-page-answers.test.ts` pins this label as a single string, so a
     wrap would split the label from the document it labels. Customer wording, per the "Public
     wording of delegated values" section of `docs/policy/DECISION_LOG_2026-09-11.md` (FD-06/07):
     the reader is told the document's status, not the process behind it. -->

**Draft v1 (2026-09-11) — under review; not a signed agreement.**

This text is published so that a security or procurement reviewer can read the terms before
asking for them. It has not been reviewed by a lawyer, it is not executed, and it binds nobody
until it is signed. Clauses that are not drafted say so, in place, rather than being left out.

Three commitments in it are written down and will not move without a new version of this document:
the breach notification window (§8), the sub-processor change notice and objection right (§6), and
the deletion completion time (§7). The clauses marked **Not drafted — pending legal review** are
the ones still open.

**Nothing in this draft is agreed by the operating entity yet.** The three numbers above are
written into this version and are under review; any of them may change, and a change is a new
version of this document rather than an edit to this one.

Where this document and a published page disagree, the published page — `/privacy`,
`/subprocessors`, `/security`, `/terms` — is the statement in force and this document is the
error.

---

## 1. Parties and roles

| | |
|---|---|
| Processor | TAVONEL. The operating entity's registered name, registration number and address are supplied on the signature version; the site's operator disclosure is environment-driven and is not published in the pilot deployment. |
| Controller | The customer signing the agreement. |
| Subject matter | Processing of the customer's documents and account data to compile them into a traceable knowledge world, and to operate, secure and support that service. |
| Duration | The term of the service agreement, plus the period in §7. |
| Governing law | Not drafted — pending legal review. Korea and the EU treat several clauses below differently and this draft does not assume which applies. |

The customer is the controller of the personal data contained in the documents they upload or
connect. TAVONEL processes it only on the customer's instructions, which are given by the
customer's use of the service and by this agreement, and for no other purpose.

If the documents contain personal data of the customer's own end users, the customer remains
responsible for having a lawful basis for that data and for giving those people notice. TAVONEL
has no relationship with them and no way to identify them.

## 2. Categories of data, and what is done with each

Mirrors `/privacy`.

| Category | Source | Processing purpose |
|---|---|---|
| Account identifiers | Google OAuth | Authenticate the user; bind a workspace |
| Workspace and entitlement metadata | The service | Authorization, quota, billing state |
| Source files | Uploaded or connected by the customer | Compile the knowledge world requested |
| Derived artifacts (reading output, citations, compiled objects, relations, claims) | Produced from the source files | Deliver the compiled result and its evidence |
| Security and operational logs | The service | Operate the service, investigate abuse and incidents |
| Billing identifiers | Paddle | Record and reconcile a transaction |
| Inquiry contact details | The customer's contact form submission | Answer the inquiry |

Two commitments that already appear on `/privacy`, restated because a DPA is where a buyer looks
for them:

- Customer document contents are **not** used to train shared models.
- Personal data is **not** sold.

## 3. Instructions, and the limits of them

TAVONEL processes on documented instructions only. Where the law of a jurisdiction requires
processing beyond those instructions, TAVONEL informs the customer before processing unless that
law forbids the notice.

TAVONEL will tell the customer if, in its opinion, an instruction infringes applicable data
protection law. It will not silently comply with an instruction it believes is unlawful.

## 4. Confidentiality

Personnel with access to customer data are bound by confidentiality obligations that survive the
end of their engagement, and are granted access only to the extent their work requires it.

Stated plainly rather than as "a limited number of authorized personnel": the number of people
with production access today is one.

## 5. Security measures

The technical and organizational measures are the ones stated on `/security`, incorporated by
reference at the version in force on the signature date, with a copy of that version given to the
customer as an annex. They are not paraphrased here, because a clause that paraphrases a live page
drifts from it.

Three properties are called out because a buyer's checklist asks for them and the honest answer
differs from the expected one:

- **Access control is a workspace membership checked server-side on every request.** There are no
  roles, no SSO and no seat model in this deployment, so the account that owns a workspace is the
  account that reaches it. Source-level access is enforced on the answer, the source-byte read,
  the export and the promotion, and its grain is the workspace, not the member.
- **Encryption** is TLS in transit throughout, and at rest by the storage provider. There is no
  customer-managed key.
- **No recovery objective is committed.** One database restore drill was performed and verified on
  2026-09-10; a recovery point objective and a recovery time objective are not set. §9 says so
  rather than implying otherwise.

Material degradation of a measure is not permitted. Changes that maintain or improve the level of
protection are permitted and are reflected on `/security`.

## 6. Sub-processors

The customer gives general authorization for the sub-processors listed at
**`https://tavonel.com/subprocessors`**, which is incorporated by reference and is the
authoritative list. It is not duplicated here: a copy in a contract goes stale the moment a
provider changes, and a stale sub-processor list in a signed DPA is a breach of it.

At the date of this draft that page names Supabase, Vercel, Cloudflare, RunPod, Paddle, Resend and
Google, each with the purpose and data class it is permitted to process.

**Change notice and objection.** TAVONEL notifies the customer of an intended addition or
replacement of a sub-processor **30 days in advance of that sub-processor beginning to process
customer personal data**. The customer may object within those 30 days on reasonable
data-protection grounds. Where an objection is not resolved, the customer may terminate the
affected part of the service.

TAVONEL imposes data protection obligations on each sub-processor no less protective than this
agreement, and remains liable for their performance.

## 7. Deletion and return

Mirrors `/privacy`. Where the two differ, `/privacy` is the published statement.

**Completion time.** On the customer's verified deletion request, or on termination, deletion is
**completed within 30 days of the verified request**. Before requesting it, the customer can
export their compiled worlds as signed packages.

What the current service actually does, stated rather than smoothed:

- Disconnecting a connected source deletes the stored provider refresh token immediately, before
  the connection is marked revoked, and returns an error rather than reporting success if that
  deletion fails.
- Removing or losing access to a connected source suspends it, and a suspended source is refused
  on the next answer, source-byte read, export and promotion.
- There is no self-service action that deletes a workspace, a source or a derived artifact. A
  verified request to `privacy@tavonel.com` is carried out by a person, and the 30 days above is
  the commitment on that person.
- A copy of a deleted database row can persist in the database provider's own backups until those
  age out on the provider's schedule. That schedule is the provider's, it has not been verified
  against this project, and TAVONEL publishes no day count for it. The 30-day commitment is on
  the live systems TAVONEL operates and not on a provider's backup expiry.
- Security and operational logs are retained for security and abuse investigation, with no
  published retention period.
- TAVONEL cannot currently issue a machine-verifiable deletion receipt. The receipt contract
  exists in the codebase and refuses to issue one unless the storage listing is empty, the
  database lookup is empty, the backup expiry is recorded and the audit digest verifies — and no
  part of the running service calls it. A completed deletion is recorded in the operational record
  and confirmed to the customer in writing.

## 8. Personal data breach

TAVONEL notifies the customer of a personal data breach affecting the customer's personal data
**without undue delay and no later than 72 hours after becoming aware** of it. The notification
states the nature of the breach, the categories and approximate volume of data and records
affected, the likely consequences, the measures taken or proposed, and a contact point for further
information. TAVONEL assists the customer in meeting its own notification obligations.

What that commitment rests on, stated so a reviewer can weigh it: **there is no on-call rotation.**
The service is operated by a single person, `security@tavonel.com` and `support@tavonel.com` are
inboxes read by that person, and there is no pager and no out-of-hours path. 72 hours is the window
a daily check can meet; a shorter one would require a rota that does not exist. The internal
procedure behind this clause is the incident response runbook, whose customer-facing summary is on
`/trust`.

"Becoming aware" means the point at which TAVONEL has a reasonable degree of certainty that a
security incident has led to personal data being compromised. Suspicion is classified as an
incident immediately; the 72 hours runs from awareness, not from classification.

## 9. Availability, backup and recovery

No recovery point objective, no recovery time objective and no backup retention period is
committed. `/security` states the same.

One restore drill is on record: on 2026-09-10 the production database was restored from its
2026-09-08 16:33:31 UTC backup into a separate temporary project, the catalog of the original and
the restored copy matched on all 431 objects, and the temporary project was deleted. That drill
covered the database. It did not cover the document bytes in object storage, a full service
recovery, or a run through the customer-facing application. The catalog-fingerprint receipt is
available to a customer on request.

Whether to commit a recovery objective and a drill cadence: not drafted — pending legal review.

## 10. International transfers

Mirrors `/privacy`.

The database is configured in Seoul. Vercel, Cloudflare, RunPod, Resend, Google and Paddle may
process limited data through global infrastructure or support systems outside Korea; the exact
processor, purpose and data category for each is on `/subprocessors`. Cloudflare R2 location hints
are best-effort and are **not** a guarantee of Korean data residency. No data residency is
guaranteed by this agreement.

Transfer mechanism: **not drafted — pending legal review.** If any customer is in the EEA or the
UK this clause needs the Standard Contractual Clauses, or the UK Addendum, as an annex, with the
module and role mapping chosen and a transfer impact assessment. None of that exists yet. If the
customer base is Korea-only the analysis is different and simpler. This is the clause most likely
to be wrong if it is drafted by analogy, which is why it is left open instead.

## 11. Audit and information rights

TAVONEL makes available the information necessary to demonstrate compliance with this agreement,
and allows for an audit by the customer or an auditor it mandates, on reasonable notice, no more
than once in twelve months unless a breach or a supervisory authority requires otherwise.

Stated plainly, because a buyer will ask: **there is no SOC 2 report, no ISO 27001 certificate and
no independent penetration-test report for this deployment.** An external penetration test is
planned after the first paying customer; SOC 2 timing is not set. The audit right in this clause is
therefore a real right to look, not a right to be handed a report that exists.

## 12. Data subject requests

TAVONEL assists the customer in responding to access, correction, export, restriction and deletion
requests, and forwards a request it receives directly from a data subject to the customer rather
than answering it, unless instructed otherwise. Requests reach `privacy@tavonel.com`; the requester
is verified before anything is acted on.

## 13. Liability, term, precedence

Not drafted — pending legal review. Liability cap, indemnities, precedence between this agreement
and the service terms, signature blocks and the annexes (the `/security` version in force, the
`/subprocessors` snapshot, and the transfer clauses if §10 needs them).

---

## What has to happen before this is a signable document

- The three commitments below confirmed by the operating entity
- Lawyer reviewed, jurisdiction chosen, and the review recorded
- Operating entity, registration number and address filled in (§1)
- Transfer mechanism decided; Standard Contractual Clauses annexed if any customer is in the EEA
  or the UK (§10)
- Recovery objectives either committed or explicitly excluded (§9)
- Liability, precedence and signature blocks drafted (§13)

Written down, and not re-opened by an agent on its own: the 72-hour breach notice (§8), the 30-day
sub-processor change notice with a right to object (§6), and deletion completed within 30 days of a
verified request (§7). All three are under review, and a change to any of them is a new version of
this document.

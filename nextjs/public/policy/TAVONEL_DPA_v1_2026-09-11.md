# TAVONEL Data Processing Agreement

**Draft v1 (2026-09-11) — under review; not a signed agreement.**

This text is published so that a security or procurement reviewer can read the terms before
asking for them. It has not been reviewed by a lawyer, it is not executed, and it binds nobody
until it is signed. Clauses that are not drafted say so, in place, rather than being left out.

Three commitments in it are written down and will not move without a new version of this document:
the breach notification window (§8), the sub-processor change notice and objection right (§6), and
the deletion completion time (§7). The clauses that are completed at signature are marked in place
and collected in Annex A.

Where this document and a published page disagree, the published page — `/privacy`,
`/subprocessors`, `/security`, `/terms` — is the statement in force and this document is the
error.

---

## 1. Parties and roles

| | |
|---|---|
| Processor | TAVONEL. The operating entity's registered name, representative, business registration number and registered address are the ones published in the operator disclosure on this site's terms and privacy pages, and they are restated in the signature version. |
| Controller | The customer signing the agreement. |
| Subject matter | Processing of the customer's documents and account data to compile them into a traceable knowledge world, and to operate, secure and support that service. |
| Duration | The term of the service agreement, plus the period in §7. |
| Governing law | The Republic of Korea, with the Seoul Central District Court as the court of exclusive jurisdiction. The service terms state the same, and a consumer's right to bring a claim in the country where they live is unaffected. |

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

## 5. Security measures

The technical and organizational measures are the ones stated on `/security`, incorporated by
reference at the version in force on the signature date, with a copy of that version given to the
customer as an annex. They are not paraphrased here.

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
authoritative list. It is not duplicated in this document.

At the date of this draft that page names Supabase, Vercel, Cloudflare, Google Cloud, RunPod,
Paddle, Resend and Google, each with the purpose, the data class it is permitted to process, and
the region it is configured to process in.

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

What that commitment rests on, stated so a reviewer can weigh it: **the service is operated by one
person, without a 24-hour rota.** `security@tavonel.com` and `support@tavonel.com` are inboxes
that person reads directly. 72 hours is the window a daily check can meet, and that is why the
committed window is 72 hours rather than shorter. The internal procedure behind this clause is the
incident response runbook, whose customer-facing summary is on `/trust`.

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

Recovery objectives and a drill cadence: to be specified in the executed version — see Annex A.

## 10. International transfers

Mirrors `/privacy`.

The database and the application's serverless functions are configured in Seoul. The content
disarm and reconstruction service that rasterizes and scans every source — the first component to
hold document bytes — runs on Google Cloud Run in `asia-northeast3` (Seoul), orchestrated by a
Cloudflare worker on Cloudflare's edge network. The GPU OCR that reads the sanitized result runs
on a RunPod endpoint for which this deployment pins no region, and `/subprocessors` says so rather
than naming one. Cloudflare, RunPod, Resend, Google and Paddle may process limited data through
global infrastructure or support systems outside Korea; the exact processor, purpose, data
category and configured region for each is on `/subprocessors`. Cloudflare R2 location hints are
best-effort and are **not** a guarantee of Korean data residency. No data residency is guaranteed
by this agreement.

**Transfer mechanism: the Standard Contractual Clauses.** Where the customer is established in
the European Economic Area, the European Commission's Standard Contractual Clauses of 4 June 2021
apply to a transfer of personal data outside the EEA, with Module Two (controller to processor)
between the customer as data exporter and TAVONEL as data importer, and Module Three where TAVONEL
onward-transfers to a sub-processor. Where the customer is established in the United Kingdom, the
UK International Data Transfer Addendum to those clauses applies on the same modules. The clauses
are incorporated into the executed version and prevail over any conflicting term of this agreement
for the transfer they cover.

The completed annexes to those clauses — the parties, the described processing, the technical and
organizational measures, the sub-processor list, and a transfer impact assessment — are attached at
signature, and are drawn from §2, §5 and §6 of this agreement and from `/subprocessors`. See
Annex A.

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

**Liability.** Each party's total liability arising out of or relating to this agreement is
limited to the fees paid to TAVONEL in the twelve months immediately before the event giving rise
to the claim, and neither party is liable for indirect, incidental, special or consequential loss.
That limit does not apply to death or personal injury caused by negligence, to fraud or fraudulent
misrepresentation, to a party's breach of its confidentiality obligations, to a party's indemnity
obligations, or to anything else the law does not allow to be limited. The service terms state the
same cap for the service agreement, and the two are one limit rather than two: a claim does not
recover the cap twice for the same facts.

**Term.** This agreement runs for the term of the service agreement, plus the period in §7.

**Precedence.** Where the Standard Contractual Clauses or the UK Addendum conflict with this
agreement, they prevail for the transfer they cover. Where this agreement conflicts with the
service terms on the processing of personal data, this agreement prevails. Where this agreement
conflicts with a published page — `/privacy`, `/subprocessors`, `/security`, `/terms` — the
published page is the statement in force, as stated at the top of this document.

**Signature.** The signature blocks and the parties' registered details are completed in the
executed version — see Annex A.

---

## Annex A — clauses completed at signature

Each clause below is marked in place in the body of this document and is completed in the executed
version. Until then this document is a draft and is not signed.

| Clause | Completed at signature |
|---|---|
| §9 Recovery objectives | A recovery point objective, a recovery time objective and a drill cadence, or an express exclusion of them |
| §10 Transfer annexes | The completed annexes to the Standard Contractual Clauses and the UK Addendum: the parties, the described processing, the technical and organizational measures, the sub-processor list, and a transfer impact assessment |
| §13 Signature | The signature blocks and the parties' registered details |

Four terms this draft states are not changed by Annex A: the 72-hour breach notification (§8), the
30-day sub-processor change notice with a right to object (§6), deletion completed within 30 days
of a verified request (§7), and the liability cap and governing law (§1, §13). A change to any of
them is a new version of this document.

Governing law, jurisdiction, the transfer mechanism and the liability cap left this annex on
2026-09-16 and are stated in the body above. They are Draft v1 wording and have not been reviewed
by a lawyer; the label at the top of this document is the one to read before relying on them.

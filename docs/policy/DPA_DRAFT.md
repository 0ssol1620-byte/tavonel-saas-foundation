# DRAFT — not in force — founder/legal review required

**This document binds nothing.** It is not published, not linked from the site, not offered to
any customer, and not signed. It exists so that the founder and a qualified lawyer have a
starting text to review rather than a blank page. Audit item **S02**.

Do not publish this, quote it to a prospect, or attach it to a pilot agreement until a lawyer
has reviewed it and the founder has recorded the review. `/trust` continues to say that no DPA
is published, and that row is correct until the reviewed version exists.

**Every `[FOUNDER]` marker below is a decision an agent must not make.** They are collected in
`FOUNDER_PACKET_CA_2026-09-11.md`.

- Drafted: 2026-09-11 KST, competitive-audit remediation campaign, lane L9.
- Status: `PROPOSED`.
- Mirrors, and must not diverge from: `/privacy`, `/subprocessors`, `/security`, `/terms`.
- Governing law and jurisdiction: `[FOUNDER + LEGAL]`. Korea and the EU treat several clauses
  below differently and the draft does not assume which one applies.

---

## 0. Why the wording is careful in three specific places

These are the places where a plausible sentence would create an obligation the running service
cannot keep today. A lawyer reviewing this should know that they were deliberate, not omissions.

1. **Deletion has no completion time.** The service publishes none, because none has been
   measured against the real deletion path (see `/privacy`). §7 says what happens and does not
   say how long, and a lawyer who inserts "within 30 days" is committing the company to an
   unmeasured number.
2. **Incident notification has no window.** §8 is a placeholder for exactly that reason: the
   window is the clause with contractual weight, and it depends on the incident-response
   procedure that does not exist yet (`INCIDENT_RESPONSE_RUNBOOK_DRAFT.md`, audit S03).
3. **There are no roles, no SSO and no seat model.** §5's access controls describe a
   single-member workspace, because that is what exists. Do not write role-based access control
   into a DPA before it is built.

---

## 1. Parties and roles

| | |
|---|---|
| Processor | `[FOUNDER]` — the operating entity, its registration number and its address. The site's operator disclosure is environment-driven and is not published in the pilot deployment. |
| Controller | The customer signing the agreement. |
| Subject matter | Processing of the customer's documents and account data to compile them into a traceable knowledge world, and to operate, secure and support that service. |
| Duration | The term of the service agreement, plus the period in §7. |

The customer is the controller of the personal data contained in the documents they upload or
connect. TAVONEL processes it only on the customer's instructions, which are given by the
customer's use of the service and by this agreement, and for no other purpose.

If the documents contain personal data of the customer's own end users, the customer remains
responsible for having a lawful basis for that data and for giving those people notice. TAVONEL
has no relationship with them and no way to identify them.

## 2. Categories of data, and what is done with each

Mirrors `/privacy` exactly. If these two diverge, `/privacy` is the published statement and this
clause is the error.

| Category | Source | Processing purpose |
|---|---|---|
| Account identifiers | Google OAuth | Authenticate the user; bind a workspace |
| Workspace and entitlement metadata | The service | Authorization, quota, billing state |
| Source files | Uploaded or connected by the customer | Compile the knowledge world requested |
| Derived artifacts (reading output, citations, compiled objects, relations, claims) | Produced from the source files | Deliver the compiled result and its evidence |
| Security and operational logs | The service | Operate the service, investigate abuse and incidents |
| Billing identifiers | Paddle | Record and reconcile a transaction |
| Inquiry contact details | The customer's contact form submission | Answer the inquiry |

Two commitments that already appear on `/privacy` and are restated here because a DPA is where a
buyer looks for them:

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

`[FOUNDER]` — the number of people with production access, and whether that list is disclosed to
a customer on request, is a decision, not a drafting choice. Do not write "a limited number of
authorized personnel" without knowing the number.

## 5. Security measures

The technical and organizational measures are the ones stated on `/security` and are not restated
in prose here, because a DPA that paraphrases a live page drifts from it. The clause incorporates
the page by reference, at the version in force on the signature date, and the customer is given a
copy of that version as an annex.

Three properties of the measures are called out because a buyer's checklist asks for them and the
honest answer differs from the expected one:

- **Access control is a workspace membership checked server-side on every request.** There are no
  roles, no SSO and no seat model in this deployment, so the account that owns a workspace is the
  account that reaches it. Source-level access is enforced on the answer, the source-byte read,
  the export and the promotion, and its grain is the workspace, not the member.
- **Encryption** is TLS in transit throughout, and at rest by the storage provider. There is no
  customer-managed key. (Audit S06 — a `[FOUNDER]` item, not promised here.)
- **No recovery objective is committed.** One database restore drill was performed and verified
  on 2026-09-10; an RPO and an RTO are not set. §9 says so rather than implying otherwise.

Material degradation of a measure is not permitted. Changes that maintain or improve the level of
protection are permitted and are reflected on `/security`.

## 6. Sub-processors

The customer gives general authorization for the sub-processors listed at
**`https://tavonel.com/subprocessors`**, which is incorporated by reference and is the
authoritative list. It is not duplicated here: a copy in a contract goes stale the moment a
provider changes, and a stale sub-processor list in a signed DPA is a breach of it.

At the drafting date, that page names: Supabase, Vercel, Cloudflare, RunPod, Paddle, Resend and
Google, each with the purpose and data class it is permitted to process.

`[FOUNDER]` — the change-notice period before a new sub-processor begins processing customer
data, and whether the customer may object. `/subprocessors` currently commits to recording a
material change "before it applies to live customer processing", with no number of days. A DPA
normally names a period (commonly 30 days) and an objection right; both are commitments and
neither is set. **Do not write a number here.**

TAVONEL imposes data protection obligations on each sub-processor no less protective than this
agreement, and remains liable for their performance.

## 7. Deletion and return

Mirrors `/privacy`. Where the two differ, `/privacy` is the published statement.

On the customer's verified request, or on termination, source material and derived artifacts are
removed from object storage and from the database. Before that, the customer can export their
compiled worlds as signed packages.

What the current service actually does, stated rather than smoothed:

- Disconnecting a connected source deletes the stored provider refresh token immediately, before
  the connection is marked revoked, and returns an error rather than reporting success if that
  deletion fails.
- Removing or losing access to a connected source suspends it, and a suspended source is refused
  on the next answer, source-byte read, export and promotion.
- There is no self-service action that deletes a workspace, a source or a derived artifact. A
  verified request to `privacy@tavonel.com` is carried out by a person.
- **No completion time is committed**, because none has been measured against the real path.
- A copy of a deleted database row can persist in the database provider's own backups until those
  age out on the provider's schedule. TAVONEL publishes no day count for that, because the
  schedule is the provider's and has not been verified against this project.
- Security and operational logs are retained for security and abuse investigation, with no
  published retention period.
- TAVONEL cannot currently issue a machine-verifiable deletion receipt. The receipt contract
  exists in the codebase and refuses to issue one unless the storage listing is empty, the
  database lookup is empty, the backup expiry is recorded and the audit digest verifies — and no
  part of the running service calls it. A completed deletion is recorded in the operational record
  and confirmed to the customer in writing.

`[FOUNDER + LEGAL]` — a DPA usually commits to deletion "within N days of termination". That
number requires a measured run of the real deletion path first (audit S04). Until it is measured,
this clause commits to the act and not to the clock, and a reviewer should be told that this was
a choice.

## 8. Personal data breach — PLACEHOLDER, tied to S03

**This clause is not drafted.** It depends on `INCIDENT_RESPONSE_RUNBOOK_DRAFT.md`, which defines
severity, ownership, evidence preservation and the customer notification path. There is no
written incident procedure in force today, and `/trust` says so.

The shape it will take, so the reviewer can see what is missing:

> TAVONEL notifies the customer without undue delay and in any event within `[FOUNDER]` hours of
> becoming aware of a personal data breach affecting the customer's personal data, providing the
> nature of the breach, the categories and approximate volume affected, the likely consequences,
> the measures taken or proposed, and a contact point. TAVONEL assists the customer in meeting its
> own notification obligations.

`[FOUNDER]` — the notification window is the clause in this document with the most contractual
weight. 72 hours is the common figure and matches the GDPR controller deadline, which means a
processor promising 72 hours leaves its controller no time at all; 24 hours is the usual
processor-side commitment and requires someone to be reachable. **Do not fill this in without
knowing who is on call.** Today, nobody formally is.

## 9. Availability, backup and recovery

No recovery point objective, no recovery time objective and no backup retention period is
committed. `/security` states the same.

One restore drill is on record: on 2026-09-10 the production database was restored from its
2026-09-08 16:33:31 UTC backup into a separate temporary project, the catalog of the original and
the restored copy matched on all 431 objects, and the temporary project was deleted. That drill
covered the database. It did not cover the document bytes in object storage, a full service
recovery, or a run through the customer-facing application. The catalog-fingerprint receipt is
available to a customer on request.

`[FOUNDER]` — whether to commit an RPO and an RTO in this agreement, and to a drill cadence.

## 10. International transfers

Mirrors `/privacy`.

The database is configured in Seoul. Vercel, Cloudflare, RunPod, Resend, Google and Paddle may
process limited data through global infrastructure or support systems outside Korea; the exact
processor, purpose and data category for each is on `/subprocessors`. Cloudflare R2 location
hints are best-effort and are **not** a guarantee of Korean data residency (audit S05 — the
absence is deliberate and published).

`[FOUNDER + LEGAL]` — the transfer mechanism. If any customer is in the EEA or the UK, this
clause needs the Standard Contractual Clauses (or the UK Addendum) as an annex, with the module
and the role mapping chosen, and a transfer impact assessment. None of that exists. If the
customer base is Korea-only, the analysis is different and simpler. **This is the clause most
likely to be wrong if it is drafted by analogy.**

## 11. Audit and information rights

TAVONEL makes available the information necessary to demonstrate compliance with this agreement,
and allows for an audit by the customer or an auditor it mandates, on reasonable notice, no more
than once in twelve months unless a breach or a supervisory authority requires otherwise.

Stated plainly, because a buyer will ask: **there is no SOC 2 report, no ISO 27001 certificate and
no independent penetration-test report for this deployment, and none has been commissioned.**
`/trust` says the same. An audit right in this clause is therefore a real right to look, not a
right to be handed a report that exists.

## 12. Data subject requests

TAVONEL assists the customer in responding to access, correction, export, restriction and
deletion requests, and forwards a request it receives directly from a data subject to the
customer rather than answering it, unless instructed otherwise. Requests reach
`privacy@tavonel.com`; the requester is verified before anything is acted on.

## 13. Liability, term, precedence

`[FOUNDER + LEGAL]` — liability cap, indemnities, precedence between this agreement and the
service terms, signature blocks and any annexes (SCCs, the `/security` version in force, the
`/subprocessors` snapshot). Not drafted.

---

## Checklist before this becomes a real document

- [ ] Lawyer reviewed, jurisdiction chosen, and the review recorded
- [ ] Operating entity, registration number and address filled in (§1)
- [ ] Breach notification window decided, with someone on call to meet it (§8)
- [ ] Sub-processor change-notice period and objection right decided (§6)
- [ ] Deletion completion time measured against the real path, then committed or not (§7)
- [ ] Transfer mechanism decided; SCCs annexed if any customer is in the EEA or the UK (§10)
- [ ] RPO/RTO either committed or explicitly excluded (§9)
- [ ] `/trust`'s "Data processing agreement — Not yet published" row flipped, and
      `lib/trust-page-answers.test.ts` updated in the same commit

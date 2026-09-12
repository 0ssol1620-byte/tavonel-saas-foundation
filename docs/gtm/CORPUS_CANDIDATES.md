# J1 corpus candidates — 1 to 3 documents, 50 standard pages or fewer

Written 2026-09-11 by the website-growth campaign's `keyword-claims-data` lane. Every candidate
is material already committed to this repository at HEAD `38d957d`; nothing here was fetched,
generated or uploaded. Rights for each are in `docs/gtm/SOURCE_RIGHTS_MANIFEST.yaml`, and **not
one of them is `cleared`** — that signature is WG-013, a founder decision, and this file exists
to make it a short decision rather than a research project.

## The ceiling the candidate has to fit

Three limits, each read from code rather than from a plan:

| Limit | Value | Where it is enforced |
|---|---|---|
| Free Evaluation | 3 files · 50 standard pages · 1 World · 7 days | `components/pricing-page-client.tsx:46-49` — published copy (CLM-021) |
| Per file | 5 MiB · 80 pages | `shared/intakeCeiling.ts:25-29` (`WORKER_MAX_SOURCE_BYTES`, `CDR_MAX_INPUT_BYTES`, `CDR_MAX_PAGES`) |
| Activation | promote requires plan `studio` (Team, $99, `saleChannel: "contact"`) | `app/api/collections/[id]/promote/route.ts:100,237` (CLM-016) |

Two notes on that table. The trial row is the only statement of 3/50/1/7 in this repository, and
it is *copy*: the enforced numbers arrive from the grant service and are passed through as
`fileLimit`/`pageLimit`/`worldLimit` (`lib/self-service-trial.ts:234`), so the published limit
and the enforced limit are two different things and only one of them is checkable here. Quote the
copy, and do not describe it as a measured ceiling.

The third row is not a corpus constraint at all and is listed because it decides who can run
this: whoever performs the J1 run needs a Team-plan workspace, and no trial or Developer account
can reach the approved World the journey ends at. FD-02/FD-14.

## Candidates

### A. FP-200 synthetic maintenance corpus — *recommended for the first run*

`fp-200-maintenance-manual-revC.pdf` + `fp-200-change-notice-CN-2026-03.pdf` +
`fp-200-service-log-2026.pdf` — 3 files, about 3 pages, roughly 1 KB each.

- **Rights**: `unverified`, basis `own_work`, generated in this repository at commit `ec27cf0`.
  One founder line clears it. No other candidate is this close.
- **Why it fits**: three files against a three-file trial, three pages against fifty, and the
  revision the journey needs already exists — `revB` and `revC` of the same manual differ in the
  service interval, in the sentence explaining the change, and in the revision the document
  calls itself. J3 (source revision → review → reuse) is the same corpus at a second state, not
  a second corpus.
- **Why it is not enough on its own**: the text is four sentences about a fictional pump. A
  compiled world built from it is genuinely small, so no "effect" sentence — time saved, figures
  found, pages reviewed — could be drawn from it without becoming a claim about a fixture
  dressed as a claim about work. It also cannot answer the "no material available" question type
  convincingly: with three pages, a reader can see the whole corpus at a glance.
- **How it must be labelled**: as a synthetic fixture, in the same sentence as any result. The
  /explore page already holds this line — a sample with a capture date and a scope, never a
  simulation of a live compile.

### B. Apple 10-Q, 2026 Q1 — the only real document that fits the trial

`apple-2026-q1-10-q-reference.pdf` — 1 file, 30 pages, a chromium-print render of the EDGAR
primary HTML (accession `0000320193-26-000006`).

- **Rights**: `unverified`, no basis identified. Apple's text under Apple's copyright; EDGAR
  access is not a redistribution licence, and blueprint §16.1 names that assumption as one not
  to make. The bytes are already served from `nextjs/public/`, which is a decision already taken
  and still not a licence.
- **Why it fits**: 30 pages is inside both the 50-page trial and the 80-page per-file ceiling —
  the only one of the five committed Apple filings that is (10-K 80, Q2 37, Q3 40, DEF 14A 103;
  Q2 and Q3 also fit the file ceiling but two of them together do not fit the trial).
- **Why it is a harder choice than it looks**: the interesting questions about a 10-Q are
  figures in tables, and tables and formulas are not extracted (`no_table_or_formula_extraction`
  on every live manifest row). A finance cookbook built on this corpus has to state that limit
  before the CTA, which is the layered order the constitution requires and also the order that
  makes the piece honest. Second, a locator into a reference render points at a page this
  project laid out, not at Apple's original — /explore distinguishes the two and content built
  on it has to keep distinguishing them.
- **Pairs with**: a second filing for J3 (Q1 → Q2 is a real revision of a recurring report), but
  30 + 37 = 67 pages, past the 50-page trial. A J3 run on Apple filings is a paid run, not a
  trial run.

### C. DART JTC derivative pages — the Korean-language option

`dart-jtc-page-1..3.pdf` — 3 files, 3 pages, one-page derivatives of a public DART filing held
in the Core repository (`PROVENANCE.md` records source bytes, digest and method).

- **Rights**: `unverified`. A Korean regulatory filing is the filer's text under the filer's
  rights, and DART's terms have not been read. `PROVENANCE.md` answers "does this contain
  private customer material" (no) and not "may we republish it".
- **Why it is on the list**: it is the only committed Korean-language material, and half the
  keyword map is Korean (`lib/keyword-map.ts`). If the first Korean content package needs a
  Korean corpus, this is the candidate — after a rights read, not before.
- **Why not first**: three single pages cut from a 121-page filing make a corpus with no
  internal structure to compile, and the pages exist for a CDR/OCR proof path rather than for
  reading.

### D. This project's own documentation — not available today

The honest fourth option is TAVONEL's own prose: own work, real structure, real length. It is
not a candidate today because no PDF of it exists in the repository, and producing one would
create a new artifact with a new digest — a small task, but a task, and not one this lane was
asked to do. Its weakness is also structural: compiling our own documentation demonstrates the
pipeline on material chosen for being convenient, and a reader evaluating "will this work on my
documents" learns the least from it.

## Recommendation, and what it does not decide

Run A first, labelled as a fixture, to get the eighteen journey steps to PASS at all — it is the
only candidate whose rights can be cleared with one sentence, and it carries its own revision
for J3. Then decide B separately, because B is the first corpus that could carry a published
result about real documents and it needs a rights read before a page cites it.

This file decides nothing. The corpus selection, the rights sign-off and the run itself are all
founder items (WG-013, WG-002, FD-15), and the question set the run has to answer — a simple
fact, a combination, a conditional comparison, and a question the material cannot answer — has
to be fixed in writing *before* the run, or the run's results become whatever the run produced.

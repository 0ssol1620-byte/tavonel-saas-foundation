# ADR-2026-11-18 — Routes for tables, formulas and typed extraction, and the question for counsel

- **Status:** proposed, 2026-11-18. The lead decides. This record names three routes, the conditions each one waits
  on and how each is rolled back. It changes no code, flag, manifest row, price or public sentence.
- **Work order:** WO-E-TBL-0 (`v34-lanes/workorders/all-features/E-unsized-features.md` §5). It unblocks WO-E-TBL-1
  (route A). Route B (WO-E-TBL-5) and route C (WO-E-TBL-6) stay undated.
- **What this record does not do.** It does no claim analysis. It states no conclusion about any patent, whether a
  design falls inside or outside one, or whether a design-around is enough. §3 describes only the execution order
  of TAVONEL's own designs. §5 is a question addressed to counsel. It is not an answer. Counsel is not procured
  (`v34-lanes/adr/SCOPE-FOUNDER-20261116.md:11`, EG-10 open by direction), so nothing here has been sent.
- **Base read:**
  - Foundation `codex/v34-e-adr` at `04c43f6f`, which contains `codex/v34-fnd-int` `e9364899`.
  - Core `codex/v34-core-int` at `783d8d0` (`C:` below).
  - Register `C:docs/ip/TECHNOLOGY_INTAKE_REGISTER.yaml` at sha256
    `ddcab5714a68c777f8758309a9db018272ecada76000dbd3f97b014e7e13242f` (`REG:n`). The copy in the
    `ai-knowledge-compiler` checkout has different bytes (`8c52a31b…`). This record quotes the `core-int` copy.
  - `MP:n` is a line of `TAVONEL_CANONICAL_MASTERPLAN_V5_6_V34_2026-11-16.md`.
  - `PRG:n` is a line of
    `ai-knowledge-compiler/outputs/tavonel-research-replan-20261013/market-20261104/PROGRAM-2026-11-04.md`
    (sha256 `94942aece7a97d60ab0d36108e04af4aeefabe0bb47252901301944a3b5c9808`).
  - Measurements are in `v34-lanes/receipts/WO-E-TBL-0/`.

## 1. What exists

**Product path today.**

- Every office file is converted to PDF by `soffice` and then OCR'd (`quarantine-sidecar/cdr-cloudrun/app.py:617-635`).
- The manifest keeps the limitation `no_table_or_formula_extraction` (`shared/capabilityManifest.ts:95`, `:683`).
- `tavonel.table_read.v1` is a contract only. "No reader produces this document, nothing persists it, and nothing
  reads it in the product path" (`shared/tableReadContract.ts:5-6`).
- No code reads `TAVONEL_TABLE_READER_MODE` or `TAVONEL_TYPED_EXTRACTION_MODE`. `git grep` finds only
  `docs/policy/DECISION_LOG_2026-11-08.md:84` (decision E-11: NOT_BUILT).

**Core native parser.**

- `parse_non_pdf_to_cir` (`C:packages/native-parsers/src/akc_native_parsers/parser.py:19-30`) "performs no network
  calls, subprocess execution, formula calculation, macro execution, or archive extraction".
- It accepts exactly `.docx .pptx .xlsx .html .htm .srt .vtt` (`…/security.py:24-26`). **CSV is not in the set.**
  The §5 done-means line in the work-order file names CSV, but this parser does not cover it.
- XLSX is opened twice, as a formula book and a value book, both `keep_links=False`
  (`…/xlsx_parser.py:34-47`). A hidden sheet is flagged `hidden_sheet` (`:57-67`).
- Limits are counts and bytes (`…/models.py:71-95`, for example `max_input_bytes` 50 MiB and `max_cells_per_sheet`
  500,000). The parser sets no wall-clock limit.
- The work-order file says (fact 20) that no service imports the parser. That is not exact. One Core worker does:
  `C:workers/cpu-document/src/akc_worker_document/sandbox_runner.py:20-25,480`.
  - It runs the parser in a one-shot child process.
  - That process sets kernel limits (`RLIMIT_AS`, `RLIMIT_CPU`, `RLIMIT_FSIZE`, `RLIMIT_NOFILE`, `RLIMIT_NPROC`,
    `:51-70`) and replaces `socket.socket` and `socket.create_connection` with a refusal (`:42-48`, `:593`).
  - Whether that worker runs in any production path has **not been established**. The Foundation compiles through
    Core V2, not through this worker.
- **Import closure, measured.** Importing `parse_non_pdf_to_cir` loads these third-party top-level modules
  (`receipts/WO-E-TBL-0/import_closure.json`, run on this machine with Python 3.13.0):
  - `pydantic`, `pydantic_core`, `annotated_types`, `typing_extensions`, `typing_inspection`
  - `defusedxml`, `openpyxl`, `docx`, `pptx`, `lxml`, `bs4`, `soupsieve`, `pypdf`
  - `cryptography` with `_cffi_backend`, `redis`, `PIL`
  - `numpy`, `fontTools`, `charset_normalizer`

  `redis` and `cryptography` come from `akc_security/__init__.py`, which imports `pdf_secrets`. `PIL` comes from
  `preview_redaction`. Both modules are loaded although the parser does not call them.

  `numpy`, `fontTools` and `charset_normalizer` are not Core dependencies. They loaded because they are installed
  here. The image's own closure has to be measured inside the image.

  Installed versions here (`installed_versions_local.txt`) differ from `C:uv.lock`. For example, cryptography is
  45.0.7 here and 50.0.0 in the lock, and Pillow is 12.3.0 here and 13.0.0 in the lock. They are not a pin.

**CDR quarantine service** (`quarantine-sidecar/cdr-cloudrun/`).

- It authenticates requests with an HMAC secret of at least 32 characters (`app.py:293-297`).
- It runs `soffice` as a subprocess, with an environment from which credentials are removed (`app.py:550-558`,
  `:617-635`).
- Its own outbound-network isolation is conditional. `service.yaml:35-40` pins egress to a VPC with no NAT, but
  "until they exist, this annotation must be removed". Whether production runs with that annotation has **not
  been established**.
- Limits: `MAX_INPUT_BYTES` 5 MiB and `MAX_PAGES` 80 (`app.py:57-59`). Memory is 4 GiB per container
  (`service.yaml:82-83`), with `containerConcurrency: 1` and `timeoutSeconds: 120` (`:42-43`).
- The image copies named files only (`Dockerfile:22-25`). Its Python pins are six lines (`requirements.txt:1-6`),
  including `Pillow==12.3.0`.
- `NOTICE` records each distribution's licence from its installed metadata, "Nothing here is inferred"
  (`NOTICE:8-11`).
- `table_dpi_arena.py` is an operator tool and is not in the image (`:3-6`). It refuses the GPU arm with
  `GPU_REQUIRED_ORCHESTRATOR_GO` (`:25-26`, `:104`).

**Blueprint.**

- Cells keep coordinates, merged spans, header and unit. A formula keeps its source text and cached display, with
  an "unverified calculated value distinction". Formulas are never executed, and a stale cache is flagged without
  recomputation (MP:217).
- Cases S10–S13 (MP:314-317). S12 reads "Route escalation, crop, independent verifier".
- U03 targets "table structure F1 ≥.95, formula exactness ≥.90" (MP:966). That number is uncalibrated, and this
  record does not adopt it.

## 2. Decision (proposed)

### A — Native office cells: the Core parser inside the CDR quarantine service (recommended, WO-E-TBL-1)

**What A does.**

- The CDR image carries `akc_native_parsers`, `akc_cir` and `akc_security`, byte-identical to one pinned Core SHA
  and checked by hash. Core is not edited. `akc_cir` is Protected Core, and copying it unchanged does not modify it.
- After the malware scan, the CDR runs `parse_non_pdf_to_cir` on DOCX, XLSX or PPTX bytes. It emits
  `tavonel.native_read.v1` beside the PDF.
- The PDF raster and OCR path still runs **for every file**, whatever the reader returns. If the reader fails, the
  CDR returns `native_read: "unavailable"` with a reason, and the PDF path continues.
- Cells carry the parser's source locations. A bbox is never derived.

**Why the CDR.**

- It already receives the bytes.
- Its only secret is the HMAC.
- It is the one service whose egress is meant to be closed.

**Conditions this record found for WO-E-TBL-1** (each is stated in that work order before code):

1. **CSV.** The parser does not read CSV. Recommended: v1 covers DOCX and XLSX (and PPTX tables, which come with
   it). CSV stays on the TXT/CSV/HTML text path (WO-E-FMT-1). A CSV cell reader would be a Core parser addition,
   a separate Core work order in the E-16 release batch.
2. **Import closure.** The parser package as it stands brings `redis` (a network client library), `cryptography`
   and a second Pillow version into an image pinned at Pillow 12.3.0. Two options:
   - (i) Ship the closure as is. The static "no subprocess or network path" test of WO-E-TBL-1 then has to show
     that no reader call reaches `redis`.
   - (ii) A Core change, shipped in the E-16 batch, so that importing the parser no longer loads `pdf_secrets` and
     `preview_redaction`.
     - The four names the parser takes from `akc_security` (`PLAN_LIMITS`, `PlanTier`, `safe_relative_path`,
       `validate_upload_bytes`) all live in `akc_security/files.py`. That file's only third-party imports are
       `defusedxml` and `pydantic`.
     - Python runs a package's `__init__` before any of its submodules. Importing `akc_security.files` therefore
       still loads `redis`. The change has to be in `akc_security/__init__.py` or in where `files.py` lives, not
       only in the parser's import line.

   Recommended: **(ii)**. A reader that cannot import a network client needs no proof that it never calls one.
   This contradicts TBL-1's "no edit of Core", so the lead decides (proposed delta).
3. **Isolation.** The parser bounds counts, not time. Recommended: reuse the *pattern* of
   `sandbox_runner.py:42-70`, which is a one-shot child with kernel limits and refused sockets. Do not reuse the
   module, which imports `akc_api`. The child inherits no environment beyond what `office_process_environment`
   passes (`app.py:550-558`). Two things are not established: whether Cloud Run gen1 honours each `setrlimit`, and
   the reader's peak memory at the CDR's 5 MiB bound beside `soffice` in 4 GiB. WO-E-TBL-1 measures both.
4. **Comparison, not arbitration.** WO-E-TBL-4 compares native cells with the rendered PDF path. That comparison
   records mismatches and can hold a cell. It never starts another reader (shape T-A2 in §3).

**Rollback.** Drop the `native_read` field from the CDR response, or deploy the previous CDR revision. The PDF path
is unchanged throughout.

### B — Scanned and PDF tables: a reader chosen by a product-DPI arena (WO-E-TBL-5, not dated)

**What B does.**

- First, the product-DPI arena (`table_dpi_arena.py`, 108/150/200 DPI). The historical OmniDocBench TEDS is never
  imported as a same-condition result.
- Then `TAVONEL_TABLE_READER_MODE=shadow`. That flag does not exist yet. In shadow, the reader's output is stored
  and OCR stays authoritative.
- Then a benchmark gate on cell exactness at matched coverage, then canary, then rollout.

**What B waits on.**

- Decision E-3 (FTO-1, founder). Until it is answered, B goes no further than the founder's own workspace.
- A registry production row.
- Intake rows for the reader's code, weights, serving image and any hosted API. These are four separate licences.
- Founder spend confirmation for any step above USD 100.

**Routing shapes.** B can be routed in more than one shape (T-B1 to T-B3 in §3). This record does not choose among
them, because the choice depends on §5.

- PRG states its own design as **"route는 실행 전에 profiler 특징(레이아웃 검출의 표 영역)으로 정한다. 첫 판독기 출력
  품질을 보고 둘째 모델을 부르는 형태가 아니다"** (PRG:473).
- This record neither adopts nor tests that statement. It is quoted as part of the question.
- PRG:506 lists "F-9 표 route의 IBM design-around 확인" as a founder decision.

**Rollback.** Mode `off`. OCR was authoritative in every stage before rollout.

### C — Typed extraction per PRG C2 (WO-E-TBL-6, design only, not dated)

**What C does.**

- The regex path stays authoritative.
- In shadow, typed objects go only to a candidate file and are not exported (PRG:408).
- A worker timeout ends the compile on the regex path, with `typed_extraction: "unavailable"` shown (PRG:431).

**Gold.** Gold is the publisher's structured data (`SCOPE-FOUNDER-20261116.md:23`). That means only XBRL-tagged
filings carry entity gold.

**Recommended rule.** When an extraction fails validation, nothing retries it with another or larger model. The
result is `unavailable` or an abstention, in line with "escalation cascade는 금지한다" (PRG:32). Design starts after
WO-E-TBL-3.

**Rollback.** Mode `off` returns to the regex path that runs today.

## 3. Execution shapes

Each row is a fact about the execution order of a TAVONEL design: what runs, and what decides whether a further
model runs. It is not a reading of anyone's patent. "Model" means a learned model. The Core native parser is
deterministic code, not a model.

| Id | Route | Shape | Does a model's execution depend on another model's output? |
|---|---|---|---|
| T-A1 | A | Reader picked by file type (declared MIME + magic, `security.py`) before anything runs. The native parser (code) and the PDF raster + OCR (model) both run for every office file. | No. OCR runs whether or not the parser succeeds. |
| T-A2 | A | The native cells and the OCR text are compared. A disagreement is recorded and can hold a cell. | No model is started by the comparison. Its result changes what is shown (held or not). |
| T-B1 | B | A table region found before reading (PRG:473 "레이아웃 검출의 표 영역") decides whether the table reader runs on a page. | **Yes, if** the region detector is a model. Whether it is a model has not been decided. |
| T-B2 | B | The table reader runs on every page, beside line OCR, and nothing gates it. | No. It costs more per page. Not measured. |
| T-B3 | B | A second reader runs because the first reader's output failed a check, such as blueprint S12 "Route escalation … independent verifier" (MP:316) or the Arena rule "escalate a field on disagreement or no value" (work-order file fact 29). | **Yes.** Not proposed by this record. Listed because the blueprint and the Arena name it. |
| T-C1 | C | The typed-extraction model runs on every in-cohort compile, using evidence that the OCR model produced. | Sequential: it consumes OCR output. It is not gated on OCR output quality. |
| T-C2 | C | Retry with another model when validation fails. | **Yes.** Excluded by the rule in route C. |

## 4. The legal holds, quoted

Each block below is copied line for line from `C:docs/ip/TECHNOLOGY_INTAKE_REGISTER.yaml` (sha256 above) and is
not paraphrased.

REG:35

```yaml
  RED:    { meaning: "active patent or high FTO risk", allows: "design-around and comparative analysis only", requires: "counsel claim chart before any commercial core path" }
```

REG:43-58

```yaml
  - id: tech_ibm_sequential_inference
    reference: "IBM US11605028B2"
    avoid: >-
      The broad sequential-inference shape: first model → QoS comparison →
      conditional execution of a second model. Avoid expressions that read onto it.
    status: DESIGN_AROUND
    touches: "Adaptive Economic Router; Patent Family A"
    note: >-
      The blueprint's one-line summary of this family understates its scope, so
      the design-around is drawn wider than that summary would suggest. The
      reading behind that conclusion is claim-level analysis and belongs in the
      counsel packet, not in version control — extract it with
      research/scripts/export_privileged_packet.py.
      Redacted forward on 2026-08-11 by founder instruction; the earlier wording
      remains at c8de965 and history is not rewritten. See
      docs/audit/receipts/ip-privilege-exposure-0001.json.
```

REG:74-78 (cell locators are evidence provenance)

```yaml
  - id: tech_oracle_dynamic_lineage
    reference: "Oracle dynamic lineage family"
    avoid: "Claiming generic provenance + temporal lineage as an independent invention."
    status: DESIGN_AROUND
    touches: "Evidence provenance; Patent Family B"
```

REG:97

```yaml
      - "Family A must not read onto IBM US11605028B2's sequential-inference shape."
```

REG:116

```yaml
      - "Marketing language must align with the design-around (§15.4 step 7): do not describe selective recompilation or lineage in terms that read onto a RED family."
```

REG:153-159

```yaml
  - id: FTO-1
    question: "Does counsel review the four RED families before Model Arena, or before commercial launch?"
    note: >-
      §15.4 step 6 puts counsel review before commercial activation. The Arena is
      research, not commerce, so the blueprint permits comparative analysis now —
      but Family A's claim scope depends on the IBM reading, and the IP track has
      already found the blueprint's summary of that patent to be imprecise.
```

**What follows for this record's routes.**

- REG:35 requires a counsel claim chart before any commercial core path. The register says the full reading
  belongs in the counsel packet (REG:53-55). This record does not attempt either.
- Under REG:74-78 and REG:116, the WO-E-TBL-3 copy for cell citations must not present provenance or lineage as
  TAVONEL's independent invention.

## 5. Question for counsel (packet text)

The text between the two markers is the question, to be placed in the counsel packet unchanged once FTO-1 is
answered and counsel is engaged. It contains no reading and no answer.

<!-- COUNSEL-QUESTION:WO-E-TBL-0:BEGIN -->

**Question for counsel: TAVONEL structured-table and typed-extraction routes, and the register row
`tech_ibm_sequential_inference` (REG:43-58, quoted in full in §4 of the record that carries this question).**

TAVONEL's intake register classifies this family RED. It allows "design-around and comparative analysis only" and
requires "counsel claim chart before any commercial core path" (REG:35). TAVONEL has done no claim analysis. Seven
execution shapes are described in §3 of the record that carries this question (T-A1, T-A2, T-B1, T-B2, T-B3, T-C1,
T-C2).

1. For each of the seven shapes, may TAVONEL use it in a commercial core path:
   - (a) as described,
   - (b) only with a change to the design (which change), or
   - (c) not at all?
2. Shape T-B1 depends on whether the step that finds a table region is a learned model or deterministic code. Does
   your advice for T-B1 differ between those two cases?
3. Shape T-A2 compares the outputs of two readers and can hold a value, but starts no further model. Does a
   comparison whose only effect is to hold or show a value need the same review as one that starts a model?
4. Shape T-C1 always runs a second model on the first model's output, with no condition on that output. Does your
   advice treat an unconditional sequence differently from a conditional one?
5. Which facts about each shape should TAVONEL record, and keep recording as the design changes, so that a later
   review can be made from the record (for example: what decides that a model runs, when that decision is made, and
   what happens on a failed check)?
6. The register's `tech_oracle_dynamic_lineage` row (REG:74-78) restricts how TAVONEL describes evidence
   provenance. What may TAVONEL's product and marketing copy say about cell-level citations (`Sheet / Table → Cell
   B4`)?
7. FTO-1 (REG:153-159) asks whether review comes before the Model Arena or before commercial launch. For these
   table and extraction routes specifically, at which stage does TAVONEL need your answer: shadow (output stored,
   never shown), a canary in the founder's own workspace, or the first customer?

<!-- COUNSEL-QUESTION:WO-E-TBL-0:END -->

## 6. Intake rows needed (checked, not assumed)

A permissive OSS licence is copyright permission from its contributors. It settles nothing about third-party
patents (REG:15-19). Code, model weights, dataset and hosted-API terms are four separate licences.

What was checked: `REG` has **no row** for any distribution below. A word-boundary search for each name gives
0 hits, except one: `cryptography` appears inside another package's `basis` at REG:960, and that is not a row for
it (`receipts/WO-E-TBL-0/verify_adr.out.json`). `C:docs/compliance/license-register.yaml` holds model and engine rows only. The CDR `NOTICE` lists only its six current pins.
Shipping these in the CDR image is a new distribution, so each needs the following before WO-E-TBL-1 builds an
image:

- an exact version, read from the image's installed metadata;
- the licence string from that metadata, the way `NOTICE` already does it, never from memory;
- a `NOTICE` row;
- an SBOM entry;
- an intake-register row.

The register owner is FTO-3 (REG:163-164), which is still open.

| Distribution | Why it is in the closure | Core range (`C:pyproject.toml`) | `C:uv.lock` |
|---|---|---|---|
| openpyxl (+ et-xmlfile) | `xlsx_parser.py` | `:31` `>=3.1,<4` | 3.1.5 (2.0.0) |
| defusedxml | xlsx, docx, security | `:25` `>=0.7,<1` | 0.7.1 |
| python-docx | `docx_parser.py` | `:45` `>=1.2,<2` | 1.2.0 |
| python-pptx (+ XlsxWriter) | `pptx_parser.py` | `:48` `>=1.0,<2` | 1.0.2 (3.2.9) |
| lxml | python-docx, python-pptx; a compiled extension, so whether its wheel carries further libraries and notices is read from the wheel | `:30` `>=6.0,<7` | 6.1.1 |
| beautifulsoup4 (+ soupsieve) | `html_parser.py` (needed only if HTML runs through A) | `:18` `>=4.13,<5` | 4.15.0 (4.1.1) |
| pydantic (+ pydantic-core, annotated-types, typing-inspection, typing-extensions) | `akc_cir`, `models.py` | `:39` `==2.13.4` | 2.13.4 (2.46.4) |
| pypdf | `pdf_parser.py`, imported by the package `__init__` | `:43` `>=6.16.1,<7` | 6.21.4 |
| cryptography (+ cffi), redis | `akc_security/__init__` → `pdf_secrets`; gone under option (ii) | `:24`, `:50` | 50.0.0, 6.4.0 |
| Pillow | `preview_redaction`, python-pptx. **Version conflict:** the CDR pins 12.3.0, Core 13.0.0 | `:37` | 13.0.0 |
| `akc_native_parsers`, `akc_cir`, `akc_security` | TAVONEL first-party code, pinned by Core SHA and file hashes | — | — |

Route B adds rows for the reader's code, weights and serving image (and any hosted API), plus a registry production
row. Route C adds rows for its model and for each gold source.

## 7. Not established

- Whether production CDR revisions run with the no-egress annotation (`service.yaml:35-40`).
- Whether Cloud Run gen1 honours each `setrlimit` used by the sandbox-runner pattern.
- The reader's peak memory and time at the CDR's input bound.
- Whether `C:workers/cpu-document` runs in any production path.
- The image's own import closure. The closure in §1 was measured on this machine.
- The licence strings of the distributions in §6. None was read for this record.

## 8. Rollback of this record

Documents only. Revert the commit.

# ADR-2026-11-23 — Tables in born-digital PDFs from the text layer's own geometry

- **Status:** proposed, 2026-11-23. The lead decides. This record changes no code, flag, manifest row, contract,
  price or public sentence.
- **Work order:** WO-E-TBL-P0 (`v34-lanes/workorders/customer-ready-20261123.md`). Lane `codex/v34-tbl-p0`, base
  `codex/v34-e-adr` `04bb4a97` (old integration base `e9364899` plus three ADR commits).
- **Base read.** Every service file cited below has the same bytes here and in `v34-lanes/fnd-int` (`de6d18a3`):
  `quarantine-sidecar/cdr-cloudrun/{text_layer.py,app.py,requirements.txt}`,
  `quarantine-sidecar/foundation-cdr-worker/src/{text-layer-shadow.ts,ocr.ts,sanitize.ts}` and
  `docs/adr/ADR-2026-11-02-text-layer-first-cdr.md` (compared by `git hash-object`). Core is read at
  `v34-lanes/core-int` `783d8d0` (`C:` below). The register is `C:docs/ip/TECHNOLOGY_INTAKE_REGISTER.yaml`, sha256
  `ddcab5714a68c777f8758309a9db018272ecada76000dbd3f97b014e7e13242f` (`REG:n`), the copy ADR-2026-11-18 quoted.
- **Probe:** `v34-lanes/receipts/WO-E-TBL-P0/` (scripts, 24 synthetic PDFs, outputs; hashes in §3.5). No file under
  `v34-lanes/corpus/` was opened, listed or hashed.

## 1. Question

Observation (lead, production, 2026-11-23): statement pages of born-digital PDFs are read as text lines; labels and
values lose their column order, and Ask then cites a region whose text is an unordered run. ADR-2026-11-18 sends
"scanned and PDF tables" to route B, a model reader chosen by an arena (GPU, licences, a second-model question).

For a PDF that **has** a text layer, the characters and their positions are already in the file. Can rows and
columns be reconstructed from that geometry alone — no model, no rendering — well enough to be a route, and where
does it stop?

## 2. How the text layer is read today

**CDR service (Cloud Run, Python).**

1. `app.py:51-53` reads the flag `TAVONEL_CDR_TEXT_LAYER_FIRST` at boot; `text_layer.py:139-146` accepts only
   unset, `"0"` or `"1"`.
2. `POST /v1/text-layer` (`app.py:1003-1047`): flag off → 503 (`:1013-1016`); then the same signed request, digest
   check, malware scan, package and markup refusals and LibreOffice conversion as `/v1/disarm` (`:1017-1030`);
   `qualified_text_layer_scale` applies the raster path's page and pixel gates (`app.py:858-880`); then
   `text_layer.read_document` (`:1034`). The body is JSON with `x-tavonel-input-sha256` and
   `x-tavonel-text-layer-sha256` (`:1039-1047`).
3. `text_layer.read_document` (`text_layer.py:440-485`) opens a throwaway PDFium document and calls `read_page` per
   page. A layer PDFium cannot read, a negative or over-ceiling character count, U+FFFD/NUL or a non-finite glyph
   box raises `TextLayerCorrupt` and the whole document's receipt is `refused` (`:456-461`).
4. `read_page` (`text_layer.py:403-437`) decides the page's path: no letter or digit → `ocr:no-text-layer`
   (`:411-412`); rotation ≠ 0, CropBox ≠ MediaBox or a moved origin → `ocr:geometry-unsupported` (`:167-170`,
   `:413-414`); any glyph the render does not show → `ocr:hidden-text-suspect` (`:417-420`, rules in `:252-357`);
   images over 10% of the page → `ocr:image-content` (`:421-422`); otherwise `textlayer` with `text`, `textSha256`
   and `lines` (`:423-429`).
5. `lines` (`text_layer.py:360-400`): a line is what PDFium ends with a line break in **character-stream order**
   (`:389-399`), with the union box of its glyphs as `bbox1000` (`:376-386`). Nothing groups characters by column,
   and nothing reorders a line by x. Whether one statement row comes out as one line, or labels and values come out
   as separate runs, depends on the order in which the producer wrote the content stream. The probe below does not
   use these lines; it reads glyphs directly.

**Worker (Cloudflare, TypeScript).**

6. `sanitize.ts:904-921` (`finishWholeDocument`): after `ocr.json` is stored, and only then, it calls
   `runTextLayerShadow` (`:912-919`) when `FOUNDATION_CDR_TEXT_LAYER_FIRST` is `"1"` (`text-layer-shadow.ts:84-88`).
7. `text-layer-shadow.ts:196-305` posts the same source to `/v1/text-layer`, verifies digest headers, schema, status
   and page count, compares each `textlayer` page with OCR by a character-multiset Dice (`:106-119`), stores the
   verified body as `text-layer.json` and a counts-only `text-layer-shadow.json`. `servedPages` is always 0 (`:68`).

**What reaches Core.**

8. Core receives OCR regions, not the text layer. `ocr.json` regions are `regionId, pageIndex0, pageNumber1, order,
   blockType, text, bbox1000, confidence, authority` (+ optional `recognitionConflict`) (`ocr.ts:360-383`), and the
   compile passes them to Core only from a v2/v3 reader (`nextjs/lib/collection-compile-run.ts:268-289`). A search of
   `nextjs/lib` for `text-layer.json` finds only `entity-extraction-eval.inputs.json` (eval inputs for the public
   explore samples), no compile path.
9. `tavonel.table_read.v1` exists as a contract only (`shared/tableReadContract.ts:1-22`, validator
   `qualifyTableRead` at `:351`): per page, tables with cells (`rowIndex0, columnIndex0, rowSpan, columnSpan, text,
   bbox1000|null, confirmedBy`), refusals with a reason code, `pageStatus` recomputed from them. A cell no other
   reader confirmed is `TABLE_CELL_TEXT_UNCONFIRMED`. The manifest keeps `no_table_or_formula_extraction`
   (`shared/capabilityManifest.ts:95`, `:683`).

So today no table structure exists anywhere in the path, and no text from the layer reaches Core.

## 3. Probe

### 3.1 What was run

- `synth.py` writes each PDF by hand (content streams, standard Helvetica, WinAnsiEncoding, no generator library)
  and records the truth of every string it draws: `row` (visual line, relative to the table's first line with a
  value; header lines are negative), `col` (0 = label, 1.. = value columns), `span`, and for value cells the full
  logical row label.
- `reader.py` is the geometry reader. Its only input is per-glyph data from PDFium through pypdfium2:
  `FPDFText_GetUnicode`, the loose character box (`get_charbox(loose=True)`), `FPDFText_GetCharOrigin`,
  `FPDFText_GetFontSize`, `FPDFText_GetCharAngle`, and the page rotation. No render, no model, no OCR.
- `run_probe.py` scores reader against truth per page as multisets of `(row, col, span, text)` (whitespace removed
  from text). `sweep.py` reruns the set with each named constant moved.
- **Interpreter and library:** Python 3.13.0, **pypdfium2 4.30.0** (the version installed on this machine). The
  CDR pins **5.13.0** (`requirements.txt`). Every call used exists in both, but the probe was **not run at the
  pin**; no pip install was made. The shadow order (§7) runs at the pin.

### 3.2 The algorithm in ten lines

1. Page gate: rotation ≠ 0 or any glyph angle ≠ 0 → page not placed. A non-finite box, U+FFFD or NUL → page not placed.
2. Lines: non-space glyphs grouped by baseline (origin y within `BASELINE_TOL_EM` × font size).
3. Phrases: a line splits where the gap between glyph boxes exceeds `PHRASE_GAP_EM` × font size; a lone currency
   sign joins the numeric phrase to its right; a phrase of three or more rule characters is a rule, not a cell.
4. Numeric phrase: one regular expression (currency, sign or parentheses, grouped digits, decimals, %, or a dash).
5. Body row: a line with ≥ 2 phrases and a numeric phrase after the first, or ≥ 2 numeric phrases.
6. Runs: consecutive lines at one font size with baseline gaps ≤ `BLOCK_GAP_EM` × size; a run with
   ≥ `MIN_BODY_ROWS` body rows holds a table from its first to its last body row.
7. Columns: the x-intervals of the body rows' non-label phrases, merged where they overlap, are bands; a text-only
   band right of a numeric band splits the block into side-by-side tables at its left edge.
8. Header: extend upward from the first body row over lines whose phrases all place (line 9); stop at the first
   that does not.
9. Placement: a phrase left of band 0 is the label (col 0); any other phrase overlaps exactly one band
   (col = band + 1); a non-numeric header phrase may overlap a contiguous run of bands (span).
10. Refusal, table not placed: a phrase straddling the label edge, a value in 0 or ≥ 2 bands, two phrases of one
    line in one band, or two adjacent bands never both filled in any body row.

### 3.3 Constants (none calibrated)

Each is derived from the synthetic generator and from nothing else. None is a measurement on real pages.

| Constant | Value | Derived from |
|---|---:|---|
| `BASELINE_TOL_EM` | 0.2 | the generator sets every cell of a row on one baseline and rows ≥ 1.33 em apart |
| `PHRASE_GAP_EM` | 1.0 | above Helvetica's word space with loose boxes (0.278 em), below the narrowest gutter `synth.py` sets |
| `WORD_SPACE_EM` | 0.15 | only inserts a space into a phrase's text; never decides a cell |
| `BLOCK_GAP_EM` | 2.0 | above the generator's row pitch (12 pt at 9 pt = 1.33 em), below the space it leaves around prose (≥ 2.6 em) |
| `MIN_BODY_ROWS` | 2 | one line holding a number is not a table |
| `ANGLE_TOL` | 0.001 rad | float noise of an upright text matrix |

**The synthetic set does not constrain them** (`sweep.txt`): `PHRASE_GAP_EM` from 0.5 to 2.0, `BLOCK_GAP_EM` from
1.5 to 5.0 and `BASELINE_TOL_EM` from 0.05 to 0.5 give the same counts. Only `PHRASE_GAP_EM` 3.0 (11 more cells
withheld) and `BLOCK_GAP_EM` 1.2 (below the row pitch: every table withheld) move them. Real pages are what will
set them (§7).

### 3.4 Results

`summary.txt`; per-case reader output and scores in `results.json`; truth in `truth.json`. "Expected" is what a
correct reader does: `placed` (every truth cell reproduced, nothing extra), `refused` or `none` (nothing placed).
`false-accept` = cells in a placed table that are not a correct truth cell (wrong row/column/span, or not a cell).

| Case | Shape | Expected | Result | Truth cells | Correct | False-accept | Withheld | Signal |
|---|---|---|---|---:|---:|---:|---:|---|
| c01 | 2 numeric columns | placed | as expected | 11 | 11 | 0 | 0 | |
| c02 | 6 numeric columns | placed | as expected | 34 | 34 | 0 | 0 | |
| c03 | indented labels, section lines | placed | as expected | 22 | 22 | 0 | 0 | |
| c04 | multi-line labels | placed | as expected¹ | 13 | 13 | 0 | 0 | |
| c05 | parenthesised negatives | placed | as expected | 14 | 14 | 0 | 0 | |
| c06 | currency sign in its own run | placed | as expected | 11 | 11 | 0 | 0 | |
| c07 | subtotal rules (path and underscore text) | placed | as expected | 11 | 11 | 0 | 0 | |
| c08 | merged header cells within the columns | placed | as expected | 17 | 17 | 0 | 0 | |
| c08b | merged header wider than its columns | placed | **header withheld** | 13 | 11 | 0 | 2 | header stops extension |
| c09 | right-aligned numbers of different widths | placed | as expected | 14 | 14 | 0 | 0 | |
| c10 | two tables side by side | placed | as expected | 22 | 22 | 0 | 0 | |
| c11 | rotated page (`/Rotate 90`) | refused | as expected | 8 | 0 | 0 | 8 | `page_rotated` |
| c12 | glyphs rotated by the text matrix | refused | as expected | 8 | 0 | 0 | 8 | `glyph_rotated` |
| c13 | table continued on the next page | placed | as expected² | 17 | 17 | 0 | 0 | |
| c14 | running prose around the table | placed | as expected | 11 | 11 | 0 | 0 | |
| c15 | blank cells | placed | as expected | 12 | 12 | 0 | 0 | |
| c16 | centre-aligned numbers | placed | as expected | 11 | 11 | 0 | 0 | |
| c17 | a value reaching into the next column | refused | as expected | 11 | 0 | 0 | 11 | `value_in_two_columns` |
| c18 | one column at two non-overlapping x positions | refused | as expected | 14 | 0 | 0 | 14 | `column_split_ambiguous` |
| c19 | a label running under the first value column | refused | as expected | 10 | 0 | 0 | 10 | `label_straddles_value_column` |
| c20 | a caption line at table size and pitch directly above | placed | **FAILED** | 8 | 8 | **1** | 0 | none fires |
| c21 | two tables stacked at row pitch, no gap | placed | **FAILED** | 15 | 8 | **7** | 7 | none fires |
| c22 | prose with numbers, no table | none | as expected | 0 | 0 | 0 | 0 | |
| c23 | two prose columns with numbers, no table | none | as expected | 0 | 0 | 0 | 0 | |

¹ Values are placed in the right row and column, but the row's label is the last visual line only: 2 of 6 value
cells carry their full logical label (`labelJoinOk 2/6`). Geometry alone does not tell a wrapped label's first line
from a section heading above an indented row; both are a label-only line followed by a more indented line.
² Each page's fragment is its own table. Joining a fragment to the previous page's table is not attempted.

**Totals (24 cases, 25 truth tables, 307 truth cells):** 247 cells correct, **8 false-accepted** out of 255 placed
cells (3.1% of placed cells, all in c20 and c21), 60 withheld. 16 tables exact; 21 of 24 cases as expected.

### 3.5 Receipt files

| File | sha256 |
|---|---|
| `reader.py` | `c6791b4b07b977a93e2661a685add0b7b3f6251e4f8ced5f9fe3ace62c1f0375` |
| `synth.py` | `1c315b55b4cee494ce1b16dc682a96aaef8841dd312dde67015e744bc0a6182f` |
| `run_probe.py` | `20108eb3c7507c22f59f5fa90fb8d285a4ddd9e317770033198809f5491479c6` |
| `sweep.py` | `f58e729923972208568fa7039a13713e9c325690b7578013de4c26e2750b2cc9` |
| `results.json` | `6ff2c3da998d403803110e1865b281ac45954c71d9b8a9919e4b7207a4fce601` |
| `summary.txt` | `133d51753236ed1467d75811cceef13052a69fb3a09f9f579a634ab91e962647` |
| `truth.json` | `c651ca3533f10e272a2f2c198113c5f763dd4e9cc7d993a8b894921e1cf1fc10` |
| `sweep.txt` | `b91b3eacb34446399977b5853d7db3a74ec74e1a3a0758b87879cee999d0c299` |

Each PDF's sha256 is in `results.json` (`pdfSha256`). The PDFs are regenerated byte-for-byte by `synth.py`.

## 4. Where it stops, and what the reader outputs instead

**Rule: a table the reader cannot place is not emitted as cells. The page's text lines stay exactly as they are
today.** In `table_read.v1` terms a placed table is a `tables[]` entry and a table that is not placed is a
`refusals[]` entry (`TABLE_GRID_INVALID`, or `TABLE_REGION_UNLOCATED` for a page-level refusal); the signal name goes
in the receipt, because a refusal carries only `bbox1000` and `reasonCode` (`shared/tableReadContract.ts`, refusal
keys).

| Shape | How the reader knows | Output |
|---|---|---|
| Rotated page, rotated glyphs | page rotation ≠ 0; a glyph angle ≠ 0 | page not placed; the service already sends rotation ≠ 0 to OCR (`text_layer.py:167-170`) |
| Value reaching into another column | a value overlaps two bands; in c17 the overlapping glyphs also interleave into an unreadable phrase | table not placed |
| One column at two x positions | two adjacent bands never both filled in any body row | table not placed |
| Label running under a value column | a phrase straddles the label edge | table not placed |
| Merged header wider than its columns (c08b) | the header phrase straddles the label edge | body placed, header line left as text. Withheld, not false-accepted. |
| Wrapped label (c04) | not detectable by geometry | values placed; the row label is the last line only. The receipt must say labels are per visual line. |
| Continued table (c13) | none needed | one table per page fragment; no cross-page join |
| **Caption at table size and pitch (c20)** | **no signal** | **false accept:** the caption becomes a header row (1 cell) |
| **Two tables stacked at row pitch (c21)** | **no signal** | **false accept:** one merged table; the second table's 7 cells sit at the wrong rows |

The two false-accept shapes have the same cause: a label-only line at table size and row pitch is indistinguishable
from a section label. Geometry has no further signal for it here. The shadow measures how often it happens on real
pages (§7, WO-E-TBL-P2).

**Text truth is a separate limit.** A geometry reader places what the layer says. It inherits every limit of the
layer itself (ADR-2026-11-02 §3.2): a glyph map that lies (`/Differences` + `/ToUnicode`, Type3 or an edited
embedded font) puts the wrong text into a correctly placed cell, and no geometry rule can see it. So:

- The reader runs only on pages the service already marks `textlayer` (rules 1–4 passed).
- Every cell is `TABLE_CELL_TEXT_UNCONFIRMED` unless an OCR region of the same page confirms its text
  (`confirmedBy`). A geometry reader is a structure witness, not a text witness.
- ADR-2026-11-02 §3.5 still binds: no layer text replaces OCR text until the shadow witness agrees above a
  founder-set threshold.

## 5. The real-page question is not answered here

Nothing above says how often real statement pages place, nor what false-accept rate they produce. The synthetic set
was written by the same hand as the reader. On real pages the c20/c21 shape, kerning, justified prose, Type3 fonts,
mixed font sizes within a row and producer-specific glyph order are all unmeasured.

The command that would measure it, as an offline USD 0 run for a later order, on the dev split of the screen corpus
through the existing screen runner and reader v1:

```
# Core, codex/v34-core-int 783d8d0 or later; does not exist yet (WO-E-TBL-P1 writes it)
PYTHONUTF8=1 py -3.13 -m benchmark.screen.table_geometry \
  --manifest <screen dev manifest> --corpus-root <screen corpus root> \
  --gold <gold.dev.jsonl> --access-log <holdout access log> --out <new empty dir>
```

What that module does, all through code that exists today:

- `HoldoutGuard(manifest, access_log).load("dev", "tune")` (`C:benchmark/screen/manifest.py:488-514`); the holdout
  stays sealed (`:513-514`).
- `run_screen(guard=…, split="dev", purpose="tune", candidate=…, corpus_root=…, gold=…, raw_dir=…, records_path=…,
  call=<arm>)` (`C:benchmark/screen/run_screen.py:154-175`), once per arm. Arm A: the page's text-layer lines as the
  service emits them today. Arm B: the same lines with each placed table serialised row by row
  (`label | value | value`). Same pages, same order.
- Scoring with reader v1, `C:benchmark/screen/critical_fields.py` (sha256
  `ad0426213092ae4ce1e00796c07204524442db2f1310995ea4c01ed52d98d8e3`), `score_critical_fields` (`:979-985`). It reads
  the value after the field's anchor in the candidate text, which is exactly what an unordered run breaks.
- Reported per arm: critical fields right (denominator = gold fields on dev pages with a text layer), pages with a
  placed table, tables refused by signal, and false-accept: a gold field wrong in arm B that is right in arm A.
- Two things that run needs and does not have: a provider id, because `Candidate.validate` refuses any provider
  other than `native_document` or a registered runner (`C:benchmark/screen/run_screen.py:85-86`), and the CDR pin
  pypdfium2 5.13.0 in the Core environment for that run.

No corpus file was opened by this lane.

## 6. Options and dispositions

| Option | What it means | Disposition |
|---|---|---|
| **1. Keep lines only** | No table structure from PDFs. Ask keeps citing line regions. | Rejected as the end state: it leaves the observed defect. It stays the fallback for every page where 2 does not place. |
| **2. Geometry route** | A deterministic reader in the CDR, on `textlayer` pages only, emitting `tavonel.table_read.v1` with a per-table state `placed` / `not placed` and the signal. No model, no render, no new dependency (pypdfium2 is already in the image and `NOTICE`). | **Recommended**, behind the ladder in §7. It does not depend on route B, on a GPU, on a weight licence or on FTO-1 for a model. |
| **3. Wait for route B** | Scanned and PDF tables only through the arena-chosen model reader (ADR-2026-11-18 §2 B). | Not chosen for born-digital pages. Route B stays the route for pages without a text layer and for pages 2 refuses. That is a separate route chosen per page before reading, not a second reader started because 2 refused (§8). |

## 7. Ladder

compatibility contract → shadow → benchmark on the dev split → canary → rollout → deprecate.

1. **Contract.** `tavonel.table_read.v1` exists (`shared/tableReadContract.ts`). Missing: a `readerRevision` and
   `readerBindingSha256` for a code reader (its module digest and the pypdfium2 version), and the signal name, which
   goes into a receipt beside the per-page document because the contract's refusal shape has no field for it.
2. **Shadow.** The CDR computes tables on `textlayer` pages beside the text-layer receipt, behind a new flag that is
   off by default. The worker stores a `table-read.json` sibling create-once. Nothing reads it to build a World.
   `servedPages` stays 0. OCR stays authoritative.
3. **Benchmark (dev split, §5).** Gate, set by the lead before the run: arm B is not worse than arm A on critical
   fields, and arm B's false-accept count is reported with its denominator. A false accept on a real page that the
   synthetic set did not have is added to the synthetic set before any threshold moves.
4. **Canary.** The founder's own workspace. Placed tables are shown as tables with cell citations; cells keep
   `TABLE_CELL_TEXT_UNCONFIRMED` unless OCR confirms them.
5. **Rollout / deprecate.** Only after the canary. `no_table_or_formula_extraction` leaves the manifest only for
   born-digital PDF tables that placed, worded as that and nothing wider.

**Rollback at every step:** the flag off. Lines-only is today's behaviour and is never removed.

## 8. What a customer would see

- **Now (before canary): nothing changes.** Ask cites line regions as today.
- **After canary, a placed table:** Ask can cite a cell — table, row label, column header, value — with the
  cell's box measured from its glyphs. A cell that OCR did not confirm is marked as unconfirmed evidence, never a
  fact.
- **A table that is not placed:** the same text lines as today, and no claim of a table. The customer is not told
  "table extraction failed" as an error; the page simply has no table cells.
- **Known wrong output to disclose in the canary notes:** a caption or a second table set at row pitch directly
  above or below a table becomes part of it (c20, c21); a wrapped label shows only its last line as the row label
  (c04).
- No public sentence changes in this record. Any copy about cell citations follows REG:74-78 and REG:116 (§9).

## 9. Legal-hold check

One deterministic reader, written for this probe from the PDF geometry PDFium exposes; no third-party table
extraction code was read, copied, translated or ported. This is not claim analysis. The register entries it could
touch, quoted from `C:docs/ip/TECHNOLOGY_INTAKE_REGISTER.yaml` (sha256 above):

REG:43-58 (`tech_ibm_sequential_inference`), the `avoid` line:

```yaml
    avoid: >-
      The broad sequential-inference shape: first model → QoS comparison →
      conditional execution of a second model. Avoid expressions that read onto it.
```

- **Does not apply to the reader itself, and why:** there is no model in it. Its "not placed" output starts
  nothing; the page keeps its text lines. OCR runs on every page whether or not the reader places a table.
- **Where it would start to apply, so it is ruled out here:** if a refusal of this reader triggered route B's model
  on that page, a model's execution would depend on another reader's failed check (shape T-B3 of ADR-2026-11-18 §3,
  which that record does not propose). This record proposes route selection by page facts known **before** any
  reader runs (text layer present and `textlayer` path), never by this reader's output. The shape is recorded as
  T-G1 for counsel: "a deterministic geometry reader runs on `textlayer` pages; its result changes only what is
  shown (table cells or lines); no model is started by it". It joins the question set of ADR-2026-11-18 §5 unchanged.

REG:74-78 (`tech_oracle_dynamic_lineage`):

```yaml
    avoid: "Claiming generic provenance + temporal lineage as an independent invention."
```

- **Applies to copy, not to the reader:** cell citations must not be presented as TAVONEL's independent invention
  of provenance (REG:116: "do not describe selective recompilation or lineage in terms that read onto a RED
  family").

REG:60-72 (`tech_palantir_universal_data_pipeline`, `tech_palantir_propagated_deletion`): **do not apply.** The
reader builds no dataset catalog, derivation graph or rebuild; it reads one page.

Licences: no new component. pypdfium2 5.13.0 and its bundled PDFium are already in the CDR image with a `NOTICE`
row (`quarantine-sidecar/cdr-cloudrun/NOTICE:23-28`). The register has no row for the CDR's pypdfium2 (it appears
only inside another row's licence list, REG:468-469); that gap predates this record and is FTO-3's (REG:163-164).

## 10. The first three work orders (proposed; the lead sizes and dates them)

1. **WO-E-TBL-P1 — Core, offline USD 0, measure on the dev split.** Write `benchmark/screen/table_geometry.py` as in
   §5, with the reader of this probe moved into a pinned module (no product code). Register a provider id for it.
   Run at pypdfium2 5.13.0. Output: per-arm critical-field counts with denominators, refusal counts by signal,
   false accepts with their pages kept in the custodian's directory only. Decision input for the lead: go to shadow
   or stop.
2. **WO-E-TBL-P2 — CDR shadow, flag off by default.** `table_geometry.py` in `quarantine-sidecar/cdr-cloudrun/` on
   `textlayer` pages only; `table_read.v1` per page plus a receipt with the signal names and every constant; worker
   stores `table-read.json` create-once beside `text-layer.json`; nothing reads it for a World. Tests: every case
   of the synthetic set, including c20/c21 asserted as the known false accept, and the hostile-layer cases of
   `tests/test_text_layer.py` asserting that no table is read from a page that is not `textlayer`.
3. **WO-E-TBL-P3 — Confirmation and citation.** Match placed cells to OCR regions of the same page for
   `confirmedBy`; carry placed tables into the compile as table evidence with cell locators, held behind the canary
   flag; Ask shows unconfirmed cells as evidence only. Starts after P1's measurement says go.

## 11. Not established

- Any number on real pages (§5).
- The probe at the CDR pin pypdfium2 5.13.0 (run at 4.30.0).
- Per-page time and memory of the reader at the CDR's bounds (80 pages, 200,000 characters a page).
- Pages from producers that set glyphs out of reading order, use Type3 fonts, set kerning with TJ inside numbers,
  or mix font sizes within a row: none is in the synthetic set.
- Whether stacked tables or captions at row pitch (c20, c21) are common in the corpus.

## 12. Rollback of this record

Documents only. Revert the commit.

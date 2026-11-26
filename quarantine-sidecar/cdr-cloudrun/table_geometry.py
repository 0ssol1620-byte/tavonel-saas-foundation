"""Tables in born-digital PDF pages from the text layer's own geometry (ADR-2026-11-23, WO-E-TBL-P2).

Shadow only. Behind TAVONEL_TABLE_READER_MODE ("off" by default, "shadow"), /v1/text-layer adds a
`tableRead` section to its receipt; the worker stores it as `table-read.json` beside
`text-layer.json`. Nothing reads it to build a World, `servedPages` is 0, OCR stays authoritative.

The reader is the WO-E-TBL-P0 probe (`receipts/WO-E-TBL-P0/reader.py`) moved here. Its only input is
per-glyph data PDFium already holds: code point, loose box, origin, font size, angle, page rotation.
No model, no render, no OCR, no network. It runs only on pages text_layer.py classed `textlayer`
(rules 1-4 passed); every other page is not read and carries no table document.

Per page it emits `tavonel.table_read.v1` (shared/tableReadContract.ts) without `sourceImmutableKey`,
which only the worker knows and adds. A placed table is a `tables[]` entry, a table that is not
placed is a `refusals[]` entry (TABLE_GRID_INVALID, or TABLE_REGION_UNLOCATED when the whole page is
not placed, or TABLE_OUTPUT_TRUNCATED when the page exceeds the contract's bounds), and the signal
that decided it sits beside the document in `tables[]` of the page record, because a refusal has no
field for it. Every cell has `confirmedBy: []`: a geometry reader is a structure witness, not a text
witness, so every cell qualifies as TABLE_CELL_TEXT_UNCONFIRMED. A table that is not placed is never
emitted as cells; the page's text lines are untouched.

Algorithm (ADR §3.2):
 1. Page gate: rotation != 0 or any glyph angle != 0 -> page not placed. Non-finite box, U+FFFD, NUL
    or an unpaired surrogate -> page not placed.
 2. Lines: non-space glyphs grouped by baseline (origin y within BASELINE_TOL_EM x font size).
 3. Phrases: a line splits where the gap between glyph boxes exceeds PHRASE_GAP_EM x font size; a lone
    currency sign joins the numeric phrase to its right; a phrase of 3+ rule characters is a rule.
 4. Numeric phrase: VALUE (currency, sign or parentheses, grouped digits, decimals, %, or a dash).
 5. Body row: a line with >= 2 phrases and a numeric phrase after the first, or >= 2 numeric phrases.
 6. Runs: consecutive lines at one font size with baseline gaps <= BLOCK_GAP_EM x size; a run with
    >= MIN_BODY_ROWS body rows holds a table from its first to its last body row.
 7. Columns: x-intervals of the body rows' non-label phrases, merged where they overlap, are bands; a
    text-only band right of a numeric band splits the block into side-by-side tables at its left edge.
 8. Header: extend upward from the first body row over lines whose phrases all place (rule 9). It
    stops at the first that does not, and at a caption: a label-only line directly above a line that
    has value cells and no label (the c20 signal, WO-E-TBL-P2 lead ruling). A caption is left as text.
 9. Placement: a phrase left of band 0 is the label (col 0); any other phrase overlaps exactly one band
    (col = band + 1); a non-numeric header phrase may overlap a contiguous run of bands (span).
10. Refusal (table not placed): a phrase straddling the label edge, a value in 0 or >= 2 bands, two
    phrases of one line in one band, two adjacent bands never both filled in any body row, or a
    header-like line inside the body -- no numeric phrase, its value phrases filling every band --
    which is a second table stacked at row pitch (the c21 signal; c21 itself has no such line).

Known false accepts, asserted in tests/test_table_geometry.py: a label-only line at table size and
pitch between two stacked tables with no second header (c21) merges them, and a wrapped label keeps
its last visual line only (c04). Geometry has no signal for either; P3's OCR confirmation is the
second guard, and nothing reaches a World before P1's real-page measurement.

Constants: none calibrated. Each is derived from the synthetic generator (receipts/WO-E-TBL-P0/synth.py)
and from nothing else; the synthetic set does not constrain them (ADR §3.3, sweep.txt). Real pages set
them (ADR §7). Every receipt records them.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import logging
import math
import os
import re
import unicodedata
from bisect import bisect_left, bisect_right
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field
from importlib.metadata import version
from itertools import pairwise
from pathlib import Path
from typing import Final

import pypdfium2 as pdfium  # type: ignore[import-untyped, unused-ignore]
import pypdfium2.raw as pdfium_c  # type: ignore[import-untyped, unused-ignore]

MODE_ENV: Final = "TAVONEL_TABLE_READER_MODE"
SCHEMA: Final = "tavonel.cdr_table_read.v1"
TABLE_READ_SCHEMA: Final = "tavonel.table_read.v1"

# The generator sets every cell of a row on one baseline and rows >= 1.33 em apart.
BASELINE_TOL_EM: Final = 0.2
# Above Helvetica's word space with loose boxes (0.278 em), below the narrowest gutter synth.py sets.
PHRASE_GAP_EM: Final = 1.0
# Only inserts a space into a phrase's text; never decides a cell.
WORD_SPACE_EM: Final = 0.15
# Above the generator's row pitch (12 pt at 9 pt = 1.33 em), below the space it leaves around prose
# (>= 2.6 em).
BLOCK_GAP_EM: Final = 2.0
# One line holding a number is not a table.
MIN_BODY_ROWS: Final = 2
# Float noise of an upright text matrix, in radians; any deliberate rotation is far larger.
ANGLE_TOL: Final = 1e-3
# The service's own per-page ceiling (text_layer.MAX_PAGE_CHARS); a textlayer page is under it.
MAX_PAGE_CHARS: Final = 200_000

# shared/tableReadContract.ts wire bounds. Output over one is never truncated into a valid shape:
# the table, or the page, is not placed.
MAX_TABLES: Final = 64
MAX_REFUSALS: Final = 256
MAX_CELLS: Final = 10_000
MAX_GRID_EXTENT: Final = 1_000
MAX_TEXT: Final = 20_000

CONSTANTS: Final = {
    "baselineTolEm": BASELINE_TOL_EM,
    "phraseGapEm": PHRASE_GAP_EM,
    "wordSpaceEm": WORD_SPACE_EM,
    "blockGapEm": BLOCK_GAP_EM,
    "minBodyRows": MIN_BODY_ROWS,
    "angleTol": ANGLE_TOL,
}

CURRENCY: Final = frozenset({"$", "€", "£", "¥", "₩"})
VALUE: Final = re.compile(
    r"^[$€£¥₩]?\(?[-−]?[$€£¥₩]?"
    r"(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?\)?$|^[-–—]$|^%$"
)
RULE: Final = re.compile(r"^[_=\-–—]{3,}$")

logger = logging.getLogger("tavonel.cdr")

REVISION: Final = "sha256:" + hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def reader_mode(env: Mapping[str, str] | None = None) -> str:
    """"off" or "shadow". Unset is off; any other value is off, and the reason is logged."""
    value = (os.environ if env is None else env).get(MODE_ENV, "")
    if value in ("", "off"):
        return "off"
    if value == "shadow":
        return "shadow"
    logger.warning("%s is not off or shadow; table reader off", MODE_ENV)
    return "off"


def reader_binding() -> dict[str, object]:
    """What the reader is: its module digest, the PDFium binding it ran on, and its constants."""
    pin = version("pypdfium2")
    canonical = json.dumps({"constants": CONSTANTS, "pypdfium2": pin, "revision": REVISION}, sort_keys=True)
    return {
        "revision": REVISION,
        "bindingSha256": "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "pypdfium2": pin,
        "constants": dict(CONSTANTS),
        "calibrated": False,
    }


class NotPlaced(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class Glyph:
    ch: str
    left: float
    bottom: float
    right: float
    top: float
    oy: float
    size: float


@dataclass
class Phrase:
    text: str
    left: float
    right: float
    bottom: float
    top: float
    numeric: bool = False
    rule: bool = False


@dataclass
class Line:
    baseline: float
    size: float
    phrases: list[Phrase] = field(default_factory=list)

    def body(self) -> bool:
        ph = [p for p in self.phrases if not p.rule]
        if len(ph) < 2:
            return False
        return any(p.numeric for p in ph[1:]) or sum(p.numeric for p in ph) >= 2


# A placed cell: (col, span, text, (left, bottom, right, top)).
Cell = tuple[int, int, str, tuple[float, float, float, float]]


@dataclass
class Placed:
    columns: int  # value bands; the label column is one more
    rows: dict[int, list[Cell]]  # row relative to the first body row; header rows are negative


def _glyphs(textpage: pdfium.PdfTextPage) -> list[Glyph]:
    count = textpage.count_chars()
    if count < 0 or count > MAX_PAGE_CHARS:
        raise NotPlaced("layer_char_count")
    out: list[Glyph] = []
    x, y = ctypes.c_double(), ctypes.c_double()
    index = 0
    while index < count:
        i = index
        unit = pdfium_c.FPDFText_GetUnicode(textpage.raw, i)
        index += 1
        if 0xD800 <= unit <= 0xDBFF:
            low = pdfium_c.FPDFText_GetUnicode(textpage.raw, index) if index < count else 0
            if not 0xDC00 <= low <= 0xDFFF:
                raise NotPlaced("layer_undecodable")
            ch = chr(0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00))
            index += 1
        elif unit in (0, 0xFFFD) or 0xD800 <= unit <= 0xDFFF or unit > 0x10FFFF:
            raise NotPlaced("layer_undecodable")
        else:
            ch = chr(unit)
        if ch.isspace() or unicodedata.category(ch) == "Cc":
            continue
        angle = float(pdfium_c.FPDFText_GetCharAngle(textpage.raw, i))
        if not math.isfinite(angle) or angle < 0:
            raise NotPlaced("layer_angle_unavailable")
        if min(angle, 2 * math.pi - angle) > ANGLE_TOL:
            raise NotPlaced("glyph_rotated")
        if not pdfium_c.FPDFText_GetCharOrigin(textpage.raw, i, ctypes.byref(x), ctypes.byref(y)):
            raise NotPlaced("layer_origin_unavailable")
        left, bottom, right, top = textpage.get_charbox(i, loose=True)
        size = float(pdfium_c.FPDFText_GetFontSize(textpage.raw, i))
        values = (left, bottom, right, top, x.value, y.value, size)
        if not all(math.isfinite(v) for v in values) or size <= 0:
            raise NotPlaced("layer_geometry_not_finite")
        out.append(Glyph(ch, left, bottom, right, top, y.value, size))
    return out


def _lines(glyphs: list[Glyph]) -> list[Line]:
    lines: list[list[Glyph]] = []
    for g in sorted(glyphs, key=lambda g: (-g.oy, g.left)):
        if lines and abs(lines[-1][0].oy - g.oy) <= BASELINE_TOL_EM * g.size:
            lines[-1].append(g)
        else:
            lines.append([g])
    out = []
    for gs in lines:
        gs.sort(key=lambda g: g.left)
        size = Counter(round(g.size, 2) for g in gs).most_common(1)[0][0]
        phrases: list[Phrase] = []
        cur: list[Glyph] = []
        for g in gs:
            if cur and g.left - cur[-1].right > PHRASE_GAP_EM * max(g.size, cur[-1].size):
                phrases.append(_phrase(cur))
                cur = []
            cur.append(g)
        phrases.append(_phrase(cur))
        merged: list[Phrase] = []
        for ph in phrases:  # a lone currency sign joins the numeric phrase to its right
            if merged and merged[-1].text in CURRENCY and ph.numeric:
                prev = merged.pop()
                ph = Phrase(prev.text + ph.text, prev.left, ph.right, min(prev.bottom, ph.bottom),
                            max(prev.top, ph.top), True)
            merged.append(ph)
        out.append(Line(gs[0].oy, size, merged))
    return out


def _phrase(gs: list[Glyph]) -> Phrase:
    parts = [gs[0].ch]
    for a, b in pairwise(gs):
        parts.append((" " if b.left - a.right > WORD_SPACE_EM * b.size else "") + b.ch)
    text = "".join(parts)
    return Phrase(text, gs[0].left, gs[-1].right, min(g.bottom for g in gs), max(g.top for g in gs),
                  bool(VALUE.match(text)), bool(RULE.match(text)))


class Bands:
    """Merged x-intervals, sorted and disjoint, so the bands a phrase overlaps are one bisect away."""

    def __init__(self, phrases: list[Phrase]):
        bands: list[list[float | bool]] = []  # [left, right, all_non_numeric]
        for p in sorted(phrases, key=lambda p: p.left):
            if bands and p.left <= float(bands[-1][1]):
                bands[-1][1] = max(float(bands[-1][1]), p.right)
                bands[-1][2] = bool(bands[-1][2]) and not p.numeric
            else:
                bands.append([p.left, p.right, not p.numeric])
        self.lefts = [float(b[0]) for b in bands]
        self.rights = [float(b[1]) for b in bands]
        self.text_only = [bool(b[2]) for b in bands]

    def __len__(self) -> int:
        return len(self.lefts)

    def hits(self, p: Phrase) -> range:
        return range(bisect_left(self.rights, p.left), bisect_right(self.lefts, p.right))


def _value_phrases(body: list[Line]) -> list[Phrase]:
    out: list[Phrase] = []
    for ln in body:
        ph = [p for p in ln.phrases if not p.rule]
        out.extend(ph[1:] if not ph[0].numeric else ph)
    return out


def _union(boxes: list[tuple[float, float, float, float]]) -> tuple[float, float, float, float]:
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def _place_line(line: Line, bands: Bands, header: bool) -> list[Cell]:
    edge = bands.lefts[0]
    labels: list[Phrase] = []
    values: list[Phrase] = []
    for p in line.phrases:
        if p.rule:
            continue
        if p.right < edge:
            labels.append(p)
        elif p.left < edge:
            raise NotPlaced("label_straddles_value_column")
        else:
            values.append(p)
    cells: list[Cell] = []
    if labels:
        box = _union([(p.left, p.bottom, p.right, p.top) for p in labels])
        cells.append((0, 1, " ".join(p.text for p in labels), box))
    used: set[int] = set()
    for p in values:
        hit = bands.hits(p)
        if not hit:
            raise NotPlaced("value_outside_columns")
        if len(hit) > 1 and (p.numeric or not header):
            raise NotPlaced("value_in_two_columns")
        if used.intersection(hit):
            raise NotPlaced("two_values_one_column")
        used.update(hit)
        cells.append((hit[0] + 1, len(hit), p.text, (p.left, p.bottom, p.right, p.top)))
    return cells


def _header_like(line: Line, bands: Bands) -> bool:
    """A line with no numeric phrase and at least two value phrases that fill every band: a column
    header. One phrase is a spanning title or a garbled overlap (c17), not a second header."""
    if any(p.numeric for p in line.phrases):
        return False
    filled: set[int] = set()
    values = 0
    for p in line.phrases:
        if not p.rule and p.right >= bands.lefts[0]:  # a header may start left of its numbers
            filled.update(bands.hits(p))
            values += 1
    return values >= 2 and len(filled) == len(bands)


def _table(lines: list[Line], first_body: int, last_body: int) -> Placed:
    """One table from lines[first_body..last_body] plus header lines above; raises NotPlaced."""
    body = [ln for ln in lines[first_body:last_body + 1] if ln.body()]
    bands = Bands(_value_phrases(body))
    if len(bands) + 1 > MAX_GRID_EXTENT:
        raise NotPlaced("table_over_contract_bounds")
    both: set[int] = set()
    for ln in body:
        filled: set[int] = set()
        for p in ln.phrases:
            filled.update(bands.hits(p))
        both.update(i for i in filled if i + 1 in filled)
    if any(i not in both for i in range(len(bands) - 1)):
        raise NotPlaced("column_split_ambiguous")
    for k in range(first_body + 1, last_body):
        if not lines[k].body() and _header_like(lines[k], bands):
            raise NotPlaced("stacked_table_header")
    rows: dict[int, list[Cell]] = {}
    for k in range(first_body, last_body + 1):
        rows[k - first_body] = _place_line(lines[k], bands, header=False)
    k = first_body - 1
    # Lines run top to bottom, so the gap to the line below is lines[k].baseline - lines[k + 1].baseline.
    while k >= 0 and lines[k].baseline - lines[k + 1].baseline <= BLOCK_GAP_EM * lines[k].size \
            and lines[k].size == lines[first_body].size:
        try:
            cells = _place_line(lines[k], bands, header=True)
        except NotPlaced:
            break
        below = rows[k + 1 - first_body]
        if cells and all(c[0] == 0 for c in cells) and below and all(c[0] > 0 for c in below):
            break  # a caption above the column header line: left as text
        rows[k - first_body] = cells
        k -= 1
    return Placed(len(bands), rows)


def _split_points(lines: list[Line], first_body: int, last_body: int) -> list[float]:
    """Left edges of text-only bands that sit right of a numeric band: side-by-side table starts."""
    bands = Bands(_value_phrases([ln for ln in lines[first_body:last_body + 1] if ln.body()]))
    cuts = []
    seen_numeric = False
    for left, text_only in zip(bands.lefts, bands.text_only, strict=True):
        if text_only and seen_numeric:
            cuts.append(left)
            seen_numeric = False
        elif not text_only:
            seen_numeric = True
    return cuts


def _partition(lines: list[Line], lo: float, hi: float) -> list[Line]:
    out = []
    for ln in lines:
        ph = []
        for p in ln.phrases:
            if p.left >= lo and p.right < hi:
                ph.append(p)
            elif p.right >= lo and p.left < hi:
                raise NotPlaced("phrase_crosses_table_split")
        out.append(Line(ln.baseline, ln.size, ph))
    return out


def _runs(lines: list[Line]) -> list[tuple[int, int]]:
    runs, start = [], 0
    for i in range(1, len(lines) + 1):
        if i == len(lines) or lines[i].size != lines[i - 1].size or \
                lines[i - 1].baseline - lines[i].baseline > BLOCK_GAP_EM * lines[i].size:
            runs.append((start, i - 1))
            start = i
    return runs


def _sub_table(part: list[Line], lo: int, hi: int) -> Placed | NotPlaced:
    keep = [ln for ln in part[lo:hi + 1] if ln.phrases]
    idx = [i for i, ln in enumerate(keep) if ln.body()]
    if len(idx) < MIN_BODY_ROWS:
        return NotPlaced("side_part_without_body_rows")
    return _table(keep, idx[0], idx[-1])


def _tables_in(lines: list[Line]) -> list[Placed | NotPlaced]:
    """Each candidate table, placed or the NotPlaced that refused it. As in the probe, a refusal
    while splitting side-by-side tables ends that run: parts already placed stay, the rest are one
    refusal."""
    out: list[Placed | NotPlaced] = []
    for lo, hi in _runs(lines):
        idx = [i for i in range(lo, hi + 1) if lines[i].body()]
        if len(idx) < MIN_BODY_ROWS:
            continue
        first, last = idx[0], idx[-1]
        try:
            cuts = _split_points(lines, first, last)
            if not cuts:
                out.append(_table(lines, first, last))
                continue
            edges = [-math.inf, *cuts, math.inf]
            for a, b in pairwise(edges):
                out.append(_sub_table(_partition(lines, a, b), lo, hi))
        except NotPlaced as exc:
            out.append(exc)
    return out


def _bbox1000(box: tuple[float, float, float, float], width: float, height: float) -> list[int] | None:
    """A PDF-space box as bbox1000 (top-left origin), measured, or None when it has no area."""
    left, bottom, right, top = box
    out = [
        max(0, min(1000, math.floor(left / width * 1000))),
        max(0, min(1000, math.floor((height - top) / height * 1000))),
        max(0, min(1000, math.ceil(right / width * 1000))),
        max(0, min(1000, math.ceil((height - bottom) / height * 1000))),
    ]
    return out if out[0] < out[2] and out[1] < out[3] else None


def _table_document(table: Placed, table_id: str, width: float, height: float) -> dict[str, object]:
    """A placed table in table_read.v1 shape; raises NotPlaced over the contract's bounds."""
    rows = table.rows
    first, last = min(rows), max(rows)
    if last - first + 1 > MAX_GRID_EXTENT:
        raise NotPlaced("table_over_contract_bounds")
    cells: list[dict[str, object]] = []
    boxes: list[tuple[float, float, float, float]] = []
    for row, row_cells in sorted(rows.items()):
        for col, span, text, box in row_cells:
            if len(text) > MAX_TEXT:
                raise NotPlaced("table_over_contract_bounds")
            boxes.append(box)
            r0 = row - first
            cells.append({
                "cellId": f"{table_id}-r{r0}-c{col}",
                "rowIndex0": r0,
                "columnIndex0": col,
                "rowSpan": 1,
                "columnSpan": span,
                "text": text,
                "bbox1000": _bbox1000(box, width, height),
                "confirmedBy": [],
            })
    if len(cells) > MAX_CELLS:
        raise NotPlaced("table_over_contract_bounds")
    table_box = _bbox1000(_union(boxes), width, height)
    if table_box is None:
        raise NotPlaced("table_region_degenerate")
    return {
        "tableId": table_id,
        "bbox1000": table_box,
        "rowCount": last - first + 1,
        "columnCount": table.columns + 1,
        "headerRowCount": -first,
        "cells": cells,
        "qualityFlags": [],
    }


def read_page(page: pdfium.PdfPage, page_number1: int) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """(per-table receipt entries, table_read.v1 tables and refusals) for one textlayer page."""
    width, height = (float(v) for v in page.get_size())
    textpage = page.get_textpage()
    try:
        if page.get_rotation() != 0:
            raise NotPlaced("page_rotated")
        if not (math.isfinite(width) and math.isfinite(height) and width > 0 and height > 0):
            raise NotPlaced("page_size_unusable")
        lines = _lines(_glyphs(textpage))
    except NotPlaced as exc:
        entry: dict[str, object] = {"tableId": None, "state": "not_placed", "signal": exc.reason}
        page_refusal: dict[str, object] = {"bbox1000": None, "reasonCode": "TABLE_REGION_UNLOCATED"}
        return [entry], [page_refusal]
    finally:
        textpage.close()
    entries: list[dict[str, object]] = []
    items: list[dict[str, object]] = []
    for n, candidate in enumerate(_tables_in(lines), start=1):
        table_id = f"p{page_number1}-t{n}"
        try:
            if isinstance(candidate, NotPlaced):
                raise candidate
            items.append(_table_document(candidate, table_id, width, height))
            entries.append({"tableId": table_id, "state": "placed", "signal": None})
        except NotPlaced as exc:
            items.append({"bbox1000": None, "reasonCode": "TABLE_GRID_INVALID"})
            entries.append({"tableId": None, "state": "not_placed", "signal": exc.reason})
    return entries, items


def unavailable(reason: str) -> dict[str, object]:
    """A `tableRead` section for a reader that failed: recorded, so the shadow never fails silently."""
    return {
        "schemaVersion": SCHEMA, "mode": "shadow", "status": "unavailable", "reason": reason,
        "reader": reader_binding(), "servedPages": 0, "pages": [],
    }


def read_document(pdf_bytes: bytes, text_layer_receipt: Mapping[str, object]) -> dict[str, object]:
    """The `tableRead` section for a text-layer receipt: a page record for every page, read on
    `textlayer` pages only. The source is opened as its own document (text_layer mutates its copy)."""
    input_sha256 = text_layer_receipt["inputSha256"]
    layer_pages = text_layer_receipt["pages"]
    if not isinstance(input_sha256, str) or not isinstance(layer_pages, list):
        raise TypeError("not a text-layer receipt")
    binding = reader_binding()
    section: dict[str, object] = {
        "schemaVersion": SCHEMA, "mode": "shadow", "status": "read", "reason": None, "reader": binding,
        "servedPages": 0, "pages": [],
    }
    records: list[dict[str, object]] = []
    try:
        document = pdfium.PdfDocument(pdf_bytes)
    except pdfium.PdfiumError:
        return {**section, "status": "unavailable", "reason": "pdfium_error"}
    try:
        if len(document) != len(layer_pages):
            raise RuntimeError("the text-layer receipt and the source disagree on the page count")
        for index, layer_page in enumerate(layer_pages):
            if not isinstance(layer_page, dict):
                raise TypeError("not a text-layer page record")
            path = layer_page["path"]
            if layer_page["pageNumber1"] != index + 1 or not isinstance(path, str):
                raise RuntimeError("the text-layer receipt's pages are not in order")
            record: dict[str, object] = {"pageNumber1": index + 1, "path": path, "read": path == "textlayer"}
            if path != "textlayer":
                records.append({**record, "tables": [], "document": None})
                continue
            page = document[index]
            try:
                entries, items = read_page(page, index + 1)
            finally:
                page.close()
            tables = [item for item in items if "tableId" in item]
            refusals = [item for item in items if "tableId" not in item]
            if len(tables) > MAX_TABLES or len(refusals) > MAX_REFUSALS:
                over: dict[str, object] = {"tableId": None, "state": "not_placed", "signal": "page_over_contract_bounds"}
                truncated: dict[str, object] = {"bbox1000": None, "reasonCode": "TABLE_OUTPUT_TRUNCATED"}
                entries, tables, refusals = [over], [], [truncated]
            status = "read" if tables else ("unreadable" if refusals else "no_table")
            records.append({**record, "tables": entries, "document": {
                "schemaVersion": TABLE_READ_SCHEMA,
                "inputSha256": input_sha256,
                "readerRevision": binding["revision"],
                "readerBindingSha256": binding["bindingSha256"],
                "pageIndex0": index,
                "pageNumber1": index + 1,
                "pageStatus": status,
                "tables": tables,
                "formulas": [],
                "refusals": refusals,
            }})
    except pdfium.PdfiumError:
        return {**section, "status": "unavailable", "reason": "pdfium_error"}
    finally:
        document.close()
    return {**section, "pages": records}

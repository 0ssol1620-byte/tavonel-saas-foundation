"""Text-layer-first reading inside the CDR step (ADR-2026-11-02-text-layer-first-cdr).

The CDR already opens every qualified source with PDFium to rasterise it, and the rasterised PDF
it returns has no text layer at all. So the OCR worker re-reads text that the source carried as
text: on the GDP.pdf v3 corpus, 1,300 of 1,350 pages had a text layer and every one of them was
re-OCRed from a 108 DPI render (hard-proof-20261027 research/beat-baseline/DIAGNOSIS.md §4.1).

This module reads that layer in the same process, from the same PDFium document, with no network
and no new dependency, and decides per page which path produces the page's text. The rule set is
the v4 research arm's (core-GDP research/gdp_pdf_v4_20261027/render.py `page_source`,
PROTOCOL-v4.md §5) moved to where no OCR witness exists yet:

  ocr:no-text-layer          the layer has no letter or digit                       (rule 1)
  ocr:geometry-unsupported   rotation, CropBox != MediaBox or a moved origin        (rule 2)
  ocr:hidden-text-suspect    any glyph that trips one of these heuristics: invisible (rule 3)
                             render mode, no ink where the glyph sits (white text,
                             text under an image, clipped away), ink over less than
                             MIN_INK_COVERAGE of its pixel box (a clip or a later
                             shape leaves a thin band), outside the page, shorter
                             than MIN_GLYPH_PX in the render by its page box or by
                             its em size from the text matrix (a 1 pt glyph turned
                             90 degrees and stretched), overlapping a glyph of
                             another text object (white text over or under visible
                             text borrows that text's ink), or sharing
                             SAME_OBJECT_OVERLAP_SHARE or more of its box with a
                             glyph of its own text object (one TJ array that steps
                             back after every glyph stacks a sentence into a dot)
  ocr:image-content          images cover enough of the page that it can hold text  (rule 4)
                             the layer does not have (a scan with a partial layer)
  textlayer                  everything else

Rule 3 is stricter than the research arm. There the witness was the OCR of the render and the
pre-registered tolerance was half the layer's tokens unseen; here the witness is the render
itself, compared with the same page rendered with its text objects removed, and the tolerance is
zero: a page with one glyph that trips a check goes to OCR and is flagged.
`ocr_witness_disagrees` keeps the research rule for the consumer that does hold an OCR reading of
the page (shadow mode).

A layer that cannot be read as text -- PDFium errors, a negative character count, U+FFFD or NUL in
the decoded text, a page beyond the character ceiling -- is not a page decision. It raises
`TextLayerCorrupt`, and the caller refuses the layer for the whole document: every page then goes
to OCR, exactly as before this module existed, and the receipt says why. Nothing from a layer that
failed this way is ever returned.

No threshold here is calibrated. INK_DELTA, IMAGE_AREA_SHARE, MIN_GLYPH_PX, MIN_INK_COVERAGE,
SAME_OBJECT_OVERLAP_SHARE and the zero tolerance are chosen, recorded in every receipt, and are
what the canary measures.

Rule 3 is a heuristic over hostile input. Completeness is NOT claimed: a PDF has more ways to
draw a glyph nobody can read than these checks name, and two earlier versions of this docstring
claimed more than the code did (REVIEW-PRODUCT-R2 B1, R3 B1). What was tried, on synthetic pages
at the pinned pypdfium2 5.13.0 (the full table is ADR §3.2):

  caught      white text over, under or half a line off visible text; Tr 3 over visible text;
              1-2 pt type; a sentence stacked into one spot by TJ back-steps, Tc or two objects;
              a full clip or cover; a clip or white shapes leaving a 0.4-3 pt band of 14 pt
              type (since R3); 1 pt type stretched 30x and turned 90 degrees by Tm or cm (since
              R3); 1-15 Tz squeeze of 14 pt type (since R3, by the em-size floor)
  not caught  a band of 4 pt or more of 14 pt type; 20 Tz and above; faint text whose grey
              still clears INK_DELTA (0.70-0.75 on white); same-object overlap under
              SAME_OBJECT_OVERLAP_SHARE; a glyph map that lies -- /Differences plus /ToUnicode,
              Type3 or an edited embedded font drawing one word while the layer says another.
              No geometry rule can catch the last one: the render proves there is ink where a
              glyph sits, not that the ink is the glyph the layer names. Only an OCR witness can.

So `textlayer` is a routing priority, never permission to skip OCR. The text-layer path does not
replace OCR output for any page until a same-document shadow OCR witness agrees
(`ocr_witness_disagrees`) above a founder-set threshold (ADR §3.5, §5, §8). The worker side is not
implemented, so no page skips OCR today.
"""

from __future__ import annotations

import ctypes
import hashlib
import math
import os
import re
import unicodedata
from collections.abc import Mapping
from importlib.metadata import version
from typing import Final

import pypdfium2 as pdfium  # type: ignore[import-untyped, unused-ignore]
import pypdfium2.raw as pdfium_c  # type: ignore[import-untyped, unused-ignore]
from PIL import Image, ImageChops

FLAG_ENV: Final = "TAVONEL_CDR_TEXT_LAYER_FIRST"
ADR: Final = "docs/adr/ADR-2026-11-02-text-layer-first-cdr.md"
SCHEMA: Final = "tavonel.cdr_text_layer.v1"

INK_DELTA: Final = 48  # grey levels of difference that count as ink
IMAGE_AREA_SHARE: Final = 0.10  # of the page area, summed over top-level image objects
UNSEEN_GLYPH_TOLERANCE: Final = 0
# A letter or digit whose glyph box is shorter than this in the render is unreadable: at the
# default 1.5 scale, 4 px is about the x-height of 5 pt type. The same floor applies to the
# glyph's effective em size from its text matrix (smallest singular value x font size), so a
# 1 pt glyph stretched along its baseline and rotated 90 degrees, whose page box is tall, is
# still too small (REVIEW-PRODUCT-R3 B1).
MIN_GLYPH_PX: Final = 4.0
# Inked pixels over the glyph's pixel box. A clip or a later white shape that leaves a 1-2 pt band
# of a 10 pt glyph leaves ink in every box, but only 0.02-0.12 of it; normal Helvetica, Times,
# Courier and Helvetica-Bold, 5-72 pt, measured 0.185 (Courier 72 pt "i") and up
# (REVIEW-PRODUCT-R3 B1). ponytail: uncalibrated, picked between those two; thin display faces
# fall under it and go to OCR, bands wider than about 3 pt of 14 pt type pass. Shadow sets it.
MIN_INK_COVERAGE: Final = 0.15
# Two glyphs of one text object sharing at least this share of the smaller box are stacked, not
# set. REVIEW-PRODUCT-R2 measured the largest same-object share at 0.0 for normal sentences, 8 pt
# footnotes and kerning pairs, and 1.0 for a sentence stacked into one spot by TJ back-steps.
# ponytail: uncalibrated, picked between those two points; the shadow measurement (ADR §8) sets it.
SAME_OBJECT_OVERLAP_SHARE: Final = 0.5
_OVERLAP_CELL_PT: Final = 16.0  # grid for the glyph-overlap search
# ponytail: a cell holding more glyphs than this counts them all as overlapping instead of
# comparing every pair; normal type above MIN_GLYPH_PX puts well under 64 glyphs in a 16 pt cell.
_OVERLAP_CELL_CAP: Final = 64
MAX_PAGE_CHARS: Final = 200_000
# PROTOCOL-v4.md §5 rule 3 and rule 4, for a consumer that holds an OCR reading of the page.
WITNESS_MIN_TOKENS: Final = 20
WITNESS_UNSEEN_SHARE: Final = 0.5
WITNESS_SPARSE_RATIO: Final = 0.5

TEXTLAYER: Final = "textlayer"
NO_TEXT_LAYER: Final = "ocr:no-text-layer"
GEOMETRY_UNSUPPORTED: Final = "ocr:geometry-unsupported"
HIDDEN_TEXT: Final = "ocr:hidden-text-suspect"
IMAGE_CONTENT: Final = "ocr:image-content"
LAYER_REFUSED: Final = "ocr:text-layer-refused"

_INVISIBLE_RENDER_MODES: Final = {3, 7}  # PDF Tr 3 = invisible, 7 = clip only
_ALNUM = re.compile(r"[^\W_]", re.UNICODE)
_TOKEN = re.compile(r"[a-z0-9]{3,}")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class TextLayerCorrupt(Exception):
    """The layer cannot be trusted as text at all; the document's whole layer is refused."""


def text_layer_enabled(env: Mapping[str, str] | None = None) -> bool:
    """The flag. Unset or "0" is off, "1" is on, anything else refuses to boot."""
    value = (os.environ if env is None else env).get(FLAG_ENV, "")
    if value in ("", "0"):
        return False
    if value == "1":
        return True
    raise RuntimeError(f"{FLAG_ENV} must be unset, '0' or '1'")


def _sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _tokens(text: str) -> set[str]:
    return set(_TOKEN.findall(unicodedata.normalize("NFKC", text).lower()))


def ocr_witness_disagrees(layer_text: str, ocr_text: str) -> str | None:
    """PROTOCOL-v4.md §5 rules 3-4 against an OCR reading of the same page, or None if they agree."""
    layer, ocr = _tokens(layer_text), _tokens(ocr_text)
    if len(layer) >= WITNESS_MIN_TOKENS and len(layer - ocr) / len(layer) > WITNESS_UNSEEN_SHARE:
        return HIDDEN_TEXT
    if len(ocr) >= WITNESS_MIN_TOKENS and len(layer) < WITNESS_SPARSE_RATIO * len(ocr):
        return "ocr:layer-sparse"
    return None


def _geometry_supported(page: pdfium.PdfPage) -> bool:
    media = tuple(float(v) for v in page.get_mediabox())
    crop = tuple(float(v) for v in page.get_cropbox())
    return page.get_rotation() == 0 and crop == media and media[:2] == (0.0, 0.0)


def _page_chars(textpage: pdfium.PdfTextPage) -> list[str]:
    """One string per PDFium character index, from the raw code points.

    Read through FPDFText_GetUnicode rather than a pypdfium2 text helper: the helpers' defaults
    differ between pypdfium2 4.x and the pinned 5.x (4.30 redirects get_text_range() to a
    page-bounded read and ignores decoding errors), and a reader that quietly drops what it
    cannot decode is the wrong reader for deciding whether a layer can be trusted.
    """
    count = textpage.count_chars()
    if count < 0 or count > MAX_PAGE_CHARS:
        raise TextLayerCorrupt("character count is negative or over the ceiling")
    units = [pdfium_c.FPDFText_GetUnicode(textpage.raw, index) for index in range(count)]
    chars: list[str] = []
    index = 0
    while index < count:
        unit = units[index]
        if 0xD800 <= unit <= 0xDBFF and index + 1 < count and 0xDC00 <= units[index + 1] <= 0xDFFF:
            chars.extend([chr(0x10000 + ((unit - 0xD800) << 10) + (units[index + 1] - 0xDC00)), ""])
            index += 2
            continue
        if unit in (0, 0xFFFD) or 0xD800 <= unit <= 0xDFFF or unit > 0x10FFFF:
            raise TextLayerCorrupt("the layer decodes to U+FFFD, NUL or an unpaired surrogate")
        chars.append(chr(unit))
        index += 1
    return chars


def _page_text(chars: list[str]) -> str:
    text = "".join(chars)
    return _CONTROL.sub("", text.replace("\r\n", "\n").replace("\r", "\n"))


def _bounds(obj: pdfium.PdfObject) -> tuple[float, float, float, float]:
    # The C call, not the helper: pypdfium2 5 renamed PdfObject.get_pos, and the pinned version is 5.
    left, bottom, right, top = (ctypes.c_float() for _ in range(4))
    if not pdfium_c.FPDFPageObj_GetBounds(obj.raw, *(ctypes.byref(v) for v in (left, bottom, right, top))):
        raise pdfium.PdfiumError("page object bounds are unavailable")
    return left.value, bottom.value, right.value, top.value


def _image_area_share(page: pdfium.PdfPage, width: float, height: float) -> float:
    covered = 0.0
    for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE], max_depth=1):
        left, bottom, right, top = _bounds(obj)
        w = max(0.0, min(right, width) - max(left, 0.0))
        h = max(0.0, min(top, height) - max(bottom, 0.0))
        covered += w * h
    return covered / (width * height)


def _grey(page: pdfium.PdfPage, scale: float) -> Image.Image:
    bitmap = page.render(scale=scale, fill_color=(255, 255, 255, 255))
    try:
        image: Image.Image = bitmap.to_pil()
        return image.convert("L")
    finally:
        bitmap.close()


def _em_height(textpage: pdfium.PdfTextPage, index: int) -> float:
    """The glyph's em size in page points along its narrowest axis.

    The text matrix PDFium reports (Tm, cm and Tz together) maps the em square to a parallelogram;
    its smallest singular value times the font size is how tall, or how narrow, the glyph is drawn,
    whatever its rotation. The page box alone misses a 1 pt glyph turned 90 degrees and stretched.
    """
    m = pdfium_c.FS_MATRIX()
    if not pdfium_c.FPDFText_GetMatrix(textpage.raw, index, ctypes.byref(m)):
        raise TextLayerCorrupt("a glyph has no text matrix")
    size = float(pdfium_c.FPDFText_GetFontSize(textpage.raw, index))
    squares = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d
    det = abs(m.a * m.d - m.b * m.c)
    largest = math.sqrt((squares + math.sqrt(max(0.0, squares * squares - 4 * det * det))) / 2)
    height = det / largest * abs(size) if largest > 0 else 0.0
    if not math.isfinite(height):
        raise TextLayerCorrupt("a glyph has no finite text matrix")
    return height


def _unseen_glyphs(
    page: pdfium.PdfPage,
    textpage: pdfium.PdfTextPage,
    chars: list[str],
    scale: float,
    removed: list[pdfium.PdfObject],
) -> tuple[int, int, list[str]]:
    """(letters and digits, how many of them the render does not show, flags).

    Every text object removed from the page is appended to `removed`; the caller closes them.
    """
    flags: list[str] = []
    width, height = (float(v) for v in page.get_size())
    text_objects = list(page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_TEXT], max_depth=1))
    if any(pdfium_c.FPDFTextObj_GetTextRenderMode(obj.raw) in _INVISIBLE_RENDER_MODES for obj in text_objects):
        flags.append("invisible-render-mode")
    # Boxes and owning text objects are read before any object is removed from the page.
    glyphs: list[tuple[float, float, float, float, int]] = []
    heights: list[float] = []  # rendered px: the lower of the page box height and the em size
    for index, char in enumerate(chars):
        if not _ALNUM.match(char):
            continue
        left, bottom, right, top = textpage.get_charbox(index)
        if not all(math.isfinite(v) for v in (left, bottom, right, top)):
            raise TextLayerCorrupt("a glyph has no finite box")
        # FPDFText_GetTextObject is in the pinned pypdfium2 5.13 (PDFium 7999), not in 4.x.
        owner = ctypes.cast(pdfium_c.FPDFText_GetTextObject(textpage.raw, index), ctypes.c_void_p).value
        if owner is None:
            raise TextLayerCorrupt("a glyph has no text object")
        glyphs.append((left, bottom, right, top, owner))
        heights.append(min(top - bottom, _em_height(textpage, index)) * scale)
    with_text = _grey(page, scale)
    for obj in text_objects:
        page.remove_obj(obj)
        removed.append(obj)
    without_text = _grey(page, scale)
    if with_text.size != without_text.size:
        raise TextLayerCorrupt("the page rendered at two sizes")
    ink = ImageChops.difference(with_text, without_text).point(lambda v: 255 if v > INK_DELTA else 0)
    pixels_w, pixels_h = ink.size
    counts = dict.fromkeys(
        ("off-page-glyphs", "glyphs-too-small", "overlapping-glyphs", "glyphs-without-ink", "glyphs-partly-inked"), 0
    )
    on_page = [
        n for n, (left, bottom, right, top, _) in enumerate(glyphs)
        if left >= 0 and bottom >= 0 and right <= width and top <= height
    ]
    readable = [n for n in on_page if heights[n] >= MIN_GLYPH_PX]
    overlapping = _overlapping(glyphs, readable)
    for n, (left, bottom, right, top, _) in enumerate(glyphs):
        box = (
            max(0, math.floor(left * scale)),
            max(0, math.floor((height - top) * scale)),
            min(pixels_w, math.ceil(right * scale)),
            min(pixels_h, math.ceil((height - bottom) * scale)),
        )
        if not (left >= 0 and bottom >= 0 and right <= width and top <= height):
            counts["off-page-glyphs"] += 1
        elif heights[n] < MIN_GLYPH_PX:
            counts["glyphs-too-small"] += 1
        elif n in overlapping:
            counts["overlapping-glyphs"] += 1
        else:
            area = (box[2] - box[0]) * (box[3] - box[1]) if box[2] > box[0] and box[3] > box[1] else 0
            inked = ink.crop(box).histogram()[255] if area else 0
            if inked == 0:
                counts["glyphs-without-ink"] += 1
            elif inked < MIN_INK_COVERAGE * area:
                counts["glyphs-partly-inked"] += 1
    flags.extend(f"{name}:{count}" for name, count in counts.items() if count)
    return len(glyphs), sum(counts.values()), flags


def _overlapping(glyphs: list[tuple[float, float, float, float, int]], candidates: list[int]) -> set[int]:
    """The candidate glyphs whose box overlaps another glyph's box so that a reader cannot see them.

    A glyph of a different text object counts at any overlap. The ink test asks whether a glyph's
    box holds ink, not whose ink it is: a white line drawn over or under a visible one finds the
    visible line's ink in its boxes. Two text objects never put letters on the same spot in a page
    a person can read, so any such pair is unseen.

    A glyph of the same text object counts when the two share SAME_OBJECT_OVERLAP_SHARE or more of
    the smaller box. One TJ array that steps back after every glyph draws a whole sentence into one
    glyph cell: every box holds ink (its neighbours'), every box is tall enough, and no other object
    is near, yet the render shows a dot. Kerning and italics touch at the edges and stay well under.
    """
    cells: dict[tuple[int, int], list[int]] = {}
    hit: set[int] = set()
    for n in candidates:
        left, bottom, right, top, owner = glyphs[n]
        for cx in range(math.floor(left / _OVERLAP_CELL_PT), math.floor(right / _OVERLAP_CELL_PT) + 1):
            for cy in range(math.floor(bottom / _OVERLAP_CELL_PT), math.floor(top / _OVERLAP_CELL_PT) + 1):
                bucket = cells.setdefault((cx, cy), [])
                if len(bucket) >= _OVERLAP_CELL_CAP:
                    hit.add(n)
                    continue
                for m in bucket:
                    l2, b2, r2, t2, o2 = glyphs[m]
                    w, h = min(right, r2) - max(left, l2), min(top, t2) - max(bottom, b2)
                    if w <= 0 or h <= 0:
                        continue
                    smaller = min((right - left) * (top - bottom), (r2 - l2) * (t2 - b2))
                    if o2 != owner or w * h >= SAME_OBJECT_OVERLAP_SHARE * smaller:
                        hit.update((n, m))
                bucket.append(n)
    return hit


def _lines(
    textpage: pdfium.PdfTextPage, chars: list[str], width: float, height: float
) -> list[dict[str, object]]:
    """The layer's own lines with the union box of their glyphs, as bbox1000 (top-left origin).

    A line is what PDFium ends with a line break. The box is measured from the glyphs, never
    estimated: a consumer that needs a region per line (the OCR v2 region contract) gets one it
    can trace back to the page, and a line with no measurable glyph is not emitted.
    """
    lines: list[dict[str, object]] = []
    text: list[str] = []
    box: list[float] | None = None

    def flush() -> None:
        nonlocal text, box
        line = "".join(text).strip()
        if line and box is not None:
            left, bottom, right, top = box
            lines.append({
                "text": line,
                "bbox1000": [
                    max(0, min(1000, math.floor(left / width * 1000))),
                    max(0, min(1000, math.floor((height - top) / height * 1000))),
                    max(0, min(1000, math.ceil(right / width * 1000))),
                    max(0, min(1000, math.ceil((height - bottom) / height * 1000))),
                ],
            })
        text, box = [], None

    for index, char in enumerate(chars):
        if char in ("\r", "\n"):
            flush()
            continue
        text.append(char)
        if char and not char.isspace():
            left, bottom, right, top = textpage.get_charbox(index)
            box = [left, bottom, right, top] if box is None else [
                min(box[0], left), min(box[1], bottom), max(box[2], right), max(box[3], top),
            ]
    flush()
    return lines


def read_page(page: pdfium.PdfPage, scale: float) -> dict[str, object]:
    """One page's decision. Mutates the page (removes its text objects); open a throwaway copy."""
    textpage = page.get_textpage()
    removed: list[pdfium.PdfObject] = []
    try:
        chars = _page_chars(textpage)
        text = _page_text(chars)
        record: dict[str, object] = {"chars": len(chars), "flags": []}
        if not _ALNUM.search(text):
            return {**record, "path": NO_TEXT_LAYER}
        if not _geometry_supported(page):
            return {**record, "path": GEOMETRY_UNSUPPORTED}
        width, height = (float(v) for v in page.get_size())
        share = _image_area_share(page, width, height)
        letters, unseen, flags = _unseen_glyphs(page, textpage, chars, scale, removed)
        record.update(letters=letters, unseenLetters=unseen, imageAreaShare=round(share, 4), flags=flags)
        if "invisible-render-mode" in flags or unseen > UNSEEN_GLYPH_TOLERANCE:
            return {**record, "path": HIDDEN_TEXT}
        if share >= IMAGE_AREA_SHARE:
            return {**record, "path": IMAGE_CONTENT}
        return {
            **record,
            "path": TEXTLAYER,
            "text": text,
            "textSha256": _sha256(text),
            "lines": _lines(textpage, chars, width, height),
        }
    except pdfium.PdfiumError as exc:
        raise TextLayerCorrupt("PDFium could not read the text layer") from exc
    finally:
        textpage.close()
        # A removed object belongs to the caller. Closed here, after the text page and before the
        # document, its finalizer cannot run once the document is gone (pypdfium2 5 asserts on it).
        for obj in removed:
            obj.close()


def read_document(pdf_bytes: bytes, input_sha256: str, scale: float) -> dict[str, object]:
    """The text-layer receipt for one sanitized-source PDF, every page in order.

    The bytes are opened as a second, throwaway document: removing text objects to find out what
    the render shows must never touch the document the raster comes from.
    """
    document = pdfium.PdfDocument(pdf_bytes)
    pages: list[dict[str, object]] = []
    status, reason = "extracted", None
    try:
        for index in range(len(document)):
            page = document[index]
            try:
                pages.append({"pageNumber1": index + 1, **read_page(page, scale)})
            finally:
                page.close()
    except TextLayerCorrupt as exc:
        status, reason = "refused", str(exc)
        pages = [
            {"pageNumber1": index + 1, "path": LAYER_REFUSED, "flags": ["text-layer-refused"]}
            for index in range(len(document))
        ]
    finally:
        document.close()
    counts: dict[str, int] = {}
    for page_record in pages:
        counts[str(page_record["path"])] = counts.get(str(page_record["path"]), 0) + 1
    return {
        "schemaVersion": SCHEMA,
        "adr": ADR,
        "status": status,
        "reason": reason,
        "inputSha256": input_sha256,
        "extractor": {"engine": "pdfium", "pypdfium2": version("pypdfium2")},
        "rules": {
            "inkDelta": INK_DELTA,
            "imageAreaShare": IMAGE_AREA_SHARE,
            "unseenGlyphTolerance": UNSEEN_GLYPH_TOLERANCE,
            "minGlyphPx": MIN_GLYPH_PX,
            "minInkCoverage": MIN_INK_COVERAGE,
            "sameObjectOverlapShare": SAME_OBJECT_OVERLAP_SHARE,
            "renderScale": scale,
        },
        "pages": pages,
        "pathCounts": dict(sorted(counts.items())),
    }

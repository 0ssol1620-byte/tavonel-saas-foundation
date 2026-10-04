"""Where an emitted bbox1000 lands, checked against a region known from how the page was drawn.

A bbox that is positive and inside 0..1000 can still point at the wrong place. Each synthetic page
here draws its ink at known PDF user-space coordinates, and the expected box is derived from those
coordinates and the page geometry (MediaBox origin, CropBox, /Rotate) by `expected_bbox1000`, which
does not call the worker. bbox1000 is in the frame a reader sees: the CropBox, rotated clockwise by
/Rotate, origin at the top left.

Native text pages also have a second oracle: the ink PDFium actually renders. Raster pages run a
stand-in reader that reports the rendered ink as one line, so they check the render-to-bbox geometry
and not OCR quality; `test_cpu_raster_qualification.py` checks real OCR locations.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pypdfium2 as pdfium
import pytest

ROOT = Path(__file__).resolve().parents[1]
MODULE_NAME = "foundation_ocr_cpu_raster_app"


def load_cpu_app():
    # Loaded under its own name: the GPU worker's module is also called `app`.
    if MODULE_NAME in sys.modules:
        return sys.modules[MODULE_NAME]
    spec = importlib.util.spec_from_file_location(MODULE_NAME, ROOT / "app.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


cpu = load_cpu_app()

TEXT = "Known region"
FONT_SIZE = 24
# Helvetica AFM widths of "Known region" (K 667, n 556 x4, o 556 x2, w 722, space 278, r 333,
# e 556, g 556, i 222) sum to 6114/1000 em; cap height 718 and descender -207 bound it vertically.
TEXT_WIDTH = 6.114 * FONT_SIZE
TEXT_ASCENT = 0.718 * FONT_SIZE
TEXT_DESCENT = 0.207 * FONT_SIZE
MIN_IOU = 0.8

# name -> (MediaBox, CropBox or None, /Rotate, (x, y) of the ink in user space)
GEOMETRY = {
    "upright": ((0, 0, 612, 792), None, 0, (100, 600)),
    "nonzero-origin-mediabox": ((100, 150, 712, 942), None, 0, (200, 750)),
    "cropbox": ((0, 0, 612, 792), (50, 300, 562, 792), 0, (100, 600)),
    "rotate-90": ((0, 0, 612, 792), None, 90, (100, 600)),
    "rotate-180": ((0, 0, 612, 792), None, 180, (100, 600)),
    "rotate-270": ((0, 0, 612, 792), None, 270, (100, 600)),
    "origin-cropbox-rotate-90": ((-200, 100, 600, 1100), (-100, 200, 500, 1000), 90, (0, 800)),
}


def serialize_pdf(objects: list[bytes]) -> bytes:
    body = b"%PDF-1.4\n"
    offsets = []
    for number, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += b"%d 0 obj\n" % number + obj + b"\nendobj\n"
    xref = len(body)
    size = len(objects) + 1
    body += b"xref\n0 %d\n0000000000 65535 f \n" % size + b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    return body + b"trailer << /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (size, xref)


def numbers(values) -> bytes:
    return " ".join(str(value) for value in values).encode("ascii")


def page_pdf(stream: bytes, media_box, crop_box, rotate: int) -> bytes:
    geometry = b"/MediaBox [%s]" % numbers(media_box)
    if crop_box:
        geometry += b" /CropBox [%s]" % numbers(crop_box)
    if rotate:
        geometry += b" /Rotate %d" % rotate
    return serialize_pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R %s /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>" % geometry,
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ])


def expected_bbox1000(rect, media_box, crop_box, rotate: int) -> list[float]:
    """A user-space rectangle on the displayed page, from the PDF geometry rules alone."""
    left, bottom, right, top = crop_box or media_box
    corners = []
    for x in (rect[0], rect[2]):
        for y in (rect[1], rect[3]):
            u, v = (x - left) / (right - left), (top - y) / (top - bottom)
            corners.append({0: (u, v), 90: (1 - v, u), 180: (1 - u, 1 - v), 270: (v, 1 - u)}[rotate])
    xs, ys = [1000 * u for u, _ in corners], [1000 * v for _, v in corners]
    return [min(xs), min(ys), max(xs), max(ys)]


def iou(a, b) -> float:
    width = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    height = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    overlap = width * height
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - overlap
    return overlap / union if union > 0 else 0.0


def text_case(name: str):
    media_box, crop_box, rotate, (x, y) = GEOMETRY[name]
    stream = b"BT /F1 %d Tf %d %d Td (%s) Tj ET" % (FONT_SIZE, x, y, TEXT.encode("ascii"))
    rect = (x, y - TEXT_DESCENT, x + TEXT_WIDTH, y + TEXT_ASCENT)
    return page_pdf(stream, media_box, crop_box, rotate), expected_bbox1000(rect, media_box, crop_box, rotate)


# A filled rectangle: ink with no text layer, so the page takes the raster path.
INK_SIZE = (200, 40)


def ink_case(name: str):
    media_box, crop_box, rotate, (x, y) = GEOMETRY[name]
    stream = b"0 g %d %d %d %d re f" % (x, y, *INK_SIZE)
    rect = (x, y, x + INK_SIZE[0], y + INK_SIZE[1])
    return page_pdf(stream, media_box, crop_box, rotate), expected_bbox1000(rect, media_box, crop_box, rotate)


def rendered_ink_bbox1000(payload: bytes) -> list[float]:
    document = pdfium.PdfDocument(payload)
    try:
        page = document[0]
        try:
            image = cpu.render_page(page).convert("L")
        finally:
            page.close()
    finally:
        document.close()
    left, top, right, bottom = image.point(lambda value: 255 if value < 128 else 0).getbbox()
    return [1000 * left / image.width, 1000 * top / image.height, 1000 * right / image.width, 1000 * bottom / image.height]


@pytest.fixture
def ink_reader(monkeypatch: pytest.MonkeyPatch) -> None:
    """Passed-self-test engines whose general pass reports the rendered ink as one line."""

    def ink_lines(engine, image, **_options):
        if engine != "general":
            return []
        left, top, right, bottom = image.convert("L").point(lambda value: 255 if value < 128 else 0).getbbox()
        polygon = [[left, top], [right, top], [right, bottom], [left, bottom]]
        return [{"polygon": [[float(x), float(y)] for x, y in polygon], "text": "INK", "confidence": 0.99}]

    monkeypatch.setattr(cpu, "_self_test", {"state": "passed", "detail": None})
    monkeypatch.setattr(cpu, "_general_rapidocr", "general")
    monkeypatch.setattr(cpu, "_korean_rapidocr", "korean")
    monkeypatch.setattr(cpu, "rapidocr_lines", ink_lines)


@pytest.mark.parametrize("name", GEOMETRY)
def test_expected_region_matches_where_pdfium_renders_the_text(name: str) -> None:
    # The oracle itself is checked against real rendered pixels before it judges the worker.
    payload, expected = text_case(name)
    assert iou(rendered_ink_bbox1000(payload), expected) >= MIN_IOU


@pytest.mark.parametrize("name", GEOMETRY)
def test_native_text_bbox_lands_on_the_known_region(name: str) -> None:
    payload, expected = text_case(name)

    text, page_count, regions = cpu.extract_text(payload)

    assert (text, page_count) == (TEXT, 1)
    [region] = regions
    assert region["regionId"] == "native-p0001"
    assert iou(region["bbox1000"], expected) >= MIN_IOU, (region["bbox1000"], expected)
    assert iou(region["bbox1000"], rendered_ink_bbox1000(payload)) >= MIN_IOU


@pytest.mark.parametrize("name", GEOMETRY)
def test_raster_bbox_lands_on_the_known_region(name: str, ink_reader: None) -> None:
    payload, expected = ink_case(name)

    _, page_count, regions = cpu.extract_text(payload)

    assert page_count == 1
    [region] = regions
    assert region["regionId"] == "ocr-p0001-l00001"
    assert iou(region["bbox1000"], expected) >= 0.9, (region["bbox1000"], expected)


@pytest.mark.parametrize("name", [name for name in GEOMETRY if name != "upright"])
def test_a_box_left_in_pdf_user_space_fails_the_location_check(name: str) -> None:
    # The check discriminates: user-space rectangles normalized by the page size, which ignore the
    # MediaBox origin, CropBox and /Rotate, do not pass it on any non-trivial geometry.
    payload, expected = text_case(name)
    document = pdfium.PdfDocument(payload)
    try:
        page = document[0]
        textpage = page.get_textpage()
        rectangles = [textpage.get_rect(index) for index in range(textpage.count_rects())]
        width, height = page.get_size()
        textpage.close()
        page.close()
    finally:
        document.close()
    left = min(rectangle[0] for rectangle in rectangles)
    bottom = min(rectangle[1] for rectangle in rectangles)
    right = max(rectangle[2] for rectangle in rectangles)
    top = max(rectangle[3] for rectangle in rectangles)
    user_space = cpu.normalized_bbox(left, height - top, right, height - bottom, width, height)

    assert iou(user_space, expected) < MIN_IOU


def test_text_outside_the_cropbox_does_not_stretch_the_native_box() -> None:
    # Independent-review repro: an 8 pt slug below the CropBox is not in the bounded text, so its
    # rectangle must not pull the box to the page edge ([98, 355, 381, 1000] before the fix).
    media_box, crop_box, rotate, (x, y) = GEOMETRY["cropbox"]
    stream = b"BT /F1 %d Tf %d %d Td (%s) Tj ET BT /F1 8 Tf 100 100 Td (slug) Tj ET" % (
        FONT_SIZE, x, y, TEXT.encode("ascii")
    )
    payload = page_pdf(stream, media_box, crop_box, rotate)
    expected = expected_bbox1000((x, y - TEXT_DESCENT, x + TEXT_WIDTH, y + TEXT_ASCENT), media_box, crop_box, rotate)

    text, _, [region] = cpu.extract_text(payload)

    assert text == TEXT
    assert region["regionId"] == "native-p0001"
    assert iou(region["bbox1000"], expected) >= MIN_IOU, (region["bbox1000"], expected)


def test_text_straddling_the_cropbox_is_boxed_by_its_visible_part() -> None:
    media_box, crop_box = (0, 0, 612, 792), (50, 300, 562, 792)
    # The line starts left of the CropBox; only its visible part is the region's location.
    payload = page_pdf(b"BT /F1 %d Tf 0 600 Td (%s) Tj ET" % (FONT_SIZE, TEXT.encode("ascii")), media_box, crop_box, 0)

    _, _, regions = cpu.extract_text(payload)

    [region] = [region for region in regions if region["regionId"] == "native-p0001"]
    visible = expected_bbox1000((50, 600 - TEXT_DESCENT, TEXT_WIDTH, 600 + TEXT_ASCENT), media_box, crop_box, 0)
    assert iou(region["bbox1000"], visible) >= MIN_IOU, (region["bbox1000"], visible)


@pytest.mark.parametrize(
    "bounds",
    [(-1, 10, 500, 600), (10, -1, 500, 600), (10, 10, cpu.DEVICE_UNITS + 1, 600), (10, 10, 500, cpu.DEVICE_UNITS + 1)],
)
def test_native_box_off_the_displayed_page_is_dropped_not_clamped(monkeypatch: pytest.MonkeyPatch, bounds) -> None:
    payload, _ = text_case("upright")
    monkeypatch.setattr(cpu, "displayed_bounds", lambda *_args: bounds)
    document = pdfium.PdfDocument(payload)
    try:
        page = document[0]
        textpage = page.get_textpage()
        try:
            assert cpu.native_page_region(page, textpage, TEXT, 0, 0) is None
        finally:
            textpage.close()
            page.close()
    finally:
        document.close()


def test_displayed_bounds_refuses_a_failed_pdfium_mapping(monkeypatch: pytest.MonkeyPatch) -> None:
    # No silent fallback to user space: a mapping PDFium refuses yields no native region.
    payload, _ = text_case("upright")
    monkeypatch.setattr(cpu.pdfium_c, "FPDF_PageToDevice", lambda *_args: 0)
    document = pdfium.PdfDocument(payload)
    try:
        page = document[0]
        textpage = page.get_textpage()
        try:
            assert cpu.native_page_region(page, textpage, TEXT, 0, 0) is None
        finally:
            textpage.close()
            page.close()
    finally:
        document.close()

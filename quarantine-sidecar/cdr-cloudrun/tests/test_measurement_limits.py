"""D1 stage-1 preparation: configurable limits for a measurement revision, page-range raster.

The production limits are the literals in app.py and stay the defaults. These tests prove that a
measurement revision's limits are enforced fail-closed at exactly the configured boundary, that a
malformed or out-of-range value refuses the boot instead of being read as "unlimited" or "default",
and that page-range rasterisation renders a document the whole-document pixel ceiling refuses
without relaxing any per-range ceiling.
"""

from __future__ import annotations

import io
import os
import re
import subprocess
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pypdfium2 as pdfium
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("TAVONEL_CDR_HMAC", "fixture-cdr-hmac-secret-that-is-long-enough-123")

from clamd_stub import FakeClamd  # noqa: E402

for _name, _value in FakeClamd("clean").start().env().items():
    os.environ.setdefault(_name, _value)

import app as app_module  # noqa: E402
from app import (  # noqa: E402
    MAX_INPUT_BYTES,
    MAX_OUTPUT_BYTES,
    MAX_PAGES,
    MAX_RENDER_PIXELS_TOTAL,
    PRODUCTION_LIMITS,
    Limits,
    copy_and_digest,
    rasterize_to_pdf,
    read_limits,
)

LETTER = (612.0, 792.0)
APP_DIR = Path(__file__).resolve().parents[1]


def blank_pdf(pages: int, size: tuple[float, float] = LETTER) -> bytes:
    document = pdfium.PdfDocument.new()
    try:
        for _ in range(pages):
            document.new_page(*size).close()
        stream = BytesIO()
        document.save(stream)
        return stream.getvalue()
    finally:
        document.close()


def raster(pdf: bytes, limits: Limits) -> tuple[int, bytes]:
    with tempfile.TemporaryDirectory() as work, patch.object(app_module, "LIMITS", limits):
        source, target = Path(work) / "source.pdf", Path(work) / "sanitized.pdf"
        source.write_bytes(pdf)
        size = rasterize_to_pdf(source, target)
        leftovers = sorted(path.name for path in Path(work).iterdir())
        if leftovers != ["sanitized.pdf", "source.pdf"]:
            raise AssertionError(f"range files outlived the raster: {leftovers}")
        return size, target.read_bytes()


class Upload:
    def __init__(self, body: bytes) -> None:
        self.file = io.BytesIO(body)


class ReadLimitsTest(unittest.TestCase):
    def test_unset_is_the_production_literals(self) -> None:
        self.assertEqual(read_limits({}), PRODUCTION_LIMITS)
        self.assertEqual(PRODUCTION_LIMITS, Limits(5 * 1024 * 1024, 80, 18 * 1024 * 1024, 0))
        self.assertTrue(read_limits({"TAVONEL_CDR_MAX_PAGES": " "}).is_production)
        self.assertEqual(app_module.LIMITS, PRODUCTION_LIMITS, "the suite runs against the production limits")

    def test_stage_one_values_are_accepted(self) -> None:
        limits = read_limits({
            "TAVONEL_CDR_MAX_INPUT_BYTES": str(25 * 1024 * 1024),
            "TAVONEL_CDR_MAX_PAGES": "200",
            "TAVONEL_CDR_MAX_OUTPUT_BYTES": str(96 * 1024 * 1024),
            "TAVONEL_CDR_RASTER_RANGE_PAGES": "8",
        })
        self.assertEqual(limits, Limits(25 * 1024 * 1024, 200, 96 * 1024 * 1024, 8))
        self.assertFalse(limits.is_production)

    def test_malformed_or_out_of_range_values_are_refused_not_defaulted(self) -> None:
        cases = {
            "TAVONEL_CDR_MAX_PAGES": ["0", "-1", "80.5", "1e3", "eighty", "501", "080"],
            "TAVONEL_CDR_MAX_INPUT_BYTES": [str(50 * 1024 * 1024 + 1), "5MiB"],
            "TAVONEL_CDR_MAX_OUTPUT_BYTES": [str(128 * 1024 * 1024 + 1)],
            "TAVONEL_CDR_RASTER_RANGE_PAGES": ["0", "65", "all"],
        }
        for name, values in cases.items():
            for value in values:
                with self.subTest(name=name, value=value), self.assertRaises(RuntimeError):
                    read_limits({name: value})

    def test_a_revision_with_a_bad_limit_does_not_boot(self) -> None:
        env = {**os.environ, "TAVONEL_CDR_MAX_PAGES": "501"}
        completed = subprocess.run(
            [sys.executable, "-c", "import app"], cwd=APP_DIR, env=env, capture_output=True, text=True, timeout=120, check=False,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("TAVONEL_CDR_MAX_PAGES must be a whole number from 1 to 500", completed.stderr)


class ConfiguredBoundaryTest(unittest.TestCase):
    def test_page_ceiling_holds_at_the_configured_boundary(self) -> None:
        limits = Limits(MAX_INPUT_BYTES, 3, MAX_OUTPUT_BYTES, 0)
        self.assertGreater(raster(blank_pdf(3), limits)[0], 0)
        with self.assertRaises(HTTPException) as refused:
            raster(blank_pdf(4), limits)
        self.assertEqual((refused.exception.status_code, refused.exception.detail),
                         (422, "CDR source page count is not qualified"))

    def test_a_raised_page_ceiling_admits_what_production_refuses(self) -> None:
        pdf = blank_pdf(MAX_PAGES + 1, (300.0, 300.0))
        with self.assertRaises(HTTPException):
            raster(pdf, PRODUCTION_LIMITS)
        self.assertGreater(raster(pdf, Limits(MAX_INPUT_BYTES, MAX_PAGES + 1, MAX_OUTPUT_BYTES, 0))[0], 0)

    def test_input_ceiling_holds_at_the_configured_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as work, patch.object(app_module, "LIMITS", Limits(100, MAX_PAGES, MAX_OUTPUT_BYTES, 0)):
            target = Path(work) / "source.bin"
            self.assertEqual(copy_and_digest(Upload(b"x" * 100), target)[1], 100)  # type: ignore[arg-type]
            with self.assertRaises(HTTPException) as refused:
                copy_and_digest(Upload(b"x" * 101), target)  # type: ignore[arg-type]
            self.assertEqual(refused.exception.status_code, 413)

    def test_output_ceiling_holds_with_and_without_ranges(self) -> None:
        pdf = blank_pdf(4)
        size = raster(pdf, PRODUCTION_LIMITS)[0]
        for range_pages in (0, 1):
            with self.subTest(range_pages=range_pages), self.assertRaises(HTTPException) as refused:
                raster(pdf, Limits(MAX_INPUT_BYTES, MAX_PAGES, size // 2, range_pages))
            self.assertEqual(refused.exception.status_code, 422)


class PageRangeRasterTest(unittest.TestCase):
    def test_one_range_is_byte_identical_to_the_production_path(self) -> None:
        # PDFium writes a fresh random trailer /ID on every save, production path included, so the
        # comparison is of everything else.
        without_id = lambda body: re.sub(rb"/ID\[<[0-9A-F]+><[0-9A-F]+>\]", b"/ID[]", body)  # noqa: E731
        pdf = blank_pdf(5)
        production = without_id(raster(pdf, PRODUCTION_LIMITS)[1])
        self.assertIn(b"/ID[]", production)
        self.assertEqual(without_id(raster(pdf, Limits(MAX_INPUT_BYTES, MAX_PAGES, MAX_OUTPUT_BYTES, 64))[1]), production)

    def test_ranges_render_every_page_once_in_order_at_one_scale(self) -> None:
        sizes = [LETTER, (595.276, 841.89), (300.0, 500.0)] * 4 + [LETTER]
        document = pdfium.PdfDocument.new()
        for size in sizes:
            document.new_page(*size).close()
        stream = BytesIO()
        document.save(stream)
        document.close()
        _, joined = raster(stream.getvalue(), Limits(MAX_INPUT_BYTES, MAX_PAGES, MAX_OUTPUT_BYTES, 3))
        output = pdfium.PdfDocument(joined)
        try:
            self.assertEqual(len(output), len(sizes))
            for index, size in enumerate(sizes):
                page = output[index]
                try:
                    self.assertEqual(tuple(round(value, 2) for value in page.get_size()), tuple(round(v, 2) for v in size))
                    kinds = [obj.type for obj in page.get_objects()]
                    self.assertEqual(kinds, [pdfium.raw.FPDF_PAGEOBJ_IMAGE], "every page is one image and nothing else")
                finally:
                    page.close()
        finally:
            output.close()

    def test_ranges_lift_the_document_pixel_ceiling_without_relaxing_the_range_ceiling(self) -> None:
        pages = 200
        # At the minimum scale a Letter page is 612 x 792 = 484,704 pixels, so 200 of them exceed the
        # whole-document ceiling: production would have to render below MIN_RENDER_SCALE and refuses.
        self.assertGreater(pages * 612 * 792, MAX_RENDER_PIXELS_TOTAL)
        pdf = blank_pdf(pages)
        whole = Limits(MAX_INPUT_BYTES, pages, 128 * 1024 * 1024, 0)
        with self.assertRaises(HTTPException) as refused:
            raster(pdf, whole)
        self.assertEqual(refused.exception.detail, "CDR source rendering budget is not qualified")

        _, joined = raster(pdf, Limits(MAX_INPUT_BYTES, pages, 128 * 1024 * 1024, 8))
        output = pdfium.PdfDocument(joined)
        try:
            self.assertEqual(len(output), pages)
        finally:
            output.close()
    def test_the_pixel_ceiling_still_binds_each_range(self) -> None:
        # A 2,000,000-pixel ceiling: two Letter pages fit at scale >= 1, five do not.
        pdf = blank_pdf(10)
        limits = lambda range_pages: Limits(MAX_INPUT_BYTES, MAX_PAGES, MAX_OUTPUT_BYTES, range_pages)  # noqa: E731
        with patch.object(app_module, "MAX_RENDER_PIXELS_TOTAL", 2_000_000):
            for range_pages in (0, 5):
                with self.subTest(range_pages=range_pages), self.assertRaises(HTTPException) as refused:
                    raster(pdf, limits(range_pages))
                self.assertEqual(refused.exception.detail, "CDR source rendering budget is not qualified")
            self.assertGreater(raster(pdf, limits(2))[0], 0)


if __name__ == "__main__":
    unittest.main()

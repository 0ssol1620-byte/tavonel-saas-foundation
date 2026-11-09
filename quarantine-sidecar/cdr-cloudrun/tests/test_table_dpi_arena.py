"""D3 table product-DPI harness and the D2 fixture shadow (PROGRAM-2026-11-04 §4.D), with no OCR engine:
a fake reader stands in, so these pin the harness's arithmetic, refusals and receipt shape only."""

from __future__ import annotations

import io
import sys
import unittest
from collections import Counter
from pathlib import Path
from tempfile import TemporaryDirectory

import pypdfium2 as pdfium

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import table_dpi_arena as arena  # noqa: E402

APP_DIR = Path(__file__).resolve().parents[1]


def blank_pdf(pages: int) -> bytes:
    document = pdfium.PdfDocument.new()
    try:
        for _ in range(pages):
            document.new_page(612.0, 792.0).close()
        stream = io.BytesIO()
        document.save(stream)
        return stream.getvalue()
    finally:
        document.close()


class NumbersTest(unittest.TestCase):
    def test_numeric_tokens_take_figures_and_skip_page_numbers(self) -> None:
        text = "Net sales $ 391,035 (210,352) 12.5% 2025 page 7 of 30 ３９１,０３５"
        self.assertEqual(arena.numeric_tokens(text), Counter({"391,035": 2, "210,352": 1, "12.5": 1, "2025": 1}))

    def test_numeric_recall_is_a_multiset_with_its_denominator(self) -> None:
        gold = arena.numeric_tokens("1,000 1,000 2,000")
        self.assertEqual(arena.numeric_recall(gold, arena.numeric_tokens("1,000 2,000 3,000")), (2, 3))
        self.assertEqual(arena.numeric_recall(Counter(), Counter({"1": 1})), (0, 0))

    def test_char_agreement_matches_the_worker_shadow(self) -> None:
        # The same vectors text-layer-shadow.test.ts pins for charAgreement.
        self.assertEqual(arena.char_agreement("Net Sales 1,234", "net  sales\n1,234"), (13, 13, 13, 1.0))
        self.assertEqual(arena.char_agreement("ＡＢＣ", "abc")[3], 1.0)
        self.assertEqual(arena.char_agreement("abc", "xyz")[3], 0.0)
        self.assertEqual(arena.char_agreement("abcd", "ab")[3], 4 / 6)
        self.assertIsNone(arena.char_agreement("", " ")[3])

    def test_table_pages_need_enough_numbers_and_are_capped(self) -> None:
        dense = " ".join(["1,000"] * arena.TABLE_PAGE_MIN_NUMBERS)
        sparse = " ".join(["1,000"] * (arena.TABLE_PAGE_MIN_NUMBERS - 1))
        self.assertEqual(arena.table_pages([sparse, dense, "prose", dense, dense, dense, dense]), [1, 3, 4, 5])


class ArmTest(unittest.TestCase):
    def test_the_gpu_arm_is_refused_before_anything_starts(self) -> None:
        with self.assertRaises(arena.GpuRequired) as stopped:
            arena.refuse_gpu_arm("paddleocr-vl")
        self.assertEqual(stopped.exception.code, "GPU_REQUIRED_ORCHESTRATOR_GO")
        with self.assertRaises(ValueError):
            arena.refuse_gpu_arm("some-api-model")
        arena.refuse_gpu_arm("rapidocr-line")

    def test_the_cli_stops_on_the_gpu_arm_without_loading_a_reader(self) -> None:
        with TemporaryDirectory() as work:
            out = Path(work) / "receipt.json"
            self.assertEqual(arena.main(["table", "x.pdf", "--out", str(out), "--arm", "paddleocr-vl"]), 3)
            self.assertFalse(out.exists())


class ReceiptTest(unittest.TestCase):
    def test_a_table_run_records_every_dpi_with_bytes_lines_and_denominators(self) -> None:
        with TemporaryDirectory() as work:
            path = Path(work) / "blank.pdf"
            path.write_bytes(blank_pdf(2))
            # A blank page has no numbers, so nothing is table-bearing: the run says so, not 0/0 = 0.
            receipt = arena.run_table([path], lambda image: ["1,000"], {"arm": "fake"}, "product")
        self.assertEqual(receipt["dpis"], [108, 150, 200])
        self.assertEqual(receipt["rows"], [])
        self.assertEqual(receipt["byDpi"]["108"]["numericRecall"], None)
        self.assertEqual(receipt["notRun"], [{"arm": "paddleocr-vl", "code": "GPU_REQUIRED_ORCHESTRATOR_GO"}])
        self.assertTrue(receipt["fixtures"][0]["sha256"].startswith("sha256:"))

    def test_the_cdr_page_grows_with_dpi_and_the_reader_scale_is_recorded(self) -> None:
        pdf = pdfium.PdfDocument(blank_pdf(1))
        try:
            sizes = [len(arena.cdr_page_pdf(pdf, 0, dpi)) for dpi in (108, 200)]
        finally:
            pdf.close()
        self.assertLess(sizes[0], sizes[1])
        image = arena.reader_image(arena.cdr_page_pdf(pdfium.PdfDocument(blank_pdf(1)), 0, 108), arena.READER_RENDER_SCALE)
        self.assertEqual(image.size, (1224, 1584), "the product reader reads every page at 144 DPI")

    def test_the_harness_is_not_in_the_image(self) -> None:
        self.assertNotIn("table_dpi_arena", (APP_DIR / "Dockerfile").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

"""measure_limits.py, driven against the real CDR app as a measurement revision would run it."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from io import BytesIO
from itertools import count
from pathlib import Path
from unittest.mock import patch

import pypdfium2 as pdfium
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
SECRET = "fixture-cdr-hmac-secret-that-is-long-enough-123"
os.environ.setdefault("TAVONEL_CDR_HMAC", SECRET)

from clamd_stub import FakeClamd  # noqa: E402

for _name, _value in FakeClamd("clean").start().env().items():
    os.environ.setdefault(_name, _value)

import app as app_module  # noqa: E402
import measure_limits  # noqa: E402
from app import (  # noqa: E402
    MAX_INPUT_BYTES,
    MAX_OUTPUT_BYTES,
    Limits,
    cdr_request_signature,
)


def blank_pdf(pages: int) -> bytes:
    document = pdfium.PdfDocument.new()
    for _ in range(pages):
        document.new_page(300.0, 300.0).close()
    stream = BytesIO()
    document.save(stream)
    document.close()
    return stream.getvalue()


class MeasureLimitsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app_module.app, raise_server_exceptions=False)
        self.ocr_calls: list[dict[str, str]] = []
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)

    def post(self, url: str, headers: dict[str, str], body: bytes) -> tuple[int, dict[str, str], bytes]:
        if url == "ocr":
            self.ocr_calls.append(headers)
            return 200, {}, b"{}"
        response = self.client.post("/v1/disarm", headers=headers, content=body)
        return response.status_code, {k.lower(): v for k, v in response.headers.items()}, response.content

    def document(self, name: str, pages: int) -> Path:
        path = Path(self.work.name) / name
        path.write_bytes(blank_pdf(pages))
        return path

    def measure(self, path: Path, **extra: object) -> dict:
        ticks = count()
        return measure_limits.measure_document(path, cdr_url="cdr", cdr_secret=SECRET, post=self.post,
                                               range_size=8, clock=lambda: float(next(ticks)), **extra)

    def test_the_signature_is_the_cdr_signature(self) -> None:
        self.assertEqual(measure_limits.signature(SECRET, "t", "r" * 16, "sha256:" + "a" * 64),
                         cdr_request_signature(SECRET, "t", "r" * 16, "sha256:" + "a" * 64))

    def test_a_measurement_revision_reports_pages_bytes_and_the_ocr_plan(self) -> None:
        measurement = Limits(MAX_INPUT_BYTES, 120, MAX_OUTPUT_BYTES, 8)
        with patch.object(app_module, "LIMITS", measurement):
            record = self.measure(self.document("long.pdf", 100), ocr_url="ocr", ocr_secret=SECRET)
        self.assertEqual(record["cdr"]["httpStatus"], 200)
        self.assertEqual(record["pages"], 100)
        self.assertEqual(record["ocrPlan"], {"rangeSize": 8, "ranges": 13})
        self.assertEqual([call["x-tavonel-ocr-page-range"] for call in self.ocr_calls][-1], "96-100")
        self.assertTrue(record["ocr"]["complete"])
        self.assertEqual(record["cdr"]["outputSha256"][:7], "sha256:")

    def test_production_limits_refuse_the_same_document_and_the_page_count_stays_unknown(self) -> None:
        record = self.measure(self.document("long.pdf", 100))
        self.assertEqual((record["cdr"]["httpStatus"], record["cdr"]["detail"]), (422, "CDR source page count is not qualified"))
        self.assertIsNone(record["pages"])
        self.assertNotIn("ocr", record)

    def test_ocr_is_never_called_without_its_url(self) -> None:
        self.measure(self.document("short.pdf", 3))
        self.assertEqual(self.ocr_calls, [])

    def test_the_summary_admits_only_what_fits_and_never_an_unknown(self) -> None:
        records = [
            {"sourceBytes": 4 * measure_limits.MIB, "pages": 60, "cdr": {"seconds": 2.0}},
            {"sourceBytes": 20 * measure_limits.MIB, "pages": 150, "cdr": {"seconds": 9.0}, "ocr": {"seconds": 40.0}},
            {"sourceBytes": 30 * measure_limits.MIB, "pages": 150, "cdr": {"seconds": 12.0}},
            {"sourceBytes": 1 * measure_limits.MIB, "pages": None, "cdr": {"seconds": 1.0}},
        ]
        rows = {(row["maxSourceBytes"], row["maxPages"]): row for row in measure_limits.summarize(records)["candidates"]}
        stage0, stage1, stage2 = rows[(5 * measure_limits.MIB, 80)], rows[(25 * measure_limits.MIB, 200)], rows[(50 * measure_limits.MIB, 500)]
        self.assertEqual((stage0["documentsAdmitted"], stage0["pagesAdmitted"]), (1, 60))
        self.assertEqual((stage1["documentsAdmitted"], stage1["pagesAdmitted"], stage1["ocrSecondsP95"]), (2, 210, 40.0))
        self.assertEqual((stage2["documentsAdmitted"], stage2["documentsMeasured"], stage2["pagesCounted"]), (3, 4, 360))
        self.assertEqual(stage1["cdrSecondsP95"], 9.0)

    def test_paid_ocr_needs_an_explicit_allowance(self) -> None:
        with patch.dict(os.environ, {"TAVONEL_CDR_HMAC": SECRET, "TAVONEL_OCR_HMAC": SECRET}), \
                self.assertRaises(SystemExit):
            measure_limits.main(["--cdr-url", "x", "--ocr-url", "y", "--out", str(Path(self.work.name) / "r.json"), "a.pdf"])


if __name__ == "__main__":
    unittest.main()

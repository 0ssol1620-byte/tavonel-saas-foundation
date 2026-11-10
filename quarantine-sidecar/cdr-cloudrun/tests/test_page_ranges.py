"""Segmented sources: one signed request renders one page range (docs/adr/0006-segmented-large-sources.md)."""

from __future__ import annotations

import hashlib
import os
import secrets
import sys
import unittest
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pypdfium2 as pdfium
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("TAVONEL_CDR_HMAC", "fixture-cdr-hmac-secret-that-is-long-enough-123")

from clamd_stub import FakeClamd  # noqa: E402

for _name, _value in FakeClamd("clean").start().env().items():
    os.environ.setdefault(_name, _value)

from app import MAX_PAGES, SEGMENTED_MAX_DOCUMENT_PAGES, app, cdr_request_signature  # noqa: E402

SECRET = "fixture-cdr-hmac-secret-that-is-long-enough-123"
LETTER = (612.0, 792.0)


def blank_pdf(pages: int) -> bytes:
    document = pdfium.PdfDocument.new()
    try:
        for index in range(pages):
            # Each page a slightly different width, so a page out of place is visible.
            document.new_page(LETTER[0] + index % 7, LETTER[1]).close()
        stream = BytesIO()
        document.save(stream)
        return stream.getvalue()
    finally:
        document.close()


def post(source: bytes, request_id: str, *, sign_as: str | None = None):
    digest = "sha256:" + hashlib.sha256(source).hexdigest()
    timestamp = datetime.now(UTC).isoformat()
    headers = {
        "x-tavonel-input-sha256": digest,
        "x-tavonel-cdr-timestamp": timestamp,
        "x-tavonel-cdr-request-id": request_id,
        "x-tavonel-cdr-signature": cdr_request_signature(SECRET, timestamp, sign_as or request_id, digest),
    }
    return TestClient(app, raise_server_exceptions=False).post(
        "/v1/disarm", headers=headers, files={"source": ("manual.pdf", source, "application/pdf")},
    )


def ranged(start: int, end: int) -> str:
    return f"{secrets.token_hex(12)}_p{start}_{end}"


def page_widths(pdf: bytes) -> list[float]:
    document = pdfium.PdfDocument(pdf)
    try:
        widths = []
        for index in range(len(document)):
            page = document[index]
            try:
                widths.append(round(page.get_size()[0], 2))
            finally:
                page.close()
        return widths
    finally:
        document.close()


class PageRangeDisarmTest(unittest.TestCase):
    source = blank_pdf(200)

    def test_a_ranged_request_renders_only_its_range_and_names_the_document(self) -> None:
        response = post(self.source, ranged(80, 160))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["x-tavonel-cdr-source-pages"], "200")
        self.assertEqual(response.headers["x-tavonel-cdr-page-range"], "80-160")
        self.assertEqual(response.headers["x-tavonel-cdr-output-sha256"], "sha256:" + hashlib.sha256(response.content).hexdigest())
        self.assertEqual(page_widths(response.content), [round(LETTER[0] + index % 7, 2) for index in range(80, 160)])

    def test_the_last_range_stops_at_the_last_page(self) -> None:
        response = post(self.source, ranged(160, 240))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["x-tavonel-cdr-page-range"], "160-200")
        self.assertEqual(len(page_widths(response.content)), 40)

    def test_a_range_past_the_end_is_refused_not_answered_empty(self) -> None:
        response = post(self.source, ranged(200, 280))
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"], "CDR page range starts past the end of the document")
        self.assertNotIn("x-tavonel-cdr-output-sha256", response.headers)

    def test_a_range_longer_than_one_request_may_render_is_refused(self) -> None:
        for start, end in ((0, MAX_PAGES + 1), (10, 10), (20, 10), (480, 560)):
            with self.subTest(start=start, end=end):
                response = post(self.source, ranged(start, end))
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(response.json()["detail"], "CDR page range is not qualified")

    def test_a_document_over_the_segmented_ceiling_is_refused_whole(self) -> None:
        response = post(blank_pdf(SEGMENTED_MAX_DOCUMENT_PAGES + 1), ranged(0, 80))
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"], "CDR source page count is not qualified")
        # The refusal says this revision answers ranges, so the worker treats it as a verdict.
        self.assertEqual(response.headers["x-tavonel-cdr-ranges"], "1")

    def test_the_last_range_of_a_document_at_the_segmented_ceiling_is_answered(self) -> None:
        response = post(blank_pdf(SEGMENTED_MAX_DOCUMENT_PAGES), ranged(420, 500))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["x-tavonel-cdr-source-pages"], str(SEGMENTED_MAX_DOCUMENT_PAGES))
        self.assertEqual(response.headers["x-tavonel-cdr-page-range"], "420-500")
        self.assertEqual(page_widths(response.content), [round(LETTER[0] + index % 7, 2) for index in range(420, 500)])

    def test_an_unranged_request_keeps_the_production_page_ceiling(self) -> None:
        response = post(blank_pdf(MAX_PAGES + 1), secrets.token_hex(12))
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"], "CDR source page count is not qualified")
        whole = post(blank_pdf(3), secrets.token_hex(12))
        self.assertEqual(whole.status_code, 200, whole.text)
        self.assertNotIn("x-tavonel-cdr-page-range", whole.headers)
        self.assertNotIn("x-tavonel-cdr-source-pages", whole.headers)

    def test_a_page_that_cannot_be_rendered_refuses_the_whole_range(self) -> None:
        original = pdfium.PdfPage.render
        calls = {"count": 0}

        def render(page, *args, **kwargs):
            calls["count"] += 1
            if calls["count"] == 30:
                raise pdfium.PdfiumError("corrupt page")
            return original(page, *args, **kwargs)

        with patch.object(pdfium.PdfPage, "render", render):
            response = post(self.source, ranged(80, 160))
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["detail"], "CDR source could not be rasterized safely")
        self.assertNotIn("x-tavonel-cdr-output-sha256", response.headers)

    def test_the_range_is_covered_by_the_signature(self) -> None:
        signed = ranged(0, 80)
        moved = signed.rsplit("_p", 1)[0] + "_p80_160"
        response = post(self.source, moved, sign_as=signed)
        self.assertEqual(response.status_code, 401, response.text)


if __name__ == "__main__":
    unittest.main()

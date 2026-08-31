from __future__ import annotations

import hashlib
import os
import secrets
import sys
import unittest
import zipfile
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import fitz
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("TAVONEL_CDR_HMAC", "fixture-cdr-hmac-secret-that-is-long-enough-123")

from app import (  # noqa: E402
    MAX_RENDER_PIXELS_PER_PAGE,
    MAX_RENDER_PIXELS_TOTAL,
    MIN_RENDER_SCALE,
    RENDER_SCALE,
    app,
    cdr_request_signature,
    qualified_render_scale,
)


class PdfRasterCdrTest(unittest.TestCase):
    @staticmethod
    def pdf_fixture() -> bytes:
        document = fitz.open()
        try:
            page = document.new_page()
            page.insert_text((72, 72), "TAVONEL harmless synthetic CDR fixture")
            return document.tobytes(garbage=4, deflate=True)
        finally:
            document.close()

    @staticmethod
    def headers(
        digest: str,
        secret: str = "fixture-cdr-hmac-secret-that-is-long-enough-123",
        request_id: str | None = None,
    ) -> dict[str, str]:
        timestamp = datetime.now(UTC).isoformat()
        request_id = request_id or secrets.token_urlsafe(18)
        return {
            "x-tavonel-input-sha256": digest,
            "x-tavonel-cdr-timestamp": timestamp,
            "x-tavonel-cdr-request-id": request_id,
            "x-tavonel-cdr-signature": cdr_request_signature(secret, timestamp, request_id, digest),
        }

    def test_health_requires_hmac_secret(self) -> None:
        client = TestClient(app, raise_server_exceptions=False)
        with patch.dict(os.environ, {"TAVONEL_CDR_HMAC": ""}, clear=False):
            response = client.get("/health")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["retry-after"], "60")

    def test_disarm_requires_runtime_hmac_before_rendering(self) -> None:
        source = self.pdf_fixture()
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        with patch.dict(os.environ, {"TAVONEL_CDR_HMAC": ""}, clear=False):
            response = TestClient(app).post(
                "/v1/disarm",
                headers=self.headers(digest),
                files={"source": ("fixture.pdf", source, "application/pdf")},
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_pdf_is_rasterized_with_digest_bound_response(self) -> None:
        source = self.pdf_fixture()
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        client = TestClient(app)
        response = client.post(
            "/v1/disarm",
            headers=self.headers(digest),
            files={"source": ("fixture.pdf", source, "application/pdf")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["content-type"], "application/pdf")
        self.assertEqual(response.headers["x-tavonel-cdr-status"], "clean")
        self.assertEqual(response.headers["x-tavonel-input-sha256"], digest)
        self.assertEqual(response.headers["x-tavonel-cdr-output-mime"], "application/pdf")
        self.assertEqual(response.headers["x-tavonel-cdr-output-sha256"], "sha256:" + hashlib.sha256(response.content).hexdigest())
        sanitized = fitz.open(stream=response.content, filetype="pdf")
        try:
            self.assertEqual(sanitized.page_count, 1)
            self.assertEqual(sanitized[0].get_text().strip(), "")
            self.assertGreaterEqual(len(sanitized[0].get_images(full=True)), 1)
        finally:
            sanitized.close()

    def test_large_qualified_document_adapts_scale_without_relaxing_pixel_caps(self) -> None:
        pages = [fitz.Rect(0, 0, 1_000, 1_000) for _ in range(40)]
        scale = qualified_render_scale(pages)
        self.assertGreaterEqual(scale, MIN_RENDER_SCALE)
        self.assertLess(scale, RENDER_SCALE)
        self.assertLessEqual(max(rect.width * rect.height * scale * scale for rect in pages), MAX_RENDER_PIXELS_PER_PAGE)
        self.assertLessEqual(sum(rect.width * rect.height * scale * scale for rect in pages), MAX_RENDER_PIXELS_TOTAL)

    def test_document_requiring_subminimum_scale_is_rejected(self) -> None:
        with self.assertRaisesRegex(Exception, "rendering budget is not qualified"):
            qualified_render_scale([fitz.Rect(0, 0, 20_000, 20_000)])

    def test_replayed_authenticated_request_is_rejected_before_second_render(self) -> None:
        source = self.pdf_fixture()
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        headers = self.headers(digest, request_id="fixture_replay_request_000001")
        client = TestClient(app)
        first = client.post(
            "/v1/disarm",
            headers=headers,
            files={"source": ("fixture.pdf", source, "application/pdf")},
        )
        second = client.post(
            "/v1/disarm",
            headers=headers,
            files={"source": ("fixture.pdf", source, "application/pdf")},
        )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.headers["cache-control"], "no-store")

    def test_bad_signature_is_rejected_before_rendering(self) -> None:
        source = self.pdf_fixture()
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        headers = self.headers(digest)
        headers["x-tavonel-cdr-signature"] = "invalid"
        response = TestClient(app).post(
            "/v1/disarm",
            headers=headers,
            files={"source": ("fixture.pdf", source, "application/pdf")},
        )
        self.assertEqual(response.status_code, 401)

    def test_digest_mismatch_is_rejected(self) -> None:
        source = self.pdf_fixture()
        wrong_digest = "sha256:" + "0" * 64
        response = TestClient(app).post(
            "/v1/disarm",
            headers=self.headers(wrong_digest),
            files={"source": ("fixture.pdf", source, "application/pdf")},
        )
        self.assertEqual(response.status_code, 422)

    def test_macro_bearing_ooxml_is_rejected_before_libreoffice(self) -> None:
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w") as package:
            package.writestr("[Content_Types].xml", "<Types/>")
            package.writestr("word/vbaProject.bin", b"harmless-macro-marker")
        source = buffer.getvalue()
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        response = TestClient(app).post(
            "/v1/disarm",
            headers=self.headers(digest),
            files={
                "source": (
                    "fixture.docx",
                    source,
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_legacy_binary_office_is_not_qualified(self) -> None:
        source = b"harmless-legacy-office-marker"
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        response = TestClient(app).post(
            "/v1/disarm",
            headers=self.headers(digest),
            files={"source": ("fixture.doc", source, "application/msword")},
        )
        self.assertEqual(response.status_code, 422)

    def test_zip_is_not_qualified_for_format_changing_cdr(self) -> None:
        source = b"PK\x03\x04harmless-fixture"
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        response = TestClient(app).post(
            "/v1/disarm",
            headers=self.headers(digest),
            files={"source": ("fixture.zip", source, "application/zip")},
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()

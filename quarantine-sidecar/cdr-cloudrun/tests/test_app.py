from __future__ import annotations

import hashlib
import io
import os
import secrets
import subprocess
import sys
import unittest
import zipfile
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("TAVONEL_CDR_HMAC", "fixture-cdr-hmac-secret-that-is-long-enough-123")

from clamd_stub import FakeClamd  # noqa: E402
from cdr_fixtures import clean_pdf  # noqa: E402

# This suite is about rendering, not scanning, but the service refuses without a scanner and
# has no bypass flag. So it gets a real socket speaking the real protocol. `setdefault`, so a
# job that already exports CLAMD_HOST points this suite at that clamd instead.
for _name, _value in FakeClamd("clean").start().env().items():
    os.environ.setdefault(_name, _value)

import app as app_module  # noqa: E402
from app import (  # noqa: E402
    MAX_INPUT_BYTES,
    MAX_RENDER_PIXELS_PER_PAGE,
    MAX_RENDER_PIXELS_TOTAL,
    MIN_RENDER_SCALE,
    RENDER_SCALE,
    app,
    cdr_request_signature,
    qualified_render_scale,
    validate_input,
)


class PdfRasterCdrTest(unittest.TestCase):
    @staticmethod
    def pdf_fixture() -> bytes:
        return clean_pdf()

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
        sanitized = pdfium.PdfDocument(response.content)
        try:
            self.assertEqual(len(sanitized), 1)
            page = sanitized[0]
            try:
                text_page = page.get_textpage()
                try:
                    self.assertEqual(text_page.get_text_bounded().strip(), "")
                finally:
                    text_page.close()
                self.assertTrue(
                    any(obj.type == pdfium_c.FPDF_PAGEOBJ_IMAGE for obj in page.get_objects())
                )
            finally:
                page.close()
        finally:
            sanitized.close()

    @staticmethod
    def image_fixture(*, animated: bool = False) -> bytes:
        buffer = io.BytesIO()
        first = Image.new("RGB", (48, 32), (20, 40, 60))
        try:
            if animated:
                second = Image.new("RGB", (48, 32), (80, 100, 120))
                try:
                    first.save(
                        buffer,
                        format="GIF",
                        save_all=True,
                        append_images=[second],
                        duration=10,
                        loop=0,
                    )
                finally:
                    second.close()
            else:
                first.save(buffer, format="PNG")
        finally:
            first.close()
        return buffer.getvalue()

    def assert_image_only_pdf(self, payload: bytes, expected_pages: int) -> None:
        sanitized = pdfium.PdfDocument(payload)
        try:
            self.assertEqual(len(sanitized), expected_pages)
            for page_index in range(len(sanitized)):
                page = sanitized[page_index]
                try:
                    text_page = page.get_textpage()
                    try:
                        self.assertEqual(text_page.get_text_bounded().strip(), "")
                    finally:
                        text_page.close()
                    self.assertTrue(
                        any(obj.type == pdfium_c.FPDF_PAGEOBJ_IMAGE for obj in page.get_objects())
                    )
                finally:
                    page.close()
        finally:
            sanitized.close()

    def test_png_is_decoded_and_rebuilt_as_image_only_pdf(self) -> None:
        source = self.image_fixture()
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        response = TestClient(app).post(
            "/v1/disarm",
            headers=self.headers(digest),
            files={"source": ("fixture.png", source, "image/png")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_image_only_pdf(response.content, expected_pages=1)

    def test_multiframe_gif_preserves_frames_as_bounded_image_only_pages(self) -> None:
        source = self.image_fixture(animated=True)
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        response = TestClient(app).post(
            "/v1/disarm",
            headers=self.headers(digest),
            files={"source": ("fixture.gif", source, "image/gif")},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_image_only_pdf(response.content, expected_pages=2)

    def test_large_qualified_document_adapts_scale_without_relaxing_pixel_caps(self) -> None:
        pages = [(1_000.0, 1_000.0) for _ in range(40)]
        scale = qualified_render_scale(pages)
        self.assertGreaterEqual(scale, MIN_RENDER_SCALE)
        self.assertLess(scale, RENDER_SCALE)
        self.assertLessEqual(
            max(width * height * scale * scale for width, height in pages),
            MAX_RENDER_PIXELS_PER_PAGE,
        )
        self.assertLessEqual(
            sum(width * height * scale * scale for width, height in pages),
            MAX_RENDER_PIXELS_TOTAL,
        )

    def test_document_requiring_subminimum_scale_is_rejected(self) -> None:
        with self.assertRaisesRegex(Exception, "rendering budget is not qualified"):
            qualified_render_scale([(20_000.0, 20_000.0)])

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

    def test_malformed_pdf_is_refused_rather_than_partly_rendered(self) -> None:
        source = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 9 9 R\ntrailer\n%%EOF\n"
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        response = TestClient(app, raise_server_exceptions=False).post(
            "/v1/disarm",
            headers=self.headers(digest),
            files={"source": ("fixture.pdf", source, "application/pdf")},
        )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("x-tavonel-cdr-status", response.headers)
        self.assertNotIn("x-tavonel-cdr-output-sha256", response.headers)

    def test_input_above_the_intake_ceiling_is_refused_while_streaming(self) -> None:
        source = self.pdf_fixture() + b"\n%" + b"A" * MAX_INPUT_BYTES
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        response = TestClient(app, raise_server_exceptions=False).post(
            "/v1/disarm",
            headers=self.headers(digest),
            files={"source": ("fixture.pdf", source, "application/pdf")},
        )
        self.assertEqual(response.status_code, 413, response.text)
        self.assertNotIn("x-tavonel-cdr-output-sha256", response.headers)

    def test_a_caller_chosen_filename_stays_a_name(self) -> None:
        """No traversal out of the work directory, and no effect on what is rendered."""

        source = self.pdf_fixture()
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        client = TestClient(app, raise_server_exceptions=False)
        for filename in ("../../etc/passwd.pdf", "..\\..\\evil.pdf", "$(id).pdf"):
            with self.subTest(filename=filename):
                response = client.post(
                    "/v1/disarm",
                    headers=self.headers(digest),
                    files={"source": (filename, source, "application/pdf")},
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(
                    response.headers["x-tavonel-cdr-output-sha256"],
                    "sha256:" + hashlib.sha256(response.content).hexdigest(),
                )
                self.assertIn("sanitized.pdf", response.headers["content-disposition"])
        self.assertFalse(Path("/etc/passwd.pdf").exists())

    def test_a_control_byte_in_the_filename_is_refused_not_crashed(self) -> None:
        """Asserted on `validate_input`: httpx's own encoder drops it before the wire, so an
        end-to-end case here would prove the client, not this guard. A NUL that did arrive
        would otherwise reach `Path.open` and surface as an unhandled 500."""

        for name in ("fixture\x00.pdf", "fixture\n.pdf", "", ".", ".."):
            with self.subTest(filename=name):
                with self.assertRaisesRegex(Exception, "filename is invalid"):
                    validate_input(name, "application/pdf")

    def test_libreoffice_is_invoked_as_argv_with_a_timeout_and_no_shell(self) -> None:
        """A shell here would turn a caller-chosen filename into a caller-chosen command."""

        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w") as package:
            package.writestr("mimetype", "application/vnd.oasis.opendocument.text")
            package.writestr("content.xml", "<office/>")
        source = buffer.getvalue()
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        recorded: dict[str, object] = {}

        def record(command, **kwargs):  # noqa: ANN001, ANN003
            recorded["command"] = list(command)
            recorded["kwargs"] = kwargs
            return subprocess.CompletedProcess(command, 1)

        with patch.object(app_module.subprocess, "run", record):
            response = TestClient(app, raise_server_exceptions=False).post(
                "/v1/disarm",
                headers=self.headers(digest),
                files={
                    "source": (
                        "$(id)`whoami`&&echo.odt",
                        source,
                        "application/vnd.oasis.opendocument.text",
                    )
                },
            )
        self.assertEqual(response.status_code, 422, response.text)
        self.assertNotIn("x-tavonel-cdr-output-sha256", response.headers)
        command = recorded["command"]
        self.assertIsInstance(command, list)
        self.assertEqual(command[0], "soffice")
        # No shell: `subprocess.run` is never handed shell=True, and the caller-chosen name
        # arrives as one argv element rather than inside a command string.
        self.assertFalse(recorded["kwargs"].get("shell", False))
        self.assertEqual(recorded["kwargs"]["timeout"], 45)
        self.assertEqual(Path(str(command[-1])).name, "$(id)`whoami`&&echo.odt")


if __name__ == "__main__":
    unittest.main()

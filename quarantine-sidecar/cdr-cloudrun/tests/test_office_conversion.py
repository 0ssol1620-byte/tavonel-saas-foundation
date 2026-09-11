from __future__ import annotations

import hashlib
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("TAVONEL_CDR_HMAC", "fixture-cdr-hmac-secret-that-is-long-enough-123")

from clamd_stub import FakeClamd  # noqa: E402

# This suite is about LibreOffice conversion, not scanning, but the service refuses without a
# scanner and has no bypass flag. So it gets a real socket speaking the real protocol.
# `setdefault`, so a job that already exports CLAMD_HOST points it at that clamd instead.
for _name, _value in FakeClamd("clean").start().env().items():
    os.environ.setdefault(_name, _value)

from app import app, cdr_request_signature  # noqa: E402

# LibreOffice is installed by the Dockerfile, not by the developer machines in this lane, so
# outside the image this suite skips with a reason instead of erroring in setUpClass. Inside
# the qualification container OFFICE_QUALIFICATION=1 turns a missing `soffice` into a failure,
# so the Office rows can never become a silent green if the package drops out of the image.
SOFFICE = shutil.which("soffice")
if not SOFFICE and os.getenv("OFFICE_QUALIFICATION") == "1":
    raise RuntimeError("OFFICE_QUALIFICATION=1 but LibreOffice is not installed in this image")


@unittest.skipUnless(SOFFICE, "requires LibreOffice (soffice); it ships in the CDR service image only")
class OfficeConversionQualificationTest(unittest.TestCase):
    secret = "fixture-cdr-hmac-secret-that-is-long-enough-123"

    @classmethod
    def setUpClass(cls) -> None:
        cls._temp_dir = tempfile.TemporaryDirectory()
        cls.directory = Path(cls._temp_dir.name)
        cls.fixtures = {
            "fixture.docx": (
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                cls._make_docx(),
            ),
            "fixture.xlsx": (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                cls._make_xlsx(),
            ),
            "fixture.pptx": (
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                cls._make_pptx(),
            ),
            # D06. These three are the whole qualification of the text formats: nothing outside
            # this image can prove that `soffice` opens a .txt/.csv/.html with the import filter
            # `app.py` pins and produces a page. The filter strings are the part that fails
            # loudly if they are wrong -- a bad --infilter is a non-zero exit and a 422 here.
            "fixture-text.txt": (
                "text/plain",
                "TAVONEL harmless plain-text conversion fixture\nsecond line\n".encode("utf-8"),
            ),
            "fixture-text.csv": (
                "text/csv",
                "field,value\nfixture,123\nTAVONEL,456\n".encode("utf-8"),
            ),
            # Self-contained on purpose: `reject_active_html` refuses any external reference
            # before LibreOffice sees the file, so a fixture with an <img src> would 422 rather
            # than qualify the conversion.
            "fixture-text.html": (
                "text/html",
                (
                    "<html><head><title>TAVONEL</title></head><body><h1>Harmless</h1>"
                    "<table><tr><td>1</td><td>2</td></tr></table></body></html>"
                ).encode("utf-8"),
            ),
        }

    @classmethod
    def tearDownClass(cls) -> None:
        cls._temp_dir.cleanup()

    @classmethod
    def _convert(cls, source: Path, target_type: str) -> bytes:
        completed = subprocess.run(
            ["soffice", "--headless", "--convert-to", target_type, "--outdir", str(cls.directory), str(source)],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        target = cls.directory / f"{source.stem}.{target_type}"
        if completed.returncode != 0 or not target.is_file() or target.stat().st_size < 1:
            raise RuntimeError(f"could not create harmless {target_type} fixture")
        return target.read_bytes()

    @classmethod
    def _make_docx(cls) -> bytes:
        source = cls.directory / "fixture.txt"
        source.write_text("TAVONEL harmless DOCX conversion fixture\n", encoding="utf-8")
        return cls._convert(source, "docx")

    @classmethod
    def _make_xlsx(cls) -> bytes:
        source = cls.directory / "fixture.csv"
        source.write_text("fixture,123\nTAVONEL,456\n", encoding="utf-8")
        return cls._convert(source, "xlsx")

    @classmethod
    def _make_pptx(cls) -> bytes:
        template = Path("/usr/lib/libreoffice/share/template/common/presnt/Beehive.otp")
        if not template.is_file():
            raise RuntimeError("LibreOffice harmless presentation template is unavailable")
        return cls._convert(template, "pptx")

    @classmethod
    def headers(cls, digest: str) -> dict[str, str]:
        timestamp = datetime.now(UTC).isoformat()
        request_id = secrets.token_urlsafe(18)
        return {
            "x-tavonel-input-sha256": digest,
            "x-tavonel-cdr-timestamp": timestamp,
            "x-tavonel-cdr-request-id": request_id,
            "x-tavonel-cdr-signature": cdr_request_signature(cls.secret, timestamp, request_id, digest),
        }

    def test_empirically_qualified_office_inputs_become_image_only_pdf(self) -> None:
        client = TestClient(app)
        for filename, (mime_type, source) in self.fixtures.items():
            with self.subTest(filename=filename):
                digest = "sha256:" + hashlib.sha256(source).hexdigest()
                response = client.post(
                    "/v1/disarm",
                    headers=self.headers(digest),
                    files={"source": (filename, source, mime_type)},
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.headers["content-type"], "application/pdf")
                self.assertEqual(response.headers["x-tavonel-cdr-status"], "clean")
                self.assertEqual(response.headers["x-tavonel-input-sha256"], digest)
                self.assertEqual(
                    response.headers["x-tavonel-cdr-output-sha256"],
                    "sha256:" + hashlib.sha256(response.content).hexdigest(),
                )
                sanitized = pdfium.PdfDocument(response.content)
                try:
                    self.assertGreaterEqual(len(sanitized), 1)
                    for page_index in range(len(sanitized)):
                        page = sanitized[page_index]
                        try:
                            text_page = page.get_textpage()
                            try:
                                self.assertEqual(text_page.get_text_bounded().strip(), "")
                            finally:
                                text_page.close()
                            self.assertTrue(
                                any(
                                    obj.type == pdfium_c.FPDF_PAGEOBJ_IMAGE
                                    for obj in page.get_objects()
                                )
                            )
                        finally:
                            page.close()
                finally:
                    sanitized.close()


if __name__ == "__main__":
    unittest.main()

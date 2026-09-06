from __future__ import annotations

import hashlib
import os
import secrets
import subprocess
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

import fitz
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("TAVONEL_CDR_HMAC", "fixture-cdr-hmac-secret-that-is-long-enough-123")
# No clamd in this suite. CI overrides both to run it against the real scanner.
os.environ.setdefault("MALWARE_SCAN_REQUIRED", "0")

from app import app, cdr_request_signature  # noqa: E402


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
                sanitized = fitz.open(stream=response.content, filetype="pdf")
                try:
                    self.assertGreaterEqual(sanitized.page_count, 1)
                    self.assertEqual("".join(page.get_text() for page in sanitized).strip(), "")
                    self.assertTrue(all(page.get_images(full=True) for page in sanitized))
                finally:
                    sanitized.close()


if __name__ == "__main__":
    unittest.main()

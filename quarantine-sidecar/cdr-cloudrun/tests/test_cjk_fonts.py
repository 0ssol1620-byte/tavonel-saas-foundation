"""WO-KO-1: Korean, Japanese and Chinese Office text must survive the Office -> PDF step.

Without a CJK face LibreOffice draws Hangul, Kana and Han as missing-glyph boxes. The Dockerfile
installs fonts-noto-cjk and fails the build if no face answers for ko, ja and zh; the static test
pins that. The conversion test needs `soffice`, which ships in the CDR image only, so it skips
elsewhere with a reason. Every sentence is synthetic.
"""

from __future__ import annotations

import io
import os
import re
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

import pypdfium2 as pdfium

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
os.environ.setdefault("TAVONEL_CDR_HMAC", "fixture-cdr-hmac-secret-that-is-long-enough-123")

DOCKERFILE = HERE.parent / "Dockerfile"
SOFFICE = shutil.which("soffice")
if not SOFFICE and os.getenv("OFFICE_QUALIFICATION") == "1":
    raise RuntimeError("OFFICE_QUALIFICATION=1 but LibreOffice is not installed in this image")

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
SENTENCES = {
    "ko": "대한민국 정부는 계약 기간 동안 매출 증가를 보고했습니다.",
    "ja": "これは日本語の文章であり、売上が増加しました。",
    "zh": "这是一个中文句子，收入在合同期内增长。",
}
HANGUL = re.compile("[가-힣]")
KANA = re.compile("[぀-ヿ]")
HAN = re.compile("[一-鿿]")


def synthetic_docx() -> bytes:
    paragraphs = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in SENTENCES.values())
    parts = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            "</Relationships>"
        ),
        "word/document.xml": (
            '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f"<w:body>{paragraphs}</w:body></w:document>"
        ),
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, body in parts.items():
            archive.writestr(name, body.encode("utf-8"))
    return buffer.getvalue()


class DockerfileInstallsCjkFontsTest(unittest.TestCase):
    def setUp(self) -> None:
        # Docker drops comment lines before it reads an instruction, so the tests do too.
        lines = DOCKERFILE.read_text(encoding="utf-8").splitlines()
        self.text = "\n".join(line for line in lines if not line.lstrip().startswith("#"))

    def test_installs_the_noto_cjk_package_with_the_office_packages(self) -> None:
        install = re.search(r"apt-get install.*?rm -rf /var/lib/apt/lists", self.text, re.DOTALL)
        self.assertIsNotNone(install)
        block = install.group(0) if install else ""
        # The whole package name: `fonts-noto-cjk-extra` is a different package.
        self.assertRegex(block, r"(?m)^\s*fonts-noto-cjk(?![\w-])")
        self.assertIn("libreoffice-writer", block)

    def test_build_fails_when_a_script_has_no_face(self) -> None:
        guard = re.search(r"(?m)^RUN fc-cache -f\b(?:.*\\\n)*.*", self.text)
        self.assertIsNotNone(guard, "the font guard must be one RUN that starts with fc-cache")
        block = guard.group(0) if guard else ""
        for lang in ("ko", "ja", "zh"):
            with self.subTest(lang=lang):
                self.assertRegex(block, rf"&& fc-list :lang={lang} \| grep -q \.")
        # A guard that cannot fail the build is no guard.
        self.assertNotRegex(block, r"\|\|")


@unittest.skipUnless(SOFFICE, "requires LibreOffice (soffice); it ships in the CDR service image only")
class CjkSurvivesConversionTest(unittest.TestCase):
    def test_converted_pdf_keeps_hangul_kana_and_han_and_embeds_a_cjk_face(self) -> None:
        from clamd_stub import FakeClamd

        for name, value in FakeClamd("clean").start().env().items():
            os.environ.setdefault(name, value)
        from app import convert_to_pdf

        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            source = work / "ko-ja-zh.docx"
            source.write_bytes(synthetic_docx())
            converted = convert_to_pdf(source, DOCX, work)
            pdf_bytes = converted.read_bytes()
            document = pdfium.PdfDocument(pdf_bytes)
            try:
                text = "".join(page.get_textpage().get_text_range() for page in document)
            finally:
                document.close()
        squeezed = re.sub(r"\s+", "", text)
        for lang, sentence in SENTENCES.items():
            with self.subTest(lang=lang):
                # A whole run of the sentence, not just one lucky character.
                self.assertIn(re.sub(r"\s+", "", sentence)[:8], squeezed)
        self.assertRegex(text, HANGUL)
        self.assertRegex(text, KANA)
        self.assertRegex(text, HAN)
        # A page drawn in a fallback face with no CJK glyphs shows boxes even when the text layer
        # still decodes; the embedded font name is what separates the two.
        self.assertIn(b"CJK", pdf_bytes)


if __name__ == "__main__":
    unittest.main()

"""PyMuPDF must not come back.

PyMuPDF (import name `fitz`) and the MuPDF it wraps are AGPL-3.0 unless a commercial licence
is bought. Shipping either in a proprietary hosted image is a stop-the-line licence issue, so
the renderer is PDFium via `pypdfium2`. This suite is the ratchet: it fails if the dependency,
the import, or a build instruction reappears.

Run inside the service image it also proves the *distribution* is clean, not only the source:
`find_spec` sees what is actually installed.
"""

from __future__ import annotations

import importlib.util
import re
import unittest
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parents[1]
# Word-bounded so prose like "PyMuPDF is not used" in README.md is untouched; only build
# inputs and code are scanned, and the README is deliberately not among them.
BANNED = re.compile(r"\b(fitz|py-?mupdf|mupdf)\b", re.IGNORECASE)
SCANNED_GLOBS = ("*.py", "requirements*.txt", "Dockerfile", "*.yaml", "*.yml")
BANNED_MODULES = ("fitz", "pymupdf", "fitz_old")


class RendererLicensingTest(unittest.TestCase):
    def test_no_agpl_renderer_is_installed_in_this_environment(self) -> None:
        installed = [name for name in BANNED_MODULES if importlib.util.find_spec(name) is not None]
        self.assertEqual(installed, [], "PyMuPDF is AGPL-3.0 and must not be installed here")

    @unittest.skipUnless(
        (SERVICE_DIR / "requirements.txt").is_file(),
        "source scan needs the service directory; the container copies app.py only",
    )
    def test_no_agpl_renderer_in_the_service_sources_or_build_inputs(self) -> None:
        offenders: list[str] = []
        for pattern in SCANNED_GLOBS:
            for path in sorted(SERVICE_DIR.rglob(pattern)):
                if {".venv", "__pycache__", ".pytest_cache"} & set(path.parts):
                    continue
                if path.name == Path(__file__).name:
                    continue
                for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                    if BANNED.search(line):
                        offenders.append(f"{path.relative_to(SERVICE_DIR)}:{number}: {line.strip()}")
        self.assertEqual(offenders, [], "PyMuPDF/fitz must not re-enter the CDR sidecar")

    @unittest.skipUnless(
        (SERVICE_DIR / "requirements.txt").is_file(),
        "source scan needs the service directory; the container copies app.py only",
    )
    def test_every_direct_dependency_is_pinned_to_an_exact_version(self) -> None:
        """An unpinned line makes the image irreproducible and the NOTICE licences unverifiable."""

        requirements = (SERVICE_DIR / "requirements.txt").read_text(encoding="utf-8")
        lines = [
            line.strip()
            for line in requirements.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        self.assertTrue(lines, "requirements.txt is empty")
        for line in lines:
            with self.subTest(requirement=line):
                self.assertRegex(line, r"^[A-Za-z0-9._-]+(\[[A-Za-z0-9,._-]+\])?==[^\s;]+$")
        self.assertTrue(
            any(line.startswith("pypdfium2==") for line in lines),
            "the qualified renderer pypdfium2 must stay in requirements.txt",
        )

    @unittest.skipUnless(
        (SERVICE_DIR / "NOTICE").is_file(),
        "NOTICE lives beside the service sources",
    )
    def test_the_notice_covers_every_pinned_direct_dependency(self) -> None:
        notice = (SERVICE_DIR / "NOTICE").read_text(encoding="utf-8")
        for line in (SERVICE_DIR / "requirements.txt").read_text(encoding="utf-8").splitlines():
            requirement = line.strip()
            if not requirement or requirement.startswith("#"):
                continue
            name = re.split(r"[\[=]", requirement, maxsplit=1)[0]
            with self.subTest(distribution=name):
                self.assertIn(name, notice, "every pinned dependency needs a NOTICE row")


if __name__ == "__main__":
    unittest.main()

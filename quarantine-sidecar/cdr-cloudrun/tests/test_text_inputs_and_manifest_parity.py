"""The format list across the language boundary, and the text formats it just gained.

Two things are asserted here, and neither needs LibreOffice:

1. R2-input-01. `shared/capabilityManifest.ts` claims to be the one list every surface reads.
   That was true of the five TypeScript surfaces it names and false of this service, which
   keeps its own `ALLOWED_INPUTS` because it is Python. The manifest now emits
   `shared/capabilityInputs.generated.json`, and this suite holds this dict to it. Nothing is
   read from that file at runtime -- coupling Cloud Run to a file in the site repository would
   buy a deployment dependency to solve a review problem.

2. D06. The three text formats are accepted, each is routed to a pinned LibreOffice import
   filter rather than to whatever the container locale suggests, and HTML that would make
   Writer/Web fetch or run something is refused before conversion.

The conversion itself is qualified in `test_office_conversion.py`, which runs only inside the
service image; this file proves the wiring, not the rendering.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("TAVONEL_CDR_HMAC", "fixture-cdr-hmac-secret-that-is-long-enough-123")

from clamd_stub import FakeClamd  # noqa: E402

for _name, _value in FakeClamd("clean").start().env().items():
    os.environ.setdefault(_name, _value)

from app import (  # noqa: E402
    ALLOWED_INPUTS,
    LIBREOFFICE_MIMES,
    OFFICE_IMPORT_FILTERS,
    TEXT_MIMES,
    convert_to_pdf,
    reject_active_html,
    validate_input,
)
from fastapi import HTTPException  # noqa: E402

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CANONICAL_INPUTS = REPOSITORY_ROOT / "shared" / "capabilityInputs.generated.json"


class CanonicalInputParityTest(unittest.TestCase):
    def canonical(self) -> dict[str, object]:
        # Fail closed. A missing artifact means the manifest and this service were never
        # compared, and a skip here would report that as a pass.
        self.assertTrue(
            CANONICAL_INPUTS.is_file(),
            f"{CANONICAL_INPUTS} is missing; regenerate it with"
            " UPDATE_CAPABILITY_INPUTS=1 npx vitest run server/foundation/capabilityManifestInputs.test.ts",
        )
        return json.loads(CANONICAL_INPUTS.read_text(encoding="utf-8"))

    def test_allowed_inputs_is_exactly_the_capability_manifest_list(self) -> None:
        canonical = self.canonical()
        self.assertEqual(canonical["schemaVersion"], "tavonel.capability_inputs.v1")
        expected = {
            mime: set(extensions)
            for mime, extensions in dict(canonical["cdrAllowedInputs"]).items()  # type: ignore[arg-type]
        }
        self.assertEqual(dict(ALLOWED_INPUTS), expected)

    def test_the_site_never_accepts_a_format_this_service_would_refuse(self) -> None:
        """The gate's direction, asserted from this side.

        `TEXT_INPUTS_LIVE` exists so the site whitelist is a subset of what the released image
        accepts, never a superset. This checks the source-tree half of that: whatever the gate
        currently holds, every MIME the site admits is one this dict admits.
        """
        canonical = self.canonical()
        site = dict(canonical["siteUploadWhitelist"])  # type: ignore[arg-type]
        for mime, extensions in site.items():
            self.assertIn(mime, ALLOWED_INPUTS, f"the site accepts {mime} and this service does not")
            self.assertEqual(set(extensions), ALLOWED_INPUTS[mime])

    def test_a_stale_artifact_is_detected_rather_than_ignored(self) -> None:
        """The failure path: the comparison has to notice a list that no longer matches."""
        drifted = {mime: set(extensions) for mime, extensions in ALLOWED_INPUTS.items()}
        drifted.pop("text/csv")
        self.assertNotEqual(dict(ALLOWED_INPUTS), drifted)
        drifted = {mime: set(extensions) for mime, extensions in ALLOWED_INPUTS.items()}
        drifted["application/pdf"] = {".pdf", ".fdf"}
        self.assertNotEqual(dict(ALLOWED_INPUTS), drifted)


class TextInputRoutingTest(unittest.TestCase):
    def test_each_text_format_is_accepted_with_its_own_extension(self) -> None:
        for name, mime in (
            ("notes.txt", "text/plain"),
            ("rows.csv", "text/csv"),
            ("page.html", "text/html"),
            ("page.htm", "text/html"),
        ):
            with self.subTest(name=name):
                self.assertEqual(validate_input(name, mime), (name, mime))

    def test_a_text_extension_that_does_not_match_its_mime_is_refused(self) -> None:
        for name, mime in (
            ("rows.csv", "text/plain"),
            ("notes.txt", "text/csv"),
            ("page.html", "text/csv"),
            ("notes.md", "text/markdown"),
            ("mail.eml", "message/rfc822"),
        ):
            with self.subTest(name=name):
                with self.assertRaises(HTTPException):
                    validate_input(name, mime)

    def test_every_text_format_converts_through_libreoffice_with_a_pinned_import_filter(self) -> None:
        for mime in TEXT_MIMES:
            with self.subTest(mime=mime):
                self.assertIn(mime, LIBREOFFICE_MIMES)
                self.assertIn(mime, OFFICE_IMPORT_FILTERS)
        # The Office formats keep the behaviour the deployed image is already qualified for:
        # no --infilter, so the package declares its own type.
        self.assertNotIn(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            OFFICE_IMPORT_FILTERS,
        )

    def test_the_import_filter_reaches_soffice_in_the_documented_syntax(self) -> None:
        """`--infilter=<name>`, one argv element.

        This asserted the separated `--infilter` `<name>` pair, and passed, because it records
        the argv against a stub and never runs soffice. In the image the three text formats it
        covers returned 422 for every input. `soffice --help` documents the `=` form, and an
        argv element that does not start with `-` is taken as a file to open, so the filter name
        was being handed to LibreOffice as a second input path.
        """
        recorded: list[list[str]] = []

        class _Completed:
            returncode = 1

        def record(command, **kwargs):  # noqa: ANN001, ANN003
            recorded.append(list(command))
            return _Completed()

        import app as app_module

        for mime, name, expected in (
            ("text/csv", "rows.csv", "Text - txt - csv (StarCalc):44,34,76,1"),
            ("text/plain", "notes.txt", "Text (encoded):UTF8"),
            ("text/html", "page.html", "HTML (StarWriter)"),
        ):
            with self.subTest(mime=mime):
                recorded.clear()
                work_dir = Path(self.enterContext(tempfile.TemporaryDirectory()))
                source = work_dir / name
                source.write_text("a,b\n1,2\n", encoding="utf-8")
                original_run = app_module.subprocess.run
                app_module.subprocess.run = record  # type: ignore[assignment]
                try:
                    with self.assertRaises(HTTPException):
                        convert_to_pdf(source, mime, work_dir)
                finally:
                    app_module.subprocess.run = original_run  # type: ignore[assignment]
                command = recorded[0]
                self.assertIn(f"--infilter={expected}", command)
                # ...and not as two elements, which is the form that produced a 422 for every
                # text input in the qualification image.
                self.assertNotIn("--infilter", command)
                self.assertEqual(command[command.index("--convert-to") + 1], "pdf:writer_pdf_Export")


class HtmlActiveContentTest(unittest.TestCase):
    def write(self, markup: str) -> Path:
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        target = directory / "page.html"
        target.write_text(markup, encoding="utf-8")
        return target

    def test_self_contained_markup_is_qualified(self) -> None:
        for markup in (
            "<html><body><h1>Quarterly report</h1><p>Revenue rose.</p></body></html>",
            '<html><body><a href="https://example.test/next">next page</a></body></html>',
            "<html><body><table><tr><td>1</td><td>2</td></tr></table></body></html>",
        ):
            with self.subTest(markup=markup[:40]):
                reject_active_html(self.write(markup), "text/html")

    def test_a_reference_or_a_script_is_refused_before_conversion(self) -> None:
        for markup in (
            '<html><body><img src="https://example.test/pixel.png"></body></html>',
            '<html><head><link rel="stylesheet" href="https://example.test/a.css"></head></html>',
            "<html><body><script>fetch('https://example.test')</script></body></html>",
            '<html><body><iframe src="a.html"></iframe></body></html>',
            '<html><head><style>@import url("https://example.test/a.css");</style></head></html>',
            '<html><body><div style="background:url(https://example.test/a.png)"></div></body></html>',
            '<html><head><meta http-equiv="refresh" content="0;url=https://example.test"></head></html>',
            '<html><body><object data="a.swf"></object></body></html>',
            '<html><body><img SRC = "https://example.test/pixel.png"></body></html>',
        ):
            with self.subTest(markup=markup[:50]):
                with self.assertRaisesRegex(HTTPException, "unqualified active or external content"):
                    reject_active_html(self.write(markup), "text/html")

    def test_the_guard_reads_only_html(self) -> None:
        """A CSV row containing `src=` is not HTML and is not refused for looking like it."""
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        target = directory / "rows.csv"
        target.write_text('field,value\nsrc=,"<script>"\n', encoding="utf-8")
        reject_active_html(target, "text/csv")

    def test_undecodable_bytes_are_searched_rather_than_raising(self) -> None:
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        target = directory / "page.html"
        target.write_bytes(b"\xff\xfe<html><body><script>x</script></body></html>")
        with self.assertRaises(HTTPException):
            reject_active_html(target, "text/html")


if __name__ == "__main__":
    unittest.main()

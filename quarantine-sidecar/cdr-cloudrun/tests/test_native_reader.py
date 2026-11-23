"""Native office cell reader in the CDR service (WO-E-TBL-1; ADR-2026-11-18 route A).

Five groups:
- the vendored Core files and their manifest (stdlib only, runs everywhere);
- a static check that nothing in the reader's TAVONEL module graph can call a process, a socket
  or a dynamic import (stdlib only, runs everywhere), with a positive control;
- the real conversion through `read_native` on hand-written synthetic packages: S11 (stale
  cached formula, hidden sheet, external reference), a zip-bomb-shaped workbook, 500,001 cells, a
  macro-enabled package, path-traversal member names, DOCX and PPTX tables. These need the
  reader's distributions (openpyxl, python-docx, python-pptx, lxml, bs4, pydantic, defusedxml)
  and are skipped, by name, where they are not installed -- today that includes the service
  image and its CI job, whose requirements.txt does not carry them yet;
- the parent's child-process handling: timeout, crash, resource exit, malformed output;
- the app: flag parsing, nothing registered with the flag off, the flagged endpoint, and the PDF
  path's output unchanged with the reader failing and with it absent.
"""

from __future__ import annotations

import ast
import importlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import patch

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("TAVONEL_CDR_HMAC", "fixture-cdr-hmac-secret-that-is-long-enough-123")

from cdr_fixtures import clean_pdf, digest_of, signed_headers
from clamd_stub import FakeClamd

for _name, _value in FakeClamd("clean").start().env().items():
    os.environ.setdefault(_name, _value)

import native_fixtures as nf
from fastapi.testclient import TestClient

import app as app_module
import native_read_child as child
import native_reader
from request_boundary import AUTHENTICATED_PATHS

PINNED_CORE_SHA = "783d8d0703878fcd805afb7fd136b6aae694aeb3"
READER_DISTRIBUTIONS = ("openpyxl", "docx", "pptx", "lxml", "bs4", "pydantic", "defusedxml")
MISSING = [name for name in READER_DISTRIBUTIONS if importlib.util.find_spec(name) is None]
NEEDS_READER = unittest.skipIf(
    bool(MISSING), f"native reader distributions not installed here: {', '.join(MISSING)} (requirements delta pending)"
)
FIVE_MIB = 5 * 1024 * 1024
FLAG = native_reader.FLAG_ENV


def read_bytes(payload: bytes, mime: str = nf.XLSX_MIME, digest: str | None = None) -> dict[str, Any]:
    """The real conversion: package bytes on disk -> parse_non_pdf_to_cir -> native_read.v1."""
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "source.bin"
        path.write_bytes(payload)
        return child.read_native(path, mime, digest or nf.digest(payload), FIVE_MIB)


def cells_by_address(result: dict[str, Any]) -> dict[tuple[int, str], dict[str, Any]]:
    return {
        (cell["location"]["containerIndex0"], cell["location"]["cellAddress"]): cell
        for table in result["tables"] for cell in table["cells"]
    }


def row(number: int, *cells: str) -> str:
    return f'<row r="{number}">{"".join(cells)}</row>'


def value(ref: str, text: str) -> str:
    return f'<c r="{ref}"><v>{text}</v></c>'


def label(ref: str, text: str) -> str:
    return f'<c r="{ref}" t="inlineStr"><is><t>{text}</t></is></c>'


def formula(ref: str, source: str, cached: str | None) -> str:
    return f'<c r="{ref}"><f>{source}</f>' + ("" if cached is None else f"<v>{cached}</v>") + "</c>"


STALE_SHEET = nf.sheet_xml(
    row(1, label("A1", "Item"), label("B1", "Total"))
    + row(2, value("A2", "1"), formula("B2", "A2+A2", "5"))
    + row(3, value("A3", "1"), formula("B3", "A3*2", None))
)


class VendoredFilesTest(unittest.TestCase):
    def test_every_vendored_file_matches_the_manifest_pinned_to_one_core_sha(self) -> None:
        manifest, manifest_digest = child.verify_vendor()
        self.assertEqual(manifest["coreSha"], PINNED_CORE_SHA)
        self.assertRegex(manifest_digest, r"^sha256:[a-f0-9]{64}$")
        for entry in manifest["files"]:
            self.assertTrue((child.VENDOR_DIR / entry["path"]).is_file(), entry["path"])
            self.assertTrue(entry["source"].endswith(entry["path"].split("/", 1)[1]), entry)

    def test_the_skipped_package_inits_are_not_vendored(self) -> None:
        # Their absence is the narrower import path: nothing that imports redis, cryptography,
        # PIL or pypdf is present to be imported.
        self.assertFalse((child.VENDOR_DIR / "akc_security" / "__init__.py").exists())
        self.assertFalse((child.VENDOR_DIR / "akc_native_parsers" / "__init__.py").exists())
        self.assertFalse((child.VENDOR_DIR / "akc_security" / "pdf_secrets.py").exists())
        self.assertFalse((child.VENDOR_DIR / "akc_native_parsers" / "pdf_parser.py").exists())

    def test_the_facade_names_are_exactly_what_the_vendored_parser_imports_and_files_defines(self) -> None:
        security = ast.parse((child.VENDOR_DIR / "akc_native_parsers" / "security.py").read_text(encoding="utf-8"))
        imported = {
            alias.name for node in security.body if isinstance(node, ast.ImportFrom) and node.module == "akc_security"
            for alias in node.names
        }
        self.assertEqual(imported, set(child.FACADE_NAMES))
        files = ast.parse((child.VENDOR_DIR / "akc_security" / "files.py").read_text(encoding="utf-8"))
        defined = {node.name for node in files.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))} | {
            target.id for node in files.body if isinstance(node, (ast.Assign, ast.AnnAssign))
            for target in (node.targets if isinstance(node, ast.Assign) else [node.target]) if isinstance(target, ast.Name)
        }
        self.assertLessEqual(set(child.FACADE_NAMES), defined)
        # Nothing else in the reader's graph imports from the skipped package inits.
        for path in child.VENDOR_DIR.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module in {"akc_security", "akc_native_parsers"}:
                    self.assertEqual(path.name, "security.py", f"{path} imports from a facade package")

    @contextmanager
    def vendor_copy(self) -> Iterator[Path]:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "vendor"
            shutil.copytree(child.VENDOR_DIR, target, ignore=shutil.ignore_patterns("__pycache__"))
            yield target

    def assert_reason(self, vendor: Path, reason: str) -> None:
        with self.assertRaises(child.ReaderUnavailable) as caught:
            child.verify_vendor(vendor)
        self.assertEqual(caught.exception.reason, reason)

    def test_a_changed_byte_in_a_vendored_file_is_an_integrity_failure(self) -> None:
        with self.vendor_copy() as vendor:
            target = vendor / "akc_native_parsers" / "xlsx_parser.py"
            target.write_bytes(target.read_bytes() + b"\n")
            self.assert_reason(vendor, "reader_integrity_failed")

    def test_a_crlf_checkout_of_a_vendored_file_is_an_integrity_failure(self) -> None:
        with self.vendor_copy() as vendor:
            target = vendor / "akc_cir" / "base.py"
            target.write_bytes(target.read_bytes().replace(b"\n", b"\r\n"))
            self.assert_reason(vendor, "reader_integrity_failed")

    def test_an_unlisted_module_beside_the_vendored_files_is_an_integrity_failure(self) -> None:
        # A file the manifest does not name could shadow a module the parser imports.
        for name in ("akc_security/__init__.py", "akc_cir/extra.py", "openpyxl.py"):
            with self.subTest(name=name), self.vendor_copy() as vendor:
                (vendor / name).write_text("x = 1\n", encoding="utf-8")
                self.assert_reason(vendor, "reader_integrity_failed")

    def test_a_missing_vendored_file_is_an_integrity_failure(self) -> None:
        with self.vendor_copy() as vendor:
            (vendor / "akc_cir" / "models.py").unlink()
            self.assert_reason(vendor, "reader_integrity_failed")

    def test_a_manifest_naming_a_path_outside_the_vendor_tree_is_refused(self) -> None:
        for bad in ("../app.py", "akc_cir/../../app.py", "/etc/passwd", "akc_cir/base.pyc"):
            with self.subTest(path=bad), self.vendor_copy() as vendor:
                manifest = json.loads((vendor / child.MANIFEST_NAME).read_text(encoding="utf-8"))
                manifest["files"][0]["path"] = bad
                (vendor / child.MANIFEST_NAME).write_text(json.dumps(manifest), encoding="utf-8")
                self.assert_reason(vendor, "reader_integrity_failed")

    def test_a_manifest_missing_a_field_is_refused_not_defaulted(self) -> None:
        for field in ("coreSha", "schema", "files"):
            with self.subTest(field=field), self.vendor_copy() as vendor:
                manifest = json.loads((vendor / child.MANIFEST_NAME).read_text(encoding="utf-8"))
                del manifest[field]
                (vendor / child.MANIFEST_NAME).write_text(json.dumps(manifest), encoding="utf-8")
                self.assert_reason(vendor, "reader_integrity_failed")

    def test_no_vendor_directory_is_reader_absent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.assert_reason(Path(directory) / "vendor", "reader_absent")

    def test_an_integrity_failure_reaches_the_caller_as_a_named_unavailable_read(self) -> None:
        payload = nf.xlsx([("Data", "visible", STALE_SHEET)])
        with self.vendor_copy() as vendor, tempfile.TemporaryDirectory() as directory:
            (vendor / "akc_cir" / "base.py").write_bytes(b"# changed\n")
            path = Path(directory) / "source.xlsx"
            path.write_bytes(payload)
            result = child.read_native(path, nf.XLSX_MIME, nf.digest(payload), FIVE_MIB, vendor_dir=vendor)
        self.assertEqual(result, child.unavailable("reader_integrity_failed", nf.digest(payload)))
        self.assertEqual(result["reasonClass"], "operational")


# ----------------------------------------------------------------------------------------------
# Static: no process, socket or dynamic import call reachable from the reader's module graph.

# Imports, for the vendored modules: process, network and foreign-function modules. `importlib` is
# not here because `akc_cir.tracked_build_context` imports `importlib.machinery.ModuleSpec` as a
# type annotation; every importlib *call* is still refused by the call rule below.
BANNED_IMPORTS = {
    "subprocess", "socket", "ssl", "asyncio", "multiprocessing", "ctypes", "runpy", "pty",
    "ftplib", "smtplib", "telnetlib", "xmlrpc", "webbrowser", "http", "urllib.request", "concurrent",
}
BANNED_CALL_PREFIXES = (
    "subprocess.", "socket.", "ssl.", "asyncio.", "multiprocessing.", "ctypes.", "importlib.", "runpy.",
    "pty.", "ftplib.", "smtplib.", "http.", "urllib.request.", "concurrent.", "_posixsubprocess.",
    "os.system", "os.popen", "os.fork", "os.exec", "os.spawn", "os.posix_spawn", "os.startfile", "os.kill",
)
BANNED_BUILTINS = {"eval", "exec", "compile", "__import__", "breakpoint"}


def _aliases(tree: ast.Module, package: str) -> dict[str, str]:
    names: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names[alias.asname or alias.name.split(".")[0]] = alias.name if alias.asname else alias.name.split(".")[0]
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                parent = package.rsplit(".", node.level - 1)[0] if node.level > 1 else package
                base = f"{parent}.{base}" if base else parent
            for alias in node.names:
                names[alias.asname or alias.name] = f"{base}.{alias.name}"
    return names


def _dotted(node: ast.AST, names: dict[str, str]) -> str | None:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    head = names.get(node.id, node.id)
    return ".".join([head, *reversed(parts)])


def _imported_modules(tree: ast.Module, package: str) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                parent = package.rsplit(".", node.level - 1)[0] if node.level > 1 else package
                base = f"{parent}.{base}" if base else parent
            modules.add(base)
            modules.update(f"{base}.{alias.name}" for alias in node.names)
    return modules


def violations(source: str, module: str, *, vendored: bool) -> list[str]:
    tree = ast.parse(source)
    package = module.rsplit(".", 1)[0] if "." in module else module
    names = _aliases(tree, package)
    found: list[str] = []
    if vendored:
        for imported in _imported_modules(tree, package):
            if any(imported == banned or imported.startswith(banned + ".") for banned in BANNED_IMPORTS):
                found.append(f"{module} imports {imported}")
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        target = _dotted(node.func, names)
        if target is None:
            continue
        if target in BANNED_BUILTINS or any(target == prefix.rstrip(".") or target.startswith(prefix) for prefix in BANNED_CALL_PREFIXES):
            found.append(f"{module}:{node.lineno} calls {target}")
    return found


def reader_graph() -> dict[str, Path]:
    """native_read_child plus every first-party module it reaches, resolved to the vendored files."""
    graph: dict[str, Path] = {"native_read_child": SERVICE_DIR / "native_read_child.py"}
    pending = ["native_read_child"]
    while pending:
        module = pending.pop()
        path = graph[module]
        package = module if path.name == "__init__.py" else (module.rsplit(".", 1)[0] if "." in module else module)
        for imported in _imported_modules(ast.parse(path.read_text(encoding="utf-8")), package):
            if imported.split(".")[0] not in child.FIRST_PARTY:
                continue
            parts = imported.split(".")
            for candidate in (child.VENDOR_DIR.joinpath(*parts).with_suffix(".py"), child.VENDOR_DIR.joinpath(*parts, "__init__.py")):
                if candidate.is_file() and imported not in graph:
                    graph[imported] = candidate
                    pending.append(imported)
    return graph


class StaticNoExecutionPathTest(unittest.TestCase):
    def test_the_graph_reaches_every_vendored_file(self) -> None:
        reached = {path.resolve() for path in reader_graph().values()}
        vendored = {path.resolve() for path in child.VENDOR_DIR.rglob("*.py") if "__pycache__" not in path.parts}
        self.assertEqual(vendored - reached, set(), "a vendored file the reader never imports should not be vendored")

    def test_no_process_socket_or_dynamic_import_call_in_the_reader_graph(self) -> None:
        found: list[str] = []
        for module, path in sorted(reader_graph().items()):
            found += violations(path.read_text(encoding="utf-8"), module, vendored=module != "native_read_child")
        self.assertEqual(found, [])

    def test_the_child_names_socket_and_subprocess_only_to_disarm_them(self) -> None:
        tree = ast.parse((SERVICE_DIR / "native_read_child.py").read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) and {alias.name for alias in node.names} & {"socket", "subprocess"}:
                enclosing = [
                    function.name for function in ast.walk(tree)
                    if isinstance(function, ast.FunctionDef) and any(inner is node for inner in ast.walk(function))
                ]
                self.assertEqual(enclosing, ["arm_guards"])

    def test_the_checker_finds_what_it_is_meant_to_find(self) -> None:
        # Positive control: each shape below must be reported, or the clean result above means nothing.
        samples = {
            "import subprocess\nsubprocess.run(['x'])\n": "subprocess.run",
            "from os import system\nsystem('x')\n": "os.system",
            "import os as o\no.execv('x', [])\n": "os.execv",
            "import socket\ns = socket.create_connection(('h', 1))\n": "socket.create_connection",
            "from urllib.request import urlopen\nurlopen('http://x')\n": "urllib.request.urlopen",
            "eval('1')\n": "eval",
            "__import__('subprocess')\n": "__import__",
            "import importlib\nimportlib.import_module('x')\n": "importlib.import_module",
            "from asyncio import create_subprocess_exec as c\nc('x')\n": "asyncio.create_subprocess_exec",
            "from . import models\nimport subprocess as s\ns.Popen(['x'])\n": "subprocess.Popen",
        }
        for source, call in samples.items():
            with self.subTest(source=source):
                found = violations(source, "akc_native_parsers.sample", vendored=False)
                self.assertTrue(any(item.endswith(f"calls {call}") for item in found), found)
        # And the import rule, for vendored code: a network module imported is reported even unused.
        self.assertTrue(violations("import socket\n", "akc_cir.sample", vendored=True))
        self.assertTrue(violations("from http import client\n", "akc_cir.sample", vendored=True))


# ----------------------------------------------------------------------------------------------
# The real conversion, on synthetic packages.


@NEEDS_READER
class ReadNativeSpreadsheetTest(unittest.TestCase):
    def test_s11_stale_cached_formula_keeps_source_and_cache_apart_and_computes_nothing(self) -> None:
        result = read_bytes(nf.xlsx([("Data", "visible", STALE_SHEET)]))
        self.assertEqual(result["native_read"], "available", result)
        cells = cells_by_address(result)
        stale = cells[(0, "B2")]
        self.assertEqual(stale["kind"], "formula")
        self.assertIsNone(stale["text"])
        # The file cached 5 for =A2+A2 with A2 = 1. The reader reports 5, unverified, and never 2.
        self.assertEqual(stale["formula"], {"source": "=A2+A2", "cachedValue": "5", "cachedValueState": "cached_unverified"})
        self.assertNotIn('"2"', json.dumps([cell for cell in cells.values() if cell["kind"] == "formula"]))
        self.assertEqual(cells[(0, "B3")]["formula"], {"source": "=A3*2", "cachedValue": None, "cachedValueState": "cached_missing"})
        self.assertEqual(result["workbookCalculation"], {"fullCalcOnLoad": False})
        self.assertFalse(result["coverage"]["formulasExecuted"])

    def test_s11_a_workbook_that_declares_its_cache_stale_is_reported_so(self) -> None:
        for attribute in ('fullCalcOnLoad="1"', 'fullCalcOnLoad="true"'):
            with self.subTest(attribute=attribute):
                result = read_bytes(nf.xlsx([("Data", "visible", STALE_SHEET)], calc_pr=f'<calcPr calcId="191029" {attribute}/>'))
                self.assertEqual(result["workbookCalculation"], {"fullCalcOnLoad": True})
                cells = cells_by_address(result)
                self.assertEqual(cells[(0, "B2")]["formula"]["cachedValueState"], "cached_declared_stale")
                self.assertEqual(cells[(0, "B3")]["formula"]["cachedValueState"], "cached_missing")

    def test_s11_the_stale_declaration_is_read_from_the_workbook_part_the_package_names(self) -> None:
        # The class: the calculation flag is found wherever the package puts the workbook part.
        payload = nf.xlsx([("Data", "visible", STALE_SHEET)], calc_pr='<calcPr fullCalcOnLoad="1"/>', workbook_name="book.xml")
        result = read_bytes(payload)
        self.assertEqual(result["native_read"], "available", result)
        self.assertEqual(result["workbookCalculation"], {"fullCalcOnLoad": True})

    def test_s11_a_calculation_flag_it_cannot_read_is_not_guessed(self) -> None:
        result = read_bytes(nf.xlsx([("Data", "visible", STALE_SHEET)], calc_pr='<calcPr fullCalcOnLoad="maybe"/>'))
        self.assertEqual(result["native_read"], "unavailable", result)
        self.assertIn(result["reason"], {"parser_refused", "reader_output_invalid"})

    def test_memory_exhausted_inside_the_parser_is_the_readers_failure_not_the_files(self) -> None:
        # The real parse_non_pdf_to_cir wraps every exception from a format parser in
        # XLSX_PARSE_FAILED; a MemoryError under the child's RLIMIT_AS must not read as a bad file.
        child.load_reader()
        parser_module = sys.modules["akc_native_parsers.parser"]

        def exhausted(_data: bytes, _builder: Any) -> str:
            raise MemoryError

        with patch.object(parser_module, "parse_xlsx", exhausted):
            result = read_bytes(nf.xlsx([("Data", "visible", STALE_SHEET)]))
        self.assertEqual(result, child.unavailable("reader_resource_limit", result["inputSha256"]))
        self.assertEqual(result["reasonClass"], "operational")

    def test_parser_output_missing_a_field_the_mapping_needs_is_refused_not_defaulted(self) -> None:
        reader = child.load_reader()
        real_parse = reader["parse"]
        for removed in ("sheets", "warnings", "locatorPageSemantics", "nativeParserVersion"):

            def stripped(*, removed: str = removed, **kwargs: Any) -> Any:
                document = real_parse(**kwargs)
                metadata = {key: val for key, val in document.metadata.items() if key != removed}
                return document.model_copy(update={"metadata": metadata})

            with self.subTest(removed=removed), patch.dict(reader, {"parse": stripped}):
                result = read_bytes(nf.xlsx([("Data", "visible", STALE_SHEET)]))
                self.assertEqual(result, child.unavailable("reader_output_invalid", result["inputSha256"]))

    def test_s11_hidden_sheets_are_read_and_marked_never_dropped(self) -> None:
        for state in ("hidden", "veryHidden"):
            with self.subTest(state=state):
                result = read_bytes(nf.xlsx([
                    ("Data", "visible", STALE_SHEET),
                    ("Secret", state, nf.sheet_xml(row(1, value("A1", "7")))),
                ]))
                self.assertEqual([(c["name"], c["state"]) for c in result["containers"]], [("Data", "visible"), ("Secret", state)])
                cells = cells_by_address(result)
                self.assertIn("hidden_sheet", cells[(1, "A1")]["qualityFlags"])
                self.assertEqual(cells[(1, "A1")]["text"], "7")
                self.assertNotIn("hidden_sheet", cells[(0, "A2")]["qualityFlags"])

    def test_s11_external_references_are_refused_or_left_unresolved_never_fetched(self) -> None:
        external_link = (
            b'<?xml version="1.0" encoding="UTF-8"?><externalLink xmlns="http://schemas.openxmlformats.org/'
            b'spreadsheetml/2006/main"><externalBook/></externalLink>'
        )
        external_rel = (
            '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
            'externalLinkPath" Target="file:///C:/finance/other.xlsx" TargetMode="External"/>'
        )
        cases = {
            "external link part": nf.xlsx([("Data", "visible", STALE_SHEET)], extra_members={"xl/externalLinks/externalLink1.xml": external_link}),
            "external relationship": nf.xlsx([("Data", "visible", STALE_SHEET)], workbook_rels_extra=external_rel),
            "network relationship": nf.xlsx([("Data", "visible", STALE_SHEET)], workbook_rels_extra=external_rel.replace(
                'Target="file:///C:/finance/other.xlsx" TargetMode="External"', 'Target="//server/share/other.xlsx"')),
        }
        for name, payload in cases.items():
            with self.subTest(case=name):
                result = read_bytes(payload)
                self.assertEqual(result["native_read"], "unavailable")
                self.assertEqual(result["reason"], "parser_refused")
                self.assertIn(result["parserCode"], {"OFFICE_EMBEDDED_OBJECT", "OFFICE_EXTERNAL_RELATION"})
                self.assertEqual(result["reasonClass"], "document")
        # A formula that names another workbook without carrying a link is kept as text: its
        # cached value is reported unverified and nothing is resolved.
        sheet = nf.sheet_xml(row(1, label("A1", "Linked"), formula("B1", "[1]Rates!A1", "4.5")))
        cell = cells_by_address(read_bytes(nf.xlsx([("Data", "visible", sheet)])))[(0, "B1")]
        self.assertEqual(cell["formula"], {"source": "=[1]Rates!A1", "cachedValue": "4.5", "cachedValueState": "cached_unverified"})

    def test_a_zip_bomb_shaped_workbook_is_refused_from_its_headers(self) -> None:
        base = nf.xlsx([("Data", "visible", STALE_SHEET)])
        ratio = nf.with_member(base, "xl/media/padding.bin", bytes(30 * 1024 * 1024))
        oversized = nf.with_member(nf.with_member(base, "xl/media/a.bin", bytes(40 * 1024 * 1024)), "xl/media/b.bin", bytes(40 * 1024 * 1024))
        member = nf.with_member(base, "xl/media/big.bin", bytes(65 * 1024 * 1024))
        for name, payload, code in (
            ("compression ratio", ratio, "ARCHIVE_RATIO_LIMIT"),
            ("total expansion", oversized, "ARCHIVE_SIZE_LIMIT"),
            ("one member", member, "ARCHIVE_MEMBER_LIMIT"),
        ):
            with self.subTest(case=name):
                self.assertLess(len(payload), FIVE_MIB)
                result = read_bytes(payload)
                self.assertEqual((result["reason"], result["parserCode"]), ("parser_refused", code))

    def test_500001_cells_on_one_sheet_are_refused_before_the_workbook_is_loaded(self) -> None:
        # 500 rows x 1,000 columns, then one more cell: the per-sheet bound is 500,000.
        from openpyxl.utils.cell import get_column_letter

        columns = [get_column_letter(index) for index in range(1, 1001)]
        rows = [f'<row r="{r}">' + "".join(f'<c r="{c}{r}"/>' for c in columns) + "</row>" for r in range(1, 501)]
        rows.append('<row r="501"><c r="A501"/></row>')
        payload = nf.xlsx([("Data", "visible", nf.sheet_xml("".join(rows)))])
        self.assertLess(len(payload), FIVE_MIB)
        result = read_bytes(payload)
        self.assertEqual((result["reason"], result["parserCode"]), ("parser_refused", "SHEET_CELL_LIMIT"))
        # The same bound reached by area rather than by count: one merged range over 501,000 cells.
        merged = nf.xlsx([("Data", "visible", nf.sheet_xml(row(1, value("A1", "1")), '<mergeCells count="1"><mergeCell ref="A1:ALL501"/></mergeCells>'))])
        result = read_bytes(merged)
        self.assertEqual((result["reason"], result["parserCode"]), ("parser_refused", "SHEET_CELL_LIMIT"))

    def test_macro_bearing_packages_are_refused(self) -> None:
        base = nf.xlsx([("Data", "visible", STALE_SHEET)])
        cases = {
            "vbaProject member": nf.with_member(base, "xl/vbaProject.bin", b"\xd0\xcf\x11\xe0 not a real project"),
            "macro-enabled content type": nf.xlsx(
                [("Data", "visible", STALE_SHEET)], content_type_override="application/vnd.ms-excel.sheet.macroEnabled.main+xml"),
        }
        for name, payload in cases.items():
            with self.subTest(case=name):
                result = read_bytes(payload)
                self.assertEqual((result["reason"], result["parserCode"]), ("parser_refused", "OFFICE_ACTIVE_CONTENT"))

    def test_member_names_that_leave_the_package_root_are_refused(self) -> None:
        base = nf.xlsx([("Data", "visible", STALE_SHEET)])
        for name in ("../evil.xml", "xl/../../evil.xml", "/evil.xml", "C:/evil.xml", "..\\evil.xml"):
            with self.subTest(member=name):
                result = read_bytes(nf.with_member(base, name, b"<x/>"))
                self.assertEqual((result["reason"], result["parserCode"]), ("parser_refused", "ARCHIVE_PATH_TRAVERSAL"))

    def test_cells_are_located_by_sheet_table_and_address_never_by_a_box(self) -> None:
        result = read_bytes(nf.xlsx([("Data", "visible", STALE_SHEET)]))
        table = result["tables"][0]
        self.assertEqual((table["tableIndex0"], table["containerIndex0"], table["range"]), (0, 0, "A1:B3"))
        for cell in table["cells"]:
            self.assertEqual(cell["location"]["nativeObjectId"], f"xlsx/sheet/0000/cell/{cell['location']['cellAddress']}")
            self.assertEqual(cell["location"]["tableIndex0"], 0)
        self.assertNotIn("bbox", json.dumps(result).casefold())
        self.assertEqual(result["reader"]["coreSha"], PINNED_CORE_SHA)

    def test_a_source_that_is_not_the_authenticated_bytes_is_refused(self) -> None:
        payload = nf.xlsx([("Data", "visible", STALE_SHEET)])
        result = read_bytes(payload, digest=nf.digest(payload + b"x"))
        self.assertEqual(result["reason"], "input_binding_mismatch")
        self.assertEqual(result["inputSha256"], nf.digest(payload + b"x"))


class ReadNativeFormatGateTest(unittest.TestCase):
    def test_formats_outside_the_reader_are_unsupported_without_loading_it(self) -> None:
        for mime in ("application/pdf", "text/csv", "text/html", "application/vnd.oasis.opendocument.spreadsheet"):
            with self.subTest(mime=mime):
                result = read_bytes(b"a,b\n1,2\n", mime=mime)
                self.assertEqual(result, child.unavailable("unsupported_format", nf.digest(b"a,b\n1,2\n")))


@NEEDS_READER
class ReadNativeDocumentTest(unittest.TestCase):
    def test_docx_table_cells_keep_their_body_locations_and_spans(self) -> None:
        result = read_bytes(nf.docx_with_table(), nf.DOCX_MIME)
        self.assertEqual((result["native_read"], result["documentType"], result["containerKind"]), ("available", "docx", "container_ordinal"))
        table = result["tables"][0]
        merged = [cell for cell in table["cells"] if cell["text"] == "Plus merged"]
        self.assertEqual([(cell["rowIndex0"], cell["columnIndex0"], cell["columnSpan"]) for cell in merged], [(2, 0, 2)])
        for cell in table["cells"]:
            self.assertIsNone(cell["location"]["cellAddress"])
            self.assertTrue(cell["location"]["nativeObjectId"].startswith(table["nativeObjectId"] + "/"))
        self.assertIsNone(result["workbookCalculation"])

    def test_pptx_table_cells_keep_their_slide(self) -> None:
        result = read_bytes(nf.pptx_with_table(), nf.PPTX_MIME)
        self.assertEqual((result["documentType"], result["containerKind"]), ("pptx", "slide"))
        table = result["tables"][0]
        self.assertEqual(table["containerIndex0"], 1)
        self.assertEqual([cell["text"] for cell in table["cells"]], ["Region", "Total", "North", "42"])
        self.assertNotIn("bbox", json.dumps(result).casefold())

    def test_the_reader_runs_with_its_guards_armed_and_without_the_skipped_modules(self) -> None:
        payloads = [
            (nf.xlsx([("Data", "visible", STALE_SHEET)]), nf.XLSX_MIME),
            (nf.docx_with_table(), nf.DOCX_MIME),
            (nf.pptx_with_table(), nf.PPTX_MIME),
        ]
        with tempfile.TemporaryDirectory() as directory:
            arguments: list[str] = []
            for index, (payload, mime) in enumerate(payloads):
                path = Path(directory) / f"source-{index}"
                path.write_bytes(payload)
                arguments += [str(path), mime, nf.digest(payload)]
            completed = subprocess.run(
                [sys.executable, "-B", str(Path(__file__).with_name("native_guarded_run.py")), str(SERVICE_DIR), *arguments],
                check=True, capture_output=True, timeout=120,
            )
        report = json.loads(completed.stdout)
        self.assertEqual(report["refused"], dict.fromkeys(report["refused"], True))
        self.assertEqual(report["loaded"], [])
        self.assertEqual([result["native_read"] for result in report["results"]], ["available"] * 3)


# ----------------------------------------------------------------------------------------------
# The parent: the child process, its exits and its output.


class ChildProcessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = Path(tempfile.mkdtemp(prefix="native-read-test-"))
        self.payload = nf.xlsx([("Data", "visible", STALE_SHEET)])
        self.digest = nf.digest(self.payload)
        self.source = self.directory / "source.xlsx"
        self.source.write_bytes(self.payload)

    def tearDown(self) -> None:
        shutil.rmtree(self.directory, ignore_errors=True)

    def read(self) -> dict[str, Any]:
        return native_reader.read(self.source, nf.XLSX_MIME, self.digest, FIVE_MIB, self.directory, app_module.office_process_environment(self.directory))

    def fake_child(self, body: str) -> Path:
        script = self.directory / "fake_child.py"
        script.write_text(body, encoding="utf-8")
        return script

    def test_the_real_child_reads_bounded_or_refuses_unbounded(self) -> None:
        result = self.read()
        if os.name != "posix":
            # No `resource` module: the child refuses rather than parse without kernel limits.
            self.assertEqual(result, child.unavailable("sandbox_unavailable", self.digest))
        elif MISSING:
            self.assertEqual(result, child.unavailable("reader_absent", self.digest))
        else:
            self.assertEqual(result["native_read"], "available", result)
            self.assertEqual(cells_by_address(result)[(0, "B2")]["formula"]["cachedValue"], "5")

    def test_a_child_past_the_wall_clock_is_a_timeout(self) -> None:
        script = self.fake_child("import time\ntime.sleep(30)\n")
        with patch.object(native_reader, "CHILD_PATH", script), patch.object(native_reader, "TIMEOUT_SECONDS", 0.5):
            self.assertEqual(self.read(), child.unavailable("reader_timeout", self.digest))

    def test_a_crashed_child_and_a_resource_exit_are_named_apart(self) -> None:
        for code, reason in ((1, "reader_crashed"), (child.EXIT_RESOURCE, "reader_resource_limit"), (2, "reader_crashed")):
            with self.subTest(code=code), patch.object(native_reader, "CHILD_PATH", self.fake_child(f"raise SystemExit({code})\n")):
                self.assertEqual(self.read(), child.unavailable(reason, self.digest))

    def test_a_child_that_exits_cleanly_without_output_is_not_a_read(self) -> None:
        with patch.object(native_reader, "CHILD_PATH", self.fake_child("pass\n")):
            self.assertEqual(self.read(), child.unavailable("reader_output_invalid", self.digest))

    def test_output_the_contract_does_not_name_is_refused(self) -> None:
        good = child.unavailable("parser_refused", self.digest, "SHEET_CELL_LIMIT")
        cases: dict[str, Any] = {
            "not json": b"{",
            "nan": json.dumps({**good, "inputSha256": float("nan")}).encode(),
            "another input": json.dumps({**good, "inputSha256": nf.digest(b"other")}).encode(),
            "extra key": json.dumps({**good, "note": "x"}).encode(),
            "missing key": json.dumps({k: v for k, v in good.items() if k != "reasonClass"}).encode(),
            "unknown reason": json.dumps({**good, "reason": "no_tables"}).encode(),
            "wrong class": json.dumps({**good, "reasonClass": "operational"}).encode(),
            "code without refusal": json.dumps({**child.unavailable("reader_crashed", self.digest), "parserCode": "X"}).encode(),
            "malformed code": json.dumps({**good, "parserCode": "a b"}).encode(),
            "available without tables": json.dumps({**good, "native_read": "available"}).encode(),
            "list": b"[]",
        }
        for name, raw in cases.items():
            with self.subTest(case=name):
                self.assertEqual(native_reader.qualify(raw, self.digest), child.unavailable("reader_output_invalid", self.digest))
        self.assertEqual(native_reader.qualify(json.dumps(good).encode(), self.digest), good)

    def test_an_oversized_output_file_is_refused_unread(self) -> None:
        script = self.fake_child(f"import sys\nopen(sys.argv[5], 'wb').write(b' ' * {child.MAX_NATIVE_READ_BYTES + 1})\n")
        with patch.object(native_reader, "CHILD_PATH", script):
            self.assertEqual(self.read(), child.unavailable("reader_output_invalid", self.digest))

    def test_an_oversized_result_is_written_as_output_limit(self) -> None:
        output = self.directory / "out.json"
        with patch.object(child, "MAX_NATIVE_READ_BYTES", 64):
            child.write_result({**child.unavailable("reader_crashed", self.digest), "pad": "x" * 100}, output)
        self.assertEqual(json.loads(output.read_bytes()), child.unavailable("output_limit", self.digest))

    def test_unsupported_formats_never_start_a_child(self) -> None:
        with patch.object(native_reader.subprocess, "run", side_effect=AssertionError("spawned")):
            result = native_reader.read(self.source, "text/csv", self.digest, FIVE_MIB, self.directory, {})
        self.assertEqual(result, child.unavailable("unsupported_format", self.digest))

    def test_child_argv_is_refused_when_malformed(self) -> None:
        output = str(self.directory / "out.json")
        for argv in (
            [str(self.source), nf.XLSX_MIME, "sha256:xyz", "100", output],
            [str(self.source), nf.XLSX_MIME, self.digest, "0", output],
            [str(self.source), nf.XLSX_MIME, self.digest, str(child.MAX_INPUT_BYTES_CEILING + 1), output],
            [str(self.source), nf.XLSX_MIME, self.digest, "100"],
        ):
            with self.subTest(argv=argv[2:]):
                self.assertEqual(child.main(argv), 2)

    def test_the_unavailable_builder_refuses_unknown_reasons_and_misplaced_codes(self) -> None:
        with self.assertRaises(ValueError):
            child.unavailable("no_tables", self.digest)
        with self.assertRaises(ValueError):
            child.unavailable("parser_refused", self.digest)
        with self.assertRaises(ValueError):
            child.unavailable("reader_crashed", self.digest, "X")


# ----------------------------------------------------------------------------------------------
# The app.

VOLATILE_HEADERS = {"etag", "last-modified"}  # FileResponse derives both from the temp file's stat


@contextmanager
def flagged_app(value: str | None) -> Iterator[Any]:
    environment = {} if value is None else {FLAG: value}
    try:
        with patch.dict(os.environ, environment):
            if value is None:
                os.environ.pop(FLAG, None)
            importlib.reload(app_module)
            yield app_module
    finally:
        importlib.reload(app_module)


def post(module: Any, path: str, payload: bytes, name: str, mime: str, headers: dict[str, str] | None = None) -> Any:
    secret = os.environ["TAVONEL_CDR_HMAC"]
    return TestClient(module.app, raise_server_exceptions=False).post(
        path,
        files={"source": (name, payload, mime)},
        headers=signed_headers(secret, digest_of(payload)) if headers is None else headers,
    )


# PDFium stamps the save time, to the second, into every sanitized PDF, and derives the file /ID
# from it; the scanner reports its own duration. These differ between any two calls with the flag
# off, so they are masked -- and the baseline is taken twice to show nothing else differs.
PDFIUM_STAMPS = re.compile(rb"/CreationDate\(D:[0-9]{14}[^)]{0,16}\)|/ID\s*\[\s*<[0-9A-Fa-f]{32}>\s*<[0-9A-Fa-f]{32}>\s*\]")


def pdf_path_output(module: Any, payload: bytes, name: str, mime: str) -> tuple[int, bytes, dict[str, Any]]:
    response = post(module, "/v1/disarm", payload, name, mime)
    headers: dict[str, Any] = {key: val for key, val in response.headers.items() if key not in VOLATILE_HEADERS}
    if "x-tavonel-malware-scan" in headers:
        scan = json.loads(headers["x-tavonel-malware-scan"])
        scan.pop("durationMs")
        headers["x-tavonel-malware-scan"] = scan
    if "x-tavonel-cdr-output-sha256" in headers:
        assert headers["x-tavonel-cdr-output-sha256"] == digest_of(response.content)
        headers["x-tavonel-cdr-output-sha256"] = "digest of the body"
    # No count is asserted: the pinned pypdfium2 may stamp differently from a developer's. The
    # caller's two flag-off baselines must still match, so an unmasked stamp fails loudly there.
    return response.status_code, PDFIUM_STAMPS.sub(b"/masked", response.content), headers


class AppWiringTest(unittest.TestCase):
    def test_the_flag_accepts_only_unset_zero_or_one(self) -> None:
        self.assertFalse(native_reader.native_read_enabled({}))
        self.assertFalse(native_reader.native_read_enabled({FLAG: "0"}))
        self.assertTrue(native_reader.native_read_enabled({FLAG: "1"}))
        for bad in ("true", "on", " 1", "2", "yes"):
            with self.subTest(value=bad), self.assertRaises(RuntimeError):
                native_reader.native_read_enabled({FLAG: bad})

    def test_a_flag_value_it_cannot_parse_refuses_the_boot(self) -> None:
        with self.assertRaises(RuntimeError), flagged_app("yes"):
            pass

    def test_the_deploy_definition_ships_it_off(self) -> None:
        service = (SERVICE_DIR / "service.yaml").read_text(encoding="utf-8")
        self.assertRegex(service, r'name: TAVONEL_CDR_NATIVE_READ\s*\n\s*value: "0"')

    def test_with_the_flag_off_nothing_is_registered_or_authenticated(self) -> None:
        for value in (None, "0"):
            with self.subTest(flag=value), flagged_app(value) as module:
                self.assertNotIn(native_reader.PATH, {getattr(route, "path", None) for route in module.app.routes})
                boundary = [m for m in module.app.user_middleware if m.cls is module.CdrRequestBoundary]
                self.assertEqual(boundary[0].kwargs["authenticated_paths"], AUTHENTICATED_PATHS)
                payload = nf.xlsx([("Data", "visible", STALE_SHEET)])
                unknown = post(module, "/v1/not-a-route", payload, "a.xlsx", nf.XLSX_MIME)
                native = post(module, native_reader.PATH, payload, "a.xlsx", nf.XLSX_MIME)
                self.assertEqual((native.status_code, native.content, dict(native.headers)), (unknown.status_code, unknown.content, dict(unknown.headers)))
                self.assertEqual(native.status_code, 404)

    def test_with_the_flag_on_the_route_is_authenticated_like_disarm(self) -> None:
        with flagged_app("1") as module:
            payload = nf.xlsx([("Data", "visible", STALE_SHEET)])
            self.assertEqual(post(module, native_reader.PATH, payload, "a.xlsx", nf.XLSX_MIME, headers={}).status_code, 401)
            # A macro-enabled extension never reaches the reader: it is not a qualified input.
            self.assertEqual(post(module, native_reader.PATH, payload, "a.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12").status_code, 422)

    def test_with_the_flag_on_every_answer_is_a_bound_native_read_document(self) -> None:
        workbook = nf.xlsx([("Data", "visible", STALE_SHEET)])
        cases = [
            ("a.xlsx", workbook, nf.XLSX_MIME, None),
            ("a.pdf", clean_pdf(), "application/pdf", "unsupported_format"),
            ("a.csv", b"a,b\n1,2\n", "text/csv", "unsupported_format"),
            ("a.xlsx", nf.with_member(workbook, "xl/vbaProject.bin", b"x"), nf.XLSX_MIME, "office_package_refused"),
        ]
        with flagged_app("1") as module:
            for name, payload, mime, reason in cases:
                with self.subTest(name=name, reason=reason):
                    response = post(module, native_reader.PATH, payload, name, mime)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.headers["cache-control"], "no-store")
                    self.assertEqual(response.headers["x-tavonel-input-sha256"], digest_of(payload))
                    self.assertEqual(response.headers["x-tavonel-native-read-sha256"], digest_of(response.content))
                    document = json.loads(response.content)
                    self.assertEqual(document["schema"], child.SCHEMA)
                    self.assertEqual(document["inputSha256"], digest_of(payload))
                    if reason is not None:
                        self.assertEqual(document, child.unavailable(reason, digest_of(payload)))
                    elif os.name != "posix":
                        self.assertEqual(document["reason"], "sandbox_unavailable")
                    elif MISSING:
                        self.assertEqual(document["reason"], "reader_absent")
                    else:
                        self.assertEqual(document["native_read"], "available")

    def test_the_pdf_path_is_byte_identical_with_the_reader_off_failing_or_absent(self) -> None:
        workbook = nf.xlsx([("Data", "visible", STALE_SHEET)])
        converted = clean_pdf()

        def fake_convert(source: Path, mime: str, work_dir: Path) -> Path:
            # LibreOffice is an image package; the same converted PDF stands in for it in every arm.
            if mime == "application/pdf":
                return source
            target = work_dir / "converted.pdf"
            target.write_bytes(converted)
            return target

        def outputs(module: Any) -> list[tuple[int, bytes, dict[str, Any]]]:
            with patch.object(module, "convert_to_pdf", fake_convert):
                return [
                    pdf_path_output(module, clean_pdf(), "a.pdf", "application/pdf"),
                    pdf_path_output(module, workbook, "a.xlsx", nf.XLSX_MIME),
                ]

        with flagged_app(None) as module:
            baseline = outputs(module)
            self.assertEqual(outputs(module), baseline)
        self.assertEqual([status for status, _body, _headers in baseline], [200, 200])

        scratch = Path(tempfile.mkdtemp())
        crash = scratch / "crash.py"
        crash.write_text("raise SystemExit(1)\n", encoding="utf-8")
        # The real child with no vendor/ beside it: the image without the reader's files.
        absent = scratch / "native_read_child.py"
        shutil.copyfile(SERVICE_DIR / "native_read_child.py", absent)
        arms = {
            "reader failing": (crash, "reader_crashed"),
            # Off POSIX the child refuses before it looks for the reader: no kernel limits there.
            "reader absent": (absent, "reader_absent" if os.name == "posix" else "sandbox_unavailable"),
        }
        try:
            for arm, (script, reason) in arms.items():
                with self.subTest(arm=arm), patch.object(native_reader, "CHILD_PATH", script), flagged_app("1") as module:
                    # The reader is asked first and fails; then the PDF path answers as before.
                    read = json.loads(post(module, native_reader.PATH, workbook, "a.xlsx", nf.XLSX_MIME).content)
                    self.assertEqual(read, child.unavailable(reason, digest_of(workbook)))
                    self.assertEqual(outputs(module), baseline)
        finally:
            shutil.rmtree(scratch, ignore_errors=True)


class ContractParityTest(unittest.TestCase):
    CONTRACT = SERVICE_DIR.parents[1] / "shared" / "nativeReadContract.ts"

    @unittest.skipUnless(CONTRACT.is_file(), "the shared contract lives in the repository, not in the image")
    def test_the_shared_contract_names_the_producer_schema_and_reasons(self) -> None:
        source = self.CONTRACT.read_text(encoding="utf-8")
        self.assertIn(f'NATIVE_READ_SCHEMA = "{child.SCHEMA}" as const', source)
        block = re.search(r"NATIVE_READ_REASON_CLASS = \{(.*?)\} as const", source, re.DOTALL)
        assert block is not None
        declared = dict(re.findall(r"^\s*([a-z_]+): \"(document|operational)\",$", block.group(1), re.MULTILINE))
        self.assertEqual(declared, child.REASON_CLASS)
        for key in child.AVAILABLE_KEYS:
            self.assertRegex(source, rf"\n  {key}: ", f"{key} is not in NativeReadAvailable")


if __name__ == "__main__":
    unittest.main()

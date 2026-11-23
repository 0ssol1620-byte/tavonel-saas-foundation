"""The native office cell reader, run as a one-shot child of `native_reader.py` (WO-E-TBL-1).

ADR-2026-11-18-structured-table-routes, route A: the Core native parser, vendored byte-identical
at a pinned Core SHA under `vendor/` (digest manifest `vendor/MANIFEST.json`), reads a DOCX, XLSX
or PPTX that has already been authenticated and malware-scanned, and this module turns its CIR
tables into `tavonel.native_read.v1` (`shared/nativeReadContract.ts`). It is a reader only: it
never computes a formula, follows a link or runs a macro, and it emits no bounding box -- a cell is
located by container (sheet, slide or body ordinal), table index and, in a workbook, cell address.

What it covers and what it does not:
- DOCX, XLSX and PPTX tables. Paragraph text, images and charts are not part of this document;
  the PDF raster + OCR path, which runs for every file regardless, still carries them.
- CSV is not read here: the Core parser does not accept it (`.docx .pptx .xlsx .html .htm .srt
  .vtt` only), so CSV stays on the PDF path. HTML, SRT and VTT are not routed to this reader.
- A formula keeps its source text and the value the file cached for it, never a value computed
  here. The cached value is always unverified; a workbook that declares `fullCalcOnLoad` says
  its own cache is stale, and a formula without a cached value says so.

The narrower import path (WO-E-TBL-0 condition 2). Importing `akc_native_parsers` runs its
`__init__`, which imports `pdf_parser` (pypdf), and the parser's `from akc_security import ...`
runs `akc_security/__init__`, which imports `pdf_secrets` (redis, cryptography) and
`preview_redaction` (PIL). Neither is called by the reader. `load_reader` registers those two
packages as bare package objects whose `__path__` is the vendored directory, so only the
submodules the reader needs execute -- unchanged -- and the four names `security.py` takes from
`akc_security` (`PLAN_LIMITS`, `PlanTier`, `safe_relative_path`, `validate_upload_bytes`) are set
from `akc_security.files`, which is where the real `__init__` imports them from. Nothing vendored
is edited; the skipped `__init__` files are not vendored at all.

The child's bounds, in the pattern of Core's `sandbox_runner.py:42-70` (the module itself is not
reused; it imports `akc_api`): kernel limits on address space, CPU, file size, open files and
process count, then Python-level refusal of sockets, name resolution and process creation. The
wall clock is the parent's. Where a limit cannot be set and read back, the child refuses
(`sandbox_unavailable`) rather than parse unbounded -- which is what happens on a developer's
Windows machine, where `resource` does not exist.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import types
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

SCHEMA: Final = "tavonel.native_read.v1"
VENDOR_DIR: Final = Path(__file__).resolve().parent / "vendor"
MANIFEST_NAME: Final = "MANIFEST.json"
MANIFEST_SCHEMA: Final = "tavonel.cdr_vendor_manifest.v1"

READER_MIMES: Final = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
}

# Every reason a read is unavailable, and which kind of failure it is. `document`: this file
# cannot be read natively and retrying will not change that. `operational`: the reader, its
# sandbox or its pinned code is the problem, not the file.
REASON_CLASS: Final = {
    "unsupported_format": "document",
    "office_package_refused": "document",
    "parser_refused": "document",
    "output_limit": "document",
    "reader_absent": "operational",
    "reader_integrity_failed": "operational",
    "sandbox_unavailable": "operational",
    "input_binding_mismatch": "operational",
    "reader_timeout": "operational",
    "reader_resource_limit": "operational",
    "reader_crashed": "operational",
    "reader_output_invalid": "operational",
}
UNAVAILABLE_KEYS: Final = frozenset({"schema", "native_read", "reason", "reasonClass", "parserCode", "inputSha256"})
AVAILABLE_KEYS: Final = UNAVAILABLE_KEYS | {
    "reader", "documentType", "containerKind", "containers", "workbookCalculation", "coverage", "tables", "warnings",
}

COVERAGE: Final = {
    "cells": "tables_only",
    "formats": ["docx", "pptx", "xlsx"],
    "formulasExecuted": False,
    "cachedValues": "reported_unverified",
    "externalReferences": "refused",
    "macros": "refused",
    "boundingBoxes": "not_emitted",
}

# Start values, not measurements (WO-E-TBL-1 records what was and was not measured).
MAX_NATIVE_READ_BYTES: Final = 16 * 1024 * 1024
CHILD_ADDRESS_SPACE_BYTES: Final = 2 * 1024 * 1024 * 1024
CHILD_CPU_SECONDS: Final = 30
CHILD_OPEN_FILES: Final = 64
# The CDR's own Office package bounds (`app.py` MAX_OFFICE_PACKAGE_*), tighter than the parser's.
PACKAGE_MAX_MEMBERS: Final = 500
PACKAGE_MAX_UNCOMPRESSED_BYTES: Final = 64 * 1024 * 1024
MAX_INPUT_BYTES_CEILING: Final = 50 * 1024 * 1024

EXIT_RESOURCE: Final = 3
DIGEST: Final = re.compile(r"sha256:[a-f0-9]{64}")
PARSER_CODE: Final = re.compile(r"[A-Z0-9_]{1,64}")
VENDORED_PATH: Final = re.compile(r"akc_(?:cir|security|native_parsers)/[a-z_]+\.py")
XLSX_CELL_ID: Final = re.compile(r"xlsx/sheet/([0-9]{4})/cell/([A-Z]{1,3}[1-9][0-9]{0,6})")
XLSX_RANGE_ID: Final = re.compile(r"xlsx/sheet/([0-9]{4})/range/([A-Z]{1,3}[1-9][0-9]{0,6}:[A-Z]{1,3}[1-9][0-9]{0,6})")
# The CIR ids derive from the source digest and native object ids, never from these. ParseContext
# requires them; none of them is emitted, so nothing here is stored as a fact about the document.
CONTEXT_TENANT: Final = "cdr-quarantine"
CONTEXT_CREATED_AT: Final = datetime(1970, 1, 1, tzinfo=UTC)


class ReaderUnavailable(Exception):
    def __init__(self, reason: str, parser_code: str | None = None) -> None:
        if reason not in REASON_CLASS:
            raise ValueError(f"unknown native read reason {reason!r}")
        super().__init__(reason)
        self.reason = reason
        self.parser_code = parser_code


class OutputInvalid(Exception):
    """The parser returned something this module cannot map without guessing."""


def unavailable(reason: str, input_sha256: str, parser_code: str | None = None) -> dict[str, Any]:
    if reason not in REASON_CLASS:
        raise ValueError(f"unknown native read reason {reason!r}")
    if (parser_code is None) != (reason != "parser_refused"):
        raise ValueError("parserCode is carried by parser_refused and only by it")
    return {
        "schema": SCHEMA,
        "native_read": "unavailable",
        "reason": reason,
        "reasonClass": REASON_CLASS[reason],
        "parserCode": parser_code,
        "inputSha256": input_sha256,
    }


def _sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def verify_vendor(vendor_dir: Path = VENDOR_DIR) -> tuple[dict[str, Any], str]:
    """Every vendored file present, byte-identical to the manifest, and nothing else beside them.

    A missing vendor directory or manifest is `reader_absent`; anything present but not what the
    manifest pins is `reader_integrity_failed`. Neither is ever read as "this file has no tables".
    `__pycache__` is ignored: the child runs with -B and the image copies `vendor/` root-owned.
    """
    manifest_path = vendor_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        raise ReaderUnavailable("reader_absent")
    raw = manifest_path.read_bytes()
    try:
        manifest = json.loads(raw)
        entries = manifest["files"]
        if (manifest["schema"] != MANIFEST_SCHEMA or not re.fullmatch(r"[0-9a-f]{40}", manifest["coreSha"])
                or not isinstance(entries, list) or not entries):
            raise ValueError("manifest header")
        pinned: dict[str, str] = {}
        for entry in entries:
            path, digest = entry["path"], entry["sha256"]
            if not isinstance(path, str) or not VENDORED_PATH.fullmatch(path) or path in pinned:
                raise ValueError("manifest path")
            if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
                raise ValueError("manifest digest")
            pinned[path] = digest
    except (ValueError, KeyError, TypeError) as exc:
        raise ReaderUnavailable("reader_integrity_failed") from exc
    present = {
        path.relative_to(vendor_dir).as_posix()
        for path in vendor_dir.rglob("*")
        if path.is_file() and "__pycache__" not in path.relative_to(vendor_dir).parts
    } - {MANIFEST_NAME, ".gitattributes"}
    if present != set(pinned):
        raise ReaderUnavailable("reader_integrity_failed")
    for path, digest in pinned.items():
        if _sha256((vendor_dir / path).read_bytes()) != digest:
            raise ReaderUnavailable("reader_integrity_failed")
    return manifest, _sha256(raw)


_LOADED: dict[str, Any] = {}
FIRST_PARTY: Final = ("akc_cir", "akc_security", "akc_native_parsers")
# What the vendored `akc_native_parsers/security.py` takes from `akc_security`; all four are
# defined in `akc_security/files.py` (tests/test_native_reader.py checks both against the source).
FACADE_NAMES: Final = ("PLAN_LIMITS", "PlanTier", "safe_relative_path", "validate_upload_bytes")


def load_reader(vendor_dir: Path = VENDOR_DIR) -> dict[str, Any]:
    """Verify the vendored files, then import the parser through the narrower path."""
    manifest, manifest_digest = verify_vendor(vendor_dir)
    root = str(vendor_dir.resolve())
    if _LOADED:
        if _LOADED["root"] != root:
            raise ReaderUnavailable("reader_integrity_failed")
        return _LOADED
    for name in FIRST_PARTY:
        # A first-party package already imported from anywhere else would be reused unverified.
        if name in sys.modules:
            raise ReaderUnavailable("reader_integrity_failed")
    sys.path.insert(0, root)
    for name in ("akc_security", "akc_native_parsers"):
        package = types.ModuleType(name)
        package.__path__ = [str(Path(root) / name)]
        sys.modules[name] = package
    try:
        from akc_security import files

        for attribute in FACADE_NAMES:
            setattr(sys.modules["akc_security"], attribute, getattr(files, attribute))
        from akc_native_parsers import models, parser
        from defusedxml import ElementTree as safe_element_tree
    except ImportError as exc:
        # A distribution the reader needs is not installed in this image. Undo the partial import
        # so the next attempt reports the same reason rather than a polluted module table.
        for name in tuple(sys.modules):
            if name.split(".")[0] in FIRST_PARTY:
                del sys.modules[name]
        sys.path.remove(root)
        raise ReaderUnavailable("reader_absent") from exc
    for name, module in tuple(sys.modules.items()):
        if name.split(".")[0] in FIRST_PARTY:
            origin = getattr(module, "__file__", None)
            if origin is not None and not Path(origin).resolve().is_relative_to(Path(root)):
                raise ReaderUnavailable("reader_integrity_failed")
    _LOADED.update(
        root=root,
        manifest=manifest,
        manifestSha256=manifest_digest,
        parse=parser.parse_non_pdf_to_cir,
        ParseContext=models.ParseContext,
        ParserLimits=models.ParserLimits,
        StructuredParseError=models.StructuredParseError,
        safe_element_tree=safe_element_tree,
    )
    return _LOADED


def _denied(*_args: object, **_kwargs: object) -> Any:
    raise PermissionError("native_reader_isolated")


def arm_guards() -> None:
    """Refuse network and process creation from here on, at the Python level.

    Runs after the imports: `ssl.SSLSocket` subclasses `socket.socket` at import time. A C
    extension calling the OS directly is not stopped by this; RLIMIT_NPROC stops process creation
    at the kernel, and network egress is the deployment's (`service.yaml` no-NAT VPC).
    """
    import socket
    import subprocess

    for name in ("socket", "create_connection", "create_server", "socketpair", "fromfd",
                 "getaddrinfo", "gethostbyname", "gethostbyname_ex", "gethostbyaddr"):
        if hasattr(socket, name):
            setattr(socket, name, _denied)
    for name in ("Popen", "run", "call", "check_call", "check_output", "getoutput", "getstatusoutput"):
        setattr(subprocess, name, _denied)
    for name in ("system", "popen", "fork", "forkpty", "execv", "execve", "execl", "execle", "execlp",
                 "execlpe", "execvp", "execvpe", "spawnl", "spawnle", "spawnlp", "spawnlpe", "spawnv",
                 "spawnve", "spawnvp", "spawnvpe", "posix_spawn", "posix_spawnp", "startfile", "kill", "killpg"):
        if hasattr(os, name):
            setattr(os, name, _denied)


def apply_rlimits(input_bytes: int) -> None:
    """Kernel bounds, each read back. Any limit that cannot be set refuses the read."""
    # sys.platform first: mypy reads it, so the `resource` calls below are checked as POSIX code.
    if sys.platform == "win32" or os.name != "posix":
        raise ReaderUnavailable("sandbox_unavailable")
    import resource

    file_bytes = input_bytes + MAX_NATIVE_READ_BYTES
    wanted = {
        "RLIMIT_AS": CHILD_ADDRESS_SPACE_BYTES,
        "RLIMIT_CPU": CHILD_CPU_SECONDS,
        "RLIMIT_FSIZE": file_bytes,
        "RLIMIT_NOFILE": CHILD_OPEN_FILES,
        "RLIMIT_NPROC": 0,
    }
    try:
        for name, value in wanted.items():
            kind = getattr(resource, name)
            _soft, hard = resource.getrlimit(kind)
            # Never above the hard limit the container already imposes; never above the wanted value.
            limit = value if hard == resource.RLIM_INFINITY else min(value, hard)
            resource.setrlimit(kind, (limit, limit))
            if resource.getrlimit(kind) != (limit, limit):
                raise ReaderUnavailable("sandbox_unavailable")
    except (AttributeError, ValueError, OSError) as exc:
        raise ReaderUnavailable("sandbox_unavailable") from exc
    os.umask(0o077)


def _workbook_declares_stale_cache(data: bytes, safe_element_tree: Any) -> bool:
    """`<calcPr fullCalcOnLoad="1">`: the workbook itself says its cached values must be recalculated."""
    import io
    import zipfile

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        # The workbook part is wherever the package relationship says, not always xl/workbook.xml.
        relationships = safe_element_tree.fromstring(archive.read("_rels/.rels"))
        targets = [
            str(element.attrib["Target"]).lstrip("/")
            for element in relationships.iter()
            if element.tag.rsplit("}", 1)[-1] == "Relationship"
            and str(element.attrib.get("Type", "")).endswith("/officeDocument")
        ]
        _require(len(targets) == 1, "workbook part")
        root = safe_element_tree.fromstring(archive.read(targets[0]))
    flags = [element.attrib.get("fullCalcOnLoad") for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "calcPr"]
    _require(len(flags) <= 1, "calcPr")
    # xsd:boolean; absent is the schema's default, false. Anything else is not guessed at.
    declared = flags[0] if flags else None
    if declared in (None, "0", "false"):
        return False
    _require(declared in ("1", "true"), "fullCalcOnLoad")
    return True


def _require(condition: bool, what: str) -> None:
    if not condition:
        raise OutputInvalid(what)


def to_native_read(document: Any, *, input_sha256: str, reader: dict[str, Any], stale_cache: bool | None) -> dict[str, Any]:
    """CIR tables -> `tavonel.native_read.v1`. Every field read is required; nothing is defaulted."""
    metadata = document.metadata
    document_type = metadata["documentType"]
    _require(document_type in {"docx", "xlsx", "pptx"}, "documentType")
    _require(document.source_sha256 == input_sha256, "source digest")
    container_kind = metadata["locatorPageSemantics"]
    _require(container_kind in {"sheet", "slide", "container_ordinal"}, "locatorPageSemantics")

    containers: list[dict[str, Any]] = []
    formulas: dict[tuple[int, str], dict[str, Any]] = {}
    sheet_state: dict[int, str] = {}
    if document_type == "xlsx":
        _require(stale_cache is not None, "workbook calculation")
        for sheet in metadata["sheets"]:
            index0, state = sheet["pageIndex0"], sheet["state"]
            _require(isinstance(index0, int) and state in {"visible", "hidden", "veryHidden"}, "sheet")
            sheet_state[index0] = state
            containers.append({
                "index0": index0,
                "name": sheet["name"],
                "state": state,
                "hiddenRows": list(sheet["hiddenRows"]),
                "hiddenColumns": list(sheet["hiddenColumns"]),
            })
            for formula in sheet["formulas"]:
                present = formula["cachedValuePresent"]
                _require(isinstance(present, bool) and present == (formula["cachedValue"] is not None), "formula cache")
                formulas[(index0, formula["cell"])] = formula

    tables: list[dict[str, Any]] = []
    for block in document.ordered_blocks():
        table = block.table
        if table is None:
            continue
        table_index0 = len(tables)
        table_ref = table.source_refs[0]
        container_index0 = table_ref.page_index0
        cell_range: str | None = None
        if document_type == "xlsx":
            match = XLSX_RANGE_ID.fullmatch(table_ref.native_object_id or "")
            if match is None or int(match.group(1)) != container_index0:
                raise OutputInvalid("xlsx range locator")
            cell_range = match.group(2)
            _require(container_index0 in sheet_state, "xlsx sheet")
        cells: list[dict[str, Any]] = []
        for cell in table.cells:
            cell_ref = cell.source_refs[0]
            _require(cell_ref.page_index0 == container_index0, "cell container")
            native_id = cell_ref.native_object_id
            _require(isinstance(native_id, str) and bool(native_id), "cell locator")
            flags = set(cell.quality_flags)
            address: str | None = None
            formula_out: dict[str, Any] | None = None
            if document_type == "xlsx":
                match = XLSX_CELL_ID.fullmatch(native_id)
                if match is None or int(match.group(1)) != container_index0:
                    raise OutputInvalid("xlsx cell locator")
                address = match.group(2)
                if sheet_state[container_index0] != "visible":
                    flags.add("hidden_sheet")
                if "formula_preserved_not_executed" in flags:
                    formula = formulas[(container_index0, address)]
                    _require(formula["formula"] == cell.raw_text, "formula source")
                    if not formula["cachedValuePresent"]:
                        state = "cached_missing"
                    elif stale_cache:
                        state = "cached_declared_stale"
                    else:
                        state = "cached_unverified"
                    formula_out = {"source": formula["formula"], "cachedValue": formula["cachedValue"], "cachedValueState": state}
            else:
                _require("formula_preserved_not_executed" not in flags, "formula outside a workbook")
            cells.append({
                "cellId": cell.id,
                "rowIndex0": cell.row_index0,
                "columnIndex0": cell.column_index0,
                "rowSpan": cell.row_span,
                "columnSpan": cell.column_span,
                "kind": "formula" if formula_out is not None else "value",
                # A formula cell has no plain value: its source and cache are in `formula`.
                "text": None if formula_out is not None else cell.raw_text,
                "formula": formula_out,
                "location": {
                    "containerIndex0": container_index0,
                    "tableIndex0": table_index0,
                    "nativeObjectId": native_id,
                    "cellAddress": address,
                },
                "qualityFlags": sorted(flags),
            })
        tables.append({
            "tableIndex0": table_index0,
            "tableId": table.id,
            "containerIndex0": container_index0,
            "nativeObjectId": table_ref.native_object_id,
            "range": cell_range,
            "rowCount": table.row_count,
            "columnCount": table.column_count,
            "headerRowCount": table.header_row_count,
            "qualityFlags": sorted(set(table.quality_flags)),
            "cells": cells,
        })
    warnings = metadata["warnings"]
    _require(isinstance(warnings, list) and all(isinstance(item, str) for item in warnings), "warnings")
    return {
        "schema": SCHEMA,
        "native_read": "available",
        "reason": None,
        "reasonClass": None,
        "parserCode": None,
        "inputSha256": input_sha256,
        "reader": {
            "parser": "akc_native_parsers",
            "parserVersion": metadata["nativeParserVersion"],
            "coreSha": reader["manifest"]["coreSha"],
            "vendorManifestSha256": reader["manifestSha256"],
        },
        "documentType": document_type,
        "containerKind": container_kind,
        "containers": containers,
        "workbookCalculation": {"fullCalcOnLoad": stale_cache} if document_type == "xlsx" else None,
        "coverage": COVERAGE,
        "tables": tables,
        "warnings": sorted(warnings),
    }


def read_native(source: Path, mime: str, input_sha256: str, input_bytes: int, *, vendor_dir: Path = VENDOR_DIR) -> dict[str, Any]:
    """Read one authenticated, scanned source. A refusal is a document, never an exception."""
    try:
        extension = READER_MIMES.get(mime)
        if extension is None:
            raise ReaderUnavailable("unsupported_format")
        reader = load_reader(vendor_dir)
        data = source.read_bytes()
        if len(data) > input_bytes or _sha256(data) != input_sha256:
            raise ReaderUnavailable("input_binding_mismatch")
        limits = reader["ParserLimits"](
            max_input_bytes=input_bytes,
            max_archive_entries=PACKAGE_MAX_MEMBERS,
            max_archive_uncompressed_bytes=PACKAGE_MAX_UNCOMPRESSED_BYTES,
            max_archive_member_bytes=PACKAGE_MAX_UNCOMPRESSED_BYTES,
        )
        digest_hex = input_sha256.removeprefix("sha256:")
        context = reader["ParseContext"](
            tenant_id=CONTEXT_TENANT,
            document_id=f"src-{digest_hex}",
            document_version_id=f"src-{digest_hex}",
            created_at=CONTEXT_CREATED_AT,
        )
        try:
            document = reader["parse"](
                # The parser keys on the extension; the caller's file name never reaches it.
                filename=f"source{extension}", declared_mime=mime, data=data, context=context, limits=limits,
            )
        except reader["StructuredParseError"] as exc:
            # The parser wraps *any* exception in a format's `*_PARSE_FAILED` code, MemoryError
            # included. Exhausting the child's limits is this reader's failure, not the file's.
            cause: BaseException | None = exc
            for _depth in range(32):  # a chain can be made cyclic by hand; never loop on one
                if cause is None:
                    break
                if isinstance(cause, (MemoryError, RecursionError)):
                    raise ReaderUnavailable("reader_resource_limit") from exc
                cause = cause.__cause__ or cause.__context__
            # Core's codes are upper-case identifiers; one that is not is named as such, not echoed.
            code = exc.code if isinstance(exc.code, str) and PARSER_CODE.fullmatch(exc.code) else "UNRECOGNISED_PARSER_CODE"
            raise ReaderUnavailable("parser_refused", code) from exc
        try:
            stale = _workbook_declares_stale_cache(data, reader["safe_element_tree"]) if extension == ".xlsx" else None
            return to_native_read(document, input_sha256=input_sha256, reader=reader, stale_cache=stale)
        except (KeyError, TypeError, AttributeError, IndexError) as exc:
            # A field the mapping needs is absent or of the wrong type: nothing is defaulted.
            raise OutputInvalid(type(exc).__name__) from exc
    except ReaderUnavailable as exc:
        return unavailable(exc.reason, input_sha256, exc.parser_code)
    except OutputInvalid:
        return unavailable("reader_output_invalid", input_sha256)


def write_result(result: dict[str, Any], output: Path) -> None:
    body = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(body) > MAX_NATIVE_READ_BYTES:
        body = json.dumps(unavailable("output_limit", result["inputSha256"]), sort_keys=True, separators=(",", ":")).encode("utf-8")
    output.write_bytes(body)


def main(argv: list[str]) -> int:
    """argv: source path, MIME, input digest, input byte bound, output path. All set by the parent."""
    if len(argv) != 5:
        return 2
    source, mime, input_sha256, raw_bytes, output = argv
    if not DIGEST.fullmatch(input_sha256) or not re.fullmatch(r"[1-9][0-9]{0,9}", raw_bytes):
        return 2
    input_bytes = int(raw_bytes)
    if input_bytes > MAX_INPUT_BYTES_CEILING:
        return 2
    try:
        try:
            apply_rlimits(input_bytes)
            if mime in READER_MIMES:
                load_reader()
            arm_guards()
            result = read_native(Path(source), mime, input_sha256, input_bytes)
        except ReaderUnavailable as exc:
            result = unavailable(exc.reason, input_sha256, exc.parser_code)
        write_result(result, Path(output))
    except (MemoryError, RecursionError):
        return EXIT_RESOURCE
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Run the native office cell reader in a bounded child and check what it returns (WO-E-TBL-1).

Flag-held: `TAVONEL_CDR_NATIVE_READ` unset or "0" is off, "1" is on, anything else refuses the
boot. It is read once, at boot: with it off, `app.py` registers no route and authenticates no new
path, so the service answers exactly as before. With it on, `POST /v1/native-read` returns
`tavonel.native_read.v1` for a DOCX, XLSX or PPTX; `/v1/disarm` -- the PDF path -- is untouched
either way and never waits on, reads or depends on this reader.

Every failure is a document with `native_read: "unavailable"` and a reason from a closed set,
never an empty table list: an absent reader, a vendored file that does not match its pin, a
sandbox that cannot be bounded, a timeout, a crash and an unreadable result are all named.

The child (`native_read_child.py`) runs as `python -I -B`: no PYTHON* environment, no user site,
no script directory on the path, no bytecode written. Its environment is the one `app.py` gives
LibreOffice (process basics only, no credentials), its working directory is the request's own
temporary directory, and stdin/stdout/stderr are closed -- a traceback can carry document text,
so nothing the child prints is kept. The wall clock is enforced here; the child sets its own
kernel limits (see that module).
"""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Final

import native_read_child as child

FLAG_ENV: Final = "TAVONEL_CDR_NATIVE_READ"
PATH: Final = "/v1/native-read"
CHILD_PATH: Final = Path(child.__file__).resolve()
# Start value. CPU is bounded at child.CHILD_CPU_SECONDS by the kernel; this bounds the rest
# (blocked I/O, a stalled import) and stays well inside service.yaml's 120 s request timeout.
TIMEOUT_SECONDS: Final = 40.0
OUTPUT_NAME: Final = "native-read.json"

logger = logging.getLogger("tavonel.cdr.native_read")


def native_read_enabled(env: Mapping[str, str] | None = None) -> bool:
    """The flag. Unset or "0" is off, "1" is on, anything else refuses to boot."""
    value = (os.environ if env is None else env).get(FLAG_ENV, "")
    if value in ("", "0"):
        return False
    if value == "1":
        return True
    raise RuntimeError(f"{FLAG_ENV} must be unset, '0' or '1'")


def boot_state() -> str:
    """Verify the vendored files once at boot, so a broken pin is in the log before a request.

    Not a gate on the PDF path: the service still boots, and every native read then says why it is
    unavailable. The child verifies the same files again before it imports them.
    """
    try:
        child.verify_vendor()
    except child.ReaderUnavailable as exc:
        logger.error("native reader unavailable at boot reason=%s", exc.reason)
        return exc.reason
    return "ready"


def _resource_signals() -> set[int]:
    names = ("SIGXCPU", "SIGXFSZ", "SIGKILL")
    return {-int(getattr(signal, name)) for name in names if hasattr(signal, name)}


def qualify(raw: bytes, input_sha256: str) -> dict[str, Any]:
    """The child's result, accepted only in the exact shape the contract names."""

    def reject(_constant: str) -> Any:
        raise ValueError("non-finite number")

    try:
        result = json.loads(raw, parse_constant=reject)
    except (ValueError, UnicodeDecodeError):
        return child.unavailable("reader_output_invalid", input_sha256)
    if (not isinstance(result, dict) or result.get("schema") != child.SCHEMA
            or result.get("inputSha256") != input_sha256):
        return child.unavailable("reader_output_invalid", input_sha256)
    state = result.get("native_read")
    if state == "unavailable":
        reason, code = result.get("reason"), result.get("parserCode")
        if (set(result) != child.UNAVAILABLE_KEYS or reason not in child.REASON_CLASS
                or result.get("reasonClass") != child.REASON_CLASS[reason]
                or (reason == "parser_refused") != isinstance(code, str)
                or (isinstance(code, str) and not child.PARSER_CODE.fullmatch(code))):
            return child.unavailable("reader_output_invalid", input_sha256)
        return result
    if (state != "available" or set(result) != child.AVAILABLE_KEYS
            or any(result[key] is not None for key in ("reason", "reasonClass", "parserCode"))
            or not isinstance(result["tables"], list)):
        return child.unavailable("reader_output_invalid", input_sha256)
    return result


def read(source: Path, mime: str, input_sha256: str, input_bytes: int, work_dir: Path, env: Mapping[str, str]) -> dict[str, Any]:
    """Read one authenticated, scanned source in a one-shot child. Never raises for the document."""
    if mime not in child.READER_MIMES:
        return child.unavailable("unsupported_format", input_sha256)
    output = work_dir / OUTPUT_NAME
    command = [sys.executable, "-I", "-B", str(CHILD_PATH), str(source), mime, input_sha256, str(input_bytes), str(output)]
    try:
        completed = subprocess.run(
            command, check=False, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=TIMEOUT_SECONDS, env=dict(env), cwd=work_dir,
        )
    except subprocess.TimeoutExpired:
        logger.warning("native read unavailable reason=reader_timeout")
        return child.unavailable("reader_timeout", input_sha256)
    except OSError:
        logger.warning("native read unavailable reason=reader_crashed spawn_failed")
        return child.unavailable("reader_crashed", input_sha256)
    returncode = completed.returncode
    if returncode != 0:
        reason = "reader_resource_limit" if returncode == child.EXIT_RESOURCE or returncode in _resource_signals() else "reader_crashed"
        logger.warning("native read unavailable reason=%s returncode=%s", reason, returncode)
        return child.unavailable(reason, input_sha256)
    try:
        size = output.stat().st_size
        if size > child.MAX_NATIVE_READ_BYTES:
            raise ValueError("oversized")
        raw = output.read_bytes()
    except (OSError, ValueError):
        logger.warning("native read unavailable reason=reader_output_invalid")
        return child.unavailable("reader_output_invalid", input_sha256)
    return qualify(raw, input_sha256)

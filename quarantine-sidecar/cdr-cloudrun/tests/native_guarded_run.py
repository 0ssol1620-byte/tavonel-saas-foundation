"""Run by test_native_reader.py in a fresh interpreter: the reader with its Python guards armed.

argv: service directory, then (path, MIME, digest) triples. Prints one JSON object. Kernel limits
are not applied here (they need a POSIX kernel and are covered by the `native_reader.read` tests
there); this run shows the parse completes with sockets, name resolution and process creation
refused, and that the network and crypto modules the full Core packages would drag in are absent.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
import native_read_child as child

child.load_reader()
child.arm_guards()


def refused(call) -> bool:  # type: ignore[no-untyped-def]
    try:
        call()
    except PermissionError:
        return True
    return False


report = {
    "refused": {
        "socket.socket": refused(lambda: socket.socket()),
        "socket.create_connection": refused(lambda: socket.create_connection(("192.0.2.1", 80), timeout=1)),
        "socket.getaddrinfo": refused(lambda: socket.getaddrinfo("example.invalid", 80)),
        "subprocess.run": refused(lambda: subprocess.run([sys.executable, "-c", "pass"], check=False)),
        "subprocess.Popen": refused(lambda: subprocess.Popen([sys.executable, "-c", "pass"])),
        "os.system": refused(lambda: os.system("exit 0")),
    },
    "loaded": sorted(
        name for name in ("redis", "cryptography", "pypdf", "akc_security.pdf_secrets", "akc_security.preview_redaction",
                          "akc_native_parsers.pdf_parser")
        if name in sys.modules
    ),
    "results": [],
}
arguments = sys.argv[2:]
for index in range(0, len(arguments), 3):
    path, mime, digest = arguments[index:index + 3]
    report["results"].append(child.read_native(Path(path), mime, digest, 5 * 1024 * 1024))
print(json.dumps(report))

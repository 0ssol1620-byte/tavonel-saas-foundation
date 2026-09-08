"""In-process clamd stand-in: a real TCP server speaking the INSTREAM subset.

Not a mock of the adapter — the adapter opens a real socket and speaks the real
protocol against this. The container tests in
`.github/workflows/malware-scan-qualification.yml` run the same assertions
against a real `clamd`.
"""

from __future__ import annotations

import socket
import struct
import threading
from types import TracebackType

EICAR = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
VERSION_REPLY = b"ClamAV 1.5.4/27812/Fri Sep  5 08:03:11 2026"


class _Framed:
    """Buffered reader for clamd's NUL-terminated commands and length-prefixed chunks."""

    def __init__(self, connection: socket.socket) -> None:
        self._connection = connection
        self._buffer = b""

    def _fill(self) -> None:
        chunk = self._connection.recv(65536)
        if not chunk:
            raise ConnectionError("clamd stub client closed the connection")
        self._buffer += chunk

    def command(self) -> bytes:
        while b"\0" not in self._buffer:
            self._fill()
        command, _, self._buffer = self._buffer.partition(b"\0")
        return command.lstrip(b"z")

    def exactly(self, count: int) -> bytes:
        while len(self._buffer) < count:
            self._fill()
        payload, self._buffer = self._buffer[:count], self._buffer[count:]
        return payload

    def instream(self) -> bytes:
        payload = b""
        while True:
            size = struct.unpack("!I", self.exactly(4))[0]
            if size == 0:
                return payload
            payload += self.exactly(size)


class FakeClamd:
    """Modes: clean · found · error · garbage · hang · version_garbage."""

    def __init__(self, mode: str = "clean", signature: str = "Win.Test.EICAR_HDB-1") -> None:
        self.mode = mode
        self.signature = signature
        self.scanned_bytes: int | None = None
        self._stop = threading.Event()
        self._server = socket.socket()
        self._server.bind(("127.0.0.1", 0))
        self._server.listen(8)
        self.host, self.port = self._server.getsockname()
        self._thread = threading.Thread(target=self._serve, daemon=True)

    def start(self) -> FakeClamd:
        """Serve until the process exits — for a suite that needs a scanner for its whole run."""

        self._thread.start()
        return self

    def __enter__(self) -> FakeClamd:
        return self.start()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self._stop.set()
        self._server.close()
        self._thread.join(timeout=5)

    def env(self, **extra: str) -> dict[str, str]:
        """Environment that points the adapter at this stub."""

        return {"CLAMD_HOST": self.host, "CLAMD_PORT": str(self.port), "CLAMD_SOCKET": "", **extra}

    def _serve(self) -> None:
        while not self._stop.is_set():
            try:
                connection, _ = self._server.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(connection,), daemon=True).start()

    def _handle(self, connection: socket.socket) -> None:
        with connection:
            connection.settimeout(10)
            try:
                reader = _Framed(connection)
                command = reader.command()
                if command == b"PING":
                    connection.sendall(b"PONG\0")
                    return
                if command == b"VERSION":
                    if self.mode == "version_garbage":
                        connection.sendall(b"\xff\xfe not a version\0")
                        return
                    connection.sendall(VERSION_REPLY + b"\0")
                    return
                if command != b"INSTREAM":
                    connection.sendall(b"UNKNOWN COMMAND\0")
                    return
                self.scanned_bytes = len(reader.instream())
                if self.mode == "hang":
                    self._stop.wait(30)  # Accept every byte, then never answer.
                    return
                if self.mode == "found":
                    connection.sendall(f"stream: {self.signature} FOUND\0".encode())
                    return
                if self.mode == "error":
                    connection.sendall(b"stream: INSTREAM size limit exceeded. ERROR\0")
                    return
                if self.mode == "garbage":
                    connection.sendall(b"\xff\xfe\xfd\0")
                    return
                connection.sendall(b"stream: OK\0")
            except (OSError, ConnectionError, struct.error):
                return

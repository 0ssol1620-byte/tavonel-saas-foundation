"""Large-source bytes: /v1/disarm-remote reads the source from a presigned GET (ADR-0006, "Large-source bytes")."""

from __future__ import annotations

import hashlib
import io
import os
import secrets
import sys
import tempfile
import threading
import unittest
import urllib.error
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Self
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("TAVONEL_CDR_HMAC", "fixture-cdr-hmac-secret-that-is-long-enough-123")

from clamd_stub import FakeClamd  # noqa: E402

for _name, _value in FakeClamd("clean").start().env().items():
    os.environ.setdefault(_name, _value)

import app as cdr  # noqa: E402
from cdr_fixtures import clean_pdf  # noqa: E402
from test_page_ranges import blank_pdf, ranged  # noqa: E402

SECRET = "fixture-cdr-hmac-secret-that-is-long-enough-123"
PREFIX = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/tavonel-saas-foundation-quarantine/quarantine/"
QUERY = ("X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=key%2F20261110%2Fauto%2Fs3%2Faws4_request"
         "&X-Amz-Date=20261110T000000Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&X-Amz-Signature=" + "a" * 64)
URL = f"{PREFIX}ws_pilot/doc_1/source?{QUERY}"
MIB = 1024 * 1024


def sha(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


class _Response(io.BytesIO):
    def __init__(self, body: bytes, declared: str | None) -> None:
        super().__init__(body)
        self.headers = {} if declared is None else {"content-length": declared}


class _Endless:
    """A store answer that never ends, generated lazily: what an undeclared oversize object looks like."""

    def __init__(self) -> None:
        self.headers: dict[str, str] = {}

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self, size: int) -> bytes:
        return b"\0" * size


class FakeStore:
    """Stands in for the opener: records every URL it is asked for and answers with `answer`."""

    def __init__(self, answer: object) -> None:
        self.answer = answer
        self.opened: list[tuple[str, float]] = []

    def open(self, url: str, timeout: float) -> object:
        self.opened.append((url, timeout))
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def store_of(body: bytes, declared: str | None = "auto") -> FakeStore:
    return FakeStore(_Response(body, str(len(body)) if declared == "auto" else declared))


def post_remote(digest: str, request_id: str | None = None, url: str = URL, *, signed: bool = True):
    request_id = request_id or secrets.token_hex(12)
    timestamp = datetime.now(UTC).isoformat()
    headers = {
        "x-tavonel-input-sha256": digest,
        "x-tavonel-cdr-timestamp": timestamp,
        "x-tavonel-cdr-request-id": request_id,
        "x-tavonel-cdr-signature": cdr.cdr_request_signature(SECRET if signed else "x" * 40, timestamp, request_id, digest),
    }
    # (None, value) parts: a multipart body of plain fields, which is what the worker's FormData sends.
    fields = {"source_url": (None, url), "filename": (None, "manual.pdf"), "content_type": (None, "application/pdf")}
    return TestClient(cdr.app, raise_server_exceptions=False).post("/v1/disarm-remote", headers=headers, files=fields)


def post_upload(source: bytes):
    request_id = secrets.token_hex(12)
    timestamp = datetime.now(UTC).isoformat()
    digest = sha(source)
    headers = {
        "x-tavonel-input-sha256": digest,
        "x-tavonel-cdr-timestamp": timestamp,
        "x-tavonel-cdr-request-id": request_id,
        "x-tavonel-cdr-signature": cdr.cdr_request_signature(SECRET, timestamp, request_id, digest),
    }
    return TestClient(cdr.app, raise_server_exceptions=False).post(
        "/v1/disarm", headers=headers, files={"source": ("manual.pdf", source, "application/pdf")},
    )


class RemoteSourceTest(unittest.TestCase):
    def setUp(self) -> None:
        enabled = patch.object(cdr, "REMOTE_SOURCE_PREFIX", PREFIX)
        enabled.start()
        self.addCleanup(enabled.stop)

    def serve(self, store: FakeStore) -> FakeStore:
        replaced = patch.object(cdr, "REMOTE_SOURCE_OPENER", store)
        replaced.start()
        self.addCleanup(replaced.stop)
        return store

    def test_is_off_unless_the_prefix_is_configured(self) -> None:
        store = self.serve(store_of(clean_pdf()))
        with patch.object(cdr, "REMOTE_SOURCE_PREFIX", None):
            response = post_remote(sha(clean_pdf()))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "CDR remote source is disabled")
        self.assertEqual(response.headers[cdr.REMOTE_SOURCE_HEADER], "1")
        self.assertEqual(store.opened, [])
        self.assertIsNone(cdr.read_remote_source_prefix({}))
        self.assertNotIn("remoteSourceMaxBytes", TestClient(cdr.app).get("/health").text)

    def test_a_prefix_that_is_not_one_bucket_quarantine_prefix_refuses_the_boot(self) -> None:
        self.assertEqual(cdr.read_remote_source_prefix({cdr.REMOTE_SOURCE_PREFIX_ENV: f" {PREFIX} "}), PREFIX)
        for value in [
            PREFIX.replace("https://", "http://"), PREFIX[:-len("quarantine/")], PREFIX + "ws/",
            PREFIX.replace(".com/", ".com:8443/"), PREFIX + "?x=1", "https://user@host/bucket/quarantine/",
        ]:
            with self.assertRaises(RuntimeError, msg=value):
                cdr.read_remote_source_prefix({cdr.REMOTE_SOURCE_PREFIX_ENV: value})

    def test_reads_the_presigned_object_once_and_disarms_it(self) -> None:
        source = clean_pdf()
        store = self.serve(store_of(source))
        response = post_remote(sha(source))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["x-tavonel-input-sha256"], sha(source))
        self.assertEqual(response.headers["x-tavonel-cdr-output-sha256"], sha(response.content))
        self.assertEqual(store.opened, [(URL, cdr.REMOTE_SOURCE_SOCKET_SECONDS)])

    def test_admits_a_50_mib_source_the_upload_route_still_refuses(self) -> None:
        source = clean_pdf(pad_to_bytes=cdr.LARGE_SOURCE_MAX_INPUT_BYTES)
        self.assertEqual(len(source), 50 * MIB)
        self.serve(store_of(source))
        response = post_remote(sha(source))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["x-tavonel-input-sha256"], sha(source))
        # The upload route is unchanged: its bound is still the stage's 5 MiB, and its refusals
        # carry no remote-source marker.
        refused = post_upload(source)
        self.assertEqual(refused.status_code, 413)
        self.assertNotIn(cdr.REMOTE_SOURCE_HEADER, refused.headers)

    def test_refuses_a_declared_source_over_50_mib_before_reading_it(self) -> None:
        store = self.serve(FakeStore(_Endless()))
        store.answer.headers = {"content-length": str(cdr.LARGE_SOURCE_MAX_INPUT_BYTES + 1)}  # type: ignore[attr-defined]
        response = post_remote(sha(b"x"))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"], "CDR source exceeds the controlled-beta size limit")
        self.assertEqual(response.headers[cdr.REMOTE_SOURCE_HEADER], "1")

    def test_refuses_an_undeclared_source_once_it_passes_50_mib(self) -> None:
        self.serve(FakeStore(_Endless()))
        response = post_remote(sha(b"x"))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"], "CDR source exceeds the controlled-beta size limit")

    def test_refuses_bytes_that_do_not_hash_to_the_signed_digest(self) -> None:
        self.serve(store_of(clean_pdf()))
        response = post_remote(sha(b"the bytes the worker hashed"))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "CDR source digest does not match the uploaded body")
        self.assertEqual(response.headers[cdr.REMOTE_SOURCE_HEADER], "1")

    def test_never_opens_a_url_outside_the_one_quarantine_prefix(self) -> None:
        store = self.serve(store_of(clean_pdf()))
        for url in [
            URL.replace("https://", "http://"),
            URL.replace("0123456789abcdef", "attacker0000000a", 1),
            URL.replace("quarantine/ws_pilot/doc_1/source", "immutable/ws_pilot/doc_1/source"),
            URL.replace("ws_pilot/doc_1/source", "ws_pilot/../doc_1/source"),
            URL.replace("ws_pilot/doc_1/source", "ws_pilot/doc_1/cdr-reject.json"),
            URL.replace("ws_pilot/doc_1/source", "ws_pilot/doc_1%2Fx/source"),
            URL.replace("X-Amz-Expires=300", "X-Amz-Expires=604800"),
            URL.replace("&X-Amz-SignedHeaders=host", ""),
            URL + "&acl=",
            URL + "#fragment",
            URL.split("?")[0],
        ]:
            response = post_remote(sha(clean_pdf()), url=url)
            self.assertEqual(response.status_code, 503, url)
            self.assertEqual(response.json()["detail"], "CDR remote source is not qualified", url)
        self.assertEqual(store.opened, [])

    def test_a_store_failure_is_infrastructure_never_a_verdict(self) -> None:
        source = clean_pdf()
        for answer in [
            urllib.error.HTTPError(URL, 403, "Forbidden", {}, None),  # type: ignore[arg-type]
            urllib.error.URLError("unreachable"),
            TimeoutError("timed out"),
            _Response(source, str(len(source) + 10)),  # cut short of what the store declared
        ]:
            self.serve(FakeStore(answer))
            response = post_remote(sha(source))
            self.assertEqual(response.status_code, 502, repr(answer))
            self.assertNotIn("X-Amz-Signature", response.text)

    def test_unsigned_requests_never_reach_the_store(self) -> None:
        store = self.serve(store_of(clean_pdf()))
        response = post_remote(sha(clean_pdf()), signed=False)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(store.opened, [])

    def test_a_ranged_request_reads_the_source_and_renders_its_range(self) -> None:
        source = blank_pdf(200)
        self.serve(store_of(source))
        response = post_remote(sha(source), ranged(80, 160))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["x-tavonel-cdr-source-pages"], "200")
        self.assertEqual(response.headers["x-tavonel-cdr-page-range"], "80-160")


class _Store(BaseHTTPRequestHandler):
    body = b"%PDF-1.4 stored"

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("location", "/source")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("content-length", str(len(self.body)))
        self.end_headers()
        self.wfile.write(self.body)

    def log_message(self, *_: object) -> None:
        return None


class RealOpenerTest(unittest.TestCase):
    """The opener itself, over a real socket: it reads, and it refuses to follow a redirect."""

    def setUp(self) -> None:
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Store)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.work = Path(tempfile.mkdtemp())

    def test_reads_and_hashes_what_the_store_returns(self) -> None:
        digest, total = cdr.read_remote_source(f"{self.base}/source", self.work / "source.pdf")
        self.assertEqual((digest, total), (sha(_Store.body), len(_Store.body)))
        self.assertEqual((self.work / "source.pdf").read_bytes(), _Store.body)

    def test_does_not_follow_a_redirect(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as raised:
            cdr.REMOTE_SOURCE_OPENER.open(f"{self.base}/redirect", timeout=5)
        self.assertEqual(raised.exception.code, 302)
        with self.assertRaises(HTTPException) as refused:
            cdr.read_remote_source(f"{self.base}/redirect", self.work / "redirected.pdf")
        self.assertEqual(refused.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()

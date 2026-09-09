"""Request-boundary regressions: reject before multipart spooling, not afterwards."""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as app_module
from fastapi import HTTPException
from request_boundary import CdrRequestBoundary


def scope(headers: list[tuple[bytes, bytes]] | None = None, path: str = "/v1/disarm") -> dict:
    return {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "POST", "scheme": "https", "path": path, "raw_path": path.encode(),
        "query_string": b"", "root_path": "", "headers": headers or [],
        "server": ("test", 443), "client": ("127.0.0.1", 12345),
    }


class RequestBoundaryIntegrationTest(unittest.TestCase):
    def test_unauthenticated_upload_is_refused_without_reading_body(self) -> None:
        async def run() -> tuple[int, int]:
            reads = 0
            messages = []

            async def receive():
                nonlocal reads
                reads += 1
                return {"type": "http.request", "body": b"", "more_body": False}

            async def send(message):
                messages.append(message)

            await app_module.app(scope([(b"content-type", b"multipart/form-data; boundary=test")]), receive, send)
            status = next(message["status"] for message in messages if message["type"] == "http.response.start")
            return status, reads

        status, reads = asyncio.run(run())
        self.assertEqual(status, 401)
        self.assertEqual(reads, 0, "untrusted uploads must not reach multipart parsing")


class RequestBoundaryUnitTest(unittest.TestCase):
    def exercise(self, *, headers=None, chunks=None, budget=8, reject_auth=False,
                 slow=False, path="/v1/disarm"):
        async def run():
            messages = []
            reads = 0
            entered = 0
            received = bytearray()
            events = iter(chunks or [{"type": "http.request", "body": b"abc"}])

            def authenticate(*_):
                if reject_auth:
                    raise HTTPException(401, "unit-test refusal")
                return "sha256:" + "a" * 64

            async def receive():
                nonlocal reads
                reads += 1
                if slow:
                    await asyncio.sleep(0.1)
                return next(events, {"type": "http.disconnect"})

            async def send(message):
                messages.append(message)

            async def endpoint(request_scope, read, write):
                nonlocal entered
                entered += 1
                if path == "/v1/disarm":
                    self.assertIn("cdr_authenticated_input_sha256", request_scope["state"])
                    while True:
                        message = await read()
                        received.extend(message.get("body", b""))
                        if not message.get("more_body", False):
                            break
                await write({"type": "http.response.start", "status": 200, "headers": []})
                await write({"type": "http.response.body", "body": b"ok"})

            boundary = CdrRequestBoundary(endpoint, authenticate=authenticate,
                max_body_bytes=budget, receive_timeout_seconds=0.01 if slow else 1)
            await boundary(scope(headers if headers is not None else [
                (b"content-type", b"multipart/form-data; boundary=test")], path), receive, send)
            start = next((m for m in messages if m["type"] == "http.response.start"), None)
            if start and start["status"] != 200:
                self.assertIn((b"cache-control", b"no-store"), start["headers"])
            return start["status"] if start else None, reads, entered, bytes(received)
        return asyncio.run(run())

    def test_declared_oversize_never_reads_or_enters_parser(self):
        result = self.exercise(headers=[(b"content-type", b"multipart/form-data"),
                                        (b"content-length", b"9")])
        self.assertEqual(result[:3], (413, 0, 0))

    def test_streaming_oversize_never_enters_parser(self):
        result = self.exercise(chunks=[
            {"type": "http.request", "body": b"12345", "more_body": True},
            {"type": "http.request", "body": b"6789", "more_body": False}])
        self.assertEqual(result[:3], (413, 2, 0))

    def test_exact_limit_preserves_all_bytes(self):
        result = self.exercise(chunks=[
            {"type": "http.request", "body": b"1234", "more_body": True},
            {"type": "http.request", "body": b"5678", "more_body": False}])
        self.assertEqual(result, (200, 2, 1, b"12345678"))

    def test_false_content_length_refuses_before_parser(self):
        self.assertEqual(self.exercise(headers=[(b"content-type", b"multipart/form-data"),
                         (b"content-length", b"1")])[:3], (400, 1, 0))

    def test_invalid_content_lengths_are_not_accepted(self):
        for length in (b"-1", b"+3", b"3.0", b"", b" 3", b"9" * 30):
            with self.subTest(length=length):
                self.assertEqual(self.exercise(headers=[
                    (b"content-type", b"multipart/form-data"),
                    (b"content-length", length)])[:3], (400, 0, 0))

    def test_duplicate_security_headers_refuse(self):
        for name in (b"content-length", b"content-type", b"x-tavonel-cdr-signature"):
            with self.subTest(name=name):
                self.assertEqual(self.exercise(headers=[(name, b"x"), (name, b"y")])[:3],
                                 (400, 0, 0))

    def test_authentication_precedes_body_reads(self):
        self.assertEqual(self.exercise(reject_auth=True)[:3], (401, 0, 0))

    def test_wrong_media_type_does_not_read(self):
        self.assertEqual(self.exercise(headers=[(b"content-type", b"application/json")])[:3],
                         (415, 0, 0))

    def test_receive_deadline_cancels_slow_upload(self):
        self.assertEqual(self.exercise(slow=True)[:3], (408, 1, 0))

    def test_disconnect_does_not_invoke_parser(self):
        self.assertEqual(self.exercise(chunks=[{"type": "http.disconnect"}])[:3],
                         (None, 1, 0))

    def test_health_and_other_routes_remain_independent(self):
        self.assertEqual(self.exercise(path="/health", reject_auth=True)[:3], (200, 0, 1))

    def test_invalid_budgets_fail_at_startup(self):
        for budget, timeout in ((0, 1), (-1, 1), (1, 0)):
            with self.subTest(budget=budget, timeout=timeout), self.assertRaises(ValueError):
                CdrRequestBoundary(None, authenticate=None, max_body_bytes=budget,
                                   receive_timeout_seconds=timeout)


if __name__ == "__main__":
    unittest.main()

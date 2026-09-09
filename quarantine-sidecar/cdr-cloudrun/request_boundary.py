"""Authenticate and bound a disarm request before Starlette parses multipart bytes.

The file-size check inside the endpoint remains necessary, but is too late to bound
multipart spooling. This ASGI layer has no parser and never logs request material.
"""
from __future__ import annotations

import asyncio
from collections.abc import Callable
from time import monotonic

from fastapi import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

AuthCheck = Callable[[str | None, str | None, str | None, str | None], str]
AUTH_HEADERS = (
    b"x-tavonel-input-sha256", b"x-tavonel-cdr-timestamp",
    b"x-tavonel-cdr-request-id", b"x-tavonel-cdr-signature",
)


class CdrRequestBoundary:
    def __init__(
        self, app: ASGIApp, *, authenticate: AuthCheck,
        max_body_bytes: int, receive_timeout_seconds: float = 15.0,
    ) -> None:
        if max_body_bytes < 1 or receive_timeout_seconds <= 0:
            raise ValueError("CDR request budgets must be positive")
        self.app = app
        self.authenticate = authenticate
        self.max_body_bytes = max_body_bytes
        self.receive_timeout_seconds = receive_timeout_seconds

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (scope["type"] != "http" or scope.get("method") != "POST"
                or scope.get("path", "").rstrip("/") != "/v1/disarm"):
            await self.app(scope, receive, send)
            return
        try:
            headers: dict[bytes, bytes] = {}
            guarded = (*AUTH_HEADERS, b"content-length", b"content-type")
            for name, value in scope.get("headers", []):
                name = name.lower()
                if name in guarded:
                    if name in headers:
                        raise HTTPException(400, "CDR duplicate request header")
                    headers[name] = value
            values = [headers[name].decode("latin-1") if name in headers else None
                      for name in AUTH_HEADERS]
            expected_digest = self.authenticate(*values)
            content_type = headers.get(b"content-type", b"").split(b";", 1)[0].strip().lower()
            if content_type != b"multipart/form-data":
                raise HTTPException(415, "CDR source must be a multipart upload")
            declared = headers.get(b"content-length")
            if declared is not None:
                if len(declared) > 12 or not declared or not declared.isdigit():
                    raise HTTPException(400, "CDR request length is invalid")
                if int(declared) > self.max_body_bytes:
                    raise HTTPException(413, "CDR request exceeds the upload limit")
        except HTTPException as exc:
            response = JSONResponse(
                {"detail": exc.detail}, status_code=exc.status_code,
                headers={"cache-control": "no-store", **(exc.headers or {})},
            )
            await response(scope, receive, send)
            return

        deadline = monotonic() + self.receive_timeout_seconds
        # Buffer at most the explicit small upload budget before creating any multipart
        # temporary file. Raising from inside a multipart parser would otherwise leave
        # cleanup dependent on which exception classes that library happens to catch.
        body = bytearray()
        try:
            while True:
                remaining = deadline - monotonic()
                if remaining <= 0:
                    raise HTTPException(408, "CDR upload receive deadline exceeded")
                try:
                    message = await asyncio.wait_for(receive(), remaining)
                except TimeoutError as exc:
                    raise HTTPException(408, "CDR upload receive deadline exceeded") from exc
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                if len(body) + len(chunk) > self.max_body_bytes:
                    raise HTTPException(413, "CDR request exceeds the upload limit")
                body.extend(chunk)
                if not message.get("more_body", False):
                    break
            if declared is not None and len(body) != int(declared):
                raise HTTPException(400, "CDR request length does not match its body")
        except HTTPException as exc:
            body.clear()
            await JSONResponse({"detail": exc.detail}, status_code=exc.status_code,
                               headers={"cache-control": "no-store"})(scope, receive, send)
            return

        # This state is made by authenticated server code, never by a form field/header.
        scope.setdefault("state", {})["cdr_authenticated_input_sha256"] = expected_digest
        delivered = False

        async def bounded_receive() -> Message:
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            payload = bytes(body)
            body.clear()
            return {"type": "http.request", "body": payload, "more_body": False}

        await self.app(scope, bounded_receive, send)

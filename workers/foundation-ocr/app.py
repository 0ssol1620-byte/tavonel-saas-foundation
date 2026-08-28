from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
from datetime import UTC, datetime
from threading import Lock
from time import monotonic
from typing import Final

import pypdfium2 as pdfium
from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

APP_NAME: Final = "tavonel-foundation-ocr"
LISTEN_PORT: Final = 8001
SIGNATURE_TTL_SECONDS: Final = 300
MAX_INPUT_BYTES: Final = 18 * 1024 * 1024
MAX_PAGES: Final = 80
REQUEST_ID: Final = re.compile(r"^[A-Za-z0-9_-]{16,160}$")
PDF_MAGIC: Final = b"%PDF"


class RequestReplayGuard:
    def __init__(self) -> None:
        self._lock = Lock()
        self._expires_at: dict[str, float] = {}

    def claim(self, request_id: str) -> None:
        now = monotonic()
        with self._lock:
            for nonce, expires_at in tuple(self._expires_at.items()):
                if expires_at <= now:
                    del self._expires_at[nonce]
            if request_id in self._expires_at:
                raise HTTPException(409, "OCR request has already been consumed")
            self._expires_at[request_id] = now + SIGNATURE_TTL_SECONDS


replay_guard = RequestReplayGuard()


def ocr_request_signature(secret: str, timestamp: str, request_id: str, input_sha256: str) -> str:
    raw = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{request_id}.{input_sha256}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def read_hmac_secret() -> str:
    secret = os.getenv("TAVONEL_OCR_HMAC", "").strip()
    if len(secret) < 32:
        raise RuntimeError("TAVONEL_OCR_HMAC is required and must be at least 32 characters")
    return secret


def require_authentication(
    input_sha256: str | None,
    timestamp: str | None,
    request_id: str | None,
    signature: str | None,
) -> str:
    if not input_sha256 or not re.fullmatch(r"sha256:[a-f0-9]{64}", input_sha256):
        raise HTTPException(401, "OCR source digest is invalid")
    if not timestamp or not request_id or not signature or not REQUEST_ID.fullmatch(request_id):
        raise HTTPException(401, "OCR authentication headers are invalid")
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(401, "OCR timestamp is invalid") from exc
    if parsed.tzinfo is None or abs((datetime.now(UTC) - parsed).total_seconds()) > SIGNATURE_TTL_SECONDS:
        raise HTTPException(401, "OCR request is expired")
    try:
        secret = read_hmac_secret()
    except RuntimeError as exc:
        raise HTTPException(503, "OCR configuration is not qualified") from exc
    expected = ocr_request_signature(secret, timestamp, request_id, input_sha256)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(401, "OCR request signature is invalid")
    replay_guard.claim(request_id)
    return input_sha256


def normalized_mime(value: str | None) -> str:
    return (value or "").split(";", 1)[0].strip().casefold()


def copy_and_digest(upload: UploadFile) -> tuple[bytes, str]:
    digest = hashlib.sha256()
    chunks: list[bytes] = []
    total = 0
    while chunk := upload.file.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_INPUT_BYTES:
            raise HTTPException(413, "OCR source exceeds the 18 MiB Foundation cap")
        digest.update(chunk)
        chunks.append(chunk)
    if total < 1:
        raise HTTPException(422, "OCR source is empty")
    return b"".join(chunks), f"sha256:{digest.hexdigest()}"


def reject_non_pdf(filename: str | None, mime: str | None, payload: bytes) -> None:
    name = (filename or "").replace("\\", "/").split("/")[-1]
    suffix = name.rsplit(".", 1)[-1].casefold() if "." in name else ""
    declared = normalized_mime(mime)
    if declared not in {"application/pdf", "application/x-pdf"} or suffix not in {"", "pdf"}:
        raise HTTPException(422, "OCR source is not a PDF")
    if not payload.startswith(PDF_MAGIC):
        raise HTTPException(422, "OCR source is not a PDF")


def extract_text(payload: bytes) -> tuple[str, int]:
    try:
        document = pdfium.PdfDocument(payload)
    except Exception as exc:
        raise HTTPException(422, "OCR renderer rejected this PDF") from exc
    try:
        page_count = len(document)
        if page_count < 1 or page_count > MAX_PAGES:
            raise HTTPException(422, "OCR source page count is not qualified")
        pages: list[str] = []
        for index in range(page_count):
            page = document[index]
            textpage = page.get_textpage()
            try:
                pages.append(textpage.get_text_bounded().strip())
            finally:
                textpage.close()
                page.close()
        return "\n".join(part for part in pages if part).strip(), page_count
    finally:
        document.close()


app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(HTTPException)
async def http_exception_no_store(_: Request, exc: HTTPException) -> JSONResponse:
    headers = {"cache-control": "no-store"}
    if exc.headers:
        headers.update(exc.headers)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=headers)


@app.get("/health")
def healthz() -> JSONResponse:
    return JSONResponse(
        content={"status": "ok", "port": LISTEN_PORT, "ssh": False},
        headers={"cache-control": "no-store"},
    )


@app.post("/v1/ocr")
def ocr(
    source: UploadFile = File(...),
    x_tavonel_input_sha256: str | None = Header(default=None),
    x_tavonel_ocr_timestamp: str | None = Header(default=None),
    x_tavonel_ocr_request_id: str | None = Header(default=None),
    x_tavonel_ocr_signature: str | None = Header(default=None),
) -> JSONResponse:
    expected_digest = require_authentication(
        x_tavonel_input_sha256,
        x_tavonel_ocr_timestamp,
        x_tavonel_ocr_request_id,
        x_tavonel_ocr_signature,
    )
    try:
        payload, actual_digest = copy_and_digest(source)
        if not hmac.compare_digest(expected_digest, actual_digest):
            raise HTTPException(422, "OCR source digest does not match the uploaded body")
        reject_non_pdf(source.filename, source.content_type, payload)
        text, page_count = extract_text(payload)
    finally:
        source.file.close()
    return JSONResponse(
        content={
            "status": "ok",
            "text": text,
            "pageCount": page_count,
            "inputSha256": expected_digest,
        },
        headers={"cache-control": "no-store"},
    )

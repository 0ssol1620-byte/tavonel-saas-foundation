from __future__ import annotations

import base64
import hashlib
import hmac
import math
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from time import monotonic
from typing import Final

import fitz
from fastapi import BackgroundTasks, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

APP_NAME: Final = "tavonel-pdf-raster-cdr"
SIGNATURE_TTL_SECONDS: Final = 300
MAX_INPUT_BYTES: Final = 5 * 1024 * 1024
MAX_OUTPUT_BYTES: Final = 18 * 1024 * 1024
MAX_PAGES: Final = 80
RENDER_SCALE: Final = 1.5
MIN_RENDER_SCALE: Final = 1.0
MAX_RENDER_PIXELS_PER_PAGE: Final = 30_000_000
MAX_RENDER_PIXELS_TOTAL: Final = 80_000_000
MAX_OFFICE_PACKAGE_MEMBERS: Final = 500
MAX_OFFICE_PACKAGE_UNCOMPRESSED_BYTES: Final = 64 * 1024 * 1024
REQUEST_ID: Final = re.compile(r"^[A-Za-z0-9_-]{16,160}$")

# Each allowed input is rendered and reconstructed as an image-only PDF. Archive inputs,
# executable formats, and unqualified proprietary formats are intentionally rejected.
ALLOWED_INPUTS: Final = {
    "application/pdf": {".pdf"},
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {".docx"},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {".xlsx"},
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": {".pptx"},
    "application/vnd.oasis.opendocument.text": {".odt"},
    "application/vnd.oasis.opendocument.spreadsheet": {".ods"},
    "application/vnd.oasis.opendocument.presentation": {".odp"},
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/tiff": {".tif", ".tiff"},
    "image/gif": {".gif"},
}
LIBREOFFICE_MIMES: Final = set(ALLOWED_INPUTS) - {"application/pdf", "image/jpeg", "image/png", "image/tiff", "image/gif"}
OOXML_MIMES: Final = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
ODF_MIMES: Final = {
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
}


class RequestReplayGuard:
    """Process-local duplicate suppression for the short-lived public HMAC contract.

    Cloud Run is intentionally capped at one instance and one concurrent request. This guard
    prevents replay of an already authenticated request for the whole signature validity window
    while that instance remains alive. A service restart intentionally resets it; the remaining
    risk is documented and must not be described as durable replay protection.
    """

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
                raise HTTPException(409, "CDR request has already been consumed")
            self._expires_at[request_id] = now + SIGNATURE_TTL_SECONDS


replay_guard = RequestReplayGuard()


def normalized_mime(value: str | None) -> str:
    return (value or "").split(";", 1)[0].strip().casefold()


def cdr_request_signature(secret: str, timestamp: str, request_id: str, input_sha256: str) -> str:
    raw = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{request_id}.{input_sha256}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def read_hmac_secret() -> str:
    secret = os.getenv("TAVONEL_CDR_HMAC", "").strip()
    if len(secret) < 32:
        raise RuntimeError("TAVONEL_CDR_HMAC is required and must be at least 32 characters")
    return secret


def require_authentication(
    input_sha256: str | None,
    timestamp: str | None,
    request_id: str | None,
    signature: str | None,
) -> str:
    if not input_sha256 or not re.fullmatch(r"sha256:[a-f0-9]{64}", input_sha256):
        raise HTTPException(401, "CDR source digest is invalid")
    if not timestamp or not request_id or not signature or not REQUEST_ID.fullmatch(request_id):
        raise HTTPException(401, "CDR authentication headers are invalid")
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(401, "CDR timestamp is invalid") from exc
    if parsed.tzinfo is None or abs((datetime.now(UTC) - parsed).total_seconds()) > SIGNATURE_TTL_SECONDS:
        raise HTTPException(401, "CDR request is expired")
    try:
        secret = read_hmac_secret()
    except RuntimeError as exc:
        raise HTTPException(503, "CDR configuration is not qualified") from exc
    expected = cdr_request_signature(secret, timestamp, request_id, input_sha256)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(401, "CDR request signature is invalid")
    replay_guard.claim(request_id)
    return input_sha256


def validate_input(name: str | None, mime: str | None) -> tuple[str, str]:
    file_name = Path(name or "").name
    declared_mime = normalized_mime(mime)
    if not file_name or file_name in {".", ".."}:
        raise HTTPException(422, "CDR source filename is invalid")
    if declared_mime not in ALLOWED_INPUTS or Path(file_name).suffix.casefold() not in ALLOWED_INPUTS[declared_mime]:
        raise HTTPException(422, "CDR source format is not qualified for PDF rasterization")
    return file_name, declared_mime


def reject_risky_office_package(source: Path, source_mime: str) -> None:
    """Reject encrypted, macro-bearing, embedded-object, or expansive Office packages.

    OOXML and ODF are ZIP containers, but generic archives remain unqualified. This inspection
    runs before LibreOffice receives the source and has a strict bounded metadata budget.
    """
    if source_mime not in OOXML_MIMES | ODF_MIMES:
        return
    try:
        with zipfile.ZipFile(source) as package:
            members = package.infolist()
    except (OSError, zipfile.BadZipFile) as exc:
        raise HTTPException(422, "CDR Office package is invalid or encrypted") from exc
    if len(members) > MAX_OFFICE_PACKAGE_MEMBERS or sum(member.file_size for member in members) > MAX_OFFICE_PACKAGE_UNCOMPRESSED_BYTES:
        raise HTTPException(422, "CDR Office package expansion is not qualified")
    names = {member.filename.casefold().lstrip("/") for member in members}
    if source_mime in OOXML_MIMES:
        risky = any(
            "vbaproject" in name
            or "vbadata" in name
            or "/embeddings/" in name
            or name.startswith("word/embeddings/")
            for name in names
        )
    else:
        risky = any(
            name.startswith(("basic/", "scripts/", "objects/", "objectreplacements/"))
            for name in names
        )
    if risky:
        raise HTTPException(422, "CDR Office package contains unqualified active or embedded content")


def copy_and_digest(upload: UploadFile, target: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    with target.open("wb") as output:
        while chunk := upload.file.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_INPUT_BYTES:
                raise HTTPException(413, "CDR source exceeds the controlled-beta size limit")
            digest.update(chunk)
            output.write(chunk)
    if total < 1:
        raise HTTPException(422, "CDR source is empty")
    return f"sha256:{digest.hexdigest()}", total


def convert_to_pdf(source: Path, source_mime: str, work_dir: Path) -> Path:
    if source_mime not in LIBREOFFICE_MIMES:
        return source
    profile = work_dir / "lo-profile"
    output_dir = work_dir / "converted"
    profile.mkdir(mode=0o700)
    output_dir.mkdir(mode=0o700)
    command = [
        "soffice",
        "--headless",
        "--safe-mode",
        "--norestore",
        "--nodefault",
        "--nolockcheck",
        f"-env:UserInstallation=file://{profile}",
        "--convert-to",
        "pdf:writer_pdf_Export",
        "--outdir",
        str(output_dir),
        str(source),
    ]
    try:
        completed = subprocess.run(command, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(422, "CDR source could not be converted safely") from exc
    converted = output_dir / f"{source.stem}.pdf"
    if completed.returncode != 0 or not converted.is_file() or converted.stat().st_size == 0:
        raise HTTPException(422, "CDR source could not be converted safely")
    return converted


def qualified_render_scale(page_rects: list[fitz.Rect]) -> float:
    areas = [rect.width * rect.height for rect in page_rects]
    if not areas or any(not math.isfinite(area) or area <= 0 for area in areas):
        raise HTTPException(422, "CDR source rendering budget is not qualified")
    scale = min(
        RENDER_SCALE,
        math.sqrt(MAX_RENDER_PIXELS_PER_PAGE / max(areas)),
        math.sqrt(MAX_RENDER_PIXELS_TOTAL / sum(areas)),
    )
    if scale < MIN_RENDER_SCALE:
        raise HTTPException(422, "CDR source rendering budget is not qualified")
    # Stay below the hard pixel ceilings after integer conversion and floating-point rounding.
    return scale if scale == RENDER_SCALE else scale * 0.999999


def rasterize_to_pdf(source: Path, target: Path) -> int:
    try:
        source_doc = fitz.open(source)
    except Exception as exc:
        raise HTTPException(422, "CDR source renderer rejected this document") from exc
    output_doc = fitz.open()
    try:
        if source_doc.needs_pass:
            raise HTTPException(422, "CDR password-protected PDF is not qualified")
        if source_doc.page_count < 1 or source_doc.page_count > MAX_PAGES:
            raise HTTPException(422, "CDR source page count is not qualified")
        page_rects = [page.rect for page in source_doc]
        render_scale = qualified_render_scale(page_rects)
        rendered_pixels = 0
        for page, page_rect in zip(source_doc, page_rects, strict=True):
            width = int(page_rect.width * render_scale)
            height = int(page_rect.height * render_scale)
            pixel_count = width * height
            if width < 1 or height < 1 or pixel_count > MAX_RENDER_PIXELS_PER_PAGE or rendered_pixels + pixel_count > MAX_RENDER_PIXELS_TOTAL:
                raise HTTPException(422, "CDR source rendering budget is not qualified")
            rendered_pixels += pixel_count
            pix = page.get_pixmap(matrix=fitz.Matrix(render_scale, render_scale), colorspace=fitz.csRGB, alpha=False)
            output_page = output_doc.new_page(width=page_rect.width, height=page_rect.height)
            output_page.insert_image(output_page.rect, stream=pix.tobytes("png"))
        # This is a newly created document containing only rendered page images; source PDF metadata is never copied.
        output_doc.save(target, garbage=4, deflate=True, clean=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, "CDR source could not be rasterized safely") from exc
    finally:
        source_doc.close()
        output_doc.close()
    size = target.stat().st_size if target.is_file() else 0
    if size < 1 or size > MAX_OUTPUT_BYTES:
        raise HTTPException(422, "CDR sanitized output is outside the controlled-beta size limit")
    return size


def remove_tree(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(HTTPException)
async def http_exception_no_store(_: Request, exc: HTTPException) -> JSONResponse:
    headers = {"cache-control": "no-store"}
    if exc.headers:
        headers.update(exc.headers)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=headers)


@app.get("/health")
def healthz() -> JSONResponse:
    try:
        read_hmac_secret()
    except RuntimeError:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "reason": "CDR configuration is not qualified"},
            headers={"cache-control": "no-store", "retry-after": "60"},
        )
    if shutil.which("soffice") is None:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "reason": "CDR renderer is unavailable"},
            headers={"cache-control": "no-store", "retry-after": "60"},
        )
    return JSONResponse(
        content={"status": "ok", "mode": "pdf-raster", "service": APP_NAME},
        headers={"cache-control": "no-store"},
    )


@app.post("/v1/disarm")
def disarm(
    background_tasks: BackgroundTasks,
    source: UploadFile = File(...),
    x_tavonel_input_sha256: str | None = Header(default=None),
    x_tavonel_cdr_timestamp: str | None = Header(default=None),
    x_tavonel_cdr_request_id: str | None = Header(default=None),
    x_tavonel_cdr_signature: str | None = Header(default=None),
) -> FileResponse:
    expected_digest = require_authentication(
        x_tavonel_input_sha256,
        x_tavonel_cdr_timestamp,
        x_tavonel_cdr_request_id,
        x_tavonel_cdr_signature,
    )
    file_name, mime_type = validate_input(source.filename, source.content_type)
    work_dir = Path(tempfile.mkdtemp(prefix="tavonel-cdr-"))
    try:
        input_path = work_dir / file_name
        actual_digest, _ = copy_and_digest(source, input_path)
        if not hmac.compare_digest(expected_digest, actual_digest):
            raise HTTPException(422, "CDR source digest does not match the uploaded body")
        reject_risky_office_package(input_path, mime_type)
        pdf_source = convert_to_pdf(input_path, mime_type, work_dir)
        output_path = work_dir / "sanitized.pdf"
        byte_size = rasterize_to_pdf(pdf_source, output_path)
        with output_path.open("rb") as sanitized:
            output_digest = f"sha256:{hashlib.file_digest(sanitized, 'sha256').hexdigest()}"
    except Exception:
        remove_tree(work_dir)
        raise
    finally:
        source.file.close()
    background_tasks.add_task(remove_tree, work_dir)
    return FileResponse(
        output_path,
        media_type="application/pdf",
        filename="sanitized.pdf",
        headers={
            "cache-control": "no-store",
            "content-length": str(byte_size),
            "x-tavonel-cdr-status": "clean",
            "x-tavonel-input-sha256": expected_digest,
            "x-tavonel-cdr-output-mime": "application/pdf",
            "x-tavonel-cdr-output-sha256": output_digest,
        },
        background=background_tasks,
    )

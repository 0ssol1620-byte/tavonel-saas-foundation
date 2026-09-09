from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import warnings
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from time import monotonic
from typing import Final

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, UnidentifiedImageError
from request_boundary import CdrRequestBoundary

from malware import (
    MalwareDetectedError,
    MalwareScanError,
    require_scanning_enabled,
    scan_stream,
    scanner_ready,
)

try:
    # Refuse to boot rather than serve a single request with scanning disarmed. This service
    # has no bypass flag: MALWARE_SCAN_REQUIRED may only be "1" (or be unset), and anything
    # else is a configuration error reported here, before uvicorn binds a port.
    require_scanning_enabled()
except MalwareScanError as exc:
    raise RuntimeError(
        "MALWARE_SCAN_REQUIRED must be unset or exactly '1'; this service has no scan bypass"
    ) from exc

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
IMAGE_MIMES: Final = {"image/jpeg", "image/png", "image/tiff", "image/gif"}
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

    def claim(self, request_id: str, valid_for_seconds: float = SIGNATURE_TTL_SECONDS) -> None:
        if not math.isfinite(valid_for_seconds) or not 0 < valid_for_seconds <= 2 * SIGNATURE_TTL_SECONDS:
            raise HTTPException(401, "CDR request is expired")
        now = monotonic()
        with self._lock:
            for nonce, expires_at in tuple(self._expires_at.items()):
                if expires_at <= now:
                    del self._expires_at[nonce]
            if request_id in self._expires_at:
                raise HTTPException(409, "CDR request has already been consumed")
            self._expires_at[request_id] = now + valid_for_seconds


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
    if (not timestamp or not request_id or not signature or not REQUEST_ID.fullmatch(request_id)
            or not re.fullmatch(r"[A-Za-z0-9_-]{43}", signature)):
        raise HTTPException(401, "CDR authentication headers are invalid")
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(401, "CDR timestamp is invalid") from exc
    if parsed.tzinfo is None:
        raise HTTPException(401, "CDR request is expired")
    age_seconds = (datetime.now(UTC) - parsed).total_seconds()
    if not -SIGNATURE_TTL_SECONDS <= age_seconds < SIGNATURE_TTL_SECONDS:
        raise HTTPException(401, "CDR request is expired")
    try:
        secret = read_hmac_secret()
    except RuntimeError as exc:
        raise HTTPException(503, "CDR configuration is not qualified") from exc
    expected = cdr_request_signature(secret, timestamp, request_id, input_sha256)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(401, "CDR request signature is invalid")
    # A timestamp inside the permitted future clock skew can remain valid for
    # almost twice the nominal TTL. Retain its nonce until that actual deadline.
    replay_guard.claim(request_id, SIGNATURE_TTL_SECONDS - age_seconds)
    return input_sha256


def validate_input(name: str | None, mime: str | None) -> tuple[str, str]:
    file_name = Path(name or "").name
    declared_mime = normalized_mime(mime)
    # A control byte (NUL included) would reach `Path.open` and surface as an unhandled 500
    # instead of a refusal. The name is never executed or shell-expanded, but it is still
    # caller-controlled input on a trust boundary, so it refuses in the same vocabulary.
    if not file_name or file_name in {".", ".."} or any(character < " " for character in file_name):
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


# Every adapter refusal is a 503 with no output and no promotion. antivirus_required is a
# configuration failure, which is still an unavailable scanner from the caller's side, and
# antivirus_scan_error is a reply that carried no verdict.
MALWARE_REFUSAL: Final = {
    "antivirus_unavailable": "SCANNER_UNAVAILABLE",
    "antivirus_required": "SCANNER_UNAVAILABLE",
    "antivirus_timeout": "SCAN_TIMEOUT",
    "antivirus_invalid_response": "SCANNER_INVALID_RESPONSE",
    "antivirus_scan_error": "SCANNER_INVALID_RESPONSE",
}


def scan_or_refuse(source: Path, input_sha256: str) -> dict[str, object]:
    """Scan the stored input before anything parses or converts it.

    The returned record binds the verdict to the digest the caller authenticated, so the
    Worker can tie it to the SourceVersion. A scan error never returns; it raises.
    """
    try:
        with source.open("rb") as stream:
            result = scan_stream(stream)
    except MalwareDetectedError as exc:
        raise HTTPException(
            422,
            {
                "code": "MALWARE_DETECTED",
                "signature": str(exc),
                "scannedSha256": input_sha256,
                "message": "CDR source was rejected by the malware scanner",
            },
        ) from exc
    except MalwareScanError as exc:
        raise HTTPException(
            503,
            {
                "code": MALWARE_REFUSAL.get(str(exc), "SCANNER_UNAVAILABLE"),
                "reason": str(exc),
                "message": "CDR malware scan produced no verdict",
            },
            headers={"retry-after": "60"},
        ) from exc
    if result.verdict != "clean":
        # `scan_stream` cannot return anything else today. This is the belt on the braces:
        # if a future verdict is ever added, it refuses here instead of being promoted.
        raise HTTPException(
            503,
            {
                "code": "SCANNER_INVALID_RESPONSE",
                "reason": f"unpromotable_verdict:{result.verdict}",
                "message": "CDR malware scan produced no clean verdict",
            },
            headers={"retry-after": "60"},
        )
    return {
        "engine": result.engine,
        "signatureVersion": result.signature_version,
        "scannedSha256": input_sha256,
        "verdict": result.verdict,
        "durationMs": result.duration_ms,
    }


def _new_pdf_document() -> pdfium.PdfDocument:
    raw_document = pdfium_c.FPDF_CreateNewDocument()
    if not raw_document:
        raise HTTPException(422, "CDR sanitized PDF could not be created")
    return pdfium.PdfDocument(raw_document)


def _save_pdf(document: pdfium.PdfDocument, target: Path) -> None:
    try:
        with target.open("wb") as stream:
            document.save(stream)
    except (OSError, pdfium.PdfiumError) as exc:
        raise HTTPException(422, "CDR sanitized PDF could not be created") from exc


def convert_image_to_pdf(source: Path, work_dir: Path) -> Path:
    """Decode bounded raster input and rebuild it as image-only PDF pages.

    Pillow is used only as a bounded decoder. Every frame is copied to fresh RGB pixels,
    metadata is not forwarded, and the intermediate PDF is rebuilt through PDFium before the
    final raster pass. The same page and pixel ceilings used by PDF rendering apply here before
    a frame is fully decoded.
    """
    target = work_dir / "decoded-image.pdf"
    output_doc: pdfium.PdfDocument | None = None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(source) as image:
                frame_count = int(getattr(image, "n_frames", 1))
                if frame_count < 1 or frame_count > MAX_PAGES:
                    raise HTTPException(422, "CDR source page count is not qualified")

                frame_sizes: list[tuple[int, int]] = []
                total_pixels = 0
                for frame_index in range(frame_count):
                    image.seek(frame_index)
                    width, height = image.size
                    pixel_count = width * height
                    if (
                        width < 1
                        or height < 1
                        or pixel_count > MAX_RENDER_PIXELS_PER_PAGE
                        or total_pixels + pixel_count > MAX_RENDER_PIXELS_TOTAL
                    ):
                        raise HTTPException(422, "CDR source rendering budget is not qualified")
                    frame_sizes.append((width, height))
                    total_pixels += pixel_count

                output_doc = _new_pdf_document()
                for frame_index, (width, height) in enumerate(frame_sizes):
                    image.seek(frame_index)
                    frame = image.convert("RGB")
                    bitmap = pdfium.PdfBitmap.from_pil(frame)
                    try:
                        output_page = output_doc.new_page(float(width), float(height))
                        page_image = pdfium.PdfImage.new(output_doc)
                        page_image.set_bitmap(bitmap)
                        page_image.set_matrix(pdfium.PdfMatrix().scale(width, height))
                        output_page.insert_obj(page_image)
                        output_page.gen_content()
                        output_page.close()
                    finally:
                        bitmap.close()
                        frame.close()
                _save_pdf(output_doc, target)
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(422, "CDR image source is not qualified") from exc
    finally:
        if output_doc is not None:
            output_doc.close()
    if not target.is_file() or target.stat().st_size < 1:
        raise HTTPException(422, "CDR image source could not be normalized safely")
    return target


def office_process_environment(work_dir: Path) -> dict[str, str]:
    """Pass only process basics, never API/provider credentials, to LibreOffice.

    This reduces environment inheritance; it is not a substitute for the
    container/network isolation required by the deployment qualification.
    """
    allowed = ("PATH", "SystemRoot", "WINDIR", "LANG", "LC_ALL", "TZ")
    environment = {name: os.environ[name] for name in allowed if name in os.environ}
    environment.update({"HOME": str(work_dir), "TMP": str(work_dir), "TEMP": str(work_dir)})
    return environment


def convert_to_pdf(source: Path, source_mime: str, work_dir: Path) -> Path:
    if source_mime in IMAGE_MIMES:
        return convert_image_to_pdf(source, work_dir)
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
        f"-env:UserInstallation={profile.resolve().as_uri()}",
        "--convert-to",
        "pdf:writer_pdf_Export",
        "--outdir",
        str(output_dir),
        str(source),
    ]
    try:
        completed = subprocess.run(
            command, check=False, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45,
            env=office_process_environment(work_dir),
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(422, "CDR source could not be converted safely") from exc
    converted = output_dir / f"{source.stem}.pdf"
    if completed.returncode != 0 or not converted.is_file() or converted.stat().st_size == 0:
        raise HTTPException(422, "CDR source could not be converted safely")
    return converted


def qualified_render_scale(page_sizes: list[tuple[float, float]]) -> float:
    areas = [width * height for width, height in page_sizes]
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
    source_doc: pdfium.PdfDocument | None = None
    output_doc: pdfium.PdfDocument | None = None
    try:
        try:
            source_doc = pdfium.PdfDocument(source)
        except pdfium.PdfiumError as exc:
            error_code = pdfium_c.FPDF_GetLastError()
            if error_code in {pdfium_c.FPDF_ERR_PASSWORD, pdfium_c.FPDF_ERR_SECURITY}:
                raise HTTPException(422, "CDR password-protected PDF is not qualified") from exc
            raise HTTPException(422, "CDR source renderer rejected this document") from exc

        page_count = len(source_doc)
        if page_count < 1 or page_count > MAX_PAGES:
            raise HTTPException(422, "CDR source page count is not qualified")
        page_sizes: list[tuple[float, float]] = []
        for page_index in range(page_count):
            page = source_doc[page_index]
            try:
                page_sizes.append(tuple(float(value) for value in page.get_size()))
            finally:
                page.close()
        render_scale = qualified_render_scale(page_sizes)
        output_doc = _new_pdf_document()
        rendered_pixels = 0
        for page_index, (page_width, page_height) in enumerate(page_sizes):
            source_page = source_doc[page_index]
            bitmap: pdfium.PdfBitmap | None = None
            try:
                bitmap = source_page.render(
                    scale=render_scale,
                    fill_color=(255, 255, 255, 255),
                )
                pixel_count = bitmap.width * bitmap.height
                if (
                    bitmap.width < 1
                    or bitmap.height < 1
                    or pixel_count > MAX_RENDER_PIXELS_PER_PAGE
                    or rendered_pixels + pixel_count > MAX_RENDER_PIXELS_TOTAL
                ):
                    raise HTTPException(422, "CDR source rendering budget is not qualified")
                rendered_pixels += pixel_count

                output_page = output_doc.new_page(page_width, page_height)
                page_image = pdfium.PdfImage.new(output_doc)
                page_image.set_bitmap(bitmap)
                page_image.set_matrix(pdfium.PdfMatrix().scale(page_width, page_height))
                output_page.insert_obj(page_image)
                output_page.gen_content()
                output_page.close()
            finally:
                if bitmap is not None:
                    bitmap.close()
                source_page.close()
        # This is a newly created document containing only rendered page images; source PDF metadata is never copied.
        _save_pdf(output_doc, target)
    except HTTPException:
        raise
    except (OSError, pdfium.PdfiumError, ValueError) as exc:
        raise HTTPException(422, "CDR source could not be rasterized safely") from exc
    finally:
        if source_doc is not None:
            source_doc.close()
        if output_doc is not None:
            output_doc.close()
    size = target.stat().st_size if target.is_file() else 0
    if size < 1 or size > MAX_OUTPUT_BYTES:
        raise HTTPException(422, "CDR sanitized output is outside the controlled-beta size limit")
    return size


def remove_tree(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CdrRequestBoundary,
    authenticate=require_authentication,
    # File content remains capped separately. This only allows bounded multipart framing.
    max_body_bytes=MAX_INPUT_BYTES + 64 * 1024,
    receive_timeout_seconds=15.0,
)


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
    scanner_is_ready = scanner_ready()
    if not scanner_is_ready:
        # Reported, not decorative: the scanner is always required, so a scanner that cannot
        # be reached means every /v1/disarm call would refuse and the instance is not healthy.
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "reason": "CDR malware scanner is unavailable", "scannerReady": False},
            headers={"cache-control": "no-store", "retry-after": "60"},
        )
    return JSONResponse(
        content={"status": "ok", "mode": "pdf-raster", "service": APP_NAME, "scannerReady": scanner_is_ready},
        headers={"cache-control": "no-store"},
    )


@app.post("/v1/disarm")
def disarm(
    background_tasks: BackgroundTasks,
    request: Request,
    source: UploadFile = File(...),
) -> FileResponse:
    expected_digest = getattr(request.state, "cdr_authenticated_input_sha256", None)
    if not isinstance(expected_digest, str):
        raise HTTPException(401, "CDR request boundary authentication is required")
    file_name, mime_type = validate_input(source.filename, source.content_type)
    work_dir = Path(tempfile.mkdtemp(prefix="tavonel-cdr-"))
    try:
        input_path = work_dir / file_name
        actual_digest, _ = copy_and_digest(source, input_path)
        if not hmac.compare_digest(expected_digest, actual_digest):
            raise HTTPException(422, "CDR source digest does not match the uploaded body")
        # Scanned before this process parses the bytes as anything: the package guard,
        # LibreOffice and the renderer all run after a verdict exists.
        malware_scan = scan_or_refuse(input_path, actual_digest)
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
            "x-tavonel-malware-scan": json.dumps(malware_scan, separators=(",", ":")),
        },
        background=background_tasks,
    )

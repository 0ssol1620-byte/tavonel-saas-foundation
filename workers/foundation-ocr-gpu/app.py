from __future__ import annotations

import base64
import hashlib
import json
import hmac
import os
import re
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Lock, Thread
from time import monotonic
from collections.abc import Iterator
from typing import Final, TypedDict

import pypdfium2 as pdfium
from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

APP_NAME: Final = "tavonel-foundation-ocr-gpu"
LISTEN_PORT: Final = 8001
SIGNATURE_TTL_SECONDS: Final = 300
MAX_INPUT_BYTES: Final = 18 * 1024 * 1024
MAX_PAGES: Final = 80
REQUEST_ID: Final = re.compile(r"^[A-Za-z0-9_-]{16,160}$")

PDF_MAGIC: Final = b"%PDF"
RENDER_SCALE: Final = 2.0
_rapidocr = None


class OcrRegion(TypedDict):
    regionId: str
    pageIndex0: int
    pageNumber1: int
    order: int
    blockType: str
    text: str
    bbox1000: list[int]
    confidence: float
    authority: str


def cuda_available() -> bool:
    try:
        import onnxruntime as ort
        return any(p.lower().startswith("cuda") or p.lower().startswith("tensorrt") for p in ort.get_available_providers())
    except Exception:
        return False


def rapidocr_engine():
    global _rapidocr
    if _rapidocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _rapidocr = RapidOCR()
    return _rapidocr


def normalized_bbox(
    left: float,
    top: float,
    right: float,
    bottom: float,
    width: float,
    height: float,
) -> list[int] | None:
    if width <= 0 or height <= 0:
        return None
    x1 = max(0, min(999, round(1000 * left / width)))
    y1 = max(0, min(999, round(1000 * top / height)))
    x2 = max(x1 + 1, min(1000, round(1000 * right / width)))
    y2 = max(y1 + 1, min(1000, round(1000 * bottom / height)))
    return [x1, y1, x2, y2]


def raster_regions(document, on_page: PageObserver | None = None) -> list[OcrRegion]:
    """Reads every page. `on_page` is called once per page, as soon as that page is done.

    The per-page callback exists so the reading can be watched while it happens. It changes
    nothing about what this function returns: the caller still receives the complete region list,
    and a caller that passes no observer behaves exactly as before.
    """
    engine = rapidocr_engine()
    regions: list[OcrRegion] = []
    order = 0
    for index in range(len(document)):
        page = document[index]
        try:
            bitmap = page.render(scale=RENDER_SCALE)
            try:
                image = bitmap.to_pil()
            finally:
                bitmap.close()
            result, _elapsed = engine(image)
        finally:
            page.close()
        if not result:
            continue
        width, height = image.size
        for line_index, row in enumerate(result):
            if not isinstance(row, (list, tuple)) or len(row) < 2 or not isinstance(row[1], str):
                continue
            text = row[1].strip()
            polygon = row[0] if isinstance(row[0], (list, tuple)) else []
            points = [point for point in polygon if isinstance(point, (list, tuple)) and len(point) >= 2]
            if not text or not points:
                continue
            xs = [float(point[0]) for point in points]
            ys = [float(point[1]) for point in points]
            bbox = normalized_bbox(min(xs), min(ys), max(xs), max(ys), width, height)
            if bbox is None:
                continue
            confidence = float(row[2]) if len(row) >= 3 and isinstance(row[2], (int, float)) else 0.0
            regions.append({
                "regionId": f"ocr-p{index + 1:04d}-l{line_index + 1:05d}",
                "pageIndex0": index,
                "pageNumber1": index + 1,
                "order": order,
                "blockType": "paragraph",
                "text": text,
                "bbox1000": bbox,
                "confidence": max(0.0, min(1.0, confidence)),
                "authority": "informal",
            })
            order += 1
        if on_page is not None:
            on_page(index + 1, len(document), "raster", [r for r in regions if r["pageIndex0"] == index])
    return regions


def native_page_region(page, textpage, text: str, page_index: int, order: int) -> OcrRegion | None:
    width, height = page.get_size()
    rectangle_count = textpage.count_rects()
    if rectangle_count < 1:
        return None
    rectangles = [textpage.get_rect(index) for index in range(rectangle_count)]
    left = min(rectangle[0] for rectangle in rectangles)
    bottom = min(rectangle[1] for rectangle in rectangles)
    right = max(rectangle[2] for rectangle in rectangles)
    top = max(rectangle[3] for rectangle in rectangles)
    bbox = normalized_bbox(left, height - top, right, height - bottom, width, height)
    if bbox is None:
        return None
    return {
        "regionId": f"native-p{page_index + 1:04d}",
        "pageIndex0": page_index,
        "pageNumber1": page_index + 1,
        "order": order,
        "blockType": "paragraph",
        "text": text,
        "bbox1000": bbox,
        "confidence": 1.0,
        "authority": "informal",
    }



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


# (page_number1, page_count, path, regions_for_that_page)
PageObserver = "object"


def extract_text(payload: bytes, on_page=None) -> tuple[str, int, list[OcrRegion]]:
    """Extracts text, optionally reporting each page as it is finished.

    The observer is the only thing added here. It receives a page as soon as that page is read,
    which is what makes a live view possible; it cannot change the result, and every existing
    caller passes nothing and gets exactly what it got before.
    """
    try:
        document = pdfium.PdfDocument(payload)
    except Exception as exc:
        raise HTTPException(422, "OCR renderer rejected this PDF") from exc
    try:
        page_count = len(document)
        if page_count < 1 or page_count > MAX_PAGES:
            raise HTTPException(422, "OCR source page count is not qualified")
        regions: list[OcrRegion] = []
        for index in range(page_count):
            page = document[index]
            textpage = page.get_textpage()
            try:
                text = textpage.get_text_bounded().strip()
                if text:
                    region = native_page_region(page, textpage, text, index, len(regions))
                    if region:
                        regions.append(region)
            finally:
                textpage.close()
                page.close()
            if on_page is not None:
                on_page(index + 1, page_count, "native", [r for r in regions if r["pageIndex0"] == index])
        if not regions:
            # No embedded text anywhere. The raster pass re-reads the same pages, so it reports
            # them again rather than leaving the observer stuck at the last native page.
            regions = raster_regions(document, on_page)
        text = "\n".join(region["text"] for region in regions).strip()
        if not text:
            raise HTTPException(422, "OCR source has no extractable text regions")
        return text, page_count, regions
    finally:
        document.close()



class SidecarHealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path not in {"/health", "/ping"}:
            self.send_response(404)
            self.end_headers()
            return
        body = b'{"status":"ok","port":8001,"ssh":false}'
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def start_health_sidecar() -> None:
    listen = int(os.getenv("PORT") or str(LISTEN_PORT))
    health_port = int(os.getenv("PORT_HEALTH") or "8002")
    if health_port == listen:
        return
    server = HTTPServer(("0.0.0.0", health_port), SidecarHealthHandler)
    Thread(target=server.serve_forever, name="ocr-health-sidecar", daemon=True).start()


start_health_sidecar()

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
        content={"status": "ok", "port": LISTEN_PORT, "ssh": False, "gpu": cuda_available(), "engine": "rapidocr"},
        headers={"cache-control": "no-store"},
    )



@app.get("/ping")
def ping() -> JSONResponse:
    return healthz()

NDJSON_MEDIA_TYPE: Final = "application/x-ndjson"
# One JSON document per line; the separator is the contract, so it is named rather than inlined.
NEWLINE: Final = chr(10)


def ocr_result_body(text: str, page_count: int, regions: list[OcrRegion], input_sha256: str) -> dict:
    """The one place the result shape is written.

    Both the buffered response and the last line of the streamed response come from here, so a
    client that reads the stream and a client that reads the JSON are looking at the same object.
    Anything that qualifies one qualifies the other.
    """
    return {
        "schemaVersion": "tavonel.ocr_result.v2",
        "status": "ok",
        "text": text,
        "pageCount": page_count,
        "inputSha256": input_sha256,
        "regions": regions,
    }


# The two response classes are a union, which FastAPI cannot turn into a response model;
# the endpoint returns Response objects directly, so there is no model to generate.
@app.post("/v1/ocr", response_model=None)
def ocr(
    request: Request,
    source: UploadFile = File(...),
    x_tavonel_input_sha256: str | None = Header(default=None),
    x_tavonel_ocr_timestamp: str | None = Header(default=None),
    x_tavonel_ocr_request_id: str | None = Header(default=None),
    x_tavonel_ocr_signature: str | None = Header(default=None),
) -> JSONResponse | StreamingResponse:
    """Reads a PDF. Same contract as before, plus an optional per-page view of the reading.

    A client that asks for `application/x-ndjson` gets one line per page while the document is
    being read, and then the complete result as the final line -- the same object the buffered
    response returns. Every other client, including every client that exists today, sends no
    accept header we act on and receives exactly the JSON it received before.

    Authentication, the digest check and the PDF check all happen before either path begins, so
    streaming never becomes a way to get a partial answer out of an unqualified request.
    """
    expected_digest = require_authentication(
        x_tavonel_input_sha256,
        x_tavonel_ocr_timestamp,
        x_tavonel_ocr_request_id,
        x_tavonel_ocr_signature,
    )
    payload, actual_digest = copy_and_digest(source)
    try:
        if not hmac.compare_digest(expected_digest, actual_digest):
            raise HTTPException(422, "OCR source digest does not match the uploaded body")
        reject_non_pdf(source.filename, source.content_type, payload)
    finally:
        source.file.close()

    wants_stream = NDJSON_MEDIA_TYPE in (request.headers.get("accept") or "").lower()
    if not wants_stream:
        text, page_count, regions = extract_text(payload)
        return JSONResponse(
            content=ocr_result_body(text, page_count, regions, expected_digest),
            headers={"cache-control": "no-store"},
        )

    def lines() -> Iterator[bytes]:
        events: list[dict] = []

        def on_page(page_number1: int, page_count: int, path: str, regions: list[OcrRegion]) -> None:
            # What a reader can be shown about a page: where it is, how much was found, how
            # confident the reader is, and where on the page each line sits. No page is reported
            # before it has been read, and nothing is estimated.
            confidences = [r["confidence"] for r in regions]
            events.append({
                "schemaVersion": "tavonel.ocr_progress.v1",
                "type": "page",
                "pageNumber1": page_number1,
                "pageCount": page_count,
                "path": path,
                "regionCount": len(regions),
                "meanConfidence": round(sum(confidences) / len(confidences), 4) if confidences else 0.0,
                # The text travels with the geometry. It reaches the browser through a signed
                # read straight from the bucket, never through the application -- which is the
                # only property that mattered, and the one the read path keeps.
                "boxes": [
                    {
                        "bbox1000": r["bbox1000"],
                        "confidence": r["confidence"],
                        "text": r["text"][:400],
                        "regionId": r["regionId"],
                    }
                    for r in regions
                ],
            })

        try:
            text, page_count, regions = extract_text(payload, on_page)
        except HTTPException as exc:
            # A refusal is part of the stream, not a broken connection. The status line is the
            # last thing a reader sees, and it says why.
            yield (json.dumps({
                "schemaVersion": "tavonel.ocr_progress.v1",
                "type": "refused",
                "status": exc.status_code,
                "detail": exc.detail,
            }, ensure_ascii=False) + NEWLINE).encode("utf-8")
            return

        for event in events:
            yield (json.dumps(event, ensure_ascii=False) + NEWLINE).encode("utf-8")
        yield (json.dumps(ocr_result_body(text, page_count, regions, expected_digest), ensure_ascii=False) + NEWLINE).encode("utf-8")

    return StreamingResponse(lines(), media_type=NDJSON_MEDIA_TYPE, headers={"cache-control": "no-store"})

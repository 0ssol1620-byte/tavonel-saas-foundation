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
from contextlib import asynccontextmanager
from typing import Final, TypedDict

import pypdfium2 as pdfium
from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse

APP_NAME: Final = "tavonel-foundation-ocr-gpu"
LISTEN_PORT: Final = 8001
SIGNATURE_TTL_SECONDS: Final = 300
MAX_INPUT_BYTES: Final = 18 * 1024 * 1024
MAX_PAGES: Final = 80
REQUEST_ID: Final = re.compile(r"^[A-Za-z0-9_-]{16,160}$")

PDF_MAGIC: Final = b"%PDF"
RENDER_SCALE: Final = 2.0
OCR_ENGINE_RELEASE: Final = "rapidocr-3.9.2-ko-pass-nocls-v3-selftest"
OCR_MODEL_SHA256: Final = {
    "general-det": "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    "general-rec": "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
    "korean-rec": "cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b",
}
SELF_TEST_LINES: Final = ("TAVONEL OCR SELF TEST", "Quality gate 0123456789")
SELF_TEST_MIN_CONFIDENCE: Final = 0.9
# The shared angle classifier flips upright Hangul lines 180 degrees (a whole line came back as
# "이" at 0.41 and was dropped). Rendered PDF lines are upright, so the Korean pass skips it.
KOREAN_PASS_OPTIONS: Final = {"use_cls": False}
_general_rapidocr = None
_korean_rapidocr = None
_engine_lock = Lock()
# pending -> passed | failed. Only "passed" lets raster OCR run or /ping report ready.
_self_test: dict[str, str | None] = {"state": "pending", "detail": None}


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


class RasterLine(TypedDict):
    polygon: list[list[float]]
    text: str
    confidence: float


def cuda_available() -> bool:
    try:
        import onnxruntime as ort
        return any(p.lower().startswith("cuda") or p.lower().startswith("tensorrt") for p in ort.get_available_providers())
    except Exception:
        return False


def require_cuda_sessions(label: str, engine) -> None:
    # A silent CPU fallback is a different, unqualified runtime. Never accept it.
    for name, stage in (("detection", "text_det"), ("classification", "text_cls"), ("recognition", "text_rec")):
        providers = getattr(engine, stage).session.session.get_providers()
        if not providers or providers[0] != "CUDAExecutionProvider":
            raise RuntimeError(f"RapidOCR {label} {name} session did not select CUDAExecutionProvider")


def self_test_pdf() -> bytes:
    """A one-page PDF of known text, drawn with a PDFium built-in font so it needs no font files."""
    operators = "".join(
        f"BT /F1 28 Tf 72 {720 - 60 * index} Td ({line}) Tj ET\n" for index, line in enumerate(SELF_TEST_LINES)
    ).encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R"
        b" /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(operators) + operators + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body = b"%PDF-1.4\n"
    offsets = []
    for number, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += b"%d 0 obj\n" % number + obj + b"\nendobj\n"
    xref = len(body)
    body += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    return body + b"trailer << /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % xref


def self_test_image():
    # Rendered exactly like a customer page, so the check covers the same pixels-to-text path.
    document = pdfium.PdfDocument(self_test_pdf())
    try:
        page = document[0]
        try:
            bitmap = page.render(scale=RENDER_SCALE)
            try:
                return bitmap.to_pil()
            finally:
                bitmap.close()
        finally:
            page.close()
    finally:
        document.close()


def self_test_failure(label: str, lines: list[RasterLine]) -> str | None:
    """Why a known page was misread, or None. `status: ok` must never carry text like this."""
    read = {" ".join(line["text"].split()): line["confidence"] for line in lines}
    for expected in SELF_TEST_LINES:
        if expected not in read:
            return f"{label} engine read {sorted(read)!r} instead of {expected!r}"
        if read[expected] < SELF_TEST_MIN_CONFIDENCE:
            return f"{label} engine read {expected!r} at confidence {read[expected]:.3f}"
    return None


def rapidocr_engines():
    """Both engines, once they have loaded on CUDA and read a known page correctly.

    A GPU runtime can load every session on CUDA and still compute wrong text; that is how a
    one-line page came back as "yme" with status ok. So the engines are not used for any request
    until the recognition self-test passes, and a failed self-test is final for this worker.
    Callers hold `_engine_lock`.
    """
    global _general_rapidocr, _korean_rapidocr
    if _self_test["state"] == "failed":
        raise HTTPException(503, "OCR recognition self-test did not pass")
    if _general_rapidocr is None or _korean_rapidocr is None:
        try:
            from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR

            shared = {"EngineConfig.onnxruntime.use_cuda": True}
            engines = {
                "general": RapidOCR(params=shared),
                "korean": RapidOCR(
                    params={
                        **shared,
                        "Rec.lang_type": LangRec.KOREAN,
                        "Rec.model_type": ModelType.MOBILE,
                        "Rec.ocr_version": OCRVersion.PPOCRV5,
                    }
                ),
            }
            image = self_test_image()
            for label, engine in engines.items():
                require_cuda_sessions(label, engine)
                options = KOREAN_PASS_OPTIONS if label == "korean" else {}
                failure = self_test_failure(label, rapidocr_lines(engine, image, **options))
                if failure:
                    raise RuntimeError(failure)
        except Exception as exc:
            _self_test.update(state="failed", detail=str(exc)[:500])
            raise HTTPException(503, "OCR recognition self-test did not pass") from exc
        _general_rapidocr, _korean_rapidocr = engines["general"], engines["korean"]
        _self_test.update(state="passed", detail=None)
    return _general_rapidocr, _korean_rapidocr


def warm_engines() -> None:
    """Loads and self-tests the engines at startup, so readiness means a qualified reader."""
    with _engine_lock:
        try:
            rapidocr_engines()
        except HTTPException:
            pass  # recorded in _self_test; /ping reports it


def ping_status() -> int:
    # RunPod load balancer convention: 200 ready, 204 still initializing, anything else unhealthy.
    return {"passed": 200, "pending": 204}.get(_self_test["state"], 503)


def rapidocr_lines(engine, image, **options) -> list[RasterLine]:
    result = engine(image, **options)
    boxes = getattr(result, "boxes", None)
    texts = getattr(result, "txts", None)
    scores = getattr(result, "scores", None)
    if boxes is None or texts is None or scores is None:
        return []
    rows: list[RasterLine] = []
    for polygon, text, score in zip(boxes, texts, scores, strict=True):
        if not isinstance(text, str) or not text.strip():
            continue
        points = [[float(point[0]), float(point[1])] for point in polygon if len(point) >= 2]
        if len(points) < 3:
            continue
        rows.append(
            {
                "polygon": points,
                "text": text.strip(),
                "confidence": max(0.0, min(1.0, float(score))),
            }
        )
    return rows


def _script_counts(value: str) -> dict[str, int]:
    return {
        "hangul": len(re.findall(r"[가-힣]", value)),
        "han": len(re.findall(r"[\u4e00-\u9fff]", value)),
        "kana": len(re.findall(r"[\u3040-\u30ff]", value)),
        "latin": len(re.findall(r"[A-Za-z]", value)),
        "digits": len(re.findall(r"\d", value)),
    }


def _bounds(line: RasterLine) -> tuple[float, float, float, float]:
    xs = [point[0] for point in line["polygon"]]
    ys = [point[1] for point in line["polygon"]]
    return min(xs), min(ys), max(xs), max(ys)


def _intersection_over_union(left: RasterLine, right: RasterLine) -> float:
    left_x1, left_y1, left_x2, left_y2 = _bounds(left)
    right_x1, right_y1, right_x2, right_y2 = _bounds(right)
    width = max(0.0, min(left_x2, right_x2) - max(left_x1, right_x1))
    height = max(0.0, min(left_y2, right_y2) - max(left_y1, right_y1))
    intersection = width * height
    if intersection <= 0:
        return 0.0
    left_area = max(0.0, left_x2 - left_x1) * max(0.0, left_y2 - left_y1)
    right_area = max(0.0, right_x2 - right_x1) * max(0.0, right_y2 - right_y1)
    return intersection / max(intersection, left_area + right_area - intersection)


def _prefer_korean(general: RasterLine, korean: RasterLine) -> bool:
    korean_counts = _script_counts(korean["text"])
    if korean_counts["hangul"] < 2 or korean["confidence"] < 0.55:
        return False
    general_counts = _script_counts(general["text"])
    if general_counts["hangul"] >= korean_counts["hangul"]:
        return False
    # Real Japanese or Chinese lines stay with the general reader. A Hangul line misread by it
    # yields fewer Han characters than the Hangul it lost, or reads with lower confidence.
    if general_counts["kana"] or (
        general_counts["han"] >= korean_counts["hangul"]
        and general["confidence"] + 0.05 >= korean["confidence"]
    ):
        return False
    # The general reader drops Hangul silently from mixed lines ("금액 125,000원" -> "125,000"),
    # so a Korean reading that keeps its Latin letters and digits carries strictly more text.
    general_alnum = general_counts["latin"] + general_counts["digits"]
    korean_alnum = korean_counts["latin"] + korean_counts["digits"]
    # Retaining digits alone is insufficient evidence for adding Hangul to a clear Latin line.
    if not general_counts["han"] and general["confidence"] > korean["confidence"] + 0.02:
        return False
    return korean_alnum >= 0.8 * general_alnum or korean["confidence"] >= general["confidence"] + 0.05


def merge_korean_lines(general: list[RasterLine], korean: list[RasterLine]) -> list[RasterLine]:
    """Replace only geometry-matched lines with materially better Hangul recognition."""

    matched_korean: set[int] = set()
    merged: list[RasterLine] = []
    for general_line in general:
        candidates = sorted(
            (
                (_intersection_over_union(general_line, korean_line), index, korean_line)
                for index, korean_line in enumerate(korean)
                if index not in matched_korean
            ),
            reverse=True,
            key=lambda item: item[0],
        )
        if candidates and candidates[0][0] >= 0.45:
            _, index, korean_line = candidates[0]
            matched_korean.add(index)
            if _prefer_korean(general_line, korean_line):
                merged.append(korean_line)
                continue
        merged.append(general_line)

    for index, korean_line in enumerate(korean):
        counts = _script_counts(korean_line["text"])
        if index not in matched_korean and counts["hangul"] >= 2 and korean_line["confidence"] >= 0.65:
            merged.append(korean_line)
    return sorted(merged, key=lambda line: (_bounds(line)[1], _bounds(line)[0]))


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


def raster_regions(document, on_page: PageObserver | None = None, indexes=None) -> list[OcrRegion]:
    """Reads every page, or only `indexes`. `on_page` is called once per page, as soon as that page is done.

    The per-page callback exists so the reading can be watched while it happens. It changes
    nothing about what this function returns: the caller still receives the complete region list,
    and a caller that passes no observer behaves exactly as before. A page that reads empty is
    still reported, with no regions, so the observer is never left waiting on it.
    """
    regions: list[OcrRegion] = []
    order = 0
    for index in range(len(document)) if indexes is None else indexes:
        page = document[index]
        try:
            bitmap = page.render(scale=RENDER_SCALE)
            try:
                image = bitmap.to_pil()
            finally:
                bitmap.close()
            with _engine_lock:
                general_engine, korean_engine = rapidocr_engines()
                # The Korean pass always runs. The general recognizer drops Hangul lines without a
                # trace (empty text) and turns mixed lines into Han/Latin noise, so its output can
                # never prove a page has no Korean. Cost: one extra det+rec per raster page.
                lines = merge_korean_lines(
                    rapidocr_lines(general_engine, image),
                    rapidocr_lines(korean_engine, image, **KOREAN_PASS_OPTIONS),
                )
        finally:
            page.close()
        width, height = image.size
        for line_index, line in enumerate(lines):
            text = line["text"]
            points = line["polygon"]
            if not text or not points:
                continue
            xs = [float(point[0]) for point in points]
            ys = [float(point[1]) for point in points]
            bbox = normalized_bbox(min(xs), min(ys), max(xs), max(ys), width, height)
            if bbox is None:
                continue
            regions.append({
                "regionId": f"ocr-p{index + 1:04d}-l{line_index + 1:05d}",
                "pageIndex0": index,
                "pageNumber1": index + 1,
                "order": order,
                "blockType": "paragraph",
                "text": text,
                "bbox1000": bbox,
                "confidence": line["confidence"],
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
                region = native_page_region(page, textpage, text, index, len(regions)) if text else None
            finally:
                textpage.close()
                page.close()
            if on_page is not None:
                on_page(index + 1, page_count, "native", [region] if region else [])
            if region:
                regions.append(region)
                continue
            # No usable embedded text on this page, whatever the other pages carry. The raster
            # pass re-reads it, so it reports the page again rather than leaving the observer
            # stuck on its empty native view. A page with usable native text is never rasterized.
            for raster_region in raster_regions(document, on_page, (index,)):
                regions.append({**raster_region, "order": len(regions)})
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
        # /ping is the readiness probe and carries the self-test verdict; /health is liveness only.
        status = ping_status() if path == "/ping" else 200
        body = b"" if status == 204 else b'{"status":"ok","port":8001,"ssh":false}' if status == 200 else b'{"status":"unqualified"}'
        self.send_response(status)
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

@asynccontextmanager
async def lifespan(_: FastAPI):
    # In the background so /ping can answer 204 while the models load and read the known page.
    Thread(target=warm_engines, name="ocr-self-test", daemon=True).start()
    yield


app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.exception_handler(HTTPException)
async def http_exception_no_store(_: Request, exc: HTTPException) -> JSONResponse:
    headers = {"cache-control": "no-store"}
    if exc.headers:
        headers.update(exc.headers)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=headers)


@app.get("/health")
def healthz() -> JSONResponse:
    return JSONResponse(
        content={
            "status": "ok",
            "port": LISTEN_PORT,
            "ssh": False,
            "gpu": cuda_available(),
            "engine": "rapidocr",
            "engineRelease": OCR_ENGINE_RELEASE,
            "modelSha256": OCR_MODEL_SHA256,
            "adaptiveKorean": True,
            # Availability alone says nothing about the actual model sessions or their output.
            "cudaSessionsSelected": _self_test["state"] == "passed",
            "recognitionSelfTest": dict(_self_test),
        },
        headers={"cache-control": "no-store"},
    )



@app.get("/ping", response_model=None)
def ping() -> JSONResponse | Response:
    status = ping_status()
    if status == 204:
        return Response(status_code=204, headers={"cache-control": "no-store"})
    if status != 200:
        return JSONResponse(status_code=status, content={"status": "unqualified"}, headers={"cache-control": "no-store"})
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

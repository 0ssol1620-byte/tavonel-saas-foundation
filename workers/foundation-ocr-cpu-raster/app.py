"""CPU raster OCR worker. A separate CPU qualification; it never stands in for the GPU worker."""

from __future__ import annotations

import base64
import hashlib
import hmac
import math
import os
import re
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from importlib import metadata
from pathlib import Path
from threading import Lock, Thread
from time import monotonic
from typing import Final, TypedDict

import pypdfium2 as pdfium
from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

APP_NAME: Final = "tavonel-foundation-ocr-cpu-raster"
LISTEN_PORT: Final = 8001
SIGNATURE_TTL_SECONDS: Final = 300
MAX_INPUT_BYTES: Final = 18 * 1024 * 1024
MAX_PAGES: Final = 80
REQUEST_ID: Final = re.compile(r"^[A-Za-z0-9_-]{16,160}$")

PDF_MAGIC: Final = b"%PDF"
RENDER_SCALE: Final = 2.0
# Raster budgets, checked for every page that would be rasterized before any page is rendered.
# Sizes are counted as the renderer allocates them: ceil(points * RENDER_SCALE) per side.
MAX_RASTER_SIDE_PX: Final = 8192
# 16 MiP per page: an A1 page (1684 x 2384 pt) still fits at RENDER_SCALE.
MAX_RASTER_PAGE_PIXELS: Final = 16 * 1024 * 1024
# 4 MiP for each of MAX_PAGES pages (an A3 page is about 4.0 MP at RENDER_SCALE), across the document.
MAX_RASTER_TOTAL_PIXELS: Final = MAX_PAGES * 4 * 1024 * 1024
PAGE_GEOMETRY_REFUSAL: Final = "OCR source page geometry is not qualified"
OCR_ENGINE_RELEASE: Final = "rapidocr-3.9.2-ko-pass-nocls-v3-cpu-raster-selftest"
# Same pinned weights as the GPU worker; materialize_models.py checks them at image build time.
OCR_MODEL_FILES: Final = {
    "general-det": ("PP-OCRv6_det_small.onnx", "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f"),
    "general-rec": ("PP-OCRv6_rec_small.onnx", "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884"),
    "korean-rec": ("korean_PP-OCRv5_rec_mobile.onnx", "cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b"),
}
OCR_MODEL_SHA256: Final = {label: digest for label, (_, digest) in OCR_MODEL_FILES.items()}
PINNED_RUNTIME: Final = {"onnxruntime": "1.20.1", "rapidocr": "3.9.2"}
FORBIDDEN_RUNTIME: Final = ("onnxruntime-gpu", "onnxruntime-directml", "onnxruntime-openvino")
CPU_PROVIDER: Final = "CPUExecutionProvider"
ACCELERATOR_PROVIDER_MARKERS: Final = ("cuda", "tensorrt", "rocm", "migraphx", "dml", "coreml", "openvino", "cann", "qnn")
CPU_ENGINE_PARAMS: Final = {"EngineConfig.onnxruntime.use_cuda": False}
SELF_TEST_LINES: Final = ("TAVONEL OCR SELF TEST", "Quality gate 0123456789")
SELF_TEST_MIN_CONFIDENCE: Final = 0.9
# Drawing coordinates of the known page, in PDF points (origin at the bottom left).
SELF_TEST_PAGE_POINTS: Final = (612, 792)
SELF_TEST_FONT_SIZE: Final = 28
SELF_TEST_LEFT: Final = 72
SELF_TEST_FIRST_BASELINE: Final = 720
SELF_TEST_LINE_STEP: Final = 60
# Share of a known line's box that must fall inside that line's expected region.
SELF_TEST_MIN_REGION_SHARE: Final = 0.6
# Share of dark pixels below which a rendered page is treated as blank rather than as text.
SELF_TEST_MIN_INK: Final = 0.001
# The shared angle classifier flips upright Hangul lines 180 degrees. Rendered PDF lines are
# upright, so the Korean pass skips it (same behavior as the GPU worker).
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


def installed_version(distribution: str) -> str | None:
    try:
        return metadata.version(distribution)
    except metadata.PackageNotFoundError:
        return None


def require_cpu_runtime() -> None:
    """The installed runtime must be the pinned CPU-only build; an accelerator build is a different runtime."""
    for distribution in FORBIDDEN_RUNTIME:
        if installed_version(distribution) is not None:
            raise RuntimeError(f"{distribution} is installed; only the CPU onnxruntime build is qualified")
    for distribution, pinned in PINNED_RUNTIME.items():
        if installed_version(distribution) != pinned:
            raise RuntimeError(f"{distribution}=={pinned} is required")
    import onnxruntime as ort

    available = list(ort.get_available_providers())
    if CPU_PROVIDER not in available:
        raise RuntimeError("onnxruntime does not offer CPUExecutionProvider")
    accelerators = [p for p in available if any(marker in p.lower() for marker in ACCELERATOR_PROVIDER_MARKERS)]
    if accelerators:
        raise RuntimeError(f"onnxruntime offers accelerator providers {accelerators}; only the CPU build is qualified")


def rapidocr_model_dir() -> Path:
    import rapidocr

    return Path(rapidocr.__file__).parent / "models"


def verify_model_files() -> None:
    """Every pinned weight must already be in the image. A missing file would make RapidOCR download it."""
    model_dir = rapidocr_model_dir()
    for name, expected in OCR_MODEL_FILES.values():
        path = model_dir / name
        if not path.is_file():
            raise RuntimeError(f"RapidOCR model {name} is not materialized; runtime downloads are refused")
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f"RapidOCR model digest mismatch: {name}")


def model_snapshot() -> dict[str, tuple[int, int]]:
    model_dir = rapidocr_model_dir()
    if not model_dir.is_dir():
        return {}
    return {
        str(path.relative_to(model_dir)): (path.stat().st_size, path.stat().st_mtime_ns)
        for path in model_dir.rglob("*")
        if path.is_file()
    }


def require_cpu_sessions(label: str, engine) -> None:
    # A GPU or other accelerator session is a different, unqualified runtime. Never accept it.
    for name, stage in (("detection", "text_det"), ("classification", "text_cls"), ("recognition", "text_rec")):
        providers = list(getattr(engine, stage).session.session.get_providers())
        if providers != [CPU_PROVIDER]:
            raise RuntimeError(f"RapidOCR {label} {name} session did not select only CPUExecutionProvider: {providers}")


def self_test_pdf() -> bytes:
    """A one-page PDF of known text, drawn with a PDFium built-in font so it needs no font files."""
    operators = "".join(
        f"BT /F1 {SELF_TEST_FONT_SIZE} Tf {SELF_TEST_LEFT} {SELF_TEST_FIRST_BASELINE - SELF_TEST_LINE_STEP * index} Td"
        f" ({line}) Tj ET\n"
        for index, line in enumerate(SELF_TEST_LINES)
    ).encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Contents 4 0 R"
        b" /Resources << /Font << /F1 5 0 R >> >> >>" % SELF_TEST_PAGE_POINTS,
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


def render_page(page):
    bitmap = page.render(scale=RENDER_SCALE)
    try:
        return bitmap.to_pil()
    finally:
        bitmap.close()


def self_test_image():
    # Rendered exactly like a scanned page, so the check covers the same pixels-to-text path.
    document = pdfium.PdfDocument(self_test_pdf())
    try:
        page = document[0]
        try:
            return render_page(page)
        finally:
            page.close()
    finally:
        document.close()


def ink_fraction(image) -> float:
    gray = image.convert("L")
    histogram = gray.histogram()
    return sum(histogram[:128]) / max(1, gray.width * gray.height)


def self_test_regions() -> list[tuple[float, float, float, float]]:
    """Broad (left, top, right, bottom) page fractions where each known line must be read.

    Derived from the drawing coordinates in `self_test_pdf`, not from OCR output. Horizontally the
    page inside half the left margin: the text starts at the margin and ends well short of the right
    edge. Vertically one line step centered on the glyphs' middle (baseline minus a third of the font
    size), so neighboring lines' bands touch but never overlap.
    """
    page_width, page_height = SELF_TEST_PAGE_POINTS
    margin = SELF_TEST_LEFT / 2
    regions = []
    for index in range(len(SELF_TEST_LINES)):
        baseline_from_top = page_height - (SELF_TEST_FIRST_BASELINE - SELF_TEST_LINE_STEP * index)
        middle = baseline_from_top - SELF_TEST_FONT_SIZE / 3
        regions.append((
            margin / page_width,
            (middle - SELF_TEST_LINE_STEP / 2) / page_height,
            (page_width - margin) / page_width,
            (middle + SELF_TEST_LINE_STEP / 2) / page_height,
        ))
    return regions


def share_inside(line: RasterLine, region: tuple[float, float, float, float], width: int, height: int) -> float:
    """Fraction of the line's box that lies inside a page-fraction region of a width x height image."""
    left, top, right, bottom = _bounds(line)
    area = (right - left) * (bottom - top)
    if not area > 0:
        return 0.0
    x1, y1, x2, y2 = region[0] * width, region[1] * height, region[2] * width, region[3] * height
    overlap = max(0.0, min(right, x2) - max(left, x1)) * max(0.0, min(bottom, y2) - max(top, y1))
    return overlap / area


def self_test_failure(label: str, lines: list[RasterLine], width: int, height: int) -> str | None:
    """Why a known page was misread, or None. `status: ok` must never carry text like this."""
    read = {" ".join(line["text"].split()): line for line in lines}
    for expected, region in zip(SELF_TEST_LINES, self_test_regions(), strict=True):
        if expected not in read:
            return f"{label} engine read {sorted(read)!r} instead of {expected!r}"
        line = read[expected]
        if line["confidence"] < SELF_TEST_MIN_CONFIDENCE:
            return f"{label} engine read {expected!r} at confidence {line['confidence']:.3f}"
        share = share_inside(line, region, width, height)
        if share < SELF_TEST_MIN_REGION_SHARE:
            return f"{label} engine read {expected!r} outside its expected region ({share:.2f} inside)"
    return None


def rapidocr_engines():
    """Both engines, once they have loaded on CPU only and read a known rendered page correctly.

    The engines are not used for any request until the pixel self-test passes, and a failed
    self-test is final for this worker. Callers hold `_engine_lock`.
    """
    global _general_rapidocr, _korean_rapidocr
    if _self_test["state"] == "failed":
        raise HTTPException(503, "OCR recognition self-test did not pass")
    if _general_rapidocr is None or _korean_rapidocr is None:
        try:
            require_cpu_runtime()
            verify_model_files()
            from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR

            before = model_snapshot()
            engines = {
                "general": RapidOCR(params=dict(CPU_ENGINE_PARAMS)),
                "korean": RapidOCR(
                    params={
                        **CPU_ENGINE_PARAMS,
                        "Rec.lang_type": LangRec.KOREAN,
                        "Rec.model_type": ModelType.MOBILE,
                        "Rec.ocr_version": OCRVersion.PPOCRV5,
                    }
                ),
            }
            if model_snapshot() != before:
                raise RuntimeError("RapidOCR changed its model directory while loading; runtime downloads are refused")
            image = self_test_image()
            if ink_fraction(image) < SELF_TEST_MIN_INK:
                raise RuntimeError("Self-test page rendered without visible pixels")
            for label, engine in engines.items():
                require_cpu_sessions(label, engine)
                options = KOREAN_PASS_OPTIONS if label == "korean" else {}
                failure = self_test_failure(label, rapidocr_lines(engine, image, **options), *image.size)
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
    # 200 ready, 204 still initializing, anything else unhealthy.
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
        rows.append({"polygon": points, "text": text.strip(), "confidence": max(0.0, min(1.0, float(score)))})
    return rows


def _script_counts(value: str) -> dict[str, int]:
    return {
        "hangul": len(re.findall(r"[가-힣]", value)),
        "han": len(re.findall(r"[一-鿿]", value)),
        "kana": len(re.findall(r"[぀-ヿ]", value)),
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
    if general_counts["kana"] or (
        general_counts["han"] >= korean_counts["hangul"]
        and general["confidence"] + 0.05 >= korean["confidence"]
    ):
        return False
    general_alnum = general_counts["latin"] + general_counts["digits"]
    korean_alnum = korean_counts["latin"] + korean_counts["digits"]
    if not general_counts["han"] and general["confidence"] > korean["confidence"] + 0.02:
        return False
    return korean_alnum >= 0.8 * general_alnum or korean["confidence"] >= general["confidence"] + 0.05


def merge_korean_lines(general: list[RasterLine], korean: list[RasterLine]) -> list[RasterLine]:
    """Replace only geometry-matched lines with materially better Hangul recognition (as the GPU worker)."""
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


def normalized_bbox(left: float, top: float, right: float, bottom: float, width: float, height: float) -> list[int] | None:
    if width <= 0 or height <= 0:
        return None
    x1 = max(0, min(999, round(1000 * left / width)))
    y1 = max(0, min(999, round(1000 * top / height)))
    x2 = max(x1 + 1, min(1000, round(1000 * right / width)))
    y2 = max(y1 + 1, min(1000, round(1000 * bottom / height)))
    return [x1, y1, x2, y2]


def raster_page_regions(page, index: int, order: int) -> list[OcrRegion]:
    """Reads one scanned or image-only page from its rendered pixels."""
    image = render_page(page)
    with _engine_lock:
        general_engine, korean_engine = rapidocr_engines()
        # The Korean pass always runs: the general recognizer drops Hangul lines without a trace.
        lines = merge_korean_lines(
            rapidocr_lines(general_engine, image),
            rapidocr_lines(korean_engine, image, **KOREAN_PASS_OPTIONS),
        )
    width, height = image.size
    regions: list[OcrRegion] = []
    for line_index, line in enumerate(lines):
        xs = [point[0] for point in line["polygon"]]
        ys = [point[1] for point in line["polygon"]]
        bbox = normalized_bbox(min(xs), min(ys), max(xs), max(ys), width, height)
        if not line["text"] or bbox is None:
            continue
        regions.append({
            "regionId": f"ocr-p{index + 1:04d}-l{line_index + 1:05d}",
            "pageIndex0": index,
            "pageNumber1": index + 1,
            "order": order + len(regions),
            "blockType": "paragraph",
            "text": line["text"],
            "bbox1000": bbox,
            "confidence": line["confidence"],
            "authority": "informal",
        })
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
    if normalized_mime(mime) not in {"application/pdf", "application/x-pdf"} or suffix not in {"", "pdf"}:
        raise HTTPException(422, "OCR source is not a PDF")
    if not payload.startswith(PDF_MAGIC):
        raise HTTPException(422, "OCR source is not a PDF")


def page_points(page) -> tuple[float, float]:
    """The page size in points; refused unless both sides are finite and positive."""
    try:
        width, height = (float(value) for value in page.get_size())
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, PAGE_GEOMETRY_REFUSAL) from exc
    if not (math.isfinite(width) and math.isfinite(height) and width > 0 and height > 0):
        raise HTTPException(422, PAGE_GEOMETRY_REFUSAL)
    return width, height


def raster_pixels(width: float, height: float) -> int:
    """Pixels one render at RENDER_SCALE allocates, rounded up like the renderer; refused over the bounds."""
    sides = []
    for points in (width, height):
        scaled = points * RENDER_SCALE
        # Checked before rounding, so NaN or an overflowed side never reaches math.ceil.
        if not 0 < scaled <= MAX_RASTER_SIDE_PX:
            raise HTTPException(422, PAGE_GEOMETRY_REFUSAL)
        sides.append(math.ceil(scaled))
    pixels = sides[0] * sides[1]
    if pixels > MAX_RASTER_PAGE_PIXELS:
        raise HTTPException(422, PAGE_GEOMETRY_REFUSAL)
    return pixels


def extract_text(payload: bytes) -> tuple[str, int, list[OcrRegion]]:
    """Pages with embedded text keep it; scanned or image-only pages are rasterized and read on CPU."""
    try:
        document = pdfium.PdfDocument(payload)
    except Exception as exc:
        raise HTTPException(422, "OCR renderer rejected this PDF") from exc
    try:
        page_count = len(document)
        if page_count < 1 or page_count > MAX_PAGES:
            raise HTTPException(422, "OCR source page count is not qualified")
        # Every page is checked before the first render, so a later unsafe page refuses the whole
        # document. Reading the text layer renders nothing, so only pages without one are budgeted.
        native: list[OcrRegion | None] = []
        total_pixels = 0
        for index in range(page_count):
            page = document[index]
            try:
                width, height = page_points(page)
                textpage = page.get_textpage()
                try:
                    text = textpage.get_text_bounded().strip()
                    region = native_page_region(page, textpage, text, index, 0) if text else None
                finally:
                    textpage.close()
                if region is None:
                    total_pixels += raster_pixels(width, height)
                    if total_pixels > MAX_RASTER_TOTAL_PIXELS:
                        raise HTTPException(422, PAGE_GEOMETRY_REFUSAL)
                native.append(region)
            finally:
                page.close()
        regions: list[OcrRegion] = []
        for index, region in enumerate(native):
            if region is not None:
                regions.append({**region, "order": len(regions)})
                continue
            page = document[index]
            try:
                regions.extend(raster_page_regions(page, index, len(regions)))
            finally:
                page.close()
        text = "\n".join(region["text"] for region in regions).strip()
        if not text:
            raise HTTPException(422, "OCR source has no extractable text regions")
        return text, page_count, regions
    finally:
        document.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # In the background so /ping can answer 204 while the models load and read the known page.
    Thread(target=warm_engines, name="ocr-cpu-self-test", daemon=True).start()
    yield


app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
NO_STORE: Final = {"cache-control": "no-store"}


# Starlette's base class also covers routing 404/405 responses.
@app.exception_handler(StarletteHTTPException)
async def http_exception_no_store(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    headers = dict(NO_STORE)
    if exc.headers:
        headers.update(exc.headers)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=headers)


@app.exception_handler(RequestValidationError)
async def validation_error_no_store(_: Request, __: RequestValidationError) -> JSONResponse:
    # Field errors can echo submitted values, so only a fixed message is returned.
    return JSONResponse(status_code=422, content={"detail": "OCR request is malformed"}, headers=dict(NO_STORE))


@app.exception_handler(Exception)
async def unexpected_exception_no_store(_: Request, __: Exception) -> JSONResponse:
    # Never echo exception text: it could carry source-derived content.
    return JSONResponse(status_code=500, content={"detail": "OCR worker failed"}, headers=dict(NO_STORE))


@app.get("/health")
def healthz() -> JSONResponse:
    passed = _self_test["state"] == "passed"
    return JSONResponse(
        content={
            "status": "ok",
            "service": APP_NAME,
            "port": LISTEN_PORT,
            "ssh": False,
            # CPU qualification only; this worker is never evidence for the GPU worker.
            "qualification": "cpu-raster-ocr",
            "accelerator": "cpu",
            "gpu": False,
            "engine": "rapidocr",
            "engineRelease": OCR_ENGINE_RELEASE,
            "modelSha256": OCR_MODEL_SHA256,
            "adaptiveKorean": True,
            "executionProvider": CPU_PROVIDER if passed else None,
            "cpuSessionsSelected": passed,
            "ready": passed,
            "recognitionSelfTest": dict(_self_test),
        },
        headers=dict(NO_STORE),
    )


@app.get("/ping", response_model=None)
def ping() -> JSONResponse | Response:
    status = ping_status()
    if status == 204:
        return Response(status_code=204, headers=dict(NO_STORE))
    if status != 200:
        return JSONResponse(status_code=status, content={"status": "unqualified"}, headers=dict(NO_STORE))
    return healthz()


def ocr_result_body(text: str, page_count: int, regions: list[OcrRegion], input_sha256: str) -> dict:
    return {
        "schemaVersion": "tavonel.ocr_result.v2",
        "status": "ok",
        "text": text,
        "pageCount": page_count,
        "inputSha256": input_sha256,
        "regions": regions,
    }


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
    payload, actual_digest = copy_and_digest(source)
    try:
        if not hmac.compare_digest(expected_digest, actual_digest):
            raise HTTPException(422, "OCR source digest does not match the uploaded body")
        reject_non_pdf(source.filename, source.content_type, payload)
    finally:
        source.file.close()
    text, page_count, regions = extract_text(payload)
    return JSONResponse(content=ocr_result_body(text, page_count, regions, expected_digest), headers=dict(NO_STORE))

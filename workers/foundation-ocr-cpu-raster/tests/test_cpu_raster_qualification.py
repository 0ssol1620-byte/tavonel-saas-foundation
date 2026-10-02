"""Real CPU OCR qualification: pinned onnxruntime 1.20.1 (CPU build) and RapidOCR 3.9.2, no fakes.

The source is an operator-owned synthetic image-only PDF generated here: known text is drawn into
pixels with Pillow and embedded as the page's only content, with no text layer. Nothing is
downloaded or customer-supplied. Passing this is CPU OCR evidence only; it says nothing about the
GPU worker, CUDA, Cloudflare or app intake.
"""

from __future__ import annotations

import hashlib
import importlib.util
import sys
import zlib
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic, sleep

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
MODULE_NAME = "foundation_ocr_cpu_raster_app"


def load_cpu_app():
    # Loaded under its own name: the GPU worker's module is also called `app`.
    if MODULE_NAME in sys.modules:
        return sys.modules[MODULE_NAME]
    spec = importlib.util.spec_from_file_location(MODULE_NAME, ROOT / "app.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


cpu = load_cpu_app()

SECRET = "qualification-ocr-hmac-secret-0123456789"
CPU = "CPUExecutionProvider"
STARTUP_TIMEOUT_SECONDS = 600
SESSION_STAGES = ("text_det", "text_cls", "text_rec")
# Synthetic, non-sensitive text owned by the operator.
FIXTURE_LINES = ("OPERATOR SYNTHETIC SCAN", "Image only page 4096")
PAGE_POINTS = (612, 792)


def serialize_pdf(objects: list[bytes]) -> bytes:
    body = b"%PDF-1.4\n"
    offsets = []
    for number, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += b"%d 0 obj\n" % number + obj + b"\nendobj\n"
    xref = len(body)
    size = len(objects) + 1
    body += b"xref\n0 %d\n0000000000 65535 f \n" % size + b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    return body + b"trailer << /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (size, xref)


def image_only_pdf() -> bytes:
    """One page whose only content is a grayscale raster of FIXTURE_LINES. No font, no text operators."""
    width, height = (round(points * cpu.RENDER_SCALE) for points in PAGE_POINTS)
    image = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=56)
    for index, line in enumerate(FIXTURE_LINES):
        draw.text((120, 220 + 140 * index), line, fill=0, font=font)
    pixels = zlib.compress(image.tobytes(), 9)
    content = b"q %d 0 0 %d 0 0 cm /Im0 Do Q" % PAGE_POINTS
    return serialize_pdf([
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Contents 4 0 R" % PAGE_POINTS
        + b" /Resources << /XObject << /Im0 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray" % (width, height)
        + b" /BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n" % len(pixels)
        + pixels
        + b"\nendstream",
    ])


def assert_image_only_with_visible_ink(payload: bytes) -> None:
    assert b"/Font" not in payload
    document = pdfium.PdfDocument(payload)
    try:
        assert len(document) == 1
        page = document[0]
        try:
            textpage = page.get_textpage()
            try:
                assert textpage.count_chars() == 0
                assert textpage.get_text_bounded().strip() == ""
            finally:
                textpage.close()
            assert [obj.type for obj in page.get_objects()] == [pdfium_c.FPDF_PAGEOBJ_IMAGE]
            assert cpu.ink_fraction(cpu.render_page(page)) >= cpu.SELF_TEST_MIN_INK
        finally:
            page.close()
    finally:
        document.close()


def signed_headers(payload: bytes, request_id: str) -> dict[str, str]:
    digest = f"sha256:{hashlib.sha256(payload).hexdigest()}"
    timestamp = datetime.now(UTC).isoformat()
    return {
        "x-tavonel-input-sha256": digest,
        "x-tavonel-ocr-timestamp": timestamp,
        "x-tavonel-ocr-request-id": request_id,
        "x-tavonel-ocr-signature": cpu.ocr_request_signature(SECRET, timestamp, request_id, digest),
    }


def require_qualification_runtime() -> None:
    """Skips (never fakes) when the pinned CPU runtime or the verified model assets are absent."""
    for distribution in cpu.FORBIDDEN_RUNTIME:
        if cpu.installed_version(distribution) is not None:
            pytest.skip(f"{distribution} is installed; the pinned CPU-only onnxruntime build is unavailable here")
    for distribution, pinned in cpu.PINNED_RUNTIME.items():
        found = cpu.installed_version(distribution)
        if found != pinned:
            pytest.skip(
                f"{distribution}=={pinned} is not installed (found {found}); "
                "install workers/foundation-ocr-cpu-raster/requirements.txt"
            )
    try:
        import onnxruntime  # noqa: F401
        import rapidocr  # noqa: F401
    except ImportError as exc:
        pytest.skip(f"pinned OCR runtime cannot be imported: {exc}")
    try:
        cpu.verify_model_files()
    except RuntimeError as exc:
        pytest.skip(
            f"verified RapidOCR model assets are unavailable ({exc}); "
            "run the approved build-time download workers/foundation-ocr-cpu-raster/materialize_models.py"
        )


def test_synthetic_fixture_is_image_only_with_visible_ink() -> None:
    assert_image_only_with_visible_ink(image_only_pdf())


def test_real_cpu_ocr_reads_a_synthetic_image_only_pdf(monkeypatch: pytest.MonkeyPatch) -> None:
    require_qualification_runtime()
    monkeypatch.setenv("TAVONEL_OCR_HMAC", SECRET)
    monkeypatch.setattr(cpu, "_self_test", {"state": "pending", "detail": None})
    monkeypatch.setattr(cpu, "_general_rapidocr", None)
    monkeypatch.setattr(cpu, "_korean_rapidocr", None)
    monkeypatch.setattr(cpu, "replay_guard", cpu.RequestReplayGuard())
    models_before = cpu.model_snapshot()
    payload = image_only_pdf()
    assert_image_only_with_visible_ink(payload)

    # The real startup: the lifespan loads both engines and runs the pixel self-test.
    with TestClient(cpu.app) as client:
        deadline = monotonic() + STARTUP_TIMEOUT_SECONDS
        ping = client.get("/ping")
        while ping.status_code == 204 and monotonic() < deadline:
            sleep(0.25)
            ping = client.get("/ping")
        assert ping.status_code == 200, f"self-test did not pass: {cpu._self_test}"
        assert ping.headers["cache-control"] == "no-store"
        assert cpu._self_test == {"state": "passed", "detail": None}

        engines = {"general": cpu._general_rapidocr, "korean": cpu._korean_rapidocr}
        with cpu._engine_lock:
            self_test_image = cpu.self_test_image()
            for label, engine in engines.items():
                assert engine is not None
                for stage in SESSION_STAGES:
                    assert list(getattr(engine, stage).session.session.get_providers()) == [CPU], (label, stage)
                options = cpu.KOREAN_PASS_OPTIONS if label == "korean" else {}
                read = {
                    " ".join(line["text"].split()): line["confidence"]
                    for line in cpu.rapidocr_lines(engine, self_test_image, **options)
                }
                for expected in cpu.SELF_TEST_LINES:
                    assert expected in read, (label, sorted(read))
                    assert read[expected] >= 0.90, (label, expected, read[expected])

        health = client.get("/health")
        assert health.headers["cache-control"] == "no-store"
        assert health.json()["ready"] is True
        assert health.json()["executionProvider"] == CPU
        assert health.json()["cpuSessionsSelected"] is True
        assert health.json()["gpu"] is False

        headers = signed_headers(payload, "qualification-image-only-0001")
        response = client.post(
            "/v1/ocr", files={"source": ("synthetic-image-only.pdf", payload, "application/pdf")}, headers=headers
        )

    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert set(body) == {"schemaVersion", "status", "text", "pageCount", "inputSha256", "regions"}
    assert body["schemaVersion"] == "tavonel.ocr_result.v2"
    assert body["status"] == "ok"
    assert body["pageCount"] == 1
    assert body["inputSha256"] == f"sha256:{hashlib.sha256(payload).hexdigest()}"
    regions = body["regions"]
    assert len(regions) >= 1
    assert [region["order"] for region in regions] == list(range(len(regions)))
    assert len({region["regionId"] for region in regions}) == len(regions)
    assert body["text"] == "\n".join(region["text"] for region in regions)
    assert body["text"].strip()
    # The known pixel words must actually be read, not merely some non-empty text.
    read_text = " ".join(body["text"].split()).casefold()
    for expected in FIXTURE_LINES:
        assert " ".join(expected.split()).casefold() in read_text, f"{expected!r} not read; OCR text: {body['text']!r}"
    for region in regions:
        # Raster regions only: the page has no embedded text to fall back on.
        assert region["regionId"].startswith("ocr-p0001-l")
        assert (region["pageIndex0"], region["pageNumber1"]) == (0, 1)
        assert region["blockType"] == "paragraph"
        assert region["authority"] == "informal"
        assert region["text"].strip()
        assert 0.0 <= region["confidence"] <= 1.0
        x1, y1, x2, y2 = region["bbox1000"]
        assert all(0 <= value <= 1000 for value in (x1, y1, x2, y2))
        assert x2 > x1 and y2 > y1

    # Loading and reading did not download or change any model file.
    assert cpu.model_snapshot() == models_before

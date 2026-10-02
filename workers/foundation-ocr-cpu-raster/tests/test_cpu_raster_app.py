"""Unit and contract tests for the CPU raster OCR worker.

These never load real OCR models: engines are a fake RapidOCR installed only for the test, so
they run without onnxruntime, rapidocr or model files, and they are never OCR qualification.
"""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import itertools
import sys
import threading
import types
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
GPU_APP = ROOT.parent / "foundation-ocr-gpu" / "app.py"
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
REAL_VERIFY_MODEL_FILES = cpu.verify_model_files

SECRET = "unit-test-ocr-hmac-secret-0123456789abcdef"
CPU = "CPUExecutionProvider"
NO_STORE = "no-store"
CANARY = "SYNTHETIC-CANARY-7f3c"
REQUEST_IDS = itertools.count(1)
ENGINE_LABELS = ("general", "korean")
SESSION_STAGES = (("detection", "text_det"), ("classification", "text_cls"), ("recognition", "text_rec"))
MIXED_PROVIDERS = (
    [CPU, "CUDAExecutionProvider"],
    ["CUDAExecutionProvider", CPU],
    ["TensorrtExecutionProvider", "CUDAExecutionProvider", CPU],
    [CPU, "DmlExecutionProvider"],
    [CPU, "OpenVINOExecutionProvider"],
    [CPU, "CoreMLExecutionProvider"],
    [CPU, "ROCMExecutionProvider"],
    ["CUDAExecutionProvider"],
    [],
)
# Pixel polygons on a 612x792 pt page rendered at scale 2 (1224x1584 px), roughly where the known
# self-test lines are drawn (left margin 72 pt, baselines 72 pt and 132 pt from the top).
FAKE_POLYGONS = (
    [[122.4, 95.04], [918.0, 95.04], [918.0, 158.4], [122.4, 158.4]],
    [[122.4, 221.76], [856.8, 221.76], [856.8, 285.12], [122.4, 285.12]],
)
FAKE_BBOXES = ([100, 60, 750, 100], [100, 140, 700, 180])
LETTER_PIXELS = 1224 * 1584
GEOMETRY_REFUSAL = "OCR source page geometry is not qualified"
REGION_KEYS = {
    "regionId", "pageIndex0", "pageNumber1", "order", "blockType", "text", "bbox1000", "confidence", "authority",
}
RESULT_KEYS = {"schemaVersion", "status", "text", "pageCount", "inputSha256", "regions"}


# --- synthetic PDFs (operator-owned, generated here) -----------------------------------------


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


def synthetic_pdf(page_streams: list[bytes], media_boxes: list[bytes] | None = None) -> bytes:
    # A MediaBox is only declared geometry: an oversized one costs a few bytes until it is rendered.
    media_boxes = media_boxes or [b"0 0 612 792"] * len(page_streams)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    kids = []
    for stream, media_box in zip(page_streams, media_boxes, strict=True):
        kids.append(len(objects) + 1)
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [%s] /Contents %d 0 R"
            b" /Resources << /Font << /F1 3 0 R >> >> >>" % (media_box, len(objects) + 2)
        )
        objects.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objects[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % kid for kid in kids), len(kids))
    return serialize_pdf(objects)


NATIVE_TEXT_PDF = synthetic_pdf([b"BT /F1 24 Tf 72 700 Td (Operator synthetic native text) Tj ET"])
# A filled rectangle: visible ink and no text layer, so the page goes through the raster path.
VECTOR_INK_PDF = synthetic_pdf([b"0 g 72 600 300 60 re f"])
BLANK_PDF = synthetic_pdf([b""])


# --- request helpers --------------------------------------------------------------------------


def source_digest(payload: bytes) -> str:
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def signed_headers(
    payload: bytes,
    *,
    secret: str = SECRET,
    request_id: str | None = None,
    timestamp: str | None = None,
    digest: str | None = None,
    signed_digest: str | None = None,
) -> dict[str, str]:
    digest = digest or source_digest(payload)
    timestamp = timestamp or datetime.now(UTC).isoformat()
    request_id = request_id or f"unit-request-{next(REQUEST_IDS):08d}"
    return {
        "x-tavonel-input-sha256": digest,
        "x-tavonel-ocr-timestamp": timestamp,
        "x-tavonel-ocr-request-id": request_id,
        "x-tavonel-ocr-signature": cpu.ocr_request_signature(secret, timestamp, request_id, signed_digest or digest),
    }


def post_ocr(client: TestClient, payload: bytes, headers: dict[str, str], filename="synthetic.pdf", mime="application/pdf"):
    return client.post("/v1/ocr", files={"source": (filename, payload, mime)}, headers=headers)


def assert_fixed_error(response, status: int, detail: str) -> None:
    assert response.status_code == status
    assert response.json() == {"detail": detail}
    assert response.headers["cache-control"] == NO_STORE


def assert_valid_bbox(bbox: list[int]) -> None:
    assert len(bbox) == 4
    x1, y1, x2, y2 = bbox
    assert all(0 <= value <= 1000 for value in bbox)
    assert x2 > x1 and y2 > y1


# --- fake RapidOCR (unit tests only) ----------------------------------------------------------


class FakeOcrState:
    def __init__(self) -> None:
        self.lines = [(text, 0.97, polygon) for text, polygon in zip(cpu.SELF_TEST_LINES, FAKE_POLYGONS, strict=True)]
        self.providers: dict[tuple[str, str], list[str]] = {}
        self.constructed: list[tuple[str, dict]] = []
        self.calls: list[tuple[str, dict]] = []


def fake_rapidocr_module(state: FakeOcrState) -> types.ModuleType:
    class FakeProviders:
        def __init__(self, providers: list[str]) -> None:
            self._providers = list(providers)

        def get_providers(self) -> list[str]:
            return list(self._providers)

    class RapidOCR:
        def __init__(self, params: dict) -> None:
            self.label = "korean" if "Rec.lang_type" in params else "general"
            state.constructed.append((self.label, dict(params)))
            for _, stage in SESSION_STAGES:
                providers = state.providers.get((self.label, stage), [CPU])
                setattr(self, stage, types.SimpleNamespace(session=types.SimpleNamespace(session=FakeProviders(providers))))

        def __call__(self, image, **options):
            state.calls.append((self.label, dict(options)))
            # Like a real reader, a page without ink yields nothing.
            if cpu.ink_fraction(image) < cpu.SELF_TEST_MIN_INK:
                return types.SimpleNamespace(boxes=None, txts=None, scores=None)
            return types.SimpleNamespace(
                boxes=[polygon for _, _, polygon in state.lines],
                txts=[text for text, _, _ in state.lines],
                scores=[score for _, score, _ in state.lines],
            )

    module = types.ModuleType("rapidocr")
    module.RapidOCR = RapidOCR
    module.LangRec = types.SimpleNamespace(KOREAN="korean")
    module.ModelType = types.SimpleNamespace(MOBILE="mobile")
    module.OCRVersion = types.SimpleNamespace(PPOCRV5="PP-OCRv5")
    return module


@pytest.fixture(autouse=True)
def fresh_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVONEL_OCR_HMAC", SECRET)
    monkeypatch.setattr(cpu, "_self_test", {"state": "pending", "detail": None})
    monkeypatch.setattr(cpu, "_general_rapidocr", None)
    monkeypatch.setattr(cpu, "_korean_rapidocr", None)
    monkeypatch.setattr(cpu, "replay_guard", cpu.RequestReplayGuard())


@pytest.fixture
def fake_ocr(monkeypatch: pytest.MonkeyPatch) -> FakeOcrState:
    state = FakeOcrState()
    monkeypatch.setitem(sys.modules, "rapidocr", fake_rapidocr_module(state))
    monkeypatch.setattr(cpu, "require_cpu_runtime", lambda: None)
    monkeypatch.setattr(cpu, "verify_model_files", lambda: None)
    monkeypatch.setattr(cpu, "model_snapshot", lambda: {})
    return state


@pytest.fixture
def client() -> TestClient:
    # No `with`: the lifespan (and its real self-test thread) does not start.
    return TestClient(cpu.app)


# --- authentication and replay ------------------------------------------------------------------


def test_signed_native_text_pdf_returns_v2_schema_without_loading_engines(client: TestClient) -> None:
    response = post_ocr(client, NATIVE_TEXT_PDF, signed_headers(NATIVE_TEXT_PDF))

    assert response.status_code == 200
    assert response.headers["cache-control"] == NO_STORE
    body = response.json()
    assert set(body) == RESULT_KEYS
    assert body["schemaVersion"] == "tavonel.ocr_result.v2"
    assert body["status"] == "ok"
    assert body["pageCount"] == 1
    assert body["inputSha256"] == source_digest(NATIVE_TEXT_PDF)
    assert body["text"] == "Operator synthetic native text"
    [region] = body["regions"]
    assert set(region) == REGION_KEYS
    assert region["regionId"] == "native-p0001"
    assert (region["pageIndex0"], region["pageNumber1"], region["order"]) == (0, 1, 0)
    assert region["confidence"] == 1.0
    assert region["authority"] == "informal"
    assert_valid_bbox(region["bbox1000"])
    # Embedded text never needs OCR, so nothing was loaded or self-tested.
    assert cpu._self_test["state"] == "pending"


def test_replayed_request_id_is_refused(client: TestClient) -> None:
    headers = signed_headers(NATIVE_TEXT_PDF)

    assert post_ocr(client, NATIVE_TEXT_PDF, headers).status_code == 200
    assert_fixed_error(post_ocr(client, NATIVE_TEXT_PDF, headers), 409, "OCR request has already been consumed")


def test_request_id_is_claimed_only_after_a_valid_signature(client: TestClient) -> None:
    request_id = "unit-request-unclaimed-001"
    forged = signed_headers(NATIVE_TEXT_PDF, secret="another-secret-that-is-long-enough-000", request_id=request_id)

    assert_fixed_error(post_ocr(client, NATIVE_TEXT_PDF, forged), 401, "OCR request signature is invalid")
    assert post_ocr(client, NATIVE_TEXT_PDF, signed_headers(NATIVE_TEXT_PDF, request_id=request_id)).status_code == 200


def test_signature_from_another_secret_is_refused(client: TestClient) -> None:
    headers = signed_headers(NATIVE_TEXT_PDF, secret="another-secret-that-is-long-enough-000")

    assert_fixed_error(post_ocr(client, NATIVE_TEXT_PDF, headers), 401, "OCR request signature is invalid")


def test_digest_header_changed_after_signing_is_refused(client: TestClient) -> None:
    other = source_digest(b"%PDF-1.4 a different synthetic body")
    headers = signed_headers(NATIVE_TEXT_PDF, digest=other, signed_digest=source_digest(NATIVE_TEXT_PDF))

    assert_fixed_error(post_ocr(client, NATIVE_TEXT_PDF, headers), 401, "OCR request signature is invalid")


def test_signed_digest_that_does_not_match_the_body_is_refused(client: TestClient) -> None:
    headers = signed_headers(NATIVE_TEXT_PDF, digest=source_digest(BLANK_PDF))

    assert_fixed_error(
        post_ocr(client, NATIVE_TEXT_PDF, headers), 422, "OCR source digest does not match the uploaded body"
    )


@pytest.mark.parametrize("digest", ["", "sha256:short", "md5:" + "0" * 32, "sha256:" + "A" * 64])
def test_malformed_digest_header_is_refused(client: TestClient, digest: str) -> None:
    headers = signed_headers(NATIVE_TEXT_PDF)
    headers["x-tavonel-input-sha256"] = digest

    assert_fixed_error(post_ocr(client, NATIVE_TEXT_PDF, headers), 401, "OCR source digest is invalid")


@pytest.mark.parametrize("missing", ["x-tavonel-ocr-timestamp", "x-tavonel-ocr-request-id", "x-tavonel-ocr-signature"])
def test_missing_authentication_header_is_refused(client: TestClient, missing: str) -> None:
    headers = signed_headers(NATIVE_TEXT_PDF)
    del headers[missing]

    assert_fixed_error(post_ocr(client, NATIVE_TEXT_PDF, headers), 401, "OCR authentication headers are invalid")


@pytest.mark.parametrize("request_id", ["too-short", "has spaces in the request id", "x" * 161])
def test_malformed_request_id_is_refused(client: TestClient, request_id: str) -> None:
    headers = signed_headers(NATIVE_TEXT_PDF, request_id=request_id)

    assert_fixed_error(post_ocr(client, NATIVE_TEXT_PDF, headers), 401, "OCR authentication headers are invalid")


def test_unparsable_timestamp_is_refused(client: TestClient) -> None:
    headers = signed_headers(NATIVE_TEXT_PDF, timestamp="not-a-timestamp")

    assert_fixed_error(post_ocr(client, NATIVE_TEXT_PDF, headers), 401, "OCR timestamp is invalid")


@pytest.mark.parametrize(
    "timestamp",
    [
        # Computed at collection time, so the margin is far wider than any test run.
        (datetime.now(UTC) - timedelta(hours=1)).isoformat(),
        (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        datetime.now(UTC).replace(tzinfo=None).isoformat(),
    ],
    ids=["stale", "future", "naive"],
)
def test_timestamp_outside_the_window_or_without_zone_is_refused(client: TestClient, timestamp: str) -> None:
    headers = signed_headers(NATIVE_TEXT_PDF, timestamp=timestamp)

    assert_fixed_error(post_ocr(client, NATIVE_TEXT_PDF, headers), 401, "OCR request is expired")


@pytest.mark.parametrize("secret", [None, "", "too-short-secret"])
def test_missing_or_weak_hmac_secret_fails_closed(client: TestClient, monkeypatch: pytest.MonkeyPatch, secret) -> None:
    if secret is None:
        monkeypatch.delenv("TAVONEL_OCR_HMAC", raising=False)
    else:
        monkeypatch.setenv("TAVONEL_OCR_HMAC", secret)
    headers = signed_headers(NATIVE_TEXT_PDF, secret=secret or "")

    assert_fixed_error(post_ocr(client, NATIVE_TEXT_PDF, headers), 503, "OCR configuration is not qualified")


# --- input validation ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("filename", "mime", "payload"),
    [
        ("synthetic.pdf", "text/plain", NATIVE_TEXT_PDF),
        ("synthetic.pdf", "image/png", NATIVE_TEXT_PDF),
        (f"{CANARY}.png", "application/pdf", NATIVE_TEXT_PDF),
        ("synthetic.pdf", "application/pdf", f"plain text {CANARY}".encode("ascii")),
        ("synthetic.pdf", "application/pdf", b"\x89PNG\r\n\x1a\n" + CANARY.encode("ascii")),
    ],
    ids=["text-mime", "image-mime", "png-suffix", "text-magic", "png-magic"],
)
def test_non_pdf_source_is_refused_without_echoing_it(client: TestClient, filename: str, mime: str, payload: bytes) -> None:
    response = post_ocr(client, payload, signed_headers(payload), filename=filename, mime=mime)

    assert_fixed_error(response, 422, "OCR source is not a PDF")
    assert CANARY not in response.text


def test_pdf_mime_parameters_and_x_pdf_alias_are_accepted(client: TestClient) -> None:
    for mime in ("application/pdf; charset=binary", "application/x-pdf"):
        response = post_ocr(client, NATIVE_TEXT_PDF, signed_headers(NATIVE_TEXT_PDF), mime=mime)
        assert response.status_code == 200


def test_empty_source_is_refused(client: TestClient) -> None:
    assert_fixed_error(post_ocr(client, b"", signed_headers(b"")), 422, "OCR source is empty")


def test_source_over_the_18_mib_cap_is_refused(client: TestClient) -> None:
    assert cpu.MAX_INPUT_BYTES == 18 * 1024 * 1024
    payload = b"%PDF" + b"\0" * (cpu.MAX_INPUT_BYTES - 3)

    assert_fixed_error(post_ocr(client, payload, signed_headers(payload)), 413, "OCR source exceeds the 18 MiB Foundation cap")


def test_pdf_over_the_page_limit_is_refused(client: TestClient) -> None:
    assert cpu.MAX_PAGES == 80
    payload = synthetic_pdf([b""] * (cpu.MAX_PAGES + 1))

    assert_fixed_error(post_ocr(client, payload, signed_headers(payload)), 422, "OCR source page count is not qualified")


def test_unreadable_pdf_is_refused(client: TestClient) -> None:
    payload = b"%PDF-1.4\n" + CANARY.encode("ascii")
    response = post_ocr(client, payload, signed_headers(payload))

    assert_fixed_error(response, 422, "OCR renderer rejected this PDF")
    assert CANARY not in response.text


def test_blank_page_has_no_text_regions(client: TestClient, fake_ocr: FakeOcrState) -> None:
    response = post_ocr(client, BLANK_PDF, signed_headers(BLANK_PDF))

    assert_fixed_error(response, 422, "OCR source has no extractable text regions")
    # The blank page was rasterized and read by both passes after the self-test passed.
    assert cpu._self_test["state"] == "passed"
    assert fake_ocr.calls[-2:] == [("general", {}), ("korean", {"use_cls": False})]


# --- raster path with fake engines ------------------------------------------------------------


def test_image_only_page_is_read_from_pixels_into_v2_regions(client: TestClient, fake_ocr: FakeOcrState) -> None:
    response = post_ocr(client, VECTOR_INK_PDF, signed_headers(VECTOR_INK_PDF))

    assert response.status_code == 200
    assert response.headers["cache-control"] == NO_STORE
    body = response.json()
    assert set(body) == RESULT_KEYS
    assert body["schemaVersion"] == "tavonel.ocr_result.v2"
    assert body["inputSha256"] == source_digest(VECTOR_INK_PDF)
    assert body["pageCount"] == 1
    assert body["text"] == "\n".join(cpu.SELF_TEST_LINES)
    assert body["regions"] == [
        {
            "regionId": f"ocr-p0001-l{index + 1:05d}",
            "pageIndex0": 0,
            "pageNumber1": 1,
            "order": index,
            "blockType": "paragraph",
            "text": text,
            "bbox1000": bbox,
            "confidence": 0.97,
            "authority": "informal",
        }
        for index, (text, bbox) in enumerate(zip(cpu.SELF_TEST_LINES, FAKE_BBOXES, strict=True))
    ]


def test_normalized_bbox_stays_within_0_to_1000_with_positive_extent() -> None:
    assert cpu.normalized_bbox(-50, -50, 5000, 5000, 100, 100) == [0, 0, 1000, 1000]
    assert cpu.normalized_bbox(100, 100, 100, 100, 100, 100) == [999, 999, 1000, 1000]
    assert cpu.normalized_bbox(10, 10, 20, 20, 0, 100) is None
    assert_valid_bbox(cpu.normalized_bbox(3, 4, 3, 4, 1000, 1000))


# --- raster geometry preflight ------------------------------------------------------------------


@pytest.fixture
def render_sentinel(monkeypatch: pytest.MonkeyPatch) -> list[tuple[float, float]]:
    """Fails any page render, so a refused document never allocates its declared raster."""
    rendered: list[tuple[float, float]] = []

    def sentinel(page):
        rendered.append(tuple(page.get_size()))
        raise AssertionError("a page was rendered before the geometry preflight refused the document")

    monkeypatch.setattr(cpu, "render_page", sentinel)
    return rendered


@pytest.fixture
def render_counter(monkeypatch: pytest.MonkeyPatch) -> list[tuple[float, float]]:
    rendered: list[tuple[float, float]] = []
    real_render = cpu.render_page

    def counted(page):
        rendered.append(tuple(page.get_size()))
        return real_render(page)

    monkeypatch.setattr(cpu, "render_page", counted)
    return rendered


INK = b"0 g 72 600 300 60 re f"


def test_raster_pixels_round_up_like_the_renderer_and_refuse_unsafe_sizes() -> None:
    assert cpu.raster_pixels(612, 792) == LETTER_PIXELS
    assert cpu.raster_pixels(612.1, 792.001) == 1225 * 1585
    side = cpu.MAX_RASTER_SIDE_PX / cpu.RENDER_SCALE
    assert cpu.raster_pixels(side, 1) == cpu.MAX_RASTER_SIDE_PX * 2
    for width, height in [(side + 0.001, 1), (1, side + 0.001), (1e308, 1), (float("nan"), 1), (0, 1), (-1, 1)]:
        with pytest.raises(HTTPException) as refused:
            cpu.raster_pixels(width, height)
        assert (refused.value.status_code, refused.value.detail) == (422, GEOMETRY_REFUSAL)


def test_image_only_page_passes_the_preflight_and_is_rendered_once(
    client: TestClient, fake_ocr: FakeOcrState, render_counter: list
) -> None:
    cpu.warm_engines()
    render_counter.clear()  # the self-test page

    response = post_ocr(client, VECTOR_INK_PDF, signed_headers(VECTOR_INK_PDF))

    assert response.status_code == 200
    assert render_counter == [(612.0, 792.0)]


@pytest.mark.parametrize("media_box", [b"0 0 5000 100", b"0 0 100 5000"], ids=["wide", "tall"])
def test_oversized_page_side_is_refused_before_render(client: TestClient, render_sentinel: list, media_box: bytes) -> None:
    # 10000 x 200 px: over the side bound while far under the per-page pixel budget.
    assert 5000 * cpu.RENDER_SCALE > cpu.MAX_RASTER_SIDE_PX
    assert 10000 * 200 <= cpu.MAX_RASTER_PAGE_PIXELS
    payload = synthetic_pdf([INK], [media_box])
    response = post_ocr(client, payload, signed_headers(payload), filename=f"{CANARY}.pdf")

    assert_fixed_error(response, 422, GEOMETRY_REFUSAL)
    assert CANARY not in response.text
    assert render_sentinel == []


@pytest.mark.parametrize(
    ("media_box", "page_budget"),
    [(b"0 0 4000 4000", None), (b"0 0 612 792", LETTER_PIXELS - 1)],
    ids=["default-budget", "tightened-budget"],
)
def test_page_over_the_pixel_budget_is_refused_before_render(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, render_sentinel: list, media_box: bytes, page_budget
) -> None:
    if page_budget is not None:
        monkeypatch.setattr(cpu, "MAX_RASTER_PAGE_PIXELS", page_budget)
    payload = synthetic_pdf([INK], [media_box])

    assert_fixed_error(post_ocr(client, payload, signed_headers(payload)), 422, GEOMETRY_REFUSAL)
    assert render_sentinel == []


def test_aggregate_budget_is_refused_before_any_page_renders(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, render_sentinel: list
) -> None:
    monkeypatch.setattr(cpu, "MAX_RASTER_TOTAL_PIXELS", 2 * LETTER_PIXELS)
    # Each page is within the per-page bounds; only the third tips the document over the budget.
    payload = synthetic_pdf([INK] * 3)

    assert_fixed_error(post_ocr(client, payload, signed_headers(payload)), 422, GEOMETRY_REFUSAL)
    assert render_sentinel == []


def test_aggregate_budget_admits_a_document_exactly_at_the_budget(
    client: TestClient, fake_ocr: FakeOcrState, monkeypatch: pytest.MonkeyPatch, render_counter: list
) -> None:
    monkeypatch.setattr(cpu, "MAX_RASTER_TOTAL_PIXELS", 2 * LETTER_PIXELS)
    payload = synthetic_pdf([INK] * 2)

    assert post_ocr(client, payload, signed_headers(payload)).status_code == 200
    assert render_counter.count((612.0, 792.0)) == 3  # the self-test page and both source pages


def test_later_unsafe_page_refuses_the_document_before_earlier_pages_render(
    client: TestClient, render_sentinel: list
) -> None:
    payload = synthetic_pdf([INK, INK, INK], [b"0 0 612 792", b"0 0 612 792", b"0 0 5000 100"])

    assert_fixed_error(post_ocr(client, payload, signed_headers(payload)), 422, GEOMETRY_REFUSAL)
    assert render_sentinel == []


def test_only_pages_without_a_text_layer_count_against_the_raster_budget(
    client: TestClient, fake_ocr: FakeOcrState, monkeypatch: pytest.MonkeyPatch, render_counter: list
) -> None:
    monkeypatch.setattr(cpu, "MAX_RASTER_TOTAL_PIXELS", LETTER_PIXELS)
    native = b"BT /F1 24 Tf 72 700 Td (Operator synthetic native text) Tj ET"
    # The wide native page is never rendered, so its declared size is not budgeted.
    payload = synthetic_pdf([native, INK, native], [b"0 0 5000 792", b"0 0 612 792", b"0 0 612 792"])
    cpu.warm_engines()
    render_counter.clear()

    response = post_ocr(client, payload, signed_headers(payload))

    assert response.status_code == 200
    assert render_counter == [(612.0, 792.0)]
    regions = response.json()["regions"]
    assert [(region["regionId"], region["order"]) for region in regions] == [
        ("native-p0001", 0),
        ("ocr-p0002-l00001", 1),
        ("ocr-p0002-l00002", 2),
        ("native-p0003", 3),
    ]


@pytest.mark.parametrize(
    "size",
    [(float("nan"), 792.0), (612.0, float("inf")), (0.0, 792.0), (612.0, -792.0), (612.0,), ("wide", 792.0), None],
    ids=["nan", "inf", "zero", "negative", "one-side", "not-a-number", "missing"],
)
def test_malformed_page_geometry_is_refused_before_render(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, render_sentinel: list, size
) -> None:
    monkeypatch.setattr(cpu.pdfium.PdfPage, "get_size", lambda _: size)

    for payload in (VECTOR_INK_PDF, NATIVE_TEXT_PDF):
        assert_fixed_error(post_ocr(client, payload, signed_headers(payload)), 422, GEOMETRY_REFUSAL)
    assert render_sentinel == []


# --- fixed, no-store errors -------------------------------------------------------------------


def test_unknown_route_is_no_store(client: TestClient) -> None:
    assert_fixed_error(client.get("/v1/unknown"), 404, "Not Found")


def test_malformed_request_returns_a_fixed_message(client: TestClient) -> None:
    response = client.post("/v1/ocr", data={"unexpected": CANARY}, headers=signed_headers(NATIVE_TEXT_PDF))

    assert_fixed_error(response, 422, "OCR request is malformed")
    assert CANARY not in response.text


def test_unexpected_failure_does_not_echo_exception_text(monkeypatch: pytest.MonkeyPatch) -> None:
    def explode(_: bytes):
        raise RuntimeError(f"source-derived detail {CANARY}")

    monkeypatch.setattr(cpu, "extract_text", explode)
    client = TestClient(cpu.app, raise_server_exceptions=False)
    response = post_ocr(client, NATIVE_TEXT_PDF, signed_headers(NATIVE_TEXT_PDF))

    assert_fixed_error(response, 500, "OCR worker failed")
    assert CANARY not in response.text


def test_failed_self_test_refuses_raster_ocr_without_echoing_what_was_read(
    client: TestClient, fake_ocr: FakeOcrState
) -> None:
    fake_ocr.lines = [(f"MISREAD {CANARY}", 0.99, FAKE_POLYGONS[0])]
    response = post_ocr(client, VECTOR_INK_PDF, signed_headers(VECTOR_INK_PDF))

    assert_fixed_error(response, 503, "OCR recognition self-test did not pass")
    assert CANARY not in response.text
    assert cpu._self_test["state"] == "failed"


# --- health and ping readiness ------------------------------------------------------------------


def test_ping_is_204_and_health_not_ready_while_pending(client: TestClient) -> None:
    ping = client.get("/ping")
    assert ping.status_code == 204
    assert ping.content == b""
    assert ping.headers["cache-control"] == NO_STORE

    health = client.get("/health")
    assert health.status_code == 200
    assert health.headers["cache-control"] == NO_STORE
    body = health.json()
    assert body == {
        "status": "ok",
        "service": "tavonel-foundation-ocr-cpu-raster",
        "port": 8001,
        "ssh": False,
        "qualification": "cpu-raster-ocr",
        "accelerator": "cpu",
        "gpu": False,
        "engine": "rapidocr",
        "engineRelease": cpu.OCR_ENGINE_RELEASE,
        "modelSha256": cpu.OCR_MODEL_SHA256,
        "adaptiveKorean": True,
        "executionProvider": None,
        "cpuSessionsSelected": False,
        "ready": False,
        "recognitionSelfTest": {"state": "pending", "detail": None},
    }


def test_ping_is_200_with_cpu_provider_only_after_the_self_test_passes(client: TestClient, fake_ocr: FakeOcrState) -> None:
    cpu.warm_engines()

    ping = client.get("/ping")
    assert ping.status_code == 200
    assert ping.headers["cache-control"] == NO_STORE
    body = ping.json()
    assert body["ready"] is True
    assert body["executionProvider"] == CPU
    assert body["cpuSessionsSelected"] is True
    assert body["gpu"] is False
    assert body["recognitionSelfTest"] == {"state": "passed", "detail": None}


def test_ping_is_503_after_a_failed_self_test_and_the_failure_is_final(client: TestClient, fake_ocr: FakeOcrState) -> None:
    fake_ocr.lines = [(text, 0.5, polygon) for text, _, polygon in fake_ocr.lines]
    cpu.warm_engines()
    constructed = len(fake_ocr.constructed)

    ping = client.get("/ping")
    assert ping.status_code == 503
    assert ping.json() == {"status": "unqualified"}
    assert ping.headers["cache-control"] == NO_STORE
    health = client.get("/health").json()
    assert health["ready"] is False
    assert health["executionProvider"] is None
    assert health["recognitionSelfTest"]["state"] == "failed"

    # A later attempt does not retry loading, even once the reader would pass.
    fake_ocr.lines = FakeOcrState().lines
    with pytest.raises(HTTPException) as refused:
        cpu.rapidocr_engines()
    assert refused.value.status_code == 503
    assert len(fake_ocr.constructed) == constructed
    assert client.get("/ping").status_code == 503


def test_startup_self_test_runs_in_background_and_ping_stays_204_until_it_finishes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started, release = threading.Event(), threading.Event()

    def blocked_self_test() -> None:
        started.set()
        release.wait(30)

    monkeypatch.setattr(cpu, "warm_engines", blocked_self_test)
    with TestClient(cpu.app) as client:
        try:
            assert started.wait(30)
            assert any(thread.name == "ocr-cpu-self-test" for thread in threading.enumerate())
            assert client.get("/ping").status_code == 204
            assert client.get("/health").json()["ready"] is False
        finally:
            release.set()


@pytest.mark.parametrize(
    ("lines", "reason"),
    [
        ([("TAVONEL OCR SELF TEST", 0.97), ("Quality gate 0123456789", 0.89)], "at confidence 0.890"),
        ([("TAVONEL OCR SELF TEST", 0.97)], "instead of 'Quality gate 0123456789'"),
        ([("TAVONEL OCR SELF TFST", 0.99), ("Quality gate 0123456789", 0.99)], "instead of 'TAVONEL OCR SELF TEST'"),
    ],
    ids=["low-confidence", "missing-line", "misread"],
)
def test_self_test_requires_both_known_lines_at_0_90(
    fake_ocr: FakeOcrState, lines: list[tuple[str, float]], reason: str
) -> None:
    fake_ocr.lines = [(text, score, polygon) for (text, score), polygon in zip(lines, FAKE_POLYGONS)]
    cpu.warm_engines()

    assert cpu._self_test["state"] == "failed"
    assert reason in cpu._self_test["detail"]
    assert cpu.ping_status() == 503


def test_self_test_page_without_visible_pixels_fails(fake_ocr: FakeOcrState, monkeypatch: pytest.MonkeyPatch) -> None:
    from PIL import Image

    monkeypatch.setattr(cpu, "self_test_image", lambda: Image.new("RGB", (1224, 1584), "white"))
    cpu.warm_engines()

    assert cpu._self_test == {"state": "failed", "detail": "Self-test page rendered without visible pixels"}
    assert fake_ocr.calls == []


def test_self_test_page_renders_visible_ink() -> None:
    image = cpu.self_test_image()

    assert image.size == (1224, 1584)
    assert cpu.ink_fraction(image) >= cpu.SELF_TEST_MIN_INK


def test_self_test_regions_are_disjoint_bands_that_hold_all_rendered_ink() -> None:
    # Checks the regions against the real rendered known page, with no OCR involved.
    image = cpu.self_test_image().convert("L")
    width, height = image.size
    regions = cpu.self_test_regions()

    assert len(regions) == len(cpu.SELF_TEST_LINES)
    assert all(upper[3] <= lower[1] for upper, lower in zip(regions, regions[1:]))
    inks = [
        sum(image.crop((round(x1 * width), round(y1 * height), round(x2 * width), round(y2 * height))).histogram()[:128])
        for x1, y1, x2, y2 in regions
    ]
    assert all(ink > 0 for ink in inks)
    assert sum(inks) == sum(image.histogram()[:128])


@pytest.mark.parametrize(
    "polygons",
    [
        FAKE_POLYGONS,
        # Looser, skewed boxes from another reader still sit in the right bands.
        (
            [[150.0, 80.0], [800.0, 80.0], [800.0, 175.0], [150.0, 175.0]],
            [[140.0, 215.0], [700.0, 225.0], [700.0, 290.0], [140.0, 280.0]],
        ),
    ],
    ids=["fixture", "varied"],
)
def test_self_test_passes_with_known_lines_in_their_regions(fake_ocr: FakeOcrState, polygons) -> None:
    fake_ocr.lines = [(text, 0.97, polygon) for text, polygon in zip(cpu.SELF_TEST_LINES, polygons, strict=True)]
    cpu.warm_engines()

    assert cpu._self_test == {"state": "passed", "detail": None}


@pytest.mark.parametrize(
    ("polygons", "misplaced"),
    [
        (([[122.4, 1267.2], [918.0, 1267.2], [918.0, 1330.56], [122.4, 1330.56]], FAKE_POLYGONS[1]), 0),
        ((FAKE_POLYGONS[1], FAKE_POLYGONS[0]), 0),
        ((FAKE_POLYGONS[0], [[1160.0, 221.76], [1224.0, 221.76], [1224.0, 285.12], [1160.0, 285.12]]), 1),
    ],
    ids=["moved-down", "swapped", "off-right"],
)
def test_self_test_fails_when_a_correct_line_is_read_in_the_wrong_region(
    fake_ocr: FakeOcrState, polygons, misplaced: int
) -> None:
    fake_ocr.lines = [(text, 0.99, polygon) for text, polygon in zip(cpu.SELF_TEST_LINES, polygons, strict=True)]
    cpu.warm_engines()

    assert cpu._self_test["state"] == "failed"
    assert f"{cpu.SELF_TEST_LINES[misplaced]!r} outside its expected region" in cpu._self_test["detail"]
    assert cpu.ping_status() == 503


# --- model and provider fail-closed -------------------------------------------------------------


@pytest.mark.parametrize("label", ENGINE_LABELS)
@pytest.mark.parametrize(("name", "stage"), SESSION_STAGES, ids=[stage for _, stage in SESSION_STAGES])
@pytest.mark.parametrize("providers", MIXED_PROVIDERS, ids=["+".join(p) or "none" for p in MIXED_PROVIDERS])
def test_each_of_the_six_sessions_rejects_anything_but_cpu_alone(
    client: TestClient, fake_ocr: FakeOcrState, label: str, name: str, stage: str, providers: list[str]
) -> None:
    fake_ocr.providers[(label, stage)] = providers
    cpu.warm_engines()

    assert cpu._self_test["state"] == "failed"
    assert f"RapidOCR {label} {name} session did not select only CPUExecutionProvider" in cpu._self_test["detail"]
    assert cpu._general_rapidocr is None and cpu._korean_rapidocr is None
    assert client.get("/ping").status_code == 503
    assert client.get("/health").json()["cpuSessionsSelected"] is False


def test_engines_load_with_cuda_disabled_and_every_session_on_cpu(fake_ocr: FakeOcrState) -> None:
    cpu.warm_engines()

    assert cpu._self_test["state"] == "passed"
    assert [label for label, _ in fake_ocr.constructed] == ["general", "korean"]
    for _, params in fake_ocr.constructed:
        assert params["EngineConfig.onnxruntime.use_cuda"] is False
    assert fake_ocr.constructed[1][1]["Rec.lang_type"] == "korean"
    for engine in (cpu._general_rapidocr, cpu._korean_rapidocr):
        for _, stage in SESSION_STAGES:
            assert getattr(engine, stage).session.session.get_providers() == [CPU]
        cpu.require_cpu_sessions("checked", engine)


def runtime(monkeypatch: pytest.MonkeyPatch, versions: dict[str, str], providers: list[str]) -> None:
    monkeypatch.setattr(cpu, "installed_version", lambda distribution: versions.get(distribution))
    onnxruntime = types.ModuleType("onnxruntime")
    onnxruntime.get_available_providers = lambda: list(providers)
    monkeypatch.setitem(sys.modules, "onnxruntime", onnxruntime)


PINNED = {"onnxruntime": "1.20.1", "rapidocr": "3.9.2"}


@pytest.mark.parametrize("providers", [[CPU], ["AzureExecutionProvider", CPU]])
def test_cpu_runtime_accepts_only_the_pinned_cpu_build(monkeypatch: pytest.MonkeyPatch, providers: list[str]) -> None:
    runtime(monkeypatch, PINNED, providers)

    cpu.require_cpu_runtime()


@pytest.mark.parametrize("distribution", cpu.FORBIDDEN_RUNTIME)
def test_cpu_runtime_refuses_an_installed_accelerator_build(monkeypatch: pytest.MonkeyPatch, distribution: str) -> None:
    runtime(monkeypatch, {**PINNED, distribution: "1.20.1"}, [CPU])

    with pytest.raises(RuntimeError, match=f"{distribution} is installed"):
        cpu.require_cpu_runtime()


@pytest.mark.parametrize(
    "versions",
    [
        {"rapidocr": "3.9.2"},
        {"onnxruntime": "1.20.2", "rapidocr": "3.9.2"},
        {"onnxruntime": "1.20.1"},
        {"onnxruntime": "1.20.1", "rapidocr": "3.9.1"},
    ],
    ids=["no-onnxruntime", "other-onnxruntime", "no-rapidocr", "other-rapidocr"],
)
def test_cpu_runtime_requires_the_pinned_versions(monkeypatch: pytest.MonkeyPatch, versions: dict[str, str]) -> None:
    runtime(monkeypatch, versions, [CPU])

    with pytest.raises(RuntimeError, match="is required"):
        cpu.require_cpu_runtime()


@pytest.mark.parametrize(
    "accelerator",
    [
        "CUDAExecutionProvider",
        "TensorrtExecutionProvider",
        "ROCMExecutionProvider",
        "MIGraphXExecutionProvider",
        "DmlExecutionProvider",
        "CoreMLExecutionProvider",
        "OpenVINOExecutionProvider",
        "CANNExecutionProvider",
        "QNNExecutionProvider",
    ],
)
def test_cpu_runtime_refuses_cpu_mixed_with_an_accelerator_provider(
    monkeypatch: pytest.MonkeyPatch, accelerator: str
) -> None:
    runtime(monkeypatch, PINNED, [accelerator, CPU])

    with pytest.raises(RuntimeError, match="accelerator providers"):
        cpu.require_cpu_runtime()


def test_cpu_runtime_requires_the_cpu_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime(monkeypatch, PINNED, ["AzureExecutionProvider"])

    with pytest.raises(RuntimeError, match="does not offer CPUExecutionProvider"):
        cpu.require_cpu_runtime()


def test_runtime_failure_fails_the_self_test_before_any_engine_loads(
    fake_ocr: FakeOcrState, monkeypatch: pytest.MonkeyPatch
) -> None:
    def accelerator_runtime() -> None:
        raise RuntimeError("onnxruntime-gpu is installed; only the CPU onnxruntime build is qualified")

    monkeypatch.setattr(cpu, "require_cpu_runtime", accelerator_runtime)
    cpu.warm_engines()

    assert cpu._self_test["state"] == "failed"
    assert fake_ocr.constructed == []


def test_missing_model_file_is_refused_and_no_engine_loads(
    fake_ocr: FakeOcrState, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(cpu, "rapidocr_model_dir", lambda: tmp_path)
    monkeypatch.setattr(cpu, "verify_model_files", REAL_VERIFY_MODEL_FILES)
    cpu.warm_engines()

    assert cpu._self_test["state"] == "failed"
    assert "is not materialized; runtime downloads are refused" in cpu._self_test["detail"]
    assert fake_ocr.constructed == []


def test_model_file_with_another_digest_is_refused(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for name, _ in cpu.OCR_MODEL_FILES.values():
        (tmp_path / name).write_bytes(b"not the pinned synthetic weights")
    monkeypatch.setattr(cpu, "rapidocr_model_dir", lambda: tmp_path)

    with pytest.raises(RuntimeError, match="RapidOCR model digest mismatch"):
        cpu.verify_model_files()


def test_model_directory_change_while_loading_is_refused(fake_ocr: FakeOcrState, monkeypatch: pytest.MonkeyPatch) -> None:
    snapshots = iter([{"model.onnx": (1, 1)}, {"model.onnx": (1, 1), "downloaded.onnx": (2, 2)}])
    monkeypatch.setattr(cpu, "model_snapshot", lambda: next(snapshots))
    cpu.warm_engines()

    assert cpu._self_test["state"] == "failed"
    assert "runtime downloads are refused" in cpu._self_test["detail"]
    assert cpu._general_rapidocr is None and cpu._korean_rapidocr is None


# --- CPU-only scope; GPU worker unchanged ---------------------------------------------------------


def test_worker_is_cpu_only() -> None:
    assert cpu.CPU_ENGINE_PARAMS == {"EngineConfig.onnxruntime.use_cuda": False}
    assert cpu.PINNED_RUNTIME == {"onnxruntime": "1.20.1", "rapidocr": "3.9.2"}
    assert set(cpu.FORBIDDEN_RUNTIME) == {"onnxruntime-gpu", "onnxruntime-directml", "onnxruntime-openvino"}
    requirements = [
        line.strip()
        for line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    assert "onnxruntime==1.20.1" in requirements
    assert "rapidocr==3.9.2" in requirements
    names = {line.split("==")[0].split("[")[0].strip().casefold() for line in requirements}
    assert names.isdisjoint(cpu.FORBIDDEN_RUNTIME)


def module_constant(tree: ast.Module, name: str):
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == name:
            return ast.literal_eval(node.value)
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError(f"{name} is not defined")


def test_gpu_worker_still_requires_cuda_and_shares_the_pinned_weights() -> None:
    # Read statically: importing the GPU module would start its health sidecar on a real port.
    source = GPU_APP.read_text(encoding="utf-8")
    tree = ast.parse(source)
    functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}

    assert module_constant(tree, "APP_NAME") == "tavonel-foundation-ocr-gpu"
    assert module_constant(tree, "OCR_MODEL_SHA256") == cpu.OCR_MODEL_SHA256
    assert module_constant(tree, "OCR_ENGINE_RELEASE") != cpu.OCR_ENGINE_RELEASE

    cuda_params = [
        node
        for node in ast.walk(functions["rapidocr_engines"])
        if isinstance(node, ast.Dict)
        and any(isinstance(key, ast.Constant) and key.value == "EngineConfig.onnxruntime.use_cuda" for key in node.keys)
    ]
    assert len(cuda_params) == 1
    [value] = [
        v
        for k, v in zip(cuda_params[0].keys, cuda_params[0].values, strict=True)
        if isinstance(k, ast.Constant) and k.value == "EngineConfig.onnxruntime.use_cuda"
    ]
    assert isinstance(value, ast.Constant) and value.value is True

    session_check = {node.value for node in ast.walk(functions["require_cuda_sessions"]) if isinstance(node, ast.Constant)}
    assert "CUDAExecutionProvider" in session_check
    constants = {node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
    assert CPU not in constants
    assert "cpu-raster" not in source
    assert "require_cpu_sessions" not in functions

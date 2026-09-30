from __future__ import annotations

import hashlib
import importlib
import io
import os
import secrets
import sys
import types
from datetime import UTC, datetime
from pathlib import Path

import pypdfium2 as pdfium
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("TAVONEL_OCR_HMAC", "fixture-ocr-hmac-secret-that-is-long-enough-123")

from app import app, normalized_bbox, ocr_request_signature  # noqa: E402

FIXTURE_SECRET = "fixture-ocr-hmac-secret-that-is-long-enough-123"


def tiny_text_pdf(text: str = "TAVONEL OCR") -> bytes:
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("ascii")
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
        b"<< /Length %d >> stream\n" % len(stream) + stream + b"\nendstream\nendobj\n",
        b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]
    # Object 4 needs the "4 0 obj" prefix
    objects[3] = b"4 0 obj " + objects[3]
    body = b"%PDF-1.4\n"
    offsets = [0]
    for obj in objects:
        offsets.append(len(body))
        body += obj
    xref_pos = len(body)
    xref = b"xref\n0 6\n0000000000 65535 f \n"
    for offset in offsets[1:]:
        xref += f"{offset:010d} 00000 n \n".encode("ascii")
    trailer = (
        b"trailer << /Size 6 /Root 1 0 R >>\n"
        + f"startxref\n{xref_pos}\n".encode("ascii")
        + b"%%EOF\n"
    )
    return body + xref + trailer


def headers(digest: str, secret: str = FIXTURE_SECRET, request_id: str | None = None) -> dict[str, str]:
    timestamp = datetime.now(UTC).isoformat()
    request_id = request_id or secrets.token_urlsafe(18)
    return {
        "x-tavonel-input-sha256": digest,
        "x-tavonel-ocr-timestamp": timestamp,
        "x-tavonel-ocr-request-id": request_id,
        "x-tavonel-ocr-signature": ocr_request_signature(secret, timestamp, request_id, digest),
    }


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_health_reports_ok_port_and_no_ssh(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["port"] == 8001
    assert body["ssh"] is False
    assert "gpu" in body
    assert isinstance(body["cudaSessionsSelected"], bool)
    assert "22" not in response.text


def install_fake_rapidocr(
    monkeypatch: pytest.MonkeyPatch,
    read: dict[str, list[tuple[str, float]]] | None = None,
    cpu_stage: tuple[str, str] | None = None,
) -> tuple[types.ModuleType, list[dict]]:
    """A RapidOCR stand-in: `read` maps engine label to the lines it returns for any image."""
    worker = importlib.import_module("app")
    monkeypatch.setattr(worker, "_general_rapidocr", None)
    monkeypatch.setattr(worker, "_korean_rapidocr", None)
    monkeypatch.setattr(worker, "_self_test", {"state": "pending", "detail": None})
    correct = [(line, 0.99) for line in worker.SELF_TEST_LINES]
    read = {"general": correct, "korean": correct, **(read or {})}
    calls: list[dict] = []

    def stage(label: str, name: str):
        provider = "CPUExecutionProvider" if cpu_stage == (label, name) else "CUDAExecutionProvider"
        providers = [provider, "CPUExecutionProvider"]
        return types.SimpleNamespace(session=types.SimpleNamespace(session=types.SimpleNamespace(get_providers=lambda: providers)))

    class FakeRapidOCR:
        def __init__(self, params: dict) -> None:
            calls.append(params)
            self.label = "korean" if "Rec.lang_type" in params else "general"
            self.text_det = stage(self.label, "detection")
            self.text_cls = stage(self.label, "classification")
            self.text_rec = stage(self.label, "recognition")

        def __call__(self, image, **options):
            calls.append({"engine": self.label, "options": options})
            lines = [line if len(line) == 3 else (*line, row) for row, line in enumerate(read[self.label])]
            return types.SimpleNamespace(
                boxes=[box_at(row) for _, _, row in lines],
                txts=tuple(text for text, _, _ in lines),
                scores=tuple(score for _, score, _ in lines),
            )

    fake = types.SimpleNamespace(
        RapidOCR=FakeRapidOCR,
        LangRec=types.SimpleNamespace(KOREAN="korean"),
        ModelType=types.SimpleNamespace(MOBILE="mobile"),
        OCRVersion=types.SimpleNamespace(PPOCRV5="PP-OCRv5"),
    )
    monkeypatch.setitem(sys.modules, "rapidocr", fake)
    return worker, calls


def test_self_test_passes_and_both_engines_run_on_cuda(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    worker, calls = install_fake_rapidocr(monkeypatch)
    assert client.get("/ping").status_code == 204  # still initializing
    general, korean = worker.rapidocr_engines()
    assert worker.rapidocr_engines() == (general, korean)
    constructed = [params for params in calls if "options" not in params]
    assert len(constructed) == 2
    assert all(params["EngineConfig.onnxruntime.use_cuda"] is True for params in constructed)
    # Korean support is kept: the second engine is the Korean PP-OCRv5 recognizer, and its
    # self-test reads the known page the same way requests are read, without the classifier.
    assert constructed[1]["Rec.lang_type"] == "korean"
    assert {"engine": "korean", "options": {"use_cls": False}} in calls
    response = client.get("/ping")
    assert response.status_code == 200
    assert response.json()["cudaSessionsSelected"] is True
    assert response.json()["recognitionSelfTest"] == {"state": "passed", "detail": None}


@pytest.mark.parametrize("label", ["general", "korean"])
@pytest.mark.parametrize("stage", ["detection", "classification", "recognition"])
def test_any_cpu_session_fails_closed(monkeypatch: pytest.MonkeyPatch, label: str, stage: str) -> None:
    worker, _ = install_fake_rapidocr(monkeypatch, cpu_stage=(label, stage))
    with pytest.raises(HTTPException) as refused:
        worker.rapidocr_engines()
    assert refused.value.status_code == 503
    assert worker._self_test["state"] == "failed"
    assert f"RapidOCR {label} {stage} session did not select CUDA" in worker._self_test["detail"]
    assert worker._general_rapidocr is None and worker._korean_rapidocr is None


@pytest.mark.parametrize("label", ["general", "korean"])
def test_a_misread_known_page_is_final_and_blocks_raster_ocr(
    monkeypatch: pytest.MonkeyPatch, client: TestClient, label: str
) -> None:
    # The production failure: every session on CUDA, one plausible region, wrong text, status ok.
    worker, calls = install_fake_rapidocr(monkeypatch, read={label: [("yme", 0.55334)]})
    worker.warm_engines()
    assert worker._self_test["state"] == "failed"
    assert "'yme'" in worker._self_test["detail"]
    assert client.get("/ping").status_code == 503
    assert client.get("/health").json()["cudaSessionsSelected"] is False
    constructed = len(calls)
    with pytest.raises(HTTPException) as refused:
        worker.rapidocr_engines()
    assert refused.value.status_code == 503
    assert len(calls) == constructed  # no silent retry that could later pass on a flaky GPU

    blank = pdfium.PdfDocument.new()
    blank.new_page(612, 792).close()
    buffer = io.BytesIO()
    blank.save(buffer)
    payload = buffer.getvalue()
    digest = "sha256:" + hashlib.sha256(payload).hexdigest()
    response = client.post("/v1/ocr", headers=headers(digest), files={"source": ("scan.pdf", payload, "application/pdf")})
    assert response.status_code == 503
    assert "self-test" in response.json()["detail"]


def test_self_test_rejects_low_confidence_and_accepts_whitespace_variants() -> None:
    worker = importlib.import_module("app")
    first, second = worker.SELF_TEST_LINES
    line = lambda text, confidence: {"polygon": [], "text": text, "confidence": confidence}  # noqa: E731
    assert worker.self_test_failure("general", [line(first, 0.99), line(second.replace(" ", "  "), 0.95)]) is None
    assert "confidence 0.800" in worker.self_test_failure("general", [line(first, 0.8), line(second, 0.99)])
    assert "instead of" in worker.self_test_failure("korean", [line(first, 0.99)])


def test_self_test_page_is_a_real_pdf_of_the_expected_lines() -> None:
    worker = importlib.import_module("app")
    document = pdfium.PdfDocument(worker.self_test_pdf())
    textpage = document[0].get_textpage()
    assert textpage.get_text_bounded().split() == " ".join(worker.SELF_TEST_LINES).split()
    image = worker.self_test_image()
    assert image.size == (round(612 * worker.RENDER_SCALE), round(792 * worker.RENDER_SCALE))


def box_at(row: int) -> list[list[float]]:
    return [[90, 134 + 80 * row], [800, 134 + 80 * row], [800, 174 + 80 * row], [90, 174 + 80 * row]]


def raster_line(text: str, confidence: float, row: int) -> dict:
    return {"polygon": box_at(row), "text": text, "confidence": confidence}


def squashed(lines: list[dict]) -> list[str]:
    # The Korean recognizer drops some spaces; compare text, not spacing.
    return ["".join(line["text"].split()) for line in lines]


# What both real models return for the private sparse mixed-language fixture (2026-09-30 audit).
SPARSE_MIXED_GENERAL = [
    raster_line("TAVONEL multilingual processing check", 0.99955, 0),
    raster_line("召2026-0930／125,000/377H", 0.92544, 2),
]
SPARSE_MIXED_KOREAN = [
    raster_line("TAVoNEL multilingual processing check", 0.959, 0),
    raster_line("고객 문서 처리 검증: 계약서와 설계 자료를 정리합니다.", 0.986, 1),
    raster_line("검증번호2026-0930/금액125,000원/수량37개", 0.999, 2),
    raster_line("이 문서는 실제 고객 자료가 아닌 운영 시험용 문서입니다.", 0.980, 3),
]
SPARSE_MIXED_EXPECTED = [
    "TAVONEL multilingual processing check",
    "고객 문서 처리 검증: 계약서와 설계 자료를 정리합니다.",
    "검증 번호 2026-0930 / 금액 125,000원 / 수량 37개",
    "이 문서는 실제 고객 자료가 아닌 운영 시험용 문서입니다.",
]


def test_sparse_mixed_korean_page_keeps_every_line() -> None:
    # Production returned only the heading and "召2026-0930／125,000/377H": the general reader
    # dropped both Hangul lines, and too little survived to trigger the old Korean probe.
    worker = importlib.import_module("app")
    merged = worker.merge_korean_lines(SPARSE_MIXED_GENERAL, SPARSE_MIXED_KOREAN)
    assert squashed(merged) == ["".join(line.split()) for line in SPARSE_MIXED_EXPECTED]
    assert merged[0]["text"] == "TAVONEL multilingual processing check"  # general wins Latin


def test_empty_general_output_keeps_the_korean_reading() -> None:
    worker = importlib.import_module("app")
    merged = worker.merge_korean_lines([], SPARSE_MIXED_KOREAN[1:])
    assert squashed(merged) == ["".join(line.split()) for line in SPARSE_MIXED_EXPECTED[1:]]


def test_numeric_mixed_line_keeps_the_hangul_the_general_reader_dropped() -> None:
    worker = importlib.import_module("app")
    general = [raster_line("Invoice No. 2026-0930 125,000", 0.971, 0), raster_line("啓377H", 0.787, 1)]
    korean = [raster_line("InvoiceNo.2026-0930금액 125,000원", 0.984, 0), raster_line("합계 37개", 0.933, 1)]
    assert [line["text"] for line in worker.merge_korean_lines(general, korean)] == [
        "InvoiceNo.2026-0930금액 125,000원",
        "합계 37개",
    ]


@pytest.mark.parametrize(
    ("general_text", "korean_text"),
    [
        ("客户文件处理验证：整理合同和设计资料。", "고객문서처리"),  # Chinese read with full confidence
        ("顧客文書の処理検証：契約書と設計資料を整理します。", "고객문서의처리"),  # Japanese (kana)
        ("Quarterly revenue grew 12% in 2026", "Quarterly revenue grew 12% in 2026"),
        ("Total 125,000", "Tota 가나"),  # Korean reading loses the digits and is not more confident
    ],
)
def test_general_reading_is_kept_for_non_korean_lines(general_text: str, korean_text: str) -> None:
    worker = importlib.import_module("app")
    general = [raster_line(general_text, 1.0, 0)]
    merged = worker.merge_korean_lines(general, [raster_line(korean_text, 0.9, 0)])
    assert [line["text"] for line in merged] == [general_text]


def test_raster_pages_always_get_the_korean_pass_without_the_angle_classifier(monkeypatch: pytest.MonkeyPatch) -> None:
    worker, calls = install_fake_rapidocr(
        monkeypatch,
        read={
            "general": [(line["text"], line["confidence"], row) for row, line in zip((0, 2), SPARSE_MIXED_GENERAL)],
            "korean": [(line["text"], line["confidence"], row) for row, line in enumerate(SPARSE_MIXED_KOREAN)],
        },
    )
    monkeypatch.setattr(worker, "_self_test", {"state": "passed", "detail": None})
    monkeypatch.setattr(worker, "_general_rapidocr", sys.modules["rapidocr"].RapidOCR(params={}))
    monkeypatch.setattr(worker, "_korean_rapidocr", sys.modules["rapidocr"].RapidOCR(params={"Rec.lang_type": "korean"}))
    blank = pdfium.PdfDocument.new()
    blank.new_page(612, 792).close()
    buffer = io.BytesIO()
    blank.save(buffer)

    text, _, regions = worker.extract_text(buffer.getvalue())

    assert [call for call in calls if "options" in call] == [
        {"engine": "general", "options": {}},
        {"engine": "korean", "options": {"use_cls": False}},
    ]
    assert "".join(text.split()) == "".join("".join(SPARSE_MIXED_EXPECTED).split())
    assert [region["regionId"] for region in regions] == [f"ocr-p0001-l{n:05d}" for n in range(1, 5)]


def test_rejects_non_pdf(client: TestClient) -> None:
    payload = b"this is not a pdf"
    digest = "sha256:" + hashlib.sha256(payload).hexdigest()
    response = client.post(
        "/v1/ocr",
        headers=headers(digest),
        files={"source": ("notes.txt", payload, "text/plain")},
    )
    assert response.status_code == 422
    assert "PDF" in response.json()["detail"]


def test_rejects_pdf_mime_without_magic(client: TestClient) -> None:
    payload = b"not-pdf-magic"
    digest = "sha256:" + hashlib.sha256(payload).hexdigest()
    response = client.post(
        "/v1/ocr",
        headers=headers(digest),
        files={"source": ("forged.pdf", payload, "application/pdf")},
    )
    assert response.status_code == 422


def test_extracts_text_from_tiny_pdf(client: TestClient) -> None:
    payload = tiny_text_pdf("TAVONEL OCR")
    digest = "sha256:" + hashlib.sha256(payload).hexdigest()
    response = client.post(
        "/v1/ocr",
        headers=headers(digest),
        files={"source": ("fixture.pdf", payload, "application/pdf")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schemaVersion"] == "tavonel.ocr_result.v2"
    assert body["status"] == "ok"
    assert body["pageCount"] == 1
    assert "TAVONEL OCR" in body["text"]
    assert body["inputSha256"] == digest
    assert "%PDF" not in body["text"]
    assert len(body["regions"]) == 1
    region = body["regions"][0]
    assert region["regionId"] == "native-p0001"
    assert region["pageIndex0"] == 0
    assert region["pageNumber1"] == 1
    assert region["order"] == 0
    assert region["authority"] == "informal"
    assert region["confidence"] == 1.0
    assert len(region["bbox1000"]) == 4
    assert 0 <= region["bbox1000"][0] < region["bbox1000"][2] <= 1000
    assert 0 <= region["bbox1000"][1] < region["bbox1000"][3] <= 1000


def test_normalized_bbox_clamps_and_preserves_positive_area() -> None:
    assert normalized_bbox(-5, -2, 120, 80, 100, 100) == [0, 0, 1000, 800]
    assert normalized_bbox(50, 50, 50, 50, 100, 100) == [500, 500, 501, 501]
    assert normalized_bbox(0, 0, 1, 1, 0, 100) is None


def test_ping_matches_health_shape(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setattr(importlib.import_module("app"), "_self_test", {"state": "passed", "detail": None})
    response = client.get("/ping")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["ssh"] is False


# ---------------------------------------------------------------- streamed reading
#
# The stream exists so a person can watch a document being read. The risk it introduces is that
# it becomes a second, weaker contract -- a way to get a partial or unauthenticated answer out of
# the worker. These tests hold the two properties that prevent that: authentication is decided
# before a single byte is streamed, and the last line of the stream is the same object the
# buffered response returns.

NDJSON = "application/x-ndjson"


def stream_lines(response) -> list[dict]:
    import json
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def test_stream_returns_the_same_result_object_as_the_buffered_response() -> None:
    client = TestClient(app)
    payload = tiny_text_pdf()
    digest = f"sha256:{hashlib.sha256(payload).hexdigest()}"

    buffered = client.post(
        "/v1/ocr",
        headers=headers(digest),
        files={"source": ("input.pdf", payload, "application/pdf")},
    )
    streamed = client.post(
        "/v1/ocr",
        headers={**headers(digest), "accept": NDJSON},
        files={"source": ("input.pdf", payload, "application/pdf")},
    )
    assert buffered.status_code == 200
    assert streamed.status_code == 200
    assert streamed.headers["content-type"].startswith(NDJSON)

    lines = stream_lines(streamed)
    assert len(lines) >= 2
    assert lines[-1] == buffered.json()


def test_stream_reports_each_page_before_the_result() -> None:
    client = TestClient(app)
    payload = tiny_text_pdf()
    digest = f"sha256:{hashlib.sha256(payload).hexdigest()}"
    lines = stream_lines(client.post(
        "/v1/ocr",
        headers={**headers(digest), "accept": NDJSON},
        files={"source": ("input.pdf", payload, "application/pdf")},
    ))

    pages = [line for line in lines if line.get("type") == "page"]
    assert len(pages) == lines[-1]["pageCount"]
    for index, page in enumerate(pages):
        assert page["schemaVersion"] == "tavonel.ocr_progress.v1"
        assert page["pageNumber1"] == index + 1
        assert page["path"] in {"native", "raster"}
        assert page["regionCount"] >= 0
        assert 0.0 <= page["meanConfidence"] <= 1.0
        # Boxes travel in the same normalized space the result uses, so a viewer can draw them
        # without knowing the page size.
        for box in page["boxes"]:
            assert len(box["bbox1000"]) == 4
            assert all(0 <= value <= 1000 for value in box["bbox1000"])
            # The line that was read travels with the box it was read from, so a viewer can
            # show the source page and the structured text filling in beside it.
            assert isinstance(box["text"], str)
            assert isinstance(box["regionId"], str) and box["regionId"]
    # The result is last, and nothing after it.
    assert lines[-1]["status"] == "ok"
    assert lines[-1]["schemaVersion"] == "tavonel.ocr_result.v2"


def test_stream_reports_every_region_exactly_once_across_pages() -> None:
    client = TestClient(app)
    payload = tiny_text_pdf()
    digest = f"sha256:{hashlib.sha256(payload).hexdigest()}"
    lines = stream_lines(client.post(
        "/v1/ocr",
        headers={**headers(digest), "accept": NDJSON},
        files={"source": ("input.pdf", payload, "application/pdf")},
    ))
    streamed_boxes = sum(len(line["boxes"]) for line in lines if line.get("type") == "page")
    assert streamed_boxes == len(lines[-1]["regions"])


def test_stream_refuses_an_unauthenticated_request_without_streaming_anything() -> None:
    client = TestClient(app)
    payload = tiny_text_pdf()
    digest = f"sha256:{hashlib.sha256(payload).hexdigest()}"
    response = client.post(
        "/v1/ocr",
        headers={
            "x-tavonel-input-sha256": digest,
            "accept": NDJSON,
        },
        files={"source": ("input.pdf", payload, "application/pdf")},
    )
    # Not a 200 carrying a refusal line: the request never becomes a stream at all.
    assert response.status_code >= 400
    assert not response.headers["content-type"].startswith(NDJSON)


def test_stream_refuses_a_digest_mismatch_before_reading(monkeypatch) -> None:
    client = TestClient(app)
    payload = tiny_text_pdf()
    wrong = f"sha256:{hashlib.sha256(b'a different document').hexdigest()}"
    response = client.post(
        "/v1/ocr",
        headers={**headers(wrong), "accept": NDJSON},
        files={"source": ("input.pdf", payload, "application/pdf")},
    )
    assert response.status_code == 422
    assert not response.headers["content-type"].startswith(NDJSON)


def test_a_client_that_does_not_ask_for_the_stream_still_gets_plain_json() -> None:
    client = TestClient(app)
    payload = tiny_text_pdf()
    digest = f"sha256:{hashlib.sha256(payload).hexdigest()}"
    response = client.post(
        "/v1/ocr",
        headers={**headers(digest), "accept": "*/*"},
        files={"source": ("input.pdf", payload, "application/pdf")},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["schemaVersion"] == "tavonel.ocr_result.v2"


def test_streamed_text_matches_the_result_and_is_bounded() -> None:
    client = TestClient(app)
    payload = tiny_text_pdf()
    digest = "sha256:" + hashlib.sha256(payload).hexdigest()
    lines = stream_lines(client.post(
        "/v1/ocr",
        headers={**headers(digest), "accept": NDJSON},
        files={"source": ("input.pdf", payload, "application/pdf")},
    ))
    by_region = {r["regionId"]: r["text"] for r in lines[-1]["regions"]}
    streamed = [box for line in lines if line.get("type") == "page" for box in line["boxes"]]
    assert streamed, "a document with regions must stream them"
    for box in streamed:
        # Same region, same text -- truncated only if it is very long, never rewritten.
        assert box["regionId"] in by_region
        assert by_region[box["regionId"]].startswith(box["text"][:50])
        assert len(box["text"]) <= 400

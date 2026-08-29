from __future__ import annotations

import hashlib
import os
import secrets
from datetime import UTC, datetime
from pathlib import Path
import sys

import pytest
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
    assert "22" not in response.text


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


def test_ping_matches_health_shape(client: TestClient) -> None:
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

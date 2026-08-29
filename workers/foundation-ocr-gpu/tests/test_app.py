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

from app import app, ocr_request_signature  # noqa: E402

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
    assert body["status"] == "ok"
    assert body["pageCount"] == 1
    assert "TAVONEL OCR" in body["text"]
    assert body["inputSha256"] == digest
    assert "%PDF" not in body["text"]


def test_ping_matches_health_shape(client: TestClient) -> None:
    response = client.get("/ping")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["ssh"] is False

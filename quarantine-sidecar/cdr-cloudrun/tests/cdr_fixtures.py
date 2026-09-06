"""Synthetic CDR fixtures shared by the mocked-scanner suite and the container suite.

The EICAR string is the industry test pattern, not malware: it is inert bytes every
scanner is required to flag. No real sample is ever committed here.
"""

from __future__ import annotations

import hashlib
import io
import secrets
import zipfile
from datetime import UTC, datetime

import fitz

EICAR = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


def clean_pdf(pad_to_bytes: int = 0) -> bytes:
    """A harmless one-page PDF, optionally padded with a trailing comment to a size."""

    document = fitz.open()
    try:
        page = document.new_page()
        page.insert_text((72, 72), "TAVONEL harmless synthetic CDR fixture")
        pdf = document.tobytes(garbage=4, deflate=True)
    finally:
        document.close()
    if pad_to_bytes > len(pdf) + 3:
        # Trailing bytes after %%EOF are ignored by readers and still reach the scanner.
        pdf += b"\n%" + bytes(range(256)) * ((pad_to_bytes - len(pdf) - 2) // 256 + 1)
        pdf = pdf[:pad_to_bytes]
    return pdf


def eicar_pdf() -> bytes:
    """A readable PDF that carries the EICAR pattern after %%EOF."""

    return clean_pdf() + b"\n%" + EICAR + b"\n"


def eicar_docx() -> bytes:
    """A minimal OOXML package with the EICAR pattern stored uncompressed."""

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as package:
        package.writestr("[Content_Types].xml", "<Types/>")
        package.writestr("word/document.xml", "<document/>")
        package.writestr("word/media/eicar.txt", EICAR)
    return buffer.getvalue()


def digest_of(payload: bytes) -> str:
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def signed_headers(secret: str, digest: str) -> dict[str, str]:
    from app import cdr_request_signature

    timestamp = datetime.now(UTC).isoformat()
    request_id = secrets.token_urlsafe(18)
    return {
        "x-tavonel-input-sha256": digest,
        "x-tavonel-cdr-timestamp": timestamp,
        "x-tavonel-cdr-request-id": request_id,
        "x-tavonel-cdr-signature": cdr_request_signature(secret, timestamp, request_id, digest),
    }

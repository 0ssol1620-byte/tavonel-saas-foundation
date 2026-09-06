"""Synthetic CDR fixtures shared by the mocked-scanner suite and the container suite.

The EICAR string is the industry test pattern, not malware: it is inert bytes every
scanner is required to flag. No real sample is ever committed here.
"""

from __future__ import annotations

import hashlib
import io
import secrets
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path

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


def sized_clean_bytes(size: int) -> bytes:
    """Deterministic harmless bytes of an exact size, for latency measurement."""

    head = b"%PDF-1.7\n% TAVONEL harmless synthetic scan fixture\n"
    if size < len(head):
        raise ValueError("fixture size is below the fixture header")
    return (head + bytes(range(256)) * (size // 256 + 1))[:size]


def eicar_pdf() -> bytes:
    """A structurally valid PDF carrying EICAR as an uncompressed embedded-file stream.

    ClamAV's EICAR signature matches the exact 68-byte file, so the pattern has to survive
    extraction as its own object: appending it to a PDF as trailing bytes is not detected,
    and a test written that way would quietly assert nothing (it did, in run 34020486232).
    """

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(eicar.txt) 6 0 R] >> >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
        b"<< /Length 8 >>\nstream\n0 0 m S\nendstream",
        b"<< /Type /EmbeddedFile /Length %d >>\nstream\n%s\nendstream" % (len(EICAR), EICAR),
        b"<< /Type /Filespec /F (eicar.txt) /EF << /F 5 0 R >> >>",
    ]
    pdf = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref_at = len(pdf)
    pdf += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    pdf += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    pdf += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref_at)
    return pdf


def eicar_docx() -> bytes:
    """A minimal OOXML package with the EICAR pattern stored uncompressed."""

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as package:
        package.writestr("[Content_Types].xml", "<Types/>")
        package.writestr("word/document.xml", "<document/>")
        package.writestr("word/media/eicar.txt", EICAR)
    return buffer.getvalue()


def host_antivirus_blocks(payload: bytes) -> bool:
    """True when the developer machine's own on-access scanner eats the fixture.

    A workstation with real-time protection quarantines an EICAR-carrying file the moment
    the service writes it to its work directory, so the test would fail for a reason that
    has nothing to do with this code. The container job has no on-access scanner and runs
    the same case for real.
    """

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        probe = Path(directory) / "probe.bin"
        try:
            probe.write_bytes(payload)
            return probe.read_bytes() != payload
        except OSError:
            return True


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

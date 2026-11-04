"""Measure what a candidate intake limit would admit, document by document (D1 stage 1).

PROGRAM-2026-11-04 §4.D decides the stage-1 limit (proposed 25 MiB / 200 pages) by measurement,
not by target. This script produces the measurement. It sends each document to a CDR revision
deployed for measurement -- zero traffic, limits raised through TAVONEL_CDR_MAX_* and page-range
raster on (app.py) -- and, only when asked and explicitly allowed to spend, to a reader endpoint
released for measurement, one page range at a time. It never calls a production endpoint by
default and it changes no limit anywhere.

Per document it records: source bytes and digest, CDR status/time/output bytes and digest, the
page count of the sanitized output, the OCR range plan (ceil(pages / range size)), and per-range
OCR status and time. The summary then states, for each candidate (bytes, pages) limit, how many
documents and pages would have been admitted, over the denominator of documents measured.

    TAVONEL_CDR_HMAC=... [TAVONEL_CDR_ID_TOKEN=...] python measure_limits.py \\
        --cdr-url https://<measurement-revision>/v1/disarm --out report.json docs/*.pdf
    # OCR timing is paid GPU time: it needs --ocr-url, TAVONEL_OCR_HMAC, --allow-paid-ocr
    # and (RunPod) RUNPOD_API_KEY.

The documents are hostile data. This script parses none of them: it hashes and uploads the
source, and counts pages only in the CDR's own image-only output.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import math
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path

# (status, headers, body) for one POST.
Post = Callable[[str, dict[str, str], bytes], tuple[int, dict[str, str], bytes]]

MIB = 1024 * 1024
DEFAULT_CANDIDATES = ((5 * MIB, 80), (25 * MIB, 200), (50 * MIB, 500))
MIME = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".tif": "image/tiff", ".tiff": "image/tiff",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


def signature(secret: str, timestamp: str, request_id: str, input_sha256: str) -> str:
    """The CDR's and the reader's request signature (app.py cdr_request_signature)."""
    raw = hmac.new(secret.encode(), f"{timestamp}.{request_id}.{input_sha256}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def multipart(name: str, mime: str, body: bytes) -> tuple[str, bytes]:
    boundary = "tavonel-" + secrets.token_hex(16)
    head = (f'--{boundary}\r\nContent-Disposition: form-data; name="source"; filename="{name}"\r\n'
            f"Content-Type: {mime}\r\n\r\n").encode()
    return f"multipart/form-data; boundary={boundary}", head + body + f"\r\n--{boundary}--\r\n".encode()


def ocr_ranges(pages: int, size: int) -> list[tuple[int, int]]:
    """The worker's plan for page-range OCR (FOUNDATION_OCR_PAGE_RANGE_SIZE): [start0, end0) per request."""
    return [(start, min(start + size, pages)) for start in range(0, pages, size)]


def count_pdf_pages(body: bytes) -> int | None:
    """Pages of the CDR's own output. pypdfium2 is the CDR's renderer; absent, the count is unknown."""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return None
    document = pdfium.PdfDocument(body)
    try:
        return len(document)
    finally:
        document.close()


def signed_headers(prefix: str, secret: str, digest: str) -> dict[str, str]:
    timestamp = datetime.now(UTC).isoformat()
    request_id = secrets.token_urlsafe(18)
    return {"x-tavonel-input-sha256": digest, f"x-tavonel-{prefix}-timestamp": timestamp,
            f"x-tavonel-{prefix}-request-id": request_id,
            f"x-tavonel-{prefix}-signature": signature(secret, timestamp, request_id, digest)}


def measure_document(
    path: Path, *, cdr_url: str, cdr_secret: str, post: Post, range_size: int,
    ocr_url: str | None = None, ocr_secret: str | None = None,
    cdr_auth: dict[str, str] | None = None, ocr_auth: dict[str, str] | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, object]:
    source = path.read_bytes()
    digest = f"sha256:{hashlib.sha256(source).hexdigest()}"
    record: dict[str, object] = {"file": path.name, "sourceBytes": len(source), "sourceSha256": digest}
    content_type, body = multipart(path.name, MIME.get(path.suffix.lower(), "application/octet-stream"), source)
    headers = {**signed_headers("cdr", cdr_secret, digest), "content-type": content_type, **(cdr_auth or {})}
    started = clock()
    status, response_headers, output = post(cdr_url, headers, body)
    cdr: dict[str, object] = {"httpStatus": status, "seconds": round(clock() - started, 3)}
    record["cdr"] = cdr
    if status != 200:
        try:
            cdr["detail"] = json.loads(output).get("detail")
        except (ValueError, AttributeError):
            cdr["detail"] = None
        record["pages"] = None
        return record
    output_digest = f"sha256:{hashlib.sha256(output).hexdigest()}"
    if response_headers.get("x-tavonel-cdr-output-sha256") != output_digest:
        cdr["detail"] = "CDR output digest does not match the body"
        record["pages"] = None
        return record
    cdr.update({"outputBytes": len(output), "outputSha256": output_digest})
    pages = count_pdf_pages(output)
    record["pages"] = pages
    plan = ocr_ranges(pages, range_size) if pages else []
    record["ocrPlan"] = {"rangeSize": range_size, "ranges": len(plan)}
    if ocr_url and ocr_secret and plan:
        reads = []
        content_type, body = multipart("sanitized.pdf", "application/pdf", output)
        for start0, end0 in plan:
            headers = {**signed_headers("ocr", ocr_secret, output_digest), "content-type": content_type,
                       "x-tavonel-ocr-page-range": f"{start0}-{end0}", **(ocr_auth or {})}
            started = clock()
            status, _, answer = post(ocr_url, headers, body)
            reads.append({"range": f"{start0}-{end0}", "httpStatus": status, "seconds": round(clock() - started, 3),
                          "answerBytes": len(answer)})
        record["ocr"] = {"ranges": reads, "seconds": round(sum(float(read["seconds"]) for read in reads), 3),
                         "complete": all(read["httpStatus"] == 200 for read in reads)}
    return record


def p95(values: Sequence[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(0.95 * len(ordered)) - 1)]


def summarize(records: Sequence[dict], candidates: Sequence[tuple[int, int]] = DEFAULT_CANDIDATES) -> dict[str, object]:
    """What each candidate limit would admit, with its denominator. A document whose page count is
    unknown (the CDR refused it, or it was not counted) is never admitted: unknown is not "fits"."""
    measured_pages = sum(int(r["pages"]) for r in records if isinstance(r.get("pages"), int))
    rows = []
    for max_bytes, max_pages in candidates:
        admitted = [r for r in records if r["sourceBytes"] <= max_bytes
                    and isinstance(r.get("pages"), int) and r["pages"] <= max_pages]
        times = [float(r["cdr"]["seconds"]) for r in admitted]
        ocr_times = [float(r["ocr"]["seconds"]) for r in admitted if isinstance(r.get("ocr"), dict)]
        rows.append({
            "maxSourceBytes": max_bytes, "maxPages": max_pages,
            "documentsAdmitted": len(admitted), "documentsMeasured": len(records),
            "pagesAdmitted": sum(int(r["pages"]) for r in admitted), "pagesCounted": measured_pages,
            "cdrSecondsP95": p95(times), "ocrSecondsP95": p95(ocr_times),
        })
    return {
        "documentsMeasured": len(records),
        "documentsWithUnknownPages": sum(1 for r in records if not isinstance(r.get("pages"), int)),
        "candidates": rows,
        "note": "Measured, not a target. pagesCounted covers only documents the CDR rendered; a census "
                "denominator (e.g. GDP 100 documents / 4,592 pages) is stated beside it, never substituted.",
    }


def urllib_post(timeout: float) -> Post:
    def post(url: str, headers: dict[str, str], body: bytes) -> tuple[int, dict[str, str], bytes]:
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
        except urllib.error.HTTPError as error:
            return error.code, {k.lower(): v for k, v in error.headers.items()}, error.read()
    return post


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("documents", nargs="+", type=Path)
    parser.add_argument("--cdr-url", required=True)
    parser.add_argument("--ocr-url")
    parser.add_argument("--allow-paid-ocr", action="store_true")
    parser.add_argument("--range-size", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    cdr_secret = os.environ.get("TAVONEL_CDR_HMAC", "").strip()
    if len(cdr_secret) < 32:
        parser.error("TAVONEL_CDR_HMAC (>= 32 characters) is required in the environment")
    ocr_secret = os.environ.get("TAVONEL_OCR_HMAC", "").strip() or None
    if args.ocr_url and not (args.allow_paid_ocr and ocr_secret):
        parser.error("--ocr-url is paid GPU time: it needs --allow-paid-ocr and TAVONEL_OCR_HMAC")
    if not 1 <= args.range_size <= 64:
        parser.error("--range-size must be 1..64")
    # The CDR is internal ingress behind an identity token; the reader is a RunPod endpoint.
    bearer = lambda name: {"authorization": f"Bearer {os.environ[name].strip()}"} if os.environ.get(name, "").strip() else None  # noqa: E731
    post = urllib_post(args.timeout)
    records = [measure_document(path, cdr_url=args.cdr_url, cdr_secret=cdr_secret, post=post,
                                range_size=args.range_size, ocr_url=args.ocr_url, ocr_secret=ocr_secret,
                                cdr_auth=bearer("TAVONEL_CDR_ID_TOKEN"), ocr_auth=bearer("RUNPOD_API_KEY"))
               for path in args.documents]
    report = {"schemaVersion": "tavonel.limit_measurement.v1", "measuredAt": datetime.now(UTC).isoformat(),
              "cdrUrl": args.cdr_url, "ocrUrl": args.ocr_url, "rangeSize": args.range_size,
              "documents": records, "summary": summarize(records)}
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

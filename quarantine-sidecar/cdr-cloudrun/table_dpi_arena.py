"""D3 table product-DPI Arena harness, and the D2 text-layer shadow on fixtures (PROGRAM-2026-11-04 §4.D).

An operator research tool, like measure_limits.py: it is not in the image (Dockerfile copies named
files only) and never runs in a request. It reads public fixtures only -- the SEC filings under
nextjs/public/explore-sample/ (sec-corpus-manifest.json names their EDGAR sources) -- never customer
data, never a paid API, never a GPU. Inputs are PDFs; every one is treated as hostile data and only
rendered, never executed.

D3 (`table` command). §4.D D3-AX: Arena table scores came from staged PNGs at source resolution,
while the product CDR renders at 108 DPI, so the reader is measured again at product DPIs
(108 / 150 / 200). For each table-bearing page and each DPI the harness rebuilds what the CDR
emits for that page (one image-only PDF page, the CDR's render path: app.py rasterize_to_pdf) and
reads it the way the GPU reader does (render that page at the reader's scale, then line OCR). Per
row: sanitized page bytes, raster seconds, OCR seconds, OCR line count, and the table proxy §4.D
defines -- TEDS and cell-level Critical Numeric Fidelity:
  * TEDS is not computed for a line-OCR arm: it emits no table structure, so §4.D scores it 0 by
    definition (the "0점 baseline"). The receipt says so instead of printing a measured-looking 0.
  * numericRecall = exact numeric tokens OCR recovered / numeric tokens in the page's own text layer
    (multiset, denominator printed). The layer is the filing's text, so it is the page's gold for
    numbers; it does not place a number in a cell, so it is a proxy for cell exact match, not it.
The reader scale is recorded twice over, because it decides the result: the product reader renders
every sanitized page at RENDER_SCALE 2.0 (144 DPI), so a CDR DPI above 144 is resampled down before
OCR. `--reader-scale native` reads at the CDR DPI instead, to show what that costs.

Arms: `rapidocr-line` runs locally on CPU. `paddleocr-vl` is the §4.D candidate and needs a GPU: the
harness refuses it with `GPU_REQUIRED_ORCHESTRATOR_GO` and starts nothing (no RunPod resource).

D2 (`text-layer` command). Runs the CDR's own text_layer.read_document on each fixture and compares
every `textlayer` page with line OCR of the product raster (108 DPI, reader scale 2.0), with the
same character agreement the worker shadow records (foundation-cdr-worker src/text-layer-shadow.ts
charAgreement). Counts and digests only; no page text is written.

Usage (pypdfium2 5.13.0 and an OCR engine on the path; neither is installed by this tool):
  python table_dpi_arena.py table --out receipt.json <pdf>...
  python table_dpi_arena.py text-layer --out receipt.json <pdf>...
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import platform
import re
import sys
import time
import unicodedata
from collections import Counter
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Final

TABLE_SCHEMA: Final = "tavonel.arena.table_product_dpi.v1"
SHADOW_SCHEMA: Final = "tavonel.arena.text_layer_shadow_fixture.v1"
PROGRAM: Final = "PROGRAM-2026-11-04 §4.D"
CANDIDATE_DPIS: Final = (108, 150, 200)
PRODUCT_DPI: Final = 108  # CDR RENDER_SCALE 1.5 x 72
READER_RENDER_SCALE: Final = 2.0  # workers/foundation-ocr-gpu app.py RENDER_SCALE
GPU_ARMS: Final = {"paddleocr-vl"}
LOCAL_ARMS: Final = {"rapidocr-line"}
# A page is table-bearing when its text layer carries at least this many numeric tokens. Chosen,
# not calibrated: SEC statements pages carry well over 40, prose pages a handful.
TABLE_PAGE_MIN_NUMBERS: Final = 40
TABLE_PAGES_PER_DOCUMENT: Final = 4

# 1,234  (1,234)  12.5  12.5%  $1,234  -- the sign, currency and parentheses are stripped; the digits,
# separators and decimal point are the token. A bare one- or two-digit number is not counted: page
# numbers and footnote marks would dominate.
NUMBER: Final = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d{3,}")


def numeric_tokens(text: str) -> Counter[str]:
    return Counter(NUMBER.findall(unicodedata.normalize("NFKC", text)))


def numeric_recall(gold: Counter[str], read: Counter[str]) -> tuple[int, int]:
    """(recovered, gold total) over the multiset of numeric tokens."""
    return sum(min(count, read[token]) for token, count in gold.items()), sum(gold.values())


def char_agreement(layer: str, ocr: str) -> tuple[int, int, int, float | None]:
    """The worker shadow's measure (text-layer-shadow.ts charAgreement): NFKC, lower case, no
    whitespace, then 2 x shared characters / both totals. Returns (layer, ocr, matched, dice)."""
    def counts(text: str) -> Counter[str]:
        return Counter(re.sub(r"\s+", "", unicodedata.normalize("NFKC", text).lower()))
    a, b = counts(layer), counts(ocr)
    matched = sum(min(count, a[char]) for char, count in b.items())
    total = sum(a.values()) + sum(b.values())
    return sum(a.values()), sum(b.values()), matched, (2 * matched / total if total else None)


def sha256_file(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def table_pages(page_texts: list[str]) -> list[int]:
    """0-based pages whose layer has enough numbers to be a table page, in page order, capped."""
    chosen = [index for index, text in enumerate(page_texts) if sum(numeric_tokens(text).values()) >= TABLE_PAGE_MIN_NUMBERS]
    return chosen[:TABLE_PAGES_PER_DOCUMENT]


class GpuRequired(RuntimeError):
    code = "GPU_REQUIRED_ORCHESTRATOR_GO"


def refuse_gpu_arm(arm: str) -> None:
    if arm in GPU_ARMS:
        raise GpuRequired(f"{arm} needs a GPU reader; nothing was started. Run it only on the orchestrator's go.")
    if arm not in LOCAL_ARMS:
        raise ValueError(f"unknown arm {arm!r}")


# --- rendering: the CDR path for one page, then the reader's render of it --------------------------

def cdr_page_pdf(pdf, page_index: int, dpi: int) -> bytes:
    """One image-only PDF page, built the way app.py rasterize_to_pdf builds each page."""
    import pypdfium2 as pdfium
    page = pdf[page_index]
    out = pdfium.PdfDocument.new()
    try:
        width, height = page.get_size()
        bitmap = page.render(scale=dpi / 72, fill_color=(255, 255, 255, 255))
        try:
            target = out.new_page(width, height)
            image = pdfium.PdfImage.new(out)
            image.set_bitmap(bitmap)
            image.set_matrix(pdfium.PdfMatrix().scale(width, height))
            target.insert_obj(image)
            target.gen_content()
            target.close()
        finally:
            bitmap.close()
        stream = io.BytesIO()
        out.save(stream)
        return stream.getvalue()
    finally:
        out.close()
        page.close()


def reader_image(page_pdf: bytes, scale: float):
    import pypdfium2 as pdfium
    document = pdfium.PdfDocument(page_pdf)
    try:
        page = document[0]
        try:
            return page.render(scale=scale, fill_color=(255, 255, 255, 255)).to_pil().convert("RGB")
        finally:
            page.close()
    finally:
        document.close()


def layer_texts(pdf) -> list[str]:
    texts = []
    for index in range(len(pdf)):
        page = pdf[index]
        textpage = page.get_textpage()
        try:
            texts.append(textpage.get_text_range())
        finally:
            textpage.close()
            page.close()
    return texts


# --- the local line-OCR arm ---------------------------------------------------------------------

def rapidocr_reader() -> tuple[Callable[[object], list[str]], dict[str, object]]:
    """The installed rapidocr_onnxruntime, pinned by package version and model file digests."""
    import importlib.metadata as metadata
    import numpy
    import onnxruntime
    import rapidocr_onnxruntime
    engine = rapidocr_onnxruntime.RapidOCR()
    models = Path(rapidocr_onnxruntime.__file__).parent / "models"

    def read(image) -> list[str]:
        result, _ = engine(numpy.asarray(image))
        return [str(line[1]) for line in (result or [])]

    return read, {
        "arm": "rapidocr-line",
        "package": f"rapidocr_onnxruntime=={metadata.version('rapidocr_onnxruntime')}",
        "onnxruntime": onnxruntime.__version__,
        "executionProvider": "CPUExecutionProvider",
        "models": {path.name: sha256_file(path) for path in sorted(models.glob("*.onnx"))},
        "isProductReader": False,
        "productReader": "workers/foundation-ocr-gpu OCR_ENGINE_RELEASE rapidocr-3.9.2-ko-pass-nocls-v3-selftest (GPU image)",
    }


def environment() -> dict[str, object]:
    import pypdfium2
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "pypdfium2": str(getattr(getattr(pypdfium2, "version", None), "PYPDFIUM_INFO", None) or getattr(pypdfium2, "V_PYPDFIUM2", "unknown")),
        "harnessSha256": sha256_file(Path(__file__)),
    }


# --- D3 -----------------------------------------------------------------------------------------

def run_table(paths: Iterable[Path], read: Callable[[object], list[str]], reader: dict[str, object],
              reader_scale: str, dpis: Iterable[int] = CANDIDATE_DPIS) -> dict[str, object]:
    import pypdfium2 as pdfium
    fixtures, rows = [], []
    for path in paths:
        pdf = pdfium.PdfDocument(path.read_bytes())
        try:
            texts = layer_texts(pdf)
            chosen = table_pages(texts)
            fixtures.append({"file": path.name, "sha256": sha256_file(path), "pages": len(texts),
                             "tablePages1": [index + 1 for index in chosen]})
            for index in chosen:
                gold = numeric_tokens(texts[index])
                for dpi in dpis:
                    started = time.perf_counter()
                    page_pdf = cdr_page_pdf(pdf, index, dpi)
                    raster_seconds = time.perf_counter() - started
                    scale = READER_RENDER_SCALE if reader_scale == "product" else dpi / 72
                    started = time.perf_counter()
                    lines = read(reader_image(page_pdf, scale))
                    ocr_seconds = time.perf_counter() - started
                    recovered, total = numeric_recall(gold, numeric_tokens("\n".join(lines)))
                    rows.append({
                        "file": path.name, "page1": index + 1, "cdrDpi": dpi, "readerScale": scale,
                        "sanitizedPageBytes": len(page_pdf), "sanitizedPageSha256": "sha256:" + hashlib.sha256(page_pdf).hexdigest(),
                        "rasterSeconds": round(raster_seconds, 3), "ocrSeconds": round(ocr_seconds, 3),
                        "ocrLines": len(lines),
                        "numericRecovered": recovered, "numericGold": total,
                        "numericRecall": round(recovered / total, 4) if total else None,
                        "teds": None, "tedsNote": "line OCR emits no table structure: 0 by definition (§4.D baseline), not measured",
                    })
        finally:
            pdf.close()
    by_dpi = {}
    for dpi in dpis:
        picked = [row for row in rows if row["cdrDpi"] == dpi]
        recovered = sum(row["numericRecovered"] for row in picked)
        total = sum(row["numericGold"] for row in picked)
        by_dpi[str(dpi)] = {
            "pages": len(picked), "numericRecovered": recovered, "numericGold": total,
            "numericRecall": round(recovered / total, 4) if total else None,
            "sanitizedPageBytes": sum(row["sanitizedPageBytes"] for row in picked),
            "ocrLines": sum(row["ocrLines"] for row in picked),
            "rasterSeconds": round(sum(row["rasterSeconds"] for row in picked), 3),
            "ocrSeconds": round(sum(row["ocrSeconds"] for row in picked), 3),
        }
    return {
        "schemaVersion": TABLE_SCHEMA, "program": PROGRAM, "status": "measured",
        "claim": "internal research receipt; not a public number",
        "dpis": list(dpis), "productDpi": PRODUCT_DPI, "readerScaleMode": reader_scale,
        "tablePageRule": f">= {TABLE_PAGE_MIN_NUMBERS} numeric tokens in the page's text layer, first {TABLE_PAGES_PER_DOCUMENT} per document",
        "numericToken": NUMBER.pattern, "reader": reader, "environment": environment(),
        "fixtures": fixtures, "rows": rows, "byDpi": by_dpi,
        "notRun": [{"arm": arm, "code": GpuRequired.code} for arm in sorted(GPU_ARMS)],
    }


# --- D2 -----------------------------------------------------------------------------------------

def run_text_layer(paths: Iterable[Path], read: Callable[[object], list[str]], reader: dict[str, object]) -> dict[str, object]:
    import pypdfium2 as pdfium
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import text_layer  # the CDR's own module, pinned pypdfium2 5.13.0

    documents = []
    for path in paths:
        source = path.read_bytes()
        digest = "sha256:" + hashlib.sha256(source).hexdigest()
        receipt = text_layer.read_document(source, digest, 1.5)
        entry: dict[str, object] = {"file": path.name, "sha256": digest, "layerStatus": receipt["status"],
                                    "layerReason": receipt.get("reason"), "pathCounts": receipt.get("pathCounts")}
        pages = []
        if receipt["status"] == "extracted":
            pdf = pdfium.PdfDocument(source)
            try:
                for page in receipt["pages"]:
                    if page["path"] != text_layer.TEXTLAYER:
                        continue
                    index = page["pageNumber1"] - 1
                    lines = read(reader_image(cdr_page_pdf(pdf, index, PRODUCT_DPI), READER_RENDER_SCALE))
                    layer_chars, ocr_chars, matched, dice = char_agreement(page["text"], "\n".join(lines))
                    pages.append({"page1": index + 1, "layerChars": layer_chars, "ocrChars": ocr_chars,
                                  "matchedChars": matched, "charDice": None if dice is None else round(dice, 4)})
            finally:
                pdf.close()
        layer = sum(page["layerChars"] for page in pages)
        ocr = sum(page["ocrChars"] for page in pages)
        matched = sum(page["matchedChars"] for page in pages)
        entry.update({"pages": len(receipt.get("pages", [])), "comparedPages": len(pages), "layerChars": layer,
                      "ocrChars": ocr, "matchedChars": matched,
                      "microDice": round(2 * matched / (layer + ocr), 4) if layer + ocr else None, "perPage": pages})
        documents.append(entry)
    layer = sum(int(doc["layerChars"]) for doc in documents)
    ocr = sum(int(doc["ocrChars"]) for doc in documents)
    matched = sum(int(doc["matchedChars"]) for doc in documents)
    dices = [page["charDice"] for doc in documents for page in doc["perPage"] if page["charDice"] is not None]
    return {
        "schemaVersion": SHADOW_SCHEMA, "program": PROGRAM, "status": "measured",
        "claim": "internal research receipt; not a public number; nothing here is served",
        "metric": "char_multiset_dice:nfkc+lowercase+no_whitespace (text-layer-shadow.ts)",
        "ocrWitness": f"CDR raster at {PRODUCT_DPI} DPI, read at reader scale {READER_RENDER_SCALE}",
        "reader": reader, "environment": environment(), "textLayerRules": "cdr-cloudrun text_layer.py (uncalibrated)",
        "documents": documents,
        "summary": {
            "documents": len(documents),
            "pages": sum(int(doc["pages"]) for doc in documents),
            "comparedPages": sum(int(doc["comparedPages"]) for doc in documents),
            "layerChars": layer, "ocrChars": ocr, "matchedChars": matched,
            "microDice": round(2 * matched / (layer + ocr), 4) if layer + ocr else None,
            "pagesDiceBelow0_9": sum(1 for dice in dices if dice < 0.9),
            "minPageDice": min(dices) if dices else None,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("command", choices=["table", "text-layer"])
    parser.add_argument("pdfs", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--arm", default="rapidocr-line")
    parser.add_argument("--reader-scale", choices=["product", "native"], default="product")
    args = parser.parse_args(argv)
    try:
        refuse_gpu_arm(args.arm)
    except GpuRequired as stop:
        print(json.dumps({"status": "not_run", "code": stop.code, "arm": args.arm, "reason": str(stop)}))
        return 3
    read, reader = rapidocr_reader()
    receipt = (run_table(args.pdfs, read, reader, args.reader_scale) if args.command == "table"
               else run_text_layer(args.pdfs, read, reader))
    body = json.dumps(receipt, indent=2, sort_keys=True, ensure_ascii=False).encode("utf-8")
    args.out.write_bytes(body)
    print(json.dumps({"out": str(args.out), "sha256": "sha256:" + hashlib.sha256(body).hexdigest()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

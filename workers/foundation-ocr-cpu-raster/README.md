# foundation-ocr-cpu-raster

CPU-only raster OCR worker. It reads scanned or image-only PDF pages from rendered pixels with the
same pinned RapidOCR 3.9.2 models (three SHA256 digests) and the same signed request contract as
`workers/foundation-ocr-gpu`, on `onnxruntime==1.20.1` (CPU build only).

- `POST /v1/ocr`: HMAC-signed input digest, timestamp window and single-use request id; PDF only,
  18 MiB and 80 pages max. Pages with embedded text keep it; other pages are rasterized. Returns
  `tavonel.ocr_result.v2` with normalized `bbox1000` region geometry. All responses are `no-store`.
- `bbox1000` frame: the displayed page, i.e. the CropBox rotated clockwise by `/Rotate`, origin at
  the top left, for raster and native-text regions alike. Native text boxes are mapped there with
  PDFium's own page-to-device transform; a mapping PDFium refuses yields no native region.
- Raster bounds: before the first page is rendered, every page must have a finite, positive size,
  and every page without a text layer (the pages that would be rasterized) is sized as the renderer
  allocates it, `ceil(points * RENDER_SCALE)` per side at `RENDER_SCALE = 2`. Each side must be at
  most `MAX_RASTER_SIDE_PX` (8192 px), each page at most `MAX_RASTER_PAGE_PIXELS` (16 MiP, so an A1
  page fits), and all raster pages together at most `MAX_RASTER_TOTAL_PIXELS` (80 x 4 MiP, which
  allows 80 A3 pages). The whole document is checked before any render, so a later unsafe page refuses
  it before earlier pages are rasterized. A refusal is `422` with the fixed, `no-store` detail
  `OCR source page geometry is not qualified`. Pages with embedded text are never rendered and do not
  count against the pixel budgets. The 18 MiB and 80-page limits are unchanged and are checked first.
- `GET /ping`: `204` while loading, `200` only after both engines read a rendered known page on
  `CPUExecutionProvider` sessions at confidence >= 0.90, with each known line located in its expected
  region, and `503` once that self-test failed (final). The regions are broad page fractions derived
  from the known page's drawing coordinates, not from OCR output. Horizontally each region spans the
  page inside half the left margin. Vertically each is one line step tall, centered on the glyphs'
  middle, so the bands of neighboring lines never overlap. At least 60% of a known line's box must lie
  in its own region. A line read at the wrong place, or two lines swapped, fails the self-test.
- `GET /health`: liveness plus engine release, model digests, execution provider and readiness.

Initialization fails closed if an accelerator onnxruntime build or provider is present, if any
detector/classifier/recognizer session is not exactly `CPUExecutionProvider`, if a pinned model is
missing or has a different digest, or if loading changes the model directory (a download).

## Tests

- `workers/foundation-ocr-cpu-raster/tests/test_cpu_raster_app.py`: unit and contract tests. They
  cover HMAC, timestamp and replay checks, digest tampering, the secret configuration, non-PDF input,
  empty and oversized input, the page limit, blank pages, the `tavonel.ocr_result.v2` schema, fixed
  `no-store` errors that do not echo the source, honest `/ping` and `/health` readiness, and
  fail-closed model and provider checks. That includes each of the six detector/classifier/recognizer
  sessions refusing CPU mixed with an accelerator. The raster bounds are tested with tiny synthetic
  PDFs whose MediaBox declares oversized pages, along with tightened monkeypatched budgets. In those
  tests a render sentinel fails on any render, so nothing large is ever rendered or allocated. They
  show that a normal image-only page still passes, and that each of these is refused before any
  render: an oversized width or height, a page over the per-page budget, a document over the aggregate
  budget (including one whose last page is the unsafe one), and NaN, infinite, zero, negative or
  malformed page sizes. Each refusal keeps the fixed `no-store` detail. They also show that a document
  exactly at the aggregate budget passes and that native-text pages are not budgeted. For the
  self-test regions, the tests show that the real rendered known page has all its ink inside the
  disjoint regions. Correctly placed or loosely varied line boxes pass, and a correct line moved
  down, off to the right, or swapped with the other line fails. A fake RapidOCR stands in for the engines, so these
  tests need no OCR runtime or model files and never skip. The GPU worker is checked statically
  (it still requests CUDA and shares the pinned digests); it is not imported or run.
- `workers/foundation-ocr-cpu-raster/tests/test_cpu_raster_qualification.py`: real end-to-end
  qualification with the installed `onnxruntime==1.20.1` CPU build and RapidOCR 3.9.2, with no fake
  engines. It draws known text into pixels with Pillow and embeds that raster as the only content of
  a one-page PDF with no text layer, then confirms that PDFium finds no embedded text but renders
  visible ink. It then runs the real worker startup self-test and an authenticated `POST /v1/ocr`.
  Its fixture check always runs. It also places the same raster on pages with a nonzero-origin
  MediaBox plus CropBox and with `/Rotate` 90, 180 and 270, and requires each known line's box to
  contain the line's drawn ink box (from Pillow's `textbbox`, not from OCR) at IoU >= 0.5, and not to
  match the other line.
- `workers/foundation-ocr-cpu-raster/tests/test_cpu_raster_bbox_location.py`: location checks with
  no OCR runtime. Native-text and filled-rectangle pages are drawn at known user-space coordinates on
  upright, nonzero-origin MediaBox, CropBox, `/Rotate` 90/180/270 and combined pages; the expected
  box comes from the PDF geometry rules in the test (and, for text, from the rendered ink too), and
  the emitted box must overlap it at IoU >= 0.8 (native) or 0.9 (raster, via a stand-in reader that
  reports the rendered ink). Boxes left in PDF user space are shown to fail the same check.

CI: `.github/workflows/foundation-ocr-cpu-raster.yml` installs the pinned requirements on Linux,
runs `materialize_models.py`, and fails if any test is skipped.

The real qualification test calls `pytest.skip` with a specific reason, and never substitutes a fake
result, when any of these prerequisites is missing: the pinned CPU runtime (an accelerator
onnxruntime build is present, or `onnxruntime`/`rapidocr` are not at the pinned versions or cannot be
imported), or the verified model assets (a pinned model is missing or has a different digest, which
means the approved build-time download in `materialize_models.py` has not been done). The test never
downloads models itself.

## Evidence scope

Passing `tests/test_cpu_raster_qualification.py` is CPU OCR evidence only, on an entirely
synthetic, operator-owned image-only PDF generated in the test. It is not evidence for the GPU
worker, CUDA, Cloudflare (R2 or otherwise), or app intake. A skipped qualification is not evidence
of anything. `tests/test_cpu_raster_app.py` always runs, and its fake engines never count as
qualification.

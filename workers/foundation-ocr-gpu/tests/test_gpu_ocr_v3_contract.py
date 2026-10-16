"""Run the exact postimage OCR functions with fictional engine rows; no model is loaded."""
import ast
import json
import pathlib
import re
from threading import Lock
from typing import Final, NotRequired, TypedDict

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "app.py").read_text(encoding="utf-8")
tree = ast.parse(SOURCE)
names = {"OCR_MODEL_SHA256", "RECOGNIZER_IDENTITIES", "OcrRegion", "RasterLine",
         "rapidocr_lines", "recognition_candidate", "_script_counts", "_bounds", "_intersection_over_union",
         "_prefer_korean", "merge_korean_lines", "normalized_bbox", "raster_regions", "ocr_result_body"}
selected = []
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names or isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id in names:
        selected.append(node)
module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *selected], type_ignores=[])

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code



def test_fictional_worker_ocr_v3_contract() -> None:
    ns = {"Final": Final, "NotRequired": NotRequired, "TypedDict": TypedDict,
          "HTTPException": HTTPException, "re": re, "_engine_lock": Lock(),
          "OCR_CONFLICT_V3_ENABLED": True}
    # Execute only the selected, already parsed worker functions with fictional engines.
    exec(compile(ast.fix_missing_locations(module), str(ROOT / "app.py"), "exec"), ns)  # noqa: S102
    sha = "sha256:" + "a" * 64
    poly = [[10.0, 20.0], [110.0, 20.0], [110.0, 40.0], [10.0, 40.0]]
    general = {"polygon": poly, "text": "FICTIONAL-A", "confidence": 0.71}
    korean = {"polygon": [[11.0, 20.0], [111.0, 20.0], [111.0, 40.0], [11.0, 40.0]],
              "text": "FICTIONAL-B", "confidence": 0.69}
    merged = ns["merge_korean_lines"]([general], [korean])
    assert len(merged) == 1 and merged[0]["text"] == "FICTIONAL-A"
    assert [candidate["text"] for candidate in merged[0]["recognitionCandidates"]] == [general["text"], korean["text"]]
    assert [candidate["polygon"] for candidate in merged[0]["recognitionCandidates"]] == [general["polygon"], korean["polygon"]]
    assert [candidate["modelSha256"] for candidate in merged[0]["recognitionCandidates"]] == [
        "sha256:" + ns["OCR_MODEL_SHA256"]["general-rec"], "sha256:" + ns["OCR_MODEL_SHA256"]["korean-rec"]]
    raw_general = {**general, "rawText": " FICTIONAL-A "}
    raw_korean = {**korean, "rawText": " FICTIONAL-B "}
    class FakeEngineResult:
        def __init__(self):
            self.boxes = [poly]
            self.txts = [" FICTIONAL-A "]
            self.scores = [.71]
    parsed = ns["rapidocr_lines"](lambda _image: FakeEngineResult(), object())[0]
    assert parsed["text"] == "FICTIONAL-A" and parsed["rawText"] == " FICTIONAL-A "
    raw_merged = ns["merge_korean_lines"]([raw_general], [raw_korean])[0]
    assert [c["text"] for c in raw_merged["recognitionCandidates"]] == [" FICTIONAL-A ", " FICTIONAL-B "]
    assert "recognitionCandidates" not in ns["merge_korean_lines"]([general], [{**korean, "text": general["text"]}])[0]

    class Image:
        size = (200, 100)
    class Bitmap:
        def to_pil(self): return Image()
        def close(self): pass
    class Page:
        def render(self, scale): return Bitmap()
        def close(self): pass
    class Document:
        def __len__(self): return 1
        def __getitem__(self, index): return Page()
    engines = (object(), object())
    calls = []
    ns["rapidocr_engines"] = lambda: engines
    def fake_lines(engine, image, **options):
        calls.append((engine, options))
        return [general] if engine is engines[0] else [korean]
    ns["rapidocr_lines"] = fake_lines
    ns["KOREAN_PASS_OPTIONS"] = {"use_cls": False}
    ns["RENDER_SCALE"] = 2.0
    regions = ns["raster_regions"](Document())
    assert len(calls) == 2 and len(regions) == 1
    assert regions[0]["bbox1000"] == [50, 200, 550, 400]
    assert regions[0]["recognitionConflict"]["bbox1000"] == regions[0]["bbox1000"]
    assert regions[0]["text"] == regions[0]["recognitionConflict"]["candidates"][0]["text"]
    assert regions[0]["confidence"] == regions[0]["recognitionConflict"]["candidates"][0]["confidence"]
    ns["rapidocr_lines"] = lambda engine, image, **options: [raw_general] if engine is engines[0] else [raw_korean]
    raw_region = ns["raster_regions"](Document())[0]
    assert raw_region["text"] == " FICTIONAL-A "
    assert raw_region["text"] == raw_region["recognitionConflict"]["candidates"][0]["text"]
    ns["rapidocr_lines"] = fake_lines
    body = ns["ocr_result_body"](regions[0]["text"], 1, regions, sha)
    assert body["schemaVersion"] == "tavonel.ocr_result.v3"
    assert body["recognitionConflictCount"] == 1
    assert body["regions"][0]["recognitionConflict"]["sourceSha256"] == sha
    clean_regions = [{k: v for k, v in regions[0].items() if k != "recognitionConflict"}]
    clean_v3 = ns["ocr_result_body"]("FICTIONAL-A", 1, clean_regions, sha)
    assert clean_v3["schemaVersion"] == "tavonel.ocr_result.v3" and clean_v3["recognitionConflictCount"] == 0
    ns["OCR_CONFLICT_V3_ENABLED"] = False
    assert ns["ocr_result_body"]("FICTIONAL-A", 1, clean_regions, sha)["schemaVersion"] == "tavonel.ocr_result.v2"
    try: ns["ocr_result_body"]("FICTIONAL-A", 1, regions, sha)
    except HTTPException: pass
    else: raise AssertionError("v2 downgraded a discovered conflict")
    try: ns["raster_regions"](Document())
    except HTTPException: pass
    else: raise AssertionError("v2 raster path did not refuse the discovered conflict before stream finalization")
    ns["OCR_CONFLICT_V3_ENABLED"] = True
    assert SOURCE.count("ocr_result_body(text, page_count, regions, expected_digest)") == 2

    negatives = 0
    for g, k in [([general], [korean, {**korean, "polygon": [[12, 20], [112, 20], [112, 40], [12, 40]]}]),
                 ([general, {**general, "polygon": [[12, 20], [112, 20], [112, 40], [12, 40]]}], [korean]),
                 ([{**general, "text": "X" * 2001}], [korean])]:
        try: ns["merge_korean_lines"](g, k)
        except HTTPException: negatives += 1
        else: raise AssertionError("ambiguous or oversized engine output accepted")
    many = [{**regions[0], "regionId": f"fictional-{i}"} for i in range(129)]
    try: ns["ocr_result_body"]("FICTIONAL-A", 1, many, sha)
    except HTTPException: negatives += 1
    else: raise AssertionError("129 conflicts silently truncated")
    print(json.dumps({"fictional_raster_engine_calls": len(calls), "v3_conflicts": 1,
                      "v3_clean_count_zero": True, "v2_clean_when_disabled": True,
                      "v2_conflict_downgrade_refused": True, "negative_cases_refused": negatives,
                      "buffered_stream_final_builder_call_sites": 2}, sort_keys=True))

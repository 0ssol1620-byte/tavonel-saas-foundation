"""Fictional recognition rows only: no PDF render, model, GPU, service or external call."""
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE_SHA = "sha256:" + "a" * 64


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def line(text, confidence=0.9, x=10, raw=None):
    result = {
        "polygon": [[float(x), 10.0], [float(x + 30), 10.0],
                    [float(x + 30), 20.0], [float(x), 20.0]],
        "text": text.strip(), "confidence": confidence,
    }
    if raw is not None:
        result["rawText"] = raw
    return result


class FakeImage:
    size = (100, 100)


class CpuV3Contract(unittest.TestCase):
    def setUp(self):
        self.mod = load("cpu_v3_" + self._testMethodName, ROOT / "app.py")

    def fake_raster(self, general, korean, *, v3=True, bound=False):
        mod = self.mod
        captures = []

        def apply_bound(regions, **_kwargs):
            captures.append([dict(row) for row in regions])
            self.assertTrue(all("recognitionConflict" not in row for row in regions))
            return [
                {**row, "order": index} for index, row in enumerate(reversed(regions))
            ], {"qualified": True}

        with patch.object(mod, "OCR_CONFLICT_V3_ENABLED", v3), \
             patch.object(mod, "render_page", return_value=FakeImage()), \
             patch.object(mod, "rapidocr_engines", return_value=("g", "k")), \
             patch.object(mod, "rapidocr_lines", side_effect=lambda engine, _image, **_kw: general if engine == "g" else korean), \
             patch.object(mod, "validate_table_input", return_value=None), \
             patch.object(mod, "apply_bound_table", side_effect=apply_bound):
            result = mod.raster_page_regions(
                object(), 0, 0,
                **({"qualified_table": {"pageSizePixels": [100, 100]},
                    "source_payload": b"fictional",
                    "approved_profile_sha256": SOURCE_SHA} if bound else {}),
            )
        return result, captures

    def test_v3_zero_conflict_is_explicit(self):
        regions, _ = self.fake_raster([line("same")], [line("same")], v3=True)
        with patch.object(self.mod, "OCR_CONFLICT_V3_ENABLED", True):
            body = self.mod.ocr_result_body(regions[0]["text"], 1, regions, SOURCE_SHA)
        self.assertEqual(body["schemaVersion"], "tavonel.ocr_result.v3")
        self.assertEqual(body["recognitionConflictCount"], 0)
        self.assertNotIn("recognitionConflict", body["regions"][0])

    def test_v3_conflict_preserves_two_model_results_and_source(self):
        general = [line("abc", 0.75, raw=" abc ")]
        korean = [line("한글", 0.95, raw="한글 ")]
        regions, _ = self.fake_raster(general, korean, v3=True)
        selected = regions[0]
        self.assertEqual(selected["text"], "한글 ")
        self.assertEqual(selected["confidence"], 0.95)
        with patch.object(self.mod, "OCR_CONFLICT_V3_ENABLED", True):
            body = self.mod.ocr_result_body(selected["text"].strip(), 1, regions, SOURCE_SHA)
        self.assertEqual(body["recognitionConflictCount"], 1)
        conflict = body["regions"][0]["recognitionConflict"]
        self.assertEqual(conflict["sourceSha256"], SOURCE_SHA)
        self.assertEqual(conflict["regionId"], selected["regionId"])
        self.assertEqual(conflict["bbox1000"], selected["bbox1000"])
        self.assertEqual([c["engineId"] for c in conflict["candidates"]],
                         ["general-ppocrv6", "korean-ppocrv5"])
        self.assertEqual([c["text"] for c in conflict["candidates"]], [" abc ", "한글 "])
        self.assertEqual(conflict["candidates"][1]["confidence"], selected["confidence"])
        self.assertEqual(conflict["candidates"][1]["polygon"], korean[0]["polygon"])
        self.assertEqual(conflict["candidates"][0]["modelSha256"],
                         "sha256:6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884")
        self.assertEqual(conflict["candidates"][1]["modelSha256"],
                         "sha256:cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b")

    def test_off_refuses_disagreement(self):
        with self.assertRaisesRegex(self.mod.HTTPException, "qualified v3"):
            self.fake_raster([line("abc")], [line("한글")], v3=False)

    def test_table_hash_sees_legacy_projection_then_evidence_follows_id(self):
        general = [line("abc", 0.75, x=10, raw=" abc "), line("other", 0.8, x=60)]
        korean = [line("한글", 0.95, x=10, raw="한글 ")]
        regions, captures = self.fake_raster(general, korean, v3=True, bound=True)
        self.assertEqual(len(captures), 1)
        self.assertEqual(captures[0][0]["text"], "한글")
        conflicted = [row for row in regions if "recognitionConflict" in row]
        self.assertEqual(len(conflicted), 1)
        self.assertEqual(conflicted[0]["regionId"], captures[0][0]["regionId"])
        self.assertEqual(conflicted[0]["text"], "한글 ")
        self.assertEqual([row["order"] for row in regions], [0, 1])

    def test_ambiguous_or_reused_match_refuses(self):
        with patch.object(self.mod, "OCR_CONFLICT_V3_ENABLED", True):
            with self.assertRaisesRegex(self.mod.HTTPException, "ambiguous"):
                self.mod.merge_korean_lines([line("abc")], [line("한글"), line("한국")])
            with self.assertRaisesRegex(self.mod.HTTPException, "reused"):
                self.mod.merge_korean_lines([line("abc"), line("def")], [line("한글")])

    def test_candidate_bounds_and_count_refuse(self):
        with patch.object(self.mod, "OCR_CONFLICT_V3_ENABLED", True):
            with self.assertRaises(self.mod.HTTPException):
                self.mod.merge_korean_lines([line("abc", raw="a" * 2001)], [line("한글")])
            with self.assertRaises(self.mod.HTTPException):
                self.mod.merge_korean_lines([line("abc", x=-1)], [line("한글", x=-1)])
        rows = [
            {"recognitionConflict": {"regionId": str(index)}}
            for index in range(129)
        ]
        with patch.object(self.mod, "OCR_CONFLICT_V3_ENABLED", True):  # noqa: SIM117
            with self.assertRaisesRegex(self.mod.HTTPException, "count exceeds"):
                self.mod.ocr_result_body("", 1, rows, SOURCE_SHA)


if __name__ == "__main__":
    unittest.main()

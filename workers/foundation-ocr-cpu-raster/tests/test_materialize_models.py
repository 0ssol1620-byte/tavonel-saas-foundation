"""Build-time model download: a file is kept only after its SHA256 matches, before any session opens it."""

from __future__ import annotations

import ast
import importlib.util
from hashlib import sha256
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("foundation_ocr_cpu_raster_materialize", ROOT / "materialize_models.py")
materialize = importlib.util.module_from_spec(spec)
spec.loader.exec_module(materialize)


def source(tmp_path: Path, payload: bytes) -> str:
    path = tmp_path / "source.onnx"
    path.write_bytes(payload)
    return path.as_uri()


def test_matching_download_is_placed(tmp_path: Path) -> None:
    target = tmp_path / "models" / "model.onnx"
    target.parent.mkdir()
    materialize.fetch_verified(source(tmp_path, b"weights"), target, sha256(b"weights").hexdigest())
    assert target.read_bytes() == b"weights"
    assert list(target.parent.iterdir()) == [target]


def test_mismatched_download_leaves_nothing_to_load(tmp_path: Path) -> None:
    target = tmp_path / "models" / "model.onnx"
    target.parent.mkdir()
    with pytest.raises(SystemExit, match="digest mismatch"):
        materialize.fetch_verified(source(tmp_path, b"tampered"), target, sha256(b"weights").hexdigest())
    assert list(target.parent.iterdir()) == []


def test_existing_file_with_another_digest_is_refused(tmp_path: Path) -> None:
    target = tmp_path / "model.onnx"
    target.write_bytes(b"tampered")
    with pytest.raises(SystemExit, match="digest mismatch"):
        materialize.fetch_verified("https://unused.invalid/model.onnx", target, sha256(b"weights").hexdigest())


def test_pins_match_the_worker_and_downloads_precede_engine_construction() -> None:
    app = (ROOT / "app.py").read_text(encoding="utf-8")
    for name, (path, digest) in materialize.EXPECTED_MODELS.items():
        assert path.endswith("/" + name)
        if name != "ch_ppocr_mobile_v2.0_cls_mobile.onnx":
            assert f'"{name}", "{digest}"' in app
    main = next(
        node for node in ast.parse((ROOT / "materialize_models.py").read_text(encoding="utf-8")).body
        if isinstance(node, ast.FunctionDef) and node.name == "main"
    )
    calls = [node for node in ast.walk(main) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)]
    fetch_line = min(call.lineno for call in calls if call.func.id == "fetch_verified")
    engine_lines = [call.lineno for call in calls if call.func.id == "RapidOCR"]
    assert engine_lines and fetch_line < min(engine_lines)

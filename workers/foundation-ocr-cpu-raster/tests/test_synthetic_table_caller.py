"""Content-independent caller contracts over a newly drawn synthetic grid.

The one-page PDF and OCR lines in this test are synthetic. Recognition and
rendering are stubbed; the real PDF parser still receives the fixture bytes.
"""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import sys
from types import MappingProxyType

import pytest

WORKER = Path(__file__).resolve().parents[1]
PROFILE = WORKER / "tests/fixtures/synthetic-grid-profile.json"
INPUT_PIN = "sha256:86d9431490db103540eb3adc366f5d46d3e7cac7e9fa904b568e85bf63fa2e51"
PROFILE_PIN = "sha256:3cbb383cfc3c8a755c16dd62622e51e7c545e7edfa1e8def5b811cdd05fd04d0"
LABELS = [
    ("OUTSIDE-TOP", [40, 40, 140, 70]),
    ("H-C", [660, 220, 720, 250]),
    ("H-A", [180, 220, 240, 250]),
    ("H-B", [420, 220, 480, 250]),
    ("R1-C", [660, 320, 720, 350]),
    ("R1-A", [180, 320, 240, 350]),
    ("R1-B", [420, 320, 480, 350]),
    ("R2-B", [420, 420, 480, 450]),
    ("R2-C", [660, 420, 720, 450]),
    ("R2-A", [180, 420, 240, 450]),
    ("R3-A", [180, 520, 240, 550]),
    ("R3-C", [660, 520, 720, 550]),
    ("OUTSIDE-BOTTOM", [40, 700, 140, 730]),
]
EXPECTED_IDS = [1, 3, 4, 2, 6, 7, 5, 10, 8, 9, 11, 12, 13]


def synthetic_pdf():
    """Generate a fresh one-page ruled grid; no document payload is copied."""
    grid = ["0.7 w"]
    for x in (90, 230, 370, 510):
        grid.append(f"{x} 160 m {x} 320 l S")
    for y in (160, 200, 240, 280, 320):
        grid.append(f"90 {y} m 510 {y} l S")
    stream = ("\n".join(grid) + "\n").encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n% synthetic grid only\n")
    offsets = []
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        pdf.extend(f"{offset:010d} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(pdf)


@pytest.fixture(autouse=True)
def deny_network(monkeypatch):
    def denied(*args, **kwargs):
        raise AssertionError("Synthetic caller tests may not use the network")
    monkeypatch.setattr(socket.socket, "connect", denied)
    monkeypatch.setattr(socket.socket, "connect_ex", denied)


@pytest.fixture(scope="session")
def payload():
    data = synthetic_pdf()
    assert "sha256:" + hashlib.sha256(data).hexdigest() == INPUT_PIN
    return data


@pytest.fixture
def caller(monkeypatch):
    spec = importlib.util.spec_from_file_location("app", WORKER / "app.py")
    cpu = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "app", cpu)
    spec.loader.exec_module(cpu)
    lines = []
    for text, (left, top, right, bottom) in LABELS:
        lines.append({"text": text, "confidence": 0.99, "polygon": [
            [left * 600 / 1000, top * 400 / 1000],
            [right * 600 / 1000, top * 400 / 1000],
            [right * 600 / 1000, bottom * 400 / 1000],
            [left * 600 / 1000, bottom * 400 / 1000],
        ]})
    monkeypatch.setattr(cpu, "render_page", lambda _: type("SyntheticGeometry", (), {"size": (600, 400)})())
    monkeypatch.setattr(cpu, "rapidocr_engines", lambda: ("stub-general", "stub-korean"))
    monkeypatch.setattr(cpu, "rapidocr_lines", lambda engine, image, **options: lines if engine == "stub-general" else [])
    monkeypatch.setattr(cpu, "merge_korean_lines", lambda general, korean: general)
    return cpu, lines


def registry(profile=None, approval=PROFILE_PIN):
    if profile is None:
        profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    return MappingProxyType({INPUT_PIN: MappingProxyType({0: (profile, approval)})})


def reviewed(cpu, payload, profiles=None):
    return cpu.extract_text(payload, _development_profile_registry=registry() if profiles is None else profiles)


def no_render_or_engine(cpu, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Admission must refuse before render or recognition")
    monkeypatch.setattr(cpu, "render_page", forbidden)
    monkeypatch.setattr(cpu, "rapidocr_engines", forbidden)


def test_synthetic_caller_binds_identical_input_and_preserves_every_source_field(caller, payload, monkeypatch):
    cpu, _ = caller
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    assert cpu.canonical_sha256(profile) == PROFILE_PIN
    original_document = cpu.pdfium.PdfDocument
    original_raster = cpu.raster_page_regions
    observed = {"documents": 0, "rasters": 0}

    def document(data):
        assert data is payload
        observed["documents"] += 1
        return original_document(data)

    def raster(page, index, order, **options):
        if options:
            assert options["source_payload"] is payload
            assert options["approved_profile_sha256"] == PROFILE_PIN
            observed["rasters"] += 1
        return original_raster(page, index, order, **options)

    monkeypatch.setattr(cpu.pdfium, "PdfDocument", document)
    monkeypatch.setattr(cpu, "raster_page_regions", raster)
    baseline_text, baseline_count, baseline = cpu.extract_text(payload)
    text, count, ordered = reviewed(cpu, payload)
    assert observed == {"documents": 2, "rasters": 1}
    assert baseline_count == count == 1 and len(ordered) == len(baseline) == len(LABELS)
    assert [r["regionId"] for r in ordered] == [f"ocr-p0001-l{i:05d}" for i in EXPECTED_IDS]
    assert text == "\n".join(r["text"] for r in ordered) and text != baseline_text
    by_id = {r["regionId"]: r for r in baseline}
    assert len(by_id) == len(LABELS)
    for region in ordered:
        assert {k: v for k, v in region.items() if k != "order"} == {
            k: v for k, v in by_id[region["regionId"]].items() if k != "order"}
    assert ordered[0] == baseline[0] and ordered[-1] == baseline[-1]
    assert ordered[10:12] == baseline[10:12]  # Incomplete final row remains deferred.
    assert cpu._general_rapidocr is None and cpu._korean_rapidocr is None


def test_unknown_input_refuses_before_pdf_open(caller, monkeypatch):
    cpu, _ = caller
    no_render_or_engine(cpu, monkeypatch)
    monkeypatch.setattr(cpu.pdfium, "PdfDocument", lambda _: pytest.fail("PDF must not open"))
    with pytest.raises(cpu.TableBindingError, match="no reviewed development profile"):
        reviewed(cpu, b"%PDF-unregistered-synthetic-negative")


def test_unreviewed_second_page_refuses_before_page_access(caller, payload, monkeypatch):
    cpu, _ = caller
    closed = []
    class TwoPages:
        def __len__(self):
            return 2
        def __getitem__(self, index):
            raise AssertionError("Page access must follow inventory validation")
        def close(self):
            closed.append(True)
    monkeypatch.setattr(cpu.pdfium, "PdfDocument", lambda _: TwoPages())
    no_render_or_engine(cpu, monkeypatch)
    with pytest.raises(cpu.TableBindingError, match="pages do not match"):
        reviewed(cpu, payload)
    assert closed == [True]


def test_unapproved_profile_refuses_before_render(caller, payload, monkeypatch):
    cpu, _ = caller
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    profile["bbox1000"][0] -= 1
    no_render_or_engine(cpu, monkeypatch)
    with pytest.raises(cpu.TableBindingError, match="Profile digest"):
        reviewed(cpu, payload, registry(profile))


@pytest.mark.parametrize("corrupt", [{}, {"bindingVersion": "bad"}])
def test_missing_or_damaged_profile_refuses(caller, payload, monkeypatch, corrupt):
    cpu, _ = caller
    no_render_or_engine(cpu, monkeypatch)
    with pytest.raises(cpu.TableBindingError):
        reviewed(cpu, payload, registry(corrupt))


@pytest.mark.parametrize("field", ["text", "confidence"])
def test_ocr_region_drift_refuses_without_partial_result(caller, payload, field):
    cpu, lines = caller
    if field == "text":
        lines[5][field] += "-changed"
    else:
        lines[5][field] = 0.1
    with pytest.raises(cpu.TableBindingError, match="Source OCR regions"):
        reviewed(cpu, payload)
    assert cpu._general_rapidocr is None and cpu._korean_rapidocr is None


def test_unprofiled_path_uses_original_order_and_no_binding(caller, payload, monkeypatch):
    cpu, _ = caller
    original_raster = cpu.raster_page_regions
    def raster(page, index, order, **options):
        assert options == {}
        return original_raster(page, index, order)
    monkeypatch.setattr(cpu, "raster_page_regions", raster)
    text, count, regions = cpu.extract_text(payload)
    assert count == 1 and [r["text"] for r in regions] == [label for label, _ in LABELS]
    assert text == "\n".join(label for label, _ in LABELS)


def test_http_and_docker_do_not_expose_synthetic_registry():
    tree = ast.parse((WORKER / "app.py").read_text(encoding="utf-8"))
    ocr = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "ocr")
    calls = [node for node in ast.walk(ocr) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Name) and node.func.id == "extract_text"]
    assert len(calls) == 1 and len(calls[0].args) == 1 and calls[0].keywords == []
    docker = (WORKER / "Dockerfile").read_text(encoding="utf-8")
    assert "COPY app.py ./" in docker and "synthetic-grid" not in docker


def test_profile_pin_and_registry_key_are_independent_of_profile_json(caller):
    cpu, _ = caller
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    pinned = registry(profile)
    assert list(pinned) == [INPUT_PIN] and pinned[INPUT_PIN][0][1] == PROFILE_PIN
    assert cpu.canonical_sha256(profile) == PROFILE_PIN
    with pytest.raises(TypeError):
        pinned["other"] = copy.deepcopy(profile)


def test_profile_page_refuses_before_recognition(caller, payload, monkeypatch):
    cpu, _ = caller
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    profile["pageIndex0"] = 1
    no_render_or_engine(cpu, monkeypatch)
    with pytest.raises(cpu.TableBindingError, match="another page"):
        reviewed(cpu, payload, registry(profile, cpu.canonical_sha256(profile)))


def test_rendered_dimensions_mismatch_refuses_before_recognition(caller, payload, monkeypatch):
    cpu, _ = caller
    monkeypatch.setattr(cpu, "render_page", lambda _: type("WrongSyntheticGeometry", (), {"size": (601, 400)})())
    def forbidden(*args, **kwargs):
        raise AssertionError("Dimension mismatch must precede OCR engines")
    monkeypatch.setattr(cpu, "rapidocr_engines", forbidden)
    with pytest.raises(cpu.TableBindingError, match="Rendered page dimensions"):
        reviewed(cpu, payload)

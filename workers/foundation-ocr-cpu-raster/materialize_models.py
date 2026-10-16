"""Materialize and verify every RapidOCR model used by the CPU raster runtime image (build time only).

Each model is downloaded from its pinned RapidOCR 3.9.2 release URL and its SHA256 is checked before
any ONNX session ever opens it. RapidOCR is constructed only afterwards, so it finds verified files
and has nothing left to download; a model directory that changes during that construction fails.
"""

from hashlib import sha256
from importlib import metadata
from pathlib import Path
from urllib.request import urlopen

MODEL_BASE_URL = "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/"
# name -> (path under MODEL_BASE_URL, SHA256). The three recognition-path digests are the same pins
# as app.OCR_MODEL_FILES; the angle classifier is loaded by the general engine, so it is pinned too.
EXPECTED_MODELS = {
    "PP-OCRv6_det_small.onnx": (
        "PP-OCRv6/det/PP-OCRv6_det_small.onnx",
        "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    ),
    "PP-OCRv6_rec_small.onnx": (
        "PP-OCRv6/rec/PP-OCRv6_rec_small.onnx",
        "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
    ),
    "korean_PP-OCRv5_rec_mobile.onnx": (
        "PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile.onnx",
        "cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b",
    ),
    "ch_ppocr_mobile_v2.0_cls_mobile.onnx": (
        "PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
    ),
}
DOWNLOAD_TIMEOUT_SECONDS = 120


def fetch_verified(url: str, target: Path, expected_digest: str) -> None:
    """Places `url` at `target` only if its SHA256 is `expected_digest`; a mismatch leaves nothing."""
    if not target.is_file():
        partial = target.with_name(target.name + ".partial")
        try:
            with urlopen(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
                partial.write_bytes(response.read())
            if sha256(partial.read_bytes()).hexdigest() != expected_digest:
                raise SystemExit(f"RapidOCR model digest mismatch: {target.name}")
            partial.replace(target)
        finally:
            partial.unlink(missing_ok=True)
    if sha256(target.read_bytes()).hexdigest() != expected_digest:
        raise SystemExit(f"RapidOCR model digest mismatch: {target.name}")


def snapshot(model_dir: Path) -> dict[str, tuple[int, int]]:
    return {
        str(path.relative_to(model_dir)): (path.stat().st_size, path.stat().st_mtime_ns)
        for path in model_dir.rglob("*")
        if path.is_file()
    }


def main() -> None:
    for distribution in ("onnxruntime-gpu", "onnxruntime-directml", "onnxruntime-openvino"):
        try:
            metadata.version(distribution)
        except metadata.PackageNotFoundError:
            continue
        raise SystemExit(f"{distribution} must not be installed in the CPU raster image")
    if metadata.version("onnxruntime") != "1.20.1" or metadata.version("rapidocr") != "3.9.2":
        raise SystemExit("CPU raster image requires onnxruntime==1.20.1 and rapidocr==3.9.2")

    import onnxruntime
    import rapidocr
    from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR

    if "CPUExecutionProvider" not in onnxruntime.get_available_providers():
        raise SystemExit("onnxruntime does not offer CPUExecutionProvider")

    model_dir = Path(rapidocr.__file__).parent / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    for name, (path, expected_digest) in EXPECTED_MODELS.items():
        fetch_verified(MODEL_BASE_URL + path, model_dir / name, expected_digest)

    # Only now are sessions opened, on files already verified. Runtime workers never download.
    before = snapshot(model_dir)
    RapidOCR(params={"EngineConfig.onnxruntime.use_cuda": False})
    RapidOCR(
        params={
            "EngineConfig.onnxruntime.use_cuda": False,
            "Rec.lang_type": LangRec.KOREAN,
            "Rec.model_type": ModelType.MOBILE,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
        }
    )
    if snapshot(model_dir) != before:
        raise SystemExit("RapidOCR changed the verified model directory while loading")


if __name__ == "__main__":
    main()

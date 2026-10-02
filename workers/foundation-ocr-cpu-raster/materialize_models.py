"""Materialize and verify every RapidOCR model used by the CPU raster runtime image (build time only)."""

from hashlib import sha256
from importlib import metadata
from pathlib import Path

import onnxruntime
import rapidocr
from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR


EXPECTED_MODEL_DIGESTS = {
    "PP-OCRv6_det_small.onnx": (
        "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f"
    ),
    "PP-OCRv6_rec_small.onnx": (
        "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884"
    ),
    "korean_PP-OCRv5_rec_mobile.onnx": (
        "cd6e2ea50f6943ca7271eb8c56a877a5a90720b7047fe9c41a2e541a25773c9b"
    ),
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
    if "CPUExecutionProvider" not in onnxruntime.get_available_providers():
        raise SystemExit("onnxruntime does not offer CPUExecutionProvider")

    # Runtime workers must never download executable model content from the network.
    RapidOCR(params={"EngineConfig.onnxruntime.use_cuda": False})
    RapidOCR(
        params={
            "EngineConfig.onnxruntime.use_cuda": False,
            "Rec.lang_type": LangRec.KOREAN,
            "Rec.model_type": ModelType.MOBILE,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
        }
    )

    model_dir = Path(rapidocr.__file__).parent / "models"
    for name, expected_digest in EXPECTED_MODEL_DIGESTS.items():
        actual_digest = sha256((model_dir / name).read_bytes()).hexdigest()
        if actual_digest != expected_digest:
            raise SystemExit(f"RapidOCR model digest mismatch: {name}")


if __name__ == "__main__":
    main()

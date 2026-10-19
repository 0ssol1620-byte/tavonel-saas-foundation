# Shadow-only table reader: PaddleOCR-VL 1.6 (model registry provider_key paddleocr_vl_1_6).
#
# Decision D-25 (DECISION-REGISTER-2026-10-17, aliases T-F1, T-F3): review this
# model alone, for shadow use only; build the image ourselves; pin the weights
# revision. mineru_vlm stays on hold. Intake row: Core
# docs/ip/TECHNOLOGY_INTAKE_REGISTER.yaml, technology_intake tech_paddleocr_vl_1_6,
# approval_state SHADOW_ONLY_PENDING_COUNSEL. Ladder step 1' of
# TABLE-EXTRACTION-AND-LIMITS-DESIGN-2026-10-17 §C6.
#
# NOT BUILT. Written as text on 2026-10-19 (lane T8a); the first build is its
# first test. Nothing in Foundation dispatches to this image and no workflow
# builds it. Pushing it needs FH-17 (GHCR write credential). Running it on a GPU
# needs the C7 shadow spend cap, which the founder sets; until then GPU spend is 0.
# Shadow input is limited to the D-31 corpus policy (synthetic tables and the
# allowed rows), never a customer document.
#
# Pins
#   base     nvidia/cuda 12.6.3 cuDNN runtime, Ubuntu 24.04, by digest (same base as
#            workers/foundation-ocr-gpu)
#   runtime  paddlepaddle-gpu 3.2.1 cp312 wheel from the cu126 index (the model
#            card's install line). The index publishes no hash, so the wheel's
#            sha256 is written to the baked receipt and pinned after the first build.
#   code     PaddleOCR at git commit 2661c7c0ef5c613e8f93c6e93b2e052399f0f854 (the
#            Arena's code_repository_revision); paddlex 3.7.2 inside the commit's
#            >=3.7.0,<3.8.0 range
#   weights  huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6 at
#            c5630abae1d940eafe0697512a0325494b02ab42. Every file is checked against
#            weights.manifest (git blob id, or LFS sha256 for the three large files),
#            taken from the Hub API at that revision; an extra or missing file fails
#            the build.
#
# At run time the image fetches nothing: the Hub is offline and the PaddleX
# model-source check is off. The runner must still deny egress
# (docker run --network none); the image cannot enforce that by itself.
#
#   docker run --rm --gpus all --network none -v <in>:/in:ro -v <out>:/out \
#     <image> -i /in/<table-crop>.png --save_path /out
FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu24.04@sha256:8aef630a54bc5c5146ae5ce68e6af5caa3df0fb690bb91544175c91f307e4356

ARG PADDLE_WHEEL=paddlepaddle_gpu-3.2.1-cp312-cp312-linux_x86_64.whl
ARG PADDLEOCR_COMMIT=2661c7c0ef5c613e8f93c6e93b2e052399f0f854
ARG MODEL_REPO=PaddlePaddle/PaddleOCR-VL-1.6
ARG MODEL_REVISION=c5630abae1d940eafe0697512a0325494b02ab42

LABEL org.opencontainers.image.source="https://github.com/0ssol1620-byte/tavonel-saas-foundation" \
      tavonel.shadow_only="true" \
      tavonel.provider_key="paddleocr_vl_1_6" \
      tavonel.code_commit="${PADDLEOCR_COMMIT}" \
      tavonel.model_revision="${MODEL_REVISION}"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    MODEL_DIR=/opt/tavonel/models/PaddleOCR-VL-1.6

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv git curl ca-certificates \
        libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home --home-dir /home/ocr ocr \
    && if dpkg -l | grep -qi openssh; then echo "OpenSSH must not be installed" >&2; exit 1; fi \
    && python3 -m venv /opt/venv \
    && mkdir -p /opt/tavonel

# The wheel by exact file name from the index the model card names, so no
# resolver can substitute a PyPI build for another CUDA line.
RUN curl -fsSLo "/tmp/${PADDLE_WHEEL}" \
        "https://paddle-whl.cdn.bcebos.com/stable/cu126/paddlepaddle-gpu/${PADDLE_WHEEL}" \
    && sha256sum "/tmp/${PADDLE_WHEEL}" > /opt/tavonel/paddle-wheel.sha256 \
    && /opt/venv/bin/pip install --no-cache-dir "/tmp/${PADDLE_WHEEL}" \
    && rm "/tmp/${PADDLE_WHEEL}"

RUN /opt/venv/bin/pip install --no-cache-dir \
        "paddleocr[doc-parser] @ git+https://github.com/PaddlePaddle/PaddleOCR.git@${PADDLEOCR_COMMIT}" \
        "paddlex[ocr,genai-client]==3.7.2" \
        "huggingface-hub==1.17.0" \
    && /opt/venv/bin/python -c "from importlib.metadata import version as v; e={'paddlepaddle-gpu':'3.2.1','paddlex':'3.7.2','huggingface-hub':'1.17.0'}; a={k: v(k) for k in e}; assert a == e, a"

COPY weights.manifest /opt/tavonel/weights.manifest
RUN /opt/venv/bin/hf download "${MODEL_REPO}" --revision "${MODEL_REVISION}" --local-dir "${MODEL_DIR}" \
    && rm -rf "${MODEL_DIR}/.cache" \
    && cd "${MODEL_DIR}" \
    && expected=0 \
    && while read -r kind digest path; do \
         case "$kind" in \
           '#'*|'') continue ;; \
           sha256) printf '%s  %s\n' "$digest" "$path" | sha256sum --check --strict --quiet ;; \
           gitsha1) test "$(git hash-object "$path")" = "$digest" || { echo "blob mismatch: $path" >&2; exit 1; } ;; \
           *) echo "unknown manifest kind: $kind" >&2; exit 1 ;; \
         esac || exit 1; \
         expected=$((expected + 1)); \
       done < /opt/tavonel/weights.manifest \
    && actual="$(find . -type f | wc -l)" \
    && { test "$actual" -eq "$expected" || { echo "weights file count $actual != manifest $expected" >&2; exit 1; }; } \
    && find "${MODEL_DIR}" -type f -exec chmod 0444 {} +

RUN { \
      echo "base_image=nvidia/cuda:12.6.3-cudnn-runtime-ubuntu24.04@sha256:8aef630a54bc5c5146ae5ce68e6af5caa3df0fb690bb91544175c91f307e4356"; \
      echo "paddleocr_commit=${PADDLEOCR_COMMIT}"; \
      echo "model_repo=${MODEL_REPO}"; \
      echo "model_revision=${MODEL_REVISION}"; \
      echo "paddle_wheel_sha256=$(cut -d' ' -f1 /opt/tavonel/paddle-wheel.sha256)"; \
      /opt/venv/bin/python --version; \
      /opt/venv/bin/pip freeze | LC_ALL=C sort; \
    } > /opt/tavonel/baked-runtime-receipt.txt \
    && chmod 0444 /opt/tavonel/baked-runtime-receipt.txt /opt/tavonel/paddle-wheel.sha256 /opt/tavonel/weights.manifest

ENV HF_HUB_OFFLINE=1 \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True

USER ocr
ENTRYPOINT ["/opt/venv/bin/paddleocr", "doc_parser", \
            "--pipeline_version", "v1.6", \
            "--vl_rec_backend", "native", \
            "--vl_rec_model_dir", "/opt/tavonel/models/PaddleOCR-VL-1.6", \
            "--use_layout_detection", "False", \
            "--use_doc_orientation_classify", "False", \
            "--use_doc_unwarping", "False", \
            "--prompt_label", "table"]
CMD ["--help"]

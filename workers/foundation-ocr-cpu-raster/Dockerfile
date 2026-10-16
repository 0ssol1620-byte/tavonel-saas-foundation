# CPU-only raster OCR image. No CUDA base or runtime, no onnxruntime-gpu, no OpenSSH, no port 22.
# Health and HMAC OCR listen on 8001. Passing this image's tests is CPU OCR evidence only;
# it is not evidence for the GPU worker or for any Cloudflare path.
FROM python:3.12-slim-bookworm

LABEL org.opencontainers.image.source="https://github.com/0ssol1620-byte/tavonel-saas-foundation"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/tmp \
    PORT=8001 \
    HEALTH_CHECK_PATH=/ping

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home --home-dir /home/ocr ocr \
    && if dpkg -l | grep -qi openssh; then echo "OpenSSH must not be installed" >&2; exit 1; fi

WORKDIR /app
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && if python -m pip show onnxruntime-gpu >/dev/null 2>&1; then echo "onnxruntime-gpu must not be installed" >&2; exit 1; fi
# Models are fetched and digest-checked at build time. Site-packages stays root-owned, so the
# runtime user cannot write the model directory and RapidOCR cannot download at runtime.
COPY materialize_models.py ./
RUN python materialize_models.py && rm materialize_models.py
COPY app.py ./
USER 10001:10001

EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4)"
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]

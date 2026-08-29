# GPU OCR image for RunPod serverless (LOAD_BALANCER).
# No OpenSSH, no port 22. Health and HMAC OCR listen on 8001.
# CUDA runtime is present so RapidOCR/ONNX can use the GPU; Cloud Build does not need a GPU.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    PORT=8001 \
    PORT_HEALTH=8001 \
    HEALTH_CHECK_PATH=/health

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv ca-certificates curl \
        libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home --home-dir /home/ocr ocr \
    && if dpkg -l | grep -qi openssh; then echo "OpenSSH must not be installed" >&2; exit 1; fi

WORKDIR /app
COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir -r requirements.txt
COPY app.py ./
RUN chown -R ocr:ocr /app /home/ocr
USER ocr

EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8001/health
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]

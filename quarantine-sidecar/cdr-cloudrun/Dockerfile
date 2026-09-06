FROM python:3.13-slim-bookworm@sha256:b6bd71b0dd3811ddbcbc523ec2965fd1e1bcfdf7a20ab24679273d3bee726129

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       fontconfig \
       fonts-dejavu-core \
       libreoffice-calc \
       libreoffice-impress \
       libreoffice-writer \
       tini \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --create-home --home-dir /home/cdr cdr
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py malware.py ./
RUN chown -R cdr:cdr /app /home/cdr
USER cdr

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]

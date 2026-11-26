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
       fonts-noto-cjk \
       libreoffice-calc \
       libreoffice-impress \
       libreoffice-writer \
       tini \
    && rm -rf /var/lib/apt/lists/*

# WO-KO-1: without a CJK face LibreOffice renders Hangul, Kana and Han as missing-glyph boxes, so a
# Korean/Japanese/Chinese Office source reaches OCR as boxes. fonts-noto-cjk is SIL OFL 1.1. The
# build fails here, not in production, if the image has no face for any of the three scripts.
RUN fc-cache -f \
    && fc-list :lang=ko | grep -q . \
    && fc-list :lang=ja | grep -q . \
    && fc-list :lang=zh | grep -q .

RUN useradd --system --uid 10001 --create-home --home-dir /home/cdr cdr
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# NOTICE travels with the distribution it describes, not only with the repository.
COPY app.py malware.py request_boundary.py table_geometry.py text_layer.py NOTICE ./
RUN chown -R cdr:cdr /app /home/cdr
# The native reader (WO-E-TBL-1) is copied after the chown, so its files and vendor/ subtree are
# root-owned: the service user cannot edit a vendored file or write bytecode under vendor/. /app
# itself stays the service user's (as for app.py), so this is not a defence against code already
# running as `cdr`. Its Python dependencies are not installed by this file yet; until they are, a
# flagged-on read answers `reader_absent`.
COPY native_reader.py native_read_child.py ./
COPY vendor ./vendor
USER cdr

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]

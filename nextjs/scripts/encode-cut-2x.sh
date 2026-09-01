#!/usr/bin/env bash
# Encode a 2x frame sequence into a master.
#   usage: encode-cut-2x.sh <capture-dir> <output-name>
#   e.g.   encode-cut-2x.sh film-capture compile-cut
set -euo pipefail

FF="C:/Users/yspow/AppData/Local/uv/cache/archive-v0/yuHZO4Uo1Wx2lqkQ/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"
ROOT="C:/Users/yspow/work/tavonel-saas-foundation"
FRAMES="$ROOT/docs/audit/$1/frames-2x"
OUT="$ROOT/nextjs/public/film/$2.mp4"

count=$(ls -1 "$FRAMES"/f*.png | wc -l)
echo "frames: $count"
[ "$count" -eq 450 ] || { echo "expected 450 frames (25fps x 18s), refusing"; exit 1; }

# crf 26 at 2880 carries more real detail than crf 23 at 1440 and costs less: the upscale is
# gone, so the encoder is no longer spending bits reproducing a blur.
"$FF" -y -framerate 25 -i "$FRAMES/f%04d.png" \
  -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart -an \
  "$OUT" 2>/dev/null

echo "master: $("$FF" -i "$OUT" 2>&1 | grep -oE '[0-9]{3,4}x[0-9]{3,4}' | head -1)  $(stat -c%s "$OUT") bytes"
# `set -e` plus a trailing grep made a successful encode exit 1 whenever the pattern missed,
# which stopped a batch of cuts after the first one. Report the duration, do not gate on it.
"$FF" -i "$OUT" 2>&1 | grep Duration || true

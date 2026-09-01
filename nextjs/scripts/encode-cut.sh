#!/usr/bin/env bash
# Encode the newest capture for one cut and report the master's real resolution.
#   usage: encode-cut.sh <capture-dir> <output-name>
set -euo pipefail

FF="C:/Users/yspow/AppData/Local/uv/cache/archive-v0/yuHZO4Uo1Wx2lqkQ/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"
ROOT="C:/Users/yspow/work/tavonel-saas-foundation"
DIR="$ROOT/docs/audit/$1"
OUT="$ROOT/nextjs/public/film/$2.mp4"

WEBM=$(ls -1t "$DIR"/*.webm | head -1)
OFF=$(python -c "print(max(0,int(open(r'$DIR/offset-ms.txt').read())/1000))")

echo "capture: $("$FF" -i "$WEBM" 2>&1 | grep -oE '[0-9]{3,4}x[0-9]{3,4}' | head -1)"

# crf 23 at 1440 is the setting the locked masters were encoded with; text is the first thing
# that suffers below it.
"$FF" -y -ss "$OFF" -i "$WEBM" -t 18 \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart -an \
  "$OUT" 2>/dev/null

echo "master : $("$FF" -i "$OUT" 2>&1 | grep -oE '[0-9]{3,4}x[0-9]{3,4}' | head -1)  $(stat -c%s "$OUT") bytes"

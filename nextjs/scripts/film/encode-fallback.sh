#!/usr/bin/env bash
# Stage-1 decoder-error fallbacks, the same two-halves path as scripts/encode-cut-2x.sh, but yuv420p (High profile).
#   encode-fallback.sh <frames-dir> <out.mp4> <crf> [scale]
#   hero-r2-c1-hq.mp4:      encode-fallback.sh <root>/hero-r2-c1/frames-2x public/film/hero-r2-c1-hq.mp4 20
#   hero-r2-c1-hq-1440.mp4: encode-fallback.sh <root>/hero-r2-c1/frames-2x public/film/hero-r2-c1-hq-1440.mp4 20 1440:900
set -euo pipefail
FF="${FILM_FFMPEG:?set FILM_FFMPEG to the ffmpeg 7.1 binary}"; FRAMES="$1"; OUT="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; CRF="$3"; VF=(); [ -n "${4:-}" ] && VF=(-vf "scale=$4:flags=lanczos")
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
( cd "$FRAMES"
  "$FF" -y -threads 1 -framerate 25 -start_number 0 -i 'f%04d.png' -frames:v 225 "${VF[@]}" -c:v libx264 -preset medium -threads 1 -crf "$CRF" -pix_fmt yuv420p -an "$TMP/a.mp4" 2>/dev/null
  "$FF" -y -threads 1 -framerate 25 -start_number 225 -i 'f%04d.png' -frames:v 225 "${VF[@]}" -c:v libx264 -preset medium -threads 1 -crf "$CRF" -pix_fmt yuv420p -an "$TMP/b.mp4" 2>/dev/null )
printf "file 'a.mp4'\nfile 'b.mp4'\n" > "$TMP/list.txt"
( cd "$TMP" && "$FF" -y -f concat -safe 0 -i list.txt -c copy -movflags +faststart "$OUT" 2>/dev/null )
echo "$(basename "$OUT") $(stat -c%s "$OUT") bytes"

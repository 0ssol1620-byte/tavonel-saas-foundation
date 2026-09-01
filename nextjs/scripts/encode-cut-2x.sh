#!/usr/bin/env bash
# Encode a 2x frame sequence into a master, plus a 4:2:0 fallback.
#   usage: encode-cut-2x.sh <capture-dir> <output-name>
#   e.g.   encode-cut-2x.sh film-capture compile-cut
#
# yuv444p — no chroma subsampling. Measured against the source PNG this cuts mean error from
# 1.70 to 0.41 on cut 4, and from 1.05 to 0.20 at the size a browser actually paints. These
# frames are coloured mono text on near-black, the worst case for 4:2:0: the colour plane is
# quartered and the type smears.
#
# A yuv420p fallback was shipped alongside for hardware decoders that refuse High 4:4:4
# Predictive, but it doubled public/film to 26MB and the deploy stopped landing — the live site
# served the previous masters while origin/main carried the new ones. One file only.
#
# Memory: with other agents on this machine, a single pass over 450 2880x1800 PNGs died with
# `get_buffer() failed` and left a 261-byte mp4 in public/film. Encoding in halves at one thread
# keeps peak memory low enough to finish; the halves are concatenated with -c copy, no re-encode.
set -euo pipefail

FF="C:/Users/yspow/AppData/Local/uv/cache/archive-v0/yuHZO4Uo1Wx2lqkQ/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"
ROOT="C:/Users/yspow/work/tavonel-saas-foundation"
FRAMES="$ROOT/docs/audit/$1/frames-2x"
TMP="${LOCALAPPDATA}/Temp/enc-$2"
mkdir -p "$TMP"

count=$(ls -1 "$FRAMES"/f*.png | wc -l)
echo "frames: $count"
[ "$count" -eq 450 ] || { echo "expected 450 frames (25fps x 18s), refusing"; exit 1; }

encode() {
  local pix="$1" out="$2" crf="$3"
  ( cd "$FRAMES"
    "$FF" -y -threads 1 -framerate 25 -start_number 0 -i 'f%04d.png' -frames:v 225 \
      -c:v libx264 -preset medium -threads 1 -crf "$crf" -pix_fmt "$pix" -an "$TMP/a.mp4" 2>/dev/null
    "$FF" -y -threads 1 -framerate 25 -start_number 225 -i 'f%04d.png' -frames:v 225 \
      -c:v libx264 -preset medium -threads 1 -crf "$crf" -pix_fmt "$pix" -an "$TMP/b.mp4" 2>/dev/null
  )
  printf "file 'a.mp4'\nfile 'b.mp4'\n" > "$TMP/list.txt"
  ( cd "$TMP" && "$FF" -y -f concat -safe 0 -i list.txt -c copy -movflags +faststart "$out" 2>/dev/null )
  local sz; sz=$(stat -c%s "$out")
  [ "$sz" -gt 100000 ] || { echo "encode produced $sz bytes, refusing"; exit 1; }
  echo "  $(basename "$out")  $pix  $sz bytes  $("$FF" -i "$out" 2>&1 | grep -oE 'Duration: [0-9:.]+' | head -1)"
}

# The hero is fetched before anything else on a cold visit, so it carries the page's first
# frame time. crf 23 at 4:4:4 still measures 0.40 mean error against the source -- better than
# the 1.05 the old 4:2:0 crf 26 managed -- while giving back the ~400ms the larger file cost.
CRF=20
[ "$2" = "compile-cut" ] && CRF=23

encode yuv444p "$ROOT/nextjs/public/film/$2.mp4" "$CRF"

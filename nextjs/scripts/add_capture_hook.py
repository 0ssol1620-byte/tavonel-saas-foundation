"""Add the 2x capture hook to a cut that does not have it yet.

The hook lets a capture script freeze the loop and step it frame by frame, which is how the
masters are recorded at 2x without touching the locked composition. See the long note in
opening-film.tsx for why screenshots rather than recordVideo.

usage: python scripts/add_capture_hook.py components/opening-film-2.tsx STOP_EXPR
"""

import re
import sys

path, stop_expr = sys.argv[1], sys.argv[2]
source = open(path, encoding="utf-8").read()

if "__filmSeek" in source:
    print(f"{path}: already hooked")
    raise SystemExit(0)

hook = """      /*
        A capture hook, so the master can be recorded at 2x. Inert unless a capture script sets
        these; see opening-film.tsx for why screenshots rather than recordVideo.
      */
      const win = window as unknown as {
        __filmFreeze?: boolean;
        __filmSeek?: (t: number) => void;
      };
      win.__filmSeek = (t: number) => {
        elapsedRef.current = t;
        draw(t);
      };
      const tick = (now: number) => {
        if (!startRef.current) startRef.current = now;
        if (win.__filmFreeze) {
          startRef.current = now;
          frame = window.requestAnimationFrame(tick);
          return;
        }
"""

old = """      const tick = (now: number) => {
        if (!startRef.current) startRef.current = now;
"""

if old not in source:
    print(f"{path}: tick signature not found")
    raise SystemExit(1)

source = source.replace(old, hook, 1)
open(path, "w", encoding="utf-8").write(source)
print(f"{path}: hooked")

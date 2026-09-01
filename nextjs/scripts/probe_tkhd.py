"""Locate 2880x1800 inside a master's tkhd box, and report the exact offset.

Three hand-counted offsets in a row produced plausible-looking wrong numbers (1800x0 from the
height/reserved boundary, 16384x2880 from the unity matrix). Rather than guess a fourth time,
search for the known pair and print where it actually lives.
"""

import struct
import sys

path = sys.argv[1]
want_w, want_h = 2880, 1800
data = open(path, "rb").read()

at = data.find(b"tkhd")
print(f"tkhd type field at byte {at}, version={data[at + 4]}")

for off in range(0, 120, 2):
    p = at + off
    if p + 8 > len(data):
        break
    w = struct.unpack(">I", data[p:p + 4])[0] >> 16
    h = struct.unpack(">I", data[p + 4:p + 8])[0] >> 16
    if w == want_w and h == want_h:
        print(f"MATCH at tkhd+{off}: {w}x{h}")

"""How much did the encoder actually destroy?

Earlier I compared crf 26 against crf 16 by eye and concluded they were identical. That was not
a measurement — it was a glance at a downscaled crop. This compares each encoded frame against
the source PNG it came from and reports objective error, so "the encode is fine" is either true
or it is not.

usage: python compare_encode.py <source.png> <encoded.png> [...]
"""

import sys

from PIL import Image, ImageChops, ImageFilter


def stats(src_path, enc_path):
    src = Image.open(src_path).convert("L")
    enc = Image.open(enc_path).convert("L")
    if src.size != enc.size:
        enc = enc.resize(src.size)

    diff = ImageChops.difference(src, enc)
    hist = diff.histogram()
    total = sum(hist)
    mean = sum(i * n for i, n in enumerate(hist)) / total
    worst = max(i for i, n in enumerate(hist) if n)

    # Text lives in high-frequency detail; an encoder that softens type loses edge energy even
    # when the average error looks small. Compare how much edge remains.
    def edge_energy(im):
        e = im.filter(ImageFilter.FIND_EDGES)
        h = e.histogram()
        return sum(i * n for i, n in enumerate(h)) / sum(h)

    src_edge = edge_energy(src)
    enc_edge = edge_energy(enc)
    kept = enc_edge / src_edge if src_edge else 0

    print(
        f"{enc_path.split('/')[-1]:28s} mean_err={mean:5.2f}  worst={worst:3d}  "
        f"edge_kept={kept:5.1%}"
    )


for i in range(1, len(sys.argv), 2):
    stats(sys.argv[i], sys.argv[i + 1])

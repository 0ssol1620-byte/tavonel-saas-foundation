"""How much of each band is actually drawn on?

The films looked like a quality problem, but the masters are all 2880x1800 and the stills are
sharp under magnification. The difference between cut 1 and cuts 2-4 is how much of the frame
carries content: measure the fraction of non-background pixels, which is a proxy for ink on the
page, and the numbers should track the complaint.
"""

import sys
from collections import Counter

from PIL import Image

for path in sys.argv[1:]:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    small = im.resize((w // 4, h // 4))
    pixels = list(small.getdata())

    # The background is whatever colour dominates; anything meaningfully different is content.
    bg = Counter(pixels).most_common(1)[0][0]
    def far(p):
        return abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) > 40

    ink = sum(1 for p in pixels if far(p))
    # Also measure the lower half on its own — empty bottoms are the specific complaint.
    half = len(pixels) // 2
    ink_bottom = sum(1 for p in pixels[half:] if far(p))

    print(
        f"{path.split('/')[-1]:24s} ink={ink / len(pixels):5.1%}   "
        f"bottom_half_ink={ink_bottom / half:5.1%}"
    )

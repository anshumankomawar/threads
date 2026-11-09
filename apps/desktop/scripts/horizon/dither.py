# The welcome screen's scene, as Devin draws theirs: the photo shrunk to one pixel per cell and each colour channel
# ordered-dithered (Bayer 4×4, the same threshold for all three) down to a few levels on pure black. Every cell is a
# solid square, and where the channels switch together the dark turns to sparse grey dots in a cross-hatch, the colour
# showing only where the photo has it. The app draws each pixel as a square of whole screen pixels (Welcome.tsx).
#
# python3 dither.py clean.png horizon.png COLS ROWS CROP LEVELS GAMMA GAIN SATURATION FLOOR NOISE GRAIN
#   CROP is x,y,w,h in the source; GAMMA deepens the dark, GAIN dims the highlights, SATURATION is a multiplier;
#   FLOOR lifts the black so space is sparse grey dots, NOISE (per channel) colours a few of them, and GRAIN (the
#   same in every channel, as film's) breaks the pattern's lattice into crosses and gaps.
import sys
import numpy as np
from PIL import Image, ImageEnhance

src, out = sys.argv[1], sys.argv[2]
cols, rows = int(sys.argv[3]), int(sys.argv[4])
x, y, w, h = (int(v) for v in sys.argv[5].split(","))
levels, gamma, gain, saturation = int(sys.argv[6]), float(sys.argv[7]), float(sys.argv[8]), float(sys.argv[9])
floor, noise, grain = float(sys.argv[10]), float(sys.argv[11]), float(sys.argv[12])

img = Image.open(src).convert("RGB").crop((x, y, x + w, y + h))
img = ImageEnhance.Color(img).enhance(saturation)
img = img.resize((cols, rows), Image.LANCZOS)
a = (np.asarray(img).astype(np.float32) / 255.0) ** gamma * gain
rng = np.random.default_rng(7)
a = floor + a * (1 - floor) + rng.uniform(-noise, noise, a.shape) + rng.uniform(-grain, grain, (rows, cols, 1))

bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32)
threshold = (bayer + 0.5) / 16  # (0, 1)
t = np.tile(threshold, (rows // 4 + 1, cols // 4 + 1))[:rows, :cols, None]
step = levels - 1
q = np.floor(a * step + t) / step
Image.fromarray((np.clip(q, 0, 1) * 255).astype(np.uint8)).save(out, optimize=True)

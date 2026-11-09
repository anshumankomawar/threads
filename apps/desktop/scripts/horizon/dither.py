# The empty reading pane's scene: the photo shrunk to a grid of cells, each colour channel dithered (Floyd–Steinberg)
# down to a few levels, and each cell drawn as a square dot on near-black, as a dot-matrix screen would.
import sys
import numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
cols, rows, cell, dot = int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
levels = int(sys.argv[7]) if len(sys.argv) > 7 else 4
crop = tuple(int(v) for v in sys.argv[8].split(",")) if len(sys.argv) > 8 else None
darken = float(sys.argv[9]) if len(sys.argv) > 9 else 1.0
img = Image.open(src).convert("RGB")
if crop: img = img.crop(crop)
img = img.resize((cols, rows), Image.LANCZOS)
a = np.asarray(img).astype(np.float32) / 255.0
# Darker, so the scene sits behind what's over it: deeper shadows (gamma), dimmer highlights.
a = (a ** 1.6) * darken
# A little noise in each channel, so the dark turns to faint coloured static rather than flat black.
noise = float(sys.argv[10]) if len(sys.argv) > 10 else 0.0
a = a + np.random.default_rng(7).uniform(-noise, noise, a.shape) + noise * 0.35
step = 1.0 / (levels - 1)
for y in range(rows):
    for x in range(cols):
        old = a[y, x].copy()
        new = np.round(old / step) * step
        new = np.clip(new, 0, 1)
        a[y, x] = new
        err = old - new
        if x + 1 < cols: a[y, x + 1] += err * 7 / 16
        if y + 1 < rows:
            if x > 0: a[y + 1, x - 1] += err * 3 / 16
            a[y + 1, x] += err * 5 / 16
            if x + 1 < cols: a[y + 1, x + 1] += err * 1 / 16
q = (np.clip(a, 0, 1) * 255).astype(np.uint8)
canvas = np.zeros((rows * cell, cols * cell, 3), np.uint8)
canvas[:] = (10, 10, 11)
for oy in range(dot):
    for ox in range(dot):
        canvas[oy::cell, ox::cell][: rows, : cols] = q
Image.fromarray(canvas).save(out, optimize=True)

# Removes the shuttle: finds the direction the atmosphere's bands run (along which colour changes least near it), then
# fills an ellipse round it with the sky from either side along that direction, feathering the edge.
import sys
import numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
h, w, _ = im.shape
s = w / 1999
cx, cy, rx, ry = 1030 * s, 662 * s, 95 * s, 75 * s
yy, xx = np.mgrid[0:h, 0:w]
r = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
ring = (r > 2.0) & (r < 4.0)
ry_, rx_ = yy[ring], xx[ring]
def along(angle, k, ys, xs):
    dx, dy = np.cos(angle), np.sin(angle)
    sx = np.clip((xs + k * dx).round().astype(int), 0, w - 1)
    sy = np.clip((ys + k * dy).round().astype(int), 0, h - 1)
    return im[sy, sx]
best = min(
    (np.abs(along(a, 120 * s, ry_, rx_) - im[ry_, rx_]).mean(), a)
    for a in np.radians(np.arange(20, 80, 0.5))
)
angle = best[1]
print("band angle", np.degrees(angle))
k = 230 * s
fill = (along(angle, k, yy, xx) + along(angle, -k, yy, xx)) / 2
alpha = np.clip((1.8 - r) / 0.8, 0, 1)[..., None]
res = im * (1 - alpha) + fill * alpha
Image.fromarray(res.clip(0, 255).astype(np.uint8)).save(out)

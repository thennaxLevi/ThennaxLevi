"""Debug: background removal + blob detection for each sprite sheet.
Writes an overlay PNG with numbered boxes so frames can be mapped by hand."""
import sys, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from sheetlib import load_rgba

src, out = sys.argv[1], sys.argv[2]
rgb, alpha = load_rgba(src)
m = alpha > 0.35
m = ndi.binary_dilation(m, iterations=int(sys.argv[3]) if len(sys.argv) > 3 else 8)
lab, n = ndi.label(m)
objs = ndi.find_objects(lab)
boxes = []
for i, sl in enumerate(objs):
    y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    area = (lab[sl] == i + 1).sum()
    if area < 1500:
        continue
    boxes.append((x0, y0, x1, y1))
boxes.sort(key=lambda b: (round(b[1] / 120), b[0]))
img = Image.fromarray((np.dstack([rgb * alpha[..., None] + np.array([255, 0, 255]) * (1 - alpha[..., None])]).clip(0, 255)).astype(np.uint8))
d = ImageDraw.Draw(img)
for k, b in enumerate(boxes):
    d.rectangle(b, outline=(0, 255, 0))
    d.text((b[0] + 2, b[1] + 2), str(k), fill=(255, 255, 0))
img.save(out)
print(json.dumps(boxes))

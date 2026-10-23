"""Background removal for the AI-generated sprite sheets.

The sheets have a dark, slightly graded background (vignette / gradient) and
glowing effects that blend into it. We:
  1. fit a smooth (quadratic) background field to pixels close to the border colour,
  2. turn the distance from that field into alpha ("colour to alpha"), un-premultiplying
     the colour so glows keep their hue over any new background,
  3. force the solid body of the character (strong pixels + filled holes) fully opaque,
     because its black clothes are close to the background colour.
Steps 2-3 run per frame crop, so silhouettes of neighbouring frames never merge.
"""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def fit_background(rgb, iters=3, tol=14.0):
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3),
                             rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    base = np.median(border, axis=0)
    bg = np.broadcast_to(base, rgb.shape).astype(np.float64)
    yy, xx = np.mgrid[0:h, 0:w]
    xn, yn = xx / w - 0.5, yy / h - 0.5
    A_full = np.stack([np.ones_like(xn), xn, yn, xn * xn, yn * yn, xn * yn], -1).reshape(-1, 6)
    for _ in range(iters):
        d = np.linalg.norm(rgb - bg, axis=-1)
        sel_idx = np.flatnonzero((d < tol).reshape(-1))[::7]
        A = A_full[sel_idx]
        coef, *_ = np.linalg.lstsq(A, rgb.reshape(-1, 3)[sel_idx], rcond=None)
        bg = (A_full @ coef).reshape(h, w, 3)
    return bg


def remove_grid(rgb, bg, off=4, tol=10.0):
    """Paint over thin guide-grid lines: pixels that differ from the background but
    have background on both sides (horizontally or vertically) at distance `off`."""
    d = np.linalg.norm(rgb - bg, axis=-1)
    B = d < tol
    P = np.pad(B, off, constant_values=True)
    h, w = B.shape
    horiz = P[off:off + h, 0:w] & P[off:off + h, 2 * off:2 * off + w]
    vert = P[0:h, off:off + w] & P[2 * off:2 * off + h, off:off + w]
    line = ~B & (horiz | vert) & (d < 45)
    out = rgb.copy()
    out[line] = bg[line]
    return out


class Sheet:
    def __init__(self, path, grid=False):
        self.rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
        self.bg = fit_background(self.rgb)
        if grid:
            self.rgb = remove_grid(self.rgb, self.bg)
            self.rgb = remove_grid(self.rgb, self.bg)

    def cut(self, rect, t0=9.0, t1=70.0, core=30.0, erase=()):
        """Return (rgb, alpha) float arrays for the crop rect=(x0,y0,x1,y1)."""
        x0, y0, x1, y1 = rect
        rgb = self.rgb[y0:y1, x0:x1]
        bg = self.bg[y0:y1, x0:x1]
        d = np.linalg.norm(rgb - bg, axis=-1)
        a = np.clip((d - t0) / (t1 - t0), 0, 1) ** 0.8
        safe = np.maximum(a, 1e-3)[..., None]
        col = np.clip((rgb - bg * (1 - a[..., None])) / safe, 0, 255)
        strong = ndi.binary_closing(d > core, iterations=2)
        strong = ndi.binary_fill_holes(strong)
        strong = ndi.binary_opening(strong, iterations=1)
        # inside the silhouette, dark clothes sit close to the background colour:
        # use a much lower threshold there so the cape/legs don't get holes
        sil = ndi.binary_fill_holes(ndi.binary_closing(strong, iterations=7))
        a = np.where(sil, np.maximum(a, np.clip((d - 4.0) / 10.0, 0, 1)), a)
        col = np.where((sil & ~strong)[..., None], rgb, col)
        a = np.where(strong, 1.0, a)
        col = np.where(strong[..., None], rgb, col)
        for (ex0, ey0, ex1, ey1) in erase:
            a[max(0, ey0 - y0):max(0, ey1 - y0), max(0, ex0 - x0):max(0, ex1 - x0)] = 0
        return col, a

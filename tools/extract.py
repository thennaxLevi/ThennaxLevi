"""Cut the sprite sheets in art/source into a packed atlas for the game.

Output: game/assets/atlas.png + game/assets/atlas.json
  frames[anim] = [{x, y, w, h, ax, ay}, ...]   (ax, ay = anchor: feet / centre)
Run:  python3 tools/extract.py  [--preview out.png]
"""
import json, sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(__file__))
from sheetlib import Sheet

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art', 'source')
OUT = os.path.join(ROOT, 'game', 'assets')

HERO_H = 84  # standing height of the hero in game pixels

# sheet -> (file, reference rect of a standing frame used to normalise scale, options)
SHEETS = {
    'run':   ('corrida_arremesso.jpg', (1203, 287, 1315, 519), {}),
    'tk':    ('telecinese_bloqueio_aura.jpg', (37, 57, 178, 261), {}),
    'sup':   ('super_salto.jpg', None, {'scale': HERO_H / 275}),
    'mist':  ('nevoa_vermelha.jpg', (40, 85, 260, 395), {}),
    'wolf':  ('lobo.jpg', (30, 30, 300, 382), {'grid': True}),
    'bat':   ('nevoa_morcego.jpg', (83, 35, 196, 264), {}),
}

# Mist sheet: framed cells, numbers in the top-left of each cell.
MIST_COLS = [(22, 274), (292, 543), (562, 813), (832, 1084), (1102, 1353)]
MIST_ROWS = [(60, 400), (420, 750)]
def mist_cell(i):
    (x0, x1), (y0, y1) = MIST_COLS[i % 5], MIST_ROWS[i // 5]
    return dict(rect=(x0 + 4, y0 + 4, x1 - 4, y1 - 4), erase=[(x0, y0, x0 + 45, y0 + 32)])

WOLF_COLS = [(4, 340), (344, 684), (692, 1030), (1034, 1372)]
WOLF_ROWS = [(4, 384), (388, 764)]
def wolf_cell(i):
    (x0, x1), (y0, y1) = WOLF_COLS[i % 4], WOLF_ROWS[i // 4]
    return dict(rect=(x0, y0, x1, y1))

# anim -> (sheet, [frames], options). A frame is a rect or a dict(rect=, erase=, mode=, scale=)
B = 'body'
ANIMS = {
    'idle':      ('run', [dict(rect=(1196, 280, 1322, 524), mode=B)], {}),
    'stance':    ('run', [dict(rect=(1172, 556, 1334, 758), mode=B)], {}),
    'run':       ('run', [dict(rect=r, mode=B) for r in [
                    (20, 21, 207, 236), (205, 46, 367, 236), (361, 23, 527, 236), (522, 44, 696, 236),
                    (684, 21, 863, 236), (857, 44, 1006, 236), (1002, 23, 1175, 236), (1169, 47, 1346, 236)]], {}),
    'land':      ('run', [dict(rect=(926, 372, 1100, 522), mode=B)], {}),
    'crouch':    ('run', [dict(rect=(226, 606, 422, 758), mode=B), dict(rect=(441, 606, 636, 758), mode=B)], {}),
    'throw':     ('run', [dict(rect=(644, 568, 900, 758), mode='main'),
                          dict(rect=(902, 556, 1162, 758), mode=B)], {}),
    'sword':     ('run', [dict(rect=(22, 28, 150, 66), mode=B)], {'anchor': 'center'}),
    'jump':      ('sup', [dict(rect=(326, 72, 498, 352), mode=B)], {}),
    'fall':      ('sup', [dict(rect=(1114, 444, 1330, 724), mode=B)], {}),
    'flip':      ('sup', [dict(rect=(860, 60, 1022, 292), mode=B)], {}),
    'sjump':     ('sup', [dict(rect=(44, 146, 226, 354), mode=B),
                          dict(rect=(40, 424, 318, 762), mode='all'),
                          dict(rect=(338, 372, 568, 752), mode='all'),
                          dict(rect=(608, 342, 806, 680), mode=B)], {}),
    'summon':    ('sup', [dict(rect=(1110, 42, 1348, 346), mode='main')], {}),
    'tk':        ('tk', [dict(rect=(34, 54, 182, 264), mode='main'),
                         dict(rect=(205, 54, 410, 264), mode='main'),
                         dict(rect=(398, 54, 608, 264), mode='main'),
                         dict(rect=(572, 46, 968, 264), mode='main'),
                         dict(rect=(968, 56, 1178, 264), mode='main'),
                         dict(rect=(1178, 18, 1345, 264), mode='main')], {}),
    'block':     ('tk', [dict(rect=(34, 314, 266, 492), mode='main'),
                         dict(rect=(268, 312, 468, 492), mode='main'),
                         dict(rect=(484, 284, 706, 492), mode='main'),
                         dict(rect=(706, 284, 930, 492), mode='main')], {}),
    'cape':      ('tk', [dict(rect=(950, 300, 1118, 492), mode='main'),
                         dict(rect=(1170, 300, 1312, 492), mode='main')], {}),
    'aura':      ('tk', [dict(rect=(40, 534, 214, 750), mode='main'),
                         dict(rect=(268, 534, 446, 750), mode='main'),
                         dict(rect=(476, 528, 676, 750), mode='main'),
                         dict(rect=(694, 520, 902, 750), mode='main'),
                         dict(rect=(910, 486, 1116, 750), mode='main'),
                         dict(rect=(1124, 486, 1340, 750), mode='main')], {}),
    'to_mist':   ('mist', [mist_cell(i) for i in range(0, 7)], {'anchor': 'bottom'}),
    'mist':      ('mist', [mist_cell(i) for i in (7, 8, 9)], {'anchor': 'center'}),
    'to_wolf':   ('wolf', [wolf_cell(i) for i in range(0, 5)], {}),
    'wolf':      ('wolf', [wolf_cell(5)], {'anchor': 'bottom'}),
    'wolf_snarl': ('wolf', [wolf_cell(6)], {'anchor': 'bottom'}),
    'wolf_howl': ('wolf', [wolf_cell(7)], {'anchor': 'bottom'}),
    'to_bat':    ('bat', [dict(rect=r, mode='main') for r in [
                    (80, 30, 200, 268), (265, 20, 462, 268), (520, 45, 704, 268), (776, 38, 982, 266),
                    (1020, 45, 1300, 260), (66, 285, 304, 494), (360, 282, 628, 494),
                    (22, 528, 350, 744), (348, 534, 650, 744)]], {'anchor': 'bottom',
                    'scales': [1, 1, 1, 1, 1, .9, .75, .55, .42]}),
    'bat':       ('bat', [dict(rect=(650, 512, 972, 737), mode='main'),
                          dict(rect=(992, 500, 1352, 752), mode='main')], {'anchor': 'center', 'scale_mul': .4}),
}


def components(alpha, thr=0.25, dil=2):
    m = alpha > thr
    if dil:
        m = ndi.binary_dilation(m, iterations=dil)
    lab, n = ndi.label(m)
    if n == 0:
        return lab, []
    areas = ndi.sum(np.ones_like(alpha), lab, index=np.arange(1, n + 1))
    return lab, list(areas)


def filter_mode(alpha, mode):
    if mode == 'body':  # strict labelling so a floating sword/sparkles split off
        lab, areas = components(alpha, thr=0.55, dil=0)
    else:
        lab, areas = components(alpha)
    if not areas or mode == 'all':
        return alpha, lab, areas
    big = int(np.argmax(areas)) + 1
    if mode == 'body':
        keep = lab == big
    else:  # 'main': drop specks and fragments of neighbouring frames cut by the rect
        edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        ok = []
        for i, a in enumerate(areas):
            lim = 0.25 if (i + 1) in edge else 0.02
            if a >= lim * max(areas) or ((i + 1) not in edge and a >= 60):
                ok.append(i + 1)
        keep = np.isin(lab, ok)
    keep = ndi.binary_dilation(keep, iterations=3)
    return alpha * keep, lab, areas


def anchor_of(alpha, lab, areas, kind):
    ys, xs = np.nonzero(alpha > 0.3)
    if kind == 'center':
        return (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    if kind == 'bottom':
        return (xs.min() + xs.max()) / 2, ys.max()
    # 'head': x centre of the topmost part of the largest blob, y at its feet
    big = lab == (int(np.argmax(areas)) + 1)
    by, bx = np.nonzero(big & (alpha > 0.5))
    top, bot = by.min(), by.max()
    band = by < top + (bot - top) * 0.22
    return float(np.median(bx[band])), float(bot)


def main():
    sheets, scales = {}, {}
    for key, (fname, ref, opt) in SHEETS.items():
        sheets[key] = Sheet(os.path.join(SRC, fname), grid=opt.get('grid', False))
        if 'scale' in opt:
            scales[key] = opt['scale']
        else:
            _, a = sheets[key].cut(ref)
            ys = np.nonzero((a > 0.5).any(1))[0]
            scales[key] = HERO_H / (ys.max() - ys.min())
    print('scales', {k: round(v, 3) for k, v in scales.items()})

    images, meta = [], {}
    for name, (sk, frames, opt) in ANIMS.items():
        meta[name] = []
        for fi, fr in enumerate(frames):
            if not isinstance(fr, dict):
                fr = dict(rect=fr)
            col, a = sheets[sk].cut(fr['rect'], erase=fr.get('erase', ()))
            a, lab, areas = filter_mode(a, fr.get('mode', 'main'))
            ax, ay = anchor_of(a, lab, areas, opt.get('anchor', 'head'))
            s = scales[sk] * opt.get('scale_mul', 1) * (opt['scales'][fi] if 'scales' in opt else 1)
            ys, xs = np.nonzero(a > 0.02)
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            rgba = np.dstack([col, a[..., None] * 255])[y0:y1, x0:x1].clip(0, 255).astype(np.uint8)
            im = Image.fromarray(rgba, 'RGBA').convert('RGBa')
            W, H = max(1, round((x1 - x0) * s)), max(1, round((y1 - y0) * s))
            im = im.resize((W, H), Image.LANCZOS).convert('RGBA')
            arr = np.asarray(im).copy()
            al = arr[..., 3].astype(np.float64) / 255
            # crisp the opaque body, keep soft glows: snap alpha near 1 to 1
            al = np.where(al > 0.82, 1.0, al)
            al = np.where(al < 0.06, 0.0, al)
            arr[..., 3] = (al * 255).astype(np.uint8)
            images.append((name, fi, Image.fromarray(arr, 'RGBA'),
                           round((ax - x0) * s), round((ay - y0) * s)))

    # shelf pack
    AW = 2048
    images.sort(key=lambda t: -t[2].height)
    x = y = shelf = 0
    pos = []
    for t in images:
        w, h = t[2].size
        if x + w + 2 > AW:
            x, y, shelf = 0, y + shelf + 2, 0
        pos.append((x, y))
        x += w + 2
        shelf = max(shelf, h)
    atlas = Image.new('RGBA', (AW, y + shelf), (0, 0, 0, 0))
    for (name, fi, im, ax, ay), (px, py) in zip(images, pos):
        atlas.paste(im, (px, py))
        meta[name].append((fi, dict(x=px, y=py, w=im.width, h=im.height, ax=ax, ay=ay)))
    for k in meta:
        meta[k] = [f for _, f in sorted(meta[k], key=lambda t: t[0])]
    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, 'atlas.png'), optimize=True)
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    # same data as a script, so the game also runs from file:// (no fetch)
    with open(os.path.join(OUT, 'atlas.js'), 'w') as f:
        f.write('window.ATLAS=' + json.dumps(meta, separators=(',', ':')) + ';\n')
    print('atlas', atlas.size, sum(len(v) for v in meta.values()), 'frames')

    if '--preview' in sys.argv:
        out = sys.argv[sys.argv.index('--preview') + 1]
        rows = []
        for name, frs in meta.items():
            row_h = max(f['h'] for f in frs) + 20
            row_w = sum(f['w'] + 10 for f in frs) + 110
            rows.append((name, frs, row_w, row_h))
        PW = max(r[2] for r in rows)
        PH = sum(r[3] for r in rows)
        prev = Image.new('RGBA', (PW, PH), (52, 44, 70, 255))
        from PIL import ImageDraw
        d = ImageDraw.Draw(prev)
        yy = 0
        for name, frs, rw, rh in rows:
            d.text((4, yy + 4), name, fill=(255, 255, 255))
            xx = 110
            base = yy + rh - 10
            for f in frs:
                crop = atlas.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
                prev.alpha_composite(crop, (xx, base - f['ay']) if f['ay'] <= base else (xx, yy))
                d.line([(xx + f['ax'], base - 3), (xx + f['ax'], base + 3)], fill=(0, 255, 0))
                xx += f['w'] + 10
            d.line([(110, base), (rw, base)], fill=(90, 200, 90))
            yy += rh
        prev.save(out)


if __name__ == '__main__':
    main()

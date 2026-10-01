#!/usr/bin/env python3
"""Cuts MINTA's web pictures from MINTA's logo (brand/logo-source.jpg, 1254x1254, on black) into public:
  brand/minta-m.webp         the glass M alone, transparent (the header, the preview)
  brand/minta-wordmark.webp  MINTA in letters, the A with its cyan triangle, transparent
  brand/minta-logo.webp      the whole logo: M, its ring and orb, and the wordmark, transparent
  icon-32/64/192/512.png, icon-maskable-512.png, apple-touch-icon.png   the M on the app's dark ground
  og.png                     1200x630 link preview: the logo on black
The logo sits on black, so a pixel's brightness becomes its transparency and its colour is scaled back to full strength: the glow then
looks the same on any dark page. Needs Pillow, numpy and opencv (cv2). Run: python3 brand/logo/make-assets.py
"""
import os
import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'logo-source.jpg')
OUT = os.path.join(HERE, '..', '..', '..', 'app', 'web', 'public')
os.makedirs(os.path.join(OUT, 'brand'), exist_ok=True)

src = cv2.imread(SRC)
rgb = cv2.cvtColor(src, cv2.COLOR_BGR2RGB).astype(np.float32)
m = rgb.max(axis=2)
FLOOR = 7.0  # JPEG noise in the black
alpha = np.clip((m - FLOOR) / (255.0 - FLOOR), 0, 1)
col = np.where(m[..., None] > FLOOR, rgb * (255.0 / np.maximum(m[..., None], 1)), 0)


def rgba(mask=None):
    al = alpha if mask is None else alpha * mask
    return np.dstack([np.clip(col, 0, 255), al * 255]).astype(np.uint8)


full = rgba()

# the M alone: its panels are thick, the ring and the orb are thin or small, so keep the thick parts and what lights them
binary = (m > 40).astype(np.uint8)
er = cv2.erode(binary, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
n, lab, stats, _ = cv2.connectedComponentsWithStats(er, connectivity=8)
keep = np.zeros_like(binary)
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area > 6000 and y > 180 and y + h < 860:  # a panel of the M (not the wordmark below, not the ring)
        keep[lab == i] = 1
mask = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))).astype(np.float32)
mask[:300, 800:] = 0  # the orb and the ring's top arc
mask[:, 915:] = 0     # the ring on the right
mask[:, :300] = 0
mask = cv2.GaussianBlur(mask, (0, 0), 3)
ys, xs = np.where(mask > 0.02)
M = Image.fromarray(rgba(mask)[ys.min() - 4:ys.max() + 5, xs.min() - 4:xs.max() + 5], 'RGBA')
M.resize((round(M.width * 260 / M.height), 260), Image.LANCZOS).save(os.path.join(OUT, 'brand', 'minta-m.webp'), quality=92, method=6)

W = Image.fromarray(full[860:988, 150:1110], 'RGBA')
W.resize((640, round(W.height * 640 / W.width)), Image.LANCZOS).save(os.path.join(OUT, 'brand', 'minta-wordmark.webp'), quality=92, method=6)
L = Image.fromarray(full[138:992, 150:1110], 'RGBA')
L.resize((900, round(L.height * 900 / L.width)), Image.LANCZOS).save(os.path.join(OUT, 'brand', 'minta-logo.webp'), quality=90, method=6)


def icon(size, scale, name, bg=(3, 7, 11, 255)):
    c = Image.new('RGBA', (size, size), bg)
    k = size * scale / max(M.size)
    mm = M.resize((round(M.width * k), round(M.height * k)), Image.LANCZOS)
    c.alpha_composite(mm, ((size - mm.width) // 2, (size - mm.height) // 2 + round(size * 0.01)))
    c.convert('RGB').save(os.path.join(OUT, name))


icon(512, 0.64, 'icon-512.png'); icon(192, 0.64, 'icon-192.png'); icon(180, 0.66, 'apple-touch-icon.png')
icon(64, 0.8, 'icon-64.png'); icon(32, 0.86, 'icon-32.png'); icon(512, 0.5, 'icon-maskable-512.png')

og = Image.new('RGB', (1200, 630), (0, 0, 0))
crop = Image.open(SRC).convert('RGB').crop((150, 120, 1110, 1000))
k = 590 / crop.height
crop = crop.resize((round(crop.width * k), 590), Image.LANCZOS)
og.paste(crop, ((1200 - crop.width) // 2, 20))
og.save(os.path.join(OUT, 'og.png'), optimize=True)
print('MINTA logo pictures written to', os.path.normpath(OUT))

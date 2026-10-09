"""Renders the sample camera frames: a top-down view of sandy soil between rows,
darker and glossier as surface moisture rises, with the node's timestamp burned in."""
import io
from datetime import datetime
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 640, 480
DRY = np.array([188, 172, 146], dtype=np.float32)
WET = np.array([96, 84, 70], dtype=np.float32)


def _fbm(rng: np.random.Generator, octaves=(4, 8, 16, 32, 64, 160), w=W, h=H) -> np.ndarray:
    out = np.zeros((h, w), dtype=np.float32)
    amp, total = 1.0, 0.0
    for o in octaves:
        grid = rng.random((max(2, o * h // w), o)).astype(np.float32)
        layer = np.asarray(Image.fromarray(grid, mode="F").resize((w, h), Image.BICUBIC))
        out += layer * amp
        total += amp
        amp *= 0.55
    out /= total
    return (out - out.min()) / (np.ptp(out) + 1e-6)


def render(seed: int, soil_moisture: float, label: int, node_id: str, crop: str,
           drip: bool, ts_local: datetime, light: float) -> bytes:
    rng = np.random.default_rng(seed)
    wet = float(np.clip((soil_moisture - 7.0) / 9.0, 0, 1))
    if label == 1:
        wet = max(wet, 0.55)

    patch = _fbm(rng)
    local = np.clip(wet + 0.35 * (patch - 0.5), 0, 1)
    if drip and wet > 0.4:
        # darker band along the drip tape
        y = np.arange(H, dtype=np.float32)[:, None]
        cy = H * (0.45 + 0.15 * rng.random())
        band = np.exp(-((y - cy) / (H * 0.16)) ** 2) * np.ones((1, W), np.float32)
        local = np.clip(local + 0.35 * band * wet, 0, 1)

    img = DRY[None, None, :] * (1 - local[..., None]) + WET[None, None, :] * local[..., None]

    # micro-relief: shade a height field so the surface reads as loose grains and clods
    height = _fbm(rng, octaves=(10, 20, 40, 80, 220))
    gy, gx = np.gradient(height)
    relief = -(gx + gy)
    shade = np.clip(1 + 0.06 * relief / (relief.std() + 1e-6), 0.85, 1.15)
    img *= shade[..., None]

    grain = rng.normal(0, 1, (H, W)).astype(np.float32)
    img += (grain * (11 - 5 * local))[..., None]
    glint = rng.random((H, W)) > 0.996
    img[glint] = img[glint] * 0.35 + 250 * 0.65
    speck = rng.random((H, W)) > 0.995
    img[speck] *= 0.5

    if wet > 0.72:
        sheen = _fbm(rng, octaves=(3, 6, 12))
        gloss = np.clip((sheen - 0.6) * 3.0, 0, 1) * min(1.0, (wet - 0.68) * 2.5)
        sky = np.array([160, 166, 170], np.float32)
        img = img * (1 - gloss[..., None] * 0.25) + sky * gloss[..., None] * 0.25
        sparkle = (rng.random((H, W)) > 0.996) & (gloss > 0.15)
        img[sparkle] = 240

    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")
    draw = ImageDraw.Draw(im, "RGBA")

    # plant litter and small pebbles
    for _ in range(int(rng.integers(25, 70))):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        ang, ln = rng.uniform(0, np.pi), rng.uniform(6, 34)
        straw = rng.random() < 0.6
        col = (176, 156, 112) if straw else (74, 58, 42)
        if local[int(min(y, H - 1)), int(min(x, W - 1))] > 0.6:
            col = tuple(int(c * 0.62) for c in col)
        draw.line([x, y, x + ln * np.cos(ang), y + ln * np.sin(ang)], fill=col + (220,), width=int(rng.integers(1, 3)))
    for _ in range(int(rng.integers(8, 22))):
        x, y, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.5, 4.5)
        g = int(rng.uniform(150, 215) * (0.7 if wet > 0.6 else 1))
        draw.ellipse([x - r, y - r * 0.8, x + r, y + r * 0.8], fill=(g, g - 6, g - 16, 255))
        draw.arc([x - r, y - r * 0.8, x + r, y + r * 0.8], 20, 160, fill=(40, 32, 24, 160))

    # sensor stake shadow, soft-edged
    if light > 8000 and rng.random() < 0.55:
        layer = Image.new("L", (W, H), 0)
        ld = ImageDraw.Draw(layer)
        x0 = rng.uniform(W * 0.25, W * 0.7)
        ld.polygon([(x0, H), (x0 + 30, H), (x0 + 240, 0), (x0 + 212, 0)], fill=80)
        layer = layer.filter(ImageFilter.GaussianBlur(9))
        im = Image.composite(Image.new("RGB", (W, H), (24, 20, 16)), im, layer)

    im = im.filter(ImageFilter.GaussianBlur(0.6))

    # exposure: dimmer under heavy cloud or near dusk
    exposure = 0.72 + 0.28 * min(1.0, light / 30_000)
    arr = np.asarray(im).astype(np.float32) * exposure
    yy, xx = np.mgrid[0:H, 0:W]
    vig = 1 - 0.28 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 2
    arr *= vig[..., None]
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    draw = ImageDraw.Draw(im, "RGBA")
    draw.rectangle([0, H - 24, W, H], fill=(0, 0, 0, 150))
    text = f"{node_id}  {ts_local.strftime('%Y-%m-%d %H:%M:%S %Z')}  cam0  {W}x{H}"
    draw.text((10, H - 19), text, fill=(235, 235, 235), font=_font())

    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82, optimize=True)
    return buf.getvalue()


@lru_cache(maxsize=1)
def _font():
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/System/Library/Fonts/Menlo.ttc"):
        try:
            return ImageFont.truetype(path, 13)
        except OSError:
            continue
    return ImageFont.load_default(size=13)

"""Renders the sample camera frames: a top-down view of the node's white reference plate.

Water on the plate shows up as beaded droplets (more and larger as wetness rises) and,
when very wet, a continuous film; a dry plate is clean white with a little dust and
faint mineral rings from earlier drying. The node id and timestamp are burned in.
"""
import io
from datetime import datetime
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 640, 480
PLATE = (70, 50, 570, 420)          # plate bounds in the frame
SOIL = np.array([128, 112, 90], dtype=np.float32)


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


def _background(rng: np.random.Generator) -> Image.Image:
    """Soil around the plate mount, slightly out of focus."""
    tex = _fbm(rng)
    img = SOIL[None, None, :] * (0.78 + 0.4 * tex[..., None])
    img += rng.normal(0, 7, (H, W, 1)).astype(np.float32)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))


def _plate(rng: np.random.Generator) -> Image.Image:
    """Matte white plate with uneven illumination and fine surface grain."""
    x0, y0, x1, y1 = PLATE
    w, h = x1 - x0, y1 - y0
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    light = 1.0 - 0.07 * ((xx / w - 0.3) ** 2 + (yy / h - 0.25) ** 2)   # brighter toward the sun side
    grain = _fbm(rng, octaves=(40, 90, 200), w=w, h=h)
    base = 236 * light + (grain - 0.5) * 5
    rgb = np.stack([base, base - 1.5, base - 4], axis=-1)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def _droplets(rng: np.random.Generator, n: int, size_scale: float, plate: Image.Image) -> Image.Image:
    """Beaded water droplets: dark refractive rim, lighter body, specular highlight, soft shadow."""
    w, h = plate.size
    shadow = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(shadow)
    body = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    radii = np.sort(np.clip(rng.lognormal(np.log(2.6 * size_scale), 0.5, n), 1.0, 18))[::-1]
    placed: list[tuple[float, float, float]] = []
    for r in radii:
        # beads don't overlap; a drop that would touch another merges into it instead
        for _ in range(6):
            cx, cy = rng.uniform(r + 2, w - r - 2), rng.uniform(r + 2, h - r - 2)
            if all((cx - px) ** 2 + (cy - py) ** 2 > (r + pr + 1.5) ** 2 for px, py, pr in placed):
                break
        else:
            continue
        placed.append((cx, cy, r))
        ry = r * rng.uniform(0.85, 1.0)
        sd.ellipse([cx - r + r * 0.3, cy - ry + r * 0.4, cx + r + r * 0.3, cy + ry + r * 0.4], fill=int(min(55, 18 + r * 2.5)))
        # mostly transparent body: a faint cool tint over the plate
        bd.ellipse([cx - r, cy - ry, cx + r, cy + ry], fill=(214, 220, 226, 55))
        # refraction darkens the edge facing away from the light, lightens the near edge
        wd = max(1, int(r / 7))
        bd.arc([cx - r, cy - ry, cx + r, cy + ry], 200, 340, fill=(250, 252, 255, 120), width=wd)
        bd.arc([cx - r, cy - ry, cx + r, cy + ry], 20, 160, fill=(120, 128, 138, 120), width=wd)
        # caustic: light focused through the drop onto its lower-right inner area
        if r > 3:
            cr = r * 0.45
            bd.ellipse([cx + r * 0.1 - cr, cy + ry * 0.15 - cr * 0.8, cx + r * 0.1 + cr, cy + ry * 0.15 + cr * 0.8],
                       fill=(255, 255, 255, 60))
        hr = max(0.7, r * 0.18)
        hx, hy = cx - r * 0.4, cy - ry * 0.42
        bd.ellipse([hx - hr, hy - hr * 0.75, hx + hr, hy + hr * 0.75], fill=(255, 255, 255, 230))
    shadow = shadow.filter(ImageFilter.GaussianBlur(1.6))
    out = Image.composite(Image.new("RGB", (w, h), (170, 170, 168)), plate, shadow)
    out.paste(body.filter(ImageFilter.GaussianBlur(0.5)), (0, 0), body.filter(ImageFilter.GaussianBlur(0.5)))
    return out


def render(seed: int, p_wet: float, label: int, node_id: str, ts_local: datetime, light: float) -> bytes:
    rng = np.random.default_rng(seed)
    x0, y0, x1, y1 = PLATE

    frame = _background(rng)
    plate = _plate(rng)
    pd = ImageDraw.Draw(plate, "RGBA")
    pw, ph = plate.size

    # residue from earlier drying: faint mineral rings and dust
    for _ in range(int(rng.integers(6, 18))):
        cx, cy, r = rng.uniform(0, pw), rng.uniform(0, ph), rng.uniform(3, 14)
        pd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(196, 190, 176, int(rng.uniform(25, 60))), width=1)
    for _ in range(int(rng.integers(30, 80))):
        cx, cy, r = rng.uniform(0, pw), rng.uniform(0, ph), rng.uniform(0.5, 1.6)
        g = int(rng.uniform(110, 170))
        pd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(g, g - 8, g - 18, 180))

    # wetness drives droplet count and size; ambiguous frames get a sparse scatter of small beads
    wet = float(np.clip((p_wet - 0.3) / 0.7, 0, 1))
    if wet > 0:
        if wet > 0.8:
            # continuous film: slightly grey, glossy sheet across part of the plate
            film = _fbm(rng, octaves=(2, 4, 8), w=pw, h=ph)
            mask = np.clip((film - (1.05 - wet)) * 4, 0, 1) * 0.55
            arr = np.asarray(plate).astype(np.float32)
            arr = arr * (1 - mask[..., None] * 0.12) + np.array([200, 208, 214]) * mask[..., None] * 0.12
            plate = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        n = int(40 + 520 * wet ** 1.3) if label == 1 else int(5 + 40 * wet)
        plate = _droplets(rng, n, 0.8 + 1.2 * wet, plate)

    # plate edge: bevel shadow on the mount
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle(PLATE, radius=10, fill=255)
    edge = Image.new("L", (W, H), 0)
    ImageDraw.Draw(edge).rounded_rectangle((x0 + 4, y0 + 6, x1 + 4, y1 + 6), radius=10, fill=120)
    edge = edge.filter(ImageFilter.GaussianBlur(5))
    frame = Image.composite(Image.new("RGB", (W, H), (40, 34, 26)), frame, edge)
    full = Image.new("RGB", (W, H))
    full.paste(plate, (x0, y0))
    frame = Image.composite(full, frame, mask)

    d = ImageDraw.Draw(frame, "RGBA")
    # fiducial marks used to locate and rectify the plate
    for fx, fy in ((x0 + 16, y0 + 16), (x1 - 16, y0 + 16), (x0 + 16, y1 - 16), (x1 - 16, y1 - 16)):
        d.ellipse([fx - 6, fy - 6, fx + 6, fy + 6], outline=(30, 30, 30, 230), width=2)
        d.line([fx - 9, fy, fx + 9, fy], fill=(30, 30, 30, 230), width=1)
        d.line([fx, fy - 9, fx, fy + 9], fill=(30, 30, 30, 230), width=1)
    d.text((x1 - 64, y1 - 40), f"REF-{node_id[1:]}", fill=(90, 90, 90, 200), font=_font(11))

    # exposure: dimmer under heavy cloud or near dusk, slight vignette
    exposure = 0.74 + 0.26 * min(1.0, light / 30_000)
    arr = np.asarray(frame).astype(np.float32) * exposure
    yy, xx = np.mgrid[0:H, 0:W]
    vig = 1 - 0.22 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 2
    arr *= vig[..., None]
    arr += rng.normal(0, 2.2, arr.shape)   # sensor noise
    frame = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    d = ImageDraw.Draw(frame, "RGBA")
    d.rectangle([0, H - 24, W, H], fill=(0, 0, 0, 150))
    text = f"{node_id}  {ts_local.strftime('%Y-%m-%d %H:%M:%S %Z')}  cam0  {W}x{H}"
    d.text((10, H - 19), text, fill=(235, 235, 235), font=_font(13))

    buf = io.BytesIO()
    frame.save(buf, "JPEG", quality=85, optimize=True)
    return buf.getvalue()


@lru_cache(maxsize=4)
def _font(size: int):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/System/Library/Fonts/Menlo.ttc"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)

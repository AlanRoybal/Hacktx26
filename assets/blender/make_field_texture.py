"""Field texture (system python + Pillow). Writes public/textures/field.png.
u (x) runs along the field length from the TEXAS end zone (u=0) to the OKLAHOMA end zone (u=1)."""
import os
from PIL import Image, ImageDraw, ImageFont
import numpy as np

PX = 24  # pixels per yard
W, H = 120 * PX, int(53.333 * PX)
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'textures', 'field.png')
BOLD = next((p for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                         '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'] if os.path.exists(p)), None)


def font(size):
    return ImageFont.truetype(BOLD, size) if BOLD else ImageFont.load_default(size)


def text_rot(img, txt, center, size, color, angle):
    f = font(size)
    l, t, r, b = f.getbbox(txt)
    tile = Image.new('RGBA', (r - l + 8, b - t + 8), (0, 0, 0, 0))
    ImageDraw.Draw(tile).text((4 - l, 4 - t), txt, font=f, fill=color)
    tile = tile.rotate(angle, expand=True, resample=Image.NEAREST)
    img.alpha_composite(tile, (int(center[0] - tile.width / 2), int(center[1] - tile.height / 2)))


img = Image.new('RGBA', (W, H), (46, 125, 50, 255))
d = ImageDraw.Draw(img)
for i in range(20):  # 5-yard mowing stripes in the field of play
    x0 = (10 + i * 5) * PX
    d.rectangle([x0, 0, x0 + 5 * PX, H], fill=(46, 125, 50, 255) if i % 2 else (51, 137, 58, 255))
d.rectangle([0, 0, 10 * PX, H], fill=(191, 87, 0, 255))
d.rectangle([110 * PX, 0, W, H], fill=(132, 22, 23, 255))
white = (236, 234, 226, 255)
lw = 3
for yd in range(10, 111, 5):
    d.rectangle([yd * PX - lw // 2, 0, yd * PX + lw // 2, H], fill=white)
for yd in range(11, 110):
    if yd % 5:
        for yy in (int(0.6 * PX), H - int(0.6 * PX) - 12, int(H / 2 - 3.08 * PX), int(H / 2 + 3.08 * PX)):
            d.rectangle([yd * PX - 1, yy, yd * PX + 1, yy + 12], fill=white)
d.rectangle([0, 0, W, lw * 2], fill=white)
d.rectangle([0, H - lw * 2, W, H], fill=white)
d.rectangle([0, 0, lw * 2, H], fill=white)
d.rectangle([W - lw * 2, 0, W, H], fill=white)
for k, n in enumerate([10, 20, 30, 40, 50, 40, 30, 20, 10]):
    x = (20 + k * 10) * PX
    text_rot(img, str(n), (x, H - 9 * PX), 2 * PX + 14, white, 0)
    text_rot(img, str(n), (x, 9 * PX), 2 * PX + 14, white, 180)
text_rot(img, 'TEXAS', (5 * PX, H / 2), 6 * PX, white, 90)
text_rot(img, 'OKLAHOMA', (115 * PX, H / 2), 5 * PX, (253, 249, 216, 255), -90)
cx, cy = W / 2, H / 2
logo = Image.open(os.path.join(os.path.dirname(OUT), 'rrr_Allstate_Red_River_Rivalry_logo.png')).convert('RGBA')
sz = int(14 * PX)
logo = logo.resize((sz, sz), Image.LANCZOS)
img.alpha_composite(logo, (int(cx - sz / 2), int(cy - sz / 2)))
a = np.asarray(img).astype(np.float32)
rng = np.random.default_rng(3)
noise = rng.uniform(0.86, 1.0, (H // 4 + 1, W // 4 + 1)).repeat(4, 0).repeat(4, 1)[:H, :W, None]
a[..., :3] *= noise
img = Image.fromarray(a.clip(0, 255).astype(np.uint8))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT)
print('FIELD', OUT, img.size)

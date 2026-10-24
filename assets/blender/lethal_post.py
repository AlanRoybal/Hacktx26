"""Preview-only approximation of the in-game post pass: nearest upscale, Bayer dither, posterize, grain, vignette.
Usage: python3 lethal_post.py out.png in1.png in2.png ...  (inputs tiled 2 per row)"""
import sys
import numpy as np
from PIL import Image

BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 - 0.5


def lethal(img, levels=24, scale=2, seed=0):
    a = np.asarray(img.convert('RGB')).astype(np.float32) / 255.0
    h, w, _ = a.shape
    d = np.tile(BAYER, (h // 4 + 1, w // 4 + 1))[:h, :w, None]
    a = np.floor(a * levels + 0.5 + d) / levels
    rng = np.random.default_rng(seed)
    a += rng.normal(0, 0.035, (h, w, 1))
    yy, xx = np.mgrid[0:h, 0:w]
    v = 1 - 0.55 * (((xx - w / 2) / w) ** 2 + ((yy - h / 2) / h) ** 2) * 2.2
    a *= v[..., None]
    a = np.clip(a, 0, 1)
    out = Image.fromarray((a * 255).astype(np.uint8))
    return out.resize((w * scale, h * scale), Image.NEAREST)


if __name__ == '__main__':
    out, ins = sys.argv[1], sys.argv[2:]
    tiles = [lethal(Image.open(p), seed=i) for i, p in enumerate(ins)]
    cols = 2 if len(tiles) > 1 else 1
    rows = (len(tiles) + cols - 1) // cols
    tw, th = tiles[0].size
    sheet = Image.new('RGB', (tw * cols, th * rows))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * tw, (i // cols) * th))
    sheet.save(out)
    print(out, sheet.size)

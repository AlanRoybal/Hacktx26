"""Jersey number atlas (00-99, white, tinted by material) and helmet logos. System python + Pillow."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'textures')
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
CELL = 128


def numbers():
    img = Image.new('RGBA', (CELL * 10, CELL * 10), (0, 0, 0, 0))
    f = ImageFont.truetype(BOLD, 150)
    for n in range(100):
        tile = Image.new('RGBA', (CELL * 2, CELL * 2), (0, 0, 0, 0))
        d = ImageDraw.Draw(tile)
        txt = str(n)
        l, t, r, b = d.textbbox((0, 0), txt, font=f, stroke_width=6)
        d.text(((CELL * 2 - (r - l)) / 2 - l, (CELL * 2 - (b - t)) / 2 - t), txt, font=f, fill=(255, 255, 255, 255),
               stroke_width=6, stroke_fill=(255, 255, 255, 255))
        bb = tile.getbbox()
        tile = tile.crop(bb)
        sc = min((CELL - 10) / tile.width, (CELL - 10) / tile.height)
        tile = tile.resize((max(1, int(tile.width * min(sc, (CELL - 10) / tile.height))), CELL - 10), Image.LANCZOS)
        if tile.width > CELL - 6:
            tile = tile.resize((CELL - 6, CELL - 10), Image.LANCZOS)
        img.alpha_composite(tile, ((n % 10) * CELL + (CELL - tile.width) // 2, (n // 10) * CELL + 5))
    img.save(os.path.join(OUT, 'numbers_atlas.png'))


def longhorn():
    img = Image.new('RGBA', (256, 128), (0, 0, 0, 0))
    right = [(118, 30), (135, 31), (165, 24), (200, 9), (186, 27), (160, 41), (128, 49), (119, 64), (112, 86), (100, 102)]
    pts = [(100, 28)] + right + [(200 - x, y) for x, y in reversed(right)]
    pts = [(x * 1.2 + 8, y * 1.15 + 4) for x, y in pts]
    ImageDraw.Draw(img).polygon(pts, fill=(191, 87, 0, 255))
    img.save(os.path.join(OUT, 'logo_texas_hd.png'))


def ou():
    img = Image.new('RGBA', (256, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    serif = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
    cream, crimson = (242, 238, 230, 255), (132, 22, 23, 255)
    fo, fu = ImageFont.truetype(serif, 120), ImageFont.truetype(serif, 84)
    l, t, r, b = d.textbbox((0, 0), 'O', font=fo)
    ox, oy = 128 - (l + r) / 2 - 10, 64 - (t + b) / 2
    d.text((ox, oy), 'O', font=fo, fill=cream)
    l, t, r, b = d.textbbox((0, 0), 'U', font=fu, stroke_width=6)
    d.text((128 - (l + r) / 2 + 22, 64 - (t + b) / 2 + 6), 'U', font=fu, fill=cream, stroke_width=6, stroke_fill=crimson)
    img = img.crop(img.getbbox())
    out = Image.new('RGBA', (256, 128), (0, 0, 0, 0))
    out.alpha_composite(img, ((256 - img.width) // 2, (128 - img.height) // 2))
    out.save(os.path.join(OUT, 'logo_ou_hd.png'))


if __name__ == '__main__':
    numbers()
    longhorn()
    ou()
    print('PLAYER_TEX done')

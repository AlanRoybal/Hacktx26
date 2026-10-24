"""Stadium pulse textures: crowd sign atlas, ribbon boards, jumbotron idle/hype graphics, scorebug overlay.
python3 make_pulse_textures.py            -> all static textures
python3 make_pulse_textures.py feed IN OUT -> live jumbotron frame: IN (render) + scorebug -> OUT"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'textures')
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
ORANGE, CRIMSON, WHITE, CREAM, BLACK = '#BF5700', '#841617', '#FFFFFF', '#FDF9D8', '#0A0A0C'
SIGNS = [("HOOK 'EM", WHITE, ORANGE), ('#16', ORANGE, WHITE), ('BEAT OU', WHITE, ORANGE), ('TEXAS FIGHT', ORANGE, WHITE),
         ('BOOMER SOONER', CREAM, CRIMSON), ('OU', CRIMSON, CREAM), ('SOONERS', CREAM, CRIMSON), ('HORNS DOWN', CRIMSON, CREAM)]


def fit_text(d, box, txt, font_path, fill, max_size=200):
    x0, y0, x1, y1 = box
    s = max_size
    while s > 8:
        f = ImageFont.truetype(font_path, s)
        l, t, r, b = d.textbbox((0, 0), txt, font=f)
        if r - l <= x1 - x0 and b - t <= y1 - y0:
            break
        s -= 4
    d.text(((x0 + x1) / 2 - (l + r) / 2, (y0 + y1) / 2 - (t + b) / 2), txt, font=f, fill=fill)


def signs():
    """4x2 atlas of 256x128 cells. Top row Texas, bottom row OU (Blender UV v 0.5..1 = top row)."""
    img = Image.new('RGB', (1024, 256))
    d = ImageDraw.Draw(img)
    for i, (txt, bg, fg) in enumerate(SIGNS):
        x, y = (i % 4) * 256, (i // 4) * 128
        d.rectangle((x, y, x + 255, y + 127), fill=bg)
        d.rectangle((x + 6, y + 6, x + 249, y + 121), outline=fg, width=5)
        fit_text(d, (x + 18, y + 18, x + 238, y + 110), txt, BOLD, fg, 96)
    img.save(os.path.join(OUT, 'crowd_signs.png'))


def ribbons():
    """1024x64 tiles; the ribbon UV repeats every 32 m around the bowl."""
    for name, txt, bg, fg in (('ribbon_calm', 'RED RIVER RIVALRY   COTTON BOWL   DALLAS', BLACK, ORANGE),
                              ('ribbon_hype', 'MAKE SOME NOISE   HOOK \'EM', ORANGE, WHITE)):
        img = Image.new('RGB', (1024, 64), bg)
        d = ImageDraw.Draw(img)
        if name == 'ribbon_calm':
            rrr = Image.open(os.path.join(OUT, 'rrr_Allstate_Red_River_Rivalry_logo.png')).convert('RGBA').resize((60, 60), Image.LANCZOS)
            fit_text(d, (80, 6, 944, 58), txt, BOLD, fg, 52)
            img.paste(rrr, (10, 2), rrr); img.paste(rrr, (954, 2), rrr)
        else:
            fit_text(d, (12, 6, 1012, 58), txt, BOLD, fg, 52)
        img.save(os.path.join(OUT, name + '.png'))


def jumbo():
    idle = Image.new('RGB', (1280, 720), BLACK)
    logo = Image.open(os.path.join(OUT, 'logo_texas_hd.png')).resize((768, 384), Image.LANCZOS)
    rrr = Image.open(os.path.join(OUT, 'rrr_Allstate_Red_River_Rivalry_logo.png')).convert('RGBA').resize((440, 440), Image.LANCZOS)
    idle.paste(rrr, (420, 40), rrr)
    fit_text(ImageDraw.Draw(idle), (100, 520, 1180, 660), 'RED RIVER RIVALRY', BOLD, WHITE, 120)
    idle.save(os.path.join(OUT, 'jumbo_idle.png'))
    hype = Image.new('RGB', (1280, 720), ORANGE)
    d = ImageDraw.Draw(hype)
    for y in range(0, 720, 6):
        d.line((0, y, 1280, y), fill='#A84C00')
    hype.paste(logo.resize((512, 256)), (384, 40), logo.resize((512, 256)))
    fit_text(d, (60, 300, 1220, 520), 'MAKE SOME', BOLD, WHITE, 220)
    fit_text(d, (60, 500, 1220, 700), 'NOISE', BOLD, WHITE, 220)
    hype.save(os.path.join(OUT, 'jumbo_hype.png'))


def feed(src, dst, home=27, away=31, clock='4TH  1:45', down='1ST & 10'):
    img = Image.open(src).convert('RGB').resize((1280, 720), Image.LANCZOS)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(MONO, 40)
    y = 630
    d.rectangle((60, y, 1220, y + 64), fill=BLACK)
    d.rectangle((60, y, 330, y + 64), fill=ORANGE)
    d.rectangle((330, y, 600, y + 64), fill=CRIMSON)
    d.text((80, y + 10), f'TEX  {home}', font=f, fill=WHITE)
    d.text((350, y + 10), f'OU   {away}', font=f, fill=CREAM)
    d.text((630, y + 10), clock, font=f, fill=WHITE)
    d.text((930, y + 10), down, font=f, fill='#F2C14E')
    d.rectangle((60, 40, 300, 92), fill=BLACK)
    d.ellipse((76, 56, 96, 76), fill='#E01E1E')
    d.text((108, 44), 'LIVE', font=f, fill=WHITE)
    img.save(dst)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'feed':
        feed(sys.argv[2], sys.argv[3])
    else:
        signs()
        ribbons()
        jumbo()
        print('PULSE_TEX done')

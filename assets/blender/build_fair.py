"""State Fair of Texas around the Cotton Bowl: Texas Star Ferris wheel, Big Tex, midway lights, Golden Hat trophy.
blender -b --python assets/blender/build_fair.py  -> public/models/fair.glb"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import lib


def texas_star(cx, cy):
    steel = lib.mat('star_steel', '#C9C4BA', rough=0.5, metal=0.6, tex='grime')
    bulb = lib.mat('star_lights', '#FFD27A', rough=0.3, tex=None, emission='#FFD27A', strength=25.0)
    car = lib.mat('star_gondola', '#C8102E', rough=0.6, tex=None)
    R, hub, n = 40.0, (cx, cy, 46.0), 44
    parts = []
    ring = [(cx + R * math.cos(2 * math.pi * k / n), cy, hub[2] + R * math.sin(2 * math.pi * k / n)) for k in range(n + 1)]
    parts.append(lib.tube('rim', ring, 0.35, 6, steel))
    parts.append(lib.tube('rim_lights', [(x, y - 0.5, z) for x, y, z in ring], 0.22, 4, bulb))
    for k in range(16):
        a = 2 * math.pi * k / 16
        parts.append(lib.tube('spoke', [hub, (cx + R * math.cos(a), cy, hub[2] + R * math.sin(a))], 0.12, 4, bulb if k % 2 else steel))
    for x in (-9, 9):
        parts.append(lib.tube('leg', [(cx + x, cy - 3, 0), hub], 0.6, 6, steel))
        parts.append(lib.tube('leg', [(cx + x, cy + 3, 0), hub], 0.6, 6, steel))
    for k in range(44):
        a = 2 * math.pi * k / 44
        parts.append(lib.box('gondola', (1.6, 1.6, 1.8), (cx + R * math.cos(a), cy, hub[2] + R * math.sin(a) - 1.4), car))
    for p in parts:
        lib.apply(p)
    return lib.join(parts, 'texas_star')


def big_tex(cx, cy, height=16.8):
    """55 ft cowboy: square-toe boots with heels, cuffed jeans, belt and buckle, red plaid western shirt with collar,
    pockets and pearl snaps, red bandana, hands with fingers, face with nose/ears/brows, ten-gallon hat with curled brim. Waving."""
    import numpy as np
    k = np.indices((64, 64)).astype(np.float32)
    band = lambda i, w, o: ((k[i] + o) % 16 < w).astype(np.float32)
    plaid = np.zeros((64, 64, 3), np.float32)
    base, dark, light = np.array([.62, .05, .07]), np.array([.22, .02, .03]), np.array([.95, .9, .82])
    m1, m2, m3 = np.maximum(band(0, 4, 0), band(1, 4, 0)), band(0, 1, 8) + band(1, 1, 8), band(0, 4, 0) * band(1, 4, 0)
    plaid[:] = base
    plaid = plaid * (1 - m1[..., None] * 0.45) + dark * (m1[..., None] * 0.45)
    plaid = plaid * (1 - 0.55 * np.clip(m2, 0, 1)[..., None]) + light * np.clip(m2, 0, 1)[..., None] * 0.55
    plaid = plaid * (1 - m3[..., None] * 0.5) + dark * m3[..., None] * 0.5
    shirt = lib.mat('tex_shirt', '#FFFFFF', image=lib.image_from_array('tex_plaid', plaid))
    jeans = lib.mat('tex_jeans', '#2B4C7E', tex='grime')
    seam = lib.mat('tex_seam', '#C8A050', tex=None)
    skin = lib.mat('tex_skin', '#D9A57E', rough=0.6, tex=None)
    boots = lib.mat('tex_boots', '#5A3418', rough=0.45, tex='grime')
    sole = lib.mat('tex_sole', '#1E140C', tex=None)
    hat = lib.mat('tex_hat', '#EFE6CF', tex='grime')
    band_m = lib.mat('tex_hatband', '#3A2414', tex=None)
    belt = lib.mat('tex_belt', '#3B2414', rough=0.5, tex='grime')
    gold = lib.mat('tex_buckle', '#D4AF37', rough=0.25, metal=1.0, tex=None)
    pearl = lib.mat('tex_snap', '#F4F1E8', rough=0.2, tex=None)
    scarf = lib.mat('tex_bandana', '#8E1B1B', tex='grime')
    eye = lib.mat('tex_eye', '#1A1410', rough=0.2, tex=None)
    brow = lib.mat('tex_brow', '#5A3A22', tex=None)
    S = height / 1.9
    P = lambda x, y, z: (cx + x * S, cy - y * S, z * S)   # faces the stadium
    R = lambda r: r * S
    parts = []
    for x in (0.1, -0.1):
        parts += [lib.box('sole', (R(.11), R(.3), R(.03)), P(x, -0.06, 0.015), sole, bevel=R(.01)),
                  lib.box('heel', (R(.09), R(.08), R(.05)), P(x, 0.05, 0.04), sole),
                  lib.sweep('boot_foot', [P(x, 0.06, 0.06), P(x, -0.06, 0.07), P(x, -0.18, 0.05)], [(R(.06), R(.055)), (R(.055), R(.045)), (R(.045), R(.03))], 12, boots, side=(1, 0, 0)),
                  lib.loft('boot_shaft', P(x, 0.02, 0.05), P(x, 0.02, 0.34), [(0, R(.06), R(.07)), (0.5, R(.058), R(.062)), (1, R(.068), R(.07))], 14, boots),
                  lib.tube('boot_stitch', [P(x, -0.05, 0.3), P(x, -0.052, 0.2), P(x - 0.02, -0.055, 0.12)], R(.006), 4, seam),
                  lib.sweep('leg', [P(x, 0.02, 0.3), P(x, 0.01, 0.55), P(x * 0.95, 0.0, 0.8), P(x * 0.9, 0, 0.98)],
                            [(R(.075), R(.075)), (R(.07), R(.072)), (R(.085), R(.088)), (R(.1), R(.1))], 14, jeans, tip=False),
                  lib.loft('cuff', P(x, 0.02, 0.29), P(x, 0.02, 0.34), [(0, R(.082), R(.082)), (1, R(.08), R(.08))], 14, jeans),
                  lib.tube('inseam', [P(x * 0.55, 0.0, 0.33), P(x * 0.5, 0.0, 0.9)], R(.005), 4, seam)]
    parts.append(lib.loft('hips', P(0, 0, 0.88), P(0, 0, 1.02), [(0, R(.19), R(.12)), (1, R(.19), R(.125))], 16, jeans))
    parts.append(lib.loft('belt', P(0, 0, 1.0), P(0, 0, 1.05), [(0, R(.195), R(.128)), (1, R(.195), R(.128))], 16, belt))
    parts.append(lib.box('buckle', (R(.09), R(.02), R(.06)), P(0, -0.13, 1.025), gold, bevel=R(.008)))
    parts.append(lib.box('buckle_star', (R(.03), R(.01), R(.03)), P(0, -0.142, 1.025), seam, rot=(0, math.radians(45), 0)))
    parts.append(lib.loft('torso', P(0, 0, 1.04), P(0, 0, 1.52), [(0, R(.19), R(.125)), (0.35, R(.205), R(.135)), (0.75, R(.235), R(.145)), (0.92, R(.22), R(.13)), (1, R(.15), R(.1))], 18, shirt))
    parts.append(lib.loft('yoke', P(0, 0, 1.4), P(0, 0, 1.5), [(0, R(.238), R(.148)), (1, R(.222), R(.134))], 18, shirt))
    for side in (-1, 1):
        parts += [lib.box('pocket', (R(.08), R(.012), R(.07)), P(side * 0.1, -0.142, 1.33), shirt, bevel=R(.006)),
                  lib.box('flap', (R(.085), R(.016), R(.025)), P(side * 0.1, -0.146, 1.375), shirt, bevel=R(.006)),
                  lib.sphere('snap', R(.008), P(side * 0.1, -0.156, 1.37), 6, 4, pearl),
                  lib.box('collar', (R(.09), R(.02), R(.06)), P(side * 0.055, -0.1, 1.53), shirt, rot=(math.radians(-20), 0, math.radians(side * 30)))]
    for i in range(6):
        parts.append(lib.sphere('snap', R(.009), P(0, -0.143 + 0.004 * (i > 2), 1.08 + i * 0.075), 6, 4, pearl))
    parts.append(lib.loft('bandana', P(0, 0, 1.5), P(0, 0, 1.57), [(0, R(.115), R(.1)), (1, R(.085), R(.08))], 14, scarf))
    parts.append(lib.box('bandana_tip', (R(.07), R(.015), R(.07)), P(0, -0.1, 1.5), scarf, rot=(0, math.radians(45), 0)))
    # left arm hangs, right arm waves
    def arm(side, pts, hand_at, wave):
        out = [lib.sweep('arm', pts, [(R(.068), R(.068)), (R(.06), R(.06)), (R(.052), R(.052)), (R(.05), R(.05))], 12, shirt, tip=False),
               lib.loft('cuff', pts[-1], hand_at, [(0, R(.052), R(.052)), (0.4, R(.05), R(.05))], 12, shirt)]
        hx, hy, hz = hand_at
        out.append(lib.sphere('palm', 1.0, hand_at, 10, 8, skin, scale=(R(.045), R(.028), R(.055))))
        for f in range(4):
            off = (f - 1.5) * R(.022)
            tip = (hx + off * (1 if wave else 0.3), hy - (0 if wave else R(.01)), hz + (R(.11) if wave else -R(.1)) + (0 if wave else -abs(f - 1.5) * R(.01)))
            base = (hx + off * (0.9 if wave else 0.3), hy, hz + (R(.04) if wave else -R(.04)))
            out.append(lib.tube('finger', [base, tip], R(.011), 6, skin, joints=True))
        th = (hx - side * R(.06), hy - R(.02), hz + (R(.04) if wave else -R(.02)))
        out.append(lib.tube('thumb', [(hx - side * R(.03), hy, hz), th], R(.012), 6, skin, joints=True))
        return out
    parts += arm(1, [P(0.22, 0, 1.47), P(0.27, 0, 1.3), P(0.29, -0.02, 1.15), P(0.29, -0.04, 1.0)], P(0.29, -0.04, 0.93), False)
    parts += arm(-1, [P(-0.22, 0, 1.47), P(-0.36, 0, 1.56), P(-0.43, -0.02, 1.7), P(-0.45, -0.03, 1.82)], P(-0.45, -0.03, 1.87), True)
    parts.append(lib.loft('neck', P(0, 0, 1.53), P(0, 0, 1.6), [(0, R(.06), R(.06)), (1, R(.058), R(.058))], 12, skin))
    hd = lib.sphere('head', 1.0, P(0, 0, 1.68), 18, 14, skin, scale=(R(.095), R(.11), R(.12)))
    parts += [hd,
              lib.sphere('jaw', 1.0, P(0, -0.035, 1.615), 14, 10, skin, scale=(R(.08), R(.075), R(.05))),
              lib.loft('nose', P(0, -0.1, 1.69), P(0, -0.135, 1.655), [(0, R(.016), R(.012)), (1, R(.022), R(.02))], 8, skin),
              lib.sphere('chin', R(.03), P(0, -0.09, 1.585), 8, 6, skin)]
    for side in (-1, 1):
        parts += [lib.sphere('ear', 1.0, P(side * 0.095, 0.0, 1.68), 8, 6, skin, scale=(R(.012), R(.025), R(.035))),
                  lib.sphere('eye', R(.012), P(side * 0.038, -0.1, 1.71), 8, 6, eye),
                  lib.box('brow', (R(.04), R(.012), R(.01)), P(side * 0.04, -0.104, 1.735), brow, rot=(0, math.radians(side * -8), 0)),
                  lib.sphere('cheek', 1.0, P(side * 0.05, -0.085, 1.66), 8, 6, skin, scale=(R(.03), R(.02), R(.025)))]
    parts.append(lib.box('smile', (R(.05), R(.008), R(.008)), P(0, -0.112, 1.625), brow))
    # ten-gallon hat: curled brim, pinched crown, band
    brim = []
    n = 32
    for i in range(n):
        a = 2 * math.pi * i / n
        brim.append(lib.box('brim', (R(.06), R(.05), R(.012)), P(0.24 * math.cos(a) * 0.95, 0.27 * math.sin(a) * 0.95, 1.79 + 0.035 * abs(math.cos(a)) ** 2), hat,
                            rot=(0, math.radians(18 * math.cos(a)), a)))
    parts += brim
    parts += [lib.cyl('brim_core', R(.2), R(.015), P(0, 0, 1.79), 24, hat),
              lib.loft('crown', P(0, 0, 1.79), P(0, 0, 1.98), [(0, R(.115), R(.13)), (0.6, R(.11), R(.125)), (0.85, R(.095), R(.11)), (1, R(.05), R(.08))], 18, hat),
              lib.loft('hatband', P(0, 0, 1.8), P(0, 0, 1.835), [(0, R(.118), R(.133)), (1, R(.117), R(.132))], 18, band_m)]
    for p in parts:
        lib.apply(p)
        lib.box_uv(p, R(.25))
    return lib.join(parts, 'big_tex')


def midway():
    pole = lib.mat('midway_pole', '#3A3A3A', tex=None)
    cols = ['#FF4D4D', '#FFD27A', '#4DD2FF', '#7CFF6B', '#FF8AE2']
    parts = []
    for side in (-1, 1):
        for k in range(14):
            y = -110 + k * 17
            x = side * (118 + 6 * math.sin(k))
            parts.append(lib.cyl('pole', 0.25, 9, (x, y, 4.5), 6, pole))
            b = lib.mat(f'midway_{k % 5}', cols[k % 5], tex=None, emission=cols[k % 5], strength=20.0)
            parts.append(lib.tube('string', [(x, y, 9), (x + side * 2, y + 8.5, 7), (x, y + 17, 9)], 0.12, 4, b))
            if k % 3 == 0:
                tent = lib.mat(f'tent_{k % 2}', ['#E8E2D0', '#C8102E'][k % 2], tex='grime')
                parts.append(lib.box('booth', (6, 5, 3.5), (x + side * 6, y + 8, 1.75), tent))
    for p in parts:
        lib.apply(p)
    return lib.join(parts, 'midway')


def golden_hat(loc):
    gold = lib.mat('golden_hat', '#D4AF37', rough=0.25, metal=1.0, tex=None)
    wood = lib.mat('trophy_base', '#3B2414', tex='grime')
    x, y, z = loc
    parts = [lib.box('base', (0.5, 0.5, 0.35), (x, y, z + 0.175), wood),
             lib.cyl('brim', 0.36, 0.03, (x, y, z + 0.38), 20, gold),
             lib.cyl('crown', 0.17, 0.22, (x, y, z + 0.5), 16, gold, r2=0.14)]
    for p in parts:
        lib.apply(p)
    return lib.join(parts, 'golden_hat')


if __name__ == '__main__':
    lib.reset()
    objs = [texas_star(-95, -185), big_tex(70, -175, 52.0), midway(), golden_hat((-31.5, 6, 0))]
    print('FAIR_TRIS', lib.tri_count(objs))
    lib.export('fair', selection=objs)

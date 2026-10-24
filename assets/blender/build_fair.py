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
    """55 ft cowboy: boots, jeans, plaid shirt, hat, waving."""
    jeans = lib.mat('tex_jeans', '#2B4C7E', tex='grime')
    shirt = lib.mat('tex_shirt', '#B22234', tex='grime')
    skin = lib.mat('tex_skin', '#E0B48C', tex=None)
    boots = lib.mat('tex_boots', '#6B3E1F', tex='grime')
    hat = lib.mat('tex_hat', '#F2EEDF', tex='grime')
    S = height / 1.9
    P = lambda x, y, z: (cx + x * S, cy + y * S, z * S)
    parts = []
    for x in (0.1, -0.1):
        parts += [lib.loft('boot', P(x, 0, 0), P(x, 0, 0.3), [(0, .06 * S, .1 * S), (1, .06 * S, .065 * S)], 8, boots),
                  lib.loft('leg', P(x, 0, 0.3), P(x, 0, 0.95), [(0, .065 * S, .065 * S), (1, .085 * S, .09 * S)], 8, jeans)]
    parts.append(lib.loft('torso', P(0, 0, 0.92), P(0, 0, 1.5), [(0, .2 * S, .13 * S), (0.7, .24 * S, .14 * S), (1, .2 * S, .12 * S)], 10, shirt))
    parts.append(lib.tube('arm_l', [P(0.24, 0, 1.45), P(0.3, 0, 1.15), P(0.28, -0.05, 0.95)], 0.05 * S, 6, shirt))
    parts.append(lib.tube('arm_r', [P(-0.24, 0, 1.45), P(-0.42, 0, 1.62), P(-0.45, -0.02, 1.85)], 0.05 * S, 6, shirt))
    hd = lib.sphere('head', 1.0, P(0, 0, 1.64), 10, 8, skin, scale=(0.1 * S, 0.11 * S, 0.13 * S))
    parts += [hd, lib.cyl('brim', 0.24 * S, 0.02 * S, P(0, 0, 1.75), 16, hat), lib.cyl('crown', 0.11 * S, 0.14 * S, P(0, 0, 1.83), 12, hat)]
    for p in parts:
        lib.apply(p)
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

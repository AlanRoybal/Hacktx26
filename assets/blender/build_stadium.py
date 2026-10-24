"""Cotton Bowl at night: field, two-tier bowl, sideline wall, light towers, scoreboard, press box, light beams.
Field length runs along Blender Y (OKLAHOMA end zone at -Y, where Texas drives). blender -b --python assets/blender/build_stadium.py"""
import sys, os, math, json, subprocess
subprocess.run(['python3', os.path.join(os.path.dirname(__file__), 'make_pulse_textures.py')], check=True)
sys.path.insert(0, os.path.dirname(__file__))
import bpy, bmesh
import numpy as np
from mathutils import Vector
import lib

YD = 0.9144
FIELD_L, FIELD_W = 120 * YD, 53.333 * YD
AX, AY, N = 35.0, 72.0, 5.0     # inner edge of the stands (superellipse)
SAMPLES = 128


def bowl_path():
    pts = []
    for i in range(SAMPLES):
        t = 2 * math.pi * i / SAMPLES
        c, s = math.cos(t), math.sin(t)
        pts.append(Vector((AX * math.copysign(abs(c) ** (2 / N), c), AY * math.copysign(abs(s) ** (2 / N), s), 0)))
    nrm = []
    for i in range(SAMPLES):
        tan = (pts[(i + 1) % SAMPLES] - pts[i - 1]).normalized()
        nrm.append(Vector((tan.y, -tan.x, 0)))
    return pts, nrm


def profile():
    """(d outward, h) polyline of the stand cross-section, plus seat-row (d, h) list."""
    p, seats = [(0, 0), (0, 2.5)], []
    d, h = 0.0, 2.5
    for k in range(14):
        d += 2.0
        p.append((d, h))
        seats += [(d - 1.5, h), (d - 0.55, h)]
        h += 1.05
        p.append((d, h))
    d += 3.0
    p.append((d, h))
    h += 2.6
    p.append((d, h))
    for k in range(10):
        d += 1.9
        p.append((d, h))
        seats += [(d - 1.45, h), (d - 0.5, h)]
        h += 1.2
        p.append((d, h))
    p += [(d, h + 2.4), (d + 1.5, h + 2.4), (d + 1.5, 0)]
    return p, seats


def build_bowl(concrete):
    pts, nrm = bowl_path()
    prof, seats = profile()
    bm = bmesh.new()
    rings = [[bm.verts.new(pts[i] + nrm[i] * dd + Vector((0, 0, hh))) for dd, hh in prof] for i in range(SAMPLES)]
    for i in range(SAMPLES):
        a, b = rings[i], rings[(i + 1) % SAMPLES]
        for k in range(len(prof) - 1):
            bm.faces.new((a[k], b[k], b[k + 1], a[k + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib.new_obj('bowl', bm, concrete)
    lib.box_uv(ob, 3.0)
    return ob, pts, nrm, seats


def crowd_seats(pts, nrm, seats, spacing=0.7):
    """Seat positions (x, y, z, yaw, team). team 0 = Texas (y < 0 half), 1 = OU."""
    rng = np.random.default_rng(7)
    out = []
    for dd, hh in seats:
        ring = [pts[i] + nrm[i] * dd for i in range(SAMPLES)]
        for i in range(SAMPLES):
            a, b = ring[i], ring[(i + 1) % SAMPLES]
            n = max(1, int((b - a).length / spacing))
            for j in range(n):
                q = a.lerp(b, (j + rng.uniform(0.3, 0.7)) / n)
                yaw = math.atan2(-nrm[i].x, -nrm[i].y)
                out.append((round(q.x, 2), round(q.y, 2), round(hh, 2), round(yaw, 3), 0 if q.y < 0 else 1))
    return out


def build_field():
    subprocess.run([sys.executable if False else 'python3', os.path.join(os.path.dirname(__file__), 'make_field_texture.py')], check=True)
    img = bpy.data.images.load(os.path.join(lib.TEXTURES, 'field.png'))
    img.pack()
    fm = lib.mat('field', '#FFFFFF', rough=0.95, image=img)
    for n in fm.node_tree.nodes:
        if n.type == 'TEX_IMAGE':
            n.interpolation = 'Linear'
    field = lib.quad('field', (0, 0, 0.0), (0, -1, 0), (1, 0, 0), FIELD_L, FIELD_W, fm)
    apron = lib.box('apron', (2 * AX + 6, 2 * AY + 6, 0.1), (0, 0, -0.06), lib.mat('turf', '#2C5A2A', tex='grime_turf'))
    lib.box_uv(apron, 1.0)
    return [field, apron]


def build_wall():
    pad = lib.mat('wall_pad', '#1A2633', tex='grime')
    pts, nrm = bowl_path()
    bm = bmesh.new()
    prof = [(-0.4, 0), (-0.4, 1.4), (0, 1.4)]
    rings = [[bm.verts.new(pts[i] + nrm[i] * dd + Vector((0, 0, hh))) for dd, hh in prof] for i in range(SAMPLES)]
    for i in range(SAMPLES):
        a, b = rings[i], rings[(i + 1) % SAMPLES]
        for k in range(len(prof) - 1):
            bm.faces.new((a[k], b[k], b[k + 1], a[k + 1]))
    ob = lib.new_obj('sideline_wall', bm, pad)
    lib.box_uv(ob, 1.0)
    return ob


def build_tower(name, base, target):
    steel = lib.mat('steel', '#4A4C50', rough=0.6, metal=0.4, tex='grime')
    lamp = lib.mat('lamp', '#FFF3DC', rough=0.3, tex=None, emission='#FFF3DC', strength=60.0)
    show = lib.mat('lamp_show', '#FFF3DC', rough=0.3, tex=None, emission='#FFF3DC', strength=60.0)
    h = 58.0
    parts = [lib.cyl('pole', 0.9, h, (base[0], base[1], h / 2), 6, steel, r2=0.6)]
    yaw = math.atan2(target[1] - base[1], target[0] - base[0])
    head = Vector((base[0], base[1], h))
    right = Vector((-math.sin(yaw), math.cos(yaw), 0))
    fwd = Vector((math.cos(yaw), math.sin(yaw), 0))
    frame = lib.box('frame', (1.0, 16.0, 7.0), head + fwd * 0.6, steel, rot=(0, math.radians(-20), yaw))
    parts.append(frame)
    lamps = []
    for r in range(3):
        for c in range(6):
            off = right * (-6.25 + c * 2.5) + Vector((0, 0, -2.2 + r * 2.2))
            lp = lib.box('lamp', (0.4, 2.0, 1.7), head + fwd * 1.15 + off, show if c % 2 else lamp, rot=(0, math.radians(-20), yaw))
            lamps.append(lp)
    for p in parts + lamps:
        lib.apply(p)
    for p in parts:
        lib.box_uv(p, 2.0)
    tower = lib.join(parts, name)
    lamp_ob = lib.join(lamps, name + '_lamps')
    return tower, lamp_ob, head + fwd * 1.2


def build_beam(name, src, target, beam_mat, radius=16.0):
    d = Vector(target) - Vector(src)
    ob = lib.cyl(name, 1.5, d.length, (0, 0, 0), 8, beam_mat, r2=radius, cap=False)
    ob.location = Vector(src) + d / 2
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    lib.apply(ob)
    return ob


def build_scoreboard():
    """North end board (behind the Texas end zone)."""
    steel = lib.mat('steel', '#4A4C50', rough=0.6, metal=0.4, tex='grime')
    y = AY + 46
    parts = [lib.box('board_frame', (34, 2.0, 15), (0, y, 44), steel)]
    for x in (-12, 12):
        parts.append(lib.box('board_leg', (1.5, 1.5, 38), (x, y + 0.5, 19), steel))
    for p in parts:
        lib.apply(p)
        lib.box_uv(p, 2.0)
    board = lib.join(parts, 'scoreboard_north')
    scr = lib.quad('screen_north', (0, y - 1.05, 44), (1, 0, 0), (0, 0, 1), 32, 13,
                   lib.screen_mat('screen_north', lib.load_tex('jumbo_idle.png'), 2.0))
    return board, scr


JUMBO_Y, JUMBO_Z, JUMBO_W = -(AY + 44), 46.0, 48.0


def build_jumbotron():
    """Video board above the south (OU) end zone, facing the QB. `screen` has 0..1 UVs for a render-target texture
    (live broadcast cam / replays / MAKE SOME NOISE); `screen_ribbon` under it carries the score or pulse text."""
    steel = lib.mat('steel', '#4A4C50', rough=0.6, metal=0.4, tex='grime')
    H = JUMBO_W * 9 / 16
    y = JUMBO_Y
    parts = [lib.box('jumbo_frame', (JUMBO_W + 3, 2.6, H + 8), (0, y, JUMBO_Z - 1.5), steel),
             lib.box('jumbo_crown', (JUMBO_W * 0.55, 2.4, 3.2), (0, y, JUMBO_Z + H / 2 + 4.0), steel)]
    for x in (-16, 16):
        parts.append(lib.box('jumbo_leg', (2.0, 2.0, JUMBO_Z), (x, y - 1.0, JUMBO_Z / 2 - 2), steel))
    for p in parts:
        lib.apply(p)
        lib.box_uv(p, 2.0)
    board = lib.join(parts, 'jumbotron')
    scr = lib.quad('screen', (0, y + 1.32, JUMBO_Z), (-1, 0, 0), (0, 0, 1), JUMBO_W, H,
                   lib.screen_mat('screen', lib.load_tex('jumbo_idle.png'), 5.0))
    rib = lib.quad('screen_ribbon', (0, y + 1.32, JUMBO_Z - H / 2 - 2.4), (-1, 0, 0), (0, 0, 1), JUMBO_W, 3.0,
                   lib.screen_mat('ribbon_jumbo', lib.load_tex('ribbon_calm.png'), 4.0))
    return board, scr, rib


def build_ribbon(pts, nrm, d=30.96, z0=17.5, z1=19.5, tile=32.0):
    """LED ribbon on the upper-deck fascia, all the way around the bowl. u repeats every `tile` m."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    ring = [pts[i] + nrm[i] * d for i in range(SAMPLES)]
    u = 0.0
    for i in range(SAMPLES):
        a, b = ring[i], ring[(i + 1) % SAMPLES]
        L = (b - a).length
        vs = [bm.verts.new(a + Vector((0, 0, z0))), bm.verts.new(b + Vector((0, 0, z0))),
              bm.verts.new(b + Vector((0, 0, z1))), bm.verts.new(a + Vector((0, 0, z1)))]
        f = bm.faces.new(vs)
        for loop, uv in zip(f.loops, [(-u, 0), (-u - L / tile, 0), (-u - L / tile, 1), (-u, 1)]):
            loop[uvl].uv = uv
        u += L / tile
    m = lib.screen_mat('ribbon', lib.load_tex('ribbon_calm.png'), 3.0)
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE':
            n.extension = 'REPEAT'
    ob = lib.new_obj('ribbon', bm, m)
    for poly in ob.data.polygons:
        c = poly.center
        if poly.normal.dot(Vector((c.x, c.y, 0))) > 0:
            poly.flip()
    return ob


def build_pressbox():
    con = lib.mat('concrete', '#8E8A82', tex='grime')
    glass = lib.mat('pressbox_glass', '#E8C88A', rough=0.2, tex=None, emission='#E8B060', strength=4.0)
    x = AX + 52
    box = lib.box('pressbox', (7, 70, 8), (x, 0, 37), con)
    lib.apply(box)
    lib.box_uv(box, 2.0)
    win = lib.quad('pressbox_windows', (x - 3.52, 0, 37.5), (0, -1, 0), (0, 0, 1), 66, 3.0, glass)
    return box, win


def build(beams=True):
    concrete = lib.mat('concrete', '#8E8A82', tex='grime')
    bowl, pts, nrm, seats = build_bowl(concrete)
    objs = [bowl, build_wall()] + build_field()
    lights = []
    beam_mat = lib.mat('beam', '#FFF1D6', tex=None, emission='#FFF1D6', strength=0.0)
    for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
        base = (sx * (AX + 62), sy * (AY + 30))
        tgt = (sx * 8, sy * 25, 0)
        t, l, head = build_tower(f'tower_{i}', base, tgt)
        objs += [t, l]
        lights.append((head, tgt))
        if beams:
            objs.append(build_beam(f'beam_{i}', head, tgt, beam_mat))
    objs += list(build_scoreboard()) + list(build_jumbotron()) + list(build_pressbox()) + [build_ribbon(pts, nrm)]
    seat_data = crowd_seats(pts, nrm, seats)
    return objs, lights, seat_data


if __name__ == '__main__':
    lib.reset()
    objs, lights, seat_data = build()
    print('STADIUM_TRIS', lib.tri_count(objs), 'SEATS', len(seat_data))
    with open(os.path.join(lib.MODELS, 'crowd_seats.json'), 'w') as f:
        json.dump({'fields': ['x', 'y', 'z', 'yaw', 'team'], 'axes': 'blender (z up, field length on y)',
                   'seats': seat_data, 'lights': [[list(h), list(t)] for h, t in lights]}, f, separators=(',', ':'))
    lib.export('stadium', selection=objs)
    lib.save('stadium')

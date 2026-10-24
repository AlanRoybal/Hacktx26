"""Low-poly segmented football player, rigid-bound to an 18-bone rig, with scripted actions.
blender -b --python assets/blender/build_player.py [-- --no-render]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix, Euler
import lib

TEXAS = dict(jersey='#BF5700', pants='#EDEAE2', helmet='#EEEDE8', facemask='#E9E7E0', socks='#EDEAE2',
             gloves='#E4E2DC', shoes='#141414', skin='#8A5A3C', numbers='#FFFFFF', number='16', logo='texas')
OU = dict(jersey='#EDEAE2', pants='#E8DFC0', helmet='#841617', facemask='#EDEAE2', socks='#841617',
          gloves='#841617', shoes='#141414', skin='#C08A64', numbers='#841617', number='3', logo='ou')

BONES = [  # name, head, tail, parent
    ('hips', (0, 0, 0.98), (0, 0, 1.10), None),
    ('spine', (0, 0, 1.10), (0, 0, 1.30), 'hips'),
    ('chest', (0, 0, 1.30), (0, 0, 1.52), 'spine'),
    ('neck', (0, 0, 1.52), (0, 0, 1.62), 'chest'),
    ('head', (0, 0, 1.62), (0, 0, 1.88), 'neck'),
]
for s, x in (('L', 1), ('R', -1)):
    BONES += [
        (f'upperarm_{s}', (0.27 * x, 0, 1.47), (0.31 * x, 0, 1.17), 'chest'),
        (f'forearm_{s}', (0.31 * x, 0, 1.17), (0.33 * x, -0.02, 0.93), f'upperarm_{s}'),
        (f'hand_{s}', (0.33 * x, -0.02, 0.93), (0.34 * x, -0.03, 0.81), f'forearm_{s}'),
        (f'thigh_{s}', (0.11 * x, 0, 0.96), (0.12 * x, 0, 0.52), 'hips'),
        (f'shin_{s}', (0.12 * x, 0, 0.52), (0.12 * x, 0.02, 0.10), f'thigh_{s}'),
        (f'foot_{s}', (0.12 * x, 0.02, 0.10), (0.12 * x, -0.14, 0.04), f'shin_{s}'),
    ]

def team_image(fname):
    img = bpy.data.images.get(fname) or bpy.data.images.load(os.path.join(lib.TEXTURES, fname))
    img.pack()
    return img


def materials(c, sfx=''):
    M = {k: lib.mat(k + sfx, c[k], tex='grime') for k in ('jersey', 'pants', 'helmet', 'socks', 'gloves', 'shoes')}
    M['facemask'] = lib.mat('facemask' + sfx, c['facemask'], rough=0.5, tex=None)
    M['skin'] = lib.mat('skin' + sfx, c['skin'], rough=0.7, tex='grime_skin')
    M['tape'] = lib.mat('tape', '#E6E2D8', tex='grime')
    M['sole'] = lib.mat('sole', '#0E0E0E', tex=None)
    M['numbers'] = lib.mat('numbers' + sfx, c['numbers'], image=team_image('numbers_atlas.png'), alpha_clip=True)
    M['name_plate'] = lib.mat('name_plate' + sfx, c['numbers'], image=team_image('numbers_atlas.png'), alpha_clip=True)
    M['helmet_logo'] = lib.mat('helmet_logo' + sfx, '#FFFFFF', image=team_image(f"logo_{c['logo']}_hd.png"), alpha_clip=True)
    return M


TORSO = [(1.00, .165, .118), (1.12, .175, .122), (1.24, .195, .13), (1.36, .228, .142), (1.46, .255, .15), (1.53, .235, .14)]


def torso_r(z):
    for (z0, a0, b0), (z1, a1, b1) in zip(TORSO, TORSO[1:]):
        if z <= z1:
            s = max(0.0, (z - z0) / (z1 - z0))
            return a0 + (a1 - a0) * s, b0 + (b1 - b0) * s
    return TORSO[-1][1:]


def ramp(x, x0, x1, a, b):
    s = min(1.0, max(0.0, (x - x0) / (x1 - x0)))
    return {a: 1 - s, b: s} if 0 < s < 1 else {(a if s <= 0 else b): 1.0}


def torso_w(_i, co):
    z = co.z
    if z < 1.16:
        return ramp(z, 1.07, 1.16, 'hips', 'spine')
    return ramp(z, 1.25, 1.34, 'spine', 'chest')


def limb_w(ob, bone, parent=None, child=None, t0=0.15, t1=0.85):
    ts, segs = list(ob['ring_t']), ob['segs']
    n = len(ts) * segs

    def fn(i, _co):
        t = ts[min(i // segs, len(ts) - 1)] if i < n else ts[-1]
        if parent and t < t0:
            s = 0.5 + 0.5 * t / t0
            return {bone: s, parent: 1 - s}
        if child and t > t1:
            s = 0.5 * (t - t1) / (1 - t1)
            return {bone: 1 - s, child: s}
        return {bone: 1.0}
    lib.weights(ob, fn)
    return ob


def decal(name, zc, w, h, number, back, material, box=None, out=0.006):
    """Number decal that follows the torso ellipse. UVs pick the number's cell in the 10x10 atlas."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    col, row = number % 10, number // 10
    u0, u1, v0, v1 = col / 10, (col + 1) / 10, 1 - (row + 1) / 10, 1 - row / 10
    if box:
        u0, u1, v0, v1 = box
    cols, rows = 6, 2
    grid = []
    for r in range(rows + 1):
        z = zc - h / 2 + h * r / rows
        rx, ry = torso_r(z)
        line = []
        for c in range(cols + 1):
            x = -w / 2 + w * c / cols
            y = (ry * math.sqrt(max(0.0, 1 - (x / rx) ** 2)) + out) * (1 if back else -1)
            line.append((bm.verts.new((-x if back else x, y, z)), (c / cols, r / rows)))
        grid.append(line)
    for r in range(rows):
        for c in range(cols):
            q = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]]
            f = bm.faces.new([v for v, _ in q])
            for loop, (_, (s, t)) in zip(f.loops, q):
                loop[uvl].uv = (u0 + (u1 - u0) * s, v0 + (v1 - v0) * t)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = lib.new_obj(name, bm, material)
    return lib.smooth(ob)


def build_body(M, number, sfx=''):
    parts = []
    B = {b[0]: b for b in BONES}

    def add(ob, fn=None, bone=None, uv=0.5):
        if uv:
            lib.box_uv(ob, uv)
        if fn:
            lib.weights(ob, fn)
        elif bone:
            lib.weights(ob, lambda i, co: {bone: 1.0})
        parts.append(ob)
        return ob

    pants = [(0.0, .158, .118), (0.35, .172, .125), (0.75, .17, .12), (1.0, .166, .118)]
    add(lib.loft('pelvis', (0, 0, 0.86), (0, 0, 1.08), pants, 14, M['pants']), torso_w)
    add(lib.loft('belt', (0, 0, 1.02), (0, 0, 1.05), [(0, .169, .121), (1, .169, .121)], 14, M['sole']), torso_w)
    jt = [((z - 1.0) / 0.53, a, b) for z, a, b in TORSO]
    add(lib.loft('torso', (0, 0, 1.0), (0, 0, 1.53), jt, 14, M['jersey']), torso_w)
    pads = lib.sphere('pads', 1.0, (0, 0.005, 1.465), 20, 10, M['jersey'], scale=(0.325, 0.19, 0.105))
    lib.apply(pads)
    add(lib.smooth(pads), bone='chest')
    for s, x in (('L', 1), ('R', -1)):
        ep = lib.sphere(f'epaulet_{s}', 1.0, (0.255 * x, 0.0, 1.505), 12, 7, M['jersey'], scale=(0.115, 0.15, 0.07))
        lib.apply(ep)
        add(lib.smooth(ep), bone='chest')
        _, sh, el, _ = B[f'upperarm_{s}']
        _, _, wr, _ = B[f'forearm_{s}']
        _, _, ht, _ = B[f'hand_{s}']
        sl = lib.loft(f'sleeve_{s}', sh, el, [(0.0, .095, .1), (0.25, .092, .095), (0.42, .082, .085)], 10, M['jersey'])
        add(limb_w(sl, f'upperarm_{s}'))
        ua = lib.loft(f'upperarm_{s}', sh, el, [(0.0, .07, .075), (0.5, .07, .073), (0.9, .058, .06), (1.0, .055, .057)], 10, M['skin'])
        add(limb_w(ua, f'upperarm_{s}', child=f'forearm_{s}'))
        fa = lib.loft(f'forearm_{s}', el, wr, [(0.0, .055, .057), (0.3, .058, .062), (0.8, .043, .04), (1.0, .038, .035)], 10, M['skin'])
        add(limb_w(fa, f'forearm_{s}', parent=f'upperarm_{s}'))
        tp = lib.loft(f'tape_{s}', el, wr, [(0.78, .047, .045), (1.0, .042, .04)], 10, M['tape'])
        add(limb_w(tp, f'forearm_{s}'))
        hd = lib.loft(f'glove_{s}', wr, ht, [(0.0, .03, .04), (0.45, .028, .05), (0.8, .022, .046), (1.0, .015, .03)], 8, M['gloves'])
        add(limb_w(hd, f'hand_{s}'))
        th = Vector(wr) + Vector((-0.012 * x, -0.035, -0.03))
        tb = lib.loft(f'thumb_{s}', th, th + Vector((-0.01 * x, -0.025, -0.055)), [(0, .014, .014), (1, .01, .01)], 6, M['gloves'])
        add(limb_w(tb, f'hand_{s}'))
        _, hp, kn, _ = B[f'thigh_{s}']
        _, _, an, _ = B[f'shin_{s}']
        tg = lib.loft(f'thigh_{s}', hp, kn, [(0.0, .1, .11), (0.3, .097, .108), (0.75, .076, .082), (1.0, .066, .07)], 10, M['pants'])
        add(limb_w(tg, f'thigh_{s}', parent='hips', child=f'shin_{s}', t0=0.12, t1=0.9))
        kp = lib.loft(f'kneepad_{s}', hp, kn, [(0.84, .068, .074, 0, 0.012), (0.98, .07, .078, 0, 0.016), (1.08, .064, .07, 0, 0.012)], 10, M['pants'])
        add(limb_w(kp, f'thigh_{s}', child=f'shin_{s}', t1=0.95))
        sp = lib.loft(f'shin_pants_{s}', kn, an, [(0.0, .066, .07), (0.17, .061, .066)], 10, M['pants'])
        add(limb_w(sp, f'shin_{s}', parent=f'thigh_{s}', t0=0.1))
        sk = lib.loft(f'sock_{s}', kn, an, [(0.12, .058, .062), (0.42, .058, .07, 0, -0.012), (0.8, .042, .045), (1.0, .036, .04)], 10, M['socks'])
        add(limb_w(sk, f'shin_{s}'))
        hx = 0.12 * x
        cl = lib.loft(f'cleat_{s}', (hx, 0.075, 0.07), (hx, -0.175, 0.045),
                      [(0.0, .038, .04), (0.2, .048, .055), (0.55, .05, .042), (0.85, .045, .03), (1.0, .03, .018)], 10, M['shoes'], side=(1, 0, 0))
        add(cl, bone=f'foot_{s}')
        so = lib.box(f'sole_{s}', (0.1, 0.25, 0.018), (hx, -0.05, 0.012), M['sole'])
        lib.apply(so)
        add(so, bone=f'foot_{s}')
    nk = lib.loft('neck', (0, 0, 1.47), (0, 0, 1.66), [(0, .068, .07), (1, .06, .062)], 10, M['skin'])
    add(nk, lambda i, co: ramp(co.z, 1.58, 1.66, 'neck', 'head'))
    hdm = lib.sphere('head', 1.0, (0, -0.005, 1.735), 12, 8, M['skin'], scale=(0.095, 0.105, 0.115))
    lib.apply(hdm)
    add(lib.smooth(hdm), bone='head')
    add(decal('num_front', 1.33, 0.2, 0.19, number, False, M['numbers']), bone='chest', uv=0)
    add(decal('num_back', 1.31, 0.24, 0.23, number, True, M['numbers']), bone='chest', uv=0)
    # nameplate above the back number; game code draws the surname into this material per player
    add(decal('num_name', 1.45, 0.3, 0.06, number, True, M['name_plate'], box=(0, 1, 0, 1), out=0.03), bone='chest', uv=0)
    return parts


def build_helmet(M, sfx=''):
    shell = lib.sphere('helmet' + sfx, 1.0, (0, 0.012, 1.752), 20, 12, M['helmet'], scale=(0.148, 0.168, 0.152))
    lib.apply(shell)
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    kill = [f for f in bm.faces if (lambda c: (c.y < -0.05 and c.z < 1.775 and abs(c.x) < 0.108) or c.z < 1.63)(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(shell.data)
    bm.free()
    lib.box_uv(shell, 0.5)
    lib.smooth(shell)
    r = 0.0085
    bars = [lib.tube('bar', [(-0.13, -0.07, 1.735), (-0.10, -0.145, 1.718), (0, -0.178, 1.712), (0.10, -0.145, 1.718), (0.13, -0.07, 1.735)], r, 6, M['facemask']),
            lib.tube('bar', [(-0.12, -0.08, 1.68), (-0.085, -0.155, 1.655), (0, -0.183, 1.642), (0.085, -0.155, 1.655), (0.12, -0.08, 1.68)], r, 6, M['facemask']),
            lib.tube('bar', [(-0.10, -0.15, 1.778), (0, -0.168, 1.778), (0.10, -0.15, 1.778)], r, 6, M['facemask']),
            lib.tube('bar', [(0, -0.17, 1.778), (0, -0.178, 1.712), (0, -0.183, 1.642)], r, 6, M['facemask'])]
    for x in (1, -1):
        bars.append(lib.tube('bar', [(0.075 * x, -0.155, 1.776), (0.075 * x, -0.16, 1.716), (0.068 * x, -0.168, 1.65)], r, 6, M['facemask']))
    mask = lib.join(bars, 'facemask' + sfx)
    strap = lib.tube('chinstrap', [(-0.125, -0.07, 1.665), (-0.06, -0.13, 1.61), (0, -0.14, 1.6), (0.06, -0.13, 1.61), (0.125, -0.07, 1.665)], 0.011, 6, M['tape'])
    mask = lib.join([mask, strap], 'facemask' + sfx)
    logos = [lib.quad('logo_L', (0.151, 0.02, 1.755), (0, 1, 0), (0, 0, 1), 0.13, 0.065, M['helmet_logo']),
             lib.quad('logo_R', (-0.151, 0.02, 1.755), (0, -1, 0), (0, 0, 1), 0.13, 0.065, M['helmet_logo'])]
    logo = lib.join(logos, 'helmet_logo' + sfx)
    return [shell, mask, logo]


def build_rig(sfx=''):
    arm = bpy.data.armatures.new('rig' + sfx)
    rig = bpy.data.objects.new('rig' + sfx, arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, h, t, parent in BONES:
        b = arm.edit_bones.new(name)
        b.head, b.tail = h, t
        b.roll = 0
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        eb[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def bind(meshes, rig):
    for m in meshes:
        m.parent = rig
        mod = m.modifiers.new('rig', 'ARMATURE')
        mod.object = rig


# ---------- animation ----------
# Rotations are armature-space Euler degrees about each bone's head, applied in the parent's frame.
# X: +X leans up-pointing bones forward and swings down-pointing bones backward.
def set_pose(rig, pose):
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for name, val in pose.items():
        if name == 'loc':
            pb = rig.pose.bones['hips']
            B = pb.bone.matrix_local.to_3x3()
            pb.location = B.inverted() @ Vector(val)
            continue
        pb = rig.pose.bones[name]
        B = pb.bone.matrix_local.to_3x3()
        R = Euler([math.radians(a) for a in val], 'XYZ').to_matrix()
        pb.rotation_quaternion = (B.inverted() @ R @ B).to_quaternion()


def key_all(rig, frame):
    for pb in rig.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        if pb.name == 'hips':
            pb.keyframe_insert('location', frame=frame)


def mirror(pose):
    out = {}
    for k, v in pose.items():
        if k == 'loc':
            out[k] = (-v[0], v[1], v[2])
            continue
        n = k.replace('_L', '_X').replace('_R', '_L').replace('_X', '_R')
        out[n] = (v[0], -v[1], -v[2])
    return out


ARMS_RUN = lambda a: {'upperarm_L': (a, 0, 0), 'upperarm_R': (-a, 0, 0), 'forearm_L': (-75, 0, 0), 'forearm_R': (-75, 0, 0)}


def run_pose(t):
    """t in [0,1): one full stride."""
    ph = 2 * math.pi * t
    thighL = -38 * math.cos(ph) + 2
    thighR = 38 * math.cos(ph) + 2
    shinL = 20 + 55 * max(0, math.sin(ph))
    shinR = 20 + 55 * max(0, -math.sin(ph))
    p = {'thigh_L': (thighL, 0, 0), 'thigh_R': (thighR, 0, 0), 'shin_L': (shinL, 0, 0), 'shin_R': (shinR, 0, 0),
         'foot_L': (-10, 0, 0), 'foot_R': (-10, 0, 0),
         'spine': (12, 0, 0), 'chest': (4, 0, 0), 'neck': (-10, 0, 0),
         'hips': (0, 0, 7 * math.cos(ph)), 'loc': (0, 0, 0.035 * abs(math.sin(ph)) - 0.03)}
    p.update(ARMS_RUN(-40 * math.cos(ph)))
    return p


CROUCH = {'loc': (0, 0, -0.22), 'thigh_L': (-50, 0, -6), 'thigh_R': (-50, 0, 6), 'shin_L': (70, 0, 0), 'shin_R': (70, 0, 0),
          'foot_L': (-20, 0, 0), 'foot_R': (-20, 0, 0), 'spine': (25, 0, 0), 'chest': (10, 0, 0), 'neck': (-25, 0, 0)}


def P(*dicts):
    out = {}
    for d in dicts:
        out.update(d)
    return out


def actions():
    A = {}
    A['Idle'] = (True, {0: {'chest': (0, 0, 0), 'upperarm_L': (0, -4, 0), 'upperarm_R': (0, 4, 0), 'forearm_L': (-10, 0, 0), 'forearm_R': (-10, 0, 0)},
                        30: {'chest': (-2, 0, 0), 'neck': (2, 0, 0), 'upperarm_L': (0, -6, 0), 'upperarm_R': (0, 6, 0), 'forearm_L': (-14, 0, 0), 'forearm_R': (-14, 0, 0), 'loc': (0, 0, 0.005)}})
    A['Idle'][1][60] = A['Idle'][1][0]
    stance = {'loc': (0, 0, -0.42), 'thigh_L': (-95, 0, -10), 'thigh_R': (-75, 0, 10), 'shin_L': (115, 0, 0), 'shin_R': (110, 0, 0),
              'foot_L': (-30, 0, 0), 'foot_R': (-30, 0, 0), 'spine': (55, 0, 0), 'chest': (15, 0, 0), 'neck': (-55, 0, 0), 'head': (-10, 0, 0),
              'upperarm_R': (-75, 0, 0), 'forearm_R': (0, 0, 0), 'upperarm_L': (-35, -10, 0), 'forearm_L': (-60, 0, 0)}
    A['Stance3pt'] = (True, {0: stance, 15: P(stance, {'spine': (56, 0, 0), 'loc': (0, 0, -0.415)}), 30: stance})
    A['Run'] = (True, {f: run_pose(f / 18) for f in (0, 3, 6, 9, 12, 15, 18)})
    bp = lambda t: P(CROUCH, {'loc': (0, 0, -0.12), 'spine': (18, 0, 0), 'neck': (-15, 0, 0),
                              'thigh_L': (-30 + 25 * math.cos(t), 0, -6), 'thigh_R': (-30 - 25 * math.cos(t), 0, 6),
                              'shin_L': (45 + 20 * math.sin(t), 0, 0), 'shin_R': (45 - 20 * math.sin(t), 0, 0),
                              'upperarm_L': (-20, -15, 0), 'upperarm_R': (-20, 15, 0), 'forearm_L': (-60, 0, 0), 'forearm_R': (-60, 0, 0)})
    A['Backpedal'] = (True, {f: bp(2 * math.pi * f / 20) for f in (0, 5, 10, 15, 20)})
    block = P(CROUCH, {'upperarm_L': (-75, 10, 0), 'upperarm_R': (-75, -10, 0), 'forearm_L': (-45, 0, 0), 'forearm_R': (-45, 0, 0)})
    A['Block'] = (True, {0: block, 15: P(block, {'upperarm_L': (-85, 10, 0), 'upperarm_R': (-85, -10, 0), 'forearm_L': (-20, 0, 0), 'forearm_R': (-20, 0, 0), 'spine': (30, 0, 0)}), 30: block})
    rush = lambda t: P(CROUCH, {'loc': (0, 0, -0.18), 'spine': (40, 0, 0), 'neck': (-40, 0, 0),
                                'thigh_L': (-55 + 30 * math.cos(t), 0, 0), 'thigh_R': (-55 - 30 * math.cos(t), 0, 0),
                                'shin_L': (60 + 25 * math.sin(t), 0, 0), 'shin_R': (60 - 25 * math.sin(t), 0, 0),
                                'upperarm_L': (-80 - 20 * math.sin(t), 5, 0), 'upperarm_R': (-80 + 20 * math.sin(t), -5, 0),
                                'forearm_L': (-30, 0, 0), 'forearm_R': (-30, 0, 0)})
    A['Rush'] = (True, {f: rush(2 * math.pi * f / 20) for f in (0, 5, 10, 15, 20)})
    reach = {'upperarm_L': (-165, -10, 0), 'upperarm_R': (-165, 10, 0), 'forearm_L': (-15, 0, 0), 'forearm_R': (-15, 0, 0), 'neck': (-25, 0, 0), 'head': (-15, 0, 0), 'spine': (-5, 0, 0)}
    tuck = {'upperarm_L': (-35, 0, -20), 'upperarm_R': (-35, 0, 20), 'forearm_L': (-110, 0, 0), 'forearm_R': (-110, 0, 0), 'spine': (10, 0, 0)}
    A['CatchHigh'] = (False, {0: run_pose(0), 6: P(run_pose(0.3), reach), 12: P(run_pose(0.6), reach), 20: P(run_pose(0.9), tuck)})
    dive_air = {'hips': (75, 0, 0), 'loc': (0, -0.5, -0.2), 'upperarm_L': (-170, -8, 0), 'upperarm_R': (-170, 8, 0), 'forearm_L': (-5, 0, 0), 'forearm_R': (-5, 0, 0),
                'thigh_L': (10, 0, 0), 'thigh_R': (25, 0, 0), 'shin_L': (30, 0, 0), 'shin_R': (50, 0, 0), 'neck': (-40, 0, 0)}
    A['Dive'] = (False, {0: run_pose(0), 6: P(CROUCH, {'spine': (35, 0, 0), 'upperarm_L': (-120, 0, 0), 'upperarm_R': (-120, 0, 0)}),
                         14: dive_air, 24: P(dive_air, {'hips': (90, 0, 0), 'loc': (0, -1.0, -0.78), 'neck': (-60, 0, 0)})})
    wrap = {'upperarm_L': (-80, 0, 35), 'upperarm_R': (-80, 0, -35), 'forearm_L': (-40, 0, 40), 'forearm_R': (-40, 0, -40)}
    A['Tackle'] = (False, {0: run_pose(0.25), 8: P(CROUCH, {'spine': (45, 0, 0), 'loc': (0, -0.2, -0.25)}, wrap),
                           16: P({'hips': (55, 0, 0), 'loc': (0, -0.6, -0.45), 'neck': (-40, 0, 0), 'thigh_L': (20, 0, 0), 'thigh_R': (35, 0, 0), 'shin_L': (40, 0, 0), 'shin_R': (60, 0, 0)}, wrap),
                           24: P({'hips': (85, 0, 0), 'loc': (0, -0.9, -0.8), 'neck': (-50, 0, 0), 'thigh_L': (10, 0, 0), 'thigh_R': (20, 0, 0), 'shin_L': (20, 0, 0), 'shin_R': (40, 0, 0)}, wrap)})
    A['Fall'] = (False, {0: run_pose(0.5), 8: {'hips': (-30, 0, 10), 'loc': (0, 0.1, -0.2), 'upperarm_L': (-60, -40, 0), 'upperarm_R': (-90, 40, 0), 'thigh_L': (-40, 0, 0), 'thigh_R': (-20, 0, 0), 'shin_L': (40, 0, 0)},
                         18: {'hips': (-75, 0, 15), 'loc': (0, 0.5, -0.75), 'upperarm_L': (-30, -70, 0), 'upperarm_R': (-120, 60, 0), 'thigh_L': (-50, 0, 0), 'thigh_R': (-10, 0, 0), 'shin_L': (60, 0, 0), 'neck': (20, 0, 0)},
                         30: {'hips': (-90, 0, 15), 'loc': (0, 0.6, -0.84), 'upperarm_L': (-20, -60, 0), 'upperarm_R': (-60, 70, 0), 'thigh_L': (-35, 0, 0), 'thigh_R': (-5, 0, 0), 'shin_L': (50, 0, 0), 'neck': (25, 0, 0)}})
    horns = {'upperarm_R': (-170, 8, 0), 'forearm_R': (-10, 0, 0), 'hand_R': (0, 0, 0), 'upperarm_L': (-40, -50, 0), 'forearm_L': (-90, 0, 0), 'neck': (-20, 0, 0), 'spine': (-8, 0, 0)}
    A['Celebrate'] = (True, {0: P(horns, {'loc': (0, 0, -0.08), 'thigh_L': (-20, 0, 0), 'thigh_R': (-20, 0, 0), 'shin_L': (35, 0, 0), 'shin_R': (35, 0, 0)}),
                             15: P(horns, {'loc': (0, 0, 0.18), 'foot_L': (30, 0, 0), 'foot_R': (30, 0, 0), 'upperarm_L': (-150, -30, 0)}),
                             30: P(horns, {'loc': (0, 0, -0.08), 'thigh_L': (-20, 0, 0), 'thigh_R': (-20, 0, 0), 'shin_L': (35, 0, 0), 'shin_R': (35, 0, 0)}),
                             45: P(horns, {'loc': (0, 0, 0.18), 'foot_L': (30, 0, 0), 'foot_R': (30, 0, 0), 'upperarm_L': (-150, -30, 0)})})
    A['Celebrate'][1][60] = A['Celebrate'][1][0]
    hd = {'upperarm_R': (-50, 15, 0), 'forearm_R': (-10, 0, 0), 'hand_R': (0, 0, 0), 'spine': (15, 0, -15), 'neck': (-10, 0, 0),
          'thigh_L': (-25, 0, 0), 'shin_L': (30, 0, 0), 'upperarm_L': (-20, -20, 0), 'forearm_L': (-60, 0, 0)}
    A['HornsDown'] = (False, {0: {}, 12: hd, 28: P(hd, {'upperarm_R': (-40, 15, 0), 'spine': (20, 0, -20)}), 40: hd})
    # sack celebrations
    flex = {'spine': (-12, 0, 0), 'neck': (-15, 0, 0), 'upperarm_L': (-90, -55, 0), 'forearm_L': (-120, 0, 0),
            'upperarm_R': (-90, 55, 0), 'forearm_R': (-120, 0, 0), 'thigh_L': (-15, 0, -8), 'thigh_R': (-15, 0, 8),
            'shin_L': (25, 0, 0), 'shin_R': (25, 0, 0), 'loc': (0, 0, -0.06)}
    A['Flex'] = (True, {0: flex, 20: P(flex, {'spine': (-20, 0, 0), 'neck': (-25, 0, 0), 'forearm_L': (-138, 0, 0), 'forearm_R': (-138, 0, 0),
                                              'upperarm_L': (-100, -62, 0), 'upperarm_R': (-100, 62, 0), 'loc': (0, 0, -0.11)}), 40: flex})
    crouch = {'loc': (0, 0, -0.22), 'thigh_L': (-50, 0, 0), 'thigh_R': (-50, 0, 0), 'shin_L': (80, 0, 0), 'shin_R': (80, 0, 0),
              'foot_L': (-20, 0, 0), 'foot_R': (-20, 0, 0), 'spine': (28, 0, 0), 'upperarm_L': (-30, -10, 0), 'upperarm_R': (-30, 10, 0), 'forearm_L': (-40, 0, 0), 'forearm_R': (-40, 0, 0)}
    air = {'loc': (0, -0.12, 0.42), 'spine': (-22, 0, 0), 'chest': (-10, 0, 0), 'neck': (-20, 0, 0), 'upperarm_L': (-150, -35, 0), 'upperarm_R': (-150, 35, 0),
           'forearm_L': (-20, 0, 0), 'forearm_R': (-20, 0, 0), 'thigh_L': (-15, 0, 0), 'thigh_R': (-25, 0, 0), 'shin_L': (30, 0, 0), 'shin_R': (45, 0, 0), 'foot_L': (35, 0, 0), 'foot_R': (35, 0, 0)}
    A['ChestBump'] = (False, {0: {}, 8: crouch, 15: air, 20: P(air, {'loc': (0, -0.2, 0.3)}), 27: crouch, 36: P(horns, {})})
    sd = lambda m: {'upperarm_L': (-60 if m > 0 else -150, -40 if m > 0 else -20, 0), 'upperarm_R': (-150 if m > 0 else -60, 20 if m > 0 else 40, 0),
                    'forearm_L': (-30, 0, 0), 'forearm_R': (-30, 0, 0), 'spine': (8, 0, 18 * m), 'chest': (0, 0, 10 * m), 'hips': (0, 0, 12 * m),
                    'thigh_L': (-35 if m > 0 else -5, 0, 0), 'shin_L': (50 if m > 0 else 10, 0, 0), 'thigh_R': (-5 if m > 0 else -35, 0, 0),
                    'shin_R': (10 if m > 0 else 50, 0, 0), 'loc': (0, 0, -0.05), 'neck': (-10, 0, -12 * m)}
    A['SackDance'] = (True, {0: sd(1), 12: sd(-1), 24: sd(1)})
    return A


def make_actions(rig, sfx=''):
    rig.animation_data_create()
    made = {}
    for name, (loop, keys) in actions().items():
        act = bpy.data.actions.new(name + sfx)
        act.use_fake_user = True
        rig.animation_data.action = act
        for f in sorted(keys):
            set_pose(rig, keys[f])
            key_all(rig, f)
        if not loop:
            for fc in act.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = 'BEZIER'
        made[name] = act
        tr = rig.animation_data.nla_tracks.new()
        tr.name = name + sfx
        tr.strips.new(name + sfx, int(min(keys)), act)
        tr.mute = True
    rig.animation_data.action = made['Idle']
    return made


def build_player(colors, sfx='', offset=(0, 0, 0)):
    M = materials(colors, sfx)
    parts = build_body(M, int(colors['number']), sfx)
    for p in parts:
        if not p.name.startswith('num_'):
            lib.subdivide(p, 1)
    body = lib.join(parts, 'body' + sfx)
    helm = build_helmet(M, sfx)
    for h in helm:
        h.vertex_groups.new(name='head').add(list(range(len(h.data.vertices))), 1.0, 'REPLACE')
    rig = build_rig(sfx)
    bind([body] + helm, rig)
    root = bpy.data.objects.new('player' + sfx, None)
    bpy.context.scene.collection.objects.link(root)
    rig.parent = root
    root.location = offset
    acts = make_actions(rig, sfx)
    return root, rig, [body] + helm, acts


def pose_at(rig, act, f):
    """Pose a rig from an action at frame f without touching scene time (lets two rigs show different frames)."""
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        for path, n in (('rotation_quaternion', 4), ('location', 3)):
            vals = list(getattr(pb, path))
            for k in range(n):
                fc = act.fcurves.find(f'pose.bones["{pb.name}"].{path}', index=k)
                if fc:
                    vals[k] = fc.evaluate(f)
            setattr(pb, path, vals)


def render_previews(main_rig, main_meshes):
    ou_root, ou_rig, ou_meshes, ou_acts = build_player(OU, '_ou', offset=(1.1, 0.3, 0))
    sc = bpy.context.scene
    cam = lib.preview_scene(target=(0.55, 0, 0.95), dist=4.2, height=1.3)
    shots = [('Idle', 'Stance3pt', 0, 0, 25), ('Run', 'Rush', 4, 6, 25), ('Celebrate', 'Tackle', 15, 14, 300),
             ('Idle', 'HornsDown', 0, 30, 160)]
    paths = []
    for i, (a1, a2, f1, f2, ang) in enumerate(shots):
        pose_at(main_rig, bpy.data.actions[a1], f1)
        pose_at(ou_rig, bpy.data.actions[a2 + '_ou'], f2)
        r = math.radians(ang)
        t = Vector((0.55, 0.15, 0.85))
        cam.location = (t.x - math.sin(r) * 4.6, t.y - math.cos(r) * 4.6, 1.75)
        lib.look_at(cam, t)
        p = os.path.join(lib.RENDERS, 'raw', f'player_{i}.png')
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths


if __name__ == '__main__':
    lib.reset()
    root, rig, meshes, acts = build_player(TEXAS)
    print('PLAYER_TRIS', lib.tri_count(meshes))
    lib.save('player')
    lib.export('player', animations=True, selection=[root, rig] + meshes)
    if '--no-render' not in lib.args():
        print('RENDERS', render_previews(rig, meshes))

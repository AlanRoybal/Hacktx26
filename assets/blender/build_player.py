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
    fab = lib.grime('fabric', 128, 0.86, 1.0, seed=3, blotch=2, streak=0.12)
    look = {'jersey': (0.8, 'fabric'), 'pants': (0.42, 'fabric'), 'helmet': (0.16, None),
            'socks': (0.9, 'fabric'), 'gloves': (0.55, None), 'shoes': (0.32, None)}
    M = {k: lib.mat(k + sfx, c[k], rough=r, tex=t) for k, (r, t) in look.items()}
    for k in ('jersey', 'pants', 'socks'):
        for n in M[k].node_tree.nodes:
            if n.type == 'TEX_IMAGE':
                n.interpolation = 'Linear'
    hb = M['helmet'].node_tree.nodes['Principled BSDF']
    hb.inputs['Coat Weight'].default_value = 1.0
    hb.inputs['Coat Roughness'].default_value = 0.05
    M['pants'].node_tree.nodes['Principled BSDF'].inputs['Sheen Weight'].default_value = 0.6
    M['facemask'] = lib.mat('facemask' + sfx, c['facemask'], rough=0.5, tex=None)
    M['skin'] = lib.mat('skin' + sfx, c['skin'], rough=0.7, tex='grime_skin')
    M['tape'] = lib.mat('tape', '#E6E2D8', tex='grime')
    M['sole'] = lib.mat('sole', '#0E0E0E', tex=None)
    M['numbers'] = lib.mat('numbers' + sfx, c['numbers'], image=team_image('numbers_atlas.png'), alpha_clip=True)
    M['name_plate'] = lib.mat('name_plate' + sfx, c['numbers'], image=team_image('numbers_atlas.png'), alpha_clip=True)
    M['helmet_logo'] = lib.mat('helmet_logo' + sfx, '#FFFFFF', image=team_image(f"logo_{c['logo']}_hd.png"), alpha_clip=True)
    return M


TORSO = [(1.00, .152, .112), (1.12, .158, .116), (1.24, .185, .126), (1.36, .228, .14), (1.46, .25, .148), (1.53, .232, .14)]


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

    pants = [(0.0, .12, .095), (0.2, .168, .124), (0.45, .186, .136), (0.78, .172, .124), (1.0, .156, .114)]
    add(lib.loft('pelvis', (0, 0, 0.80), (0, 0, 1.08), pants, 14, M['pants']), torso_w)
    add(lib.loft('belt', (0, 0, 1.02), (0, 0, 1.05), [(0, .18, .132), (1, .178, .13)], 14, M['sole']), torso_w)
    jt = [((z - 1.0) / 0.53, a, b) for z, a, b in TORSO]
    add(lib.loft('torso', (0, 0, 1.0), (0, 0, 1.53), jt, 14, M['jersey']), torso_w)
    add(lib.loft('neckroll', (0, 0, 1.53), (0, 0, 1.6), [(0, .118, .106), (0.5, .108, .098), (1, .088, .082)], 14, M['jersey']), bone='chest')
    pads = lib.sphere('pads', 1.0, (0, 0.005, 1.485), 28, 14, M['jersey'], scale=(0.30, 0.172, 0.1))
    lib.apply(pads)
    for v in pads.data.vertices:   # flat-topped plate with a squared front edge instead of a dome
        c = v.co
        if c.z > 1.485:
            c.z = 1.485 + (c.z - 1.485) * 0.62
        c.y = 0.005 + (c.y - 0.005) * (1.0 + 0.18 * min(1.0, abs(c.x) / 0.25))
    add(lib.smooth(pads), bone='chest')
    for s, x in (('L', 1), ('R', -1)):
        ep = lib.sphere(f'epaulet_{s}', 1.0, (0.245 * x, 0.0, 1.51), 18, 9, M['jersey'], scale=(0.105, 0.145, 0.045))
        lib.apply(ep)
        for v in ep.data.vertices:   # cap curls down over the deltoid
            d = (v.co.x * x - 0.245) / 0.105
            if d > 0:
                v.co.z -= 0.05 * d * d
        add(lib.smooth(ep), bone='chest')
        _, sh, el, _ = B[f'upperarm_{s}']
        _, _, wr, _ = B[f'forearm_{s}']
        _, _, ht, _ = B[f'hand_{s}']
        sl = lib.loft(f'sleeve_{s}', sh, el, [(0.0, 0.0954, 0.1008), (0.25, 0.0927, 0.0954), (0.42, 0.0828, 0.0855)], 10, M['jersey'])
        add(limb_w(sl, f'upperarm_{s}'))
        ua = lib.loft(f'upperarm_{s}', sh, el, [(0.0, 0.0722, 0.0783), (0.35, 0.0792, 0.0845), (0.62, 0.0704, 0.0739), (0.88, 0.0563, 0.0581), (1.0, 0.0528, 0.0554)], 14, M['skin'])
        add(limb_w(ua, f'upperarm_{s}', child=f'forearm_{s}'))
        fa = lib.loft(f'forearm_{s}', el, wr, [(0.0, 0.0534, 0.0561), (0.2, 0.0635, 0.0681), (0.45, 0.0589, 0.0616), (0.8, 0.0423, 0.0396), (1.0, 0.0377, 0.034)], 14, M['skin'])
        add(limb_w(fa, f'forearm_{s}', parent=f'upperarm_{s}'))
        tp = lib.loft(f'tape_{s}', el, wr, [(0.78, 0.052, 0.050), (1.0, 0.046, 0.044)], 10, M['tape'])
        add(limb_w(tp, f'forearm_{s}'))
        hd = lib.loft(f'glove_{s}', wr, ht, [(0.0, .03, .04), (0.4, .028, .05), (0.6, .026, .048), (0.66, .021, .04)], 8, M['gloves'])
        add(limb_w(hd, f'hand_{s}'))
        hv, wv = Vector(ht), Vector(wr)
        d = (hv - wv).normalized()
        for f in range(4):   # separate gloved fingers with gaps between them, gently curled
            o = (f - 1.5) * 0.0215
            k = 1.0 - 0.13 * abs(f - 1.5) - (0.06 if f in (0, 3) else 0)
            b0 = wv.lerp(hv, 0.6) + Vector((0, o, 0))
            b1 = b0 + d * 0.038 * k + Vector((0, o * 0.12, 0))
            b2 = b1 + d * 0.026 * k + Vector((-0.005 * x, 0, 0))
            b3 = b2 + d * 0.02 * k + Vector((-0.008 * x, 0, 0))
            fg = lib.tube(f'glove_f{f}_{s}', [b0, b1, b2, b3], [0.0098, 0.0092, 0.0085, 0.0075], 6, M['gloves'], joints=True)
            add(fg, bone=f'hand_{s}')
        th = Vector(wr) + Vector((-0.012 * x, -0.035, -0.03))
        tb = lib.loft(f'thumb_{s}', th, th + Vector((-0.01 * x, -0.025, -0.055)), [(0, .014, .014), (1, .01, .01)], 6, M['gloves'])
        add(limb_w(tb, f'hand_{s}'))
        _, hp, kn, _ = B[f'thigh_{s}']
        _, _, an, _ = B[f'shin_{s}']
        tg = lib.loft(f'thigh_{s}', hp, kn, [(0.0, 0.1187, 0.1299), (0.3, 0.1177, 0.1299), (0.6, 0.1017, 0.1092), (0.85, 0.0838, 0.0895), (1.0, 0.0744, 0.0791)], 14, M['pants'])
        add(limb_w(tg, f'thigh_{s}', parent='hips', child=f'shin_{s}', t0=0.12, t1=0.9))
        kp = lib.loft(f'kneepad_{s}', hp, kn, [(0.86, 0.072, 0.0774, 0, 0.006), (0.98, 0.0738, 0.081, 0, 0.009), (1.06, 0.0693, 0.0747, 0, 0.006)], 10, M['pants'])
        add(limb_w(kp, f'thigh_{s}', child=f'shin_{s}', t1=0.95))
        sp = lib.loft(f'shin_pants_{s}', kn, an, [(0.0, 0.0727, 0.0773), (0.17, 0.0672, 0.0727)], 10, M['pants'])
        add(limb_w(sp, f'shin_{s}', parent=f'thigh_{s}', t0=0.1))
        sk = lib.loft(f'sock_{s}', kn, an, [(0.12, 0.063, 0.0677), (0.32, 0.0696, 0.0818, 0, -0.014), (0.55, 0.0611, 0.0696, 0, -0.008), (0.82, 0.0442, 0.047), (1.0, 0.0376, 0.0423)], 14, M['socks'])
        add(limb_w(sk, f'shin_{s}'))
        hx = 0.12 * x
        cl = lib.loft(f'cleat_{s}', (hx, 0.075, 0.07), (hx, -0.175, 0.045),
                      [(0.0, .038, .04), (0.2, .048, .055), (0.55, .05, .042), (0.85, .045, .03), (1.0, .03, .018)], 10, M['shoes'], side=(1, 0, 0))
        add(cl, bone=f'foot_{s}')
        so = lib.box(f'sole_{s}', (0.1, 0.25, 0.018), (hx, -0.05, 0.012), M['sole'])
        lib.apply(so)
        add(so, bone=f'foot_{s}')
    nk = lib.loft('neck', (0, 0, 1.47), (0, 0, 1.66), [(0, .082, .084), (1, .066, .068)], 10, M['skin'])
    add(nk, lambda i, co: ramp(co.z, 1.58, 1.66, 'neck', 'head'))
    hdm = lib.sphere('head', 1.0, (0, -0.005, 1.735), 12, 8, M['skin'], scale=(0.095, 0.105, 0.115))
    lib.apply(hdm)
    add(lib.smooth(hdm), bone='head')
    for x in (1, -1):
        add(lib.sphere(f'num_eye{x}', 0.011, (0.034 * x, -0.098, 1.752), 8, 6, M['sole']), bone='head')
        add(lib.box(f'num_eyeblack{x}', (0.03, 0.006, 0.012), (0.035 * x, -0.1, 1.728), M['sole']), bone='head')
        add(lib.sphere(f'num_ear{x}', 1.0, (0.094 * x, 0.0, 1.735), 8, 6, M['skin'], scale=(0.012, 0.024, 0.032)), bone='head')
        add(lib.box(f'num_brow{x}', (0.032, 0.008, 0.008), (0.034 * x, -0.1, 1.77), M['sole'], rot=(0, math.radians(-8 * x), 0)), bone='head')
    add(lib.loft('num_nose', (0, -0.1, 1.745), (0, -0.118, 1.712), [(0, .01, .008), (1, .016, .014)], 8, M['skin']), bone='head')
    add(lib.box('num_mouth', (0.034, 0.005, 0.006), (0, -0.1, 1.69), M['sole']), bone='head')
    add(decal('num_front', 1.33, 0.2, 0.19, number, False, M['numbers']), bone='chest', uv=0)
    add(decal('num_back', 1.31, 0.24, 0.23, number, True, M['numbers']), bone='chest', uv=0)
    # nameplate above the back number; game code draws the surname into this material per player
    add(decal('num_name', 1.445, 0.3, 0.06, number, True, M['name_plate'], box=(0, 1, 0, 1), out=0.075), bone='chest', uv=0)
    return parts


def build_helmet(M, sfx=''):
    shell = lib.sphere('helmet' + sfx, 1.0, (0, 0.012, 1.752), 32, 18, M['helmet'], scale=(0.148, 0.168, 0.152))
    lib.apply(shell)
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    for v in bm.verts:   # jaw guards flare out and down; back of the shell sits lower over the neck
        c = v.co
        if c.z < 1.72:
            k = (1.72 - c.z) / 0.12
            c.x *= 1 + 0.12 * k
            if c.y > 0.02:
                c.z -= 0.025 * k
        if c.z > 1.82:
            c.y += 0.01 * (c.z - 1.82) / 0.08
    ear = lambda c: (abs(c.x) > 0.12 and abs(c.y - 0.0) < 0.022 and abs(c.z - 1.705) < 0.02)
    kill = [f for f in bm.faces if (lambda c: (c.y < -0.05 and c.z < 1.775 and abs(c.x) < 0.108) or c.z < 1.615 or ear(c))(f.calc_center_median())]
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
    bump = lib.mat('bumper', '#1A1A1A', rough=0.6, tex=None)
    front = lib.sweep('bumper_f', [(-0.07, -0.158, 1.79), (0, -0.172, 1.795), (0.07, -0.158, 1.79)], [(.012, .007)] * 3, 8, bump, side=(0, 0, 1), tip=False)
    rear = lib.sweep('bumper_r', [(-0.06, 0.168, 1.67), (0, 0.18, 1.665), (0.06, 0.168, 1.67)], [(.014, .008)] * 3, 8, bump, side=(0, 0, 1), tip=False)
    cups = [lib.sphere('chin_cup', 1.0, (0, -0.15, 1.598), 10, 6, M['tape'], scale=(0.04, 0.022, 0.028))]
    for c in cups:
        lib.apply(c)
    mask = lib.join([mask, strap, front, rear] + cups, 'facemask' + sfx)
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


def run_pose(t, carry=False):
    """t in [0,1): one full stride. Chest counter-rotates the hips, feet flex through push-off, heel kicks up behind."""
    ph = 2 * math.pi * t
    c, sn = math.cos(ph), math.sin(ph)
    thighL = -40 * c + 2
    thighR = 40 * c + 2
    shinL = 18 + 70 * max(0, sn) ** 1.3
    shinR = 18 + 70 * max(0, -sn) ** 1.3
    p = {'thigh_L': (thighL, 0, -2), 'thigh_R': (thighR, 0, 2), 'shin_L': (shinL, 0, 0), 'shin_R': (shinR, 0, 0),
         'foot_L': (-12 + 28 * max(0, -c) * max(0, sn), 0, 0), 'foot_R': (-12 + 28 * max(0, c) * max(0, -sn), 0, 0),
         'spine': (13, 0, -5 * c), 'chest': (4, 0, -9 * c), 'neck': (-11, 0, 9 * c), 'head': (0, 0, 4 * c),
         'hips': (2, 0, 9 * c), 'loc': (0, 0, 0.045 * abs(sn) - 0.035)}
    p.update({'upperarm_L': (-44 * c, 0, -6), 'upperarm_R': (44 * c, 0, 6),
              'forearm_L': (-82 + 18 * c, 0, 0), 'forearm_R': (-82 - 18 * c, 0, 0),
              'hand_L': (-10, 0, 0), 'hand_R': (-10, 0, 0)})
    if carry:   # ball high and tight in the right arm, left arm pumps harder
        p.update({'upperarm_R': (-28, 0, 22), 'forearm_R': (-118, 0, 0), 'hand_R': (-20, 0, 0),
                  'upperarm_L': (-55 * c, 0, -8), 'forearm_L': (-78 + 22 * c, 0, 0), 'chest': (6, 0, -12 * c)})
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
    rest = {'hips': (0, 0, 4), 'spine': (3, 0, -2), 'chest': (0, 0, -2), 'neck': (-3, 0, 2), 'loc': (0.015, 0, -0.012),
            'upperarm_L': (6, -11, 0), 'upperarm_R': (2, 9, 0), 'forearm_L': (-24, 0, 0), 'forearm_R': (-18, 0, 0),
            'hand_L': (-8, 0, 0), 'hand_R': (-6, 0, 0),
            'thigh_L': (-4, 0, -3), 'shin_L': (6, 0, 0), 'thigh_R': (-9, 0, 4), 'shin_R': (14, 0, 0), 'foot_R': (-5, 0, 0)}
    A['Idle'] = (True, {0: rest, 30: P(rest, {'chest': (-2, 0, -1), 'neck': (-1, 0, 3), 'upperarm_L': (6, -13, 0), 'upperarm_R': (2, 11, 0),
                                              'forearm_L': (-27, 0, 0), 'forearm_R': (-21, 0, 0), 'loc': (0.015, 0, -0.008)})})
    A['Idle'][1][60] = A['Idle'][1][0]
    stance = {'loc': (0, 0, -0.42), 'thigh_L': (-95, 0, -10), 'thigh_R': (-75, 0, 10), 'shin_L': (115, 0, 0), 'shin_R': (110, 0, 0),
              'foot_L': (-30, 0, 0), 'foot_R': (-30, 0, 0), 'spine': (55, 0, 0), 'chest': (15, 0, 0), 'neck': (-55, 0, 0), 'head': (-10, 0, 0),
              'upperarm_R': (-75, 0, 0), 'forearm_R': (0, 0, 0), 'upperarm_L': (-35, -10, 0), 'forearm_L': (-60, 0, 0)}
    A['Stance3pt'] = (True, {0: stance, 15: P(stance, {'spine': (56, 0, 0), 'loc': (0, 0, -0.415)}), 30: stance})
    A['Run'] = (True, {f: run_pose(f / 18) for f in range(0, 19, 2)})
    A['RunBall'] = (True, {f: run_pose(f / 18, True) for f in range(0, 19, 2)})
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
    # catches: track the ball over the shoulder, hands up into a diamond, extend, absorb, then tuck and go
    look = {'neck': (-18, 0, 25), 'head': (-10, 0, 15), 'chest': (0, 0, 10)}
    diamond = lambda up, el: {'upperarm_L': (up, -12, 0), 'upperarm_R': (up, 12, 0), 'forearm_L': (el, 0, 8), 'forearm_R': (el, 0, -8),
                              'hand_L': (25, 0, -15), 'hand_R': (25, 0, 15)}
    tuckR = {'upperarm_R': (-28, 0, 22), 'forearm_R': (-118, 0, 0), 'hand_R': (-20, 0, 0), 'upperarm_L': (-40, 0, -25),
             'forearm_L': (-100, 0, 0), 'chest': (8, 0, 0)}
    A['CatchHigh'] = (False, {0: run_pose(0), 4: P(run_pose(0.2), look), 8: P(run_pose(0.4), look, diamond(-130, -50)),
                              12: P(run_pose(0.55), {'neck': (-30, 0, 0), 'head': (-15, 0, 0), 'spine': (-6, 0, 0), 'loc': (0, 0, 0.06)}, diamond(-168, -12)),
                              16: P(run_pose(0.7), {'neck': (-15, 0, 0), 'spine': (6, 0, 0)}, diamond(-115, -75)),
                              21: P(run_pose(0.85), {'neck': (-8, 0, 0)}, diamond(-55, -115)),
                              27: run_pose(1.0, True)})
    A['CatchChest'] = (False, {0: run_pose(0), 5: P(run_pose(0.25), {'neck': (-6, 0, 0)}, diamond(-60, -45)),
                               10: P(run_pose(0.5), diamond(-82, -25)),
                               14: P(run_pose(0.65), {'spine': (16, 0, 0)}, diamond(-45, -105)),
                               20: P(run_pose(0.85), tuckR), 26: run_pose(1.0, True)})
    scoop = P(CROUCH, {'loc': (0, 0, -0.3), 'spine': (42, 0, 0), 'neck': (-35, 0, 0), 'thigh_L': (-70, 0, -8), 'thigh_R': (-35, 0, 8),
                       'shin_L': (85, 0, 0), 'shin_R': (75, 0, 0)}, diamond(-38, -15), {'hand_L': (-25, 0, -10), 'hand_R': (-25, 0, 10)})
    A['CatchLow'] = (False, {0: run_pose(0), 6: P(run_pose(0.3), {'spine': (26, 0, 0)}, diamond(-45, -30)), 11: scoop,
                             17: P(scoop, {'spine': (30, 0, 0), 'loc': (0, 0, -0.2)}, diamond(-30, -100)),
                             24: P(run_pose(0.8), tuckR), 30: run_pose(1.0, True)})
    # defender breaks up the pass: plant, leap, right arm rakes through the ball, land
    A['Swat'] = (False, {0: run_pose(0.25), 5: P(CROUCH, {'loc': (0, 0, -0.16), 'upperarm_R': (-60, 10, 0), 'upperarm_L': (-40, -10, 0)}),
                         10: P({'loc': (0, 0, 0.32), 'spine': (-10, 0, 12), 'chest': (0, 0, 10), 'neck': (-25, 0, 0), 'thigh_L': (-30, 0, 0), 'shin_L': (50, 0, 0),
                                'thigh_R': (-5, 0, 0), 'shin_R': (25, 0, 0), 'foot_L': (30, 0, 0), 'foot_R': (30, 0, 0),
                                'upperarm_R': (-172, 15, 0), 'forearm_R': (-8, 0, 0), 'upperarm_L': (-120, -20, 0), 'forearm_L': (-30, 0, 0)}),
                         15: P({'loc': (0, 0, 0.18), 'spine': (20, 0, -25), 'chest': (10, 0, -15), 'neck': (-10, 0, 0), 'thigh_L': (-25, 0, 0), 'shin_L': (40, 0, 0),
                                'thigh_R': (-15, 0, 0), 'shin_R': (35, 0, 0), 'upperarm_R': (-95, 0, -45), 'forearm_R': (-20, 0, 0),
                                'upperarm_L': (-70, -30, 0), 'forearm_L': (-50, 0, 0)}),
                         22: P(CROUCH, {'loc': (0, 0, -0.2), 'upperarm_R': (-30, 0, -20), 'forearm_R': (-50, 0, 0), 'upperarm_L': (-30, -10, 0)}),
                         32: P(CROUCH, {'loc': (0, 0, -0.08), 'spine': (12, 0, 0), 'upperarm_R': (-150, 10, 0), 'forearm_R': (-60, 0, 0),
                                        'upperarm_L': (-20, -15, 0), 'forearm_L': (-40, 0, 0)})})
    # receiver after a drop or breakup: hands open, ball gone, hands to the facemask, head drops
    hh = {'upperarm_L': (-150, -55, 0), 'upperarm_R': (-150, 55, 0), 'forearm_L': (-125, 0, 0), 'forearm_R': (-125, 0, 0),
          'neck': (25, 0, 0), 'head': (10, 0, 0), 'spine': (14, 0, 0)}
    A['DropReact'] = (False, {0: P(run_pose(0.5), diamond(-90, -40)), 6: P(run_pose(0.75), diamond(-110, -10), {'neck': (-20, 0, 0)}),
                              14: P(rest, {'upperarm_L': (-40, -20, 0), 'upperarm_R': (-40, 20, 0), 'forearm_L': (-30, 0, 0), 'forearm_R': (-30, 0, 0), 'spine': (10, 0, 0)}),
                              24: P(rest, hh), 34: P(rest, hh, {'spine': (20, 0, 8), 'neck': (30, 0, -10)}), 48: P(rest, hh, {'spine': (12, 0, -6)})})
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
    # QB seen on the jumbotron: ball held high at the chest, then a full throwing motion
    qbset = P(rest, {'upperarm_R': (-38, 0, 18), 'forearm_R': (-112, 0, 0), 'upperarm_L': (-35, 0, -18), 'forearm_L': (-108, 0, 0),
                     'thigh_L': (-14, 0, -4), 'thigh_R': (-14, 0, 4), 'shin_L': (22, 0, 0), 'shin_R': (22, 0, 0), 'loc': (0, 0, -0.04), 'spine': (8, 0, 0)})
    A['QBSet'] = (True, {0: qbset, 20: P(qbset, {'loc': (0, 0, -0.05), 'neck': (-4, 0, 6)}), 40: qbset})
    A['Throw'] = (False, {0: qbset, 5: P(qbset, {'upperarm_R': (-150, 40, 0), 'forearm_R': (-115, 0, 0), 'upperarm_L': (-80, -10, 0), 'forearm_L': (-30, 0, 0),
                                                 'spine': (-6, 0, 22), 'chest': (0, 0, 14), 'thigh_L': (-30, 0, 0), 'shin_L': (25, 0, 0)}),
                          9: P(qbset, {'upperarm_R': (-125, -5, 0), 'forearm_R': (-25, 0, 0), 'upperarm_L': (-25, -25, 0), 'forearm_L': (-60, 0, 0),
                                       'spine': (14, 0, -12), 'chest': (6, 0, -12), 'thigh_L': (-25, 0, 0), 'shin_L': (15, 0, 0)}),
                          16: P(qbset, {'upperarm_R': (-35, -40, 0), 'forearm_R': (-20, 0, 0), 'upperarm_L': (-15, -20, 0), 'forearm_L': (-50, 0, 0),
                                        'spine': (28, 0, -22), 'chest': (8, 0, -14), 'thigh_R': (-5, 0, 0), 'thigh_L': (-30, 0, 0), 'shin_L': (30, 0, 0)}),
                          26: P(rest, {'spine': (10, 0, -6)})})
    # officials' signals
    up = {'upperarm_L': (-178, -6, 0), 'upperarm_R': (-178, 6, 0), 'forearm_L': (0, 0, 0), 'forearm_R': (0, 0, 0), 'hand_L': (0, 0, 0), 'hand_R': (0, 0, 0)}
    A['RefTD'] = (False, {0: rest, 8: P(rest, up, {'loc': (0, 0, 0.02)}), 30: P(rest, up), 40: P(rest, up, {'neck': (-5, 0, 0)})})
    wo = lambda k: {'upperarm_L': (-88, 0, 60 - 100 * k), 'upperarm_R': (-88, 0, -60 + 100 * k), 'forearm_L': (-5, 0, 0), 'forearm_R': (-5, 0, 0)}
    A['RefIncomplete'] = (True, {0: P(rest, wo(0)), 8: P(rest, wo(1)), 16: P(rest, wo(0)), 24: P(rest, wo(1)), 32: P(rest, wo(0))})
    point = {'upperarm_R': (-92, 0, 0), 'forearm_R': (-2, 0, 0), 'hand_R': (0, 0, 0), 'chest': (0, 0, 12), 'neck': (-4, 0, -10)}
    A['RefFirstDown'] = (False, {0: rest, 8: P(rest, point), 34: P(rest, point, {'upperarm_R': (-96, 0, 0)})})
    A['RefFlag'] = (False, {0: rest, 6: P(rest, {'upperarm_R': (-165, 20, 0), 'forearm_R': (-70, 0, 0), 'spine': (-6, 0, 10)}),
                            11: P(rest, {'upperarm_R': (-70, 0, 0), 'forearm_R': (-8, 0, 0), 'spine': (10, 0, -10), 'thigh_L': (-20, 0, 0), 'shin_L': (20, 0, 0)}),
                            20: P(rest, {'upperarm_R': (-30, 10, 0), 'forearm_R': (-20, 0, 0)}), 28: rest})
    push = lambda k: {'upperarm_L': (-80 + 20 * k, -10, 0), 'upperarm_R': (-80 + 20 * k, 10, 0), 'forearm_L': (-10 - 80 * k, 0, 0), 'forearm_R': (-10 - 80 * k, 0, 0),
                      'hand_L': (40, 0, 0), 'hand_R': (40, 0, 0)}
    A['RefPI'] = (True, {0: P(rest, push(1)), 8: P(rest, push(0)), 16: P(rest, push(1)), 24: P(rest, push(0)), 32: P(rest, push(1))})
    # ball carrier going down forward (scramble tackle seen from the jumbotron)
    A['DiveTackled'] = (False, {0: run_pose(0.25, True), 8: P(run_pose(0.5, True), {'spine': (35, 0, 0), 'loc': (0, -0.2, -0.2)}),
                                16: P({'hips': (70, 0, 0), 'loc': (0, -0.7, -0.55), 'neck': (-45, 0, 0), 'upperarm_R': (-28, 0, 22), 'forearm_R': (-118, 0, 0),
                                       'upperarm_L': (-120, -10, 0), 'thigh_L': (15, 0, 0), 'thigh_R': (30, 0, 0), 'shin_L': (30, 0, 0), 'shin_R': (50, 0, 0)}),
                                26: P({'hips': (88, 0, 0), 'loc': (0, -1.0, -0.84), 'neck': (-55, 0, 0), 'upperarm_R': (-28, 0, 22), 'forearm_R': (-118, 0, 0),
                                       'upperarm_L': (-150, -20, 0), 'thigh_L': (5, 0, 0), 'thigh_R': (15, 0, 0), 'shin_L': (20, 0, 0), 'shin_R': (35, 0, 0)})})
    # line play: OL kick-slide and punch, anchor against a bull rush, get beaten; DL moves
    pset = lambda k, st: P(CROUCH, {'loc': (0, 0, -0.17), 'spine': (22, 0, 0), 'neck': (-22, 0, 0),
                                    'thigh_L': (-45 + 12 * st, 0, -14), 'thigh_R': (-45 - 12 * st, 0, 14), 'shin_L': (60, 0, 0), 'shin_R': (60, 0, 0),
                                    'upperarm_L': (-55 - 30 * k, 12, 0), 'upperarm_R': (-55 - 30 * k, -12, 0),
                                    'forearm_L': (-95 + 80 * k, 0, 0), 'forearm_R': (-95 + 80 * k, 0, 0)})
    A['PassSet'] = (True, {0: pset(0, 1), 6: pset(1, 0), 12: pset(0.3, -1), 18: pset(1, 0), 24: pset(0, 1)})
    def drive(t, lean, arm):
        c, sn = math.cos(t), math.sin(t)
        return P(CROUCH, {'loc': (0, 0, -0.2), 'spine': (lean, 0, 4 * sn), 'neck': (-lean, 0, 0),
                          'thigh_L': (-50 + 20 * c, 0, -10), 'thigh_R': (-50 - 20 * c, 0, 10), 'shin_L': (65 + 18 * sn, 0, 0), 'shin_R': (65 - 18 * sn, 0, 0),
                          'upperarm_L': (arm, 8, 0), 'upperarm_R': (arm, -8, 0), 'forearm_L': (-12, 0, 0), 'forearm_R': (-12, 0, 0),
                          'hand_L': (30, 0, 0), 'hand_R': (30, 0, 0)})
    A['Anchor'] = (True, {f: drive(2 * math.pi * f / 16, 36, -88) for f in (0, 4, 8, 12, 16)})
    A['BullRush'] = (True, {f: drive(2 * math.pi * f / 14, 48, -96) for f in (0, 3.5, 7, 10.5, 14)})
    A['Beaten'] = (False, {0: pset(0.5, 0),
                           6: P(pset(0.5, 0), {'spine': (30, 0, 35), 'chest': (0, 0, 20), 'upperarm_R': (-100, 40, 0), 'forearm_R': (-10, 0, 0), 'thigh_R': (-70, 0, 30), 'shin_R': (60, 0, 0)}),
                           14: P(pset(0.5, 0), {'loc': (0, 0, -0.25), 'spine': (45, 0, 40), 'chest': (0, 0, 20), 'upperarm_R': (-120, 50, 0), 'forearm_R': (-10, 0, 0),
                                                'upperarm_L': (-60, -10, 0), 'thigh_R': (-70, 0, 30), 'shin_R': (70, 0, 0)}),
                           24: P(pset(0.5, 0), {'loc': (0, 0, -0.22), 'spine': (40, 0, 35), 'chest': (0, 0, 15), 'upperarm_R': (-110, 45, 0), 'forearm_R': (-20, 0, 0),
                                                'upperarm_L': (-50, -10, 0), 'thigh_R': (-60, 0, 25), 'shin_R': (65, 0, 0)})})
    r0 = rush(0)
    A['Swim'] = (False, {0: r0,
                         4: P(r0, {'spine': (35, 0, 25), 'upperarm_L': (-40, -5, 0), 'forearm_L': (-20, 0, 0), 'upperarm_R': (-120, 15, 0), 'forearm_R': (-60, 0, 0)}),
                         9: P(r0, {'spine': (30, 0, -15), 'chest': (0, 0, -15), 'upperarm_L': (-30, -10, 0), 'upperarm_R': (-175, 20, 0), 'forearm_R': (-30, 0, 0)}),
                         14: P(r0, {'spine': (35, 0, -20), 'upperarm_R': (-60, -10, 0), 'forearm_R': (-40, 0, 0), 'thigh_R': (-75, 0, 0), 'shin_R': (70, 0, 0)}),
                         20: P(run_pose(0.25), {'spine': (30, 0, 0), 'neck': (-25, 0, 0)})})
    A['Rip'] = (False, {0: r0,
                        4: P(r0, {'loc': (0, 0, -0.24), 'spine': (45, 0, 20), 'chest': (0, 0, 15), 'upperarm_R': (-20, 10, 0), 'forearm_R': (-100, 0, 0)}),
                        9: P(r0, {'spine': (35, 0, -10), 'upperarm_R': (-150, 10, 0), 'forearm_R': (-80, 0, 0), 'upperarm_L': (-60, -5, 0)}),
                        14: P(r0, {'spine': (35, 0, -5), 'upperarm_R': (-100, 0, 0), 'forearm_R': (-50, 0, 0), 'thigh_R': (-75, 0, 0), 'shin_R': (70, 0, 0)}),
                        20: P(run_pose(0.25), {'spine': (30, 0, 0), 'neck': (-25, 0, 0)})})
    A['Spin'] = (False, {0: r0,
                         5: P(r0, {'spine': (20, 0, 0), 'chest': (0, 0, 30), 'upperarm_L': (-40, -20, 0), 'upperarm_R': (-40, 20, 0), 'forearm_L': (-130, 0, 0), 'forearm_R': (-130, 0, 0)}),
                         12: P(r0, {'spine': (25, 0, 0), 'chest': (0, 0, -20), 'upperarm_L': (-110, -30, 0), 'forearm_L': (-20, 0, 0), 'upperarm_R': (-40, 20, 0), 'forearm_R': (-120, 0, 0)}),
                         18: P(run_pose(0.25), {'spine': (30, 0, 0), 'neck': (-25, 0, 0)})})
    # the defense after giving up a touchdown
    A['Dejected'] = (True, {0: P(rest, hh, {'spine': (14, 0, 4)}), 30: P(rest, hh, {'spine': (18, 0, -4), 'neck': (32, 0, 6)}), 60: P(rest, hh, {'spine': (14, 0, 4)})})
    slump = P(rest, {'spine': (18, 0, 0), 'neck': (32, 0, 0), 'upperarm_L': (8, -8, 0), 'upperarm_R': (8, 8, 0), 'forearm_L': (-10, 0, 0), 'forearm_R': (-10, 0, 0)})
    A['KickTurf'] = (False, {0: rest,
                             8: P(rest, {'thigh_R': (25, 0, 0), 'shin_R': (60, 0, 0), 'upperarm_L': (-10, -25, 0), 'upperarm_R': (-10, 25, 0), 'spine': (-5, 0, 0)}),
                             14: P(rest, {'thigh_R': (-60, 0, 0), 'shin_R': (10, 0, 0), 'foot_R': (20, 0, 0), 'spine': (10, 0, 10), 'upperarm_L': (-40, -25, 0), 'upperarm_R': (-40, 25, 0)}),
                             24: slump, 40: P(slump, {'neck': (36, 0, -8)})})
    A['Kneel'] = (False, {0: rest,
                          10: P(rest, {'loc': (0, 0, -0.22), 'thigh_L': (-60, 0, 0), 'shin_L': (60, 0, 0), 'thigh_R': (-10, 0, 0), 'shin_R': (70, 0, 0), 'spine': (15, 0, 0)}),
                          20: {'loc': (0, 0, -0.45), 'thigh_L': (-90, 0, 0), 'shin_L': (90, 0, 0), 'thigh_R': (10, 0, 0), 'shin_R': (100, 0, 0), 'foot_R': (30, 0, 0),
                               'spine': (25, 0, 0), 'neck': (28, 0, 0), 'upperarm_L': (-40, -5, 0), 'forearm_L': (-60, 0, 0), 'upperarm_R': (-10, 10, 0), 'forearm_R': (-20, 0, 0)},
                          40: {'loc': (0, 0, -0.45), 'thigh_L': (-90, 0, 0), 'shin_L': (90, 0, 0), 'thigh_R': (10, 0, 0), 'shin_R': (100, 0, 0), 'foot_R': (30, 0, 0),
                               'spine': (28, 0, 0), 'neck': (34, 0, 0), 'upperarm_L': (-40, -5, 0), 'forearm_L': (-60, 0, 0), 'upperarm_R': (-10, 10, 0), 'forearm_R': (-20, 0, 0)}})
    # touchdown celebrations (ball stays in the right hand): anticipation, overshoot, settle, head leads the body
    tuck = {'upperarm_R': (-25, 0, 22), 'forearm_R': (-120, 0, 0), 'hand_R': (-20, 0, 0)}
    gather = P(rest, tuck, {'loc': (0, 0, -0.07), 'thigh_L': (-22, 0, -3), 'thigh_R': (-22, 0, 3), 'shin_L': (34, 0, 0), 'shin_R': (34, 0, 0), 'spine': (14, 0, 0), 'neck': (-6, 0, 0)})
    heis = P(tuck, {'loc': (0, 0, -0.03), 'thigh_R': (-82, 0, 6), 'shin_R': (96, 0, 0), 'foot_R': (-25, 0, 0), 'thigh_L': (-8, 0, -2), 'shin_L': (12, 0, 0),
                    'upperarm_L': (-86, -8, 0), 'forearm_L': (-4, 0, 0), 'hand_L': (45, 0, 0), 'spine': (6, 0, -12), 'chest': (0, 0, -8), 'neck': (-4, 0, 16), 'hips': (0, 0, 4)})
    A['Heisman'] = (False, {0: P(rest, tuck), 5: gather, 13: P(heis, {'thigh_R': (-88, 0, 6), 'upperarm_L': (-90, -6, 0), 'loc': (0, 0, -0.01)}),
                            19: heis, 34: P(heis, {'loc': (0.012, 0, -0.03), 'hips': (0, 0, 6), 'neck': (-6, 0, 18)}),
                            50: P(heis, {'loc': (-0.006, 0, -0.035), 'chest': (0, 0, -10)}), 60: heis})
    up = P(tuck, {'loc': (0, 0, 0.05), 'foot_L': (26, 0, 0), 'foot_R': (26, 0, 0), 'thigh_L': (-4, 0, -3), 'thigh_R': (-4, 0, 3), 'spine': (-12, 0, 0), 'chest': (-6, 0, 0), 'neck': (-36, 0, 0),
                  'upperarm_R': (-166, 10, 0), 'forearm_R': (-6, 0, 0), 'hand_R': (0, 0, 0), 'upperarm_L': (-158, -14, 0), 'forearm_L': (-8, 0, 0), 'hand_L': (-10, 0, 0)})
    A['PointSky'] = (False, {0: P(rest, tuck), 7: gather, 14: P(up, {'loc': (0, 0, 0.09), 'neck': (-42, 0, 0), 'spine': (-16, 0, 0)}), 20: up,
                             36: P(up, {'upperarm_R': (-150, 14, 0), 'neck': (-30, 0, 6), 'loc': (0, 0, 0.03)}),
                             48: P(rest, tuck, {'upperarm_L': (-150, -16, 0), 'forearm_L': (-10, 0, 0), 'neck': (-24, 0, -4), 'spine': (-4, 0, 0)}),
                             60: P(rest, tuck, {'upperarm_L': (-146, -18, 0), 'forearm_L': (-12, 0, 0), 'neck': (-22, 0, -6), 'spine': (-4, 0, 0)})})
    def shim(m, z):
        return P(tuck, {'loc': (0.02 * m, 0, z), 'thigh_L': (-30, 0, -6), 'thigh_R': (-30, 0, 6), 'shin_L': (46, 0, 0), 'shin_R': (46, 0, 0), 'foot_L': (-14, 0, 0), 'foot_R': (-14, 0, 0),
                        'spine': (16, 0, 0), 'chest': (0, 4 * m, 14 * m), 'hips': (0, 0, -6 * m), 'neck': (-10, 0, -8 * m), 'upperarm_L': (-38, -34 - 8 * m, 0), 'forearm_L': (-96, 0, 0),
                        'upperarm_R': (-30 + 6 * m, 0, 22)})
    A['Shimmy'] = (True, {0: shim(1, -0.1), 6: shim(-1, -0.07), 12: shim(1, -0.1), 18: shim(-1, -0.07), 24: shim(1, -0.1)})
    # sack celebrations
    roar = {'loc': (0, 0, -0.12), 'thigh_L': (-26, 0, -14), 'thigh_R': (-26, 0, 14), 'shin_L': (42, 0, 0), 'shin_R': (42, 0, 0), 'foot_L': (-12, 0, 0), 'foot_R': (-12, 0, 0),
            'spine': (-16, 0, 0), 'chest': (-8, 0, 0), 'neck': (-34, 0, 0), 'upperarm_L': (-62, -68, 0), 'forearm_L': (-64, 0, 0), 'hand_L': (-30, 0, 0),
            'upperarm_R': (-62, 68, 0), 'forearm_R': (-64, 0, 0), 'hand_R': (-30, 0, 0)}
    A['Roar'] = (False, {0: rest, 6: P(crouch, {'loc': (0, 0, -0.17), 'spine': (30, 0, 0)}), 13: P(roar, {'spine': (-22, 0, 0), 'neck': (-42, 0, 0), 'loc': (0, 0, -0.09)}), 19: roar,
                         28: P(roar, {'chest': (-8, 0, 6), 'neck': (-30, 0, -8)}), 38: P(roar, {'chest': (-8, 0, -6), 'neck': (-32, 0, 8)}), 48: P(roar, {'chest': (-10, 0, 3)}), 60: roar})
    def lasso(a):
        return P(rest, {'upperarm_R': (-160, 18 * math.cos(a), 18 * math.sin(a)), 'forearm_R': (-38, 0, 0), 'hand_R': (-20, 0, 0),
                        'upperarm_L': (-20, -24, 0), 'forearm_L': (-70, 0, 0), 'spine': (-6, 0, 6 * math.sin(a)), 'neck': (-16, 0, -10 * math.sin(a)), 'hips': (0, 0, 4 * math.sin(a)),
                        'thigh_L': (-14, 0, -6), 'thigh_R': (-14, 0, 6), 'shin_L': (22, 0, 0), 'shin_R': (22, 0, 0), 'loc': (0, 0, -0.04 + 0.015 * math.cos(2 * a))})
    A['Lasso'] = (True, {f: lasso(2 * math.pi * f / 24) for f in range(0, 25, 4)})
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


ARM_PARTS = {'sleeve', 'upperarm', 'forearm', 'tape', 'glove', 'thumb'}
SHELL = {'torso': (0.009, 8500), 'arm': (0.0065, 2800), 'leg': (0.0085, 3200)}   # voxel size, target tris


def g3(co, c, r):
    return math.exp(-sum(((co[i] - c[i]) / r[i]) ** 2 for i in range(3)))


def sculpt(kind, co):
    """Displacement along the normal (m): muscle masses under the skin/uniform and cloth folds. Blender: -Y is front."""
    s = 1 if co.x > 0 else -1
    x = co.x * s
    d = 0.0
    if kind == 'arm':
        d += 0.0060 * g3((x, co.y, co.z), (0.295, -0.045, 1.30), (0.05, 0.035, 0.08))   # biceps
        d += 0.0050 * g3((x, co.y, co.z), (0.29, 0.05, 1.33), (0.05, 0.035, 0.09))      # triceps
        d += 0.0040 * g3((x, co.y, co.z), (0.335, -0.02, 1.09), (0.035, 0.04, 0.06))    # forearm flexors
        d -= 0.0020 * g3((x, co.y, co.z), (0.31, -0.06, 1.17), (0.03, 0.03, 0.03))      # elbow pit
        d += 0.0016 * math.sin((co.z + 0.4 * co.y) * 2 * math.pi / 0.03) * g3((x, co.y, co.z), (0.29, 0, 1.4), (0.06, 0.08, 0.05))   # sleeve wrinkles
        d += 0.0030 * g3((x, co.y, co.z), (0.27, 0, 1.45), (0.05, 0.06, 0.04))         # deltoid under the sleeve
    elif kind == 'leg':
        d += 0.0060 * g3((x, co.y, co.z), (0.115, -0.065, 0.78), (0.055, 0.05, 0.14))   # rectus femoris
        d += 0.0060 * g3((x, co.y, co.z), (0.075, -0.05, 0.61), (0.04, 0.04, 0.05))     # vastus medialis teardrop
        d += 0.0050 * g3((x, co.y, co.z), (0.17, -0.01, 0.76), (0.04, 0.06, 0.12))      # vastus lateralis
        d += 0.0040 * g3((x, co.y, co.z), (0.115, 0.065, 0.76), (0.06, 0.05, 0.13))     # hamstrings
        d += 0.0070 * g3((x, co.y, co.z), (0.125, 0.055, 0.38), (0.05, 0.04, 0.08))     # calf
        d += 0.0018 * math.sin(co.z * 2 * math.pi / 0.028) * g3((x, co.y, co.z), (0.12, 0.07, 0.56), (0.06, 0.04, 0.04))   # folds behind the knee
        d += 0.0015 * math.sin((co.z + 0.6 * x) * 2 * math.pi / 0.04) * g3((x, co.y, co.z), (0.1, -0.1, 0.9), (0.06, 0.05, 0.06))   # hip crease
    else:
        d += 0.0060 * g3((x, co.y, co.z), (0.08, 0.13, 0.91), (0.08, 0.06, 0.08))       # glutes
        d += 0.0030 * g3((x, co.y, co.z), (0.08, -0.13, 1.36), (0.08, 0.04, 0.06))      # pecs under the jersey
        d += 0.0014 * math.sin((co.z * 1.4 + x) * 2 * math.pi / 0.05) * g3((x, co.y, co.z), (0.12, -0.12, 1.2), (0.08, 0.05, 0.1))   # jersey drape over the belly
        d += 0.0012 * math.sin((co.z - x * 0.8) * 2 * math.pi / 0.045) * g3((x, co.y, co.z), (0.12, 0.12, 1.25), (0.1, 0.05, 0.12))   # back folds
        d += 0.0035 * g3((x, co.y, co.z), (0.09, 0.12, 1.38), (0.06, 0.04, 0.08))       # lats/shoulder blades
        side = min(1.0, max(0.0, (x - 0.1) / 0.06))
        d += 0.0015 * side * math.sin((co.z + 0.3 * co.y) * 2 * math.pi / 0.035) * g3((x, co.y, co.z), (0.15, 0, 1.13), (0.1, 0.2, 0.08))   # tuck folds
    return d


def unify(objs, name, voxel, target, kind):
    """Fuse overlapping primitives into one seamless voxel-remeshed surface, sculpt it, then carry over
    materials (nearest source face) and skin weights (inverse-distance from the nearest source face)."""
    from mathutils.bvhtree import BVHTree
    src = lib.join(objs, name + '_src')
    sh = src.copy()
    sh.data = src.data.copy()
    sh.name = name
    bpy.context.scene.collection.objects.link(sh)
    for o in sh.vertex_groups[:]:
        sh.vertex_groups.remove(o)

    def mod(t, **kw):
        m = sh.modifiers.new(t, t)
        for k, v in kw.items():
            setattr(m, k, v)
        bpy.context.view_layer.objects.active = sh
        with bpy.context.temp_override(object=sh, active_object=sh):
            bpy.ops.object.modifier_apply(modifier=m.name)
    mod('REMESH', mode='VOXEL', voxel_size=voxel, adaptivity=0.0)
    mod('SMOOTH', factor=0.5, iterations=3)
    me = sh.data
    disp = [sculpt(kind.split('_')[0], v.co) for v in me.vertices]
    for v, dd in zip(me.vertices, disp):
        v.co += v.normal * dd
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    mod('DECIMATE', ratio=min(1.0, target / tris))
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    sw = [{src.vertex_groups[g.group].name: g.weight for g in v.groups} for v in src.data.vertices]
    for p in me.polygons:
        hit = tree.find_nearest(p.center)
        p.material_index = bm.faces[hit[2]].material_index if hit[2] is not None else 0
    fb = bmesh.new()   # majority filter: clean, straight hems instead of ragged nearest-face boundaries
    fb.from_mesh(me)
    fb.faces.ensure_lookup_table()
    for _ in range(4):
        cur = [f.material_index for f in fb.faces]
        for f in fb.faces:
            votes = {}
            for e in f.edges:
                for g in e.link_faces:
                    votes[cur[g.index]] = votes.get(cur[g.index], 0) + 1
            f.material_index = max(votes, key=votes.get)
    fb.to_mesh(me)
    fb.free()
    slot = lambda pre: next((i for i, m in enumerate(me.materials) if m and m.name.startswith(pre)), None)
    J, PA, BE, SK, SO = slot('jersey'), slot('pants'), slot('sole'), slot('skin'), slot('socks')
    k0 = kind.split('_')[0]
    for p in me.polygons:   # straight hems: jersey tucked at the belt, sleeve cut, pants ending below the knee
        c, mi = p.center, p.material_index
        sx = 1 if c.x > 0 else -1
        if k0 == 'torso' and c.z < 1.06:
            p.material_index = PA if c.z < 1.02 else BE if c.z < 1.05 else (J if mi == PA else mi)
        elif k0 == 'arm':
            a0, a1 = Vector((0.27 * sx, 0, 1.47)), Vector((0.31 * sx, 0, 1.17))
            t = (c - a0).dot(a1 - a0) / (a1 - a0).length_squared
            if -0.6 < t < 0.42 and mi == SK:
                p.material_index = J
            elif t >= 0.42 and mi == J:
                p.material_index = SK
        elif k0 == 'leg':
            a0, a1 = Vector((0.12 * sx, 0, 0.52)), Vector((0.12 * sx, 0.02, 0.10))
            t = (c - a0).dot(a1 - a0) / (a1 - a0).length_squared
            if 0 < t < 0.17 and mi == SO:
                p.material_index = PA
            elif t >= 0.17 and mi == PA:
                p.material_index = SO
    W = []
    for v in me.vertices:
        loc, _, fi, _ = tree.find_nearest(v.co)
        acc = {}
        for fv in bm.faces[fi].verts:
            k = 1.0 / ((fv.co - loc).length + 1e-4)
            for b, w in sw[fv.index].items():
                acc[b] = acc.get(b, 0.0) + w * k
        W.append(acc)
    nb = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nb[a].append(b)
        nb[b].append(a)
    for _ in range(2):   # soften weight seams so joints bend smoothly
        W = [{b: 0.5 * W[i].get(b, 0) + 0.5 * sum(W[j].get(b, 0) for j in nb[i]) / max(1, len(nb[i]))
              for b in set(W[i]).union(*[W[j] for j in nb[i]])} for i in range(len(W))]
    for i, acc in enumerate(W):
        tot = sum(acc.values()) or 1.0
        for b, w in acc.items():
            if w / tot > 0.01:
                (sh.vertex_groups.get(b) or sh.vertex_groups.new(name=b)).add([i], w / tot, 'REPLACE')
    bm.free()
    bpy.data.objects.remove(src)
    lib.box_uv(sh, 0.5)
    return lib.smooth(sh)


def build_player(colors, sfx='', offset=(0, 0, 0)):
    M = materials(colors, sfx)
    parts = build_body(M, int(colors['number']), sfx)
    decals = [p for p in parts if p.name.startswith('num_')]
    groups = {'torso': []}
    for p in parts:
        if p in decals:
            continue
        side = 'L' if '_L' in p.name else 'R' if '_R' in p.name else None
        kind = 'arm' if p.name.split('_')[0] in ARM_PARTS else 'leg' if side else 'torso'
        groups.setdefault(kind if kind == 'torso' else f'{kind}_{side}', []).append(p)
    shells = [unify(objs, f'{k}{sfx}', *SHELL[k.split('_')[0]], k) for k, objs in groups.items()]
    body = lib.join(shells + decals, 'body' + sfx)
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

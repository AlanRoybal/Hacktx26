"""Low-poly segmented football player, rigid-bound to an 18-bone rig, with scripted actions.
blender -b --python assets/blender/build_player.py [-- --no-render]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import bpy
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

DIGITS = {
    '0': ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'], '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
    '2': ['XXX', '..X', 'XXX', 'X..', 'XXX'], '3': ['XXX', '..X', '.XX', '..X', 'XXX'],
    '4': ['X.X', 'X.X', 'XXX', '..X', '..X'], '5': ['XXX', 'X..', 'XXX', '..X', 'XXX'],
    '6': ['XXX', 'X..', 'XXX', 'X.X', 'XXX'], '7': ['XXX', '..X', '.X.', '.X.', '.X.'],
    '8': ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'], '9': ['XXX', 'X.X', 'XXX', '..X', 'XXX'],
}
LONGHORN = [
    'X......................X',
    'XX....................XX',
    '.XX..................XX.',
    '..XXX..............XXX..',
    '...XXXXX........XXXXX...',
    '.....XXXXXXXXXXXXXX.....',
    '.......XXXXXXXXXX.......',
    '........XXXXXXXX........',
    '.........XXXXXX.........',
    '.........XXXXXX.........',
    '..........XXXX..........',
    '...........XX...........',
]
OU_LOGO = [
    '....XXXXXXXX....',
    '..XXX......XXX..',
    '.XX..........XX.',
    'XX..XX....XX..XX',
    'XX..XX....XX..XX',
    'XX..XX....XX..XX',
    'XX..XX....XX..XX',
    '.XX.XX....XX.XX.',
    '..XXXX....XXXX..',
    '....XX....XX....',
    '....XXX..XXX....',
    '.....XXXXXX.....',
]


def number_image(num, tag):
    rows = ['' for _ in range(5)]
    for i, d in enumerate(num):
        for r in range(5):
            rows[r] += ('.' if i else '') + DIGITS[d][r]
    w = len(rows[0])
    side = max(w, 5) + 2
    padded = ['.' * side] + [('.' * ((side - w) // 2) + r).ljust(side, '.') for r in rows] + ['.' * side] * (side - 6)
    return lib.image_from_array(f'numbers_{tag}', lib.pixel_art(padded, '#FFFFFF', scale=8))


def logo_image(kind):
    if kind == 'texas':
        return lib.image_from_array('logo_texas', lib.pixel_art(LONGHORN, '#BF5700', scale=4, pad=2))
    rows = [r.center(24, '.') for r in OU_LOGO]
    return lib.image_from_array('logo_ou', lib.pixel_art(rows, '#F2EEE6', scale=4, pad=2))


def materials(c, sfx=''):
    M = {k: lib.mat(k + sfx, c[k], tex='grime') for k in ('jersey', 'pants', 'helmet', 'socks', 'gloves', 'shoes')}
    M['facemask'] = lib.mat('facemask' + sfx, c['facemask'], rough=0.5, tex=None)
    M['skin'] = lib.mat('skin' + sfx, c['skin'], rough=0.7, tex='grime_skin')
    M['numbers'] = lib.mat('numbers' + sfx, c['numbers'], image=number_image(c['number'], c['number'] + sfx), alpha_clip=True)
    M['helmet_logo'] = lib.mat('helmet_logo' + sfx, '#FFFFFF', image=logo_image(c['logo']), alpha_clip=True)
    M['face'] = lib.mat('face' + sfx, '#0B0B0B', tex=None)
    return M


def build_body(M, sfx=''):
    parts = []  # (obj, bone)

    def add(ob, bone, uv=0.5):
        lib.apply(ob)
        if uv:
            lib.box_uv(ob, uv)
        parts.append((ob, bone))
        return ob

    add(lib.box('pelvis', (0.36, 0.25, 0.22), (0, 0, 1.0), M['pants'], taper=(1.06, 1.04)), 'hips')
    add(lib.box('belly', (0.34, 0.25, 0.24), (0, 0, 1.2), M['jersey'], taper=(1.18, 1.1)), 'spine')
    add(lib.box('chest', (0.46, 0.31, 0.24), (0, 0, 1.40), M['jersey'], taper=(1.05, 1.0)), 'chest')
    add(lib.box('pads', (0.70, 0.37, 0.13), (0, 0, 1.53), M['jersey'], taper=(0.72, 0.8)), 'chest')
    for s, x in (('L', 1), ('R', -1)):
        add(lib.box(f'pad_{s}', (0.2, 0.33, 0.15), (0.27 * x, 0, 1.49), M['jersey'], taper=(0.75, 0.85)), 'chest')
        add(lib.box(f'sleeve_{s}', (0.16, 0.16, 0.13), (0.29 * x, 0, 1.39), M['jersey'], taper=(1.1, 1.1)), f'upperarm_{s}')
        add(lib.box(f'bicep_{s}', (0.12, 0.125, 0.2), (0.30 * x, 0, 1.25), M['skin'], taper=(1.1, 1.1)), f'upperarm_{s}')
        add(lib.box(f'forearm_{s}', (0.10, 0.105, 0.25), (0.322 * x, -0.01, 1.05), M['skin'], taper=(1.2, 1.2)), f'forearm_{s}')
        add(lib.box(f'hand_{s}', (0.075, 0.1, 0.12), (0.336 * x, -0.025, 0.87), M['gloves']), f'hand_{s}')
        add(lib.box(f'thigh_{s}', (0.17, 0.19, 0.44), (0.115 * x, 0, 0.74), M['pants'], taper=(1.12, 1.12)), f'thigh_{s}')
        add(lib.box(f'knee_{s}', (0.15, 0.06, 0.1), (0.12 * x, -0.09, 0.53), M['pants']), f'thigh_{s}')
        add(lib.box(f'shin_{s}', (0.12, 0.13, 0.42), (0.12 * x, 0.01, 0.31), M['socks'], taper=(1.18, 1.2)), f'shin_{s}')
        add(lib.box(f'shoe_{s}', (0.11, 0.27, 0.09), (0.12 * x, -0.05, 0.045), M['shoes'], taper=(1, 0.9)), f'foot_{s}')
    add(lib.cyl('neck', 0.075, 0.12, (0, 0, 1.58), 8, M['skin']), 'neck')
    add(lib.box('face', (0.16, 0.05, 0.15), (0, -0.115, 1.70), M['face']), 'head', uv=0)
    # numbers: front, back, and shoulder tops
    add(lib.quad('num_front', (0, -0.161, 1.37), (1, 0, 0), (0, 0, 1), 0.22, 0.22, M['numbers']), 'chest', uv=0)
    add(lib.quad('num_back', (0, 0.161, 1.37), (-1, 0, 0), (0, 0, 1), 0.24, 0.24, M['numbers']), 'chest', uv=0)

    return parts


def build_helmet(M, sfx=''):
    shell = lib.sphere('helmet' + sfx, 0.152, (0, 0.012, 1.735), u=10, v=7, material=M['helmet'], scale=(1, 1.14, 1.04))
    lib.apply(shell)
    # cut the face opening: drop the front-lower verts back in
    for v in shell.data.vertices:
        if v.co.y < -0.08 and v.co.z < 1.74:
            v.co.y = max(v.co.y, -0.11)
    lib.box_uv(shell, 0.5)
    bars = []
    for z in (1.655, 1.705):
        bars.append(lib.box('bar', (0.2, 0.018, 0.018), (0, -0.16, z), M['facemask']))
    bars.append(lib.box('bar', (0.018, 0.018, 0.09), (0, -0.165, 1.68), M['facemask']))
    for x in (1, -1):
        bars.append(lib.box('bar', (0.018, 0.08, 0.018), (0.1 * x, -0.125, 1.70), M['facemask'], rot=(0, 0, math.radians(-35 * x))))
        bars.append(lib.box('bar', (0.018, 0.018, 0.1), (0.1 * x, -0.15, 1.68), M['facemask']))
    for b in bars:
        lib.apply(b)
    mask = lib.join(bars, 'facemask' + sfx)
    logos = [lib.quad('logo_L', (0.156, 0.02, 1.75), (0, 1, 0), (0, 0, 1), 0.13, 0.075, M['helmet_logo']),
             lib.quad('logo_R', (-0.156, 0.02, 1.75), (0, -1, 0), (0, 0, 1), 0.13, 0.075, M['helmet_logo'])]
    for lg in logos:
        lib.apply(lg)
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
    parts = build_body(M, sfx)
    for ob, bone in parts:
        ob.vertex_groups.new(name=bone).add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    body = lib.join([o for o, _ in parts], 'body' + sfx)
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

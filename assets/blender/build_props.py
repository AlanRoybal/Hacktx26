"""Props: goalposts, pylons, chains + down marker, bench, crowd unit, Smokey the Cannon.
Each prop is a separate named root node in public/models/props.glb so code can clone it.
blender -b --python assets/blender/build_props.py"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import bpy
import lib

YD = 0.9144


def finish(parts, name, uv=0.5, loc=(0, 0, 0)):
    for p in parts:
        lib.apply(p)
        lib.box_uv(p, uv)
    ob = lib.join(parts, name)
    ob.location = loc
    return ob


def goalpost(name, loc=(0, 0, 0)):
    y = lib.mat('goalpost_yellow', '#E8C21E', rough=0.5, tex='grime')
    pad = lib.mat('post_pad', '#1A2633', tex='grime')
    # base post sits behind the end line; the crossbar is 3.05 m high, uprights 5.64 m apart and 9 m tall
    parts = [lib.cyl('base', 0.12, 3.05, (0, 1.8, 1.525), 8, y),
             lib.cyl('pad', 0.3, 2.0, (0, 1.8, 1.0), 8, pad),
             lib.box('gooseneck', (0.2, 1.8, 0.2), (0, 0.9, 3.05), y),
             lib.box('crossbar', (5.84, 0.18, 0.18), (0, 0, 3.05), y)]
    for x in (-2.82, 2.82):
        parts.append(lib.cyl('upright', 0.06, 9.0, (x, 0, 3.05 + 4.5), 6, y))
    return finish(parts, name, 1.0, loc)


def pylon(name, loc=(0, 0, 0)):
    o = lib.mat('pylon_orange', '#FF6A13', rough=0.6, tex='grime')
    return finish([lib.box('pylon', (0.1, 0.1, 0.45), (0, 0, 0.225), o)], name, 0.3, loc)


def chain_set(name, loc=(0, 0, 0)):
    o = lib.mat('pylon_orange', '#FF6A13', rough=0.6, tex='grime')
    pole = lib.mat('chain_pole', '#151515', tex='grime')
    chain = lib.mat('chain', '#9A9A9A', rough=0.4, metal=0.8, tex=None)
    parts = []
    for yy in (0, 10 * YD):
        parts += [lib.cyl('pole', 0.03, 2.4, (0, yy, 1.2), 6, pole), lib.box('marker', (0.25, 0.08, 0.35), (0, yy, 2.45), o)]
    parts.append(lib.box('chain', (0.02, 10 * YD, 0.02), (0, 5 * YD, 0.9), chain))
    return finish(parts, name, 0.5, loc)


def down_marker(name, loc=(0, 0, 0)):
    o = lib.mat('pylon_orange', '#FF6A13', rough=0.6, tex='grime')
    pole = lib.mat('chain_pole', '#151515', tex='grime')
    parts = [lib.cyl('pole', 0.03, 2.4, (0, 0, 1.2), 6, pole), lib.box('flip', (0.08, 0.35, 0.35), (0, 0, 2.5), o)]
    return finish(parts, name, 0.5, loc)


def bench(name, loc=(0, 0, 0), team='#BF5700'):
    m = lib.mat('bench_' + team.strip('#'), team, tex='grime')
    leg = lib.mat('steel', '#4A4C50', rough=0.6, metal=0.4, tex='grime')
    parts = [lib.box('seat', (0.45, 6.0, 0.08), (0, 0, 0.45), m), lib.box('back', (0.06, 6.0, 0.45), (0.22, 0, 0.75), m)]
    for yy in (-2.7, 0, 2.7):
        parts.append(lib.box('leg', (0.4, 0.06, 0.45), (0, yy, 0.22), leg))
    return finish(parts, name, 1.0, loc)


CALM_ARMS = [[(0.19, 0, 0.66), (0.23, -0.07, 0.46), (0.07, -0.2, 0.52)], [(-0.19, 0, 0.66), (-0.23, -0.07, 0.46), (-0.07, -0.2, 0.52)]]
HYPE_ARMS = [[(0.19, 0, 0.66), (0.27, -0.06, 0.92), (0.25, -0.04, 1.17)], [(-0.19, 0, 0.66), (-0.27, -0.06, 0.92), (-0.25, -0.04, 1.17)]]
SIGN_CALM = dict(arms=[[(0.19, 0, 0.66), (0.24, -0.12, 0.6), (0.2, -0.24, 0.78)], [(-0.19, 0, 0.66), (-0.24, -0.12, 0.6), (-0.2, -0.24, 0.78)]],
                 board=(0, -0.27, 0.88))
SIGN_HYPE = dict(arms=[[(0.19, 0, 0.66), (0.25, -0.08, 0.95), (0.22, -0.12, 1.24)], [(-0.19, 0, 0.66), (-0.25, -0.08, 0.95), (-0.22, -0.12, 1.24)]],
                 board=(0, -0.15, 1.42))


def fan(name, arms, lift=0.0, board=None, attire=None):
    shirt = lib.mat('crowd_shirt', '#FFFFFF', tex='grime')
    skin = lib.mat('crowd_skin', '#A06E4C', rough=0.8, tex=None)
    z = lambda p: (p[0], p[1], p[2] + lift)
    parts = [lib.loft('torso', z((0, 0, 0.2)), z((0, 0, 0.72)), [(0, .2, .13), (0.6, .21, .12), (1, .17, .1)], 6, shirt),
             lib.loft('neck', z((0, 0, 0.7)), z((0, 0, 0.78)), [(0, .05, .05), (1, .045, .045)], 4, skin)]
    hd = lib.sphere('head', 1.0, z((0, -0.01, 0.87)), 6, 5, skin, scale=(0.095, 0.105, 0.115))
    parts.append(hd)
    for pts in arms:
        parts.append(lib.tube('arm', [z(q) for q in pts], 0.045, 4, shirt))
    if attire == 'cowboy':   # straw/felt hat: brim + crown
        hat = lib.mat('crowd_hat', '#FFFFFF', rough=0.8, tex='grime')
        parts.append(lib.cyl('brim', 0.2, 0.018, z((0, -0.01, 0.955)), 12, hat))
        parts.append(lib.cyl('crown', 0.085, 0.13, z((0, -0.01, 1.02)), 10, hat, r2=0.075))
    if attire == 'jersey':   # number on the chest, atlas cell picked per fan in code
        nm = lib.mat('crowd_number', '#FFFFFF', rough=0.8, image=lib.load_tex('numbers_atlas.png'), alpha_clip=True)
        q = lib.quad('jnum', z((0, -0.128, 0.5)), (-1, 0, 0), (0, 0, 1), 0.2, 0.2, nm)
        uvl = q.data.uv_layers['UVMap']
        for l in q.data.loops:   # cell of #16 in the 10x10 atlas (col 6, row 1)
            uv = uvl.data[l.index].uv
            uv[0], uv[1] = (6 + uv[0]) / 10, 1 - (2 - uv[1]) / 10
        stripe = lib.mat('crowd_stripe', '#FFFFFF', rough=0.85, tex=None)
        for x in (1, -1):
            parts.append(lib.box('stripe', (0.03, 0.27, 0.05), z((0.205 * x, 0, 0.62)), stripe))
    ob = finish(parts, name, 0.5)
    lib.smooth(ob)
    if attire == 'jersey':
        ob = lib.join([ob, q], name)
    if board:
        sm = lib.mat('crowd_sign', '#FFFFFF', rough=0.7, image=lib.load_tex('crowd_signs.png'))
        back = lib.mat('crowd_sign_back', '#B8A27A', tex='grime')
        c = z(board)
        front = lib.quad('sign', c, (-1, 0, 0), (0, 0, 1), 0.9, 0.45, sm)
        for l in front.data.loops:
            uv = front.data.uv_layers['UVMap'].data[l.index].uv
            uv[0], uv[1] = uv[0] * 0.25, 0.5 + uv[1] * 0.5
        rear = lib.quad('sign_back', (c[0], c[1] + 0.01, c[2]), (1, 0, 0), (0, 0, 1), 0.9, 0.45, back)
        ob = lib.join([ob, front, rear], name)
    return ob


def with_hype(base, hype):
    """Adds shape key 'hype' (exported as glTF morph target; three.js InstancedMesh.setMorphAt per fan)."""
    base.shape_key_add(name='Basis')
    k = base.shape_key_add(name='hype')
    for i, v in enumerate(hype.data.vertices):
        k.data[i].co = v.co
    bpy.data.objects.remove(hype)
    return base


def crowd_unit(name, loc=(0, 0, 0)):
    """~90 tri fan facing -Y. Basis = standing/clapping, 'hype' = jumping with arms up. Code tints per instance."""
    ob = with_hype(fan(name, CALM_ARMS), fan(name + '_h', HYPE_ARMS, lift=0.12))
    ob.location = loc
    return ob


def crowd_variant(name, attire, loc=(0, 0, 0)):
    ob = with_hype(fan(name, CALM_ARMS, attire=attire), fan(name + '_h', HYPE_ARMS, lift=0.12, attire=attire))
    ob.location = loc
    return ob


def crowd_sign(name, loc=(0, 0, 0)):
    """Fan holding a sign. UVs point at atlas cell 0; code offsets u by 0.25*col and v by -0.5 for OU signs."""
    ob = with_hype(fan(name, SIGN_CALM['arms'], board=SIGN_CALM['board']),
                   fan(name + '_h', SIGN_HYPE['arms'], lift=0.08, board=SIGN_HYPE['board']))
    ob.location = loc
    return ob


def cannon(name, loc=(0, 0, 0)):
    """Smokey the Cannon: barrel on a two-wheel carriage, Texas flag colors on the wheels."""
    iron = lib.mat('cannon_iron', '#2A2A2C', rough=0.45, metal=0.7, tex='grime')
    wood = lib.mat('cannon_wheel', '#BF5700', tex='grime')
    rim = lib.mat('cannon_rim', '#EDEAE2', tex='grime')
    parts = [lib.cyl('barrel', 0.22, 2.6, (0, -0.4, 1.1), 10, iron, r2=0.16, rot=(math.radians(80), 0, 0)),
             lib.cyl('breech', 0.26, 0.35, (0, 0.85, 1.32), 10, iron, rot=(math.radians(80), 0, 0)),
             lib.box('carriage', (0.6, 1.8, 0.35), (0, 0.4, 0.8), wood),
             lib.box('trail', (0.25, 1.6, 0.18), (0, 1.6, 0.35), wood, rot=(math.radians(-18), 0, 0))]
    for x in (0.55, -0.55):
        parts.append(lib.cyl('wheel', 0.8, 0.14, (x, 0.2, 0.8), 12, rim, rot=(0, math.radians(90), 0)))
        parts.append(lib.cyl('hub', 0.55, 0.16, (x, 0.2, 0.8), 12, wood, rot=(0, math.radians(90), 0)))
    ob = finish(parts, name, 0.5, loc)
    muzzle = bpy.data.objects.new('muzzle', None)
    bpy.context.scene.collection.objects.link(muzzle)
    muzzle.parent = ob
    muzzle.location = (0, -1.68, 1.33)
    return ob, muzzle


def build(offset=True):
    sp = 4.0 if offset else 0.0
    objs = [goalpost('goalpost_home', (0, 0, 0)), goalpost('goalpost_away', (sp * 2, 0, 0))]
    objs += [pylon(f'pylon_{i}', (sp * 4 + i * 0.3, 0, 0)) for i in range(8)]
    objs += [chain_set('chains', (sp * 5, 0, 0)), down_marker('down_marker', (sp * 5.5, 0, 0)),
             bench('bench_texas', (sp * 6, 0, 0), '#BF5700'), bench('bench_ou', (sp * 7, 0, 0), '#841617'),
             crowd_unit('crowd_unit', (sp * 8, 0, 0)), crowd_sign('crowd_sign', (sp * 8.5, 0, 0)),
             crowd_variant('crowd_jersey', 'jersey', (sp * 9, 0, 0)), crowd_variant('crowd_cowboy', 'cowboy', (sp * 9.5, 0, 0))]
    c, m = cannon('smokey', (sp * 9, 0, 0))
    return objs + [c, m]


if __name__ == '__main__':
    lib.reset()
    objs = build()
    print('PROPS_TRIS', lib.tri_count(objs))
    lib.export('props', selection=objs)
    lib.save('props')

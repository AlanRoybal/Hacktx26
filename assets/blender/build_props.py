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


def crowd_unit(name, loc=(0, 0, 0)):
    """~40 tri fan: torso, head, both arms raised. Faces -Y. Code instances it and sets per-instance color."""
    shirt = lib.mat('crowd_shirt', '#FFFFFF', tex='grime')
    skin = lib.mat('crowd_skin', '#A06E4C', rough=0.8, tex=None)
    parts = [lib.box('torso', (0.42, 0.26, 0.55), (0, 0, 0.45), shirt, taper=(1.1, 1.0)),
             lib.box('head', (0.2, 0.22, 0.24), (0, 0, 0.86), skin)]
    for x in (1, -1):
        parts.append(lib.box('arm', (0.1, 0.1, 0.5), (0.25 * x, -0.03, 0.95), shirt, rot=(0, math.radians(-12 * x), 0)))
    return finish(parts, name, 0.5, loc)


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
             crowd_unit('crowd_unit', (sp * 8, 0, 0))]
    c, m = cannon('smokey', (sp * 9, 0, 0))
    return objs + [c, m]


if __name__ == '__main__':
    lib.reset()
    objs = build()
    print('PROPS_TRIS', lib.tri_count(objs))
    lib.export('props', selection=objs)
    lib.save('props')

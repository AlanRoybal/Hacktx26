"""Football (28 cm prolate spheroid, laces, college end stripes) and first-person throwing arm.
blender -b --python assets/blender/build_ball.py [-- --no-render]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import bpy, bmesh
from mathutils import Vector
import lib


def build_ball(name='football', loc=(0, 0, 0)):
    leather = lib.mat('leather', '#6E3B1F', rough=0.75, tex='grime_leather')
    white = lib.mat('ball_white', '#EDE9DF', rough=0.7, tex='grime')
    R, L = 0.085, 0.14
    bm = bmesh.new()
    rings, segs = 11, 12
    verts = []
    for i in range(1, rings):
        t = -1 + 2 * i / rings
        r = R * (1 - t * t)
        verts.append([bm.verts.new((r * math.cos(2 * math.pi * j / segs), t * L, r * math.sin(2 * math.pi * j / segs))) for j in range(segs)])
    tip0, tip1 = bm.verts.new((0, -L, 0)), bm.verts.new((0, L, 0))
    for a, b in zip(verts, verts[1:]):
        for j in range(segs):
            bm.faces.new((a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j]))
    for j in range(segs):
        bm.faces.new((tip0, verts[0][(j + 1) % segs], verts[0][j]))
        bm.faces.new((tip1, verts[-1][j], verts[-1][(j + 1) % segs]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ball = lib.new_obj(name, bm, leather)
    lib.box_uv(ball, 0.25)
    parts = [ball]
    for s in (1, -1):
        t = 0.62
        st = lib.cyl('stripe', R * (1 - t * t) * 1.06, 0.014, (0, t * L * s, 0), 12, white, rot=(math.radians(90), 0, 0), cap=False)
        lib.apply(st)
        parts.append(st)
    lace = lib.box('lace', (0.012, 0.09, 0.006), (0, 0, 0.087), white)
    lib.apply(lace)
    parts.append(lace)
    for i in range(6):
        c = lib.box('lace', (0.032, 0.006, 0.006), (0, -0.035 + i * 0.014, 0.089), white)
        lib.apply(c)
        parts.append(c)
    ob = lib.join(parts, name)
    ob.location = loc
    return ob


def build_arm():
    """Right forearm + glove holding the ball, camera-space friendly: elbow at origin, pointing -Y (forward)."""
    jersey = lib.mat('jersey', '#BF5700', tex='grime')
    skin = lib.mat('skin', '#8A5A3C', rough=0.7, tex='grime_skin')
    glove = lib.mat('gloves', '#E4E2DC', tex='grime')
    band = lib.mat('wristband', '#EDEAE2', tex='grime')
    tape = lib.mat('tape', '#D9D4C7', tex='grime')
    parts = [
        lib.box('sleeve', (0.15, 0.14, 0.15), (0, 0.04, 0), jersey, rot=(math.radians(90), 0, 0)),
        lib.box('forearm', (0.105, 0.30, 0.10), (0, -0.16, 0), skin, taper=(1, 1)),
        lib.box('band', (0.115, 0.05, 0.11), (0, -0.29, 0), band),
        lib.box('palm', (0.10, 0.11, 0.05), (0, -0.37, 0.02), glove),
        lib.box('fingers', (0.10, 0.08, 0.03), (0, -0.44, 0.045), glove, rot=(math.radians(-25), 0, 0)),
        lib.box('thumb', (0.03, 0.07, 0.03), (-0.06, -0.38, 0.05), glove, rot=(0, 0, math.radians(30))),
        lib.box('tape', (0.108, 0.03, 0.104), (0, -0.20, 0), tape),
    ]
    for p in parts:
        lib.apply(p)
        lib.box_uv(p, 0.3)
    arm = lib.join(parts, 'fp_arm')
    ball = build_ball('fp_ball', (0, -0.42, 0.13))
    ball.rotation_euler = (math.radians(-10), 0, math.radians(75))
    root = bpy.data.objects.new('fp_root', None)
    bpy.context.scene.collection.objects.link(root)
    arm.parent = root
    ball.parent = root
    return root, arm, ball


if __name__ == '__main__':
    lib.reset()
    ball = build_ball()
    print('BALL_TRIS', lib.tri_count([ball]))
    lib.export('football', selection=[ball])
    lib.save('football')
    bpy.data.objects.remove(ball)
    root, arm, fball = build_arm()
    print('ARM_TRIS', lib.tri_count([arm, fball]))
    lib.export('fp_arm', selection=[root, arm, fball])
    lib.save('fp_arm')
    if '--no-render' not in lib.args():
        b2 = build_ball('ball_preview', (0.55, 0.1, 0.09))
        b2.rotation_euler = (0, math.radians(8), math.radians(35))
        root.location = (-0.25, 0.25, 0.25)
        root.rotation_euler = (0, 0, math.radians(-30))
        cam = lib.preview_scene(target=(0.2, -0.05, 0.15), dist=1.6, height=1.0, light_power=400)
        sc = bpy.context.scene
        paths = []
        for i, ang in enumerate((20, 140)):
            r = math.radians(ang)
            cam.location = (0.2 - math.sin(r) * 1.4, -0.05 - math.cos(r) * 1.4, 0.75)
            lib.look_at(cam, (0.2, -0.05, 0.15))
            p = os.path.join(lib.RENDERS, 'raw', f'ball_{i}.png')
            sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            paths.append(p)
        print('RENDERS', paths)

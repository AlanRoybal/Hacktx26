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
    rings, segs = 13, 16
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
    lib.smooth(ball)
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


R_BALL, L_BALL = 0.085, 0.14


def on_ball(y, phi, off):
    """Point on the ball surface (ball long axis = Y, laces at +Z, phi from +Z toward +X), pushed out by off."""
    r = R_BALL * (1 - (y / L_BALL) ** 2) + off
    return (r * math.sin(math.radians(phi)), y, r * math.cos(math.radians(phi)))


def build_arm():
    """Right hand gripping the ball across the laces. Origin = ball center, nose toward -Y, laces +Z.
    The hand sits on the -X side (the QB's right), fingers wrap over the laces, thumb underneath."""
    jersey = lib.mat('jersey', '#BF5700', tex='grime')
    skin = lib.mat('skin', '#8A5A3C', rough=0.7, tex='grime_skin')
    glove = lib.mat('gloves', '#E4E2DC', tex='grime')
    band = lib.mat('wristband', '#EDEAE2', tex='grime')
    tape = lib.mat('tape', '#E6E2D8', tex='grime')
    E, W = Vector((-0.13, 0.40, -0.11)), Vector((-0.10, 0.125, -0.035))
    fr = 0.0105
    parts = [
        lib.loft('sleeve', E + (E - W).normalized() * 0.14, E - (E - W).normalized() * 0.02, [(0, .078, .082), (0.7, .072, .075), (1, .066, .068)], 12, jersey),
        lib.loft('forearm', E, W, [(0, .052, .055), (0.3, .056, .058), (0.85, .04, .036), (1, .037, .033)], 12, skin),
        lib.loft('tape', E, W, [(0.5, .052, .052), (0.68, .048, .047)], 12, tape),
        lib.loft('band', E, W, [(0.8, .046, .043), (1.0, .043, .04)], 12, band),
    ]
    # palm: flattened slab hugging the ball's right side, from the wrist to the finger roots
    pc0, pc1 = Vector(on_ball(0.075, -105, 0.022)), Vector(on_ball(0.01, -92, 0.016))
    palm = lib.loft('palm', W, pc0, [(0, .036, .03), (1, .042, .016)], 10, glove, side=(0, 0, 1))
    palm2 = lib.loft('palm2', pc0, pc1, [(0, .046, .016), (1, .044, .014)], 10, glove, side=(0, 0, 1))
    parts += [palm, palm2]
    # fingers: index nearest the back tip, pinky toward the middle, each wraps from the side over the laces
    for k, (y, reach) in enumerate(((0.052, 30), (0.028, 42), (0.004, 38), (-0.02, 22))):
        angles = [-88, -60, -32, -6, reach * 0.5, reach]
        pts = [on_ball(y + 0.004 * (a / 90.0), a, fr + 0.001) for a in angles]
        parts.append(lib.tube('finger', pts, fr if k < 3 else fr * 0.9, 6, glove))
    thumb = [on_ball(0.07, -112, 0.016), on_ball(0.062, -135, fr), on_ball(0.05, -160, fr), on_ball(0.04, -182, fr)]
    parts.append(lib.tube('thumb', thumb, 0.012, 6, glove))
    for p in parts:
        lib.box_uv(p, 0.3)
        lib.smooth(p)
    arm = lib.join(parts, 'fp_arm')
    ball = build_ball('fp_ball', (0, 0, 0))
    root = bpy.data.objects.new('fp_root', None)
    bpy.context.scene.collection.objects.link(root)
    arm.parent = root
    ball.parent = root
    return root, arm, ball


def grip_previews(root):
    cam = lib.preview_scene(target=(0, 0, 0), dist=0.9, height=0.3, light_power=300, ground=False)
    sc = bpy.context.scene
    root.location = (0, 0, 0.0)
    paths = []
    for i, (ang, h) in enumerate(((200, 0.25), (110, 0.15), (300, 0.35), (20, -0.2))):
        r = math.radians(ang)
        cam.location = (-math.sin(r) * 0.75, -math.cos(r) * 0.75 + 0.1, h)
        lib.look_at(cam, (-0.03, 0.08, 0.0))
        p = os.path.join(lib.RENDERS, 'raw', f'grip_{i}.png')
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths


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
        print('RENDERS', grip_previews(root))

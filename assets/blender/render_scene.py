"""Night-game preview of all assets together (Cycles + mist fog), first-person QB shot and a wide shot.
blender -b --python assets/blender/render_scene.py ; then lethal_post.py adds dither/grain/pixel upscale."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(__file__))
import bpy
import numpy as np
from mathutils import Vector
import lib, build_stadium, build_props, build_player, build_ball

YD = 0.9144
LOS = -50 * YD + 45 * YD   # Texas ball on the OU 45, driving toward -Y


def crowd_mesh(template, seats):
    tv = np.array([v.co[:] for v in template.data.vertices], np.float32)
    tf = [list(p.vertices) for p in template.data.polygons]
    n, k = len(seats), len(tv)
    S = np.array(seats, np.float32)
    rng = np.random.default_rng(11)
    out = np.empty((n * k, 3), np.float32)
    for i, (x, y, z, yaw, team) in enumerate(seats):
        c, s = math.cos(yaw), math.sin(yaw)
        sc = rng.uniform(0.9, 1.08)
        r = tv * sc
        rx = r[:, 0] * c - r[:, 1] * s
        ry = r[:, 0] * s + r[:, 1] * c
        out[i * k:(i + 1) * k] = np.stack([rx + x, ry + y, r[:, 2] + z], 1)
    faces = [[f + i * k for f in face] for i in range(n) for face in tf]
    me = bpy.data.meshes.new('crowd')
    me.from_pydata(out.tolist(), [], faces)
    cols = np.empty((n * k, 4), np.float32)
    team_cols = [lib.lin('#BF5700'), lib.lin('#841617')]
    for i, seat in enumerate(seats):
        r = rng.random()
        col = team_cols[int(seat[4])] if r < 0.72 else (lib.lin('#E8E4DA') if r < 0.9 else lib.lin('#1A1A1A'))
        cols[i * k:(i + 1) * k] = col
    attr = me.color_attributes.new('team', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', cols.ravel())
    m = bpy.data.materials.new('crowd_preview')
    m.use_nodes = True
    nt = m.node_tree
    ca = nt.nodes.new('ShaderNodeVertexColor')
    ca.layer_name = 'team'
    nt.links.new(ca.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    nt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    me.materials.append(m)
    ob = bpy.data.objects.new('crowd', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def beams_glow(strength=0.012):
    m = bpy.data.materials['beam']
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    tr, em, add = nt.nodes.new('ShaderNodeBsdfTransparent'), nt.nodes.new('ShaderNodeEmission'), nt.nodes.new('ShaderNodeAddShader')
    em.inputs['Color'].default_value = lib.lin('#FFF1D6')
    em.inputs['Strength'].default_value = strength
    nt.links.new(tr.outputs[0], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], nt.nodes['Material Output'].inputs['Surface'])


def place(colors, sfx, pos, action, frame, facing):
    root, rig, meshes, acts = build_player.build_player(colors, sfx)
    root.location = (pos[0], pos[1], 0)
    root.rotation_euler = (0, 0, math.radians(facing))
    build_player.pose_at(rig, acts[action], frame)
    return root


def formation():
    T, O = build_player.TEXAS, build_player.OU
    off = [((0, LOS + 0.7), 'Stance3pt', 0), ((1.3, LOS + 0.8), 'Stance3pt', 5), ((-1.3, LOS + 0.8), 'Stance3pt', 9),
           ((2.6, LOS + 0.9), 'Stance3pt', 3), ((-2.6, LOS + 0.9), 'Stance3pt', 12), ((3.9, LOS + 1.0), 'Stance3pt', 7),
           ((-20, LOS + 0.8), 'Idle', 10), ((18, LOS + 0.8), 'Idle', 40), ((-11, LOS + 1.0), 'Idle', 25), ((1.0, LOS + 6.0), 'Idle', 50)]
    deff = [((0.9, LOS - 0.9), 'Stance3pt', 4), ((-0.9, LOS - 0.9), 'Stance3pt', 11), ((3.3, LOS - 0.9), 'Stance3pt', 0),
            ((-3.3, LOS - 0.9), 'Stance3pt', 8), ((2.6, LOS - 5), 'Idle', 20), ((-2.6, LOS - 5), 'Idle', 35),
            ((-20, LOS - 6), 'Idle', 0), ((18, LOS - 6), 'Idle', 45), ((-11, LOS - 5), 'Idle', 15),
            ((8, LOS - 13), 'Backpedal', 4), ((-8, LOS - 13), 'Backpedal', 12)]
    for i, (p, a, f) in enumerate(off):
        place(T, '', p, a, f, 0)
    for i, (p, a, f) in enumerate(deff):
        place(O, '_ou', p, a, f, 180)


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Punchy'
    w = bpy.data.worlds.new('night')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.0015, 0.002, 0.004, 1)
    w.mist_settings.start = 12
    w.mist_settings.depth = 140
    w.mist_settings.falloff = 'QUADRATIC'
    sc.world = w
    bpy.context.view_layer.use_pass_mist = True
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl, mix, comp, mul = nt.nodes.new('CompositorNodeRLayers'), nt.nodes.new('CompositorNodeMixRGB'), nt.nodes.new('CompositorNodeComposite'), nt.nodes.new('CompositorNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = 0.9
    mix.inputs[2].default_value = (0.03, 0.035, 0.045, 1)
    nt.links.new(rl.outputs['Mist'], mul.inputs[0])
    nt.links.new(mul.outputs[0], mix.inputs['Fac'])
    nt.links.new(rl.outputs['Image'], mix.inputs[1])
    nt.links.new(mix.outputs[0], comp.inputs['Image'])


def stadium_lights(lights):
    for i, (head, tgt) in enumerate(lights):
        L = bpy.data.lights.new(f'tower_light_{i}', 'SPOT')
        L.energy = 9.0e5
        L.spot_size = math.radians(48)
        L.spot_blend = 0.5
        L.color = (1.0, 0.94, 0.84)
        L.shadow_soft_size = 2.0
        o = bpy.data.objects.new(L.name, L)
        bpy.context.scene.collection.objects.link(o)
        o.location = head
        lib.look_at(o, tgt)


def shot(name, loc, target, lens):
    sc = bpy.context.scene
    cam = sc.camera
    cam.location = loc
    lib.look_at(cam, target)
    cam.data.lens = lens
    p = os.path.join(lib.RENDERS, 'raw', f'{name}.png')
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    return p


if __name__ == '__main__':
    lib.reset()
    objs, lights, seats = build_stadium.build()
    props = build_props.build(offset=False)
    tmpl = bpy.data.objects['crowd_unit']
    crowd_mesh(tmpl, seats)
    for o in props:
        o.hide_render = True
    gp1, gp2 = bpy.data.objects['goalpost_home'], bpy.data.objects['goalpost_away']
    for g, y in ((gp1, -60 * YD), (gp2, 60 * YD)):
        g.hide_render = False
        g.location = (0, y + (0 if y > 0 else 0), 0)
        if y < 0:
            g.rotation_euler = (0, 0, math.pi)
    for i, (x, y) in enumerate([(-24.4, -50 * YD), (24.4, -50 * YD), (-24.4, -60 * YD), (24.4, -60 * YD),
                                (-24.4, 50 * YD), (24.4, 50 * YD), (-24.4, 60 * YD), (24.4, 60 * YD)]):
        p = bpy.data.objects[f'pylon_{i}']
        p.hide_render = False
        p.location = (x, y, 0)
    for nm, loc in (('chains', (26.0, LOS - 10 * YD, 0)), ('down_marker', (-26.0, LOS, 0)), ('bench_texas', (-31.5, 0, 0)),
                    ('bench_ou', (31.5, 0, 0)), ('smokey', (-27, -58 * YD, 0))):
        o = bpy.data.objects[nm]
        o.hide_render = False
        o.location = loc
    bpy.data.objects['bench_ou'].rotation_euler = (0, 0, math.pi)
    bpy.data.objects['smokey'].rotation_euler = (0, 0, math.radians(-120))
    formation()
    beams_glow()
    stadium_lights(lights)
    setup_render()
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    # first-person QB in shotgun, arm + ball in frame
    root, arm, fball = build_ball.build_arm()
    qb = Vector((0.0, LOS + 4.6, 1.78))
    cam.location = qb
    lib.look_at(cam, (0, LOS - 25, 0.6))
    root.parent = cam
    root.location = (0.30, -0.34, -0.55)
    root.rotation_euler = (math.radians(70), math.radians(-12), math.radians(14))
    paths = [shot('scene_fp', qb, (0, LOS - 25, 0.6), 24)]
    root.hide_render = True
    for o in (arm, fball):
        o.hide_render = True
    paths.append(shot('scene_wide', (-14, LOS + 26, 13), (0, LOS - 6, 0), 26))
    paths.append(shot('scene_establish', (38, 95, 40), (0, 0, 0), 22))
    print('RENDERS', paths)

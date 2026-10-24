"""Night-game preview of all assets together (Cycles + mist fog), first-person QB shot and a wide shot.
blender -b --python assets/blender/render_scene.py ; then lethal_post.py adds dither/grain/pixel upscale."""
import sys, os, math, json, subprocess
sys.path.insert(0, os.path.dirname(__file__))
import bpy
import numpy as np
from mathutils import Vector, Matrix
import lib, build_stadium, build_props, build_player, build_ball

YD = 0.9144
LOS = -50 * YD + 45 * YD   # Texas ball on the OU 45, driving toward -Y


def tmpl_data(ob):
    me = ob.data
    base = np.array([v.co[:] for v in me.vertices], np.float32)
    hype = np.array([d.co[:] for d in me.shape_keys.key_blocks['hype'].data], np.float32)
    faces = [list(p.vertices) for p in me.polygons]
    names = [me.materials[p.material_index].name for p in me.polygons]
    uv = np.array([d.uv[:] for d in me.uv_layers['UVMap'].data], np.float32)
    sign_loops = np.zeros(len(uv), bool)
    skin = np.zeros(len(base), bool)
    for p, n in zip(me.polygons, names):
        if n == 'crowd_sign':
            sign_loops[p.loop_start:p.loop_start + p.loop_total] = True
        if n == 'crowd_skin':
            skin[list(p.vertices)] = True
    return dict(base=base, hype=hype, faces=faces, mat=[1 if n == 'crowd_sign' else 0 for n in names], uv=uv,
                sign_loops=sign_loops, skin=skin)


def crowd_mesh(name, seats, hype_frac, sign_frac=0.12):
    """Merges every fan into one mesh. Same seed for calm/hype so only the poses change."""
    T = {k: tmpl_data(bpy.data.objects[k]) for k in ('crowd_unit', 'crowd_sign')}
    rng = np.random.default_rng(11)
    team_cols = [lib.lin('#BF5700'), lib.lin('#841617')]
    skins = [lib.lin(c) for c in ('#8A5A3C', '#C08A64', '#5E3B26', '#D9A784')]
    co, fc, mi, uvs, cols, off = [], [], [], [], [], 0
    for x, y, z, yaw, team in seats:
        kind = 'crowd_sign' if rng.random() < sign_frac else 'crowd_unit'
        t = T[kind]
        hyped = rng.random() < hype_frac
        lift, sc, cell, r = rng.uniform(0, 0.2), rng.uniform(0.9, 1.08), rng.integers(4), rng.random()
        v = (t['hype'] if hyped else t['base']) * sc
        c, s_ = math.cos(yaw), math.sin(yaw)
        co.append(np.stack([v[:, 0] * c - v[:, 1] * s_ + x, v[:, 0] * s_ + v[:, 1] * c + y,
                            v[:, 2] + z + (lift if hyped else 0)], 1))
        fc += [[i + off for i in f] for f in t['faces']]
        mi += t['mat']
        u = t['uv'].copy()
        u[t['sign_loops']] += (0.25 * cell, -0.5 * int(team))
        uvs.append(u)
        shirt = team_cols[int(team)] if r < 0.72 else (lib.lin('#E8E4DA') if r < 0.9 else lib.lin('#1A1A1A'))
        col = np.tile(np.array(shirt, np.float32), (len(v), 1))
        col[t['skin']] = skins[int(rng.integers(4))]
        cols.append(col)
        off += len(v)
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.concatenate(co).tolist(), [], fc)
    me.polygons.foreach_set('material_index', mi)
    me.uv_layers.new(name='UVMap').data.foreach_set('uv', np.concatenate(uvs).ravel())
    me.color_attributes.new('team', 'FLOAT_COLOR', 'POINT').data.foreach_set('color', np.concatenate(cols).ravel())
    m = bpy.data.materials.get('crowd_preview')
    if not m:
        m = bpy.data.materials.new('crowd_preview')
        m.use_nodes = True
        nt = m.node_tree
        ca = nt.nodes.new('ShaderNodeVertexColor')
        ca.layer_name = 'team'
        nt.links.new(ca.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
        nt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    me.materials.append(m)
    me.materials.append(bpy.data.materials['crowd_sign'])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


SHOW_TARGETS = [(-30, -92, 14), (25, -94, 14), (-60, -30, 12), (60, -35, 12), (-58, 30, 12), (58, 40, 12), (-20, 95, 14), (30, 92, 14)]


def show_lights(lights):
    """Pulse light show: orange spots from each tower sweeping the stands."""
    out = []
    for i, (head, _) in enumerate(lights):
        for tg in sorted(SHOW_TARGETS, key=lambda t: (Vector(t) - Vector(head)).length)[:2]:
            L = bpy.data.lights.new(f'show_{len(out)}', 'SPOT')
            L.energy, L.spot_size, L.spot_blend, L.color = 1.6e6, math.radians(22), 0.3, (1.0, 0.42, 0.08)
            o = bpy.data.objects.new(L.name, L)
            bpy.context.scene.collection.objects.link(o)
            o.location = head
            lib.look_at(o, tg)
            out.append(o)
    return out


def set_image(mat_name, path):
    img = bpy.data.images.load(path, check_existing=True)
    for n in bpy.data.materials[mat_name].node_tree.nodes:
        if n.type == 'TEX_IMAGE':
            n.image = img


def pulse(state, crowds, shows):
    hype = state == 'hype'
    crowds['calm'].hide_render, crowds['hype'].hide_render = hype, not hype
    for o in shows:
        o.hide_render = not hype
    b = bpy.data.materials['lamp_show'].node_tree.nodes['Principled BSDF']
    b.inputs['Emission Color'].default_value = lib.lin('#FF5A00' if hype else '#FFF3DC')
    b.inputs['Emission Strength'].default_value = 30.0 if hype else 60.0
    bpy.data.materials['lamp'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 110.0 if hype else 60.0
    beams_glow(0.009)
    for o in bpy.data.objects:
        if o.name.startswith('tower_light_'):
            o.data.energy = 1.2e6 if hype else 9.0e5
    rib = os.path.join(lib.TEXTURES, 'ribbon_hype.png' if hype else 'ribbon_calm.png')
    set_image('ribbon', rib)
    set_image('ribbon_jumbo', rib)


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


def place(colors, sfx, pos, action, frame, facing, number):
    root, rig, meshes, acts = build_player.build_player(dict(colors, number=str(number)), f'{sfx}_{number}')
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
    for (p, a, f), n in zip(off, [55, 72, 65, 78, 70, 86, 1, 11, 4, 7]):
        place(T, '', p, a, f, 0, n)
    for (p, a, f), n in zip(deff, [90, 95, 9, 44, 23, 10, 2, 7, 13, 8, 21]):
        place(O, '_ou', p, a, f, 180, n)


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
    bpy.context.view_layer.use_pass_emit = True
    glow, gf = nt.nodes.new('CompositorNodeMixRGB'), nt.nodes.new('CompositorNodeMath')
    glow.blend_type = 'ADD'
    gf.operation = 'MULTIPLY'
    gf.inputs[1].default_value = 0.75
    nt.links.new(mul.outputs[0], gf.inputs[0])
    nt.links.new(gf.outputs[0], glow.inputs['Fac'])
    nt.links.new(mix.outputs[0], glow.inputs[1])
    nt.links.new(rl.outputs['Emit'], glow.inputs[2])
    nt.links.new(glow.outputs[0], comp.inputs['Image'])


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
    crowds = {'calm': crowd_mesh('crowd_calm', seats, 0.08), 'hype': crowd_mesh('crowd_hype', seats, 0.85)}
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
    shows = show_lights(lights)
    setup_render()
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    # live jumbotron feed: broadcast camera high on the press-box side, scorebug composited on top
    pulse('calm', crowds, shows)
    raw = shot('jumbo_feed_raw', (62, LOS + 6, 26), (0, LOS - 3, 0), 45)
    feed = os.path.join(lib.RENDERS, 'raw', 'jumbo_feed.png')
    subprocess.run(['python3', os.path.join(os.path.dirname(__file__), 'make_pulse_textures.py'), 'feed', raw, feed], check=True)
    set_image('screen', feed)
    # first-person QB in shotgun at full pulse, arm + ball in frame, jumbotron showing the live feed
    pulse('hype', crowds, shows)
    root, arm, fball = build_ball.build_arm()
    qb = Vector((0.0, LOS + 4.6, 1.78))
    look = (0, LOS - 25, 3.5)
    cam.location = qb
    lib.look_at(cam, look)
    root.parent = cam
    axes = Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0)))
    tilt = Matrix.Rotation(math.radians(55), 3, 'Z') @ Matrix.Rotation(math.radians(-18), 3, 'X')
    root.matrix_parent_inverse = Matrix.Identity(4)
    root.matrix_basis = Matrix.Translation((0.25, -0.17, -0.7)) @ (axes @ tilt).to_4x4()
    paths = [raw, shot('scene_fp', qb, look, 22)]
    root.hide_render = True
    for o in (arm, fball):
        o.hide_render = True
    end = ((-17, -14, 3.2), (4, -100, 30), 20)
    set_image('screen', os.path.join(lib.TEXTURES, 'jumbo_hype.png'))
    paths.append(shot('pulse_hype', *end))
    pulse('calm', crowds, shows)
    set_image('screen', feed)
    paths.append(shot('pulse_calm', *end))
    paths.append(shot('scene_wide', (-14, LOS + 26, 13), (0, LOS - 6, 0), 26))
    print('RENDERS', paths)

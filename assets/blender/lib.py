import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.path.join(ROOT, 'public', 'models')
TEXTURES = os.path.join(ROOT, 'public', 'textures')
BLEND = os.path.join(ROOT, 'assets', 'blender', 'blend')
RENDERS = os.path.join(ROOT, 'assets', 'renders')
for d in (MODELS, TEXTURES, BLEND, RENDERS, os.path.join(RENDERS, 'raw')):
    os.makedirs(d, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'


def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def grime(name='grime', size=64, lo=0.70, hi=1.0, seed=1, blotch=6, streak=0.35):
    """Grayscale grunge tile: per-pixel noise, blocky blotches, vertical streaks. Saved to public/textures."""
    img = bpy.data.images.get(name)
    if img:
        return img
    rng = np.random.default_rng(seed)
    a = rng.uniform(0.0, 1.0, (size, size))
    for s in (4, 8, 16):
        b = rng.uniform(0, 1, (size // s, size // s)).repeat(s, 0).repeat(s, 1)
        a = a * 0.55 + b * 0.45
    for _ in range(blotch):
        x, y, r = rng.integers(0, size, 2).tolist() + [int(rng.integers(3, size // 5))]
        yy, xx = np.ogrid[:size, :size]
        a[((xx - x) % size) ** 2 + ((yy - y) % size) ** 2 < r * r] *= 0.8
    cols = rng.uniform(0, 1, size) < streak
    a[:, cols] *= rng.uniform(0.85, 0.95, cols.sum())
    a = (a - a.min()) / (a.max() - a.min())
    a = lo + (hi - lo) * a
    a = np.round(a * 12) / 12
    px = np.ones((size, size, 4), dtype=np.float32)
    px[..., 0] = px[..., 1] = px[..., 2] = a
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.join(TEXTURES, name + '.png')
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img


def image_from_array(name, arr, save=True):
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1), np.float32)], 2)
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(np.flipud(arr).astype(np.float32).ravel())
    if save:
        img.filepath_raw = os.path.join(TEXTURES, name + '.png')
        img.file_format = 'PNG'
        img.save()
    img.pack()
    return img


def mat(name, color, rough=0.85, metal=0.0, tex='grime', emission=None, strength=0.0, image=None, alpha_clip=False):
    """Principled BSDF. Base color = texture * color (exports as baseColorTexture * baseColorFactor)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    col = lin(color) if isinstance(color, str) else color
    img = image or (grime(tex) if tex else None)
    if img:
        ti = nt.nodes.new('ShaderNodeTexImage')
        ti.image = img
        ti.interpolation = 'Closest'
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs['B'].default_value = col
        nt.links.new(ti.outputs['Color'], mix.inputs['A'])
        nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        if alpha_clip:
            rnd = nt.nodes.new('ShaderNodeMath')
            rnd.operation = 'ROUND'
            nt.links.new(ti.outputs['Alpha'], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], bsdf.inputs['Alpha'])
            m.blend_method = 'CLIP'
    else:
        bsdf.inputs['Base Color'].default_value = col
    if emission:
        bsdf.inputs['Emission Color'].default_value = lin(emission)
        bsdf.inputs['Emission Strength'].default_value = strength
    m.diffuse_color = col
    return m


def new_obj(name, bm, material=None, coll=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    if material:
        me.materials.append(material)
    return ob


def box(name, size, loc=(0, 0, 0), material=None, taper=(1, 1), rot=(0, 0, 0), bevel=0.0):
    """Box centered at loc. taper=(sx, sy) scales the top face (+Z) to make wedge/tapered limbs."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        if v.co.z > 0:
            v.co.x *= taper[0]
            v.co.y *= taper[1]
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES')
    ob = new_obj(name, bm, material)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def cyl(name, r, depth, loc=(0, 0, 0), segs=8, material=None, r2=None, rot=(0, 0, 0), cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    ob = new_obj(name, bm, material)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def sphere(name, r, loc=(0, 0, 0), u=8, v=6, material=None, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    for vt in bm.verts:
        vt.co.x *= scale[0]
        vt.co.y *= scale[1]
        vt.co.z *= scale[2]
    ob = new_obj(name, bm, material)
    ob.location = loc
    return ob


def quad(name, center, right, up, w, h, material=None):
    """Single quad with full 0..1 UVs. Normal = right x up."""
    c, r, u = Vector(center), Vector(right).normalized() * (w / 2), Vector(up).normalized() * (h / 2)
    bm = bmesh.new()
    vs = [bm.verts.new(c - r - u), bm.verts.new(c + r - u), bm.verts.new(c + r + u), bm.verts.new(c - r + u)]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new('UVMap')
    for loop, uv in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop[uvl].uv = uv
    return new_obj(name, bm, material)


def pixel_art(rows, color, scale=1, pad=0):
    """ASCII art ('X' = filled) -> RGBA float array with transparent background."""
    w = max(len(r) for r in rows)
    a = np.zeros((len(rows), w, 4), np.float32)
    col = [int(color.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == 'X':
                a[y, x] = col + [1.0]
    if pad:
        a = np.pad(a, ((pad, pad), (pad, pad), (0, 0)))
    return a.repeat(scale, 0).repeat(scale, 1)


def apply(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def box_uv(ob, scale=1.0):
    """World-space box projection so the grime tile has consistent texel density (64 px per `scale` m)."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new()
    uv = me.uv_layers.active.data
    mw = ob.matrix_world
    for p in me.polygons:
        n = (mw.to_3x3() @ p.normal)
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            a, b = [(1, 2), (0, 2), (0, 1)][ax]
            uv[li].uv = (co[a] / scale, co[b] / scale)


def join(objs, name):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def tri_count(objs=None):
    n = 0
    for o in objs or bpy.context.scene.objects:
        if o.type == 'MESH':
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n


def save(name):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BLEND, name + '.blend'), compress=True)


def export(name, animations=False, selection=None):
    if selection is not None:
        for o in bpy.context.scene.objects:
            o.select_set(o in selection)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(MODELS, name + '.glb'), export_format='GLB', export_apply=True,
        use_selection=selection is not None,
        export_animations=animations, export_animation_mode='ACTIONS' if animations else 'ACTIVE_ACTIONS',
        export_yup=True, export_materials='EXPORT', export_image_format='AUTO',
        export_draco_mesh_compression_enable=False)
    return os.path.join(MODELS, name + '.glb')


# ---------- preview renders (night, harsh stadium light) ----------

def preview_scene(target=(0, 0, 1.0), dist=4.0, height=1.4, lens=50, ground=True, light_power=1500, world=0.004):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 480, 360
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Punchy'
    w = bpy.data.worlds.new('night')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (world, world * 1.2, world * 2.2, 1)
    sc.world = w
    if ground:
        g = box('preview_ground', (60, 60, 0.02), (0, 0, -0.01), mat('preview_turf', '#2E5D2A', tex='grime_turf'))
        box_uv(g, 0.8)
    key = bpy.data.lights.new('stadium_key', 'SPOT')
    key.energy = light_power
    key.spot_size = math.radians(55)
    key.spot_blend = 0.4
    key.color = (1.0, 0.93, 0.82)
    ko = bpy.data.objects.new('stadium_key', key)
    sc.collection.objects.link(ko)
    ko.location = (dist * 0.9, -dist * 0.8, target[2] + dist * 1.3)
    look_at(ko, target)
    rim = bpy.data.lights.new('rim', 'SPOT')
    rim.energy = light_power * 0.35
    rim.spot_size = math.radians(45)
    rim.color = (0.75, 0.82, 1.0)
    ro = bpy.data.objects.new('rim', rim)
    sc.collection.objects.link(ro)
    ro.location = (-dist * 1.1, dist * 1.0, target[2] + dist * 0.9)
    look_at(ro, target)
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    return co


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def turntable(name, target=(0, 0, 1.0), dist=4.0, height=1.4, angles=(30, 120, 210, 300), frame=None, **kw):
    """Renders `angles` (degrees around Z, 0 = front at -Y) into assets/renders/raw/<name>_<i>.png."""
    cam = preview_scene(target, dist, height, **kw)
    sc = bpy.context.scene
    if frame is not None:
        sc.frame_set(frame)
    paths = []
    for i, a in enumerate(angles):
        r = math.radians(a)
        cam.location = (target[0] - math.sin(r) * dist, target[1] - math.cos(r) * dist, target[2] + height - 1.0 + 0.4)
        look_at(cam, target)
        p = os.path.join(RENDERS, 'raw', f'{name}_{i}.png')
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths


def args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def loft(name, a, b, rings, segs=10, material=None, side=(1, 0, 0), caps=True, smooth_shade=True):
    """Tube from a to b. rings: (t, rx, ry[, du, dw]) cross-sections; rx lies along `side`, w = axis x side.
    Vertex i belongs to ring i // segs; ring t values are stored in ob['ring_t']."""
    a, b = Vector(a), Vector(b)
    ax = b - a
    L = ax.length
    ax.normalize()
    s = Vector(side)
    u = (s - ax * s.dot(ax)).normalized()
    w = ax.cross(u)
    bm = bmesh.new()
    vr = []
    for r in rings:
        t, rx, ry = r[:3]
        du, dw = (r[3], r[4]) if len(r) > 3 else (0.0, 0.0)
        c = a + ax * (t * L) + u * du + w * dw
        vr.append([bm.verts.new(c + u * (rx * math.cos(2 * math.pi * j / segs)) + w * (ry * math.sin(2 * math.pi * j / segs)))
                   for j in range(segs)])
    for p, q in zip(vr, vr[1:]):
        for j in range(segs):
            bm.faces.new((p[j], p[(j + 1) % segs], q[(j + 1) % segs], q[j]))
    if caps:
        bm.faces.new(vr[0][::-1])
        bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_obj(name, bm, material)
    ob['ring_t'] = [r[0] for r in rings]
    ob['segs'] = segs
    return smooth(ob) if smooth_shade else ob


def tube(name, pts, r, segs=6, material=None, joints=False):
    """Polyline tube (facemask bars, chains, fingers). r: scalar or one radius per point.
    joints=True adds a sphere at each interior point and a rounded tip (knuckles, fingertips)."""
    rs = list(r) if isinstance(r, (list, tuple)) else [r] * len(pts)
    parts = []
    for (p, q), (ra, rb) in zip(zip(pts, pts[1:]), zip(rs, rs[1:])):
        parts.append(loft(name, p, q, [(0, ra, ra), (1, rb, rb)], segs, material,
                          side=(0, 0, 1) if abs(Vector(q)[2] - Vector(p)[2]) < 0.8 * (Vector(q) - Vector(p)).length else (1, 0, 0)))
    if joints:
        for p, rr in [(pts[-1], rs[-1])]:
            sp = sphere(name + '_j', rr * 0.98, p, segs, max(4, segs // 2 + 1), material)
            apply(sp)
            parts.append(smooth(sp))
    return join(parts, name) if len(parts) > 1 else parts[0]


def subdivide(ob, levels=1):
    mod = ob.modifiers.new('subd', 'SUBSURF')
    mod.levels = mod.render_levels = levels
    bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(object=ob, active_object=ob):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return smooth(ob)


def weights(ob, fn):
    """fn(index, co) -> {bone: weight}."""
    groups = {}
    for v in ob.data.vertices:
        for bone, wt in fn(v.index, v.co).items():
            if bone not in groups:
                groups[bone] = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
            groups[bone].add([v.index], wt, 'REPLACE')


def sweep(name, pts, radii, segs=8, material=None, side=(0, 1, 0), tip=True):
    """One continuous tube along a polyline (subdivides cleanly, unlike joined segments).
    radii: per point, scalar or (rx, ry); rx lies along `side`. tip=True closes the end with a dome."""
    P = [Vector(p) for p in pts]
    R = [(r, r) if not isinstance(r, (list, tuple)) else r for r in radii]
    s = Vector(side)
    bm = bmesh.new()
    rings = []

    def ring(c, t, rx, ry):
        u = (s - t * s.dot(t)).normalized()
        w = t.cross(u)
        return [bm.verts.new(c + u * (rx * math.cos(2 * math.pi * j / segs)) + w * (ry * math.sin(2 * math.pi * j / segs)))
                for j in range(segs)]
    for i, c in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        rings.append(ring(c, t, *R[i]))
    if tip:
        t = (P[-1] - P[-2]).normalized()
        rx, ry = R[-1]
        rings.append(ring(P[-1] + t * rx * 0.55, t, rx * 0.75, ry * 0.75))
        rings.append(ring(P[-1] + t * rx * 0.9, t, rx * 0.35, ry * 0.35))
    for p, q in zip(rings, rings[1:]):
        for j in range(segs):
            bm.faces.new((p[j], p[(j + 1) % segs], q[(j + 1) % segs], q[j]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return smooth(new_obj(name, bm, material))

"""Motion check: renders 8 frames of every player action from a 3/4 side view into raw/anim_<Action>_<i>.png.
blender -b --python assets/blender/anim_check.py"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import bpy
import lib, build_player

if __name__ == '__main__':
    lib.reset()
    root, rig, meshes, acts = build_player.build_player(build_player.TEXAS)
    cam = lib.preview_scene(target=(0, -0.3, 0.85), dist=4.8, height=1.3, light_power=2500)
    sc = bpy.context.scene
    sc.cycles.samples = 12
    sc.render.resolution_x, sc.render.resolution_y = 240, 240
    r = math.radians(65)
    cam.location = (-math.sin(r) * 5.0, -0.3 - math.cos(r) * 5.0, 1.4)
    lib.look_at(cam, (0, -0.3, 0.8))
    for name, (loop, keys) in build_player.actions().items():
        end = max(keys)
        for i in range(8):
            f = end * i / (8 if loop else 7)
            build_player.pose_at(rig, acts[name], f)
            sc.render.filepath = os.path.join(lib.RENDERS, 'raw', f'anim_{name}_{i}.png')
            bpy.ops.render.render(write_still=True)
    print('ANIM done')

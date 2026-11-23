"""Workbench contact sheets for the model kit (decoded vertex colours)."""
import math
import os

import bpy
import numpy as np
from mathutils import Vector

import lib

TILE = 256
FOV = math.radians(30)
FRONT = Vector((0.75, -1.0, 0.55))   # 3/4 front (front = Blender -Y)
BACK = Vector((-0.6, 1.0, 0.9))      # behind and above, like the game camera
GAME = Vector((0.0, 1.0, 1.0))       # straight from behind at ~45 deg


def _region_rgb(team):
    return {
        0: lib.hex_rgb(team),
        1: lib.hex_rgb(lib.PAL['skin']),
        2: lib.hex_rgb(lib.PAL['dark']),
        3: lib.hex_rgb(lib.PAL['white']),
    }


def decode(ob, team=lib.PAL['blue'], raw=False):
    """Add/refresh a 'Preview' layer: region -> palette colour, times AO (B)."""
    me = ob.data
    src = me.vertex_colors['Col']
    lay = me.vertex_colors.get('Preview') or me.vertex_colors.new(name='Preview')
    cols = _region_rgb(team)
    for i, d in enumerate(src.data):
        c = d.color
        if raw:
            lay.data[i].color = c
            continue
        reg = int(round(lib.srgb2lin(c[0]) * 3))
        ao = lib.srgb2lin(c[2])
        base = cols[max(0, min(3, reg))]
        lay.data[i].color = (base[0] * ao, base[1] * ao, base[2] * ao, 1.0)
    me.vertex_colors.active = lay
    lay.active_render = True


def _setup(scene):
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.display.render_aa = '8'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.cavity_ridge_factor = 1.0
    sh.cavity_valley_factor = 1.0
    sh.curvature_ridge_factor = 0.6
    sh.curvature_valley_factor = 0.8
    sh.show_object_outline = True
    sh.object_outline_color = lib.hex_rgb(lib.PAL['dark'])
    sh.show_specular_highlight = True
    cam = bpy.data.objects.get('_cam')
    if cam is None:
        cd = bpy.data.cameras.new('_cam')
        cam = bpy.data.objects.new('_cam', cd)
        scene.collection.objects.link(cam)
    cam.data.angle = FOV
    cam.data.clip_start = 0.01
    cam.data.clip_end = 500
    scene.camera = cam
    return cam


def _label(text, cam):
    cu = bpy.data.curves.new('_lbl', 'FONT')
    cu.body = text
    cu.size = 0.032
    ob = bpy.data.objects.new('_lbl', cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = cam
    ob.location = (-0.125, -0.128, -0.5)
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    lay = ob.data.vertex_colors.new(name='Preview')
    for d in lay.data:
        d.color = (*lib.hex_rgb(lib.PAL['dark']), 1)
    return ob


def _frame(cam, ob, direction):
    pts = [v.co for v in ob.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    rad = max((p - c).length for p in pts)
    d = rad / math.sin(FOV / 2) * 1.0
    dirn = direction.normalized()
    cam.location = c + dirn * d
    cam.rotation_euler = (-dirn).to_track_quat('-Z', 'Y').to_euler()


def render_tiles(items, out_png, cols=4, tmpdir='/tmp'):
    """items: list of (object, label, direction Vector, team hex or None=raw)."""
    scene = bpy.context.scene
    cam = _setup(scene)
    tiles = []
    for k, (ob, label, direction, team) in enumerate(items):
        decode(ob, team or lib.PAL['blue'], raw=team is None)
        lbl = _label(label, cam)
        for o in scene.objects:
            o.hide_render = o not in (ob, lbl, cam)
        _frame(cam, ob, direction)
        path = os.path.join(tmpdir, '_tile_%02d.png' % k)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(TILE * TILE * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        tiles.append(px.reshape(TILE, TILE, 4)[::-1])  # top-down
        bpy.data.images.remove(img)
        bpy.data.objects.remove(lbl, do_unlink=True)
        os.remove(path)
    for o in scene.objects:
        o.hide_render = False
    rows = (len(tiles) + cols - 1) // cols
    W, H = cols * TILE, rows * TILE
    sheet = np.zeros((H, W, 4), dtype=np.float32)
    sheet[..., :3] = (0.93, 0.93, 0.96)
    sheet[..., 3] = 1
    for k, t in enumerate(tiles):
        r, c = divmod(k, cols)
        if (r + c) % 2:
            sheet[r * TILE:(r + 1) * TILE, c * TILE:(c + 1) * TILE, :3] = (0.87, 0.88, 0.92)
        a = t[..., 3:4]
        reg = sheet[r * TILE:(r + 1) * TILE, c * TILE:(c + 1) * TILE, :3]
        sheet[r * TILE:(r + 1) * TILE, c * TILE:(c + 1) * TILE, :3] = reg * (1 - a) + t[..., :3] * a
    img = bpy.data.images.new('_sheet', W, H, alpha=True)
    img.pixels.foreach_set(sheet[::-1].ravel())
    img.filepath_raw = out_png
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)

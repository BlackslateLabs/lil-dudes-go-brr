"""Shared helpers for the Lil Dudes Go Brr model kit (Blender 2.93, headless).

Modelling convention inside Blender (the glTF exporter converts on the way out):
  Blender +Z = up      -> glTF +Y
  Blender -Y = front   -> glTF +Z (toward the camera / cannon)
  Blender +X = +X      (a dude facing the camera has its own LEFT on +X)

Every piece is built from parts. Each part is painted with a region id (R) and an
animation mask (G) at build time; parts are joined into one mesh per piece and a
ray-traced ambient occlusion term is written to B. All three go into ONE vertex
colour layer named "Col". The 2.93 exporter converts vertex colours sRGB -> linear,
so data values are pre-encoded with linear->sRGB to arrive in the GLB unchanged.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# ---------------------------------------------------------------- regions / masks
TEAM, SKIN, DARK, NEUTRAL = 0.0, 0.33, 0.66, 1.0
BODY, LEFT, RIGHT = 0.0, 0.5, 1.0

# palette (sRGB hex) used for previews and scenery
PAL = {
    'blue': '#2A7BFF', 'red': '#F2404F', 'gold': '#FFC531', 'dark': '#1A1038',
    'indigo': '#2B1B5A', 'cyan': '#6FE3FF', 'lime': '#7ED321',
    'skin': '#FFD7B0', 'white': '#F4F0E8',
}


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def lin2srgb(v):
    v = max(0.0, min(1.0, v))
    return v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055


def srgb2lin(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


# ---------------------------------------------------------------- scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _obj_from_bm(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def smooth(ob, flag=True):
    for p in ob.data.polygons:
        p.use_smooth = flag
    return ob


def xf(ob, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Bake a transform into the mesh data (rot in degrees, XYZ euler)."""
    from mathutils import Euler
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    m = (Matrix.Translation(Vector(loc)) @
         Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @
         Matrix.Diagonal(Vector((*scale, 1.0))))
    ob.data.transform(m)
    ob.data.update()
    return ob


def bend_verts(ob, fn):
    """fn(Vector) -> Vector applied to every vertex."""
    for v in ob.data.vertices:
        v.co = fn(v.co.copy())
    ob.data.update()
    return ob


# ---------------------------------------------------------------- primitives
def lathe(profile, n=12, name='lathe', phase=0.0, close_top=True, close_bottom=True):
    """Revolve a (radius, z) profile (bottom -> top) around +Z.
    r == 0 entries become poles. Open ends are capped with an n-gon unless disabled."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            ring = []
            for i in range(n):
                a = 2 * math.pi * (i + phase) / n
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
            rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for i in range(n):
                bm.faces.new((a[0], b[i], b[(i + 1) % n]))
        elif len(b) == 1:
            for i in range(n):
                bm.faces.new((a[i], b[0], a[(i + 1) % n]))
        else:
            for i in range(n):
                bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if close_bottom and len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if close_top and len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return smooth(_obj_from_bm(bm, name))


def ellipsoid_profile(rx, rz, rings=6, z0=0.0, squash=1.0):
    """Profile of an ellipsoid from bottom pole to top pole, centred at z0+rz."""
    out = []
    for i in range(rings + 1):
        t = math.pi * i / rings
        out.append((rx * math.sin(t), z0 + rz - rz * math.cos(t)))
    return out


def ball(r, n=10, rings=6, name='ball', sz=None):
    sz = r if sz is None else sz
    ob = lathe(ellipsoid_profile(r, sz, rings), n, name)
    return xf(ob, loc=(0, 0, -sz))


def capsule(r, length, n=8, cap_rings=2, name='capsule'):
    """Capsule along +Z from z=0 (rounded) to z=length."""
    prof = []
    for i in range(cap_rings + 1):
        t = (math.pi / 2) * i / cap_rings
        prof.append((r * math.sin(t), r - r * math.cos(t)))
    top = length - r
    for i in range(cap_rings, -1, -1):
        t = (math.pi / 2) * i / cap_rings
        prof.append((r * math.sin(t), top + r * math.cos(t)))
    # dedupe equal mid rings
    clean = [prof[0]]
    for p in prof[1:]:
        if abs(p[1] - clean[-1][1]) > 1e-5 or abs(p[0] - clean[-1][0]) > 1e-5:
            clean.append(p)
    return lathe(clean, n, name)


def add_bevel(ob, width, segs=2, harden=True, angle=40):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segs
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = harden
    m.miter_outer = 'MITER_ARC'
    ob.data.use_auto_smooth = True
    ob.data.auto_smooth_angle = math.radians(60)
    smooth(ob)
    apply_mods(ob)
    return ob


def apply_mods(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    return ob


def box(sx, sy, sz, bevel=0.0, segs=2, name='box', base=True):
    """Box sx*sy*sz; with base=True its bottom sits on z=0."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    ob = _obj_from_bm(bm, name)
    xf(ob, loc=(0, 0, sz / 2 if base else 0), scale=(sx, sy, sz))
    if bevel > 0:
        add_bevel(ob, bevel, segs)
    else:
        smooth(ob, False)
    return ob


def cyl(r, h, n=12, bevel=0.0, segs=2, name='cyl', r2=None):
    """Cylinder (or cone frustum when r2 given) along +Z from z=0 to z=h."""
    r2 = r if r2 is None else r2
    ob = lathe([(r, 0), (r2, h)], n, name)
    if bevel > 0:
        add_bevel(ob, bevel, segs)
    else:
        ob.data.use_auto_smooth = True
        ob.data.auto_smooth_angle = math.radians(50)
    return ob


def torus(R, r, n=16, m=6, name='torus', arc=360.0):
    bm = bmesh.new()
    full = arc >= 359.9
    count = n if full else n + 1
    rings = []
    for i in range(count):
        a = math.radians(arc) * i / n
        c, s = math.cos(a), math.sin(a)
        ring = []
        for j in range(m):
            b = 2 * math.pi * j / m
            rr = R + r * math.cos(b)
            ring.append(bm.verts.new((rr * c, rr * s, r * math.sin(b))))
        rings.append(ring)
    pairs = list(zip(rings[:-1], rings[1:]))
    if full:
        pairs.append((rings[-1], rings[0]))
    for a, b in pairs:
        for j in range(m):
            bm.faces.new((a[j], b[j], b[(j + 1) % m], a[(j + 1) % m]))
    if not full:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return smooth(_obj_from_bm(bm, name))


def extrude_poly(pts, depth, name='poly', bevel=0.0, segs=2):
    """Extrude a 2D polygon (x, z points, CCW seen from -Y/front) along +Y by depth,
    centred on y=0. Good for flat icons, chevrons, flags."""
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z)) for x, z in pts]
    back = [bm.verts.new((x, depth / 2, z)) for x, z in pts]
    k = len(pts)
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    for i in range(k):
        j = (i + 1) % k
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj_from_bm(bm, name)
    if bevel > 0:
        add_bevel(ob, bevel, segs)
    else:
        smooth(ob, False)
    return ob


def ico(r, sub=1, name='ico'):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, diameter=r)
    return _obj_from_bm(bm, name)


def jitter(ob, amount, seed=0, keep_bottom=None):
    rnd = random.Random(seed)
    for v in ob.data.vertices:
        if keep_bottom is not None and v.co.z <= keep_bottom:
            continue
        v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * amount
    ob.data.update()
    return ob


def mirror_x(ob, name=None):
    """Return a mirrored copy across X (flips face winding back)."""
    cp = ob.copy()
    cp.data = ob.data.copy()
    cp.name = name or ob.name + '_m'
    bpy.context.scene.collection.objects.link(cp)
    cp.data.transform(Matrix.Diagonal(Vector((-1, 1, 1, 1))))
    cp.data.flip_normals()
    cp.data.update()
    return cp


def dup(ob, name=None):
    cp = ob.copy()
    cp.data = ob.data.copy()
    cp.name = name or ob.name + '_d'
    bpy.context.scene.collection.objects.link(cp)
    return cp


# ---------------------------------------------------------------- colour
def _layer(ob):
    me = ob.data
    if 'Col' not in me.vertex_colors:
        me.vertex_colors.new(name='Col')
    return me.vertex_colors['Col']


def paint(ob, region=NEUTRAL, mask=BODY, rgb=None):
    """Data parts: R region, G mask (B filled later). Scenery: rgb = sRGB colour."""
    lay = _layer(ob)
    if rgb is not None:
        col = (*rgb, 1.0)
    else:
        col = (lin2srgb(region), lin2srgb(mask), 1.0, 1.0)
    for d in lay.data:
        d.color = col
    return ob


def paint_faces(ob, fn):
    """fn(face_center Vector, face_normal Vector) -> region or None (keep).
    For scenery fn may return an (r,g,b) tuple."""
    lay = _layer(ob)
    me = ob.data
    for p in me.polygons:
        v = fn(p.center.copy(), p.normal.copy())
        if v is None:
            continue
        for li in p.loop_indices:
            old = lay.data[li].color
            if isinstance(v, tuple):
                lay.data[li].color = (*v, 1.0)
            else:
                lay.data[li].color = (lin2srgb(v), old[1], old[2], 1.0)
    return ob


def join(parts, name):
    parts = [p for p in parts if p is not None]
    for p in parts:
        _layer(p)
    ctx = bpy.context
    for o in ctx.view_layer.objects:
        o.select_set(False)
    for p in parts:
        p.select_set(True)
    ctx.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = ctx.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def bake_ao(ob, rays=40, dist=None, ground=True, lo=0.5, mode='data', strength=1.0, seed=7):
    """Ray-traced per-vertex AO. mode 'data' writes B; mode 'mul' multiplies RGB
    (scenery). Rays that drop below z=0 count as occluded when ground=True."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    dims = ob.dimensions
    if dist is None:
        dist = max(0.25, 0.35 * max(dims))
    rnd = random.Random(seed)
    dirs = []
    for i in range(rays):  # cosine-weighted hemisphere samples around +Z
        u, v = (i + rnd.random()) / rays, rnd.random()
        r, th = math.sqrt(u), 2 * math.pi * v
        dirs.append(Vector((r * math.cos(th), r * math.sin(th), math.sqrt(max(0, 1 - u)))))
    occ = []
    for vert in bm.verts:
        n = vert.normal.copy()
        if n.length < 1e-6:
            n = Vector((0, 0, 1))
        rot = n.to_track_quat('Z', 'Y').to_matrix()
        p = vert.co + n * 0.004
        hit = 0.0
        for d in dirs:
            w = rot @ d
            loc, _, _, _ = tree.ray_cast(p, w, dist)
            if loc is not None:
                hit += 1
            elif ground and w.z < -1e-3 and p.z / -w.z < dist:
                hit += 1
        occ.append(hit / rays)
    bm.free()
    lay = _layer(ob)
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            a = 1.0 - strength * occ[vi]
            a = lo + (1.0 - lo) * max(0.0, a)
            c = lay.data[li].color
            if mode == 'data':
                lay.data[li].color = (c[0], c[1], lin2srgb(a), 1.0)
            else:
                lay.data[li].color = (c[0] * a, c[1] * a, c[2] * a, 1.0)
    return ob


def finish(parts, name, ao=True, mode='data', **kw):
    ob = join(parts, name)
    # weld nothing (parts stay separate shells); clean up loose data
    if ao:
        bake_ao(ob, mode=mode, **kw)
    ob.location = (0, 0, 0)
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def height(ob):
    zs = [v.co.z for v in ob.data.vertices]
    return max(zs) - min(zs)


# ---------------------------------------------------------------- export
def toy_material():
    mat = bpy.data.materials.get('toy')
    if mat is None:
        mat = bpy.data.materials.new('toy')
        mat.diffuse_color = (1, 1, 1, 1)
        mat.roughness = 0.6
    return mat


def export(objs, path):
    mat = toy_material()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_colors=True, export_normals=True, export_texcoords=False,
        export_tangents=False, export_animations=False, export_skins=False,
        export_morph=False, export_cameras=False, export_lights=False,
        export_materials='EXPORT', export_yup=True, export_extras=False)


# ---------------------------------------------------------------- rounded lathe shapes
def round_profile(pts, rr, steps=2):
    """Round the corners of a (r, z) polyline (bottom pole -> top pole) with arcs of
    radius rr. End points on the axis are kept; a support ring is added next to each
    pole so flat caps stay flat under smooth shading."""
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[i + 1])
        a, b = (p0 - p1), (p2 - p1)
        la, lb = a.length, b.length
        if la < 1e-6 or lb < 1e-6:
            out.append(pts[i])
            continue
        a.normalize(); b.normalize()
        ang = a.angle(b)
        if abs(ang - math.pi) < 1e-3:
            out.append(pts[i])
            continue
        d = min(rr / math.tan(ang / 2), la * 0.45, lb * 0.45)
        s0, s1 = p1 + a * d, p1 + b * d
        for k in range(steps + 1):  # quadratic bezier approximates the arc
            t = k / steps
            q = (1 - t) ** 2 * s0 + 2 * (1 - t) * t * p1 + t * t * s1
            out.append((q.x, q.y))
    out.append(pts[-1])
    # support rings near the poles
    res = []
    for i, p in enumerate(out):
        res.append(p)
        if i == 0 and p[0] < 1e-6 and len(out) > 1:
            nx = out[1]
            if abs(nx[1] - p[1]) < 1e-6:
                res.append((nx[0] * 0.9, p[1]))
    if out[-1][0] < 1e-6 and len(out) > 1:
        pv = out[-2]
        if abs(pv[1] - out[-1][1]) < 1e-6:
            res.insert(len(res) - 1, (pv[0] * 0.9, out[-1][1]))
    return res


def rlathe(pts, rr, n=16, steps=2, name='rlathe', smooth_angle=50):
    ob = lathe(round_profile(pts, rr, steps), n, name, phase=0.5)
    ob.data.use_auto_smooth = True
    ob.data.auto_smooth_angle = math.radians(smooth_angle)
    return ob


def rcyl(r, h, rr, n=16, steps=2, name='rcyl', r_top=None, z0=0.0):
    rt = r if r_top is None else r_top
    return rlathe([(0, z0), (r, z0), (rt, z0 + h), (0, z0 + h)], rr, n, steps, name)


def flat_shade(ob):
    smooth(ob, False)
    ob.data.use_auto_smooth = False
    return ob

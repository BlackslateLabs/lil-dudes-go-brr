"""dudes.glb: dude (mascot), troop (enemy), champ (champion), giant (enemy giant), shadow.

All characters share one skeleton: an egg body (head merged), a face patch on the
upper front, two big eyes, stubby arms and boot-feet (G mask by side).
Blender frame: +Z up, front = -Y, the character's own LEFT = +X.

Identity:
  dude  - team onesie, skin face, big glossy dark eyes, hard hat with a white brim.
  troop - team hood with bone horns, a dark face with white angry eyes and a toothy grin.
  champ - the dude, chunkier, with a crown (region 1.0 -> gold in game) and a short cape.
  giant - a bulky troop with shoulder pads and a studded club in its right hand.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import lib
from lib import TEAM, SKIN, DARK, NEUTRAL, BODY, LEFT, RIGHT

FWD = Vector((0, -1, 0))


# ------------------------------------------------------------------ helpers
def tree_of(objs):
    bm = bmesh.new()
    for o in objs:
        bm.from_mesh(o.data)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def hit_front(tree, x, z):
    loc, nrm, _, _ = tree.ray_cast(Vector((x, -5, z)), Vector((0, 1, 0)), 10)
    return loc, nrm


def project_front(ob, tree, lift=0.004, bulge=0.0, center=(0, 0), radius=(1, 1)):
    """Push a decal built flat at y=0 (or with depth around y=0) onto the surface in
    front of `tree`. Vertices keep their local y as an offset. bulge raises the middle."""
    cx, cz = center
    for v in ob.data.vertices:
        loc, _ = hit_front(tree, v.co.x, v.co.z)
        if loc is None:
            continue
        d2 = ((v.co.x - cx) / radius[0]) ** 2 + ((v.co.z - cz) / radius[1]) ** 2
        v.co.y = loc.y - lift - bulge * max(0.0, 1 - d2) + v.co.y
    ob.data.update()
    return ob


def flat(pts, name='decal', fan=False, center=None):
    """One n-gon in the x-z plane facing -Y; with fan=True a centre vertex is added
    so the decal follows a curved surface (no chord sag)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0, z)) for x, z in pts]
    if fan:
        cx, cz = center or (sum(x for x, _ in pts) / len(pts), sum(z for _, z in pts) / len(pts))
        c = bm.verts.new((cx, 0, cz))
        fs = [bm.faces.new((c, vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    else:
        fs = [bm.faces.new(vs)]
    for f in fs:
        f.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
    ob = lib._obj_from_bm(bm, name)
    return lib.smooth(ob)


def ellipse_pts(rx, rz, n, cx=0.0, cz=0.0, phase=0.5):
    return [(cx + rx * math.cos(2 * math.pi * (i + phase) / n),
             cz + rz * math.sin(2 * math.pi * (i + phase) / n)) for i in range(n)]


def disc(rx, rz, n=8, rings=1, name='disc'):
    """Elliptical fan with `rings` rings in the x-z plane facing -Y."""
    prof = [(0, 0)] + [((i + 1) / rings, 0) for i in range(rings)]
    ob = lib.lathe(prof, n, name, phase=0.5, close_bottom=False, close_top=False)
    lib.xf(ob, rot=(90, 0, 0))
    lib.xf(ob, scale=(rx, 1, rz))
    for p in ob.data.polygons:   # make sure it faces -Y
        if p.normal.y > 0:
            ob.data.flip_normals()
            break
    return ob


def oriented(ob, normal, at):
    """Rotate a part built along +Z so +Z follows `normal`, then move it to `at`."""
    q = Vector((0, 0, 1)).rotation_difference(normal.normalized())
    ob.data.transform(q.to_matrix().to_4x4())
    lib.xf(ob, loc=at)
    return ob


def dome(rx, rz, depth, n=8, name='dome'):
    """Lens dome along +Z, open at the back; front pole at z=depth."""
    ob = lib.lathe([(1.0, -0.6), (0.8, 0.62), (0.0, 1.0)], n, name, phase=0.5,
                   close_bottom=False)
    lib.xf(ob, rot=(0, 0, 0), scale=(rx, rz, depth))
    return ob


def set_mask(ob, mask):
    lay = ob.data.vertex_colors['Col']
    for d in lay.data:
        d.color = (d.color[0], lib.lin2srgb(mask), d.color[2], 1.0)
    return ob


def limb(prof, r, length, n, name):
    return lib.lathe([(a * r, b * length) for a, b in prof], n, name, phase=0.5)


ARM_ROUND = [(0.0, 0.0), (0.9, 0.26), (1.0, 0.58), (0.86, 0.87), (0.0, 1.0)]
ARM_SIMPLE = [(0.0, 0.0), (0.95, 0.32), (1.0, 0.74), (0.0, 1.0)]
FOOT = [(0.0, 0.0), (0.95, 0.14), (0.86, 0.68), (0.0, 1.0)]
FOOT_ROUND = [(0.0, 0.0), (0.9, 0.06), (1.0, 0.36), (0.84, 0.76), (0.0, 1.0)]


# ------------------------------------------------------------------ character
def character(p, name):
    s = p.get('scale', 1.0)
    W, D = p.get('wide', 1.0), p.get('depth', 0.92)
    parts = []
    # body ------------------------------------------------------------
    body = lib.lathe([(r * s * W, z * s) for r, z in p['body']], p['n'], 'body',
                     phase=0.5, close_top=p.get('close_top', False))
    lib.xf(body, scale=(1, D, 1))
    lib.paint(body, TEAM)
    if p.get('belt'):
        b0, b1 = p['belt']
        lib.paint_faces(body, lambda c, nn: DARK if b0 * s < c.z < b1 * s else None)
    parts.append(body)
    btree = tree_of([body])

    # face patch (conformal, bulged so its chords never sink into the body)
    fx, fz, fw, fh = [v * s for v in p['face']]
    face = disc(fw, fh, p['face_n'], p.get('face_rings', 2), 'face')
    lib.xf(face, loc=(fx, 0, fz))
    project_front(face, btree, lift=p.get('face_lift', 0.008) * s, bulge=p.get('face_bulge', 0.014) * s,
                  center=(fx, fz), radius=(fw, fh))
    lib.paint(face, p.get('face_region', SKIN))
    parts.append(face)
    ftree = tree_of([body, face])

    # eyes ------------------------------------------------------------
    eyes = []
    ex, ez = p['eye_at'][0] * s, p['eye_at'][1] * s
    if p['eye_kind'] == 'dome':
        erx, erz, ed = [v * s for v in p['eye_size']]
        for side in (1, -1):
            loc, nrm = hit_front(ftree, side * ex, ez)
            nrm = (nrm + FWD * 1.2).normalized()
            e = dome(erx, erz, ed, p['eye_n'], 'eye')
            oriented(e, nrm, loc - nrm * 0.012 * s)
            lib.paint(e, DARK)
            eyes.append(e)
        parts += eyes
        etree = tree_of([body, face] + eyes)
        for side in (1, -1):
            for (hx, hz, hr, hn) in p['glints']:
                g = flat(ellipse_pts(hr * s, hr * s, hn, side * ex + hx * s, ez + hz * s), 'glint')
                project_front(g, etree, lift=0.003 * s)
                lib.paint(g, NEUTRAL)
                parts.append(g)
    else:  # 'angry': flat white slanted eyes with a small pupil, on a dark face
        w, h = p['eye_size'][0] * s, p['eye_size'][1] * s
        shape = [(-w, -0.05 * h), (-0.72 * w, -0.72 * h), (0.0, -h), (0.72 * w, -0.72 * h),
                 (w, 0.0), (0.82 * w, 0.72 * h)]
        for side in (1, -1):
            # local +x = outward; the inner corner sits low (angry slant)
            pts = [(side * x + side * ex, z + ez) for x, z in shape]
            if side < 0:
                pts.reverse()
            e = flat(pts, 'eye', fan=True)
            project_front(e, ftree, lift=0.005 * s)
            lib.paint(e, NEUTRAL)
            parts.append(e)
            pr = p.get('pupil')
            if pr:
                pu = flat(ellipse_pts(pr * s, pr * 1.15 * s, 6, side * (ex - 0.25 * w), ez - 0.3 * h), 'pupil')
                project_front(pu, ftree, lift=0.007 * s)
                lib.paint(pu, DARK)
                parts.append(pu)

    # mouth -----------------------------------------------------------
    m = p.get('mouth')
    if m:
        mx, mz, mw, mh, kind = m
        mx, mz, mw, mh = mx * s, mz * s, mw * s, mh * s
        if kind == 'smile':     # open happy "D" (flat top, round bottom)
            pts = [(-mw, 0), (-0.72 * mw, -0.7 * mh), (0, -mh), (0.72 * mw, -0.7 * mh), (mw, 0),
                   (0.0, 0.12 * mh)]
            reg = DARK
        else:                   # 'teeth': a white grin with a zig-zag bottom edge
            pts = [(-mw, 0.35 * mh), (-0.5 * mw, 0.15 * mh), (0, 0.1 * mh), (0.5 * mw, 0.15 * mh),
                   (mw, 0.35 * mh), (0.75 * mw, -0.55 * mh), (0.5 * mw, -0.05 * mh),
                   (0.25 * mw, -0.7 * mh), (0.0, -0.1 * mh), (-0.25 * mw, -0.7 * mh),
                   (-0.5 * mw, -0.05 * mh), (-0.75 * mw, -0.55 * mh)]
            reg = NEUTRAL
        mo = flat([(x + mx, z + mz) for x, z in pts], 'mouth', fan=kind == 'teeth', center=(mx, mz + 0.12 * mh))
        project_front(mo, ftree, lift=0.004 * s)
        lib.paint(mo, reg)
        parts.append(mo)
        if p.get('tongue'):
            t = flat(ellipse_pts(mw * 0.42, mh * 0.3, 6, mx, mz - mh * 0.6), 'tongue')
            project_front(t, ftree, lift=0.007 * s)
            lib.paint(t, SKIN)
            parts.append(t)

    # buckle decal on the belt (cheap: a flat quad)
    if p.get('buckle'):
        bw, bh = p['buckle'][0] * s, p['buckle'][1] * s
        bz = (p['belt'][0] + p['belt'][1]) / 2 * s
        bk = flat([(-bw, bz - bh), (bw, bz - bh), (bw, bz + bh), (-bw, bz + bh)], 'buckle')
        project_front(bk, btree, lift=0.006 * s)
        lib.paint(bk, NEUTRAL)
        parts.append(bk)

    # arms ------------------------------------------------------------
    ar, al, an = p['arm']
    sx, sy, sz = p['shoulder']
    adx, ady, adz = p['arm_dir']
    for side, mask in ((1, LEFT), (-1, RIGHT)):
        a = limb(p.get('arm_prof', ARM_ROUND), ar * s, al * s, an, 'arm')
        lib.paint(a, TEAM)
        glove = p.get('glove', NEUTRAL)
        if glove is not None:
            lib.paint_faces(a, lambda c, nn: glove if c.z > al * s * 0.56 else None)
        oriented(a, Vector((side * adx, ady, adz)), Vector((side * sx * s, sy * s, sz * s)))
        set_mask(a, mask)
        parts.append(a)
    # feet ------------------------------------------------------------
    fx_, fy_, frx, fry, frz = p['foot']
    for side, mask in ((1, LEFT), (-1, RIGHT)):
        f = limb(p.get('foot_prof', FOOT), 1.0, 1.0, p['foot_n'], 'foot')
        lib.xf(f, scale=(frx * s, fry * s, frz * s))
        lib.xf(f, loc=(side * fx_ * s, fy_ * s, 0))
        lib.paint(f, DARK, mask)
        parts.append(f)

    for fn in (p.get('hat'), p.get('extra')):
        if fn:
            parts += fn(p, s, body)
    return lib.finish(parts, name, dist=0.3 * s)


# ------------------------------------------------------------------ headgear
def hard_hat(p, s, body):
    W, D = p.get('wide', 1.0), p.get('depth', 0.92)
    prof = p.get('hat_prof', [(0.262, 0.640), (0.268, 0.666), (0.236, 0.692), (0.226, 0.785),
                              (0.165, 0.868), (0.0, 0.902)])
    h = lib.lathe([(r * s * W, z * s) for r, z in prof], p['n'], 'helmet', phase=0.5,
                  close_bottom=False)
    lib.xf(h, scale=(1, D, 1))
    lib.paint(h, TEAM)
    lib.paint_faces(h, lambda c, n: NEUTRAL if c.z < 0.69 * s else None)
    return [h]


def horned_hood(p, s, body):
    W, D = p.get('wide', 1.0), p.get('depth', 0.92)
    prof = p.get('hood_prof', [(0.25, 0.53), (0.272, 0.615), (0.272, 0.74), (0.205, 0.855), (0.0, 0.925)])
    h = lib.lathe([(r * s * W, z * s) for r, z in prof], p['n'], 'hood', phase=0.5,
                  close_bottom=False)
    lib.xf(h, scale=(1, D, 1))
    # widow's peak: drag the front of the rim down over the face
    for v in h.data.vertices:
        if v.co.z < 0.6 * s and v.co.y < 0:
            k = max(0.0, 1 - abs(v.co.x) / (0.16 * s * W))
            v.co.z -= 0.06 * s * k
    lib.paint(h, TEAM)
    out = [h]
    hr, hl, hx, hz, splay = p['horn']
    for side in (1, -1):
        horn = limb([(1.0, -0.1), (0.78, 0.4), (0.42, 0.78), (0.0, 1.0)], hr * s, hl * s, 6, 'horn')
        lib.bend_verts(horn, lambda co, side=side: co + Vector((-side * (co.z / (hl * s)) ** 2 * hl * s * 0.5, 0, 0)))
        horn.data.transform(Matrix.Rotation(math.radians(side * splay), 4, 'Y'))
        lib.xf(horn, loc=(side * hx * s * W, 0.02 * s, hz * s))
        lib.paint(horn, NEUTRAL)
        out.append(horn)
    return out


def crown(p, s, body):
    """Zig-zag crown band (one mesh) with balls on the five points."""
    n, z0, r = 20, p['crown_z'] * s, p['crown_r'] * s
    hpat = [0.20, 0.12, 0.075, 0.12]
    bm = bmesh.new()
    ob_, ot, it, ib = [], [], [], []
    for i in range(n):
        a = 2 * math.pi * i / n - math.pi / 2       # i = 0 at the front (-Y)
        c, sn = math.cos(a), math.sin(a)
        hh = hpat[i % 4] * s
        ob_.append(bm.verts.new((r * c, r * sn, z0)))
        ot.append(bm.verts.new((r * 1.04 * c, r * 1.04 * sn, z0 + hh)))
        it.append(bm.verts.new((r * 0.9 * c, r * 0.9 * sn, z0 + hh - 0.01 * s)))
        ib.append(bm.verts.new((r * 0.86 * c, r * 0.86 * sn, z0)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ob_[i], ob_[j], ot[j], ot[i]))
        bm.faces.new((ot[i], ot[j], it[j], it[i]))
        bm.faces.new((it[i], it[j], ib[j], ib[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    band = lib._obj_from_bm(bm, 'crown')
    band.data.use_auto_smooth = True
    band.data.auto_smooth_angle = math.radians(50)
    lib.smooth(band)
    lib.paint(band, NEUTRAL)
    out = [band]
    for i in range(0, n, 4):
        a = 2 * math.pi * i / n - math.pi / 2
        b = lib.ball(0.034 * s, 6, 4, 'gem')
        lib.xf(b, loc=(r * 1.0 * math.cos(a), r * 1.0 * math.sin(a), z0 + (hpat[0] + 0.02) * s))
        lib.paint(b, NEUTRAL)
        out.append(b)
    gem = flat(ellipse_pts(0.03 * s, 0.035 * s, 6, 0, z0 + 0.06 * s), 'jewel')
    project_front(gem, tree_of([band]), lift=0.003 * s)
    lib.paint(gem, DARK)
    out.append(gem)
    return out


def cape(p, s, body):
    """A short cape wrapped around the back (team colour, neutral hem): reads from behind."""
    W, D = p.get('wide', 1.0), p.get('depth', 0.92)
    prof = p['body']

    def r_at(z):  # body radius at height z (unscaled profile units)
        for (r0, z0), (r1, z1) in zip(prof[:-1], prof[1:]):
            if z0 <= z <= z1:
                return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
        return prof[-1][0]
    bm = bmesh.new()
    cols, rows = 10, 4
    grid = []
    rmax = max(r for r, _ in prof)
    for j in range(rows + 1):
        t = j / rows
        z = 0.66 - 0.48 * t
        R = ((r_at(z) if z > 0.42 else rmax) + 0.012 + 0.04 * t * t) * s * W
        amax = math.radians(48 + 30 * t)
        row = []
        for i in range(cols + 1):
            u = -1 + 2 * i / cols
            a = u * amax
            rr = R * (1 + 0.05 * t * math.cos(u * 9))      # soft folds toward the hem
            row.append(bm.verts.new((rr * math.sin(a), rr * math.cos(a) * D, z * s)))
        grid.append(row)
    for j in range(rows):
        for i in range(cols):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    ob = lib._obj_from_bm(bm, 'cape')
    for pl in ob.data.polygons:  # outward = +Y
        if pl.normal.y < 0:
            ob.data.flip_normals()
        break
    m = ob.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = 0.03 * s
    m.offset = -1.0
    lib.apply_mods(ob)
    lib.smooth(ob)
    lib.paint(ob, TEAM)
    lib.paint_faces(ob, lambda c, n: NEUTRAL if c.z < 0.245 * s else None)
    return [ob]


def giant_extra(p, s, body):
    W = p.get('wide', 1.0)
    out = []
    for side in (1, -1):
        pad = lib.ball(0.12 * s, 10, 5, 'pad', sz=0.08 * s)
        lib.xf(pad, rot=(0, side * 32, 0), loc=(side * 0.255 * s * W, 0.0, 0.5 * s))
        lib.paint(pad, DARK)
        out.append(pad)
        for k, (dy, dz) in enumerate(((-0.05, 0.0), (0.06, -0.01))):
            sp = lib.lathe([(0.035 * s, 0), (0.0, 0.09 * s)], 6, 'spike', phase=0.5, close_bottom=False)
            oriented(sp, Vector((side * 0.7, dy * 3, 0.75)),
                     Vector((side * 0.29 * s * W, dy * s, (0.55 + dz) * s)))
            lib.paint(sp, NEUTRAL)
            out.append(sp)
    # studded club in the right hand (moves with the RIGHT group)
    club = lib.lathe([(0.0, 0.0), (0.045, 0.015), (0.04, 0.26), (0.095, 0.38), (0.1, 0.55),
                      (0.06, 0.62), (0.0, 0.64)], 8, 'club', phase=0.5)
    lib.xf(club, scale=s)
    lib.paint(club, NEUTRAL)
    lib.paint_faces(club, lambda c, n: DARK if c.z < 0.22 * s else None)
    studs = []
    for k in range(5):
        a = 2 * math.pi * k / 5
        st = lib.lathe([(0.03 * s, 0), (0.0, 0.065 * s)], 5, 'stud', phase=0.5, close_bottom=False)
        oriented(st, Vector((math.cos(a), math.sin(a), 0.25)),
                 Vector((0.09 * s * math.cos(a), 0.09 * s * math.sin(a), 0.47 * s)))
        lib.paint(st, DARK)
        studs.append(st)
    club = lib.join([club] + studs, 'club')
    sx, sy, sz = p['shoulder']
    adx, ady, adz = p['arm_dir']
    d = Vector((-adx, ady, adz)).normalized()
    hand = Vector((-sx * s, sy * s, sz * s)) + d * p['arm'][1] * s * 0.8
    oriented(club, Vector((-0.15, -0.5, 0.85)), hand - Vector((0, 0, 0.1 * s)))
    set_mask(club, RIGHT)
    out.append(club)
    return out


# ------------------------------------------------------------------ specs
DUDE = dict(
    n=12, depth=0.92,
    body=[(0.0, 0.10), (0.195, 0.115), (0.272, 0.20), (0.29, 0.26), (0.285, 0.40),
          (0.255, 0.54), (0.205, 0.665)],
    belt=(0.2, 0.26), buckle=(0.03, 0.022),
    face=(0.0, 0.45, 0.195, 0.14), face_n=14, face_rings=2,
    eye_kind='dome', eye_at=(0.083, 0.468), eye_size=(0.062, 0.08, 0.032), eye_n=8,
    glints=[(0.02, 0.03, 0.024, 6)],
    mouth=(0.0, 0.375, 0.036, 0.034, 'smile'),
    arm=(0.062, 0.2, 7), shoulder=(0.235, -0.02, 0.37), arm_dir=(0.85, -0.5, -0.1),
    foot=(0.118, -0.035, 0.088, 0.115, 0.13), foot_n=7,
    hat=hard_hat,
)

TROOP = dict(DUDE)
TROOP.update(
    face=(0.0, 0.44, 0.2, 0.14), face_region=DARK, buckle=None,
    eye_kind='angry', eye_at=(0.088, 0.462), eye_size=(0.064, 0.058), pupil=0.015,
    mouth=(0.0, 0.37, 0.07, 0.034, 'teeth'),
    horn=(0.06, 0.24, 0.205, 0.735, 48),
    hat=horned_hood, glove=DARK, arm_prof=ARM_SIMPLE,
    arm_dir=(0.9, -0.4, 0.0),
)

CHAMP = dict(
    n=20, depth=0.95, wide=1.08, close_top=True,
    body=[(0.0, 0.10), (0.21, 0.112), (0.295, 0.16), (0.325, 0.22), (0.338, 0.28), (0.335, 0.4),
          (0.315, 0.53), (0.278, 0.66), (0.215, 0.78), (0.125, 0.865), (0.0, 0.895)],
    belt=(0.16, 0.25), buckle=(0.045, 0.032),
    face=(0.0, 0.5, 0.24, 0.18), face_n=20, face_rings=3, face_bulge=0.02,
    eye_kind='dome', eye_at=(0.1, 0.52), eye_size=(0.074, 0.094, 0.04), eye_n=12,
    glints=[(0.024, 0.036, 0.028, 8), (-0.022, -0.04, 0.012, 6)],
    mouth=(0.0, 0.415, 0.05, 0.045, 'smile'), tongue=True,
    arm=(0.08, 0.24, 10), shoulder=(0.29, -0.02, 0.38), arm_dir=(0.8, -0.45, 0.15),
    foot=(0.15, -0.04, 0.11, 0.14, 0.15), foot_n=10, foot_prof=FOOT_ROUND,
    hat=crown, crown_z=0.79, crown_r=0.21, extra=cape,
)

GIANT = dict(TROOP)
GIANT.update(
    n=16, wide=1.25, depth=0.95,
    body=[(0.0, 0.10), (0.2, 0.112), (0.28, 0.17), (0.3, 0.24), (0.3, 0.32), (0.29, 0.43),
          (0.258, 0.54), (0.2, 0.65)],
    belt=(0.17, 0.24), buckle=(0.04, 0.026),
    face=(0.0, 0.43, 0.25, 0.14), face_n=16, face_lift=0.018,
    eye_at=(0.105, 0.455), eye_size=(0.062, 0.05), pupil=0.018,
    mouth=(0.0, 0.355, 0.1, 0.045, 'teeth'),
    horn=(0.07, 0.3, 0.2, 0.72, 52),
    arm=(0.085, 0.23, 8), shoulder=(0.3, -0.0, 0.36), arm_dir=(0.88, -0.3, -0.2),
    arm_prof=ARM_ROUND,
    foot=(0.15, -0.035, 0.105, 0.13, 0.13), foot_n=8,
    extra=giant_extra,
)


def shadow():
    """Flat disc for blob shadows. R = dark region; B = falloff (1 centre, 0 rim)."""
    bm = bmesh.new()
    c = bm.verts.new((0, 0, 0.01))
    ring = [bm.verts.new((0.35 * math.cos(2 * math.pi * i / 16), 0.35 * math.sin(2 * math.pi * i / 16), 0.01))
            for i in range(16)]
    for i in range(16):
        bm.faces.new((c, ring[i], ring[(i + 1) % 16]))
    ob = lib._obj_from_bm(bm, 'shadow')
    lib.paint(ob, DARK)
    lay = ob.data.vertex_colors['Col']
    for poly in ob.data.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            a = 1.0 if ob.data.vertices[vi].co.xy.length < 1e-4 else 0.0
            lay.data[li].color = (lay.data[li].color[0], 0.0, lib.lin2srgb(a), 1.0)
    return ob


def build():
    out = []
    for spec, name, h in ((DUDE, 'dude', 0.9), (TROOP, 'troop', 0.9),
                          (CHAMP, 'champ', 1.6), (GIANT, 'giant', 1.5)):
        ob = character(spec, name)
        lib.xf(ob, scale=h / lib.height(ob))
        out.append(ob)
    out.append(shadow())
    return out


def extra_views(objs):
    import preview
    d = {o.name: o for o in objs}
    return [(d[n], n + ' back', preview.GAME, lib.PAL['blue'] if n in ('dude', 'champ') else lib.PAL['red'])
            for n in ('dude', 'troop', 'champ', 'giant')]


def extra_sheets(objs):
    """Team readability: dude/troop in blue and red, front and game-camera back."""
    import preview
    d = {o.name: o for o in objs}
    its = []
    for team in ('blue', 'red'):
        for n in ('dude', 'troop'):
            its.append((d[n], '%s %s' % (n, team), preview.FRONT, lib.PAL[team]))
            its.append((d[n], '%s %s back' % (n, team), preview.GAME, lib.PAL[team]))
    return [('dudes_teams.png', its, 4)]

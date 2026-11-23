"""gates.glb: pillar, bar, ring (timing gate), lock (padlock icon).
Region 1.0 = the tintable body (the game colours it by gate type); dark = trim."""
import math

from mathutils import Matrix, Vector

import lib
from lib import TEAM, DARK, NEUTRAL
from m_dudes import flat, ellipse_pts, project_front, tree_of


def pillar():
    parts = []
    plinth = lib.box(0.48, 0.48, 0.22, bevel=0.06, name='plinth')
    lib.paint(plinth, DARK)
    parts.append(plinth)
    col = lib.rlathe([(0, 0.2), (0.2, 0.2), (0.17, 0.36), (0.145, 0.55), (0.14, 1.62),
                      (0.205, 1.8), (0, 1.8)], 0.05, n=14, name='shaft')
    lib.paint(col, NEUTRAL)
    parts.append(col)
    for z in (0.78, 1.32):
        t = lib.torus(0.145, 0.032, 14, 6, 'band')
        lib.xf(t, loc=(0, 0, z))
        lib.paint(t, DARK)
        parts.append(t)
    collar = lib.rcyl(0.225, 0.09, 0.03, n=14, z0=1.79, name='collar')
    lib.paint(collar, DARK)
    parts.append(collar)
    cap = lib.ball(0.2, 14, 8, 'cap')
    lib.xf(cap, loc=(0, 0, 2.0))
    lib.paint(cap, NEUTRAL)
    parts.append(cap)
    return lib.finish(parts, 'pillar')


def bar():
    base = lib.box(1.0, 0.5, 0.05, bevel=0.02, name='base')
    lib.paint(base, DARK)
    top = lib.box(0.94, 0.42, 0.1, bevel=0.035, name='glow')
    lib.xf(top, loc=(0, 0, 0.02))
    lib.paint(top, NEUTRAL)
    return lib.finish([base, top], 'bar', dist=0.2)


def ring():
    parts = []
    R, r = 0.55, 0.075
    t = lib.torus(R, r, 32, 8, 'ring')
    lib.xf(t, rot=(90, 0, 0), loc=(0, 0, R + r))
    lib.paint(t, NEUTRAL)
    parts.append(t)
    # five dividers on the face of the ring (x1..x5 segments) and a hub-less frame
    for k in range(5):
        a = math.pi / 2 + 2 * math.pi * k / 5
        d = lib.box(0.05, 0.19, 0.2, bevel=0.015, segs=1, name='notch', base=False)
        lib.xf(d, rot=(0, -math.degrees(a) + 90, 0),
               loc=(R * math.cos(a), 0, R + r + R * math.sin(a)))
        lib.paint(d, DARK)
        parts.append(d)
    return lib.finish(parts, 'ring', dist=0.25)


def lock():
    parts = []
    body = lib.box(0.5, 0.24, 0.42, bevel=0.08, name='lockbody')
    lib.paint(body, NEUTRAL)
    parts.append(body)
    R, r = 0.15, 0.05
    arc = lib.torus(R, r, 10, 6, 'shackle', arc=180)
    lib.xf(arc, rot=(90, 0, 0), loc=(0, 0, 0.56))
    lib.paint(arc, DARK)
    parts.append(arc)
    for sx in (-R, R):
        leg = lib.cyl(r, 0.2, 6, name='leg')
        lib.xf(leg, loc=(sx, 0, 0.36))
        lib.smooth(leg)
        lib.paint(leg, DARK)
        parts.append(leg)
    tree = tree_of([body])
    hole = flat(ellipse_pts(0.05, 0.05, 8, 0, 0.25), 'hole')
    project_front(hole, tree, lift=0.004)
    slot = flat([(-0.028, 0.24), (0.028, 0.24), (0.04, 0.11), (-0.04, 0.11)], 'slot')
    project_front(slot, tree, lift=0.004)
    for d in (hole, slot):
        lib.paint(d, DARK)
        parts.append(d)
    return lib.finish(parts, 'lock', dist=0.2)


def build():
    return [pillar(), bar(), ring(), lock()]

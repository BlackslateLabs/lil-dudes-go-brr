"""Build every Lil Dudes Go Brr model and its preview sheet.

  blender -b --factory-startup -P tools/art/build_models.py -- [names...] [--no-preview]

names: dudes gates fortress lane cannon scenery (default: all).
Writes apps/web/public/assets/models/v6/<name>.glb and tools/art/previews/<name>.png,
and prints a triangle / height table (also saved to tools/art/previews/stats.json).
"""
import importlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import lib  # noqa: E402
import preview  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'apps', 'web', 'public', 'assets', 'models', 'v6')
PREV = os.path.join(HERE, 'previews')
TMP = os.environ.get('ART_TMP', '/tmp')

# glb name -> (module, preview team colour for region 0, sheet columns)
KITS = {
    'dudes': ('m_dudes', lib.PAL['blue'], 4),
    'gates': ('m_gates', lib.PAL['blue'], 4),
    'fortress': ('m_fortress', lib.PAL['red'], 3),
    'lane': ('m_lane', lib.PAL['blue'], 3),
    'cannon': ('m_cannon', lib.PAL['blue'], 2),
    'scenery': ('m_scenery', None, 4),
}


def bounds(ob):
    vs = [v.co for v in ob.data.vertices]
    lo = [min(v[i] for v in vs) for i in range(3)]
    hi = [max(v[i] for v in vs) for i in range(3)]
    return lo, hi


def build_kit(name, do_preview=True):
    modname, team, cols = KITS[name]
    lib.reset()
    mod = importlib.import_module(modname)
    importlib.reload(mod)
    objs = mod.build()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.glb')
    lib.export(objs, path)
    stats = {}
    for o in objs:
        lo, hi = bounds(o)
        # report in glTF axes: x, y(up)=blender z, z(front)=-blender y
        stats[o.name] = dict(tris=lib.tris(o), height=round(hi[2] - lo[2], 3),
                             width=round(hi[0] - lo[0], 3), depth=round(hi[1] - lo[1], 3),
                             min_y=round(lo[2], 3))
    stats['_bytes'] = os.path.getsize(path)
    if do_preview:
        os.makedirs(PREV, exist_ok=True)
        items = []
        for o in objs:
            lbl = '%s %d' % (o.name, lib.tris(o))
            items.append((o, lbl, preview.FRONT, team))
        extra = getattr(mod, 'extra_views', None)
        if extra:
            items += extra(objs)
        preview.render_tiles(items, os.path.join(PREV, name + '.png'), cols, TMP)
        sheets = getattr(mod, 'extra_sheets', None)
        if sheets:
            for fname, its, c in sheets(objs):
                preview.render_tiles(its, os.path.join(PREV, fname), c, TMP)
    return stats


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    do_prev = '--no-preview' not in argv
    names = [a for a in argv if not a.startswith('--')] or list(KITS)
    all_stats = {}
    sp = os.path.join(PREV, 'stats.json')
    if os.path.exists(sp):
        with open(sp) as f:
            all_stats = json.load(f)
    for n in names:
        all_stats[n] = build_kit(n, do_prev)
        print('== %s.glb  %d bytes' % (n, all_stats[n]['_bytes']))
        for k, v in all_stats[n].items():
            if not k.startswith('_'):
                print('   %-14s tris %5d  h %.2f  w %.2f  d %.2f' % (k, v['tris'], v['height'], v['width'], v['depth']))
    os.makedirs(PREV, exist_ok=True)
    with open(sp, 'w') as f:
        json.dump(all_stats, f, indent=1, sort_keys=True)


main()

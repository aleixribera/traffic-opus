"""Build the map's trees and shrubs in Blender and export them as one GLB.

Run from the project root with Blender's CLI:

    blender -b --factory-startup -P tools/blender/build_trees.py -- [--no-previews]

Outputs
    public/models/trees.glb               every tree, each a set of mesh objects named <tree>__<part>
    tools/blender/previews/_trees.png     the family side by side (Workbench), and _trees_top.png from above

Conventions (Blender Z up; the GLB is +Y up)
    A tree stands at the origin with its crown's footprint about one unit in radius: the game scales it by the crown
    radius it wants (metres) and turns it about the vertical, so a tree is as wide as the flat crown the ground paints
    far away (src/render/terrain3d.ts) and the two can stand in for each other.
    Parts, by object name (after the double underscore) and material:
        trunk          tr_bark     the trunk below the crown
        leaf0..n       tr_leaf*    one clump of foliage each: the game sways them, turns them in autumn and lets
                                   them fall clump by clump, so each clump is its own object (its middle is found
                                   from its vertices)
        needle0..n     tr_pine     a conifer's tiers: evergreen, they carry the snow
        bush0..n       tr_bush     a shrub's foliage: it thins to a twiggy mass in winter instead of falling
        bare           tr_twig     the limbs inside a broadleaf's crown: what stands in winter
        lod_*                      the same tree in a couple of dozen triangles, for when it is a few pixels tall
    Everything is flat-shaded and low-poly on purpose, like the buildings.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "models")
PREV = os.path.join(HERE, "previews")


def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(_lin(int(h[i:i + 2], 16)) for i in (0, 2, 4))


MATS = {}


def mat(name, hexstr):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    col = hexcol(hexstr)
    bsdf.inputs["Base Color"].default_value = (*col, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
    m.diffuse_color = (*col, 1.0)
    MATS[name] = m
    return m


def palette():
    return {
        "bark": mat("tr_bark", "#6b5540"), "twig": mat("tr_twig", "#6d5f52"),
        "leaf": mat("tr_leaf", "#5f8436"), "leaf2": mat("tr_leaf2", "#6f923c"),
        "pine": mat("tr_pine", "#3d6a3c"), "bush": mat("tr_bush", "#6a8a3a"),
    }


class Part:
    """One mesh object of a tree, built in a bmesh."""

    def __init__(self, name, m):
        self.name, self.m = name, m
        self.bm = bmesh.new()

    def finish(self, coll):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        me.materials.append(self.m)
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(self.name, me)
        coll.objects.link(ob)
        return ob


def blob(part, c, radii, subdiv, rng, jitter=0.1, flat=0.72, lean=(0.0, 0.0)):
    """A clump of foliage: an icosphere pulled about a little, its underside flattened, so every clump is its own
    faceted lump and no two read alike."""
    bm = part.bm
    geom = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0, matrix=Matrix.Rotation(rng.uniform(0, 6.28), 4, "Z"))
    for v in geom["verts"]:
        p = v.co.copy()
        k = 1.0 + rng.uniform(-jitter, jitter)
        z = p.z * (flat if p.z < 0 else 1.0)
        v.co = Vector((c[0] + (p.x * k) * radii[0] + lean[0] * max(0.0, p.z),
                       c[1] + (p.y * k) * radii[1] + lean[1] * max(0.0, p.z),
                       c[2] + z * k * radii[2]))


def prism(part, p, q, r0, r1, n=5, cap=True, rot=0.0):
    """A tapered n-sided limb from p to q."""
    bm = part.bm
    p, q = Vector(p), Vector(q)
    ax = (q - p).normalized()
    side = ax.cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(ax)
    ring = lambda o, r: [bm.verts.new(o + (side * math.cos(rot + 6.2832 * i / n) + up * math.sin(rot + 6.2832 * i / n)) * r) for i in range(n)]
    a, b = ring(p, r0), ring(q, r1)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap:
        bm.faces.new(b)


def tier(part, r, z0, z1, n, rot, rng, skirt=0.12):
    """One tier of a conifer: a cone with a drooping skirt, its rim uneven, closed underneath."""
    bm = part.bm
    rim = []
    for i in range(n):
        a = rot + 6.2832 * i / n
        k = r * (1.0 + rng.uniform(-0.1, 0.1))
        rim.append(bm.verts.new((k * math.cos(a), k * math.sin(a), z0 - skirt * (i % 2) * r)))
    apex = bm.verts.new((rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02), z1))
    under = bm.verts.new((0, 0, z0 + 0.22 * r))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((rim[i], rim[j], apex))
        bm.faces.new((rim[j], rim[i], under))


def limbs(part, base_z, top_z, reach, n, rng, r=0.05, crown=None):
    """The bare limbs of a broadleaf: the trunk running on up, and limbs leaving it at a slant, every other one
    forking. `crown` (centre, radii) is the main clump of foliage: the tips stay inside it, so nothing pokes out of
    the summer tree."""
    def inside(p):
        if crown is None:
            return p
        c, rad = Vector(crown[0]), crown[1]
        d = Vector(((p.x - c.x) / rad[0], (p.y - c.y) / rad[1], (p.z - c.z) / rad[2]))
        return p if d.length <= 0.84 else Vector((c.x + d.x / d.length * 0.84 * rad[0], c.y + d.y / d.length * 0.84 * rad[1], c.z + d.z / d.length * 0.84 * rad[2]))
    prism(part, (0, 0, base_z), inside(Vector((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), top_z))), r * 1.5, r * 0.4, n=4)
    a0 = rng.uniform(0, 6.28)
    for i in range(n):
        a = a0 + 6.2832 * i / n + rng.uniform(-0.3, 0.3)
        z0 = base_z + (top_z - base_z) * rng.uniform(0.05, 0.4)
        out = reach * rng.uniform(0.8, 1.0)
        mid = Vector((math.cos(a) * out * 0.55, math.sin(a) * out * 0.55, z0 + (top_z - z0) * rng.uniform(0.35, 0.55)))
        prism(part, (0, 0, z0), mid, r, r * 0.6, n=3, cap=False)
        tip = inside(Vector((math.cos(a) * out, math.sin(a) * out, mid.z + (top_z - mid.z) * rng.uniform(0.35, 0.8))))
        prism(part, mid, tip, r * 0.6, r * 0.15, n=3)
        if i % 2 == 0:
            b = a + rng.choice((-1, 1)) * rng.uniform(0.5, 0.9)
            tip2 = inside(Vector((math.cos(b) * out * 0.85, math.sin(b) * out * 0.85, mid.z + (top_z - mid.z) * rng.uniform(0.2, 0.6))))
            prism(part, mid, tip2, r * 0.5, r * 0.12, n=3)


# ------------------------------------------------------------------ the family

def t_round(P, rng):
    """A round-headed broadleaf (a maple, a lime): one big crown with two lobes low on its sides and a cap."""
    parts = []
    t = Part("trunk", P["bark"]); prism(t, (0, 0, 0), (0.02, 0.0, 1.55), 0.14, 0.09, n=5, cap=False); parts.append(t)
    l = Part("leaf0", P["leaf"]); blob(l, (0, 0, 2.08), (0.93, 0.93, 0.92), 2, rng, 0.09); parts.append(l)
    l = Part("leaf1", P["leaf2"]); blob(l, (0.5, 0.24, 1.6), (0.52, 0.52, 0.44), 1, rng, 0.12); parts.append(l)
    l = Part("leaf2", P["leaf"]); blob(l, (-0.45, -0.36, 1.68), (0.5, 0.5, 0.44), 1, rng, 0.12); parts.append(l)
    l = Part("leaf3", P["leaf2"]); blob(l, (-0.12, 0.42, 2.62), (0.5, 0.5, 0.42), 1, rng, 0.12); parts.append(l)
    b = Part("bare", P["twig"]); limbs(b, 1.5, 2.9, 0.86, 5, rng, crown=((0, 0, 2.08), (0.93, 0.93, 0.92))); parts.append(b)
    t = Part("lod_trunk", P["bark"]); prism(t, (0, 0, 0), (0, 0, 1.6), 0.13, 0.09, n=3, cap=False); parts.append(t)
    l = Part("lod_leaf0", P["leaf"]); blob(l, (0, 0, 2.1), (0.98, 0.98, 0.98), 1, rng, 0.06); parts.append(l)
    return parts


def t_tall(P, rng):
    """A tall, narrow broadleaf (an elm, a poplar): a long oval crown with a smaller head above it."""
    parts = []
    t = Part("trunk", P["bark"]); prism(t, (0, 0, 0), (0.0, 0.02, 1.3), 0.12, 0.08, n=5, cap=False); parts.append(t)
    l = Part("leaf0", P["leaf"]); blob(l, (0, 0, 2.15), (0.74, 0.74, 1.12), 2, rng, 0.08, flat=0.85); parts.append(l)
    l = Part("leaf1", P["leaf2"]); blob(l, (0.05, 0.04, 3.25), (0.5, 0.5, 0.72), 1, rng, 0.1, flat=0.9); parts.append(l)
    l = Part("leaf2", P["leaf2"]); blob(l, (0.34, -0.22, 1.5), (0.42, 0.42, 0.42), 1, rng, 0.12); parts.append(l)
    l = Part("leaf3", P["leaf"]); blob(l, (-0.3, 0.28, 1.72), (0.4, 0.4, 0.46), 1, rng, 0.12); parts.append(l)
    b = Part("bare", P["twig"]); limbs(b, 1.25, 3.8, 0.66, 5, rng, r=0.045, crown=((0, 0, 2.5), (0.74, 0.74, 1.45))); parts.append(b)
    t = Part("lod_trunk", P["bark"]); prism(t, (0, 0, 0), (0, 0, 1.4), 0.11, 0.08, n=3, cap=False); parts.append(t)
    l = Part("lod_leaf0", P["leaf"]); blob(l, (0, 0, 2.5), (0.74, 0.74, 1.42), 1, rng, 0.05, flat=0.9); parts.append(l)
    return parts


def t_spread(P, rng):
    """A spreading broadleaf (an oak): a short thick trunk under a wide, low crown made of several clumps."""
    parts = []
    t = Part("trunk", P["bark"]); prism(t, (0, 0, 0), (0.03, 0.02, 1.15), 0.18, 0.12, n=5, cap=False); parts.append(t)
    l = Part("leaf0", P["leaf"]); blob(l, (0.0, 0.0, 1.9), (0.82, 0.82, 0.62), 2, rng, 0.09); parts.append(l)
    l = Part("leaf1", P["leaf2"]); blob(l, (0.64, 0.12, 1.62), (0.52, 0.48, 0.42), 1, rng, 0.12); parts.append(l)
    l = Part("leaf2", P["leaf"]); blob(l, (-0.52, 0.44, 1.66), (0.52, 0.5, 0.42), 1, rng, 0.12); parts.append(l)
    l = Part("leaf3", P["leaf2"]); blob(l, (-0.26, -0.62, 1.56), (0.5, 0.46, 0.4), 1, rng, 0.12); parts.append(l)
    l = Part("leaf4", P["leaf"]); blob(l, (0.2, 0.22, 2.3), (0.48, 0.48, 0.34), 1, rng, 0.12); parts.append(l)
    b = Part("bare", P["twig"]); limbs(b, 1.1, 2.45, 1.0, 5, rng, r=0.06, crown=((0, 0, 1.85), (1.1, 1.1, 0.72))); parts.append(b)
    t = Part("lod_trunk", P["bark"]); prism(t, (0, 0, 0), (0, 0, 1.2), 0.17, 0.12, n=3, cap=False); parts.append(t)
    l = Part("lod_leaf0", P["leaf"]); blob(l, (0, 0, 1.85), (1.08, 1.08, 0.72), 1, rng, 0.06); parts.append(l)
    return parts


def t_pine(P, rng):
    """A pine: four drooping tiers on a bare foot of trunk, each turned against the last."""
    parts = []
    t = Part("trunk", P["bark"]); prism(t, (0, 0, 0), (0, 0, 1.2), 0.1, 0.07, n=4, cap=False); parts.append(t)
    for i, (r, z0, z1) in enumerate(((0.9, 0.85, 2.05), (0.74, 1.55, 2.8), (0.56, 2.3, 3.55), (0.38, 3.05, 4.3))):
        n = Part(f"needle{i}", P["pine"]); tier(n, r, z0, z1, 8, i * 0.45 + rng.uniform(0, 0.5), rng); parts.append(n)
    t = Part("lod_trunk", P["bark"]); prism(t, (0, 0, 0), (0, 0, 1.0), 0.09, 0.07, n=3, cap=False); parts.append(t)
    n = Part("lod_needle0", P["pine"]); tier(n, 0.84, 0.85, 2.9, 5, 0.2, rng, skirt=0.0); tier(n, 0.56, 2.2, 4.2, 5, 0.8, rng, skirt=0.0); parts.append(n)
    return parts


def t_spruce(P, rng):
    """A spruce: taller and narrower, five close tiers to a point."""
    parts = []
    t = Part("trunk", P["bark"]); prism(t, (0, 0, 0), (0, 0, 0.9), 0.09, 0.07, n=4, cap=False); parts.append(t)
    for i, (r, z0, z1) in enumerate(((0.72, 0.6, 1.75), (0.62, 1.3, 2.55), (0.5, 2.05, 3.3), (0.38, 2.8, 4.05), (0.26, 3.55, 4.95))):
        n = Part(f"needle{i}", P["pine"]); tier(n, r, z0, z1, 7, i * 0.52 + rng.uniform(0, 0.5), rng, skirt=0.16); parts.append(n)
    t = Part("lod_trunk", P["bark"]); prism(t, (0, 0, 0), (0, 0, 0.8), 0.08, 0.07, n=3, cap=False); parts.append(t)
    n = Part("lod_needle0", P["pine"]); tier(n, 0.68, 0.6, 3.0, 5, 0.1, rng, skirt=0.0); tier(n, 0.42, 2.4, 4.9, 5, 0.7, rng, skirt=0.0); parts.append(n)
    return parts


def t_shrub_round(P, rng):
    """A rounded bush: one low dome and a shoulder."""
    parts = []
    b = Part("bush0", P["bush"]); blob(b, (0, 0, 0.52), (0.92, 0.92, 0.74), 2, rng, 0.12, flat=0.7); parts.append(b)
    b = Part("bush1", P["bush"]); blob(b, (0.5, -0.3, 0.4), (0.5, 0.5, 0.5), 1, rng, 0.14, flat=0.8); parts.append(b)
    b = Part("lod_bush0", P["bush"]); blob(b, (0, 0, 0.5), (1.0, 1.0, 0.76), 1, rng, 0.06, flat=0.66); parts.append(b)
    return parts


def t_shrub_clump(P, rng):
    """A thicket: three uneven lumps grown together."""
    parts = []
    for i, (c, r) in enumerate((((-0.28, 0.2, 0.62), (0.62, 0.62, 0.78)), ((0.42, 0.1, 0.48), (0.56, 0.56, 0.6)), ((0.0, -0.46, 0.4), (0.5, 0.5, 0.5)))):
        b = Part(f"bush{i}", P["bush"]); blob(b, c, r, 1, rng, 0.14, flat=0.78); parts.append(b)
    b = Part("lod_bush0", P["bush"]); blob(b, (0, 0, 0.5), (0.98, 0.98, 0.8), 1, rng, 0.08, flat=0.62); parts.append(b)
    return parts


TREES = {
    "tree_round": t_round, "tree_tall": t_tall, "tree_spread": t_spread,
    "tree_pine": t_pine, "tree_spruce": t_spruce,
    "shrub_round": t_shrub_round, "shrub_clump": t_shrub_clump,
}


def clip_ground(ob):
    """Nothing of a tree hangs below the ground."""
    for v in ob.data.vertices:
        if v.co.z < 0:
            v.co.z = 0.0


def build():
    coll = bpy.data.collections.new("trees")
    bpy.context.scene.collection.children.link(coll)
    P = palette()
    out = {}
    for k, (name, fn) in enumerate(TREES.items()):
        rng = random.Random(1930 + k * 17)
        objs = []
        for part in fn(P, rng):
            part.name = f"{name}__{part.name}"
            ob = part.finish(coll)
            clip_ground(ob)
            objs.append(ob)
        out[name] = objs
    return out


def export(objs):
    os.makedirs(OUT, exist_ok=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, "trees.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_extras=False)
    return path


def previews(built):
    """The family in a row, full models in front and the far ones behind, from the game's angle and from above."""
    os.makedirs(PREV, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light, sh.color_type, sh.show_shadows, sh.show_cavity = "STUDIO", "MATERIAL", True, False
    sh.show_specular_highlight = False
    sc.display.shadow_shift = 0.2
    sc.display.shadow_focus = 0.6
    sc.display.light_direction = (-0.45, -0.55, 0.7)
    sc.world = bpy.data.worlds.new("w")
    sc.render.film_transparent = False
    sc.world.color = hexcol("#a39a5c")
    sc.view_settings.view_transform = "Standard"
    ground = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40)
    bm.to_mesh(ground); bm.free()
    ground.materials.append(mat("pv_ground", "#a39a5c"))
    g = bpy.data.objects.new("ground", ground)
    sc.collection.objects.link(g)
    for i, (name, objs) in enumerate(built.items()):
        for o in objs:
            lod = "__lod_" in o.name
            o.location = ((i - (len(built) - 1) / 2) * 2.8, 3.4 if lod else 0.0, 0.0)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    for fname, tilt, scale, res in (("_trees.png", 40, 21.0, (2000, 900)), ("_trees_top.png", 0, 21.0, (2000, 700))):
        t = math.radians(tilt)
        cam.location = (0, 1.7 - 60 * math.sin(t), 60 * math.cos(t) + 1.5)
        cam.rotation_euler = (t, 0, 0)
        cam_d.ortho_scale = scale
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.filepath = os.path.join(PREV, fname)
        bpy.ops.render.render(write_still=True)
    for objs in built.values():
        for o in objs:
            o.location = (0, 0, 0)
    bpy.data.objects.remove(g)


def verify():
    """Read the GLB back and count what is in it."""
    bpy.ops.wm.read_homefile(use_empty=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "trees.glb"))
    by = {}
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        tree, part = o.name.split("__")
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        lo = min((o.matrix_world @ v.co).z for v in o.data.vertices)
        rad = max(math.hypot((o.matrix_world @ v.co).x, (o.matrix_world @ v.co).y) for v in o.data.vertices)
        top = max((o.matrix_world @ v.co).z for v in o.data.vertices)
        d = by.setdefault(tree, {"full": 0, "lod": 0, "lo": 0.0, "rad": 0.0, "top": 0.0})
        d["lod" if part.startswith("lod_") else "full"] += tris
        d["lo"], d["rad"], d["top"] = min(d["lo"], lo), max(d["rad"], rad), max(d["top"], top)
    ok = True
    for tree, d in by.items():
        bad = []
        if not 40 <= d["full"] <= 270:
            bad.append(f"{d['full']} tris")
        if d["lod"] > 40:
            bad.append(f"lod {d['lod']} tris")
        if d["lo"] < -1e-4:
            bad.append(f"below ground {d['lo']:.3f}")
        if not 0.6 <= d["rad"] <= 1.2:
            bad.append(f"footprint {d['rad']:.2f}")
        ok = ok and not bad
        print(f"[verify] {tree:13s} tris={d['full']:3d} lod={d['lod']:2d} radius={d['rad']:.2f} height={d['top']:.2f} {'OK' if not bad else bad}")
    print(f"[verify] {'all trees pass' if ok and len(by) == len(TREES) else 'FAILED'}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    built = build()
    export([o for objs in built.values() for o in objs])
    if "--no-previews" not in argv:
        previews(built)
    verify()


main()

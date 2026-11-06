"""Build every traffic-opus 3D model in Blender and export each as a GLB.

Run from the project root with Blender's CLI:

    blender -b --factory-startup -P tools/blender/build_models.py -- [--only house,car] [--no-previews] [--no-verify]

Outputs
    public/models/<name>.glb          one GLB per model (+Y up, transforms applied, no cameras/lights)
    tools/blender/previews/<name>.png  left: top-down, right: 3/4 view (Workbench)
    tools/blender/previews/_overview_*.png  all models side by side, same scale
    public/models/README.md           manifest written from re-importing every GLB

Conventions (1 unit = 1 m, Blender Z up)
    Buildings: origin at the ground centre of the lot, lot = the whole w (X) x d (Y) footprint, road-facing
    front at -Y. Front strip = asphalt parking. Empties park_0.. sit at each bay centre (z = 0.06) with their
    local +Y pointing the way a parked car's nose faces (cars park nose-in, so +Y, toward the building).
    Vehicles: front at -Y, origin at the ground centre, wheels on z = 0, one mesh object per material:
    body / glass / dark (+ cargo for the truck). body and cargo are pure white so the engine can tint them.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "models")
PREV = os.path.join(HERE, "previews")

PARK_DEPTH = 6.5      # depth of the asphalt strip at the front of a lot
BAY_W, BAY_L = 2.6, 5.0
BAY_Y0 = 0.8          # bays start this far behind the lot front
PAD_H = 0.06


# ------------------------------------------------------------------ colours and materials

def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(_lin(int(h[i:i + 2], 16)) for i in (0, 2, 4))


MATS = {}


def mat(name, hexstr, rough=0.8):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    col = hexcol(hexstr)
    bsdf.inputs["Base Color"].default_value = (*col, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    m.diffuse_color = (*col, 1.0)   # what Workbench previews show
    m.roughness, m.metallic = rough, 0.0
    MATS[name] = m
    return m


def palette():
    P = {}
    for k, v in {
        "pad": "#eef0ee", "asphalt": "#c9ccd0", "line": "#ffffff",
        # residential
        "res_wall": "#7ed957", "res_roof": "#62c043", "res_wall2": "#72cc4c", "res_roof2": "#57b238",
        "res_trim": "#e6e8e2",
        "apt_wall": "#2e8b3e", "apt_roof": "#287a36", "apt_brace": "#4dab5c", "apt_band": "#3a9a4b",
        # commercial
        "com_wall": "#2f86e0", "com_roof": "#2373c4", "com_rib": "#4f9ee9", "com_canopy": "#1c60a8",
        "com_glass": "#cfe4f7",
        # workplaces
        "work_wall": "#8b6fd6", "work_roof": "#7559c2", "work_glass": "#d6d3f4", "work_trim": "#9f88e2",
        # industry
        "ind_wall": "#8f949c", "ind_roof": "#7f848c", "ind_dark": "#62676e", "ind_orange": "#f07a2a",
        "ind_copper": "#cf6f35", "ind_yellow": "#f2c230", "ind_tank": "#dde0e4", "ind_steel": "#b0b5bc",
        "ac_box": "#d6d9de", "ac_fan": "#5b626c",
        # farm
        "barn_roof": "#f3f4f1", "farm_accent": "#4caf50", "silo": "#f8f8f5", "soil": "#cbb68e",
        "crop_g1": "#8ac843", "crop_g2": "#6fb23a", "crop_w1": "#e8cc6c", "crop_w2": "#d4b14f",
    }.items():
        P[k] = mat(k, v)
    return P


# ------------------------------------------------------------------ mesh builder

class Mesh:
    """Accumulates closed pieces into one bmesh with per-face material indices."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def loft(self, lo, hi, m, bevel=0.0):
        """Closed solid between two parallel loops with the same vertex count."""
        bm, idx = self.bm, self.mi(m)
        vl = [bm.verts.new(p) for p in lo]
        vh = [bm.verts.new(p) for p in hi]
        n = len(vl)
        fs = [bm.faces.new(vl[::-1]), bm.faces.new(vh)]
        for i in range(n):
            j = (i + 1) % n
            fs.append(bm.faces.new((vl[i], vl[j], vh[j], vh[i])))
        for f in fs:
            f.material_index = idx
        bmesh.ops.recalc_face_normals(bm, faces=fs)
        if bevel > 0:
            edges = list({e for f in fs for e in f.edges})
            bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect="EDGES",
                            clamp_overlap=True, profile=0.5, material=idx)
        return fs

    def cone(self, base, apex, m):
        bm, idx = self.bm, self.mi(m)
        vb = [bm.verts.new(p) for p in base]
        va = bm.verts.new(apex)
        n = len(vb)
        fs = [bm.faces.new(vb[::-1])]
        for i in range(n):
            fs.append(bm.faces.new((vb[i], vb[(i + 1) % n], va)))
        for f in fs:
            f.material_index = idx
        bmesh.ops.recalc_face_normals(bm, faces=fs)
        return fs

    def to_object(self, name, coll):
        me = bpy.data.meshes.new(name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob


# ------------------------------------------------------------------ primitives

def rect(x0, x1, y0, y1, z):
    return [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]


def box(M, x0, x1, y0, y1, z0, z1, m, bevel=0.0):
    return M.loft(rect(x0, x1, y0, y1, z0), rect(x0, x1, y0, y1, z1), m, bevel)


def taper(M, r0, r1, z0, z1, m, bevel=0.0):
    """Frustum from rect r0=(x0,x1,y0,y1) at z0 to rect r1 at z1."""
    return M.loft(rect(*r0, z0), rect(*r1, z1), m, bevel)


def bar(M, p, q, wd, z0, z1, m):
    """Box of width wd along the 2D segment p-q."""
    d = Vector((q[0] - p[0], q[1] - p[1]))
    d.normalize()
    n = Vector((-d.y, d.x)) * (wd / 2)
    pts = [(p[0] + n.x, p[1] + n.y), (p[0] - n.x, p[1] - n.y), (q[0] - n.x, q[1] - n.y), (q[0] + n.x, q[1] + n.y)]
    return M.loft([(x, y, z0) for x, y in pts], [(x, y, z1) for x, y in pts], m)


def ngon(cx, cy, r, n, z, rot=None):
    rot = math.pi / n if rot is None else rot
    return [(cx + r * math.cos(rot + 2 * math.pi * i / n), cy + r * math.sin(rot + 2 * math.pi * i / n), z)
            for i in range(n)]


def cyl(M, cx, cy, r, z0, z1, m, n=12, bevel=0.0):
    return M.loft(ngon(cx, cy, r, n, z0), ngon(cx, cy, r, n, z1), m, bevel)


def cone(M, cx, cy, r, z0, z1, m, n=12):
    return M.cone(ngon(cx, cy, r, n, z0), (cx, cy, z1), m)


def frame(M, x0, x1, y0, y1, z0, z1, t, m):
    """Rectangular rim of thickness t (parapet, roof border), built from 4 non-overlapping bars."""
    box(M, x0, x1, y0, y0 + t, z0, z1, m)
    box(M, x0, x1, y1 - t, y1, z0, z1, m)
    box(M, x0, x0 + t, y0 + t, y1 - t, z0, z1, m)
    box(M, x1 - t, x1, y0 + t, y1 - t, z0, z1, m)


def extrude_profile(M, prof, axis, a0, a1, m, bevel=0.0):
    """Extrude a 2D profile (u, z) along `axis` ('x' or 'y') from a0 to a1."""
    if axis == "x":
        lo = [(a0, u, z) for u, z in prof]
        hi = [(a1, u, z) for u, z in prof]
    else:
        lo = [(u, a0, z) for u, z in prof]
        hi = [(u, a1, z) for u, z in prof]
    return M.loft(lo, hi, m, bevel)


def gable(M, x0, x1, y0, y1, ze, zr, axis, roof_m, wall_m, oh_u=(0.4, 0.4), oh_a=(0.4, 0.4),
          th=0.22, bevel=0.05):
    """Pitched roof over the wall rectangle, ridge along `axis`, eaves at ze, ridge at zr.
    The roof is a chevron shell (so gable ends show the wall colour), plus the gable wall triangle."""
    if axis == "x":
        u0, u1, a0, a1 = y0, y1, x0, x1
    else:
        u0, u1, a0, a1 = x0, x1, y0, y1
    um = (u0 + u1) / 2
    s = (zr - ze) / ((u1 - u0) / 2)
    zl, zrr = ze - s * oh_u[0], ze - s * oh_u[1]
    L, P, R = (u0 - oh_u[0], zl), (um, zr), (u1 + oh_u[1], zrr)
    prof = [L, P, R, (R[0], R[1] - th), (um, zr - th), (L[0], L[1] - th)]
    extrude_profile(M, prof, axis, a0 - oh_a[0], a1 + oh_a[1], roof_m, bevel)
    if wall_m is not None:
        extrude_profile(M, [(u0, ze), (u1, ze), (um, zr - th - 0.02)], axis, a0, a1, wall_m)


def band(M, x0, x1, y0, y1, z0, z1, m, o=0.06):
    """Glazing/trim band wrapped round a block, standing o proud of its walls."""
    box(M, x0 - o, x1 + o, y0 - o, y1 + o, z0, z1, m)


def xbrace(M, x0, x1, y0, y1, z, m, t=0.38, h=0.26):
    """Raised square border with an X across it (the apartment roof motif)."""
    frame(M, x0, x1, y0, y1, z, z + h, t, m)
    bar(M, (x0 + t, y0 + t), (x1 - t, y1 - t), t, z, z + h - 0.04, m)
    bar(M, (x0 + t, y1 - t), (x1 - t, y0 + t), t, z, z + h - 0.07, m)


def ribs(M, x0, x1, y0, y1, z, m, n, along="y", wd=0.28, h=0.22):
    """n evenly spaced raised ribs over a flat roof area."""
    for i in range(n):
        if along == "y":
            c = x0 + (x1 - x0) * (i + 0.5) / n
            box(M, c - wd / 2, c + wd / 2, y0, y1, z, z + h, m)
        else:
            c = y0 + (y1 - y0) * (i + 0.5) / n
            box(M, x0, x1, c - wd / 2, c + wd / 2, z, z + h, m)


def ac_unit(M, cx, cy, z, P, rot=False):
    hx, hy = (0.7, 1.0) if rot else (1.0, 0.7)
    box(M, cx - hx, cx + hx, cy - hy, cy + hy, z, z + 0.85, P["ac_box"], bevel=0.05)
    cyl(M, cx, cy, 0.48, z + 0.85, z + 0.95, P["ac_fan"], n=8)


def flat_block(M, x0, x1, y0, y1, h, wall, roof, parapet=None, cap=0.22, bevel=0.08):
    """Walls to h, a roof slab on top, optional parapet rim. Returns the roof top z."""
    box(M, x0, x1, y0, y1, 0, h, wall)
    box(M, x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, h, h + cap, roof, bevel=bevel)
    top = h + cap
    if parapet is not None:
        frame(M, x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, top, top + 0.35, 0.3, parapet)
    return top


# ------------------------------------------------------------------ lots and parking

class Lot:
    def __init__(self, w, d):
        self.w, self.d = w, d
        self.yf = -d / 2                       # road-side edge
        self.y0 = self.yf + PARK_DEPTH + 1.0   # building zone front
        self.y1 = d / 2 - 1.0                  # building zone back
        self.x0, self.x1 = -w / 2 + 1.0, w / 2 - 1.0
        self.bays = []


def lot(M, P, w, d, bays_x, asphalt=None):
    """White pad over the whole footprint, asphalt strip at the front with bay lines. Returns Lot."""
    L = Lot(w, d)
    yf, yp = L.yf, L.yf + PARK_DEPTH
    if asphalt is None:
        asphalt = (-w / 2, w / 2)
    ax0, ax1 = max(asphalt[0], -w / 2), min(asphalt[1], w / 2)
    if ax0 > -w / 2 + 1e-6:
        box(M, -w / 2, ax0, yf, yp, 0, PAD_H, P["pad"])
    box(M, ax0, ax1, yf, yp, 0, PAD_H, P["asphalt"])
    if ax1 < w / 2 - 1e-6:
        box(M, ax1, w / 2, yf, yp, 0, PAD_H, P["pad"])
    box(M, -w / 2, w / 2, yp, d / 2, 0, PAD_H, P["pad"])
    lines = sorted({round(bx + s * BAY_W / 2, 3) for bx in bays_x for s in (-1, 1)})
    for lx in lines:
        box(M, lx - 0.06, lx + 0.06, yf + BAY_Y0, yf + BAY_Y0 + BAY_L, PAD_H, PAD_H + 0.012, P["line"])
    L.bays = [(bx, yf + BAY_Y0 + BAY_L / 2) for bx in bays_x]
    return L


def bay_row(n, cx=0.0):
    return [cx + (i - (n - 1) / 2) * BAY_W for i in range(n)]


# ------------------------------------------------------------------ buildings

def b_house(M, P):
    L = lot(M, P, 12, 15, [-3.2], asphalt=(-5.5, -0.9))
    wall, roof = P["res_wall"], P["res_roof"]
    # main body, ridge along X, at the back of the zone (zone y 0..6.5)
    box(M, -4.6, 4.2, 2.2, 6.3, 0, 3.0, wall)
    gable(M, -4.6, 4.2, 2.2, 6.3, 3.0, 5.0, "x", roof, wall)
    # front cross wing, ridge along Y
    box(M, 0.6, 4.2, 0.4, 3.0, 0, 3.0, wall)
    gable(M, 0.6, 4.2, 0.4, 4.2, 3.0, 4.55, "y", roof, wall, oh_a=(0.4, 0.0))
    # porch roof over the door, chimney
    box(M, -2.8, -0.4, 1.3, 2.2, 2.35, 2.55, roof, bevel=0.04)
    box(M, -3.4, -2.7, 4.6, 5.3, 2.5, 5.7, P["res_trim"], bevel=0.04)
    # path from the parking bay to the door
    box(M, -2.2, -1.0, L.yf + PARK_DEPTH, 1.3, PAD_H, PAD_H + 0.02, P["asphalt"])
    return L


def b_terrace(M, P):
    xs = [-11.0, -11.0 + 22 / 3, 11.0 - 22 / 3, 11.0]
    centres = [(xs[i] + xs[i + 1]) / 2 for i in range(3)]
    L = lot(M, P, 24, 17, centres)
    offs = [0.0, 0.7, 0.25]
    heights = [5.6, 5.2, 5.6]
    for i in range(3):
        wall = P["res_wall"] if i % 2 == 0 else P["res_wall2"]
        roof = P["res_roof"] if i % 2 == 0 else P["res_roof2"]
        x0, x1 = xs[i], xs[i + 1]
        y0, y1 = L.y0 + 1.2 + offs[i], L.y1 - 0.4 - (0.7 - offs[i])
        ze = heights[i]
        box(M, x0, x1, y0, y1, 0, ze, wall)
        gable(M, x0, x1, y0, y1, ze, ze + 2.4, "x", roof, wall,
              oh_a=(0.4 if i == 0 else 0.0, 0.4 if i == 2 else 0.0))
        # front gabled bay per unit
        c = centres[i] + (-1.0 if i == 1 else 0.9)
        box(M, c - 1.5, c + 1.5, y0 - 1.1, y0 + 0.5, 0, 3.0, wall)
        gable(M, c - 1.5, c + 1.5, y0 - 1.1, y0 + 1.4, 3.0, 4.3, "y", roof, wall, oh_a=(0.35, 0.0),
              oh_u=(0.3, 0.3))
        # chimney on the party wall
        if i < 2:
            box(M, x1 - 0.35, x1 + 0.35, y1 - 1.6, y1 - 0.9, ze, ze + 2.9, P["res_trim"], bevel=0.04)
    return L


def b_apartments(M, P):
    L = lot(M, P, 30, 30, bay_row(6))
    wall, roof, brace, bandm = P["apt_wall"], P["apt_roof"], P["apt_brace"], P["apt_band"]
    st = 3.1
    mods = [  # x0, x1, y0, y1, storeys
        (-13.5, -1.2, -7.0, 3.2, 4), (-13.5, -1.2, 3.2, 13.6, 3),
        (1.2, 13.5, -6.2, 3.9, 3), (1.2, 13.5, 3.9, 13.8, 4),
    ]
    for x0, x1, y0, y1, n in mods:
        h = n * st
        for s in range(n):  # window bands
            band(M, x0, x1, y0, y1, s * st + 1.0, s * st + 1.9, bandm, o=0.05)
        top = flat_block(M, x0, x1, y0, y1, h, wall, roof)
        xbrace(M, x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.3, top, brace)
    # stair-core link between the two columns, entrance canopies
    flat_block(M, -1.3, 1.3, -1.5, 9.5, 7.4, wall, roof)
    for cx in (-7.3, 7.3):
        y = -7.0 if cx < 0 else -6.2
        box(M, cx - 1.8, cx + 1.8, y - 1.2, y, 2.6, 2.85, roof, bevel=0.05)
    return L


def b_shop(M, P):
    L = lot(M, P, 18, 20, bay_row(4))
    wall, roof = P["com_wall"], P["com_roof"]
    x0, x1, y0, y1, h = -7.6, 7.6, L.y0 + 0.5, L.y1 - 0.4, 4.2
    box(M, x0, x1, y0, y1, 0, h, wall)
    # sawtooth roof: teeth repeat along X, ridges along Y, glazed vertical faces
    n = 4
    tw = (x1 - x0) / n
    for i in range(n):
        a, b = x0 + i * tw, x0 + (i + 1) * tw
        extrude_profile(M, [(a, h), (b, h), (b, h + 1.45)], "y", y0 - 0.2, y1 + 0.2, roof, bevel=0.04)
        if i < n - 1:
            box(M, b, b + 0.05, y0 + 0.4, y1 - 0.4, h + 0.15, h + 1.25, P["com_glass"])
    # storefront and canopy
    box(M, x0 + 1.0, x1 - 1.0, y0 - 0.06, y0, 0.3, 2.6, P["com_glass"])
    box(M, x0 - 0.2, x1 + 0.2, y0 - 1.3, y0, 2.8, 3.1, P["com_canopy"], bevel=0.05)
    return L


def b_store(M, P):
    L = lot(M, P, 30, 28, bay_row(8))
    wall, roof, rib = P["com_wall"], P["com_roof"], P["com_rib"]
    # module A: tall, back-left, three low gabled bays (ridges along Y)
    ax0, ax1, ay0, ay1, ah = -13.5, 4.5, L.y0 + 1.2, L.y1, 7.0
    box(M, ax0, ax1, ay0, ay1, 0, ah, wall)
    n = 3
    bw = (ax1 - ax0) / n
    for i in range(n):
        a, b = ax0 + i * bw, ax0 + (i + 1) * bw
        gable(M, a, b, ay0, ay1, ah, ah + 1.1, "y", roof, wall,
              oh_u=(0.3 if i == 0 else 0.0, 0.3 if i == n - 1 else 0.0), oh_a=(0.3, 0.3), th=0.2)
    box(M, ax0 + 1.0, ax1 - 1.0, ay0 - 0.06, ay0, 0.3, 3.0, P["com_glass"])
    box(M, ax0 + 0.5, ax1 - 0.5, ay0 - 1.6, ay0, 3.3, 3.6, P["com_canopy"], bevel=0.05)
    # module B: lower, front-right, flat roof with ribs
    bx0, bx1, by0, by1, bh = 3.0, 13.5, L.y0, 9.0, 5.2
    top = flat_block(M, bx0, bx1, by0, by1, bh, wall, roof)
    ribs(M, bx0 + 0.6, bx1 - 0.6, by0 + 0.6, by1 - 0.6, top, rib, 9, along="y")
    box(M, bx0 + 1.5, bx1 - 1.0, by0 - 0.06, by0, 0.3, 2.8, P["com_glass"])
    ac_unit(M, 0.0, ay1 - 3.0, ah + 0.2, P)
    return L


def b_mall(M, P):
    L = lot(M, P, 48, 40, bay_row(14))
    wall, roof, rib = P["com_wall"], P["com_roof"], P["com_rib"]
    y0, y1 = L.y0, L.y1
    # central hall with four gabled bays
    hx0, hx1, hy0, hy1, hh = -11.0, 11.0, y0 + 2.5, y1 - 0.5, 9.0
    box(M, hx0, hx1, hy0, hy1, 0, hh, wall)
    n = 4
    bw = (hx1 - hx0) / n
    for i in range(n):
        a, b = hx0 + i * bw, hx0 + (i + 1) * bw
        gable(M, a, b, hy0, hy1, hh, hh + 1.3, "y", roof, wall,
              oh_u=(0.3 if i == 0 else 0.0, 0.3 if i == n - 1 else 0.0), oh_a=(0.3, 0.3), th=0.22)
    # glass entrance atrium with a canopy
    box(M, -5.0, 5.0, y0, hy0, 0, 6.4, P["com_glass"])
    box(M, -6.0, 6.0, y0 - 0.4, hy0 + 0.2, 6.4, 6.8, P["com_canopy"], bevel=0.06)
    # left wing: flat, ribbed front band, AC units
    lx0, lx1, ly0, ly1 = -22.5, -11.0, y0 + 4.0, y1 - 2.0
    top = flat_block(M, lx0, lx1, ly0, ly1, 6.4, wall, roof)
    ribs(M, lx0 + 0.6, lx1 - 0.6, ly0 + 0.6, ly0 + 5.0, top, rib, 9, along="y")
    for cy in (ly0 + 9.0, ly0 + 13.5, ly0 + 18.0):
        ac_unit(M, -16.8, cy, top, P)
    box(M, lx0 + 1.0, lx1 - 1.0, ly0 - 0.06, ly0, 0.3, 3.0, P["com_glass"])
    # right wing: taller, further forward, ribbed band at the back
    rx0, rx1, ry0, ry1 = 11.0, 22.5, y0 + 0.5, y1 - 4.0
    top = flat_block(M, rx0, rx1, ry0, ry1, 7.4, wall, roof)
    ribs(M, rx0 + 0.6, rx1 - 0.6, ry1 - 6.0, ry1 - 0.6, top, rib, 9, along="y")
    for cx, cy in ((14.2, ry0 + 4.0), (19.3, ry0 + 4.0), (14.2, ry0 + 9.5), (19.3, ry0 + 9.5)):
        ac_unit(M, cx, cy, top, P, rot=True)
    box(M, rx0 + 1.0, rx1 - 1.0, ry0 - 0.06, ry0, 0.3, 3.0, P["com_glass"])
    return L


def b_office(M, P):
    L = lot(M, P, 20, 22, bay_row(5))
    wall, roof, glass, trim = P["work_wall"], P["work_roof"], P["work_glass"], P["work_trim"]
    st = 3.4
    x0, x1, y0, y1 = -8.5, 6.0, L.y0 + 0.8, L.y1
    for s in range(3):
        band(M, x0, x1, y0, y1, s * st + 1.0, s * st + 2.6, glass)
    top = flat_block(M, x0, x1, y0, y1, 3 * st, wall, roof, parapet=trim)
    # lower entrance wing, offset forward and to the right
    ex0, ex1, ey0, ey1 = 4.0, 8.5, L.y0, 5.5
    band(M, ex0, ex1, ey0, ey1, 1.0, 2.6, glass)
    etop = flat_block(M, ex0, ex1, ey0, ey1, 4.4, trim, roof)
    box(M, ex0 + 0.8, ex1 - 0.8, ey0 + 0.8, ey1 - 0.8, etop, etop + 0.15, glass)
    # rooftop plant and stair housing
    box(M, -7.0, -4.0, y1 - 4.0, y1 - 1.2, top, top + 2.0, trim, bevel=0.06)
    ac_unit(M, -0.6, y1 - 3.0, top, P)
    ac_unit(M, 2.6, y1 - 3.0, top, P)
    return L


def b_tower(M, P):
    L = lot(M, P, 30, 30, bay_row(9))
    wall, roof, glass, trim = P["work_wall"], P["work_roof"], P["work_glass"], P["work_trim"]
    st = 3.2
    tiers = [  # x0, x1, y0, y1, storeys from, storeys to
        (-13.5, 13.5, L.y0, L.y1, 0, 1),
        (-10.5, 9.0, L.y0 + 2.0, L.y1 - 1.5, 1, 5),
        (-7.5, 4.5, L.y0 + 4.0, L.y1 - 4.0, 5, 8),
    ]
    top = 0.0
    for x0, x1, y0, y1, s0, s1 in tiers:
        for s in range(s0, s1):
            band(M, x0, x1, y0, y1, s * st + 0.9, s * st + 2.5, glass)
        h = s1 * st
        box(M, x0, x1, y0, y1, 0 if s0 == 0 else top - 0.3, h, wall)
        box(M, x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, h, h + 0.22, roof, bevel=0.08)
        top = h + 0.22
        frame(M, x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, top, top + 0.35, 0.3, trim)
    # roof plant on the top tier, AC units on the terraces
    x0, x1, y0, y1 = tiers[2][:4]
    box(M, x0 + 1.5, x0 + 5.5, y0 + 2.0, y1 - 2.0, top, top + 2.4, trim, bevel=0.08)
    ac_unit(M, x1 - 2.5, y0 + 2.5, top, P)
    ac_unit(M, x1 - 2.5, y1 - 2.5, top, P)
    t1 = tiers[0][4 + 1] * st + 0.22
    ac_unit(M, 11.0, L.y0 + 3.0, t1, P, rot=True)
    ac_unit(M, -12.0, L.y1 - 3.0, t1, P, rot=True)
    t2 = tiers[1][5] * st + 0.22
    ac_unit(M, 7.0, L.y1 - 3.5, t2, P)
    return L


def b_mine(M, P):
    L = lot(M, P, 26, 30, bay_row(2, -7.0), asphalt=(-13.0, -1.0))
    wall, roof, dark, orange = P["ind_wall"], P["ind_roof"], P["ind_dark"], P["ind_orange"]
    # front shed (front half of the lot), flat roof with orange stripes
    x0, x1, y0, y1, h = -11.5, 6.5, L.y0, 3.5, 6.0
    top = flat_block(M, x0, x1, y0, y1, h, wall, roof)
    ribs(M, x0 + 1.0, x1 - 1.0, y0 + 0.8, y1 - 0.8, top, orange, 4, along="y", wd=0.9, h=0.18)
    box(M, -6.5, -1.5, y0 - 0.06, y0, 0, 4.2, dark)  # loading door
    # back half: headframe/portal block that runs into the mountain
    box(M, -7.5, 1.5, y1, L.y1 + 0.9, 0, 4.8, dark, bevel=0.1)
    box(M, -6.0, 0.0, y1 - 0.06, y1 + 0.2, 0, 3.6, P["ind_steel"])
    # orange hopper on legs, fed by a conveyor out of the mountain
    hx, hy = 9.5, -3.0
    for dx in (-1.1, 1.1):
        for dy in (-1.1, 1.1):
            box(M, hx + dx - 0.15, hx + dx + 0.15, hy + dy - 0.15, hy + dy + 0.15, 0, 4.4, dark)
    taper(M, (hx - 0.6, hx + 0.6, hy - 0.6, hy + 0.6), (hx - 1.7, hx + 1.7, hy - 1.7, hy + 1.7), 3.2, 5.6,
          orange, bevel=0.05)
    box(M, hx - 1.75, hx + 1.75, hy - 1.75, hy + 1.75, 5.6, 6.0, orange, bevel=0.05)
    # conveyor: inclined belt from the mountain (back) down... up to the hopper top
    p, q = Vector((hx, L.y1 + 1.0, 2.0)), Vector((hx, hy + 1.2, 6.6))
    wd = 1.1
    lo = [(p.x - wd / 2, p.y, p.z), (p.x + wd / 2, p.y, p.z), (q.x + wd / 2, q.y, q.z), (q.x - wd / 2, q.y, q.z)]
    hi = [(x, y, z + 0.35) for x, y, z in lo]
    M.loft(lo, hi, P["ind_steel"])
    for t in (0.3, 0.65):
        s = p.lerp(q, t)
        box(M, s.x - 0.2, s.x + 0.2, s.y - 0.2, s.y + 0.2, 0, s.z, dark)
    # portal where the belt leaves the mountain: steel frame, dark mouth, orange lintel stripe
    py = L.y1 - 1.0
    box(M, hx - 1.6, hx - 1.1, py, py + 1.0, 0, 3.6, P["ind_steel"])
    box(M, hx + 1.1, hx + 1.6, py, py + 1.0, 0, 3.6, P["ind_steel"])
    box(M, hx - 1.6, hx + 1.6, py, py + 1.0, 3.6, 4.2, orange, bevel=0.04)
    box(M, hx - 1.1, hx + 1.1, py + 0.7, py + 1.0, 0, 3.6, dark)
    # orange hazard stripe band round the adit block
    band(M, -7.5, 1.5, y1, L.y1 + 0.9, 3.6, 4.1, orange, o=0.05)
    return L


def b_farm(M, P):
    L = lot(M, P, 40, 40, bay_row(2, -15.6), asphalt=(-20.0, -11.2))
    # barn: grey walls, white roof, green doors and ridge cap
    bx0, bx1, by0, by1 = -18.5, -10.0, L.y0, L.y0 + 9.0
    box(M, bx0, bx1, by0, by1, 0, 4.4, P["ind_wall"])
    gable(M, bx0, bx1, by0, by1, 4.4, 7.2, "y", P["barn_roof"], P["ind_wall"], oh_u=(0.5, 0.5), oh_a=(0.5, 0.5))
    box(M, -15.8, -12.7, by0 - 0.08, by0, 0, 3.4, P["farm_accent"])
    cx = (bx0 + bx1) / 2
    box(M, cx - 0.22, cx + 0.22, by0 - 0.45, by1 + 0.45, 7.05, 7.3, P["farm_accent"], bevel=0.05)
    # silos
    cyl(M, -6.5, L.y0 + 2.6, 2.1, 0, 9.0, P["silo"], n=14)
    cone(M, -6.5, L.y0 + 2.6, 2.2, 9.0, 10.8, P["farm_accent"], n=14)
    cyl(M, -6.2, L.y0 + 7.4, 1.5, 0, 6.8, P["ind_steel"], n=12)
    cone(M, -6.2, L.y0 + 7.4, 1.6, 6.8, 8.0, P["silo"], n=12)
    # crop-row fields: (x0, x1, y0, y1, rows along, crop)
    plots = [
        (1.0, 19.2, -19.2, -1.0, "y", "g"),
        (1.0, 19.2, 1.0, 19.2, "x", "w"),
        (-19.2, -1.0, 4.0, 19.2, "y", "w"),
    ]
    for x0, x1, y0, y1, along, crop in plots:
        box(M, x0, x1, y0, y1, 0, 0.1, P["soil"])
        c1, c2 = (P["crop_g1"], P["crop_g2"]) if crop == "g" else (P["crop_w1"], P["crop_w2"])
        span = (x1 - x0) if along == "y" else (y1 - y0)
        n = int(span / 1.5)
        for i in range(n):
            m = c1 if i % 2 == 0 else c2
            if along == "y":
                c = x0 + span * (i + 0.5) / n
                box(M, c - 0.55, c + 0.55, y0 + 0.4, y1 - 0.4, 0.1, 0.32, m)
            else:
                c = y0 + span * (i + 0.5) / n
                box(M, x0 + 0.4, x1 - 0.4, c - 0.55, c + 0.55, 0.1, 0.32, m)
    return L


def b_works(M, P):
    L = lot(M, P, 36, 32, bay_row(4, -8.0))
    wall, roof, dark, copper = P["ind_wall"], P["ind_roof"], P["ind_dark"], P["ind_copper"]
    # main hall: flat roof, copper stripes along Y, copper band round the walls
    x0, x1, y0, y1, h = -16.5, 5.5, L.y0, L.y1, 8.0
    band(M, x0, x1, y0, y1, 6.2, 7.0, copper)
    top = flat_block(M, x0, x1, y0, y1, h, wall, roof)
    ribs(M, x0 + 1.0, x1 - 1.0, y0 + 1.0, y1 - 1.0, top, copper, 5, along="y", wd=0.9, h=0.18)
    box(M, -12.0, -6.0, y0 - 0.06, y0, 0, 5.0, dark)
    # furnace block with two chimneys
    fx0, fx1, fy0, fy1, fh = 6.5, 16.5, L.y0 + 3.0, L.y1 - 3.0, 11.0
    band(M, fx0, fx1, fy0, fy1, 9.0, 9.8, copper)
    ftop = flat_block(M, fx0, fx1, fy0, fy1, fh, P["ind_dark"], roof)
    for cx, cy, ch in ((9.5, fy1 - 3.0, 23.0), (13.6, fy0 + 3.5, 20.0)):
        cyl(M, cx, cy, 1.05, ftop, ch, P["ind_steel"], n=12)
        cyl(M, cx, cy, 1.15, ch - 2.6, ch - 1.6, copper, n=12)
        cyl(M, cx, cy, 1.12, ch, ch + 0.2, dark, n=12)
    # pipe bridge between the buildings
    box(M, x1 - 0.2, fx0 + 0.2, 4.0, 5.2, 6.5, 7.4, copper)
    return L


def b_foodplant(M, P):
    L = lot(M, P, 32, 30, bay_row(4, -6.0))
    wall, roof, dark, yellow = P["ind_wall"], P["ind_roof"], P["ind_dark"], P["ind_yellow"]
    x0, x1, y0, y1, h = -14.5, 4.0, L.y0, L.y1, 7.0
    band(M, x0, x1, y0, y1, 5.4, 6.1, yellow)
    top = flat_block(M, x0, x1, y0, y1, h, wall, roof)
    ribs(M, x0 + 1.0, x1 - 1.0, y0 + 1.0, y1 - 1.0, top, yellow, 4, along="x", wd=0.9, h=0.18)
    ac_unit(M, -10.5, y1 - 3.0, top + 0.18, P)
    box(M, -9.0, -3.0, y0 - 0.06, y0, 0, 4.4, dark)
    box(M, -10.0, -2.0, y0 - 1.6, y0, 4.8, 5.1, yellow, bevel=0.05)  # loading canopy
    # tank farm
    for tx, ty in ((8.2, L.y0 + 2.4), (12.6, L.y0 + 2.4), (8.2, L.y0 + 7.2), (12.6, L.y0 + 7.2)):
        cyl(M, tx, ty, 1.95, 0, 8.0, P["ind_tank"], n=14)
        cyl(M, tx, ty, 2.0, 5.8, 6.6, yellow, n=14)
        cone(M, tx, ty, 2.0, 8.0, 9.0, yellow, n=14)
    # pipe rack from the tanks into the hall, a low silo at the back
    box(M, x1 - 0.2, 10.4, L.y0 + 4.4, L.y0 + 5.2, 5.0, 5.7, P["ind_steel"])
    cyl(M, 10.4, L.y1 - 3.0, 2.4, 0, 4.5, P["ind_steel"], n=14)
    cyl(M, 10.4, L.y1 - 3.0, 2.45, 4.5, 4.9, yellow, n=14)
    return L


BUILDINGS = {
    "house": (b_house, 12, 15, 1),
    "terrace": (b_terrace, 24, 17, 3),
    "apartments": (b_apartments, 30, 30, 6),
    "shop": (b_shop, 18, 20, 4),
    "store": (b_store, 30, 28, 8),
    "mall": (b_mall, 48, 40, 14),
    "office": (b_office, 20, 22, 5),
    "tower": (b_tower, 30, 30, 9),
    "mine": (b_mine, 26, 30, 2),
    "farm": (b_farm, 40, 40, 2),
    "works": (b_works, 36, 32, 4),
    "foodplant": (b_foodplant, 32, 30, 4),
}


# ------------------------------------------------------------------ vehicles

def side_profile(M, prof, hw, m):
    """Car-style body: a side profile (y, z) extruded across the width (x = -hw..hw)."""
    return extrude_profile(M, prof, "x", -hw, hw, m)


def wheel_axle(M, y, r, hw_out, m, n=8):
    """One cylinder spanning both wheels of an axle (the chassis hides the middle)."""
    zc = r * math.cos(math.pi / n)   # a flat face rests exactly on z = 0
    ring = [(0.0, y + r * math.cos(2 * math.pi * i / n + math.pi / n),
             zc + r * math.sin(2 * math.pi * i / n + math.pi / n)) for i in range(n)]
    lo = [(-hw_out, yy, zz) for _, yy, zz in ring]
    hi = [(hw_out, yy, zz) for _, yy, zz in ring]
    return M.loft(lo, hi, m)


def slab_on(M, p0, p1, hw, t, m):
    """Thin panel (windscreen) spanning x=-hw..hw between two (y, z) points, pushed outward by t."""
    dy, dz = p1[0] - p0[0], p1[1] - p0[1]
    ln = math.hypot(dy, dz)
    ny, nz = dz / ln, -dy / ln   # outward normal for a front-facing slope (front at -Y)
    if ny > 0:
        ny, nz = -ny, -nz
    a = [(p0[0], p0[1]), (p1[0], p1[1]), (p1[0] + ny * t, p1[1] + nz * t), (p0[0] + ny * t, p0[1] + nz * t)]
    return extrude_profile(M, a, "x", -hw, hw, m)


def v_car(Ms, P):
    body, glass, dark = Ms["body"], Ms["glass"], Ms["dark"]
    hw = 0.925
    side_profile(body, [(-2.17, 0.28), (2.17, 0.28), (2.17, 0.76), (2.08, 0.9), (1.32, 0.95),
                        (-0.92, 0.95), (-1.98, 0.83), (-2.17, 0.70)], hw, P["body"])
    taper(glass, (-0.84, 0.84, -0.92, 1.32), (-0.75, 0.75, -0.42, 1.06), 0.95, 1.37, P["glass"])
    taper(body, (-0.76, 0.76, -0.43, 1.07), (-0.71, 0.71, -0.36, 1.0), 1.37, 1.45, P["body"])
    wheel_axle(dark, -1.38, 0.32, 0.88, P["dark"])
    wheel_axle(dark, 1.36, 0.32, 0.88, P["dark"])
    box(dark, -0.9, 0.9, -2.2, -2.05, 0.26, 0.52, P["dark"])
    box(dark, -0.9, 0.9, 2.05, 2.2, 0.26, 0.52, P["dark"])
    box(glass, -0.82, 0.82, 2.12, 2.2, 0.6, 0.76, P["glass"])     # tail light bar
    box(glass, -0.82, 0.82, -2.2, -2.12, 0.55, 0.67, P["glass"])  # headlight bar


def v_van(Ms, P):
    body, glass, dark = Ms["body"], Ms["glass"], Ms["dark"]
    hw = 0.98
    side_profile(body, [(-2.47, 0.3), (2.47, 0.3), (2.47, 1.9), (2.38, 2.0), (-1.2, 2.0),
                        (-1.95, 1.14), (-2.47, 0.98)], hw, P["body"])
    slab_on(glass, (-1.92, 1.18), (-1.25, 1.95), 0.88, 0.03, P["glass"])
    for s in (-1, 1):  # cab side windows
        x0, x1 = (hw, hw + 0.02) if s > 0 else (-hw - 0.02, -hw)
        box(glass, x0, x1, -1.55, -0.95, 1.2, 1.82, P["glass"])
    box(glass, -0.85, 0.85, 2.47, 2.5, 1.2, 1.8, P["glass"])        # rear door windows
    wheel_axle(dark, -1.65, 0.36, 0.94, P["dark"])
    wheel_axle(dark, 1.6, 0.36, 0.94, P["dark"])
    box(dark, -0.97, 0.97, -2.5, -2.35, 0.28, 0.58, P["dark"])
    box(dark, -0.97, 0.97, 2.35, 2.5, 0.28, 0.5, P["dark"])
    box(glass, -0.85, 0.85, -2.5, -2.47, 0.68, 0.82, P["glass"])    # headlight bar


def v_truck(Ms, P):
    body, glass, dark, cargo = Ms["body"], Ms["glass"], Ms["dark"], Ms["cargo"]
    hw_cab = 1.2
    side_profile(body, [(-4.22, 0.62), (-2.3, 0.62), (-2.3, 2.95), (-3.95, 2.95), (-4.22, 2.62)],
                 hw_cab, P["body"])
    box(glass, -1.05, 1.05, -4.25, -4.22, 1.55, 2.5, P["glass"])    # windscreen
    for s in (-1, 1):
        x0, x1 = (hw_cab, hw_cab + 0.03) if s > 0 else (-hw_cab - 0.03, -hw_cab)
        box(glass, x0, x1, -4.0, -3.1, 1.65, 2.55, P["glass"])
    box(glass, -0.9, 0.9, -3.92, -3.62, 2.95, 3.04, P["glass"])     # roof light bar
    box(cargo, -1.25, 1.25, -2.1, 4.25, 0.98, 3.2, P["cargo"], bevel=0.04)
    box(dark, -0.85, 0.85, -4.0, 4.1, 0.5, 0.98, P["dark"])          # chassis
    box(dark, -1.2, 1.2, -4.25, -4.05, 0.35, 0.8, P["dark"])         # front bumper
    box(dark, -1.1, 1.1, 4.0, 4.2, 0.3, 0.55, P["dark"])             # rear underrun bar
    for y in (-3.35, 1.95, 3.15):
        wheel_axle(dark, y, 0.5, 1.2, P["dark"])


VEHICLES = {
    "car": (v_car, ("body", "glass", "dark"), (1.85, 4.4, 1.45)),
    "van": (v_van, ("body", "glass", "dark"), (2.0, 5.0, 2.0)),
    "truck": (v_truck, ("body", "glass", "dark", "cargo"), (2.5, 8.5, 3.2)),
}


def vehicle_mats():
    return {
        "body": mat("body", "#ffffff"),
        "cargo": mat("cargo", "#ffffff"),
        "glass": mat("glass", "#2b3440"),
        "dark": mat("dark", "#30343a"),
    }


# ------------------------------------------------------------------ build, export, preview

def new_collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def build_building(name):
    fn, w, d, nbays = BUILDINGS[name]
    coll = new_collection(name)
    M = Mesh()
    L = fn(M, palette())
    assert len(L.bays) == nbays, (name, len(L.bays), nbays)
    ob = M.to_object(name, coll)
    objs = [ob]
    for i, (x, y) in enumerate(L.bays):
        e = bpy.data.objects.new(f"park_{i}", None)
        e.empty_display_type = "SINGLE_ARROW"   # arrow = local +Z; the nose direction is local +Y
        e.empty_display_size = 1.5
        e.location = (x, y, PAD_H)
        coll.objects.link(e)
        objs.append(e)
    return objs


def build_vehicle(name):
    fn, parts, _ = VEHICLES[name]
    coll = new_collection(name)
    Ms = {p: Mesh() for p in parts}
    fn(Ms, vehicle_mats())
    return [Ms[p].to_object(p, coll) for p in parts]


def export(name, objs):
    os.makedirs(OUT, exist_ok=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_extras=False)
    return path


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def setup_render():
    """EEVEE, a soft sun from the upper left-front and bright ambient: close to the game's flat pastel look."""
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = 16
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("preview_world")
    sc.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = 0.66
    sun_data = bpy.data.lights.new("preview_sun", "SUN")
    sun_data.energy = 1.3
    sun_data.angle = math.radians(2)
    try:
        sun_data.shadow_maximum_resolution = 0.02
    except AttributeError:
        pass
    sun = bpy.data.objects.new("preview_sun", sun_data)
    sun.rotation_euler = (math.radians(28), math.radians(-18), math.radians(-30))
    sc.collection.objects.link(sun)
    # beige ground so shadows land like they do in the game (preview only, never exported)
    gm = bpy.data.meshes.new("preview_ground")
    gm.from_pydata([(-2000, -2000, -0.002), (2000, -2000, -0.002), (2000, 2000, -0.002), (-2000, 2000, -0.002)],
                   [], [(0, 1, 2, 3)])
    gm.materials.append(mat("preview_ground", "#ebe8de"))
    ground = bpy.data.objects.new("preview_ground", gm)
    sc.collection.objects.link(ground)
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start, cam_data.clip_end = 1.0, 2000.0
    cam = bpy.data.objects.new("preview_cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def shoot(cam, objs, view, path, rx, ry, margin=1.08):
    sc = bpy.context.scene
    bpy.context.view_layer.update()
    keep = set(objs)
    for o in sc.objects:
        if o.type == "MESH" and not o.name.startswith("preview_"):
            o.hide_render = o not in keep
    lo, hi = bounds(objs)
    c = (lo + hi) / 2
    if view == "top":
        cam.location = (c.x, c.y, 500.0)
        cam.rotation_euler = (0.0, 0.0, 0.0)
    else:
        dv = Vector((0.8, -1.0, 1.15)).normalized()
        cam.location = c + dv * 500.0
        cam.rotation_euler = (-dv).to_track_quat("-Z", "Y").to_euler()
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    pts = [inv @ Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    w = max(p.x for p in pts) - min(p.x for p in pts)
    h = max(p.y for p in pts) - min(p.y for p in pts)
    # re-centre on the projected box
    mx = (max(p.x for p in pts) + min(p.x for p in pts)) / 2
    my = (max(p.y for p in pts) + min(p.y for p in pts)) / 2
    cam.location = cam.matrix_world @ Vector((mx, my, 0.0))
    cam.data.ortho_scale = max(w, h * rx / ry) * margin
    sc.render.resolution_x, sc.render.resolution_y = rx, ry
    sc.render.resolution_percentage = 100
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def tile(files, out, w, h):
    import numpy as np
    sheet = np.zeros((h, w * len(files), 4), dtype=np.float32)
    for i, f in enumerate(files):
        img = bpy.data.images.load(f, check_existing=False)
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        sheet[:, i * w:(i + 1) * w] = px.reshape(h, w, 4)
        os.remove(f)
    im = bpy.data.images.new("sheet", w * len(files), h, alpha=True)
    im.pixels.foreach_set(sheet.ravel())
    im.filepath_raw = out
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def preview(cam, name, objs, size=640):
    os.makedirs(PREV, exist_ok=True)
    meshes = [o for o in objs if o.type == "MESH"]
    a, b = os.path.join(PREV, f"_{name}_a.png"), os.path.join(PREV, f"_{name}_b.png")
    shoot(cam, meshes, "top", a, size, size)
    shoot(cam, meshes, "q", b, size, size)
    tile([a, b], os.path.join(PREV, name + ".png"), size, size)


def overview(cam, groups, name, spacing, cols, view, rx, ry):
    """Lay the models out on a grid at true scale and render them together."""
    moved = []
    for i, objs in enumerate(groups):
        r, c = divmod(i, cols)
        off = Vector((c * spacing, -r * spacing, 0))
        for o in objs:
            o.location += off
            moved.append((o, off))
    bpy.context.view_layer.update()
    allm = [o for g in groups for o in g if o.type == "MESH"]
    shoot(cam, allm, view, os.path.join(PREV, name), rx, ry, margin=1.04)
    for o, off in moved:
        o.location -= off


# ------------------------------------------------------------------ verification

def verify(names):
    """Import each GLB into a fresh scene and measure it."""
    stats = {}
    for name in names:
        bpy.ops.wm.read_homefile(use_empty=True)
        for o in list(bpy.data.objects):  # read_homefile can leave orphan objects behind
            bpy.data.objects.remove(o)
        bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, name + ".glb"))
        objs = list(bpy.context.scene.objects)
        meshes = [o for o in objs if o.type == "MESH"]
        empties = sorted([o for o in objs if o.type == "EMPTY" and o.name.startswith("park_")],
                         key=lambda o: int(o.name.split("_")[1]))
        lo, hi = bounds(meshes)
        size = hi - lo
        tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
        st = {"size": [round(v, 3) for v in size], "min": [round(v, 3) for v in lo], "tris": tris,
              "meshes": sorted(o.name for o in meshes), "parks": len(empties),
              "materials": sorted({m.name for o in meshes for m in o.data.materials if m}), "issues": []}
        if name in BUILDINGS:
            _, w, d, nb = BUILDINGS[name]
            if abs(size.x - w) > 0.1 or abs(size.y - d) > 0.1:
                st["issues"].append(f"footprint {size.x:.2f}x{size.y:.2f} != {w}x{d}")
            if abs(lo.x + w / 2) > 0.1 or abs(lo.y + d / 2) > 0.1:
                st["issues"].append("footprint not centred on the origin")
            if len(empties) != nb:
                st["issues"].append(f"{len(empties)} park empties, expected {nb}")
            for e in empties:
                p = e.matrix_world.translation
                fwd = e.matrix_world.to_3x3() @ Vector((0, 1, 0))
                if abs(p.z - PAD_H) > 1e-3 or p.y > 0 or fwd.y < 0.99:
                    st["issues"].append(f"{e.name} at {tuple(round(v, 2) for v in p)} fwd {tuple(round(v, 2) for v in fwd)}")
            st["park_y"] = round(empties[0].matrix_world.translation.y, 2) if empties else None
            if tris > 2500:
                st["issues"].append(f"{tris} tris over 2500")
        else:
            _, parts, (W, Ln, H) = VEHICLES[name]
            if sorted(parts) != st["meshes"]:
                st["issues"].append(f"objects {st['meshes']} != {sorted(parts)}")
            for want, got in ((W, size.x), (Ln, size.y), (H, size.z)):
                if abs(want - got) > 0.03:
                    st["issues"].append(f"size {[round(v, 3) for v in size]} != {(W, Ln, H)}")
                    break
            if tris > 300:
                st["issues"].append(f"{tris} tris over 300")
            for o in meshes:
                if o.matrix_world.translation.length > 1e-4:
                    st["issues"].append(f"{o.name} origin not at vehicle origin")
        if abs(lo.z) > 1e-3:
            st["issues"].append(f"lowest point z={lo.z:.3f}")
        stats[name] = st
    return stats


def write_readme(stats):
    lines = [
        "# Models",
        "",
        "Built by `tools/blender/build_models.py` (Blender 5.2, run headless:",
        "`blender -b --factory-startup -P tools/blender/build_models.py`). Do not edit the GLBs by hand;",
        "change the script and rebuild. Previews are in `tools/blender/previews/`.",
        "",
        "Units are metres. glTF is +Y up. In Blender the road-facing front is -Y, which the exporter turns",
        "into **+Z in glTF**. Origins sit at the ground centre of the lot (or vehicle), resting on y = 0.",
        "Flat base-colour materials only (roughness 0.8, metallic 0, no textures).",
        "",
        "## Buildings",
        "",
        "One mesh per building (named after the model, several materials) plus `park_N` empty nodes.",
        "The whole w × d footprint is the lot: a light pad (#eef0ee, 0.06 m tall) with an asphalt",
        "parking strip (6.5 m deep) at the front. `park_N` nodes sit at bay centres, at height 0.06.",
        "Each node's local +Y in Blender (= local **-Z in glTF**) is the direction a parked car's nose",
        "faces: cars park nose-in, toward the building. All bays are in the front row, so every node has",
        "identity rotation. The vehicle models point their nose along glTF +Z, so a car placed on a",
        "bay needs a 180° turn about the up axis relative to the node (or copy the node's transform and",
        "rotate the car by π).",
        "",
        "| model | footprint w × d (m) | height (m) | tris | park empties |",
        "|---|---|---|---|---|",
    ]
    for n in BUILDINGS:
        s = stats.get(n)
        if not s:
            continue
        lines.append(f"| {n} | {s['size'][0]:g} × {s['size'][1]:g} | {s['size'][2]:.1f} | {s['tris']} | {s['parks']} |")
    lines += [
        "",
        "## Vehicles",
        "",
        "Front at glTF +Z (Blender -Y), origin at the ground centre, wheels on y = 0. Separate mesh nodes per",
        "material: `body` and `cargo` are pure white (#ffffff) for per-instance tinting, `glass` is",
        "#2b3440, `dark` (tyres, bumpers, chassis) is #30343a.",
        "",
        "| model | W × L × H (m) | tris | nodes |",
        "|---|---|---|---|",
    ]
    for n in VEHICLES:
        s = stats.get(n)
        if not s:
            continue
        lines.append(f"| {n} | {s['size'][0]:g} × {s['size'][1]:g} × {s['size'][2]:g} | {s['tris']} | "
                     f"{', '.join('`%s`' % m for m in s['meshes'])} |")
    lines.append("")
    with open(os.path.join(OUT, "README.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


# ------------------------------------------------------------------ main

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    do_prev = "--no-previews" not in argv
    do_verify = "--no-verify" not in argv

    bpy.ops.wm.read_homefile(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    names = [n for n in list(BUILDINGS) + list(VEHICLES) if only is None or n in only]
    built = {}
    for n in names:
        built[n] = build_building(n) if n in BUILDINGS else build_vehicle(n)
        export(n, built[n])
        # object names are global in a .blend: free "park_0", "body", ... for the next model
        for o in built[n]:
            o.name = f"{n}:{o.name}"
            if o.data is not None:
                o.data.name = f"{n}:{o.data.name}"
    if do_prev:
        cam = setup_render()
        for n in names:
            preview(cam, n, built[n])
        if only is None:
            overview(cam, [built[n] for n in BUILDINGS], "_overview_buildings.png", 56, 4, "top", 1600, 1200)
            overview(cam, [built[n] for n in BUILDINGS], "_overview_buildings_34.png", 56, 4, "q", 1600, 1200)
            overview(cam, [built[n] for n in VEHICLES], "_overview_vehicles.png", 4.0, 3, "q", 1200, 600)
    if do_verify:
        stats = verify(names)
        if only is None:
            write_readme(stats)
        bad = 0
        for n, s in stats.items():
            print(f"[verify] {n:11s} size={s['size']} tris={s['tris']} parks={s['parks']} "
                  f"meshes={s['meshes']} {'OK' if not s['issues'] else s['issues']}")
            bad += bool(s["issues"])
        print(f"[verify] {len(stats) - bad}/{len(stats)} models pass")


main()

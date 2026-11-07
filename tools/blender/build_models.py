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
    Service vehicles keep fixed colours instead: paint / trim / lights (+ ladder) / glass / dark, no body/cargo.
    Parks (park, parklarge) are grass lots with no asphalt strip and no park_N empties.
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
        "pad": "#bdb8a6", "asphalt": "#45484d", "line": "#e6e4da",
        # residential
        "res_wall": "#e2d6bc", "res_roof": "#b0603f", "res_wall2": "#d6c8aa", "res_roof2": "#96503a",
        "res_trim": "#ece8dc",
        "apt_wall": "#cdc4b2", "apt_roof": "#8e8f8d", "apt_brace": "#a9a8a2", "apt_band": "#b3ab9b",
        # commercial
        "com_wall": "#d4d2ca", "com_roof": "#b6b8b8", "com_rib": "#cacccb", "com_canopy": "#8a4a36",
        "com_glass": "#93acbd",
        # workplaces
        "work_wall": "#9ba1a6", "work_roof": "#6e747a", "work_glass": "#7d98ad", "work_trim": "#b8bdc0",
        # industry
        "ind_wall": "#9c9e9c", "ind_roof": "#82868a", "ind_dark": "#55595e", "ind_orange": "#c9652e",
        "ind_copper": "#b0653a", "ind_yellow": "#d9b13a", "ind_tank": "#dde0e4", "ind_steel": "#b0b5bc",
        "ac_box": "#d6d9de", "ac_fan": "#5b626c",
        # farm
        "barn_roof": "#9a5a40", "farm_accent": "#5e7d3a", "silo": "#d9d8d2", "soil": "#9c8562",
        "crop_g1": "#7f9b3f", "crop_g2": "#6b8836", "crop_w1": "#cdb36a", "crop_w2": "#b89b51",
        # services: waste (sage + green), fire (brick red + white), police (navy + gold), health (white + red
        # cross, mint accents), education (cream + orange / terracotta), parks (grass, paths, trees, water)
        "gb_wall": "#a9b2ac", "gb_roof": "#4f9a6c", "gb_cap": "#37804f", "gb_fence": "#7b8681",
        "gb_skip_g": "#3f9a4e", "gb_light": "#cfe3d6", "gb_skip_b": "#3f7fc8", "gb_rubbish": "#6e6656",
        "fire_wall": "#c9463c", "fire_roof": "#b0382f", "fire_trim": "#f4f2ee", "fire_door": "#dfe2e6",
        "pol_wall": "#e6ebf2", "pol_roof": "#2b4a8a", "pol_band": "#4a7fd4", "pol_white": "#f6f7f9",
        "pol_star": "#f2c230",
        "hc_wall": "#f6f7f5", "hc_roof": "#e1e5e8", "hc_glass": "#bfe6df", "hc_accent": "#4fb7a6",
        "hc_red": "#e0453a", "hc_white": "#ffffff", "heli": "#4b525b",
        "sch_wall": "#f3e7c9", "sch_roof": "#f0a43a", "sch_roof2": "#e58e2e", "sch_trim": "#d9762a",
        "sch_glass": "#d9eef5", "court": "#4f8fd0", "play": "#e9785a", "sand": "#ead49c", "wood": "#a97c50",
        "track": "#d0654a",
        "uni_wall": "#eadcbc", "uni_roof": "#c8683f", "dome": "#5fb39e", "column": "#f7f3ea",
        "grass": "#8f9a4e", "path": "#d4cbb2", "leaf": "#557a32", "leaf2": "#67883c", "trunk": "#8a6a4a",
        "water": "#6fbbe3", "stone": "#d6d8d4", "pav_roof": "#d8654f",
        # bus stop: dark frame, pale glass, a white roof and the blue stop sign
        "bs_frame": "#3c4148", "bs_glass": "#cfe6f2", "bs_roof": "#3f5470", "bs_sign": "#2f6fd0",
        # utilities: wind (white tower, grey nacelle), coal (warm grey brick, red-white chimney, pale cooling
        # tower), solar (deep blue panels on grass), water (white + blue), sewage (sand concrete, olive roof)
        "tb_white": "#f2f3f1", "tb_grey": "#bfc4ca", "gravel": "#d3cbb9", "concrete": "#c8c6c0",
        "cp_wall": "#a39a90", "cp_roof": "#756d66", "cp_red": "#d8473a", "cp_white": "#f2f0ea",
        "coal": "#34353a", "cp_tower": "#ddd9d1", "cp_inside": "#8a8780",
        "solar": "#2c4e88", "solar_line": "#a8bedf", "solar_leg": "#9aa0a8",
        "wp_wall": "#e9eef2", "wp_roof": "#2f7fc8", "wp_pipe": "#3a8fd6", "wp_tank": "#dde5ec",
        "sw_wall": "#ddd6c3", "sw_roof": "#7c8a5a", "sw_water": "#8a7849", "sw_pipe": "#6b6f75",
        # landmarks: town hall (cream stone, slate roof, copper dome), stadium (pale shell, red seats, pitch),
        # tower (warm concrete, glass pod), concert hall (white shells), skyline tower (blue glass, pale fins)
        "lm_paving": "#e4ddd0", "lm_glass": "#a9cbe0", "lm_clock": "#f6f1e2", "lm_lamp": "#f4f1e0",
        "th_wall": "#efe4cb", "th_trim": "#f8f4ea", "th_roof": "#6c7a90", "th_flag": "#c8483c",
        # town growth: old high street (ochre / brick / cream render, green and red awnings), modern flats (white,
        # timber, glass rails, green roofs), glass tower (blue glass, pale fins)
        "hs_wall1": "#d8b07e", "hs_wall2": "#b9765a", "hs_wall3": "#e9dec6", "hs_awning": "#2f6f5f",
        "hs_awning2": "#a9403a", "mf_wall": "#f2f1ec", "mf_wood": "#b88a5c", "mf_glass": "#9cc3d8",
        "mf_rail": "#cfe3ec", "mf_dark": "#5a5f67", "mf_green": "#7d9850", "gt_glass": "#6f9cc0",
        "gt_glass2": "#a6c8de", "gt_fin": "#e7eaec", "gt_podium": "#d5d8db",
        "st_shell": "#dfe3e8", "st_seat": "#d6503f", "st_seat2": "#e0705f", "st_roof": "#f4f6f8",
        "pitch": "#5fae4a", "pitch2": "#6cbc55",
        "obs_concrete": "#cdc6ba", "obs_white": "#f2f2ee",
        "ch_shell": "#f7f7f3", "ch_shell2": "#e9ece9",
        "sky_base": "#b9c3cf", "sky_glass": "#5f86b0", "sky_fin": "#e7ebf0", "sky_roof": "#7f97b3",
        # timber: logging camp (log brown + pale cut ends on a sandy yard, green roofs, pines), sawmill (rust-red
        # two-tone roof with a pale ridge vent, pale yellow plank bundles)
        "log_bark": "#7b5434", "log_bark2": "#906340", "log_end": "#e8b878", "lg_yard": "#b9aa86",
        "lg_roof": "#4f6a4c", "lg_roof2": "#61795a", "cabin": "#a8743f", "cabin_dark": "#7e5530",
        "pine": "#2f6c45", "pine2": "#3d8552",
        "sm_roof": "#a8553b", "sm_roof2": "#8c4630", "sm_ridge": "#ddd8cc", "plank": "#e2c78a",
        "stick": "#c49556",
        # tier 2: mines, quarry, smelter, cement works
        "rust": "#8c4f36", "rust2": "#a85f3c", "ore_pile": "#7a4532", "ore_pile2": "#94573b",
        "coal_yard": "#807b70", "cm_wall": "#5f6064", "cm_roof": "#45474b", "cm_silo": "#7d7f83",
        "lime": "#ddd7c4", "lime2": "#cbc4ae", "lime3": "#b8b09a", "lime_floor": "#a7a08a",
        "furnace": "#4b4745", "glow": "#e8823a", "stove": "#8f9296", "kiln": "#c7c4bb",
        "cement": "#d2d0c9", "cement2": "#b9b7b0",
        # tier 3: oil, sand, refinery, glass, furniture, construction parts
        "pj": "#a9473a", "tank_roof": "#c4c8cc", "column_steel": "#c9ccd0", "flame": "#f0a040",
        "sand_rim": "#dcc68f", "sand_rim2": "#c9b07a", "pond": "#6f8c86", "sand_pile": "#e4cb8c", "sand_pile2": "#d3b574",
        "glass_sheet": "#a7cad3", "saw_glass": "#9fb6c4", "fur_wall": "#c9bca4", "fur_roof": "#8c8f91", "panel": "#cfccc3", "cullet": "#b7d0c8",
        # tier 4: copper, electronics, machinery
        "cu_rock": "#8f9389", "cu_rock2": "#7b8077", "cu_floor": "#646d66", "cu_ore": "#5f8f7c", "cu_road": "#a39e90",
        "el_wall": "#e7e8e6", "el_roof": "#c4c8cb", "el_glass": "#6f93b0", "el_accent": "#3d7bb0", "mw_band": "#2f5f8a",
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


# ------------------------------------------------------------------ service helpers

def revolve(M, cx, cy, prof, m, n=8, rot=0.0):
    """Closed solid of revolution about (cx, cy): prof = [(r, z), ...] bottom to top, r = 0 is a pole."""
    bm, idx = M.bm, M.mi(m)
    rings = []
    for r, z in prof:
        if r <= 1e-6:
            rings.append([bm.verts.new((cx, cy, z))])
        else:
            rings.append([bm.verts.new((cx + r * math.cos(rot + 2 * math.pi * i / n),
                                        cy + r * math.sin(rot + 2 * math.pi * i / n), z)) for i in range(n)])
    fs = []
    if len(rings[0]) > 1:
        fs.append(bm.faces.new(rings[0][::-1]))
    if len(rings[-1]) > 1:
        fs.append(bm.faces.new(rings[-1]))
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            if len(a) == 1:
                fs.append(bm.faces.new((a[0], b[i], b[j])))
            elif len(b) == 1:
                fs.append(bm.faces.new((a[i], a[j], b[0])))
            else:
                fs.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    for f in fs:
        f.material_index = idx
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def ribbon(M, pts, wd, z0, z1, m, closed=False):
    """Flat strip (footpath) of width wd along a 2D polyline, mitred so the segments meet without gaps."""
    n, hw = len(pts), wd / 2
    V = [Vector(p) for p in pts]
    left, right = [], []
    for i in range(n):
        p = V[i]
        a = V[i - 1] if (closed or i > 0) else None
        b = V[(i + 1) % n] if (closed or i < n - 1) else None
        d0 = (p - a).normalized() if a is not None else (b - p).normalized()
        d1 = (b - p).normalized() if b is not None else d0
        t = (d0 + d1).normalized()
        nrm = Vector((-t.y, t.x))
        s = hw / max(nrm.dot(Vector((-d1.y, d1.x))), 0.35)
        left.append(p + nrm * s)
        right.append(p - nrm * s)
    for i in (range(n) if closed else range(n - 1)):
        j = (i + 1) % n
        q = [right[i], right[j], left[j], left[i]]
        M.loft([(v.x, v.y, z0) for v in q], [(v.x, v.y, z1) for v in q], m)


def poly_prism(M, pts, z0, z1, m):
    """Prism over any simple 2D polygon (pond, star, track)."""
    return M.loft([(x, y, z0) for x, y in pts], [(x, y, z1) for x, y in pts], m)


def star_pts(cx, cy, ro, ri, k=5):
    return [(cx + (ro if i % 2 == 0 else ri) * math.cos(math.pi / 2 + math.pi * i / k),
             cy + (ro if i % 2 == 0 else ri) * math.sin(math.pi / 2 + math.pi * i / k)) for i in range(2 * k)]


def stadium_pts(cx, cy, r, half, n=8):
    """Running-track outline: two semicircles of radius r joined by straights, long axis along Y."""
    top = [(cx + r * math.cos(math.pi * i / n), cy + half + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    bot = [(cx - r * math.cos(math.pi * i / n), cy - half - r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    return top + bot


def cross_sign(M, cx, cy, s, arm, z0, z1, m):
    """Medical cross, s across, arms arm wide (3 non-overlapping boxes)."""
    box(M, cx - arm / 2, cx + arm / 2, cy - s / 2, cy + s / 2, z0, z1, m)
    box(M, cx - s / 2, cx - arm / 2, cy - arm / 2, cy + arm / 2, z0, z1, m)
    box(M, cx + arm / 2, cx + s / 2, cy - arm / 2, cy + arm / 2, z0, z1, m)


def tree(M, P, x, y, s=1.0, alt=False):
    """Low-poly tree: a thin trunk under a faceted round canopy."""
    cyl(M, x, y, 0.22 * s, PAD_H, 2.0 * s, P["trunk"], n=5)
    r, z = 1.9 * s, 1.5 * s
    revolve(M, x, y, [(0, z), (0.8 * r, z + 0.45 * r), (r, z + 1.0 * r), (0.72 * r, z + 1.55 * r), (0, z + 1.85 * r)],
            P["leaf2" if alt else "leaf"], n=7, rot=(x * 0.37 + y * 0.61) % 1.0)


def bench(M, P, x, y, ang):
    """Park bench centred at (x, y), seat running along angle ang, backrest on the far side from ang+90deg."""
    u = Vector((math.cos(ang), math.sin(ang)))
    nv = Vector((-u.y, u.x))
    c = Vector((x, y))
    bar(M, c - u * 0.8, c + u * 0.8, 0.55, 0.38, 0.48, P["wood"])
    b = c - nv * 0.3
    bar(M, b - u * 0.8, b + u * 0.8, 0.1, 0.48, 0.9, P["wood"])
    bar(M, c - u * 0.6, c + u * 0.6, 0.35, PAD_H, 0.38, P["ind_dark"])


def fountain(M, P, x, y, r=2.2):
    z = PAD_H
    cyl(M, x, y, r, z, z + 0.55, P["stone"], n=14)
    cyl(M, x, y, r - 0.35, z + 0.4, z + 0.58, P["water"], n=14)
    cyl(M, x, y, 0.3, z + 0.58, z + 1.4, P["stone"], n=8)
    cyl(M, x, y, 0.8, z + 1.4, z + 1.6, P["stone"], n=10)
    cyl(M, x, y, 0.55, z + 1.6, z + 1.65, P["water"], n=10)


def skip_bin(M, P, cx, cy, w, l, h, m):
    """Open waste skip: tapered steel box with dark rubbish showing inside the rim."""
    taper(M, (cx - w / 2 + 0.3, cx + w / 2 - 0.3, cy - l / 2 + 0.6, cy + l / 2 - 0.6),
          (cx - w / 2, cx + w / 2, cy - l / 2, cy + l / 2), PAD_H, h, m)
    box(M, cx - w / 2 + 0.28, cx + w / 2 - 0.28, cy - l / 2 + 0.28, cy + l / 2 - 0.28, h - 0.3, h + 0.03,
        P["gb_rubbish"])


def green_lot(M, P, w, d):
    """Park lot: grass over the whole footprint, no asphalt strip and no bays."""
    L = Lot(w, d)
    box(M, -w / 2, w / 2, -d / 2, d / 2, 0, PAD_H, P["grass"])
    return L


# ------------------------------------------------------------------ service buildings

def b_garbage(M, P):
    L = lot(M, P, 36, 32, bay_row(3, -6.25))
    wall, roof, cap, dark = P["gb_wall"], P["gb_roof"], P["gb_cap"], P["ind_dark"]
    # transfer hall: tall shed, low gable along Y, green ridge cap and eaves band, three roller doors
    x0, x1, y0, y1, h = -16.5, 4.0, L.y0, L.y1 - 0.5, 8.0
    band(M, x0, x1, y0, y1, 6.3, 7.0, cap)
    box(M, x0, x1, y0, y1, 0, h, wall)
    gable(M, x0, x1, y0, y1, h, h + 2.6, "y", roof, wall, oh_u=(0.5, 0.5), oh_a=(0.5, 0.5))
    xm = (x0 + x1) / 2
    box(M, xm - 0.32, xm + 0.32, y0 - 0.55, y1 + 0.55, h + 2.45, h + 2.75, cap, bevel=0.05)
    def zt(u):   # top of the roof shell above u
        return h + 2.6 * (1.0 - abs(u - xm) / (xm - x0))
    for ua, ub in ((x0 + 2.0, x0 + 3.4), (x0 + 6.0, x0 + 7.4)):   # rooflight strips laid on both slopes
        for sgn in (1, -1):
            us = [xm + sgn * (u - xm) for u in (ua, ub)]
            q = [(us[0], y0 + 1.5), (us[1], y0 + 1.5), (us[1], y1 - 1.5), (us[0], y1 - 1.5)]
            M.loft([(u, y, zt(u) + 0.01) for u, y in q], [(u, y, zt(u) + 0.09) for u, y in q], P["gb_light"])
    for dx in (-13.0, -6.25, 0.5):
        box(M, dx - 2.3, dx + 2.3, y0 - 0.08, y0, 0, 5.4, dark)
        box(M, dx - 2.6, dx + 2.6, y0 - 0.3, y0, 5.4, 5.8, cap)
    # fenced yard with skips and a roll-off container
    yx0, yx1, yy0, yy1 = 5.6, 17.4, L.y0 - 1.0, L.y1 + 0.6
    box(M, yx0, yx1, yy0, yy1, PAD_H, PAD_H + 0.02, P["asphalt"])
    fz, ft, fm = 1.9, 0.15, P["gb_fence"]
    box(M, yx0, yx1, yy1 - ft, yy1, 0, fz, fm)
    box(M, yx0, yx0 + ft, yy0, yy1 - ft, 0, fz, fm)
    box(M, yx1 - ft, yx1, yy0, yy1 - ft, 0, fz, fm)
    box(M, yx0 + ft, 9.6, yy0, yy0 + ft, 0, fz, fm)
    box(M, 14.2, yx1 - ft, yy0, yy0 + ft, 0, fz, fm)
    for cx, m in ((8.0, P["gb_skip_g"]), (11.1, P["ind_yellow"]), (14.2, P["gb_skip_b"])):
        skip_bin(M, P, cx, 11.6, 2.5, 4.6, 1.7, m)
    skip_bin(M, P, 14.9, 2.6, 2.7, 6.6, 2.2, P["gb_skip_g"])
    skip_bin(M, P, 9.0, 3.6, 2.5, 4.2, 1.7, P["ind_yellow"])
    # gatehouse with a weighbridge plate in front of it
    flat_block(M, yx0 + 0.3, yx0 + 3.0, yy0 + 0.6, yy0 + 3.2, 2.8, wall, cap)
    box(M, 9.9, 13.9, yy0 + 1.0, yy0 + 7.0, PAD_H, PAD_H + 0.1, P["ind_steel"])
    return L


def b_firestation(M, P):
    bx = [-8.6, -5.0, -1.4]
    L = lot(M, P, 26, 24, bx)
    wall, roof, trim, door = P["fire_wall"], P["fire_roof"], P["fire_trim"], P["fire_door"]
    # apparatus hall: three big doors on the apron, white lane stripes on the roof
    x0, x1, y0, y1, h = -11.5, 1.6, L.y0, 7.0, 6.2
    box(M, x0, x1, L.yf + PARK_DEPTH, y0, PAD_H, PAD_H + 0.02, P["asphalt"])
    band(M, x0, x1, y0, y1, 5.2, 5.6, trim)
    top = flat_block(M, x0, x1, y0, y1, h, wall, roof, parapet=trim)
    for cx in bx:
        box(M, cx - 1.6, cx + 1.6, y0 - 0.08, y0, 0, 4.4, door)
        box(M, cx - 0.55, cx + 0.55, y0 + 0.8, y1 - 0.8, top, top + 0.12, trim)
    # hose / training tower in the back-left corner
    tx0, tx1, ty0, ty1, th = -11.5, -7.3, y1, L.y1, 15.0
    for z in (8.2, 11.4):
        band(M, tx0, tx1, ty0, ty1, z, z + 0.9, trim)
    ttop = flat_block(M, tx0, tx1, ty0, ty1, th, wall, roof, parapet=trim)
    box(M, tx0 + 1.0, tx1 - 1.0, ty0 + 1.0, ty1 - 1.0, ttop, ttop + 0.9, trim)
    # crew quarters: two storeys with window bands
    qx0, qx1, qy0, qy1 = x1, 11.5, L.y0 + 1.5, L.y1
    for z in (1.0, 4.4):
        band(M, qx0, qx1, qy0, qy1, z, z + 1.2, P["com_glass"])
    qtop = flat_block(M, qx0, qx1, qy0, qy1, 7.0, wall, roof, parapet=trim)
    ac_unit(M, 8.5, qy1 - 2.5, qtop, P)
    box(M, 4.5, 8.5, qy0 - 1.3, qy0, 2.8, 3.05, trim, bevel=0.04)
    return L


def b_police(M, P):
    L = lot(M, P, 24, 22, bay_row(3, -4.5))
    wall, roof, bnd, white = P["pol_wall"], P["pol_roof"], P["pol_band"], P["pol_white"]
    # main block: two storeys, navy roof with a white badge and a gold star
    x0, x1, y0, y1 = -11.0, 3.5, L.y0, 6.4
    for z in (1.0, 4.3):
        band(M, x0, x1, y0, y1, z, z + 1.2, bnd)
    top = flat_block(M, x0, x1, y0, y1, 7.0, wall, roof, parapet=white)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    cyl(M, cx, cy, 3.2, top, top + 0.1, white, n=20)
    poly_prism(M, star_pts(cx, cy, 2.7, 1.1), top + 0.1, top + 0.22, P["pol_star"])
    box(M, -7.0, -2.0, y0 - 1.5, y0, 2.9, 3.15, roof, bevel=0.04)
    box(M, -6.0, -3.0, y0 - 0.06, y0, 0.3, 2.6, P["com_glass"])
    # lower back wing
    flat_block(M, x0, -3.0, y1, L.y1, 4.0, wall, roof, parapet=white)
    # walled vehicle yard on the right
    yx0, yx1, yy0, yy1 = 4.6, 11.2, -1.6, L.y1 + 0.4
    box(M, yx0, yx1, yy0, yy1, PAD_H, PAD_H + 0.02, P["asphalt"])
    wz, wt = 2.2, 0.3
    box(M, yx0, yx1, yy1 - wt, yy1, 0, wz, wall)
    box(M, yx0, yx0 + wt, yy0, yy1 - wt, 0, wz, wall)
    box(M, yx1 - wt, yx1, yy0, yy1 - wt, 0, wz, wall)
    box(M, yx0 + wt, 6.4, yy0, yy0 + wt, 0, wz, wall)
    box(M, 10.0, yx1 - wt, yy0, yy0 + wt, 0, wz, wall)
    frame(M, yx0, yx1, yy0, yy1, wz, wz + 0.15, wt, bnd)
    box(M, yx0 + wt, yx1 - wt, yy1 - 4.0, yy1 - wt, 3.0, 3.2, roof, bevel=0.04)   # car port
    # flagpole in front of the yard
    fx, fy = 8.2, -3.6
    cyl(M, fx, fy, 0.6, 0, 0.3, white, n=8)
    cyl(M, fx, fy, 0.09, 0.3, 9.0, P["ind_steel"], n=6)
    box(M, fx + 0.09, fx + 1.9, fy - 0.04, fy + 0.04, 7.6, 8.8, roof)
    return L


def b_clinic(M, P):
    L = lot(M, P, 26, 24, bay_row(3, 7.4))
    wall, roof, glass, acc = P["hc_wall"], P["hc_roof"], P["hc_glass"], P["hc_accent"]
    # main block: two storeys, white roof sign with a red cross
    x0, x1, y0, y1 = -11.0, 6.5, L.y0 + 1.5, L.y1
    for z in (1.0, 4.3):
        band(M, x0, x1, y0, y1, z, z + 1.2, glass)
    top = flat_block(M, x0, x1, y0, y1, 6.8, wall, roof, parapet=wall)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box(M, cx - 4.4, cx + 4.4, cy - 4.4, cy + 4.4, top, top + 0.08, P["hc_white"])
    cross_sign(M, cx, cy, 7.0, 2.4, top + 0.08, top + 0.2, P["hc_red"])
    # one-storey ambulance wing with a mint roof, drive-through canopy in front of it
    wx0, wx1, wy0 = x1, 11.0, y0 + 2.0
    box(M, wx0 + 0.6, wx1 - 0.6, wy0 - 0.06, wy0, 0.0, 3.0, glass)
    flat_block(M, wx0, wx1, wy0, y1, 4.0, wall, acc)
    yp = L.yf + PARK_DEPTH
    box(M, 3.4, 11.6, yp, wy0, PAD_H, PAD_H + 0.02, P["asphalt"])
    box(M, 3.4, 11.6, yp + 0.3, y0, 3.5, 3.8, acc, bevel=0.05)
    for px in (3.9, 11.1):
        box(M, px - 0.15, px + 0.15, yp + 0.45, yp + 0.75, 0, 3.5, wall)
    box(M, 3.8, 6.0, y0 - 0.06, y0, 0.3, 2.8, glass)
    # small garden strip on the left
    box(M, x0, 1.8, yp + 0.3, y0 - 0.4, PAD_H, PAD_H + 0.03, P["grass"])
    tree(M, P, -8.0, (yp + y0) / 2, 0.75)
    tree(M, P, -2.0, (yp + y0) / 2, 0.7, alt=True)
    return L


def b_hospital(M, P):
    L = lot(M, P, 46, 40, bay_row(5, -12.5))
    wall, roof, glass, acc = P["hc_wall"], P["hc_roof"], P["hc_glass"], P["hc_accent"]
    st = 3.4
    # central ward tower with the helipad
    tx0, tx1, ty0, ty1 = -8.0, 8.0, L.y0 + 7.5, L.y1 - 5.0
    for s in range(5):
        band(M, tx0, tx1, ty0, ty1, s * st + 1.0, s * st + 2.3, glass)
    ttop = flat_block(M, tx0, tx1, ty0, ty1, 5 * st, wall, roof, parapet=wall)
    hx, hy = 0.0, (ty0 + ty1) / 2
    cyl(M, hx, hy, 6.4, ttop, ttop + 0.1, P["heli"], n=18)
    cyl(M, hx, hy, 5.3, ttop + 0.1, ttop + 0.13, P["hc_white"], n=18)
    cyl(M, hx, hy, 4.9, ttop + 0.13, ttop + 0.16, P["heli"], n=18)
    box(M, hx - 1.8, hx - 1.0, hy - 2.4, hy + 2.4, ttop + 0.16, ttop + 0.2, P["hc_white"])
    box(M, hx + 1.0, hx + 1.8, hy - 2.4, hy + 2.4, ttop + 0.16, ttop + 0.2, P["hc_white"])
    box(M, hx - 1.0, hx + 1.0, hy - 0.4, hy + 0.4, ttop + 0.16, ttop + 0.2, P["hc_white"])
    # left wing: three storeys, big cross on the roof
    lx0, lx1, ly0, ly1 = -21.5, tx0, L.y0 + 3.0, L.y1 - 6.5
    for s in range(3):
        band(M, lx0, lx1, ly0, ly1, s * st + 1.0, s * st + 2.3, glass)
    ltop = flat_block(M, lx0, lx1, ly0, ly1, 3 * st, wall, roof, parapet=wall)
    cx, cy = (lx0 + lx1) / 2, (ly0 + ly1) / 2
    box(M, cx - 5.2, cx + 5.2, cy - 5.2, cy + 5.2, ltop, ltop + 0.08, P["hc_white"])
    cross_sign(M, cx, cy, 8.4, 2.8, ltop + 0.08, ltop + 0.2, P["hc_red"])
    # right wing: two storeys, set back, plant on the roof
    rx0, rx1, ry0, ry1 = tx1, 21.5, L.y0 + 9.0, L.y1
    for s in range(2):
        band(M, rx0, rx1, ry0, ry1, s * st + 1.0, s * st + 2.3, glass)
    rtop = flat_block(M, rx0, rx1, ry0, ry1, 2 * st, wall, acc, parapet=wall)
    for ax, ay in ((11.5, ry0 + 4.0), (15.5, ry0 + 4.0), (11.5, ry1 - 4.0), (15.5, ry1 - 4.0)):
        ac_unit(M, ax, ay, rtop, P, rot=True)
    box(M, 18.0, 20.5, ry0 + 3.0, ry1 - 3.0, rtop, rtop + 1.8, wall, bevel=0.06)
    # glazed entrance block with the emergency canopy and drop-off
    ex0, ex1, ey0, ey1 = -4.5, 6.0, L.y0, ty0
    box(M, ex0 + 0.8, ex1 - 0.8, ey0 - 0.06, ey0, 0.3, 3.0, glass)
    flat_block(M, ex0, ex1, ey0, ey1, 4.4, wall, acc)
    yp = L.yf + PARK_DEPTH
    box(M, ex0 - 1.0, 21.5, yp, ey0, PAD_H, PAD_H + 0.02, P["asphalt"])
    box(M, ex1, 13.5, yp + 0.3, ey0 + 3.0, 3.6, 3.9, acc, bevel=0.05)
    for px in (8.0, 13.0):
        box(M, px - 0.15, px + 0.15, yp + 0.45, yp + 0.75, 0, 3.6, wall)
    # garden in front of the right wing
    box(M, 14.5, 21.5, yp + 1.5, ry0 - 0.5, PAD_H, PAD_H + 0.03, P["grass"])
    tree(M, P, 17.0, ry0 - 3.0, 0.8)
    tree(M, P, 20.0, yp + 3.0, 0.7, alt=True)
    return L


def b_school(M, P):
    L = lot(M, P, 40, 34, bay_row(4, -8.0))
    wall, roof, glass, trim = P["sch_wall"], P["sch_roof"], P["sch_glass"], P["sch_trim"]
    # L-shaped single-storey building: front wing along X, side wing back along Y
    fx0, fx1, fy0, fy1 = -18.0, 5.0, L.y0, L.y0 + 7.0
    sx0, sx1, sy1 = -18.0, -10.5, L.y1
    band(M, fx0, fx1, fy0, fy1, 1.0, 2.6, glass)
    band(M, sx0, sx1, fy1, sy1, 1.0, 2.6, glass)
    box(M, fx0, fx1, fy0, fy1, 0, 4.2, wall)
    gable(M, fx0, fx1, fy0, fy1, 4.2, 6.4, "x", roof, wall)
    box(M, sx0, sx1, fy1, sy1, 0, 4.2, wall)
    gable(M, sx0, sx1, fy1, sy1, 4.2, 6.2, "y", roof, wall, oh_a=(0.0, 0.4))
    box(M, -6.0, -1.0, fy0 - 1.4, fy0, 2.9, 3.15, trim, bevel=0.04)
    box(M, -5.0, -2.0, fy0 - 0.06, fy0, 0.3, 2.6, glass)
    # sports court in the yard
    cx0, cx1, cy0, cy1 = -8.0, 17.0, 2.0, 15.0
    zc = PAD_H + 0.04
    box(M, cx0, cx1, cy0, cy1, PAD_H, zc, P["court"])
    lz, lt, ln = zc + 0.012, 0.14, P["line"]
    frame(M, cx0 + 0.8, cx1 - 0.8, cy0 + 0.8, cy1 - 0.8, zc, lz, lt, ln)
    xm, ym = (cx0 + cx1) / 2, (cy0 + cy1) / 2
    box(M, xm - lt / 2, xm + lt / 2, cy0 + 0.8 + lt, cy1 - 0.8 - lt, zc, lz, ln)
    cyl(M, xm, ym, 2.0, zc, lz, ln, n=16)
    cyl(M, xm, ym, 2.0 - lt, lz, lz + 0.006, P["court"], n=16)
    for kx0, kx1 in ((cx0 + 0.8 + lt, cx0 + 5.6), (cx1 - 5.6, cx1 - 0.8 - lt)):
        frame(M, kx0 - (lt if kx0 > xm else 0), kx1 + (lt if kx1 < xm else 0), ym - 2.4, ym + 2.4, zc, lz, lt, ln)
    for hx in (cx0 + 0.3, cx1 - 0.3):
        box(M, hx - 0.12, hx + 0.12, ym - 0.12, ym + 0.12, zc, 3.05, P["ind_dark"])
    # playground: rubber surface, sandpit, play tower with a slide, swings
    px0, px1, py0, py1 = 7.0, 18.5, L.y0 - 0.5, 0.6
    box(M, px0, px1, py0, py1, PAD_H, PAD_H + 0.03, P["play"])
    z = PAD_H + 0.03
    frame(M, 8.0, 11.6, py0 + 1.0, py0 + 4.2, z, z + 0.3, 0.25, P["wood"])
    box(M, 8.25, 11.35, py0 + 1.25, py0 + 3.95, z, z + 0.22, P["sand"])
    tx, ty = 14.6, py0 + 2.2
    box(M, tx - 1.0, tx + 1.0, ty - 1.0, ty + 1.0, z, 1.5, P["wood"])
    for dx in (-0.85, 0.85):
        for dy in (-0.85, 0.85):
            box(M, tx + dx - 0.1, tx + dx + 0.1, ty + dy - 0.1, ty + dy + 0.1, 1.5, 2.6, P["wood"])
    cone(M, tx, ty, 1.55, 2.6, 3.7, P["ind_yellow"], n=4)
    lo = [(tx - 0.45, ty + 1.0, 1.5), (tx + 0.45, ty + 1.0, 1.5), (tx + 0.45, ty + 4.0, z), (tx - 0.45, ty + 4.0, z)]
    M.loft(lo, [(x, y, zz + 0.12) for x, y, zz in lo], P["court"])
    sx, sy = 9.8, py1 - 1.6
    box(M, sx - 2.2, sx + 2.2, sy - 0.08, sy + 0.08, 2.3, 2.45, P["ind_steel"])
    for dx in (-2.1, 2.1):
        box(M, sx + dx - 0.08, sx + dx + 0.08, sy - 0.08, sy + 0.08, z, 2.3, P["ind_steel"])
    for dx in (-0.9, 0.9):
        box(M, sx + dx - 0.3, sx + dx + 0.3, sy - 0.15, sy + 0.15, 0.5, 0.58, P["ind_dark"])
    tree(M, P, -8.6, cy0 - 1.6, 0.8)
    tree(M, P, 18.2, 4.2, 0.9, alt=True)
    tree(M, P, 18.2, 12.5, 0.85)
    return L


def b_highschool(M, P):
    L = lot(M, P, 52, 42, bay_row(5, -14.0))
    wall, roof, roof2, glass, trim = P["sch_wall"], P["sch_roof"], P["sch_roof2"], P["sch_glass"], P["sch_trim"]
    st = 3.5
    # main teaching block (two storeys) and a side wing, flat orange roofs with cream parapets
    mx0, mx1, my0, my1 = -24.5, 2.5, L.y0, L.y0 + 11.5
    wx0, wx1, wy1 = -24.5, -13.0, L.y1
    for s in range(2):
        band(M, mx0, mx1, my0, my1, s * st + 1.0, s * st + 2.5, glass)
        band(M, wx0, wx1, my1, wy1, s * st + 1.0, s * st + 2.5, glass)
    top = flat_block(M, mx0, mx1, my0, my1, 2 * st, wall, roof2, parapet=wall)
    flat_block(M, wx0, wx1, my1, wy1, 2 * st, wall, roof2, parapet=wall)
    for x in (-20.0, -12.0, -4.0):
        box(M, x - 2.0, x + 2.0, my0 + 3.5, my1 - 3.5, top, top + 0.5, glass, bevel=0.05)   # skylights
    for y in (my1 + 6.0, my1 + 14.0):
        box(M, wx0 + 3.5, wx1 - 3.5, y - 2.0, y + 2.0, top, top + 0.5, glass, bevel=0.05)
    box(M, -14.0, -6.0, my0 - 1.6, my0, 3.1, 3.35, trim, bevel=0.04)
    box(M, -12.5, -7.5, my0 - 0.06, my0, 0.3, 2.8, glass)
    # gym: tall hall with a shallow gable
    gx0, gx1, gy0, gy1 = -10.5, 2.5, my1 + 4.0, L.y1
    band(M, gx0, gx1, gy0, gy1, 6.0, 7.2, glass)
    box(M, gx0, gx1, gy0, gy1, 0, 8.6, wall)
    gable(M, gx0, gx1, gy0, gy1, 8.6, 10.4, "y", roof, wall, oh_u=(0.4, 0.4), oh_a=(0.4, 0.4))
    # courtyard trees
    tree(M, P, -9.0, my1 + 2.0, 0.75, alt=True)
    tree(M, P, -1.5, my1 + 2.0, 0.7)
    # running track with a football pitch in the infield, small stand on the far side
    tcx, tcy, r, half = 14.5, 3.6, 9.0, 7.0
    z = PAD_H
    layers = [(r, P["line"]), (r - 0.15, P["track"]), (r - 1.45, P["line"]), (r - 1.57, P["track"]),
              (r - 2.9, P["line"]), (r - 3.05, P["grass"])]
    for i, (rr, m) in enumerate(layers):
        poly_prism(M, stadium_pts(tcx, tcy, rr, half), z + i * 0.012, z + (i + 1) * 0.012, m)
    zp, lt = z + len(layers) * 0.012, 0.12
    frame(M, tcx - 3.8, tcx + 3.8, tcy - 9.6, tcy + 9.6, zp, zp + 0.008, lt, P["line"])
    box(M, tcx - 3.8 + lt, tcx + 3.8 - lt, tcy - lt / 2, tcy + lt / 2, zp, zp + 0.008, P["line"])
    for s in (-1, 1):
        box(M, tcx - 1.6, tcx + 1.6, tcy + s * 9.6 - 0.1, tcy + s * 9.6 + 0.1, zp, 2.1, P["hc_white"])
    for i in range(3):
        box(M, 24.0 + i * 0.6, 25.8, -4.0, 11.0, 0, 0.6 + i * 0.6, P["court"] if i % 2 == 0 else P["ind_steel"])
    return L


def b_university(M, P):
    L = lot(M, P, 70, 56, bay_row(6, -21.0))
    wall, roof, glass, col = P["uni_wall"], P["uni_roof"], P["sch_glass"], P["column"]
    st = 3.6
    # main hall at the back with a portico and a copper dome
    hx0, hx1, hy0, hy1 = -15.0, 15.0, 16.5, L.y1
    for s in range(2):
        band(M, hx0, hx1, hy0, hy1, s * st + 1.4, s * st + 2.9, glass)
    box(M, hx0, hx1, hy0, hy1, 0, 9.0, wall)
    gable(M, hx0, hx1, hy0, hy1, 9.0, 11.8, "x", roof, wall)
    py0 = hy0 - 3.4
    box(M, -5.4, 5.4, py0, hy0, 0, 0.6, col)
    for i in range(6):
        cyl(M, -4.5 + i * 1.8, py0 + 0.6, 0.38, 0.6, 7.6, col, n=6)
    box(M, -5.6, 5.6, py0, hy0, 7.6, 8.3, col)
    gable(M, -5.6, 5.6, py0, hy0 + 1.0, 8.3, 10.2, "y", roof, col, oh_u=(0.2, 0.2), oh_a=(0.3, 0.0))
    dx, dy = 0.0, (hy0 + hy1) / 2
    cyl(M, dx, dy, 4.3, 9.0, 14.2, wall, n=14)
    cyl(M, dx, dy, 4.6, 13.6, 14.2, col, n=14)
    revolve(M, dx, dy, [(4.4, 14.2), (4.2, 15.5), (3.6, 16.8), (2.6, 17.8), (1.3, 18.4), (0, 18.6)],
            P["dome"], n=14)
    cyl(M, dx, dy, 0.7, 18.4, 19.6, col, n=8)
    cone(M, dx, dy, 0.85, 19.6, 20.6, P["dome"], n=8)
    # two wings framing the quad, linked to the hall
    for s in (-1, 1):
        a0, a1 = (-33.5, -19.0) if s < 0 else (19.0, 33.5)
        wy0, wy1 = L.y0 + 2.0, L.y1
        for k in range(2):
            band(M, a0, a1, wy0, wy1, k * st + 1.2, k * st + 2.7, glass)
        box(M, a0, a1, wy0, wy1, 0, 7.6, wall)
        gable(M, a0, a1, wy0, wy1, 7.6, 10.4, "y", roof, wall)
        b0, b1 = (a1, hx0) if s < 0 else (hx1, a0)
        flat_block(M, b0, b1, hy0 + 1.5, hy1 - 1.5, 6.6, wall, roof)
        ex = a1 if s < 0 else a0
        box(M, ex - 0.06 if s > 0 else ex, ex + 0.06 if s < 0 else ex, -6.0, -2.0, 0.3, 2.8, glass)
    # quad: lawn, paths (axis, cross, diagonals), a round plaza with a fountain, trees
    qx0, qx1, qy0, qy1 = -19.0, 19.0, L.y0, hy0
    z0, z1, z2 = PAD_H, PAD_H + 0.03, PAD_H + 0.05
    box(M, qx0, qx1, qy0, py0, z0, z1, P["grass"])
    pm = P["path"]
    yp = L.yf + PARK_DEPTH
    box(M, -1.6, 1.6, yp, py0, z1, z2, pm)
    box(M, qx0, qx1, -5.6, -2.4, z1, z2, pm)
    for a, b in (((qx0 + 1.0, qy0 + 1.0), (qx1 - 1.0, py0 - 1.0)), ((qx1 - 1.0, qy0 + 1.0), (qx0 + 1.0, py0 - 1.0))):
        bar(M, a, b, 1.6, z1, z2 - 0.005, pm)
    cyl(M, 0.0, -4.0, 5.2, z1, z2 + 0.005, pm, n=18)
    fountain(M, P, 0.0, -4.0, 2.4)
    for tx, ty, k in ((-9.0, -14.0, 0), (9.0, -14.0, 1), (-9.0, 7.0, 1), (9.0, 7.0, 0),
                      (-15.5, -4.0, 0), (15.5, -4.0, 1)):
        tree(M, P, tx, ty, 1.0, alt=bool(k))
    return L


def b_park(M, P):
    L = green_lot(M, P, 24, 24)
    z0, z1, pm = PAD_H, PAD_H + 0.03, P["path"]
    cx, cy, rr = 0.0, 1.0, 5.0
    ring = [(cx + rr * math.cos(2 * math.pi * i / 16), cy + rr * math.sin(2 * math.pi * i / 16)) for i in range(16)]
    ribbon(M, ring, 1.6, z0, z1, pm, closed=True)
    ribbon(M, [(0.0, -12.0), (0.0, cy - rr + 0.3)], 1.8, z0, z1, pm)
    # spurs end on a segment square to the lot edge so they stay inside the footprint
    ribbon(M, [(-3.3, 4.6), (-5.4, 6.6), (-8.0, 7.6), (-10.2, 7.8), (-12.0, 7.8)], 1.5, z0, z1, pm)
    ribbon(M, [(4.0, -1.8), (6.4, -3.4), (9.0, -4.4), (10.2, -4.6), (12.0, -4.6)], 1.5, z0, z1, pm)
    ribbon(M, [(1.4, 5.6), (2.4, 8.4), (3.7, 10.2), (4.4, 10.9), (4.4, 12.0)], 1.5, z0, z1, pm)
    fountain(M, P, cx, cy, 2.3)
    for a in (40, 150, 200, 240):
        t = math.radians(a)
        bench(M, P, cx + 6.3 * math.cos(t), cy + 6.3 * math.sin(t), t + math.pi / 2)
    for hx0, hx1 in ((-11.6, -1.5), (1.5, 11.6)):
        box(M, hx0, hx1, -11.6, -10.8, z0, 0.9, P["leaf2"], bevel=0.08)
    for x, y, s, k in ((-7.8, -6.6, 1.0, 0), (7.6, -8.4, 0.9, 1), (-8.4, 1.0, 0.85, 1), (8.4, 6.4, 1.0, 0),
                       (-6.6, 9.8, 0.9, 0), (9.4, 1.6, 0.7, 1)):
        tree(M, P, x, y, s, alt=bool(k))
    return L


def b_parklarge(M, P):
    L = green_lot(M, P, 48, 48)
    z0, z1, pm = PAD_H, PAD_H + 0.03, P["path"]
    # pond with a sandy rim and a little jetty
    px, py = -7.0, 6.5
    def pond(grow):
        out = []
        for i in range(20):
            a = 2 * math.pi * i / 20
            rr = 7.6 + 1.4 * math.sin(2 * a + 0.6) + 0.9 * math.cos(3 * a) + grow
            out.append((px + rr * math.cos(a), py + 0.72 * rr * math.sin(a)))
        return out
    poly_prism(M, pond(1.0), z0, z0 + 0.03, P["sand"])
    poly_prism(M, pond(0.0), z0, z0 + 0.05, P["water"])
    box(M, -1.4, 2.6, 4.3, 5.5, 0.2, 0.35, P["wood"])
    # loop path, entrance from the road, spurs to the other three edges, path to the pavilion
    R = 17.5
    loop = [(R * math.cos(2 * math.pi * i / 24), R * 0.95 * math.sin(2 * math.pi * i / 24)) for i in range(24)]
    ribbon(M, loop, 2.0, z0, z1, pm, closed=True)
    ribbon(M, [(0.0, -24.0), (0.0, -R * 0.95 + 0.4)], 2.4, z0, z1, pm)
    ribbon(M, [(R - 0.4, 1.0), (20.5, 2.6), (22.0, 3.0), (24.0, 3.0)], 1.8, z0, z1, pm)
    ribbon(M, [(-R + 0.4, -4.0), (-20.5, -5.6), (-22.0, -6.0), (-24.0, -6.0)], 1.8, z0, z1, pm)
    ribbon(M, [(-4.0, R * 0.95 - 0.6), (-4.6, 20.5), (-4.8, 22.0), (-4.8, 24.0)], 1.8, z0, z1, pm)
    ribbon(M, [(1.0, -R * 0.95 + 0.8), (3.0, -10.0), (6.0, -3.0), (8.8, 4.2)], 1.6, z0, z1, pm)
    # hexagonal pavilion
    vx, vy = 9.6, 7.6
    cyl(M, vx, vy, 3.4, z0, 0.35, P["stone"], n=6)
    for x, y, _ in ngon(vx, vy, 2.9, 6, 0):
        box(M, x - 0.14, x + 0.14, y - 0.14, y + 0.14, 0.35, 2.9, P["column"])
    M.loft(ngon(vx, vy, 3.8, 6, 2.9), ngon(vx, vy, 3.8, 6, 3.1), P["pav_roof"])
    M.cone(ngon(vx, vy, 3.8, 6, 3.1), (vx, vy, 4.9), P["pav_roof"])
    # benches along the loop and by the pond
    for a in (-60, -120, 20, 160, 205):
        t = math.radians(a)
        bench(M, P, (R + 1.9) * math.cos(t), (R * 0.95 + 1.9) * math.sin(t), t + math.pi / 2)
    bench(M, P, 2.2, 0.0, 0.0)
    # trees round the edge and inside the loop
    trees = [(-20.5, -20.0), (-11.0, -21.2), (11.0, -21.2), (20.5, -20.0), (21.3, -10.5), (21.4, 12.5),
             (20.0, 20.5), (11.0, 21.4), (-13.0, 21.2), (-20.5, 20.0), (-21.3, 11.0), (-21.4, -14.0),
             (-9.5, -9.0), (10.5, -9.5), (13.0, -1.0), (-13.0, -3.0), (-1.0, 13.6)]
    for i, (x, y) in enumerate(trees):
        tree(M, P, x, y, 0.85 + 0.25 * ((i * 7) % 5) / 4, alt=bool(i % 2))
    return L


def b_busstop(M, P):
    """Kerbside bus shelter, 4.4 x 1.8: open to the road (-Y), a glass back, a cantilevered roof, a bench, and a
    pole at the leading end carrying the stop sign."""
    L = Lot(4.4, 1.8)
    L.bays = []
    # paving slab the shelter stands on (the footpath edge)
    box(M, -2.2, 2.2, -0.9, 0.9, 0, PAD_H, P["stone"])
    # back frame: two posts and the glass panel between them
    for x in (-1.75, 1.75):
        box(M, x - 0.07, x + 0.07, 0.5, 0.64, PAD_H, 2.45, P["bs_frame"])
    box(M, -1.68, 1.68, 0.54, 0.6, 0.25, 2.3, P["bs_glass"])
    # roof: a thin slab reaching out over the waiting area
    box(M, -1.95, 1.95, -0.55, 0.8, 2.45, 2.6, P["bs_roof"])
    # bench against the glass
    box(M, -1.3, 1.3, 0.2, 0.5, 0.42, 0.5, P["wood"])
    for x in (-1.1, 1.1):
        box(M, x - 0.05, x + 0.05, 0.3, 0.42, PAD_H, 0.42, P["bs_frame"])
    # sign pole at the leading end, with the square stop sign facing the traffic
    cyl(M, -2.05, -0.7, 0.06, PAD_H, 2.9, P["bs_frame"], n=6)
    box(M, -2.11, -1.99, -0.98, -0.42, 2.4, 2.95, P["bs_sign"])
    box(M, -2.125, -1.975, -0.9, -0.5, 2.62, 2.78, P["line"])
    return L


# ------------------------------------------------------------------ utility buildings

def flat_prism(M, pts, y0, y1, m):
    """Prism over a polygon in the XZ plane (pts = (x, z)), from y0 to y1: blades, fins."""
    fs = M.loft([(x, y0, z) for x, z in pts], [(x, y1, z) for x, z in pts], m)
    bmesh.ops.recalc_face_normals(M.bm, faces=fs)
    return fs


def pipe_y(M, cx, cz, r, y0, y1, m, n=8):
    """Horizontal pipe along Y."""
    prof = [(cx + r * math.cos(2 * math.pi * i / n + math.pi / n), cz + r * math.sin(2 * math.pi * i / n + math.pi / n))
            for i in range(n)]
    fs = extrude_profile(M, prof, "y", y0, y1, m)
    bmesh.ops.recalc_face_normals(M.bm, faces=fs)
    return fs


def pipe_x(M, cy, cz, r, x0, x1, m, n=8):
    """Horizontal pipe along X."""
    prof = [(cy + r * math.cos(2 * math.pi * i / n + math.pi / n), cz + r * math.sin(2 * math.pi * i / n + math.pi / n))
            for i in range(n)]
    fs = extrude_profile(M, prof, "x", x0, x1, m)
    bmesh.ops.recalc_face_normals(M.bm, faces=fs)
    return fs


def b_windturbine(M, P):
    """One turbine on a grass lot: gravel track from the road to a round crane pad, a white tower, the nacelle
    looking at the road and three blades (the rotor stays inside the 16 m lot)."""
    L = green_lot(M, P, 16, 16)
    z0 = PAD_H
    tx, ty = 0.0, 2.2
    cyl(M, tx, ty, 3.6, z0, z0 + 0.04, P["gravel"], n=16)
    box(M, -1.4, 1.4, -8.0, ty - 3.3, z0, z0 + 0.04, P["gravel"])
    box(M, 2.6, 4.4, ty - 0.9, ty + 0.9, z0, 1.9, P["tb_grey"], bevel=0.05)     # transformer
    hub = 24.0
    revolve(M, tx, ty, [(1.25, z0), (0.95, hub * 0.5), (0.68, hub - 0.4), (0.0, hub - 0.4)], P["tb_white"], n=12)
    # nacelle along Y, hub cone pointing at the road (-Y)
    box(M, tx - 0.85, tx + 0.85, ty - 1.4, ty + 3.4, hub - 0.4, hub + 1.5, P["tb_white"], bevel=0.12)
    box(M, tx - 0.86, tx + 0.86, ty + 2.6, ty + 3.41, hub - 0.4, hub + 1.5, P["tb_grey"])
    yh = ty - 1.4
    hz = hub + 0.55
    M.cone([(tx + 0.75 * math.cos(2 * math.pi * i / 10), yh, hz + 0.75 * math.sin(2 * math.pi * i / 10))
            for i in range(10)], (tx, yh - 1.5, hz), P["tb_white"])
    for k in range(3):
        a = math.radians(90 + 120 * k + 8)
        u = (math.cos(a), math.sin(a))
        v = (-u[1], u[0])
        r0, r1 = 0.6, 7.4
        pts = [(tx + u[0] * r0 + v[0] * 0.55, hz + u[1] * r0 + v[1] * 0.55),
               (tx + u[0] * 2.2 + v[0] * 0.75, hz + u[1] * 2.2 + v[1] * 0.75),
               (tx + u[0] * r1 + v[0] * 0.16, hz + u[1] * r1 + v[1] * 0.16),
               (tx + u[0] * r1 - v[0] * 0.05, hz + u[1] * r1 - v[1] * 0.05),
               (tx + u[0] * r0 - v[0] * 0.3, hz + u[1] * r0 - v[1] * 0.3)]
        flat_prism(M, pts, yh - 0.55, yh - 0.25, P["tb_white"])
    L.bays = []
    return L


def b_coalplant(M, P):
    """Coal power station: turbine hall and tall boiler house, a red and white chimney, a coal yard with its
    conveyor, a hyperbolic cooling tower and a switchyard at the front."""
    L = lot(M, P, 64, 52, bay_row(6, -19.0))
    wall, roof, red, white = P["cp_wall"], P["cp_roof"], P["cp_red"], P["cp_white"]
    y0 = L.y0
    # turbine hall (long, low) in front of the boiler house
    band(M, -30.0, 0.0, y0, y0 + 11.0, 9.6, 10.4, red)
    top = flat_block(M, -30.0, 0.0, y0, y0 + 11.0, 12.0, wall, roof)
    ribs(M, -29.0, -1.0, y0 + 1.0, y0 + 10.0, top, P["cp_inside"], 6, along="y", wd=0.5, h=0.2)
    box(M, -24.0, -18.0, y0 - 0.08, y0, 0, 7.0, P["ind_dark"])
    # boiler house: the tall block, with a lighter band near the top
    by0, by1 = y0 + 11.0, y0 + 26.0
    band(M, -27.0, -6.0, by0, by1, 22.0, 24.0, white)
    btop = flat_block(M, -27.0, -6.0, by0, by1, 27.0, wall, roof, parapet=white)
    ac_unit(M, -22.0, by0 + 3.0, btop, P)
    ac_unit(M, -18.5, by0 + 3.0, btop, P)
    # chimney behind the boiler house
    cx, cy = -10.0, L.y1 - 5.0
    cyl(M, cx, cy, 3.4, PAD_H, 1.2, P["concrete"], n=14)
    rad = lambda z: 2.5 - 0.95 * z / 62.0
    for za, zb, m in ((1.2, 50.0, white), (50.0, 54.0, red), (54.0, 58.0, white), (58.0, 62.0, red)):
        revolve(M, cx, cy, [(rad(za), za), (rad(zb), zb)], m, n=14)
    cyl(M, cx, cy, rad(62.0) - 0.35, 62.0, 62.08, P["coal"], n=12)
    # coal yard at the back left: concrete bunker walls round a dark pile, a conveyor up to the boiler house
    kx0, kx1, ky0, ky1 = -30.5, -15.0, by1 + 0.8, L.y1 + 0.5
    box(M, kx0, kx1, ky0, ky1, PAD_H, PAD_H + 0.04, P["concrete"])
    frame(M, kx0, kx1, ky0, ky1, 0, 1.6, 0.4, P["concrete"])
    taper(M, (kx0 + 1.0, kx1 - 1.0, ky0 + 1.0, ky1 - 1.0), (kx0 + 4.0, kx1 - 5.0, ky0 + 2.6, ky1 - 2.6), 0, 4.2, P["coal"])
    box(M, -14.6, -12.8, by1 - 1.0, ky0 + 4.0, 15.0, 16.4, P["cp_inside"], bevel=0.05)
    for yy in (by1 + 1.0, ky0 + 3.0):
        box(M, -14.0, -13.4, yy, yy + 0.6, 0, 15.0, P["ind_steel"])
    # cooling tower on the right: a hyperboloid with the dark water showing at the top
    tx, ty = 19.0, L.y1 - 11.5
    revolve(M, tx, ty, [(10.6, 0.0), (9.6, 4.0), (8.0, 12.0), (7.1, 19.0), (7.0, 22.0), (7.4, 26.0)], P["cp_tower"], n=24)
    cyl(M, tx, ty, 6.9, 26.0, 26.08, P["cp_inside"], n=24)
    cyl(M, tx, ty, 10.7, 0, 0.9, P["concrete"], n=24)
    pipe_x(M, ty - 3.0, 1.2, 0.8, -6.0, tx - 9.6, P["ind_steel"])
    # switchyard at the front right: gravel, transformers and two gantries
    sx0, sx1, sy0, sy1 = 2.0, 30.5, y0 - 1.0, y0 + 9.0
    box(M, sx0, sx1, sy0, sy1, PAD_H, PAD_H + 0.04, P["gravel"])
    frame(M, sx0, sx1, sy0, sy1, 0, 2.0, 0.15, P["gb_fence"])
    for gx in (6.0, 14.0, 22.0):
        box(M, gx - 1.4, gx + 1.4, sy0 + 2.0, sy0 + 4.6, PAD_H, 2.6, P["ind_dark"], bevel=0.06)
        box(M, gx - 1.5, gx + 1.5, sy0 + 2.4, sy0 + 4.2, 2.6, 3.1, P["tb_grey"])
    for gy in (sy0 + 6.4, sy1 - 0.8):
        for gx in (4.0, 12.0, 20.0, 28.0):
            box(M, gx - 0.2, gx + 0.2, gy - 0.2, gy + 0.2, 0, 8.6, P["ind_steel"])
        box(M, 3.8, 28.2, gy - 0.25, gy + 0.25, 8.6, 9.2, P["ind_steel"])
    return L


def b_solarfarm(M, P):
    """Rows of tilted panels on grass, facing the road, with an inverter house and a small car park."""
    w, d = 60, 44
    L = lot(M, P, w, d, bay_row(2, -25.0), asphalt=(-30.0, -18.0))
    z0 = PAD_H + 0.02
    box(M, -w / 2, w / 2, L.yf + PARK_DEPTH, d / 2, PAD_H, z0, P["grass"])
    box(M, -17.5, w / 2, L.yf, L.yf + PARK_DEPTH, PAD_H, z0, P["grass"])
    # gravel service track along the front and up the middle
    box(M, -29.0, 29.0, L.yf + PARK_DEPTH, L.yf + PARK_DEPTH + 2.6, z0, z0 + 0.03, P["gravel"])
    box(M, -1.3, 1.3, L.yf + PARK_DEPTH + 2.6, d / 2 - 1.0, z0, z0 + 0.03, P["gravel"])
    # inverter house beside the car park
    flat_block(M, -16.5, -10.5, L.yf + 0.8, L.yf + 5.2, 3.0, P["wp_wall"], P["solar_leg"])
    box(M, -9.5, -7.3, L.yf + 1.4, L.yf + 3.4, PAD_H, 2.2, P["tb_grey"], bevel=0.05)
    ys = L.yf + PARK_DEPTH + 4.4
    while ys + 2.6 < d / 2 - 1.2:
        for xa, xb in ((-28.8, -2.4), (2.4, 28.8)):
            pa, pb = ys, ys + 2.6
            lo = [(xa, pa, 0.75), (xb, pa, 0.75), (xb, pb, 1.95), (xa, pb, 1.95)]
            M.loft(lo, [(x, y, z + 0.1) for x, y, z in lo], P["solar"])
            # a light line along the table (the gap between its two rows of panels)
            k = 0.47
            za = 0.75 + 1.2 * k + 0.1
            q = [(xa, pa + 2.6 * k, za), (xb, pa + 2.6 * k, za), (xb, pa + 2.6 * (k + 0.06), za + 0.072),
                 (xa, pa + 2.6 * (k + 0.06), za + 0.072)]
            M.loft(q, [(x, y, z + 0.02) for x, y, z in q], P["solar_line"])
            for lx in (xa + 1.0, (xa + xb) / 2, xb - 1.0):
                box(M, lx - 0.1, lx + 0.1, pa + 1.2, pa + 1.4, z0, 1.3, P["solar_leg"])
        ys += 4.6
    return L


def b_waterpump(M, P):
    """Pumping station: a white pump house with a blue roof, a round clear-water tank and the blue intake pipes
    running out the back to the water."""
    L = lot(M, P, 22, 20, bay_row(2, -6.0))
    y0 = L.y0
    band(M, -10.0, 1.5, y0, y0 + 8.0, 3.4, 3.9, P["wp_pipe"])
    box(M, -10.0, 1.5, y0, y0 + 8.0, 0, 5.0, P["wp_wall"])
    gable(M, -10.0, 1.5, y0, y0 + 8.0, 5.0, 6.8, "x", P["wp_roof"], P["wp_wall"])
    box(M, -6.0, -3.0, y0 - 0.06, y0, 0, 3.0, P["ind_dark"])
    # clear-water tank
    tx, ty = 6.2, y0 + 4.2
    cyl(M, tx, ty, 3.7, 0, 5.2, P["wp_tank"], n=16)
    cyl(M, tx, ty, 3.75, 4.4, 4.8, P["wp_pipe"], n=16)
    cone(M, tx, ty, 3.75, 5.2, 6.0, P["wp_roof"], n=16)
    # pipes: tank to pump house, and the intakes out of the back of the lot
    pipe_x(M, ty, 1.2, 0.45, 1.5, tx - 3.6, P["wp_pipe"])
    pipe_y(M, -4.0, 0.9, 0.6, y0 + 8.0, 10.0, P["wp_pipe"])
    pipe_y(M, 4.0, 0.9, 0.6, ty + 3.6, 10.0, P["wp_pipe"])
    box(M, -5.4, 5.4, 8.6, 10.0, 0, 1.8, P["concrete"])   # headwall at the shore
    return L


def b_sewageoutlet(M, P):
    """Sewage outlet: a round settling tank with its scraper bridge, a small works building and the outfall pipe
    out the back to the water."""
    L = lot(M, P, 22, 20, bay_row(2, 6.0))
    y0 = L.y0
    cx, cy, r = -3.6, y0 + 6.2, 5.6
    cyl(M, cx, cy, r, 0, 1.4, P["concrete"], n=20)
    cyl(M, cx, cy, r - 0.45, 1.25, 1.42, P["sw_water"], n=20)
    cyl(M, cx, cy, 0.7, 1.42, 2.2, P["concrete"], n=8)
    box(M, cx - 0.4, cx + 0.4, cy - 0.3, cy + r, 2.0, 2.4, P["ind_steel"])
    box(M, cx - 0.5, cx + 0.5, cy + r - 0.6, cy + r + 0.2, 0, 2.4, P["ind_yellow"])
    # works building
    top = flat_block(M, 3.4, 10.0, y0 - 0.5, y0 + 5.5, 4.2, P["sw_wall"], P["sw_roof"], parapet=P["sw_wall"])
    ac_unit(M, 6.7, y0 + 2.5, top, P)
    # pipe from the works into the tank, and the outfall to the shore
    pipe_x(M, y0 + 3.0, 0.8, 0.4, cx + r - 0.2, 3.4, P["sw_pipe"])
    pipe_y(M, 6.0, 0.8, 0.55, y0 + 5.5, 10.0, P["sw_pipe"])
    box(M, 3.6, 8.4, 8.6, 10.0, 0, 1.6, P["concrete"])
    return L


# ------------------------------------------------------------------ landmarks (one of each per city)

def plaza(M, P, L, x0, x1, y0, y1):
    """Paved square over the lot behind the parking strip, with a stone kerb round it."""
    box(M, x0, x1, y0, y1, PAD_H, PAD_H + 0.04, P["lm_paving"])
    frame(M, x0, x1, y0, y1, PAD_H + 0.04, PAD_H + 0.2, 0.35, P["stone"])


def b_townhall(M, P):
    """Town hall: a cream classical block round a courtyard, a columned portico facing the road and a clock
    tower with a green copper dome over the entrance."""
    L = lot(M, P, 40, 36, bay_row(4))
    y0, y1 = L.y0, L.y1
    plaza(M, P, L, -19.0, 19.0, y0 - 0.6, y0 + 3.0)
    # the U-shaped main block (wings left and right, the hall at the back) round a lawn courtyard
    bx0, bx1, by0, by1 = -16.0, 16.0, y0 + 3.0, y1
    for (a0, a1, c0, c1) in ((bx0, bx0 + 9.0, by0, by1), (bx1 - 9.0, bx1, by0, by1), (bx0 + 9.0, bx1 - 9.0, by1 - 7.0, by1)):
        band(M, a0, a1, c0, c1, 3.6, 4.1, P["th_trim"])
        box(M, a0, a1, c0, c1, 0, 7.8, P["th_wall"])
        box(M, a0 - 0.3, a1 + 0.3, c0 - 0.3, c1 + 0.3, 7.8, 8.3, P["th_trim"], bevel=0.08)
        taper(M, (a0 - 0.3, a1 + 0.3, c0 - 0.3, c1 + 0.3), (a0 + 1.6, a1 - 1.6, c0 + 1.6, c1 - 1.6), 8.3, 10.0, P["th_roof"])
    box(M, bx0 + 9.0, bx1 - 9.0, by0, by1 - 7.0, PAD_H, PAD_H + 0.05, P["grass"])
    fountain(M, P, 0.0, (by0 + by1 - 7.0) / 2, 1.8)
    # portico across the front of the courtyard: steps, columns, entablature and a pediment
    px0, px1, py0, py1 = -8.0, 8.0, by0 - 2.6, by0 + 1.6
    for i, s in enumerate((0.0, 0.5, 1.0)):
        box(M, px0 - 1.0 + s, px1 + 1.0 - s, py0 - 1.2 + s, py1, 0, 0.3 * (i + 1), P["stone"])
    for k in range(6):
        cx = px0 + 1.0 + k * (px1 - px0 - 2.0) / 5
        cyl(M, cx, py0 + 0.6, 0.45, 0.9, 7.2, P["column"], n=8)
    box(M, px0, px1, py0, py1, 7.2, 8.2, P["th_trim"])
    gable(M, px0, px1, py0, py1, 8.2, 10.0, "y", P["th_roof"], P["th_wall"], oh_u=(0.3, 0.3), oh_a=(0.3, 0.0))
    box(M, px0, px1, py1, by0 + 2.0, 0, 8.2, P["th_wall"])
    # clock tower and dome rising behind the portico
    tx, ty = 0.0, by1 - 3.5
    box(M, tx - 3.0, tx + 3.0, ty - 3.0, ty + 3.0, 0, 15.0, P["th_wall"])
    box(M, tx - 3.3, tx + 3.3, ty - 3.3, ty + 3.3, 15.0, 15.6, P["th_trim"])
    cyl(M, tx, ty, 2.6, 15.6, 18.0, P["th_wall"], n=12)
    box(M, tx - 1.2, tx + 1.2, ty - 3.12, ty - 3.0, 11.0, 13.4, P["lm_clock"])
    box(M, tx - 1.2, tx + 1.2, ty + 3.0, ty + 3.12, 11.0, 13.4, P["lm_clock"])
    revolve(M, tx, ty, [(2.8, 18.0), (2.7, 19.2), (2.3, 20.4), (1.5, 21.4), (0.5, 21.9), (0.0, 22.0)], P["dome"], n=12)
    cyl(M, tx, ty, 0.12, 21.9, 24.0, P["ind_steel"], n=6)
    for x, y in ((-18.0, y0 + 1.0), (18.0, y0 + 1.0)):
        tree(M, P, x, y, 0.8)
    return L


def b_stadium(M, P):
    """Stadium: an oval bowl of red seating round a striped pitch, a pale outer shell and a roof ring
    over the long stands, floodlight masts at the corners."""
    L = lot(M, P, 72, 60, bay_row(8))
    cy = (L.y0 + L.y1) / 2 + 0.5
    plaza(M, P, L, -35.0, 35.0, L.y0 - 0.6, L.y1 + 0.5)
    def oval(rx, ry, z, n=28):
        return [(rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n), z) for i in range(n)]
    def annulus(a, b, z0, z1, m):
        """A hollow ring between two ovals with the same vertex count: one closed block per segment."""
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            pts = [a[i][:2], a[j][:2], b[j][:2], b[i][:2]]
            M.loft([(x, y, z0) for x, y in pts], [(x, y, z1) for x, y in pts], m)
    # outer shell, then seating tiers stepping down to the pitch (each a ring, so the bowl stays open)
    annulus(oval(33.0, 21.0, 0), oval(31.0, 19.0, 0), 0, 9.3, P["st_shell"])
    tiers = [(31.0, 19.0, 8.6), (28.0, 16.6, 6.6), (25.0, 14.2, 4.6), (22.0, 11.8, 2.6), (19.6, 11.0, 0.6)]
    for (rx, ry, z), (qx, qy, _) in zip(tiers, tiers[1:]):
        annulus(oval(rx, ry, 0), oval(qx, qy, 0), 0, z, P["st_seat"] if z > 5 else P["st_seat2"])
    # pitch with mown stripes and white lines
    hx, hy = 16.0, 9.6
    box(M, -hx - 2.6, hx + 2.6, cy - hy - 1.4, cy + hy + 1.4, 0.3, 0.42, P["track"])
    box(M, -hx, hx, cy - hy, cy + hy, 0.42, 0.48, P["pitch"])
    for i in range(8):
        if i % 2:
            x0 = -hx + i * (2 * hx / 8)
            box(M, x0, x0 + 2 * hx / 8, cy - hy, cy + hy, 0.48, 0.5, P["pitch2"])
    w = 0.22
    frame(M, -hx + 0.8, hx - 0.8, cy - hy + 0.8, cy + hy - 0.8, 0.5, 0.53, w, P["line"])
    box(M, -w / 2, w / 2, cy - hy + 0.8, cy + hy - 0.8, 0.5, 0.53, P["line"])
    ribbon(M, [(3.0 * math.cos(2 * math.pi * i / 16), cy + 3.0 * math.sin(2 * math.pi * i / 16)) for i in range(16)],
           w, 0.5, 0.53, P["line"], closed=True)
    # roof canopies over the two long stands
    for s in (-1, 1):
        pts = [(x, cy + s * (21.0 - 0.2), 9.3) for x in (-24.0, -12.0, 0.0, 12.0, 24.0)]
        inner = [(x, cy + s * (14.5 + 1.6 * (1 - (x / 24.0) ** 2)), 10.4) for x in (-24.0, -12.0, 0.0, 12.0, 24.0)]
        bm_pts = pts + inner[::-1]
        lo = [(x, y, z) for x, y, z in bm_pts]
        hi = [(x, y, z + 0.35) for x, y, z in bm_pts]
        M.loft(lo, hi, P["st_roof"])
    # floodlight masts on the diagonals
    for sx in (-1, 1):
        for sy in (-1, 1):
            mx, my = sx * 30.5, cy + sy * 22.5
            cyl(M, mx, my, 0.35, 0, 16.0, P["ind_steel"], n=6)
            box(M, mx - 1.4, mx + 1.4, my - 0.4, my + 0.4, 15.2, 16.8, P["lm_lamp"])
    return L


def b_obstower(M, P):
    """Observation tower: a round podium, a tapering concrete shaft, a glazed viewing pod two thirds of the way
    up and a red-and-white mast on top."""
    L = lot(M, P, 28, 28, bay_row(2))
    cx, cy = 0.0, (L.y0 + L.y1) / 2 + 0.5
    plaza(M, P, L, -13.0, 13.0, L.y0 - 0.6, L.y1 + 0.5)
    cyl(M, cx, cy, 8.0, 0, 0.5, P["stone"], n=20)
    cyl(M, cx, cy, 6.6, 0.5, 4.5, P["lm_glass"], n=20)
    cyl(M, cx, cy, 7.0, 4.5, 5.0, P["obs_concrete"], n=20)
    # three-legged base flaring into the shaft
    for k in range(3):
        t = math.radians(90 + 120 * k)
        bar(M, (cx + 2.0 * math.cos(t), cy + 2.0 * math.sin(t)), (cx + 5.6 * math.cos(t), cy + 5.6 * math.sin(t)), 1.4, 5.0, 9.0, P["obs_concrete"])
    revolve(M, cx, cy, [(2.6, 5.0), (2.2, 20.0), (1.8, 40.0), (1.6, 46.0)], P["obs_concrete"], n=12)
    # viewing pod: a fat disc with a glass band and a restaurant deck above
    revolve(M, cx, cy, [(1.6, 46.0), (5.6, 47.4), (6.4, 48.6)], P["obs_concrete"], n=16)
    cyl(M, cx, cy, 6.4, 48.6, 51.2, P["lm_glass"], n=16)
    revolve(M, cx, cy, [(6.6, 51.2), (6.6, 51.7), (5.0, 52.8), (3.4, 53.4), (1.4, 53.6)], P["obs_white"], n=16)
    cyl(M, cx, cy, 1.4, 53.6, 57.0, P["obs_concrete"], n=10)
    cyl(M, cx, cy, 2.2, 57.0, 57.6, P["obs_white"], n=10)
    for i in range(5):
        z = 57.6 + i * 2.4
        cyl(M, cx, cy, 0.55 - i * 0.07, z, z + 2.4, P["cp_red"] if i % 2 == 0 else P["cp_white"], n=8)
    for x, y in ((-11.0, L.y1 - 1.5), (11.0, L.y1 - 1.5), (-11.0, L.y0 + 1.0), (11.0, L.y0 + 1.0)):
        tree(M, P, x, y, 0.75)
    return L


def b_concerthall(M, P):
    """Concert hall: white curved roof shells rising toward the road over a glass foyer, on a stone podium
    with broad steps down to the street."""
    L = lot(M, P, 52, 44, bay_row(6))
    y0, y1 = L.y0, L.y1
    plaza(M, P, L, -25.0, 25.0, y0 - 0.6, y1 + 0.5)
    box(M, -20.0, 20.0, y0 + 3.0, y1 - 1.0, 0, 2.2, P["stone"])
    for i in range(4):
        box(M, -12.0 + i * 0.6, 12.0 - i * 0.6, y0 + 0.2 + i * 0.7, y0 + 3.0, 0, 0.55 * (i + 1), P["stone"])
    # glass foyer under the shells
    box(M, -17.0, 17.0, y0 + 5.0, y1 - 3.0, 2.2, 7.0, P["lm_glass"])
    # three shells per side, nested, each a quarter-ellipse profile swept across the hall
    def shell(xc, half, ya, yb, h, m):
        prof = []
        n = 10
        for i in range(n + 1):
            t = i / n
            prof.append((ya + (yb - ya) * t, 2.2 + h * (1 - t * t)))
        top = [(y, z) for y, z in prof]
        under = [(y, max(2.2, z - 0.7)) for y, z in prof][::-1]
        # each shell narrows toward the back, like a sail
        def hw(y):
            return half * (1.0 - 0.45 * (y - ya) / (yb - ya))
        lo = [(xc - hw(y), y, z) for y, z in top + under]
        hi = [(xc + hw(y), y, z) for y, z in top + under]
        M.loft(lo, hi, m)
    shell(-9.0, 8.0, y0 + 4.0, y1 - 8.0, 13.0, P["ch_shell"])
    shell(9.0, 8.0, y0 + 4.0, y1 - 8.0, 13.0, P["ch_shell"])
    shell(-8.0, 6.5, y0 + 13.0, y1 - 2.5, 9.5, P["ch_shell2"])
    shell(8.0, 6.5, y0 + 13.0, y1 - 2.5, 9.5, P["ch_shell2"])
    shell(0.0, 2.6, y0 + 7.0, y1 - 4.0, 11.0, P["ch_shell"])
    for x in (-23.0, 23.0):
        for y in (y0 + 1.0, (y0 + y1) / 2, y1 - 1.0):
            tree(M, P, x, y, 0.8)
    return L


def b_skytower(M, P):
    """Skyline tower: a glass supertall in four setbacks with pale fins at the corners, a crown and a spire."""
    L = lot(M, P, 36, 36, bay_row(4))
    cx, cy = 0.0, (L.y0 + L.y1) / 2 + 0.5
    plaza(M, P, L, -17.0, 17.0, L.y0 - 0.6, L.y1 + 0.5)
    box(M, cx - 13.0, cx + 13.0, cy - 11.0, cy + 11.0, 0, 6.0, P["sky_base"])
    steps = [(10.5, 6.0, 40.0), (8.8, 40.0, 70.0), (7.0, 70.0, 95.0), (5.0, 95.0, 112.0)]
    for r, z0, z1 in steps:
        box(M, cx - r, cx + r, cy - r, cy + r, z0, z1, P["sky_glass"])
        box(M, cx - r - 0.3, cx + r + 0.3, cy - r - 0.3, cy + r + 0.3, z1, z1 + 0.6, P["sky_roof"])
        frame(M, cx - r - 0.3, cx + r + 0.3, cy - r - 0.3, cy + r + 0.3, z1 + 0.6, z1 + 1.1, 0.5, P["sky_fin"])
        for sx in (-1, 1):
            for sy in (-1, 1):
                box(M, cx + sx * r - 0.6, cx + sx * r + 0.6, cy + sy * r - 0.6, cy + sy * r + 0.6, z0, z1, P["sky_fin"])
        for k in range(1, 4):
            z = z0 + (z1 - z0) * k / 4
            band(M, cx - r, cx + r, cy - r, cy + r, z, z + 0.35, P["sky_fin"], o=0.05)
    revolve(M, cx, cy, [(5.0, 112.6), (3.6, 116.0), (1.2, 118.0), (0.0, 118.4)], P["sky_fin"], n=4, rot=math.pi / 4)
    cyl(M, cx, cy, 0.3, 118.0, 132.0, P["ind_steel"], n=6)
    for x, y in ((-15.5, L.y0 + 0.8), (15.5, L.y0 + 0.8), (-15.5, L.y1 - 0.8), (15.5, L.y1 - 0.8)):
        tree(M, P, x, y, 0.8)
    return L


# ------------------------------------------------------------------ timber industry

def log(M, axis, a0, a1, cu, cz, r, bark, end, t=0.55, n=5, chamfer=True):
    """One felled log lying along `axis` from a0 to a1, centred at (cu, cz) across it. Five-sided with a vertex on
    top (so the two top facets shade apart) and a flat underside 0.81 r below the centre. Both ends chamfer down
    to a pale cut face that shows from above; chamfer=False gives a plain prism with pale end caps."""
    bm, ib, ie = M.bm, M.mi(bark), M.mi(end)

    def ring(a, rr):
        out = []
        for i in range(n):
            ang = math.pi / 2 + 2 * math.pi * i / n
            u, z = cu + rr * math.cos(ang), cz + rr * math.sin(ang)
            out.append(bm.verts.new((a, u, z) if axis == "x" else (u, a, z)))
        return out

    if chamfer:
        rings = [ring(a0, r * 0.66), ring(a0 + t, r), ring(a1 - t, r), ring(a1, r * 0.66)]
    else:
        rings = [ring(a0, r), ring(a1, r)]
    fs = [bm.faces.new(rings[0][::-1]), bm.faces.new(rings[-1])]
    for f in fs:
        f.material_index = ie
    for k, (A, B) in enumerate(zip(rings, rings[1:])):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            f.material_index = ib if k == 1 or not chamfer else ie
            fs.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=fs)


def log_stack(M, P, axis, a0, a1, cu, z0, r, layers, seed=0):
    """Pyramid of logs along `axis`: layers = logs per layer, bottom first, centred on cu across the axis.
    Lengths and ends are nudged per log so the ends don't line up like a block."""
    step, k = 1.95 * r, seed
    for li, nl in enumerate(layers):
        cz = z0 + 0.81 * r + li * 1.45 * r
        for i in range(nl):
            u = cu + (i - (nl - 1) / 2) * step
            k += 1
            j0, j1 = ((k * 37) % 7) / 7 * 0.6, ((k * 53) % 5) / 5 * 0.6
            log(M, axis, a0 + j0, a1 - j1, u, cz, r, P["log_bark" if (i + li) % 2 == 0 else "log_bark2"],
                P["log_end"])


def conifer(M, P, x, y, s=1.0, alt=False):
    """Pine: two stacked six-sided cones, the upper one turned half a step, so it reads as a dark star from above."""
    m, rot = P["pine2" if alt else "pine"], (x * 0.37 + y * 0.61) % 1.0
    revolve(M, x, y, [(2.3 * s, PAD_H + 0.3), (0, 6.2 * s)], m, n=6, rot=rot)
    revolve(M, x, y, [(1.6 * s, 4.4 * s), (0, 8.8 * s)], m, n=6, rot=rot + math.pi / 6)


def gable2(M, x0, x1, y0, y1, ze, zr, roof_a, roof_b, wall, ridge=None, oh=0.5, th=0.25):
    """Pitched roof with its ridge along X: the front (-Y) plane in roof_a, the back plane in roof_b, gable wall
    triangles in `wall`, and an optional raised ridge strip."""
    ym = (y0 + y1) / 2
    s = (zr - ze) / ((y1 - y0) / 2)
    zo = ze - s * oh
    extrude_profile(M, [(y0 - oh, zo), (ym, zr), (ym, zr - th), (y0 - oh, zo - th)], "x", x0 - oh, x1 + oh, roof_a)
    extrude_profile(M, [(ym, zr), (y1 + oh, zo), (y1 + oh, zo - th), (ym, zr - th)], "x", x0 - oh, x1 + oh, roof_b)
    extrude_profile(M, [(y0, ze), (y1, ze), (ym, zr - th - 0.02)], "x", x0, x1, wall)
    if ridge is not None:
        box(M, x0 - oh + 0.3, x1 + oh - 0.3, ym - 0.7, ym + 0.7, zr - 0.15, zr + 0.35, ridge)


def b_loggingcamp(M, P):
    """Logging camp at the forest edge: a sandy log yard with three log stacks and a yellow log loader, a timber
    cabin by the car park, an open green-roofed shed, and a row of pines along the back."""
    L = lot(M, P, 36, 32, bay_row(2, -14.0), asphalt=(-18.0, -10.0))
    yp, g = L.yf + PARK_DEPTH, PAD_H + 0.04
    # yard over the lot behind the car park (the pad shows as an edge round it), a drive out to the road
    box(M, -17.4, 17.4, yp, 15.4, PAD_H, g, P["lg_yard"])
    box(M, -9.0, 17.4, L.yf, yp, PAD_H, g, P["lg_yard"])
    # cabin office beside the car park: log walls, a dark band, green gable roof, stove pipe
    cx0, cx1, cy0, cy1 = -17.0, -11.0, yp + 1.0, yp + 5.8
    box(M, cx0, cx1, cy0, cy1, 0, 3.0, P["cabin"])
    band(M, cx0, cx1, cy0, cy1, 1.2, 1.5, P["cabin_dark"], o=0.05)
    gable(M, cx0, cx1, cy0, cy1, 3.0, 4.7, "x", P["lg_roof"], P["cabin"], oh_u=(0.6, 0.6), oh_a=(0.5, 0.5),
          bevel=0.0)
    box(M, -15.0, -13.8, cy0 - 0.06, cy0, 0, 2.2, P["cabin_dark"])
    box(M, -12.6, -12.1, cy1 - 1.6, cy1 - 1.1, 3.6, 5.6, P["ind_dark"])
    # open shed at the back left: six posts, a mono-pitch roof falling to the back with paler ribs
    sx0, sx1, sy0, sy1 = -17.0, -7.5, 1.5, 9.5
    for x in (sx0 + 0.3, (sx0 + sx1) / 2, sx1 - 0.3):
        for y in (sy0 + 0.3, sy1 - 0.3):
            box(M, x - 0.2, x + 0.2, y - 0.2, y + 0.2, 0, 4.4 if y < sy1 - 1 else 3.6, P["ind_dark"])
    zf, zb, th = 4.6, 3.6, 0.22
    lo = [(sx0 - 0.5, sy0 - 0.6, zf), (sx1 + 0.5, sy0 - 0.6, zf), (sx1 + 0.5, sy1 + 0.6, zb),
          (sx0 - 0.5, sy1 + 0.6, zb)]
    M.loft([(x, y, z - th) for x, y, z in lo], lo, P["lg_roof"])
    for i in range(4):
        rx = sx0 + (sx1 - sx0) * (i + 0.5) / 4
        rib = [(rx - 0.35, sy0 - 0.6, zf), (rx + 0.35, sy0 - 0.6, zf), (rx + 0.35, sy1 + 0.6, zb),
               (rx - 0.35, sy1 + 0.6, zb)]
        M.loft(rib, [(x, y, z + 0.12) for x, y, z in rib], P["lg_roof2"])
    # logging truck waiting to unload, nose to the road: red cab, dark chassis, stakes and three logs on the bed
    tx, ty0, ty1 = 6.4, -12.2, 0.4
    box(M, tx - 1.2, tx + 1.2, ty0 + 2.6, ty1, 0.5, 1.2, P["ind_dark"])
    box(M, tx - 1.25, tx + 1.25, ty0, ty0 + 2.6, 0.5, 3.0, P["sm_roof"])
    box(M, tx - 1.1, tx + 1.1, ty0 + 0.1, ty0 + 0.9, 2.2, 3.05, P["ind_dark"])
    for sy in (ty0 + 3.0, ty1 - 0.4):
        box(M, tx - 1.3, tx + 1.3, sy - 0.15, sy + 0.15, 1.2, 3.0, P["ind_dark"])
    for u, z, bk in ((-0.6, 1.2 + 0.45, "log_bark"), (0.6, 1.2 + 0.45, "log_bark2"), (0.0, 1.2 + 1.25, "log_bark")):
        log(M, "y", ty0 + 2.8, ty1 + 0.3, tx + u, z, 0.56, P[bk], P["log_end"], chamfer=False)
    # log stacks: two long ones along X in the middle, one along Y on the right
    log_stack(M, P, "x", -5.5, 5.5, 8.8, g, 0.6, (4, 3, 2), seed=1)
    log_stack(M, P, "x", -5.5, 5.5, 1.8, g, 0.6, (3, 2), seed=5)
    log_stack(M, P, "y", -7.5, 3.5, 12.6, g, 0.6, (4, 3), seed=9)
    # log loader between the stacks: tracks, yellow body and cab, boom reaching over the back stack with a log
    lx, ly = 7.6, 4.6
    box(M, lx - 1.9, lx - 1.1, ly - 2.3, ly + 2.3, g, 1.0, P["ind_dark"])
    box(M, lx + 1.1, lx + 1.9, ly - 2.3, ly + 2.3, g, 1.0, P["ind_dark"])
    box(M, lx - 1.7, lx + 1.7, ly - 1.8, ly + 1.8, 1.0, 2.5, P["ind_yellow"])
    box(M, lx + 0.1, lx + 1.6, ly - 1.7, ly - 0.1, 2.5, 4.2, P["ind_dark"])
    box(M, lx + 0.2, lx + 1.5, ly - 1.6, ly - 0.2, 4.2, 4.45, P["ind_yellow"])
    p, q = Vector((lx - 0.6, ly + 0.4, 2.6)), Vector((lx - 3.8, ly + 4.2, 7.4))
    wd = 0.75
    lo = [(p.x, p.y - wd / 2, p.z), (p.x, p.y + wd / 2, p.z), (q.x, q.y + wd / 2, q.z), (q.x, q.y - wd / 2, q.z)]
    M.loft(lo, [(x, y, z + 0.6) for x, y, z in lo], P["ind_yellow"])
    box(M, q.x - 0.25, q.x + 0.25, q.y - 0.25, q.y + 0.25, 4.95, q.z + 0.6, P["ind_yellow"])
    box(M, q.x - 0.7, q.x + 0.7, q.y - 0.5, q.y + 0.5, 4.55, 4.95, P["ind_dark"])
    log(M, "x", q.x - 3.4, q.x + 3.4, q.y, 4.0, 0.55, P["log_bark2"], P["log_end"])
    # the forest edge along the back
    for i, (x, y, s) in enumerate(((-15.2, 13.6, 1.0), (-10.8, 13.9, 0.85), (-6.4, 13.4, 1.05),
                                   (-1.8, 13.8, 0.9), (2.8, 13.6, 1.0), (7.2, 13.9, 0.85),
                                   (11.4, 13.4, 1.05), (15.4, 13.7, 0.95), (15.7, 9.0, 0.85))):
        conifer(M, P, x, y, s, alt=i % 2 == 1)
    return L


def b_sawmill(M, P):
    """Sawmill: a long saw hall under a rust-red two-tone pitched roof with a pale ridge vent, a log pile and log
    deck on the left feeding it by conveyor, pale plank bundles on the right, a sawdust silo and boiler stack."""
    L = lot(M, P, 40, 34, bay_row(3, 6.0), asphalt=(-9.6, 20.0))
    yp, g = L.yf + PARK_DEPTH, PAD_H + 0.04
    wall, dark = P["ind_wall"], P["ind_dark"]
    # log yard on the left
    box(M, -19.4, -9.6, L.yf, 16.4, PAD_H, g, P["lg_yard"])
    # saw hall, ridge along X
    hx0, hx1, hy0, hy1 = -9.0, 13.0, -3.5, 6.5
    box(M, hx0, hx1, hy0, hy1, 0, 6.0, wall)
    band(M, hx0, hx1, hy0, hy1, 4.6, 5.2, P["sm_roof2"], o=0.05)
    gable2(M, hx0, hx1, hy0, hy1, 6.0, 9.6, P["sm_roof"], P["sm_roof2"], wall, ridge=P["sm_ridge"], oh=0.6)
    box(M, -2.5, 2.5, hy0 - 0.06, hy0, 0, 4.4, dark)
    # office annex at the front, flat roof
    flat_block(M, 4.0, 11.5, L.y0 + 0.2, hy0, 3.6, P["sm_ridge"], P["sm_roof2"], bevel=0.0)
    # log pile at the back left (logs along X)
    log_stack(M, P, "x", -19.0, -10.4, 12.2, g, 0.65, (4, 3), seed=2)
    log_stack(M, P, "x", -19.0, -10.4, 6.4, g, 0.65, (3, 2), seed=7)
    # log deck: steel platform with logs lying across it, rolling toward the infeed conveyor
    dx0, dx1, dy0, dy1 = -19.0, -13.0, -4.2, 2.4
    box(M, dx0, dx1, dy0, dy1, 0, 1.4, dark)
    for i in range(3):
        x = dx0 + 1.2 + i * 1.75
        log(M, "y", dy0 + 0.3, dy1 - 0.3, x, 1.4 + 0.49, 0.6, P["log_bark" if i % 2 else "log_bark2"], P["log_end"])
    # infeed conveyor from the deck up into the hall's gable end, carrying one log
    cy = 0.0
    p, q = Vector((dx1 - 0.2, cy, 1.4)), Vector((hx0 + 0.2, cy, 3.2))
    wd = 1.6
    lo = [(p.x, p.y - wd / 2, p.z), (q.x, q.y - wd / 2, q.z), (q.x, q.y + wd / 2, q.z), (p.x, p.y + wd / 2, p.z)]
    M.loft(lo, [(x, y, z + 0.4) for x, y, z in lo], P["ind_steel"])
    for t in (0.35, 0.75):
        s = p.lerp(q, t)
        box(M, s.x - 0.2, s.x + 0.2, cy - 0.6, cy + 0.6, 0, s.z, dark)
    s = p.lerp(q, 0.5)
    log(M, "x", s.x - 1.6, s.x + 1.6, cy, s.z + 0.8, 0.5, P["log_bark2"], P["log_end"])
    box(M, hx0 - 0.06, hx0, cy - 1.2, cy + 1.2, 2.6, 5.0, dark)
    # sawn timber: plank bundles on the right in two rows, stickers across the tops
    for col, (bx0, bx1) in enumerate(((14.0, 16.6), (17.0, 19.4))):
        for row in range(4):
            by0 = -9.6 + row * 6.3
            by1 = by0 + 5.7
            h = (1.3, 1.8, 1.5, 1.9)[(row + 2 * col) % 4]
            box(M, bx0, bx1, by0, by1, PAD_H, h, P["plank"])
            for sy in (by0 + 0.8, by1 - 0.8):
                box(M, bx0 - 0.05, bx1 + 0.05, sy - 0.18, sy + 0.18, h - 0.1, h + 0.06, P["stick"])
    # sawdust silo behind the hall on four legs, a cyclone on the roof and a duct across to the silo
    tx, ty = 6.0, 12.0
    for ddx in (-1.6, 1.6):
        for ddy in (-1.6, 1.6):
            box(M, tx + ddx - 0.15, tx + ddx + 0.15, ty + ddy - 0.15, ty + ddy + 0.15, 0, 3.4, dark)
    revolve(M, tx, ty, [(0.5, 2.2), (2.5, 3.6), (2.5, 9.6), (0, 11.2)], P["ind_tank"], n=10)
    cyl(M, tx, ty, 2.55, 8.2, 8.8, P["sm_roof"], n=10)
    revolve(M, 6.0, 3.8, [(0.25, 7.7), (1.0, 9.6), (1.0, 11.0), (0.6, 11.5)], P["ind_tank"], n=8)
    pipe_y(M, 6.0, 10.6, 0.35, 4.6, ty - 2.0, P["ind_steel"])
    # boiler stack burning offcuts
    cyl(M, -6.0, 9.4, 0.65, 0, 14.0, P["ind_steel"], n=8)
    cyl(M, -6.0, 9.4, 0.72, 11.6, 12.4, P["sm_roof"], n=8)
    cyl(M, -6.0, 9.4, 0.5, 14.0, 14.06, P["coal"], n=8)
    return L


# ------------------------------------------------------------------ tier 2 industry

def cone_pile(M, cx, cy, r, h, m, rot=0.0):
    """A heap tipped from above: slumped foot, steep flanks, rounded top."""
    revolve(M, cx, cy, [(r, PAD_H), (r * 0.62, h * 0.55), (r * 0.22, h * 0.93), (0.0, h)], m, n=10, rot=rot)


def pile(M, cx, cy, rx, ry, h, m):
    """A long stockpile rx x ry at the foot: a row of overlapping heaps (reads as a heap from above, not a roof)."""
    k = max(1, round(rx / ry))
    r = min(ry * 1.05, rx)
    for i in range(k):
        x = cx if k == 1 else cx - rx + r + i * (2 * (rx - r) / (k - 1))
        cone_pile(M, x, cy, r, h * (0.88 + 0.12 * ((i * 5) % 3) / 2), m, rot=0.4 * i)


def conveyor(M, P, p, q, wd=1.1, legs=(0.35, 0.7)):
    """Inclined belt from p to q (x, y, z), on legs."""
    p, q = Vector(p), Vector(q)
    d = (q - p).to_2d()
    d.normalize()
    n = Vector((-d.y, d.x)) * (wd / 2)
    lo = [(p.x + n.x, p.y + n.y, p.z), (p.x - n.x, p.y - n.y, p.z), (q.x - n.x, q.y - n.y, q.z), (q.x + n.x, q.y + n.y, q.z)]
    M.loft(lo, [(x, y, z + 0.35) for x, y, z in lo], P["ind_steel"])
    for t in legs:
        s = p.lerp(q, t)
        box(M, s.x - 0.2, s.x + 0.2, s.y - 0.2, s.y + 0.2, 0, s.z, P["ind_dark"])


def headframe(M, P, cx, cy, h, m):
    """Pithead winding tower: four splayed steel legs, braced decks, two sheave wheels on top, and a back-stay
    down toward -X (the winding house side)."""
    for dx in (-1.0, 1.0):
        for dy in (-1.0, 1.0):
            taper(M, (cx + dx * 2.2 - 0.25, cx + dx * 2.2 + 0.25, cy + dy * 2.2 - 0.25, cy + dy * 2.2 + 0.25),
                  (cx + dx * 1.1 - 0.2, cx + dx * 1.1 + 0.2, cy + dy * 1.1 - 0.2, cy + dy * 1.1 + 0.2), 0, h, m)
    for z in (h * 0.35, h * 0.7):
        frame(M, cx - 1.9, cx + 1.9, cy - 1.9, cy + 1.9, z, z + 0.3, 0.25, m)
    box(M, cx - 1.6, cx + 1.6, cy - 1.6, cy + 1.6, h, h + 0.4, m)
    for dy in (-0.7, 0.7):
        wheel = [(cx + 1.4 * math.cos(2 * math.pi * i / 10), h + 1.6 + 1.4 * math.sin(2 * math.pi * i / 10)) for i in range(10)]
        M.loft([(x, cy + dy - 0.12, z) for x, z in wheel], [(x, cy + dy + 0.12, z) for x, z in wheel], P["ind_dark"])
    lo = [(cx - 1.4, cy - 0.3, h), (cx - 1.4, cy + 0.3, h), (cx - 8.0, cy + 0.3, 0.0), (cx - 8.0, cy - 0.3, 0.0)]
    M.loft(lo, [(x, y, z + 0.4) for x, y, z in lo], m)


def b_ironmine(M, P):
    """Iron mine: a red-brown steel headframe over the shaft, the winding house beside it, a loadout bin fed by a
    conveyor, and long heaps of rusty ore along the back of the yard."""
    L = lot(M, P, 38, 36, bay_row(3, -11.0), asphalt=(-19.0, -3.0))
    wall, dark, rust = P["ind_wall"], P["ind_dark"], P["rust"]
    g = PAD_H + 0.03
    box(M, -18.6, 18.6, L.yf + PARK_DEPTH, 17.6, PAD_H, g, P["gravel"])
    # winding house with a rust roof and a darker band
    hx0, hx1, hy0, hy1 = -17.5, -8.0, L.y0, L.y0 + 9.0
    box(M, hx0, hx1, hy0, hy1, 0, 6.0, wall)
    band(M, hx0, hx1, hy0, hy1, 4.6, 5.2, P["rust2"], o=0.05)
    gable(M, hx0, hx1, hy0, hy1, 6.0, 8.2, "x", P["ind_roof"], wall, oh_u=(0.5, 0.5), oh_a=(0.4, 0.4))
    box(M, -14.5, -11.0, hy0 - 0.06, hy0, 0, 3.6, dark)
    # the headframe beside it
    headframe(M, P, 1.0, hy0 + 4.5, 17.0, P["rust2"])
    # loadout bin over a truck lane at the right, fed from the shaft top by a belt
    bx, by = 12.0, -6.0
    for dx in (-2.0, 2.0):
        for dy in (-1.6, 1.6):
            box(M, bx + dx - 0.25, bx + dx + 0.25, by + dy - 0.25, by + dy + 0.25, 0, 6.0, dark)
    taper(M, (bx - 0.8, bx + 0.8, by - 0.8, by + 0.8), (bx - 2.6, bx + 2.6, by - 2.2, by + 2.2), 4.5, 7.5, rust, bevel=0.05)
    box(M, bx - 2.65, bx + 2.65, by - 2.25, by + 2.25, 7.5, 9.0, rust, bevel=0.05)
    taper(M, (bx - 2.0, bx + 2.0, by - 1.6, by + 1.6), (bx - 0.7, bx + 0.7, by - 0.5, by + 0.5), 9.0, 9.6, P["ore_pile"])
    conveyor(M, P, (3.0, hy0 + 4.5, 7.0), (bx, by + 2.0, 9.4), wd=1.2)
    # ore heaps along the back, a front-end loader working one
    pile(M, -12.0, 13.2, 6.0, 3.6, 4.2, P["ore_pile"])
    pile(M, 1.5, 13.6, 6.5, 3.3, 3.6, P["ore_pile2"])
    pile(M, 13.5, 12.4, 4.5, 4.4, 4.8, P["ore_pile"])
    lx, ly = 7.0, 6.6
    box(M, lx - 1.2, lx + 1.2, ly - 2.0, ly + 1.6, g, 2.0, P["ind_yellow"], bevel=0.05)
    box(M, lx - 1.0, lx + 1.0, ly - 1.4, ly + 0.2, 2.0, 3.4, dark)
    box(M, lx - 1.6, lx + 1.6, ly + 1.8, ly + 2.6, g, 1.2, dark)
    return L


def b_coalmine(M, P):
    """Coal mine: a tall dark washery with a belt from the pithead up into it, a grey steel headframe, a black
    coal stockpile under a stacker boom, and a truck loadout silo."""
    L = lot(M, P, 38, 36, bay_row(3, -11.0), asphalt=(-19.0, -3.0))
    dark = P["ind_dark"]
    g = PAD_H + 0.03
    box(M, -18.6, 18.6, L.yf + PARK_DEPTH, 17.6, PAD_H, g, P["coal_yard"])
    # washery: tall stepped block, dark cladding with a pale band
    wx0, wx1, wy0, wy1 = -17.5, -5.0, L.y0 + 1.0, L.y0 + 12.0
    top = flat_block(M, wx0, wx1, wy0, wy1, 14.0, P["cm_wall"], P["ind_roof"])
    band(M, wx0, wx1, wy0, wy1, 11.8, 12.6, P["cp_white"], o=0.05)
    box(M, wx0 + 2.0, wx0 + 7.0, wy0 + 3.0, wy1 - 2.0, top, top + 4.0, P["cm_wall"])
    box(M, wx0 + 1.95, wx0 + 7.05, wy0 + 2.95, wy1 - 1.95, top + 4.0, top + 4.25, P["ind_roof"])
    box(M, -12.5, -8.5, wy0 - 0.06, wy0, 0, 5.0, dark)
    # headframe at the back right, a belt from it up into the washery
    headframe(M, P, 10.0, 10.5, 16.0, P["ind_steel"])
    conveyor(M, P, (8.0, 9.0, 6.0), (wx1 + 0.2, wy1 - 3.0, 13.0), wd=1.2)
    # coal stockpile at the back left, a stacker boom over it
    pile(M, -9.0, 14.2, 9.0, 3.0, 4.6, P["coal"])
    bar(M, (-1.5, 12.0), (-12.0, 15.0), 0.7, 5.6, 6.1, P["ind_steel"])
    box(M, -2.1, -0.9, 11.4, 12.6, 0, 5.6, dark)
    # loadout silo on legs over the truck lane, front right
    sx, sy = 11.5, -4.5
    for dx in (-1.8, 1.8):
        for dy in (-1.8, 1.8):
            box(M, sx + dx - 0.2, sx + dx + 0.2, sy + dy - 0.2, sy + dy + 0.2, 0, 5.0, dark)
    revolve(M, sx, sy, [(0.6, 4.2), (2.6, 6.0), (2.6, 12.5), (0.0, 13.2)], P["cm_silo"], n=12)
    cyl(M, sx, sy, 2.65, 10.6, 11.2, P["ind_orange"], n=12)
    conveyor(M, P, (wx1 + 0.2, wy0 + 2.0, 10.0), (sx - 1.0, sy, 13.0), wd=1.0, legs=(0.5,))
    return L


def b_quarry(M, P):
    """Limestone quarry: a pale pit cut in benches (each step a rim standing over the one inside it, so the steps
    shade), a haul ramp, an excavator at the face, a crusher house and a belt out to cone stockpiles."""
    L = lot(M, P, 42, 40, bay_row(3, -12.5), asphalt=(-21.0, -5.0))
    dark = P["ind_dark"]
    yp = L.yf + PARK_DEPTH
    cx, cy = -3.0, 6.0
    for hx, hy, z, m in ((17.0, 12.5, 2.4, P["lime"]), (14.0, 10.0, 1.6, P["lime2"]), (11.0, 7.6, 0.9, P["lime3"])):
        frame(M, cx - hx, cx + hx, cy - hy, cy + hy, 0, z, 2.9, m)
    box(M, cx - 8.1, cx + 8.1, cy - 4.7, cy + 4.7, 0, 0.25, P["lime_floor"])
    # haul ramp from the floor up the front-right benches
    lo = [(cx + 4.0, cy - 4.7, 0.25), (cx + 7.4, cy - 4.7, 0.25), (cx + 7.4, cy - 12.5, 2.4), (cx + 4.0, cy - 12.5, 2.4)]
    M.loft([(x, y, 0.0) for x, y, _ in lo], lo, P["lime2"])
    # excavator on the floor at the face
    ex, ey = cx - 3.5, cy + 1.0
    box(M, ex - 1.6, ex + 1.6, ey - 1.9, ey - 1.2, 0.25, 1.0, dark)
    box(M, ex - 1.6, ex + 1.6, ey + 1.2, ey + 1.9, 0.25, 1.0, dark)
    box(M, ex - 1.4, ex + 1.4, ey - 1.4, ey + 1.4, 1.0, 2.4, P["ind_yellow"], bevel=0.05)
    box(M, ex + 0.2, ex + 1.3, ey - 1.3, ey - 0.1, 2.4, 3.6, dark)
    bar(M, (ex - 0.6, ey), (ex - 4.2, ey + 1.6), 0.6, 2.6, 3.3, P["ind_yellow"])
    # crusher house at the right, a belt to the stockpiles at the front
    kx0, kx1, ky0, ky1 = 15.0, 20.0, 4.0, 12.0
    flat_block(M, kx0, kx1, ky0, ky1, 7.0, P["ind_wall"], P["ind_roof"])
    taper(M, (kx0 + 1.0, kx1 - 1.0, ky1 - 3.0, ky1 - 0.6), (kx0 + 0.2, kx1 - 0.2, ky1 - 3.6, ky1 + 0.4), 7.2, 9.0,
          P["ind_orange"])
    conveyor(M, P, (17.5, ky0 - 0.2, 6.0), (16.5, yp + 4.0, 7.4), wd=1.0, legs=(0.5,))
    cone_pile(M, 16.5, yp + 3.4, 3.4, 6.4, P["lime"])
    cone_pile(M, 9.5, yp + 2.6, 2.4, 4.4, P["lime2"])
    return L


def b_smelter(M, P):
    """Iron smelter: a blast furnace (dark shaft, bustle main, uptakes, the glowing top seen from above) beside
    three domed hot-blast stoves, a long rust-roofed cast house, ore and coal bunkers fed by a belt to the furnace
    top, a tall stack, and slag pots by the cast house."""
    L = lot(M, P, 52, 44, bay_row(5, -13.0))
    wall, dark, rust = P["ind_wall"], P["ind_dark"], P["rust"]
    y0, y1 = L.y0, L.y1
    hx0, hx1, hy0, hy1 = -24.5, 8.0, y0, y0 + 11.0
    box(M, hx0, hx1, hy0, hy1, 0, 9.0, wall)
    band(M, hx0, hx1, hy0, hy1, 7.0, 7.8, P["rust2"], o=0.05)
    gable2(M, hx0, hx1, hy0, hy1, 9.0, 12.4, rust, P["rust2"], wall, ridge=P["sm_ridge"], oh=0.6)
    for x in (-19.0, -9.0, 1.0):
        box(M, x - 2.0, x + 2.0, hy0 - 0.06, hy0, 0, 6.0, dark)
    fx, fy = -6.0, hy1 + 7.5
    cyl(M, fx, fy, 5.6, 0, 3.0, P["concrete"], n=14)
    revolve(M, fx, fy, [(4.4, 3.0), (5.0, 12.0), (4.2, 22.0), (3.0, 26.0)], P["furnace"], n=14)
    cyl(M, fx, fy, 5.3, 12.0, 13.4, P["rust2"], n=14)
    frame(M, fx - 4.0, fx + 4.0, fy - 4.0, fy + 4.0, 26.0, 26.6, 0.5, P["ind_steel"])
    for dx in (-1.6, 1.6):
        cyl(M, fx + dx, fy, 0.7, 26.0, 33.0, P["ind_steel"], n=8)
    box(M, fx - 2.4, fx + 2.4, fy - 0.6, fy + 0.6, 32.6, 33.6, P["ind_steel"])
    cyl(M, fx, fy, 0.8, 26.0, 26.5, P["glow"], n=8)
    for i in range(3):
        sx = -23.5 + i * 4.5
        revolve(M, sx, fy + 2.0, [(2.2, 0.0), (2.2, 19.0), (1.6, 20.6), (0.0, 21.4)], P["stove"], n=12)
        cyl(M, sx, fy + 2.0, 2.25, 15.0, 15.8, P["rust2"], n=12)
    pipe_x(M, fy - 1.0, 14.0, 0.8, -23.5, fx - 4.4, P["ind_steel"])
    bx0, bx1, by0 = 10.0, 25.0, hy1 + 1.0
    box(M, bx0, bx1, by0, y1, PAD_H, PAD_H + 0.04, P["concrete"])
    frame(M, bx0, bx1, by0, y1, 0, 1.8, 0.45, P["concrete"])
    bm = (by0 + y1) / 2
    box(M, bx0 + 0.45, bx1 - 0.45, bm - 0.25, bm + 0.25, 0, 1.8, P["concrete"])
    pile(M, (bx0 + bx1) / 2, (by0 + bm) / 2, 6.2, (bm - by0) / 2 - 0.8, 3.6, P["ore_pile"])
    pile(M, (bx0 + bx1) / 2, (bm + y1) / 2, 6.2, (y1 - bm) / 2 - 0.8, 3.4, P["coal"])
    conveyor(M, P, (bx0 + 0.6, bm, 2.0), (fx + 4.2, fy, 25.6), wd=1.3, legs=(0.3, 0.6))
    cyl(M, 5.0, y1 - 2.0, 1.8, 0, 38.0, P["concrete"], n=12)
    cyl(M, 5.0, y1 - 2.0, 1.9, 33.0, 35.0, P["rust2"], n=12)
    cyl(M, 5.0, y1 - 2.0, 1.4, 38.0, 38.06, P["coal"], n=10)
    box(M, 10.0, 25.5, y0, y0 + 5.0, PAD_H, PAD_H + 0.03, P["gravel"])
    for x in (13.0, 18.0, 23.0):
        revolve(M, x, y0 + 2.5, [(1.0, PAD_H), (1.6, 2.2), (1.7, 2.4), (0.0, 2.4)], P["furnace"], n=10)
        cyl(M, x, y0 + 2.5, 1.2, 2.4, 2.45, P["glow"], n=8)
    return L


def b_cementworks(M, P):
    """Cement works: a long rotary kiln on piers (a pale tube with dark tyre rings) sloping down from the tall
    preheater tower, a clinker cooler at its low end, a row of tall cement silos, a limestone store with its heap
    showing at the open end, and a stack."""
    L = lot(M, P, 48, 42, bay_row(4, -14.5))
    wall = P["ind_wall"]
    y0, y1 = L.y0, L.y1
    px0, px1, py0, py1 = 12.0, 20.0, 1.0, 10.0
    box(M, px0, px1, py0, py1, 0, 4.0, P["cement2"])
    for x in (px0, px1 - 0.6):
        for y in (py0, py1 - 0.6):
            box(M, x, x + 0.6, y, y + 0.6, 4.0, 34.0, P["ind_steel"])
    for z in (12.0, 20.0, 28.0):
        frame(M, px0, px1, py0, py1, z, z + 0.6, 0.6, P["ind_steel"])
    for cx, cy, z in ((px0 + 2.4, py0 + 2.6, 26.0), (px1 - 2.4, py1 - 2.6, 18.0), (px0 + 2.4, py1 - 2.6, 10.0)):
        revolve(M, cx, cy, [(0.4, z - 4.0), (1.8, z), (1.8, z + 3.0), (0.0, z + 3.2)], P["cement"], n=10)
    frame(M, px0 - 0.2, px1 + 0.2, py0 - 0.2, py1 + 0.2, 34.0, 35.0, 0.7, P["ind_steel"])
    box(M, px0 + 1.0, px1 - 1.0, py0 + 3.0, py1 - 3.0, 34.0, 35.4, P["ind_roof"])
    # the kiln, sloping down from the tower toward the left
    p, q = Vector((px0 - 0.5, (py0 + py1) / 2, 8.0)), Vector((-16.5, 3.0, 4.0))
    u = (q - p).normalized()
    side = Vector((-u.y, u.x, 0.0)).normalized()
    up = u.cross(side)
    r, n = 1.9, 12

    def ring(c, rr):
        return [tuple(c + side * (rr * math.cos(2 * math.pi * i / n)) + up * (rr * math.sin(2 * math.pi * i / n)))
                for i in range(n)]
    M.loft(ring(p, r), ring(q, r), P["kiln"])
    for t in (0.15, 0.5, 0.85):
        c = p.lerp(q, t)
        M.loft(ring(c - u * 0.5, r + 0.25), ring(c + u * 0.5, r + 0.25), P["ind_dark"])
        box(M, c.x - 1.4, c.x + 1.4, c.y - 1.2, c.y + 1.2, 0, c.z - r, P["concrete"])
    flat_block(M, -23.5, -16.5, -1.5, 8.0, 7.0, wall, P["ind_roof"])
    # cement silos in a row along the back, a walkway across their tops
    for i in range(4):
        sx = -20.0 + i * 6.0
        cyl(M, sx, y1 - 3.2, 2.7, 0, 22.0, P["cement"], n=14)
        cyl(M, sx, y1 - 3.2, 2.75, 19.0, 19.6, P["cement2"], n=14)
        cyl(M, sx, y1 - 3.2, 2.6, 22.0, 22.25, P["cement2"], n=14)
    box(M, -20.0, -2.0, y1 - 3.7, y1 - 2.7, 22.25, 22.6, P["ind_steel"])
    # limestone store at the front right, the heap showing at its open end
    sx0, sx1, sy0, sy1 = -2.0, 19.0, y0, y0 + 7.5
    box(M, sx0, sx1, sy0, sy1, 0, 6.0, P["cement2"])
    gable(M, sx0, sx1, sy0, sy1, 6.0, 8.8, "x", P["ind_roof"], P["cement2"], oh_u=(0.4, 0.4), oh_a=(0.4, 0.4))
    taper(M, (sx1 + 0.1, sx1 + 3.6, sy0 + 0.8, sy1 - 0.8), (sx1 + 0.1, sx1 + 1.0, sy0 + 2.6, sy1 - 2.6), PAD_H, 3.6,
          P["lime"])
    cyl(M, 22.0, y1 - 4.0, 1.4, 0, 30.0, P["concrete"], n=10)
    cyl(M, 22.0, y1 - 4.0, 1.5, 26.0, 27.4, P["cp_red"], n=10)
    cyl(M, 22.0, y1 - 4.0, 1.0, 30.0, 30.06, P["coal"], n=8)
    return L

# ------------------------------------------------------------------ tier 3 industry

def pumpjack(M, P, cx, cy, s=1.0):
    """A nodding-donkey pump: skid, A-frame samson post, walking beam with its horsehead over the well,
    gearbox and counterweights at the back. Long axis along X, head toward -X."""
    dark, red = P["ind_dark"], P["pj"]
    box(M, cx - 3.6 * s, cx + 3.0 * s, cy - 0.7 * s, cy + 0.7 * s, 0, 0.4 * s, P["concrete"])
    for dy in (-0.75, 0.75):
        taper(M, (cx - 1.0 * s, cx + 1.0 * s, cy + dy * s - 0.18 * s, cy + dy * s + 0.18 * s),
              (cx - 0.18 * s, cx + 0.18 * s, cy + dy * 0.35 * s - 0.15 * s, cy + dy * 0.35 * s + 0.15 * s), 0.4 * s, 4.2 * s, red)
    box(M, cx - 3.0 * s, cx + 2.6 * s, cy - 0.28 * s, cy + 0.28 * s, 4.2 * s, 4.75 * s, red)
    taper(M, (cx - 3.6 * s, cx - 2.9 * s, cy - 0.32 * s, cy + 0.32 * s), (cx - 3.4 * s, cx - 2.9 * s, cy - 0.32 * s, cy + 0.32 * s),
          2.9 * s, 5.0 * s, dark)
    cyl(M, cx - 3.4 * s, cy, 0.22 * s, 0.4 * s, 1.5 * s, dark, n=6)
    box(M, cx + 1.4 * s, cx + 2.6 * s, cy - 0.45 * s, cy + 0.45 * s, 0.4 * s, 1.6 * s, dark)
    for dy in (-0.75, 0.75):
        box(M, cx + 1.5 * s, cx + 2.7 * s, cy + dy * s - 0.12 * s, cy + dy * s + 0.12 * s, 0.9 * s, 2.7 * s, red)


def tank(M, P, cx, cy, r, h, m, roof=None, n=16):
    """Storage tank with a shallow cone roof and a dark band at the top."""
    cyl(M, cx, cy, r, 0, h, m, n=n)
    cyl(M, cx, cy, r + 0.05, h - 0.5, h - 0.2, P["ind_dark"], n=n)
    revolve(M, cx, cy, [(r, h), (r * 0.15, h + r * 0.18), (0.0, h + r * 0.19)], roof or P["tank_roof"], n=n)


def b_oilwell(M, P):
    """Oil well site: three pumpjacks over their wells on a gravel pad, flowlines to a pair of storage tanks
    in a bund by the truck lane, and a small switch house."""
    L = lot(M, P, 30, 30, bay_row(2, -9.0), asphalt=(-15.0, -3.0))
    g = PAD_H + 0.03
    box(M, -14.6, 14.6, L.yf + PARK_DEPTH, 14.6, PAD_H, g, P["gravel"])
    wells = ((-6.5, 10.5), (6.5, 10.5), (-6.5, 2.5))
    for x, y in wells:
        pumpjack(M, P, x, y, s=1.3)
    for x, y in wells:
        bar(M, (x - 4.4, y), (8.0, -4.5), 0.25, g, g + 0.25, P["ind_dark"])
    # tank bund at the front right
    bx0, bx1, by0, by1 = 1.5, 14.0, L.y0, L.y0 + 7.8
    frame(M, bx0, bx1, by0, by1, 0, 0.8, 0.4, P["concrete"])
    tank(M, P, 4.9, (by0 + by1) / 2, 2.8, 6.0, P["ind_tank"])
    tank(M, P, 10.6, (by0 + by1) / 2, 2.8, 6.0, P["ind_tank"])
    flat_block(M, -13.0, -9.0, L.y0, L.y0 + 4.0, 3.2, P["ind_wall"], P["ind_roof"])
    return L


def b_sandpit(M, P):
    """Sand pit: a flooded working in pale sand banks with a dredge on the water piping to a screening
    plant, which belts washed sand out to golden cone heaps by the truck lane."""
    L = lot(M, P, 40, 38, bay_row(3, -11.0), asphalt=(-20.0, -2.0))
    yp = L.yf + PARK_DEPTH
    cx, cy = -5.0, 7.0
    for hx, hy, z, m in ((14.5, 11.0, 1.4, P["sand_rim"]), (11.6, 8.4, 0.8, P["sand_rim2"])):
        frame(M, cx - hx, cx + hx, cy - hy, cy + hy, 0, z, 2.9, m)
    box(M, cx - 8.7, cx + 8.7, cy - 5.5, cy + 5.5, 0, 0.3, P["pond"])
    # the dredge on the water, its pipe to the plant
    box(M, cx - 1.5, cx + 2.5, cy - 1.2, cy + 1.2, 0.3, 1.1, P["ind_yellow"], bevel=0.05)
    box(M, cx - 0.6, cx + 1.4, cy - 0.8, cy + 0.8, 1.1, 2.4, P["ind_dark"])
    bar(M, (cx - 1.5, cy), (cx - 5.0, cy + 2.0), 0.4, 1.1, 1.5, P["ind_steel"])
    bar(M, (cx + 2.5, cy), (13.0, 6.0), 0.35, 1.5, 1.85, P["ind_dark"])
    # screening plant: a steel frame with a sloping screen deck and a hopper
    px0, px1, py0, py1 = 11.0, 17.5, 2.0, 10.0
    for x in (px0, px1 - 0.5):
        for y in (py0, py1 - 0.5):
            box(M, x, x + 0.5, y, y + 0.5, 0, 6.0, P["ind_dark"])
    lo = [(px0, py0, 7.6), (px1, py0, 7.6), (px1, py1, 5.6), (px0, py1, 5.6)]
    M.loft([(x, y, z - 0.7) for x, y, z in lo], lo, P["ind_steel"])
    taper(M, (px0 + 1.5, px1 - 1.5, py0 + 0.5, py0 + 3.0), (px0 + 0.8, px1 - 0.8, py0 - 0.2, py0 + 3.6), 7.6, 9.4,
          P["ind_yellow"])
    # belts out to the heaps near the front
    for (hx, hy, r, h, m) in ((15.8, yp + 4.2, 3.6, 6.4, P["sand_pile"]), (9.0, yp + 3.6, 3.0, 5.2, P["sand_pile2"])):
        conveyor(M, P, ((px0 + px1) / 2, py0 + 0.2, 5.0), (hx, hy + 0.4, h + 0.8), wd=0.9, legs=(0.5,))
        cone_pile(M, hx, hy, r, h, m)
    flat_block(M, -1.0, 3.5, L.y0, L.y0 + 4.0, 3.2, P["ind_wall"], P["ind_roof"])
    return L


def b_refinery(M, P):
    """Oil refinery: a tank farm in concrete bunds at the back, distillation columns ringed with platforms,
    a fired heater with its stacks, a pipe rack tying them together, a flare stack and a control house."""
    L = lot(M, P, 60, 50, bay_row(6, -14.0))
    y0, y1 = L.y0, L.y1
    dark, steel = P["ind_dark"], P["ind_steel"]
    # tank farm: four big tanks along the back
    for i, x in enumerate((-22.0, -10.0, 2.0, 14.0)):
        ty = y1 - 6.0
        frame(M, x - 5.8, x + 5.8, ty - 5.8, ty + 5.8, 0, 0.9, 0.45, P["concrete"])
        tank(M, P, x, ty, 4.8, 8.0 if i % 2 else 9.5, P["ind_tank"])
    # pipe rack across the middle
    ry = 3.0
    for x in range(-26, 27, 6):
        box(M, x - 0.25, x + 0.25, ry - 1.4, ry - 0.9, 0, 6.0, dark)
        box(M, x - 0.25, x + 0.25, ry + 0.9, ry + 1.4, 0, 6.0, dark)
    box(M, -26.5, 26.5, ry - 1.5, ry + 1.5, 6.0, 6.4, steel)
    for dy in (-0.8, 0.0, 0.8):
        pipe_x(M, ry + dy, 6.8, 0.32, -26.0, 26.0, P["tank_roof"] if dy else P["ind_copper"], n=6)
    # process area in front of the rack: columns, heater, flare
    for cx, cy, r, h in ((-14.0, -4.0, 1.7, 30.0), (-9.0, -6.0, 1.3, 24.0), (-4.5, -3.5, 2.1, 19.0)):
        cyl(M, cx, cy, r, 0, h, P["column_steel"], n=12)
        revolve(M, cx, cy, [(r, h), (r * 0.7, h + r * 0.6), (0.0, h + r * 0.7)], P["column_steel"], n=12)
        for z in (h * 0.35, h * 0.7):
            cyl(M, cx, cy, r + 0.55, z, z + 0.35, P["ind_yellow"], n=12)
    hx0, hx1, hy0, hy1 = 2.0, 12.0, y0 + 1.0, y0 + 7.0
    box(M, hx0, hx1, hy0, hy1, 0, 9.0, P["ind_wall"])
    box(M, hx0 - 0.1, hx1 + 0.1, hy0 - 0.1, hy1 + 0.1, 9.0, 9.3, P["ind_roof"])
    for x in (4.5, 9.5):
        cyl(M, x, (hy0 + hy1) / 2, 0.9, 9.3, 22.0, steel, n=10)
        cyl(M, x, (hy0 + hy1) / 2, 0.95, 19.0, 20.0, P["cp_red"], n=10)
        cyl(M, x, (hy0 + hy1) / 2, 0.6, 22.0, 22.06, P["coal"], n=8)
    fx, fy = 25.0, -6.0
    cyl(M, fx, fy, 0.5, 0, 34.0, steel, n=8)
    box(M, fx - 1.4, fx + 1.4, fy - 1.4, fy + 1.4, 0, 0.8, P["concrete"])
    revolve(M, fx, fy, [(0.55, 34.0), (0.9, 35.4), (0.0, 37.2)], P["flame"], n=8)
    flat_block(M, -26.5, -19.0, y0, y0 + 6.0, 4.0, P["ind_wall"], P["ind_roof"])
    return L


def b_glassworks(M, P):
    """Glassworks: a long float-line hall with a roof monitor, the furnace house at its head with two stacks,
    batch silos for sand and soda behind, and racks of finished glass sheets in the yard."""
    L = lot(M, P, 46, 38, bay_row(4, -12.0))
    y0, y1 = L.y0, L.y1
    wall, roof, dark = P["ind_wall"], P["ind_roof"], P["ind_dark"]
    hx0, hx1, hy0, hy1 = -21.5, 9.0, y0, y0 + 10.0
    top = flat_block(M, hx0, hx1, hy0, hy1, 8.0, wall, roof)
    ribs(M, hx0 + 1.5, hx1 - 1.5, hy0 + 1.2, hy1 - 1.2, top, P["saw_glass"], 7, along="y", wd=1.6, h=0.2)
    box(M, hx0 + 1.0, hx1 - 1.0, (hy0 + hy1) / 2 - 0.5, (hy0 + hy1) / 2 + 0.5, top, top + 0.9, P["ind_steel"])
    band(M, hx0, hx1, hy0, hy1, 6.4, 7.0, P["glass_sheet"], o=0.05)
    for x in (-16.0, -6.0):
        box(M, x - 2.0, x + 2.0, hy0 - 0.06, hy0, 0, 4.6, dark)
    # furnace house at the head of the line
    fx0, fx1, fy0, fy1 = 9.0, 21.5, y0, y0 + 14.0
    ftop = flat_block(M, fx0, fx1, fy0, fy1, 13.0, P["cm_wall"], roof)
    box(M, fx0 + 1.5, fx1 - 6.0, fy0 + 1.5, fy0 + 6.0, ftop, ftop + 1.6, P["ind_dark"])
    ac_unit(M, fx1 - 3.0, fy0 + 3.0, ftop, P)
    for cx, cy, ch in ((13.0, fy1 - 3.0, 30.0), (18.0, fy1 - 3.0, 26.0)):
        cyl(M, cx, cy, 1.2, ftop, ch, P["concrete"], n=12)
        cyl(M, cx, cy, 1.25, ch - 3.0, ch - 2.0, P["cp_red"], n=12)
        cyl(M, cx, cy, 0.8, ch, ch + 0.06, P["coal"], n=10)
    # batch silos behind the hall
    for i in range(3):
        sx = 4.0 + i * 4.8
        revolve(M, sx, y1 - 3.2, [(0.5, 3.0), (2.1, 5.0), (2.1, 15.0), (0.0, 15.8)], P["silo"], n=12)
        for dx in (-1.5, 1.5):
            box(M, sx + dx - 0.18, sx + dx + 0.18, y1 - 3.4, y1 - 3.0, 0, 5.0, dark)
    box(M, 1.5, 16.5, y1 - 3.5, y1 - 2.9, 15.8, 16.2, P["ind_steel"])
    # glass racks in the yard
    cone_pile(M, -3.0, 3.6, 2.8, 2.4, P["cullet"])
    cone_pile(M, 2.0, 5.0, 2.2, 1.9, P["cullet"], rot=0.3)
    for i in range(4):
        rx = -18.0 + i * 4.6
        for k, ry in enumerate((y1 - 6.5, y1 - 2.5)):
            box(M, rx - 1.8, rx + 1.8, ry - 0.6, ry + 0.6, 0, 0.3, P["wood"])
            taper(M, (rx - 1.7, rx + 1.7, ry - 0.55, ry + 0.55), (rx - 1.7, rx + 1.7, ry - 0.1, ry + 0.1), 0.3,
                  2.6 + 0.3 * ((i + k) % 2), P["glass_sheet"])
    return L


def b_furniture(M, P):
    """Furniture factory: a sawtooth-roofed hall (glazed north lights catching the sky), an open timber shed
    stacked with planks, a dust-extraction cyclone, and a covered dispatch dock."""
    L = lot(M, P, 40, 34, bay_row(4, -8.0))
    y0, y1 = L.y0, L.y1
    wall, roof, dark = P["fur_wall"], P["fur_roof"], P["ind_dark"]
    hx0, hx1, hy0, hy1, h = -18.5, 7.0, y0 + 1.5, y1 - 1.0, 6.5
    box(M, hx0, hx1, hy0, hy1, 0, h, wall)
    band(M, hx0, hx1, hy0, hy1, 5.2, 5.8, P["wood"], o=0.05)
    n = 5
    tw = (hy1 - hy0) / n
    for i in range(n):
        a, b = hy0 + i * tw, hy0 + (i + 1) * tw
        extrude_profile(M, [(a, h), (b, h), (b, h + 2.4)], "x", hx0, hx1, roof)
        box(M, hx0 + 0.2, hx1 - 0.2, b - 0.12, b, h, h + 2.2, P["saw_glass"])
    # dispatch dock: canopy over the front doors
    box(M, -14.5, -1.5, hy0 - 2.5, hy0, 3.8, 4.1, P["ind_roof"])
    for x in (-14.2, -1.8):
        box(M, x - 0.15, x + 0.15, hy0 - 2.4, hy0 - 2.1, 0, 3.8, dark)
    for x in (-11.5, -8.0, -4.5):
        box(M, x - 1.3, x + 1.3, hy0 - 0.06, hy0, 0, 3.4, dark)
    # timber shed at the right: a mono-pitch roof on posts, plank stacks under it
    sx0, sx1, sy0, sy1 = 9.0, 18.5, y0 + 3.0, y1 - 1.0
    sm = sy1 - 9.0
    for x in (sx0, sx1 - 0.4):
        for y in (sm, sy1 - 0.4):
            box(M, x, x + 0.4, y, y + 0.4, 0, 5.0, P["wood"])
    extrude_profile(M, [(sx0 - 0.3, 5.0), (sx1 + 0.3, 6.0), (sx1 + 0.3, 6.25), (sx0 - 0.3, 5.25)], "y", sm - 0.4, sy1 + 0.4,
                    P["lg_roof"])
    box(M, sx0 - 0.5, sx1 + 0.5, sy0 - 0.5, sy1 + 0.5, PAD_H, PAD_H + 0.03, P["lg_yard"])
    for i in range(3):
        yy = sy0 + 0.6 + i * 4.4
        box(M, sx0 + 1.2, sx1 - 1.2, yy, yy + 3.4, 0, 1.6 + 0.4 * (i % 2), P["plank"])
        ribs(M, sx0 + 1.2, sx1 - 1.2, yy, yy + 3.4, 1.6 + 0.4 * (i % 2), P["stick"], 3, along="y", wd=0.2, h=0.1)
    # dust extraction cyclone beside the hall
    revolve(M, 9.5, y0 + 0.8, [(0.2, 2.5), (1.4, 5.5), (1.4, 8.5), (0.0, 9.0)], P["ind_steel"], n=10)
    for dx in (-1.0, 1.0):
        box(M, 9.5 + dx - 0.12, 9.5 + dx + 0.12, y0 + 0.7, y0 + 0.9, 0, 5.5, dark)
    bar(M, (hx1, y0 + 4.0), (9.5, y0 + 0.8), 0.6, 7.6, 8.1, P["ind_steel"])
    return L


def b_constructionplant(M, P):
    """Construction parts plant: a long precast hall, a concrete batching tower with its cement silos and
    belt, and a yard under a gantry crane stacked with precast panels and steel beams."""
    L = lot(M, P, 50, 42, bay_row(5, -13.0))
    y0, y1 = L.y0, L.y1
    wall, roof, dark = P["ind_wall"], P["ind_roof"], P["ind_dark"]
    hx0, hx1, hy0, hy1 = -23.5, 6.0, y0, y0 + 12.0
    box(M, hx0, hx1, hy0, hy1, 0, 9.0, wall)
    band(M, hx0, hx1, hy0, hy1, 7.4, 8.0, P["ind_yellow"], o=0.05)
    gable(M, hx0, hx1, hy0, hy1, 9.0, 11.6, "x", roof, wall, oh_u=(0.5, 0.5), oh_a=(0.4, 0.4))
    for x in (-18.0, -8.0, 1.0):
        box(M, x - 2.2, x + 2.2, hy0 - 0.06, hy0, 0, 6.5, dark)
    # batching tower and cement silos at the front right
    bx0, bx1, by0, by1 = 13.0, 18.0, y0 + 1.0, y0 + 7.0
    top = flat_block(M, bx0, bx1, by0, by1, 16.0, P["cement"], roof)
    band(M, bx0, bx1, by0, by1, 13.0, 13.8, P["ind_yellow"], o=0.05)
    for sx in (20.5,):
        for sy in (by0 + 1.2, by1 - 1.2):
            revolve(M, sx, sy, [(0.4, 3.5), (1.6, 5.5), (1.6, 17.5), (0.0, 18.3)], P["cement"], n=12)
            for dx in (-1.2, 1.2):
                box(M, sx + dx - 0.15, sx + dx + 0.15, sy - 0.15, sy + 0.15, 0, 5.5, dark)
    conveyor(M, P, (18.5, 9.0, 3.0), (15.5, by1, 15.0), wd=1.0, legs=(0.4, 0.75))
    cone_pile(M, 19.0, 12.0, 3.6, 4.4, P["gravel"])
    cone_pile(M, 14.0, 15.5, 3.0, 3.6, P["sand_pile2"], rot=0.3)
    # precast yard behind the hall under a gantry crane
    yy0, yy1, gx0, gx1 = hy1 + 2.0, y1, -23.0, 8.0
    box(M, gx0, gx1, yy0, yy1, PAD_H, PAD_H + 0.03, P["gravel"])
    for x in (-17.0, -5.0):
        for side in (yy0 + 0.6, yy1 - 0.6):
            taper(M, (x - 0.9, x + 0.9, side - 0.35, side + 0.35), (x - 0.3, x + 0.3, side - 0.3, side + 0.3), 0, 9.0,
                  P["ind_yellow"])
        box(M, x - 0.6, x + 0.6, yy0, yy1, 9.0, 10.2, P["ind_yellow"])
    box(M, -17.5, -4.5, (yy0 + yy1) / 2 - 1.0, (yy0 + yy1) / 2 + 1.0, 10.2, 11.2, dark)
    for i in range(4):
        px = -21.0 + i * 5.5
        for k in range(3):
            py = yy0 + 2.0 + k * 6.2
            box(M, px - 2.0, px + 2.0, py, py + 3.6, PAD_H, 0.8 + 0.5 * ((i + k) % 3), P["panel"])
    for k in range(3):
        box(M, 1.0, 7.5, yy0 + 2.0 + k * 1.4, yy0 + 2.8 + k * 1.4, PAD_H, 0.9, P["rust2"])
    return L

# ------------------------------------------------------------------ tier 4 industry

def haul_truck(M, P, cx, cy, s=1.0, rot=False):
    """A big mining dump truck seen from above: yellow body, raised tray, dark tyres. Long axis along Y (X if rot)."""
    def bx(x0, x1, y0, y1, z0, z1, m):
        if rot:
            box(M, cx + y0 * s, cx + y1 * s, cy + x0 * s, cy + x1 * s, z0 * s, z1 * s, m)
        else:
            box(M, cx + x0 * s, cx + x1 * s, cy + y0 * s, cy + y1 * s, z0 * s, z1 * s, m)
    for y in (-2.2, 1.8):
        bx(-2.1, -1.3, y - 0.8, y + 0.8, 0.0, 1.6, P["ind_dark"])
        bx(1.3, 2.1, y - 0.8, y + 0.8, 0.0, 1.6, P["ind_dark"])
    bx(-1.3, 1.3, -3.0, 3.0, 0.6, 1.6, P["ind_dark"])
    taper(M, *((
        (cx - 1.9 * s, cx + 1.9 * s, cy - 2.0 * s, cy + 3.2 * s) if not rot else (cx - 2.0 * s, cx + 3.2 * s, cy - 1.9 * s, cy + 1.9 * s)),
        ((cx - 2.1 * s, cx + 2.1 * s, cy - 2.4 * s, cy + 3.4 * s) if not rot else (cx - 2.4 * s, cx + 3.4 * s, cy - 2.1 * s, cy + 2.1 * s))),
          1.6 * s, 3.0 * s, P["ind_yellow"])
    bx(-1.9, 1.9, -3.4, -2.1, 1.6, 2.8, P["ind_yellow"])
    bx(-1.6, -0.2, -3.3, -2.3, 2.8, 3.5, P["ind_dark"])


def b_coppermine(M, P):
    """Open-pit copper mine: a deep grey-green pit cut in benches with a spiral haul road, a dump truck coming
    up it, a primary crusher at the rim and a heap of green-veined ore by the loadout."""
    L = lot(M, P, 44, 40, bay_row(3, -13.0), asphalt=(-22.0, -6.0))
    yp = L.yf + PARK_DEPTH
    cx, cy = -4.0, 5.5
    rings = ((17.5, 13.0, 3.0, P["cu_rock"]), (14.6, 10.4, 2.2, P["cu_rock2"]), (11.7, 7.8, 1.4, P["cu_rock"]),
             (8.8, 5.4, 0.7, P["cu_rock2"]))
    for hx, hy, z, m in rings:
        frame(M, cx - hx, cx + hx, cy - hy, cy + hy, 0, z, 2.9, m)
    box(M, cx - 5.9, cx + 5.9, cy - 2.5, cy + 2.5, 0, 0.2, P["cu_floor"])
    box(M, cx - 3.0, cx + 1.0, cy - 1.2, cy + 1.6, 0.2, 0.32, P["cu_ore"])
    # haul road ramp down the right side
    lo = [(cx + 11.7, cy - 7.8, 1.4), (cx + 14.6, cy - 7.8, 1.4), (cx + 14.6, cy + 6.0, 3.0), (cx + 11.7, cy + 6.0, 3.0)]
    M.loft([(x, y, 0.0) for x, y, _ in lo], lo, P["cu_road"])
    haul_truck(M, P, 17.5, 0.5, s=0.62)
    haul_truck(M, P, cx - 1.0, cy + 0.3, s=0.62, rot=True)
    # primary crusher at the rim, belt to the ore heap
    kx0, kx1, ky0, ky1 = 15.5, 21.0, 6.0, 13.0
    flat_block(M, kx0, kx1, ky0, ky1, 8.0, P["ind_wall"], P["ind_roof"])
    taper(M, (kx0 + 1.0, kx1 - 1.0, ky1 - 3.0, ky1 - 0.5), (kx0 + 0.2, kx1 - 0.2, ky1 - 3.6, ky1 + 0.5), 8.2, 10.0,
          P["ind_copper"])
    conveyor(M, P, (18.0, ky0 - 0.2, 7.0), (17.0, yp + 4.8, 8.0), wd=1.1, legs=(0.5,))
    pile(M, 15.0, yp + 4.2, 6.0, 3.7, 6.4, P["cu_ore"])
    return L


def b_coppersmelter(M, P):
    """Copper smelter: a tall smelter house clad in copper-brown panels with a flue to a very tall stack,
    the white tanks of the acid plant, an anode casting shed and stacks of copper anodes in the yard."""
    L = lot(M, P, 50, 42, bay_row(4, -14.5))
    y0, y1 = L.y0, L.y1
    wall, roof, dark, cu = P["ind_wall"], P["ind_roof"], P["ind_dark"], P["ind_copper"]
    # smelter house: a tall block with a stepped upper storey
    hx0, hx1, hy0, hy1 = -23.5, -6.0, y0 + 2.0, y0 + 16.0
    top = flat_block(M, hx0, hx1, hy0, hy1, 16.0, P["cm_wall"], roof)
    band(M, hx0, hx1, hy0, hy1, 6.0, 12.0, cu, o=0.05)
    box(M, hx0 + 3.0, hx1 - 6.0, hy0 + 3.0, hy1 - 2.0, top, top + 6.0, P["cm_wall"])
    box(M, hx0 + 2.9, hx1 - 5.9, hy0 + 2.9, hy1 - 1.9, top + 6.0, top + 6.3, roof)
    box(M, hx0 + 3.0, hx1 - 6.0, hy0 + 2.96, hy0 + 3.0, top + 3.6, top + 4.4, cu)
    for x in (-19.0, -11.0):
        box(M, x - 2.0, x + 2.0, hy0 - 0.06, hy0, 0, 6.0, dark)
    # flue to the stack
    sx, sy = -14.0, y1 - 3.0
    pipe_y(M, sx, 12.0, 1.0, hy1, sy - 2.0, P["ind_steel"])
    cyl(M, sx, sy, 2.2, 0, 46.0, P["concrete"], n=14)
    cyl(M, sx, sy, 2.3, 40.0, 42.5, P["cp_red"], n=14)
    cyl(M, sx, sy, 1.8, 46.0, 46.06, P["coal"], n=12)
    # acid plant: white tanks and a scrubber tower
    for (tx, ty, r, h) in ((2.0, y1 - 5.0, 3.4, 9.0), (10.0, y1 - 5.0, 3.4, 9.0), (18.5, y1 - 4.0, 2.6, 7.0)):
        tank(M, P, tx, ty, r, h, P["ind_tank"])
    cyl(M, 5.5, 4.0, 1.6, 0, 20.0, P["column_steel"], n=12)
    revolve(M, 5.5, 4.0, [(1.6, 20.0), (0.0, 21.2)], P["column_steel"], n=12)
    cyl(M, 5.5, 4.0, 2.1, 12.0, 12.4, P["ind_yellow"], n=12)
    pipe_x(M, 4.0, 10.0, 0.6, hx1, 5.5 - 1.6, P["ind_steel"])
    # anode casting shed and the anode stacks
    ax0, ax1, ay0, ay1 = 2.0, 13.0, y0, y0 + 9.0
    box(M, ax0, ax1, ay0, ay1, 0, 7.0, wall)
    gable(M, ax0, ax1, ay0, ay1, 7.0, 9.0, "x", cu, wall, oh_u=(0.4, 0.4), oh_a=(0.4, 0.4))
    for i in range(3):
        for k in range(2):
            px, py = 16.0 + i * 2.8, y0 + 1.5 + k * 3.6
            box(M, px - 1.1, px + 1.1, py - 1.3, py + 1.3, PAD_H, 1.1 + 0.3 * ((i + k) % 2), cu, bevel=0.04)
            box(M, px - 1.1, px + 1.1, py - 0.08, py + 0.08, 1.1 + 0.3 * ((i + k) % 2), 1.2 + 0.3 * ((i + k) % 2), dark)
    return L


def b_electronics(M, P):
    """Electronics plant: a clean white fab block with a dense grid of rooftop air handlers, a glazed office
    wing at the front, a gas yard of small tanks, and a solar canopy over the staff car park."""
    L = lot(M, P, 44, 36, bay_row(5, -10.0))
    y0, y1 = L.y0, L.y1
    wall, roof, dark = P["el_wall"], P["el_roof"], P["ind_dark"]
    fx0, fx1, fy0, fy1 = -20.5, 10.0, y0 + 4.0, y1
    top = flat_block(M, fx0, fx1, fy0, fy1, 11.0, wall, roof, parapet=P["el_wall"])
    band(M, fx0, fx1, fy0, fy1, 8.6, 9.4, P["el_accent"], o=0.05)
    for i in range(4):
        for k in range(3):
            ax = fx0 + 4.0 + i * 7.2
            ay = fy0 + 4.0 + k * 7.5
            box(M, ax - 2.6, ax + 2.6, ay - 1.6, ay + 1.6, top, top + 1.6, P["ac_box"])
            for j in range(3):
                cyl(M, ax - 1.7 + j * 1.7, ay, 0.62, top + 1.6, top + 1.7, P["ac_fan"], n=8)
    # glazed office wing at the front left
    ox0, ox1, oy0, oy1 = -20.5, -6.0, y0, fy0 + 0.5
    otop = flat_block(M, ox0, ox1, oy0, oy1, 7.5, P["el_glass"], P["el_wall"])
    for z in (2.6, 5.2):
        band(M, ox0, ox1, oy0, oy1, z, z + 0.4, P["el_wall"], o=0.04)
    box(M, ox0 + 0.5, ox0 + 3.2, oy0 - 1.0, oy0, 3.4, 3.7, P["el_wall"])
    # loading dock on the fab's front right
    for x in (-1.0, 3.5, 8.0):
        box(M, x - 1.4, x + 1.4, fy0 - 0.06, fy0, 0, 3.8, dark)
    # gas yard: small tanks in a fenced bay at the right
    gx0, gx1, gy0, gy1 = 12.5, 21.0, y0 + 2.0, y1 - 1.0
    frame(M, gx0, gx1, gy0, gy1, 0, 1.6, 0.12, P["ind_steel"])
    for i in range(3):
        cyl(M, gx0 + 2.4 + i * 2.0, gy1 - 3.0, 0.8, 0, 7.5, P["ind_tank"], n=10)
    for i in range(2):
        revolve(M, gx0 + 3.0 + i * 3.4, gy0 + 4.0, [(1.3, 0.0), (1.3, 4.0), (0.0, 4.9)], P["ind_tank"], n=12)
    box(M, gx0 + 1.0, gx1 - 1.0, gy0 + 8.0, gy0 + 10.5, 0, 2.6, P["ac_box"])
    return L


def b_machineworks(M, P):
    """Machine works: a big assembly hall under a tall pitched roof with rooflights, a crane runway out over
    the yard, rows of finished yellow machines waiting for trucks, and crates by the office."""
    L = lot(M, P, 52, 44, bay_row(5, -15.0))
    y0, y1 = L.y0, L.y1
    wall, roof, dark, yellow = P["ind_wall"], P["ind_roof"], P["ind_dark"], P["ind_yellow"]
    hx0, hx1, hy0, hy1 = -24.5, 6.0, y0 + 2.0, y1
    box(M, hx0, hx1, hy0, hy1, 0, 12.0, wall)
    band(M, hx0, hx1, hy0, hy1, 10.0, 10.8, P["mw_band"], o=0.05)
    gable(M, hx0, hx1, hy0, hy1, 12.0, 16.0, "y", roof, wall, oh_u=(0.5, 0.5), oh_a=(0.4, 0.4))
    xc, s = (hx0 + hx1) / 2, (16.0 - 12.0) / ((hx1 - hx0) / 2)

    def zr(x):
        return 16.0 - s * abs(x - xc) + 0.04
    for k in range(4):
        yy = hy0 + 3.0 + k * ((hy1 - hy0 - 6.0) / 3)
        for side in (-1, 1):
            xa, xb = xc + side * 5.0, xc + side * 10.0
            lo = [(xa, yy - 1.2, zr(xa)), (xb, yy - 1.2, zr(xb)), (xb, yy + 1.2, zr(xb)), (xa, yy + 1.2, zr(xa))]
            if side < 0:
                lo = lo[::-1]
            M.loft(lo, [(x, y, z + 0.1) for x, y, z in lo], P["saw_glass"])
    for x in (-20.0, -12.0, -4.0):
        box(M, x - 2.6, x + 2.6, hy0 - 0.06, hy0, 0, 8.0, dark)
    # crane runway out of the hall's side over the yard
    for y in (hy0 + 6.0, hy1 - 2.0):
        box(M, hx1, 22.0, y - 0.4, y + 0.4, 9.0, 9.8, yellow)
        for x in (14.0, 21.6):
            box(M, x - 0.4, x + 0.4, y - 0.4, y + 0.4, 0, 9.0, yellow)
    box(M, 15.5, 17.5, hy0 + 5.4, hy1 - 1.4, 9.8, 10.8, dark)
    # finished machines in rows in the yard
    for i in range(3):
        for k in range(3):
            mx, my = 10.5 + i * 4.6, hy0 + 9.5 + k * 6.0
            box(M, mx - 1.5, mx + 1.5, my - 2.2, my + 2.2, PAD_H, 0.9, dark)
            box(M, mx - 1.3, mx + 1.3, my - 1.6, my + 1.4, 0.9, 2.6, yellow, bevel=0.05)
            box(M, mx - 1.0, mx + 0.6, my - 0.2, my + 1.2, 2.6, 3.8, dark)
            bar(M, (mx, my - 1.4), (mx + (1.0 if k % 2 else -1.0), my - 4.0), 0.5, 2.2, 2.7, yellow)
    # office and crates at the front right
    flat_block(M, 9.0, 18.0, y0, y0 + 5.5, 6.5, P["work_wall"], P["work_roof"])
    band(M, 9.0, 18.0, y0, y0 + 5.5, 2.4, 3.6, P["work_glass"], o=0.04)
    for i in range(3):
        box(M, 22.4, 25.4, y0 + 0.5 + i * 2.6, y0 + 2.6 + i * 2.6, PAD_H, 1.6 + 0.4 * (i % 2), P["wood"], bevel=0.04)
    return L

# ------------------------------------------------------------------ industry site support buildings
# Each stands on its own pad with its apron facing one of the site's internal roads (see docs/design.md,
# "Industry sites"). The kind's own model is a site's core; these fill the rest of the plot as it grows.

def b_site_truckyard(M, P):
    """Truck yard by the gate: a deep asphalt apron with truck bays, a weighbridge, the gatehouse and a row of
    parked trailers at the back."""
    L = lot(M, P, 44, 30, bay_row(8, -4.0))
    y0, y1 = L.y0, L.y1
    box(M, -21.6, 21.6, L.yf + PARK_DEPTH, y1 - 7.0, PAD_H, PAD_H + 0.02, P["asphalt"])
    for x in (-12.0, 0.0, 12.0):
        box(M, x - 0.08, x + 0.08, y0 + 1.0, y1 - 8.0, PAD_H + 0.02, PAD_H + 0.032, P["line"])
    # weighbridge: a steel deck with yellow kerbs, at the right
    box(M, 14.5, 19.0, L.yf + 1.0, y0 + 9.0, PAD_H, 0.28, P["ind_steel"])
    for x in (14.4, 19.0):
        box(M, x, x + 0.25, L.yf + 1.0, y0 + 9.0, 0.28, 0.5, P["ind_yellow"])
    flat_block(M, 19.6, 21.6, y0 + 1.0, y0 + 4.0, 3.0, P["work_wall"], P["work_roof"])
    band(M, 19.6, 21.6, y0 + 1.0, y0 + 4.0, 1.4, 2.3, P["work_glass"], o=0.04)
    # parked trailers along the back
    for i in range(5):
        x = -17.0 + i * 7.0
        box(M, x - 1.2, x + 1.2, y1 - 6.4, y1 - 0.4, 0.0, 0.9, P["ind_dark"])
        box(M, x - 1.25, x + 1.25, y1 - 6.5, y1 - 0.5, 0.9, 3.6, P["tb_white"] if i % 2 else P["tb_grey"], bevel=0.05)
    return L


def b_site_hall_l(M, P):
    """A big steel production / storage hall: two-tone pitched roof with rooflights, roller doors on the apron."""
    L = lot(M, P, 60, 34, [])
    y0, y1 = L.y0, L.y1
    x0, x1 = -28.5, 28.5
    box(M, x0, x1, y0, y1, 0, 9.0, P["ind_wall"])
    band(M, x0, x1, y0, y1, 7.6, 8.2, P["ind_dark"], o=0.05)
    gable2(M, x0, x1, y0, y1, 9.0, 12.0, P["ind_roof"], P["work_roof"], P["ind_wall"], ridge=P["ind_steel"], oh=0.5)
    for x in (-20.0, -8.0, 4.0, 16.0):
        box(M, x - 2.4, x + 2.4, y0 - 0.06, y0, 0, 6.0, P["ind_dark"])
    return L


def b_site_hall_m(M, P):
    """A mid-size flat-roofed hall with roof ribs, a loading canopy and a side lean-to."""
    L = lot(M, P, 40, 26, [])
    y0, y1 = L.y0, L.y1
    x0, x1 = -18.5, 12.0
    top = flat_block(M, x0, x1, y0, y1, 8.0, P["ind_wall"], P["ind_roof"])
    ribs(M, x0 + 1.0, x1 - 1.0, y0 + 1.0, y1 - 1.0, top, P["ind_steel"], 5, along="y", wd=0.8, h=0.16)
    box(M, -14.0, -2.0, y0 - 2.4, y0, 4.2, 4.5, P["ind_roof"])
    for x in (-12.0, -4.0):
        box(M, x - 2.0, x + 2.0, y0 - 0.06, y0, 0, 4.0, P["ind_dark"])
    box(M, x1, 18.5, y0 + 2.0, y1 - 2.0, 0, 4.6, P["ind_wall"])
    extrude_profile(M, [(x1, 5.4), (18.9, 4.4), (18.9, 4.62), (x1, 5.62)], "y", y0 + 1.6, y1 - 1.6, P["work_roof"])
    return L


def b_site_silos(M, P):
    """Four tall silos with a bucket-elevator tower and the walkway across their tops."""
    L = lot(M, P, 24, 22, [])
    y0, y1 = L.y0, L.y1
    cy = (y0 + y1) / 2 + 0.5
    for i in range(4):
        x = -8.4 + i * 4.6
        revolve(M, x, cy, [(0.5, 2.5), (2.2, 4.5), (2.2, 18.0), (0.0, 18.9)], P["silo"], n=12)
        for dx in (-1.6, 1.6):
            box(M, x + dx - 0.15, x + dx + 0.15, cy - 0.15, cy + 0.15, 0, 4.5, P["ind_dark"])
        cyl(M, x, cy, 2.25, 15.0, 15.5, P["ind_steel"], n=12)
    box(M, -10.0, 6.0, cy - 0.4, cy + 0.4, 18.9, 19.3, P["ind_steel"])
    box(M, 8.0, 10.5, cy - 1.2, cy + 1.2, 0, 22.0, P["ind_steel"])
    box(M, 7.8, 10.7, cy - 1.4, cy + 1.4, 22.0, 22.4, P["ind_roof"])
    return L


def b_site_tanks(M, P):
    """Three storage tanks in a concrete bund, joined by a pipe."""
    L = lot(M, P, 36, 24, [])
    y0, y1 = L.y0, L.y1
    cy = (y0 + y1) / 2
    frame(M, -17.0, 17.0, y0, y1, 0, 0.9, 0.45, P["concrete"])
    for x in (-10.5, 0.0, 10.5):
        tank(M, P, x, cy, 4.6, 7.5, P["ind_tank"])
    pipe_x(M, y0 + 0.9, 1.4, 0.35, -15.0, 15.0, P["ind_steel"], n=6)
    return L


def b_site_office(M, P):
    """The site office: a two-storey block with ribbon windows, a canteen wing and a little lawn."""
    L = lot(M, P, 26, 18, [])
    y0, y1 = L.y0, L.y1
    top = flat_block(M, -12.0, 3.0, y0, y1, 7.0, P["work_wall"], P["work_roof"], parapet=P["work_trim"])
    for z in (1.2, 4.4):
        band(M, -12.0, 3.0, y0, y1, z, z + 1.3, P["work_glass"], o=0.04)
    ac_unit(M, -7.0, (y0 + y1) / 2, top, P)
    flat_block(M, 3.0, 9.5, y0 + 1.0, y1 - 1.0, 3.8, P["res_trim"], P["work_roof"])
    box(M, 9.5, 12.5, y0, y1, PAD_H, PAD_H + 0.03, P["grass"])
    for y in (y0 + 1.5, y1 - 1.5):
        conifer(M, P, 11.0, y, s=0.7)
    return L


def b_site_workshop(M, P):
    """Maintenance workshop: a pitched shed with big doors and yard machines parked beside it."""
    L = lot(M, P, 30, 22, [])
    y0, y1 = L.y0, L.y1
    box(M, -14.0, 3.0, y0, y1, 0, 6.0, P["ind_wall"])
    gable(M, -14.0, 3.0, y0, y1, 6.0, 8.0, "x", P["sm_roof"], P["ind_wall"], oh_u=(0.4, 0.4), oh_a=(0.4, 0.4))
    for x in (-10.0, -3.5):
        box(M, x - 2.3, x + 2.3, y0 - 0.06, y0, 0, 4.6, P["ind_dark"])
    box(M, 4.0, 14.0, y0, y1, PAD_H, PAD_H + 0.03, P["gravel"])
    for k, y in enumerate((y0 + 3.0, y1 - 3.5)):
        x = 8.0 + 2.0 * k
        box(M, x - 1.3, x + 1.3, y - 2.0, y + 2.0, PAD_H, 1.8, P["ind_yellow"], bevel=0.05)
        box(M, x - 1.0, x + 0.8, y - 1.4, y + 0.6, 1.8, 3.0, P["ind_dark"])
    return L


def _field(M, P, a, b):
    """A crop field in rows (colours a, b alternating), with a farm track along its front."""
    L = lot(M, P, 64, 64, [], asphalt=(-32.0, -26.0))
    y0, y1 = L.yf + PARK_DEPTH, L.y1 + 0.6
    box(M, -31.6, 31.6, y0, y1, PAD_H, PAD_H + 0.02, P["soil"])
    n = 16
    w = (63.2 - 0.8) / n
    for i in range(n):
        x = -31.2 + i * w
        box(M, x + 0.25, x + w - 0.25, y0 + 0.6, y1 - 0.6, PAD_H + 0.02, PAD_H + 0.34 + 0.06 * (i % 2), a if i % 2 else b)
    return L


def b_site_field_g(M, P):
    return _field(M, P, P["crop_g1"], P["crop_g2"])


def b_site_field_w(M, P):
    return _field(M, P, P["crop_w1"], P["crop_w2"])


def b_site_barn(M, P):
    """A big barn with a pale ridge, two feed silos and a machinery lean-to."""
    L = lot(M, P, 30, 24, [])
    y0, y1 = L.y0, L.y1
    box(M, -13.5, 5.0, y0, y1, 0, 5.5, P["res_wall2"])
    gable(M, -13.5, 5.0, y0, y1, 5.5, 9.0, "x", P["barn_roof"], P["res_wall2"], oh_u=(0.5, 0.5), oh_a=(0.4, 0.4))
    box(M, -7.5, -2.5, y0 - 0.06, y0, 0, 4.4, P["cabin_dark"])
    for i, y in enumerate((y0 + 3.0, y1 - 3.0)):
        revolve(M, 10.0, y, [(2.3, 0.0), (2.3, 11.0 - i), (0.0, 12.6 - i)], P["silo"], n=12)
    return L


def b_site_logyard(M, P):
    """A log yard: long stacked log piles in rows on bare ground, a log loader working them."""
    L = lot(M, P, 40, 30, [])
    y0, y1 = L.y0, L.y1
    box(M, -19.6, 19.6, y0 - 0.6, y1 + 0.6, PAD_H, PAD_H + 0.02, P["lg_yard"])
    for k, y in enumerate((y0 + 2.6, y0 + 8.4, y0 + 14.2)):
        log_stack(M, P, "x", -17.5, -5.0, y, PAD_H + 0.02, 0.6, (4, 3, 2), seed=k)
        if k < 2:
            log_stack(M, P, "x", -3.5, 9.0, y, PAD_H + 0.02, 0.6, (4, 3) if k else (4, 3, 2), seed=k + 7)
    x, y = 14.0, y0 + 9.0
    box(M, x - 1.4, x + 1.4, y - 2.4, y + 2.0, PAD_H, 2.0, P["ind_yellow"], bevel=0.05)
    box(M, x - 1.0, x + 1.0, y - 1.6, y + 0.4, 2.0, 3.4, P["ind_dark"])
    bar(M, (x, y - 2.4), (x - 1.0, y - 6.0), 0.7, 1.8, 2.4, P["ind_dark"])
    return L


def _heap(M, P, m, m2):
    """An open stockpile bay: two long heaps between low concrete walls, a stacker belt over them."""
    L = lot(M, P, 30, 24, [])
    y0, y1 = L.y0, L.y1
    box(M, -14.6, 14.6, y0, y1, PAD_H, PAD_H + 0.03, P["gravel"])
    for x in (-14.6, 14.0):
        box(M, x, x + 0.6, y0, y1, 0, 1.8, P["concrete"])
    box(M, -14.6, 14.6, y1 - 0.6, y1, 0, 1.8, P["concrete"])
    pile(M, -6.5, (y0 + y1) / 2, 6.5, (y1 - y0) / 2 - 1.2, 5.6, m)
    pile(M, 6.5, (y0 + y1) / 2, 6.5, (y1 - y0) / 2 - 1.2, 4.8, m2)
    bar(M, (0.0, y0 + 0.5), (0.0, y1 - 1.0), 1.0, 6.4, 6.9, P["ind_steel"])
    for y in (y0 + 0.5, y1 - 1.0):
        box(M, -0.3, 0.3, y - 0.3, y + 0.3, 0, 6.4, P["ind_dark"])
    return L


def b_site_heap_ore(M, P):
    return _heap(M, P, P["ore_pile"], P["ore_pile2"])


def b_site_heap_coal(M, P):
    return _heap(M, P, P["coal"], P["cm_roof"])


def b_site_heap_lime(M, P):
    return _heap(M, P, P["lime"], P["lime2"])


def b_site_heap_sand(M, P):
    return _heap(M, P, P["sand_pile"], P["sand_pile2"])


def b_site_heap_cu(M, P):
    return _heap(M, P, P["cu_ore"], P["cu_rock2"])

def _flagpole(M, P, x, y, h=9.0):
    cyl(M, x, y, 0.08, PAD_H, h, P["ind_steel"], n=5)
    box(M, x + 0.06, x + 1.9, y - 0.03, y + 0.03, h - 1.3, h - 0.1, P["th_flag"])


def _hip(M, x0, x1, y0, y1, ze, zr, m, oh=0.35):
    """Hipped roof: frustum from the eaves rectangle up to a short ridge."""
    w, d = x1 - x0, y1 - y0
    r = min(w, d) / 2
    if w >= d:
        top = (x0 + r, x1 - r, (y0 + y1) / 2 - 0.05, (y0 + y1) / 2 + 0.05)
    else:
        top = ((x0 + x1) / 2 - 0.05, (x0 + x1) / 2 + 0.05, y0 + r, y1 - r)
    taper(M, (x0 - oh, x1 + oh, y0 - oh, y1 + oh), top, ze, zr, m)


def b_hamlethall(M, P):
    """Hamlet hall: a small cream meeting hall under a slate gable, a white bell cupola on the ridge,
    a porch over the door and a flagpole on a little paved square."""
    L = lot(M, P, 20, 18, bay_row(2))
    y0, y1 = L.y0, L.y1
    plaza(M, P, L, -9.5, 9.5, y0 - 0.6, y0 + 3.2)
    hx0, hx1, hy0, hy1 = -6.0, 6.0, y0 + 3.2, y1 - 0.6
    band(M, hx0, hx1, hy0, hy1, 0, 0.6, P["stone"])
    box(M, hx0, hx1, hy0, hy1, 0, 4.6, P["th_wall"])
    for k in range(3):
        wy = hy0 + 1.6 + k * (hy1 - hy0 - 3.2) / 2
        for x in (hx0 - 0.06, hx1 - 0.0):
            box(M, x, x + 0.06, wy - 0.45, wy + 0.45, 1.6, 3.6, P["lm_glass"])
    gable(M, hx0, hx1, hy0, hy1, 4.6, 7.6, "y", P["th_roof"], P["th_wall"], oh_u=(0.5, 0.5), oh_a=(0.5, 0.5))
    # porch with two posts and a little gable over the door
    box(M, -2.0, 2.0, hy0 - 2.2, hy0, 0, 0.3, P["stone"])
    for x in (-1.6, 1.6):
        cyl(M, x, hy0 - 1.8, 0.18, 0.3, 3.4, P["column"], n=6)
    gable(M, -2.0, 2.0, hy0 - 2.2, hy0, 3.4, 4.6, "y", P["th_roof"], P["th_trim"], oh_u=(0.2, 0.2), oh_a=(0.2, 0.0))
    box(M, -0.7, 0.7, hy0 - 0.06, hy0, 0.3, 2.6, P["ind_dark"])
    # bell cupola on the ridge near the front
    cy = hy0 + 2.4
    box(M, -1.0, 1.0, cy - 1.0, cy + 1.0, 6.4, 8.6, P["th_trim"])
    for sx in (-1, 1):
        box(M, -0.5, 0.5, cy + sx * 1.0 - 0.02, cy + sx * 1.0 + 0.02, 7.2, 8.2, P["ind_dark"])
    box(M, -1.2, 1.2, cy - 1.2, cy + 1.2, 8.6, 8.85, P["th_trim"])
    cone(M, 0.0, cy, 1.3, 8.85, 10.6, P["dome"], n=8)
    cyl(M, 0.0, cy, 0.05, 10.5, 11.3, P["ind_steel"], n=4)
    _flagpole(M, P, -7.8, y0 + 1.6, 8.0)
    tree(M, P, 8.0, y0 + 1.4, 0.6)
    bench(M, P, 4.2, y0 + 1.0, 0.0)
    for x, y in ((-8.0, y1 - 2.0), (8.0, y1 - 2.4)):
        tree(M, P, x, y, 0.75, alt=True)
    return L


def b_villagehall(M, P):
    """Village hall: a two-storey civic house with an open arcade (the old market) at ground level,
    a hipped slate roof, a clock gable over the middle and a flagpole on the front square."""
    L = lot(M, P, 28, 24, bay_row(3))
    y0, y1 = L.y0, L.y1
    plaza(M, P, L, -13.5, 13.5, y0 - 0.6, y0 + 3.6)
    hx0, hx1, hy0, hy1 = -10.0, 10.0, y0 + 3.6, y1 - 1.0
    # ground floor: an arcade along the front, the closed hall behind it
    box(M, hx0, hx1, hy0 + 3.0, hy1, 0, 4.0, P["th_wall"])
    box(M, hx0, hx1, hy0, hy0 + 3.0, 0, 0.2, P["stone"])
    for k in range(6):
        x = hx0 + 0.5 + k * (hx1 - hx0 - 1.0) / 5
        box(M, x - 0.45, x + 0.45, hy0, hy0 + 0.9, 0.2, 4.0, P["th_trim"])
    band(M, hx0, hx1, hy0, hy1, 4.0, 4.5, P["th_trim"])
    # upper floor with windows
    box(M, hx0, hx1, hy0, hy1, 4.5, 8.0, P["th_wall"])
    for k in range(5):
        x = hx0 + 2.0 + k * (hx1 - hx0 - 4.0) / 4
        box(M, x - 0.55, x + 0.55, hy0 - 0.06, hy0, 5.2, 7.2, P["lm_glass"])
    for k in range(3):
        y = hy0 + 3.0 + k * (hy1 - hy0 - 5.0) / 2
        for x in (hx0 - 0.06, hx1):
            box(M, x, x + 0.06, y - 0.5, y + 0.5, 5.2, 7.2, P["lm_glass"])
    box(M, hx0 - 0.3, hx1 + 0.3, hy0 - 0.3, hy1 + 0.3, 8.0, 8.4, P["th_trim"])
    _hip(M, hx0, hx1, hy0, hy1, 8.4, 11.6, P["th_roof"])
    # clock gable over the middle of the front
    box(M, -3.0, 3.0, hy0 - 0.4, hy0 + 2.0, 4.5, 10.4, P["th_wall"])
    gable(M, -3.0, 3.0, hy0 - 0.4, hy0 + 2.0, 10.4, 12.6, "y", P["th_roof"], P["th_wall"],
          oh_u=(0.3, 0.3), oh_a=(0.3, 0.0))
    box(M, -1.0, 1.0, hy0 - 0.48, hy0 - 0.4, 8.4, 10.2, P["lm_clock"])
    # small lantern on the roof ridge
    box(M, -0.8, 0.8, hy0 + 6.0, hy0 + 7.6, 11.0, 12.6, P["th_trim"])
    cone(M, 0.0, hy0 + 6.8, 1.1, 12.6, 14.2, P["dome"], n=8)
    _flagpole(M, P, -12.0, y0 + 1.8, 9.5)
    fountain(M, P, 9.0, y0 + 1.6, 1.3)
    for x, y in ((-12.5, y1 - 2.5), (12.5, y1 - 3.0), (12.6, hy0 + 2.0)):
        tree(M, P, x, y, 0.8, alt=x > 0)
    return L


def b_cityhall(M, P):
    """City hall: a grand stone block round two light wells, a tall belfry with a clock and a green
    copper spire over the entrance, a columned front and a broad square with fountains and trees."""
    L = lot(M, P, 60, 50, bay_row(6))
    y0, y1 = L.y0, L.y1
    plaza(M, P, L, -29.0, 29.0, y0 - 0.6, y0 + 9.0)
    bx0, bx1, by0, by1 = -24.0, 24.0, y0 + 9.0, y1 - 1.0
    # the main block as a ring round two courts, split by a central wing
    W = 8.0
    parts = ((bx0, bx1, by0, by0 + W), (bx0, bx1, by1 - W, by1), (bx0, bx0 + W, by0 + W, by1 - W),
             (bx1 - W, bx1, by0 + W, by1 - W), (-W / 2, W / 2, by0 + W, by1 - W))
    for (a0, a1, c0, c1) in parts:
        box(M, a0, a1, c0, c1, 0, 11.0, P["th_wall"])
        band(M, a0, a1, c0, c1, 0, 1.2, P["stone"])
        band(M, a0, a1, c0, c1, 5.4, 5.9, P["th_trim"])
        box(M, a0 - 0.3, a1 + 0.3, c0 - 0.3, c1 + 0.3, 11.0, 11.6, P["th_trim"])
    for (a0, a1, c0, c1) in parts[:4]:
        _hip(M, a0, a1, c0, c1, 11.6, 14.4, P["th_roof"], oh=0.3)
    box(M, -W / 2 - 0.3, W / 2 + 0.3, by0 + W - 0.3, by1 - W + 0.3, 11.6, 13.0, P["th_roof"])
    for (cx0, cx1) in ((bx0 + W, -W / 2), (W / 2, bx1 - W)):
        box(M, cx0, cx1, by0 + W, by1 - W, PAD_H, PAD_H + 0.05, P["grass"])
        tree(M, P, (cx0 + cx1) / 2, (by0 + by1) / 2, 0.75)
    # front windows: two rows along the facade
    for row, (z0, z1) in enumerate(((2.0, 4.6), (6.6, 9.6))):
        for k in range(14):
            x = bx0 + 1.8 + k * (bx1 - bx0 - 3.6) / 13
            if abs(x) < 7.0:
                continue
            box(M, x - 0.6, x + 0.6, by0 - 0.06, by0, z0, z1, P["lm_glass"])
    # central portico: steps, eight columns, pediment
    px0, px1, py0, py1 = -11.0, 11.0, by0 - 3.4, by0
    for i, s in enumerate((0.0, 0.6, 1.2)):
        box(M, px0 - 1.2 + s, px1 + 1.2 - s, py0 - 1.8 + s, py1, 0, 0.35 * (i + 1), P["stone"])
    for k in range(8):
        cx = px0 + 1.0 + k * (px1 - px0 - 2.0) / 7
        cyl(M, cx, py0 + 0.7, 0.55, 1.05, 10.0, P["column"], n=8)
    box(M, px0, px1, py0, py1, 10.0, 11.4, P["th_trim"])
    gable(M, px0, px1, py0, py1, 11.4, 14.0, "y", P["th_roof"], P["th_wall"], oh_u=(0.3, 0.3), oh_a=(0.3, 0.0))
    # belfry: square shaft, clock stage, open bell stage, copper spire
    tx, ty = 0.0, by0 + W / 2
    box(M, tx - 3.6, tx + 3.6, ty - 3.6, ty + 3.6, 0, 22.0, P["th_wall"])
    box(M, tx - 3.9, tx + 3.9, ty - 3.9, ty + 3.9, 22.0, 22.6, P["th_trim"])
    e = 3.6
    for x0, x1, yy0, yy1 in ((-1.5, 1.5, -e - 0.12, -e), (-1.5, 1.5, e, e + 0.12),
                             (-e - 0.12, -e, -1.5, 1.5), (e, e + 0.12, -1.5, 1.5)):
        box(M, tx + x0, tx + x1, ty + yy0, ty + yy1, 17.6, 20.6, P["lm_clock"])
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(M, tx + sx * 2.9 - 0.5, tx + sx * 2.9 + 0.5, ty + sy * 2.9 - 0.5, ty + sy * 2.9 + 0.5,
                22.6, 26.4, P["th_trim"])
    box(M, tx - 2.4, tx + 2.4, ty - 2.4, ty + 2.4, 22.6, 22.9, P["ind_dark"])
    box(M, tx - 3.6, tx + 3.6, ty - 3.6, ty + 3.6, 26.4, 27.2, P["th_trim"])
    revolve(M, tx, ty, [(3.4, 27.2), (2.6, 29.0), (1.4, 31.6), (0.6, 33.8), (0.0, 35.4)], P["dome"], n=8,
            rot=math.pi / 8)
    cyl(M, tx, ty, 0.12, 35.2, 37.0, P["ind_steel"], n=6)
    # the square: twin fountains, flagpoles, trees and benches
    for x in (-17.0, 17.0):
        fountain(M, P, x, y0 + 4.2, 2.2)
        bench(M, P, x - 4.0, y0 + 2.2, 0.0)
        bench(M, P, x + 4.0, y0 + 2.2, 0.0)
    for x in (-27.0, -24.0, 24.0, 27.0):
        tree(M, P, x, y0 + 6.5, 0.85, alt=x < 0)
    for x in (-13.5, 13.5):
        _flagpole(M, P, x, y0 + 7.4, 12.0)
    for x, y in ((-28.0, y1 - 3.0), (28.0, y1 - 3.0), (-28.0, (by0 + by1) / 2), (28.0, (by0 + by1) / 2)):
        tree(M, P, x, y, 0.9, alt=y > 0)
    return L

def _awning(M, x0, x1, y, z, depth, m):
    """Sloped shop awning over a front at y (front faces -y)."""
    M.loft([(x0, y, z), (x1, y, z), (x1, y, z + 0.06), (x0, y, z + 0.06)],
           [(x0, y - depth, z - 0.7), (x1, y - depth, z - 0.7), (x1, y - depth, z - 0.64), (x0, y - depth, z - 0.64)], m)


def b_highstreet(M, P):
    """Old high street: three narrow attached shop-houses, each its own colour and height, a shopfront and
    an awning on the ground floor, flats above under pitched roofs, chimneys on the party walls."""
    L = lot(M, P, 18, 20, bay_row(3))
    y0, y1 = L.y0 + 0.6, L.y1 - 0.4
    xs = [-8.0, -2.4, 2.8, 8.0]
    spec = [("hs_wall1", "res_roof", 8.6, "hs_awning"), ("hs_wall2", "res_roof2", 9.8, "hs_awning2"),
            ("hs_wall3", "res_roof", 8.0, "hs_awning")]
    for i, (wm, rm, ze, am) in enumerate(spec):
        x0, x1 = xs[i], xs[i + 1]
        box(M, x0, x1, y0, y1, 0, ze, P[wm])
        box(M, x0 + 0.4, x1 - 0.4, y0 - 0.06, y0, 0.3, 3.0, P["lm_glass"])
        box(M, x0, x1, y0 - 0.12, y0, 3.0, 3.35, P["res_trim"])
        _awning(M, x0 + 0.3, x1 - 0.3, y0, 3.25, 1.4, P[am])
        for fl in range(1, 3 if ze < 9 else 3):
            z = 3.0 + (fl - 1) * 2.9
            for k in range(2):
                wx = x0 + (x1 - x0) * (0.3 + 0.4 * k)
                box(M, wx - 0.45, wx + 0.45, y0 - 0.06, y0, z + 0.9, z + 2.3, P["lm_glass"])
        box(M, x0 - 0.05, x1 + 0.05, y0 - 0.15, y0, ze - 0.4, ze, P["res_trim"])
        gable(M, x0, x1, y0, y1, ze, ze + 2.6, "y" if i == 1 else "x", P[rm], P[wm],
              oh_u=(0.35, 0.35) if i != 1 else (0.0, 0.0), oh_a=(0.0, 0.0) if i != 1 else (0.3, 0.3))
        if i < 2:
            box(M, x1 - 0.35, x1 + 0.35, y1 - 2.6, y1 - 1.8, ze, ze + 3.2, P["res_trim"], bevel=0.04)
    return L


def b_modernflats(M, P):
    """Modern flats: two white mid-rise blocks with timber-clad corners and glass balcony bands, a green roof
    with solar panels on each, a lawn courtyard with young trees between them."""
    L = lot(M, P, 30, 30, bay_row(6))
    y0, y1 = L.y0, L.y1
    st = 3.0
    blocks = ((-13.5, -2.5, y0 + 1.0, y1 - 0.5, 6), (2.0, 13.5, y0 + 1.0, y0 + 10.5, 5),
              (2.0, 13.5, y0 + 10.5, y1 - 0.5, 4))
    for (x0, x1, b0, b1, n) in blocks:
        h = n * st
        box(M, x0, x1, b0, b1, 0, h, P["mf_wall"])
        box(M, x0 - 0.06, x0 + 2.6, b0 - 0.06, b0 + 2.6, 0, h, P["mf_wood"])
        for s in range(n):
            z = s * st
            band(M, x0, x1, b0, b1, z + 0.9, z + 2.4, P["mf_glass"], o=0.05)
            if s:
                # balcony slab and glass balustrade along the front
                box(M, x0 + 3.0, x1 - 0.4, b0 - 1.3, b0, z - 0.05, z + 0.15, P["mf_wall"])
                box(M, x0 + 3.0, x1 - 0.4, b0 - 1.32, b0 - 1.2, z + 0.15, z + 1.1, P["mf_rail"])
        box(M, x0 - 0.15, x1 + 0.15, b0 - 0.15, b1 + 0.15, h, h + 0.35, P["mf_dark"])
        box(M, x0 + 0.4, x1 - 0.4, b0 + 0.4, b1 - 0.4, h + 0.35, h + 0.45, P["mf_green"])
        nx = max(1, int((x1 - x0 - 2.0) // 2.4))
        for k in range(nx):
            px = x0 + 1.4 + k * 2.4
            M.loft([(px, b1 - 3.6, h + 0.5), (px + 2.0, b1 - 3.6, h + 0.5), (px + 2.0, b1 - 3.6, h + 0.55),
                    (px, b1 - 3.6, h + 0.55)],
                   [(px, b1 - 1.2, h + 1.2), (px + 2.0, b1 - 1.2, h + 1.2), (px + 2.0, b1 - 1.2, h + 1.25),
                    (px, b1 - 1.2, h + 1.25)], P["solar"])
        box(M, x1 - 3.0, x1 - 1.0, b0 + 1.0, b0 + 3.0, h + 0.45, h + 1.8, P["mf_dark"])
    # courtyard lawn between the blocks, entrance path from the front
    box(M, -2.5, 2.0, y0 + 1.0, y1 - 0.5, PAD_H, PAD_H + 0.04, P["grass"])
    box(M, -1.0, 0.6, y0, y1 - 0.5, PAD_H + 0.04, PAD_H + 0.07, P["path"])
    for y in (y0 + 6.0, y0 + 14.0, y1 - 3.0):
        tree(M, P, 1.2 if y > y0 + 10 else -1.6, y, 0.55, alt=y > y0 + 10)
    return L


def b_glasstower(M, P):
    """Glass tower: a two-storey glazed podium with shops, a slim blue-glass shaft with pale vertical fins and
    setbacks near the top, a lit crown and a roof plant deck."""
    L = lot(M, P, 30, 30, bay_row(6))
    y0, y1 = L.y0, L.y1
    # podium
    px0, px1, py0, py1 = -13.5, 13.5, y0 + 0.8, y1 - 0.5
    box(M, px0, px1, py0, py1, 0, 7.0, P["gt_podium"])
    band(M, px0, px1, py0, py1, 0.4, 6.4, P["gt_glass2"], o=0.05)
    box(M, px0 - 0.2, px1 + 0.2, py0 - 0.2, py1 + 0.2, 7.0, 7.5, P["gt_fin"])
    box(M, px0 + 0.3, px1 - 0.3, py0 + 0.3, py1 - 0.3, 7.5, 7.6, P["mf_green"])
    _awning(M, -6.0, 6.0, py0 - 0.05, 4.4, 2.0, P["gt_fin"])
    # shaft in three setbacks
    tiers = ((-8.5, 8.5, py0 + 2.5, py1 - 2.5, 7.6, 44.0), (-7.0, 7.0, py0 + 4.0, py1 - 4.0, 44.0, 52.0),
             (-5.0, 5.0, py0 + 5.5, py1 - 5.5, 52.0, 57.0))
    for (x0, x1, b0, b1, z0, z1) in tiers:
        box(M, x0, x1, b0, b1, z0, z1, P["gt_glass"])
        for k in range(1, int((x1 - x0) // 2.0)):
            x = x0 + k * 2.0
            box(M, x - 0.12, x + 0.12, b0 - 0.25, b0, z0, z1, P["gt_fin"])
            box(M, x - 0.12, x + 0.12, b1, b1 + 0.25, z0, z1, P["gt_fin"])
        for k in range(1, int((b1 - b0) // 2.0)):
            y = b0 + k * 2.0
            box(M, x0 - 0.25, x0, y - 0.12, y + 0.12, z0, z1, P["gt_fin"])
            box(M, x1, x1 + 0.25, y - 0.12, y + 0.12, z0, z1, P["gt_fin"])
        box(M, x0 - 0.3, x1 + 0.3, b0 - 0.3, b1 + 0.3, z1, z1 + 0.6, P["gt_fin"])
    x0, x1, b0, b1 = tiers[2][:4]
    frame(M, x0 - 0.3, x1 + 0.3, b0 - 0.3, b1 + 0.3, 57.6, 60.2, 0.5, P["gt_fin"])
    box(M, x0 + 1.0, x1 - 1.0, b0 + 1.0, b1 - 1.0, 57.6, 58.8, P["mf_dark"])
    cyl(M, x1 - 1.6, b1 - 1.6, 0.1, 58.8, 64.0, P["ind_steel"], n=5)
    return L


SERVICES = ("garbage", "firestation", "police", "clinic", "hospital", "school", "highschool", "university",
            "park", "parklarge", "windturbine", "coalplant", "solarfarm", "waterpump", "sewageoutlet",
            "townhall", "hamlethall", "villagehall", "cityhall", "stadium", "obstower", "concerthall", "skytower")


BUILDINGS = {
    "house": (b_house, 12, 15, 1),
    "terrace": (b_terrace, 24, 17, 3),
    "apartments": (b_apartments, 30, 30, 6),
    "shop": (b_shop, 18, 20, 4),
    "store": (b_store, 30, 28, 8),
    "mall": (b_mall, 48, 40, 14),
    "office": (b_office, 20, 22, 5),
    "tower": (b_tower, 30, 30, 9),
    "highstreet": (b_highstreet, 18, 20, 3),
    "modernflats": (b_modernflats, 30, 30, 6),
    "glasstower": (b_glasstower, 30, 30, 6),
    "mine": (b_mine, 26, 30, 2),
    "farm": (b_farm, 40, 40, 2),
    "works": (b_works, 36, 32, 4),
    "foodplant": (b_foodplant, 32, 30, 4),
    "loggingcamp": (b_loggingcamp, 36, 32, 2),
    "sawmill": (b_sawmill, 40, 34, 3),
    "ironmine": (b_ironmine, 38, 36, 3),
    "coalmine": (b_coalmine, 38, 36, 3),
    "quarry": (b_quarry, 42, 40, 3),
    "smelter": (b_smelter, 52, 44, 5),
    "cementworks": (b_cementworks, 48, 42, 4),
    "oilwell": (b_oilwell, 30, 30, 2),
    "sandpit": (b_sandpit, 40, 38, 3),
    "refinery": (b_refinery, 60, 50, 6),
    "glassworks": (b_glassworks, 46, 38, 4),
    "furniture": (b_furniture, 40, 34, 4),
    "constructionplant": (b_constructionplant, 50, 42, 5),
    "coppermine": (b_coppermine, 44, 40, 3),
    "coppersmelter": (b_coppersmelter, 50, 42, 4),
    "electronics": (b_electronics, 44, 36, 5),
    "machineworks": (b_machineworks, 52, 44, 5),
    "site_truckyard": (b_site_truckyard, 44, 30, 8),
    "site_hall_l": (b_site_hall_l, 60, 34, 0),
    "site_hall_m": (b_site_hall_m, 40, 26, 0),
    "site_silos": (b_site_silos, 24, 22, 0),
    "site_tanks": (b_site_tanks, 36, 24, 0),
    "site_office": (b_site_office, 26, 18, 0),
    "site_workshop": (b_site_workshop, 30, 22, 0),
    "site_field_g": (b_site_field_g, 64, 64, 0),
    "site_field_w": (b_site_field_w, 64, 64, 0),
    "site_barn": (b_site_barn, 30, 24, 0),
    "site_logyard": (b_site_logyard, 40, 30, 0),
    "site_heap_ore": (b_site_heap_ore, 30, 24, 0),
    "site_heap_coal": (b_site_heap_coal, 30, 24, 0),
    "site_heap_lime": (b_site_heap_lime, 30, 24, 0),
    "site_heap_sand": (b_site_heap_sand, 30, 24, 0),
    "site_heap_cu": (b_site_heap_cu, 30, 24, 0),
    # services
    "garbage": (b_garbage, 36, 32, 3),
    "firestation": (b_firestation, 26, 24, 3),
    "police": (b_police, 24, 22, 3),
    "clinic": (b_clinic, 26, 24, 3),
    "hospital": (b_hospital, 46, 40, 5),
    "school": (b_school, 40, 34, 4),
    "highschool": (b_highschool, 52, 42, 5),
    "university": (b_university, 70, 56, 6),
    "park": (b_park, 24, 24, 0),
    "parklarge": (b_parklarge, 48, 48, 0),
    "busstop": (b_busstop, 4.4, 1.8, 0),
    # utilities
    "windturbine": (b_windturbine, 16, 16, 0),
    "coalplant": (b_coalplant, 64, 52, 6),
    "solarfarm": (b_solarfarm, 60, 44, 2),
    "waterpump": (b_waterpump, 22, 20, 2),
    "sewageoutlet": (b_sewageoutlet, 22, 20, 2),
    # landmarks
    "townhall": (b_townhall, 40, 36, 4),
    "hamlethall": (b_hamlethall, 20, 18, 2),
    "villagehall": (b_villagehall, 28, 24, 3),
    "cityhall": (b_cityhall, 60, 50, 6),
    "stadium": (b_stadium, 72, 60, 8),
    "obstower": (b_obstower, 28, 28, 2),
    "concerthall": (b_concerthall, 52, 44, 6),
    "skytower": (b_skytower, 36, 36, 4),
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


def truck_base(Ms, P):
    """The rigid truck every freight body sits on: a forward cab (tinted "body"), chassis, bumpers, three axles."""
    body, glass, dark = Ms["body"], Ms["glass"], Ms["dark"]
    hw_cab = 1.2
    side_profile(body, [(-4.22, 0.62), (-2.3, 0.62), (-2.3, 2.95), (-3.95, 2.95), (-4.22, 2.62)],
                 hw_cab, P["body"])
    box(glass, -1.05, 1.05, -4.25, -4.22, 1.55, 2.5, P["glass"])    # windscreen
    for s in (-1, 1):
        x0, x1 = (hw_cab, hw_cab + 0.03) if s > 0 else (-hw_cab - 0.03, -hw_cab)
        box(glass, x0, x1, -4.0, -3.1, 1.65, 2.55, P["glass"])
    box(glass, -0.9, 0.9, -3.92, -3.62, 2.95, 3.04, P["glass"])     # roof light bar
    box(dark, -0.85, 0.85, -4.0, 4.1, 0.5, 0.98, P["dark"])          # chassis
    box(dark, -1.2, 1.2, -4.25, -4.05, 0.35, 0.8, P["dark"])         # front bumper
    box(dark, -1.1, 1.1, 4.0, 4.2, 0.3, 0.55, P["dark"])             # rear underrun bar
    for y in (-3.35, 1.95, 3.15):
        wheel_axle(dark, y, 0.5, 1.2, P["dark"])


def v_truck(Ms, P):
    """Box truck (goods, food): the box is the tinted cargo."""
    truck_base(Ms, P)
    box(Ms["cargo"], -1.25, 1.25, -2.1, 4.25, 0.98, 3.2, P["cargo"], bevel=0.04)


def v_tipper(Ms, P):
    """Tipper (ore, coal, limestone, sand, gravel): an open steel tub in the cab's colour, the load heaped in it."""
    body, dark, cargo = Ms["body"], Ms["dark"], Ms["cargo"]
    truck_base(Ms, P)
    y0, y1, zf, zt = -2.05, 4.25, 1.0, 2.35
    box(dark, -1.25, 1.25, y0, y1, 0.98, zf + 0.12, P["dark"])               # tub floor
    for s in (-1, 1):                                                         # side walls with a top rail
        box(body, s * 1.25 - 0.06, s * 1.25 + 0.06, y0, y1, zf, zt, P["body"])
        box(dark, s * 1.25 - 0.08, s * 1.25 + 0.08, y0, y1, zt - 0.12, zt + 0.02, P["dark"])
    box(body, -1.25, 1.25, y0, y0 + 0.16, zf, zt + 0.45, P["body"])          # headboard, taller, over the cab
    box(body, -1.22, 1.22, y0 - 0.5, y0, zt + 0.25, zt + 0.45, P["body"])    # its canopy lip
    box(body, -1.25, 1.25, y1 - 0.14, y1, zf, zt - 0.1, P["body"])           # tailgate
    for y in (y0 + 1.6, y0 + 3.2, y0 + 4.8):                                  # ribs on the outside of the walls
        for s in (-1, 1):
            box(dark, s * 1.31 - 0.04, s * 1.31 + 0.04, y - 0.08, y + 0.08, zf, zt - 0.05, P["dark"])
    # the load: a heap with a flat-ish crest, higher toward the front where it was tipped in
    taper(cargo, (-1.18, 1.18, y0 + 0.17, y1 - 0.15), (-0.55, 0.55, y0 + 0.9, y1 - 1.9), zf + 0.12, zt + 0.3,
          P["cargo"])


def _tube_y(M, y0, y1, rx, rz, cz, m, n=12):
    """Closed tube along Y with an elliptical section (rx wide, rz tall) centred on x = 0, z = cz."""
    ring = [(rx * math.cos(2 * math.pi * i / n), cz + rz * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return M.loft([(x, y0, z) for x, z in ring], [(x, y1, z) for x, z in ring], m)


def v_tanker(Ms, P):
    """Tanker (oil, fuel, chemicals): an oval tank in the cargo's colour on saddles, a walkway and hatches on top."""
    dark, cargo = Ms["dark"], Ms["cargo"]
    truck_base(Ms, P)
    y0, y1, rx, rz, cz = -1.95, 4.25, 1.22, 0.98, 2.0
    for y in (y0 + 0.4, y1 - 0.5):                                          # saddles
        box(dark, -1.0, 1.0, y - 0.15, y + 0.15, 0.98, cz - 0.3, P["dark"])
    _tube_y(cargo, y0 + 0.12, y1 - 0.12, rx, rz, cz, P["cargo"])
    _tube_y(cargo, y0, y0 + 0.12, rx - 0.08, rz - 0.08, cz, P["cargo"])     # dished ends, a step in
    _tube_y(cargo, y1 - 0.12, y1, rx - 0.08, rz - 0.08, cz, P["cargo"])
    top = cz + rz
    box(dark, -0.16, 0.16, y0 + 0.5, y1 - 0.6, top - 0.04, top + 0.05, P["dark"])   # walkway
    for y in (y0 + 1.3, (y0 + y1) / 2 + 0.2, y1 - 1.3):                           # hatches
        cyl(dark, 0.0, y, 0.3, top - 0.02, top + 0.12, P["dark"], n=6)
    box(dark, -1.2, 1.2, y1 - 0.25, y1, 0.98, 1.28, P["dark"])          # rear valves and bumper box


def v_flatbed(Ms, P):
    """Flatbed (logs, planks, steel, machinery): a dark deck behind a headboard, the load strapped down on it."""
    body, dark, cargo = Ms["body"], Ms["dark"], Ms["cargo"]
    truck_base(Ms, P)
    y0, y1, zd = -2.05, 4.25, 1.18
    box(dark, -1.25, 1.25, y0, y1, 0.98, zd, P["dark"])                          # deck
    box(body, -1.22, 1.22, y0, y0 + 0.14, zd, 2.95, P["body"])                   # headboard
    for y in (y0 + 0.9, y0 + 2.5, y0 + 4.1, y1 - 0.2):                           # stakes
        for s in (-1, 1):
            box(dark, s * 1.2 - 0.06, s * 1.2 + 0.06, y - 0.07, y + 0.07, zd, 2.15, P["dark"])
    # the load in two bundles, the rear one lower, straps over both
    box(cargo, -1.1, 1.1, y0 + 0.3, y0 + 3.2, zd, 2.35, P["cargo"], bevel=0.05)
    box(cargo, -1.1, 1.1, y0 + 3.35, y1 - 0.1, zd, 2.1, P["cargo"], bevel=0.05)
    for y, zt in ((y0 + 1.0, 2.35), (y0 + 2.5, 2.35), (y0 + 4.1, 2.1), (y0 + 5.5, 2.1)):
        box(dark, -1.14, 1.14, y - 0.08, y + 0.08, zt - 0.02, zt + 0.03, P["dark"])


# Service vehicles keep fixed colours: their nodes are paint / trim / lights (+ ladder), never "body" or
# "cargo", which the engine tints per instance.

def svc_mats(name, paint, trim, lights, extra=None):
    m = {"paint": mat(f"{name}_paint", paint), "trim": mat(f"{name}_trim", trim),
         "lights": mat(f"{name}_lights", lights)}
    if extra:
        m.update({k: mat(f"{name}_{k}", v) for k, v in extra.items()})
    return m


def v_garbagetruck(Ms, P):
    S = svc_mats("garbagetruck", "#2f8a4a", "#f4f5f2", "#f5a623")
    paint, trim, lights, glass, dark = Ms["paint"], Ms["trim"], Ms["lights"], Ms["glass"], Ms["dark"]
    hw = 1.2
    side_profile(trim, [(-4.22, 0.62), (-2.3, 0.62), (-2.3, 2.95), (-3.95, 2.95), (-4.22, 2.62)], hw, S["trim"])
    box(glass, -1.05, 1.05, -4.25, -4.22, 1.55, 2.5, P["glass"])
    box(glass, -hw - 0.02, hw + 0.02, -4.0, -3.1, 1.65, 2.55, P["glass"])
    box(paint, -hw - 0.02, hw + 0.02, -3.95, -2.45, 0.9, 1.25, S["paint"])          # green cab stripe
    box(lights, -0.85, 0.85, -3.7, -3.4, 2.95, 3.12, S["lights"])                    # amber beacon bar
    # green collection body, white side band, white compactor at the back with a sloped top
    box(paint, -1.24, 1.24, -2.2, 2.6, 0.98, 3.2, S["paint"])
    box(trim, -1.25, 1.25, -2.0, 2.4, 1.7, 2.0, S["trim"])
    extrude_profile(trim, [(2.6, 0.75), (4.25, 0.75), (4.25, 1.9), (3.7, 3.05), (2.6, 3.05)], "x", -1.2, 1.2,
                    S["trim"])
    box(dark, -0.85, 0.85, -4.0, 2.6, 0.5, 0.98, P["dark"])
    box(dark, -1.2, 1.2, -4.25, -4.05, 0.35, 0.8, P["dark"])
    box(dark, -1.0, 1.0, 4.2, 4.25, 0.9, 1.7, P["dark"])                             # hopper mouth
    for y in (-3.35, 1.25, 2.45):
        wheel_axle(dark, y, 0.5, 1.2, P["dark"])


def v_firetruck(Ms, P):
    S = svc_mats("firetruck", "#d8352e", "#f4f2ee", "#3d7cf0", {"ladder": "#d3d7dc"})
    paint, trim, lights, ladder, glass, dark = (Ms[k] for k in ("paint", "trim", "lights", "ladder", "glass", "dark"))
    hw = 1.23
    side_profile(paint, [(-4.22, 0.62), (-1.9, 0.62), (-1.9, 2.85), (-3.95, 2.85), (-4.22, 2.55)], hw, S["paint"])
    box(paint, -hw, hw, -1.9, 4.25, 0.85, 2.75, S["paint"])
    box(glass, -1.05, 1.05, -4.25, -4.22, 1.5, 2.4, P["glass"])
    box(glass, -hw - 0.015, hw + 0.015, -3.95, -2.2, 1.6, 2.45, P["glass"])
    box(trim, -1.25, 1.25, -4.2, 4.2, 1.1, 1.38, S["trim"])                           # white side stripe
    box(ladder, -hw - 0.015, hw + 0.015, -1.6, 3.9, 1.55, 2.6, S["ladder"])         # locker shutters
    box(lights, -0.95, 0.95, -3.85, -3.5, 2.85, 3.0, S["lights"])                    # blue light bar
    # roof ladder on a turntable at the back
    box(ladder, -0.85, 0.85, 3.0, 4.0, 2.75, 2.95, S["ladder"])
    for x in (-0.6, 0.48):
        box(ladder, x, x + 0.12, -3.3, 4.2, 2.95, 3.15, S["ladder"])
    for i in range(6):
        y = -2.9 + i * 1.2
        box(ladder, -0.48, 0.48, y - 0.05, y + 0.05, 2.98, 3.1, S["ladder"])
    box(dark, -0.85, 0.85, -4.0, 4.1, 0.5, 0.85, P["dark"])
    box(dark, -1.23, 1.23, -4.25, -4.05, 0.35, 0.8, P["dark"])
    for y in (-2.9, 2.6):
        wheel_axle(dark, y, 0.5, 1.2, P["dark"])


def v_ambulance(Ms, P):
    S = svc_mats("ambulance", "#f6f6f3", "#e0453a", "#3d7cf0")
    paint, trim, lights, glass, dark = Ms["paint"], Ms["trim"], Ms["lights"], Ms["glass"], Ms["dark"]
    hw = 0.95
    side_profile(paint, [(-2.72, 0.32), (-0.95, 0.32), (-0.95, 2.05), (-1.3, 2.05), (-2.02, 1.2), (-2.72, 1.02)],
                 hw, S["paint"])
    slab_on(glass, (-2.0, 1.24), (-1.34, 2.0), 0.86, 0.03, P["glass"])
    win = [(-1.7, 1.3), (-1.05, 1.3), (-1.05, 1.85), (-1.45, 1.85)]   # cab side windows, under the sloped nose
    extrude_profile(glass, win, "x", hw, hw + 0.015, P["glass"])
    extrude_profile(glass, win, "x", -hw - 0.015, -hw, P["glass"])
    # boxy patient module, red band round it, red cross on the roof, light bar at its front edge
    box(paint, -0.99, 0.99, -0.95, 2.75, 0.32, 2.48, S["paint"])
    box(trim, -1.0, 1.0, -0.94, 2.755, 1.05, 1.32, S["trim"])
    box(trim, -0.96, 0.96, -1.95, -0.95, 1.05, 1.2, S["trim"])
    cross_sign(trim, 0.0, 1.15, 1.3, 0.42, 2.48, 2.5, S["trim"])
    box(lights, -0.8, 0.0, -0.9, -0.55, 2.48, 2.62, S["lights"])
    box(trim, 0.0, 0.8, -0.9, -0.55, 2.48, 2.62, S["trim"])
    box(glass, -0.75, 0.75, 2.75, 2.755, 1.5, 2.1, P["glass"])
    box(glass, -0.85, 0.85, -2.75, -2.72, 0.66, 0.8, P["glass"])
    wheel_axle(dark, -1.8, 0.36, 0.94, P["dark"])
    wheel_axle(dark, 1.75, 0.36, 0.94, P["dark"])
    box(dark, -0.97, 0.97, -2.75, -2.6, 0.28, 0.58, P["dark"])
    box(dark, -0.97, 0.97, 2.6, 2.75, 0.28, 0.5, P["dark"])


def v_policecar(Ms, P):
    S = svc_mats("policecar", "#f6f7f9", "#2456b8", "#e0453a")
    paint, trim, lights, glass, dark = Ms["paint"], Ms["trim"], Ms["lights"], Ms["glass"], Ms["dark"]
    hw, s = 0.925, 4.6 / 4.4
    # blue lower body (hood and boot read from above), white doors and roof, red/blue light bar
    side_profile(trim, [(y * s, z) for y, z in [(-2.17, 0.28), (2.17, 0.28), (2.17, 0.76), (2.08, 0.9), (1.32, 0.95),
                                                (-0.92, 0.95), (-1.98, 0.83), (-2.17, 0.70)]], hw, S["trim"])
    taper(glass, (-0.84, 0.84, -0.92 * s, 1.32 * s), (-0.75, 0.75, -0.42 * s, 1.06 * s), 0.95, 1.37, P["glass"])
    taper(paint, (-0.76, 0.76, -0.43 * s, 1.07 * s), (-0.71, 0.71, -0.36 * s, 1.0 * s), 1.37, 1.45, S["paint"])
    box(paint, -0.93, 0.93, -0.95, 1.05, 0.4, 0.86, S["paint"])
    box(lights, -0.62, 0.0, 0.12, 0.46, 1.45, 1.6, S["lights"])
    box(trim, 0.0, 0.62, 0.12, 0.46, 1.45, 1.6, S["trim"])
    wheel_axle(dark, -1.38 * s, 0.32, 0.88, P["dark"])
    wheel_axle(dark, 1.36 * s, 0.32, 0.88, P["dark"])
    box(dark, -0.9, 0.9, -2.3, -2.14, 0.26, 0.52, P["dark"])
    box(dark, -0.9, 0.9, 2.14, 2.3, 0.26, 0.52, P["dark"])
    box(glass, -0.82, 0.82, -2.29, -2.26, 0.55, 0.67, P["glass"])


def v_bus(Ms, P):
    """City bus, 12 m. `body` (roof and lower skirt) is tinted with its line's colour; trim stays white."""
    S = {"trim": mat("bus_trim", "#f4f5f2"), "lights": mat("bus_lights", "#f5b82e")}
    body, trim, lights, glass, dark = Ms["body"], Ms["trim"], Ms["lights"], Ms["glass"], Ms["dark"]
    hw, L = 1.27, 6.0
    box(body, -hw, hw, -L, L, 0.32, 1.12, P["body"])                         # lower body
    box(glass, -hw + 0.02, hw - 0.02, -L + 0.06, L - 0.06, 1.12, 2.5, P["glass"])   # window band
    # white pillars between the windows, both sides
    for i in range(5):
        y = -4.4 + i * 2.1
        box(trim, -hw, hw, y, y + 0.16, 1.12, 2.5, S["trim"])
    box(trim, -hw, hw, -L + 0.02, -L + 0.4, 2.3, 2.5, S["trim"])          # header over the windscreen
    box(body, -hw, hw, -L, L, 2.5, 2.92, P["body"])                          # roof (line colour from above)
    box(trim, -0.9, 0.9, 0.2, 2.9, 2.92, 3.12, S["trim"])                    # roof AC pod
    box(glass, -1.12, 1.12, -L - 0.03, -L, 0.85, 2.28, P["glass"])          # windscreen
    box(lights, -0.95, 0.95, -L - 0.04, -L, 2.32, 2.52, S["lights"])        # destination sign
    box(glass, -0.95, 0.95, L, L + 0.03, 1.4, 2.3, P["glass"])              # rear window
    # doors on the kerb side (the right of travel: -X with the front at -Y), front and middle
    for y0, y1 in ((-5.55, -4.6), (-0.35, 0.95)):
        box(glass, -hw - 0.03, -hw, y0, y1, 0.4, 2.35, P["glass"])
    box(dark, -hw, hw, -L - 0.08, -L + 0.1, 0.22, 0.62, P["dark"])          # bumpers
    box(dark, -hw, hw, L - 0.1, L + 0.08, 0.22, 0.6, P["dark"])
    box(glass, -1.0, 1.0, -L - 0.09, -L - 0.06, 0.66, 0.8, P["glass"])      # headlight bar
    wheel_axle(dark, -3.9, 0.5, 1.22, P["dark"])
    wheel_axle(dark, 3.2, 0.5, 1.22, P["dark"])


VEHICLES = {
    "car": (v_car, ("body", "glass", "dark"), (1.85, 4.4, 1.45)),
    "van": (v_van, ("body", "glass", "dark"), (2.0, 5.0, 2.0)),
    "truck": (v_truck, ("body", "glass", "dark", "cargo"), (2.5, 8.5, 3.2)),
    "tipper": (v_tipper, ("body", "glass", "dark", "cargo"), (2.7, 8.5, 3.04)),
    "tanker": (v_tanker, ("body", "glass", "dark", "cargo"), (2.46, 8.5, 3.1)),
    "flatbed": (v_flatbed, ("body", "glass", "dark", "cargo"), (2.52, 8.5, 3.04)),
    "bus": (v_bus, ("body", "trim", "lights", "glass", "dark"), (2.575, 12.17, 3.12)),
    # services (fixed colours)
    "garbagetruck": (v_garbagetruck, ("paint", "trim", "lights", "glass", "dark"), (2.5, 8.5, 3.2)),
    "firetruck": (v_firetruck, ("paint", "trim", "lights", "ladder", "glass", "dark"), (2.5, 8.5, 3.15)),
    "ambulance": (v_ambulance, ("paint", "trim", "lights", "glass", "dark"), (2.0, 5.5, 2.62)),
    "policecar": (v_policecar, ("paint", "trim", "lights", "glass", "dark"), (1.86, 4.6, 1.6)),
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
            cap = 480 if "cargo" in parts else 300   # freight bodies carry more detail; there are far fewer of them
            if tris > cap:
                st["issues"].append(f"{tris} tris over {cap}")
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
        "Service buildings (garbage … university) follow the same lot rules. The parks (`park`,",
        "`parklarge`) are all grass: no asphalt strip and no `park_N` nodes.",
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
        "Service vehicles (garbagetruck, firetruck, ambulance, policecar) have fixed colours and no `body`",
        "or `cargo` node, so nothing on them is tinted: `paint` (main colour), `trim` (stripes, white parts),",
        "`lights` (beacons / light bar), `ladder` (firetruck only), plus `glass` and `dark` as above.",
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
            zoned = [built[n] for n in BUILDINGS if n not in SERVICES]
            services = [built[n] for n in SERVICES]
            overview(cam, zoned, "_overview_buildings.png", 56, 4, "top", 1600, 1200)
            overview(cam, zoned, "_overview_buildings_34.png", 56, 4, "q", 1600, 1200)
            overview(cam, services, "_overview_services.png", 78, 5, "top", 1800, 800)
            overview(cam, services, "_overview_services_34.png", 78, 5, "q", 1800, 1000)
            overview(cam, [built[n] for n in VEHICLES], "_overview_vehicles.png", 4.0, len(VEHICLES), "q", 1600, 600)
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

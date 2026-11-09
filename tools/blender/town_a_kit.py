# The towns' grown buildings, 1920-1940 (run into build_models.py like the civics files; the builders follow in
# town_b_homes.py, town_c_shops.py and town_d_towers.py).
#
# The game draws a grown building scaled to its lot (`fit`, 0.43 to 1.25) and stretched in height (`tall`, 0.7 to 2).
# A model made for one lot looks like a toy on a smaller one, so every model here is made FOR a lot: its builder works
# in real metres on the real lot (footprint x fit), and `_Site.finish` scales the result back up to the kind's
# footprint, so that the game's own scale lands doors, windows and storeys at their true size. The renderer picks,
# for each building, the model whose design fit and tall are nearest (src/render/townmodels.ts lists them).
#
# What the game reads from these models, beyond the mesh:
#   park_N      parking bays (as everywhere)
#   chimney_N   chimney smoke (as on the houses)
#   via_0       the end of the alley beside the building: cars drive in along it to the yard behind
#   body_0      the building itself, without its yard (centre, top; scale = half width, half depth): what a
#               building site fences and scaffolds, and what the night's light spills round
#   win_<kind>  materials: glass that lights at night. win_home, win_shop, win_office follow the hours of
#               src/render/daylight.ts; win_sign_* (signs, marquees, crowns) glow in their own colour all night.

import random as _random

TOWN_DESIGN = {}   # model -> (base kind, fit, tall); each GLB carries its own as the `design_0` empty

# Seen from the game's camera a town is half roofs: no two models of a kind get the same one. Black tar, pebble
# ballast, red-brown felt, weathered grey-green, pale gravel: each model takes three of them, by its number.
_ROOFS = ("#4f4a47", "#8e8676", "#6b5549", "#767c75", "#a39a85")


def _td(rot=0):
    T = {}
    for i, k in enumerate(("tar", "tar2", "tar4")):
        j = (rot + i * 2) % len(_ROOFS)
        T[k] = mat("td_roof%d" % j, _ROOFS[j])
    for k, v in {
        # brick and stone
        "brick_r": "#a85a43", "brick_r2": "#93483a", "brick_b": "#8a5a44", "brick_y": "#c9a274", "brick_t": "#b98a62",
        "brick_d": "#7a4238", "lime": "#e0d6bd", "lime2": "#cdc5ae", "lime3": "#b9b199", "terra": "#c9784e",
        "cream": "#ece3cb", "white": "#f1ede2",
        # trims and enamel
        "green": "#2a5a52", "oxblood": "#7c2f2c", "navy": "#2e4257", "mustard": "#c79b3b", "brass": "#b88a3a",
        "black": "#2b2d30", "door": "#4a342a", "door_g": "#27443e",
        # roofs
        "tar3": "#4a4643", "copper": "#6fa593", "glass": "#7f979f",
        "tin": "#9aa3a3", "tile": "#a8573f", "slate": "#5d646b",
        # iron, timber, yards
        "iron": "#2f3134", "wood": "#7a5a3c", "wood2": "#8f7354", "tank_roof": "#4a4038", "board": "#8a735a",
        "cinder": "#8f897c", "yard": "#a89b80", "paving": "#e4ddd0", "kerb": "#cfc7b4", "soil": "#7a6146",
        "lawn": "#8f9a4e", "hedge": "#4f7a3a", "steel": "#b8bfc2", "chrome": "#d5dadb",
        "wash1": "#e9e5d9", "wash2": "#c9d6e2", "wash3": "#d9b48a",
        # glass that lights at night
        "win_home": "#414b56", "win_shop": "#5d727c", "win_office": "#45515d", "win_sign_cream": "#f0e6c4",
        "win_sign_red": "#b23a30", "win_sign_gold": "#d1a548", "win_sign_green": "#2f6a5c", "win_sign_blue": "#3a5f8a",
    }.items():
        T[k] = mat("td_" + k if not k.startswith("win_") else k, v)
    return T


class _Face:
    """One wall seen from outside: `a` runs along it from its left end, `o` is out from it."""

    def __init__(self, ox, oy, ux, uy, ln):
        self.ox, self.oy, self.ux, self.uy, self.ln = ox, oy, ux, uy, ln
        self.nx, self.ny = uy, -ux

    def p(self, a, o, z):
        return (self.ox + self.ux * a + self.nx * o, self.oy + self.uy * a + self.ny * o, z)


def _faces(x0, x1, y0, y1):
    """The four walls of a block: f(ront, -y), r(ight, +x), b(ack), l(eft)."""
    return {"f": _Face(x0, y0, 1, 0, x1 - x0), "r": _Face(x1, y0, 0, 1, y1 - y0),
            "b": _Face(x1, y1, -1, 0, x1 - x0), "l": _Face(x0, y1, 0, -1, y1 - y0)}


def _quad(M, pts, m):
    f = M.bm.faces.new([M.bm.verts.new(p) for p in pts])
    f.material_index = M.mi(m)
    return f


def _wq(M, F, a0, a1, z0, z1, m, off=0.05):
    """A flat panel on a wall (a window, a door, a sign's letter): one quad standing `off` proud of it."""
    return _quad(M, [F.p(a0, off, z0), F.p(a1, off, z0), F.p(a1, off, z1), F.p(a0, off, z1)], m)


def _fbox(M, F, a0, a1, o0, o1, z0, z1, m, bevel=0.0):
    """A box given along and out from a wall."""
    p, q = F.p(a0, o0, 0), F.p(a1, o1, 0)
    return box(M, min(p[0], q[0]), max(p[0], q[0]), min(p[1], q[1]), max(p[1], q[1]), z0, z1, m, bevel)


def _beam(M, p, q, wd, th, m):
    """A sloping bar between two points (a fire escape's stair, a brace)."""
    dx, dy = q[0] - p[0], q[1] - p[1]
    ln = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / ln * wd / 2, dx / ln * wd / 2
    loop = lambda c: [(c[0] + nx, c[1] + ny, c[2] - th / 2), (c[0] - nx, c[1] - ny, c[2] - th / 2),
                      (c[0] - nx, c[1] - ny, c[2] + th / 2), (c[0] + nx, c[1] + ny, c[2] + th / 2)]
    return M.loft(loop(p), loop(q), m)


def _wins(M, F, a0, a1, z0, floors, fh, m, ww=1.1, wh=1.7, pitch=2.6, sill=0.95, off=0.05, cols=None, skip=(),
          lintel=None, sillm=None):
    """A grid of windows on a wall: `cols` columns (or one every `pitch`) between a0 and a1, one row a floor."""
    n = cols if cols is not None else max(1, int((a1 - a0) / pitch + 0.15))
    step = (a1 - a0) / n
    for i in range(n):
        c = a0 + step * (i + 0.5)
        for k in range(floors):
            if (i, k) in skip or i in skip:
                continue
            z = z0 + k * fh + sill
            _wq(M, F, c - ww / 2, c + ww / 2, z, z + wh, m, off)
            if lintel is not None:
                _wq(M, F, c - ww / 2 - 0.12, c + ww / 2 + 0.12, z + wh, z + wh + 0.24, lintel, off)
            if sillm is not None:
                _wq(M, F, c - ww / 2 - 0.1, c + ww / 2 + 0.1, z - 0.14, z, sillm, off)
    return n


def _letters(M, F, a0, a1, z0, z1, m, off, seed=1, n=None):
    """Lettering on a sign, as it reads from the air: a row of blocks of uneven width, in words."""
    r = _random.Random(seed)
    h = z1 - z0
    n = n or max(3, min(9, int((a1 - a0) / (h * 0.95))))
    ws = [r.choice((0.55, 0.7, 0.7, 0.85)) for _ in range(n)]
    gaps = [0.3 if r.random() > 0.2 else 0.9 for _ in range(n - 1)]
    k = (a1 - a0) / (sum(ws) + sum(gaps))
    a = a0
    for i in range(n):
        _wq(M, F, a, a + ws[i] * k, z0, z1, m, off)
        a += (ws[i] + (gaps[i] if i < n - 1 else 0)) * k


def _awn(M, F, a0, a1, z, depth, c1, c2, drop=0.75, stripe=0.85, val=0.28):
    """A striped canvas awning let down over the pavement."""
    n = max(1, round((a1 - a0) / stripe))
    st = (a1 - a0) / n
    for i in range(n):
        m = c1 if i % 2 == 0 else c2
        b0, b1 = a0 + i * st, a0 + (i + 1) * st
        _quad(M, [F.p(b0, depth, z - drop), F.p(b1, depth, z - drop), F.p(b1, 0.02, z), F.p(b0, 0.02, z)], m)
        _quad(M, [F.p(b0, depth, z - drop - val), F.p(b1, depth, z - drop - val), F.p(b1, depth, z - drop),
                  F.p(b0, depth, z - drop)], m)
    # the ends
    _quad(M, [F.p(a0, 0.02, z), F.p(a0, depth, z - drop), F.p(a0, depth, z - drop - val), F.p(a0, 0.02, z - drop - val)], c1)
    _quad(M, [F.p(a1, 0.02, z - drop - val), F.p(a1, depth, z - drop - val), F.p(a1, depth, z - drop), F.p(a1, 0.02, z)], c1)


def _shopfront(S, F, a0, a1, z0, h, frame_m, sign_m, awn=None, door=0.5, letters=None, seed=1, depth=1.3, glass=None):
    """A shopfront in a wall: display windows on a low stall riser either side of the door, the painted fascia sign
    over them, a striped awning over the pavement."""
    M, T = S.M, S.T
    glass = glass or T["win_shop"]
    dc, dw = a0 + (a1 - a0) * door, 1.1
    _wq(M, F, a0, a1, z0, z0 + h - 0.9, frame_m, 0.04)
    for b0, b1 in ((a0 + 0.22, dc - dw / 2 - 0.14), (dc + dw / 2 + 0.14, a1 - 0.22)):
        if b1 - b0 > 0.5:
            _wq(M, F, b0, b1, z0 + 0.55, z0 + h - 1.1, glass, 0.07)
    _wq(M, F, dc - dw / 2, dc + dw / 2, z0, z0 + 2.15, T["door"], 0.07)
    _wq(M, F, dc - dw / 2 + 0.16, dc + dw / 2 - 0.16, z0 + 0.85, z0 + 1.95, glass, 0.09)
    _fbox(M, F, a0, a1, 0, 0.14, z0 + h - 0.9, z0 + h - 0.08, sign_m)
    if letters is not None:
        _letters(M, F, a0 + 0.5, a1 - 0.5, z0 + h - 0.72, z0 + h - 0.26, letters, 0.16, seed)
    if awn:
        _awn(M, F, a0 - 0.05, a1 + 0.05, z0 + h - 0.95, depth, awn[0], awn[1])


def _roof(S, x0, x1, y0, y1, z, wall, tar, cop=None, par=0.8, t=0.28):
    """A flat roof behind a parapet with a coping. Returns the parapet's top."""
    M = S.M
    box(M, x0 + t, x1 - t, y0 + t, y1 - t, z, z + 0.05, tar)
    frame(M, x0, x1, y0, y1, z, z + par, t, wall)
    if cop is not None:
        frame(M, x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, z + par, z + par + 0.12, t + 0.1, cop)
        return z + par + 0.12
    return z + par


def _rim(S, x0, x1, y0, y1, z, tar, t=0.3):
    """A roof drawn the cheap way, for the small roofs high on a tower: a slab inset from the walls' top."""
    box(S.M, x0 + t, x1 - t, y0 + t, y1 - t, z - 0.02, z + 0.04, tar)


def _cornice(S, x0, x1, y0, y1, z, m, proj=0.28, h=0.4, sides="fblr"):
    """A cornice or a belt course round a block (or along some of its walls)."""
    M = S.M
    if "f" in sides:
        box(M, x0 - proj, x1 + proj, y0 - proj, y0 + 0.05, z, z + h, m)
    if "b" in sides:
        box(M, x0 - proj, x1 + proj, y1 - 0.05, y1 + proj, z, z + h, m)
    if "l" in sides:
        box(M, x0 - proj, x0 + 0.05, y0 + 0.05, y1 - 0.05, z, z + h, m)
    if "r" in sides:
        box(M, x1 - 0.05, x1 + proj, y0 + 0.05, y1 - 0.05, z, z + h, m)


def _tank(S, x, y, z, r=1.35, h=2.3, leg=1.4, wood=None):
    """A wooden roof tank on its iron legs, under a conical cap."""
    M, T = S.M, S.T
    k = r * 0.62
    for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        box(M, x + dx * k - 0.08, x + dx * k + 0.08, y + dy * k - 0.08, y + dy * k + 0.08, z, z + leg, T["iron"])
    cyl(M, x, y, r, z + leg, z + leg + h, wood or T["wood"], n=8)
    cone(M, x, y, r * 1.1, z + leg + h, z + leg + h + r * 0.6, T["tank_roof"], n=8)


def _bulkhead(S, x, y, z, w=2.4, d=3.0, h=2.4, wall=None, face="f"):
    """A stair bulkhead: the little house a roof's stair comes up in, with its door."""
    M, T = S.M, S.T
    box(M, x - w / 2, x + w / 2, y - d / 2, y + d / 2, z, z + h, wall or T["brick_b"])
    box(M, x - w / 2 - 0.08, x + w / 2 + 0.08, y - d / 2 - 0.08, y + d / 2 + 0.08, z + h, z + h + 0.1, T["tar3"])
    F = _faces(x - w / 2, x + w / 2, y - d / 2, y + d / 2)[face]
    _wq(M, F, F.ln / 2 - 0.45, F.ln / 2 + 0.45, z, z + 2.0, T["door"], 0.04)


def _skylight(S, x0, x1, y0, y1, z, glass=None):
    """A hipped glass skylight on a kerb."""
    M, T = S.M, S.T
    box(M, x0, x1, y0, y1, z, z + 0.3, T["tar3"])
    ym, xm = (y0 + y1) / 2, (x0 + x1) / 2
    if x1 - x0 >= y1 - y0:
        taper(M, (x0 + 0.08, x1 - 0.08, y0 + 0.08, y1 - 0.08), (x0 + 0.5, x1 - 0.5, ym - 0.03, ym + 0.03), z + 0.3, z + 0.3 + (y1 - y0) * 0.32, glass or T["glass"])
    else:
        taper(M, (x0 + 0.08, x1 - 0.08, y0 + 0.08, y1 - 0.08), (xm - 0.03, xm + 0.03, y0 + 0.5, y1 - 0.5), z + 0.3, z + 0.3 + (x1 - x0) * 0.32, glass or T["glass"])


def _chimney(S, x, y, z0, z1, m, w=0.7, d=0.7, smoke=True, cap=None):
    M = S.M
    box(M, x - w / 2, x + w / 2, y - d / 2, y + d / 2, z0, z1, m)
    if cap is not None:
        box(M, x - w / 2 - 0.06, x + w / 2 + 0.06, y - d / 2 - 0.06, y + d / 2 + 0.06, z1, z1 + 0.14, cap)
        z1 += 0.14
    if smoke:
        emitter(M, "chimney", x, y, z1, 0.6)


def _vent(S, x, y, z, r=0.28, h=0.9):
    cyl(S.M, x, y, r, z, z + h, S.T["tin"], n=6)
    cone(S.M, x, y, r * 1.6, z + h, z + h + r * 1.1, S.T["tin"], n=6)


def _fire_escape(S, F, a0, a1, z0, floors, fh, first=1):
    """Iron fire escape balconies up a wall, stairs zigzagging between them, a drop ladder at the foot."""
    M, iron = S.M, S.T["iron"]
    for k in range(first, floors):
        z = z0 + k * fh + 0.75
        _fbox(M, F, a0, a1, 0, 1.0, z - 0.09, z, iron)
        _fbox(M, F, a0, a1, 0.92, 1.0, z + 0.8, z + 0.9, iron)
        if k > first:
            lo, hi = (a0 + 0.25, a1 - 0.6) if k % 2 else (a1 - 0.25, a0 + 0.6)
            _beam(M, F.p(lo, 0.5, z - fh), F.p(hi, 0.5, z - 0.05), 0.55, 0.12, iron)
    zb = z0 + first * fh + 0.75
    _fbox(M, F, a1 - 0.6, a1 - 0.2, 0.45, 0.57, zb - 2.3, zb - 0.09, iron)


def _stoop(S, F, a, z0, rise=1.0, w=1.5, m=None, door=None, hood=None):
    """Steps up to a front door (a stoop), the door, a hood over it."""
    M, T = S.M, S.T
    m = m or T["lime2"]
    _fbox(M, F, a - w / 2, a + w / 2, 0, 0.75, z0, z0 + rise, m)
    _fbox(M, F, a - w / 2 + 0.1, a + w / 2 - 0.1, 0.75, 1.45, z0, z0 + rise * 0.5, m)
    _wq(M, F, a - 0.5, a + 0.5, z0 + rise, z0 + rise + 2.15, door or T["door"], 0.05)
    if hood is not None:
        _fbox(M, F, a - w / 2 - 0.1, a + w / 2 + 0.1, 0, 0.7, z0 + rise + 2.3, z0 + rise + 2.5, hood)


def _blade(S, F, a, o0, o1, z0, z1, m, letters=None, th=0.24):
    """A vertical blade sign standing out from a wall, lettered down both sides."""
    M = S.M
    _fbox(M, F, a - th / 2, a + th / 2, o0, o1, z0, z1, m)
    if letters is not None:
        n = max(3, int((z1 - z0 - 0.6) / 0.95))
        st = (z1 - z0 - 0.6) / n
        for s in (-1, 1):
            # (the two broad sides of the blade are walls facing along the front)
            G = _Face(*F.p(a + s * th / 2, o1 if s > 0 else o0, 0)[:2], F.nx * -s, F.ny * -s, o1 - o0)
            for i in range(n):
                z = z0 + 0.3 + i * st
                _wq(M, G, 0.18, (o1 - o0) - 0.18, z + st * 0.15, z + st * 0.85, letters, 0.03)


def _roofsign(S, x0, x1, y, z, h, m, letters, seed=3, legs=1.2):
    """A sign standing on a roof on an iron frame, lettered to the street."""
    M, T = S.M, S.T
    n = max(2, int((x1 - x0) / 3.5) + 1)
    for i in range(n):
        x = x0 + 0.2 + (x1 - x0 - 0.4) * i / (n - 1)
        box(M, x - 0.07, x + 0.07, y - 0.07, y + 0.07, z, z + legs + h, T["iron"])
        _beam(M, (x, y + 0.1, z + legs + h * 0.6), (x, y + 1.5, z + 0.1), 0.1, 0.1, T["iron"])
    box(M, x0, x1, y - 0.16, y - 0.06, z + legs, z + legs + h, m)
    F = _Face(x0, y - 0.16, 1, 0, x1 - x0)
    _letters(M, F, 0.4, (x1 - x0) - 0.4, z + legs + h * 0.22, z + legs + h * 0.78, letters, 0.03, seed)


def _washline(S, x0, x1, y, z=2.0, seed=1):
    """A washing line across a yard between two posts, the wash on it."""
    M, T = S.M, S.T
    r = _random.Random(seed)
    for x in (x0, x1):
        box(M, x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0, z + 0.15, T["wood"])
    F = _Face(x0, y, 1, 0, x1 - x0)
    a = 0.4
    while a < (x1 - x0) - 1.0:
        w = r.choice((0.5, 0.7, 0.9))
        m = T[r.choice(("wash1", "wash1", "wash2", "wash3"))]
        h = r.choice((0.6, 0.8, 1.0))
        _wq(M, F, a, a + w, z - h, z, m, 0.0)
        _quad(M, [F.p(a + w, 0.0, z - h), F.p(a, 0.0, z - h), F.p(a, 0.0, z), F.p(a + w, 0.0, z)], m)
        a += w + r.choice((0.2, 0.35, 0.8))


def _cans(S, x, y, n=3, along="x"):
    """Ash cans by a back door."""
    for i in range(n):
        cx, cy = (x + i * 0.75, y) if along == "x" else (x, y + i * 0.75)
        cyl(S.M, cx, cy, 0.3, 0, 0.95, S.T["tin"], n=6)


def _tree(S, x, y, s=0.8, alt=False):
    """A yard tree (the season's shader takes its green for leaves: it turns and falls with the rest)."""
    tree(S.M, S.P, x, y, s, alt)


def _yard_extra(S, x0, x1, yb, kind):
    """The back corner of a yard: a brick garage, a board shed under a tin roof, or the crates and barrels."""
    M, T = S.M, S.T
    w = x1 - x0
    if kind == 0:
        d = 2.5
        box(M, x0, x1, yb - d, yb - 0.12, 0, 2.45, T["brick_b"])
        box(M, x0 - 0.1, x1 + 0.1, yb - d - 0.15, yb - 0.05, 2.45, 2.57, T["tar3"])
        F = _Face(x0, yb - d, 1, 0, w)
        n = 2 if w > 4.6 else 1
        for i in range(n):
            _wq(M, F, i * w / n + 0.3, (i + 1) * w / n - 0.3, 0, 2.05, T["door_g"], 0.04)
    elif kind == 1:
        d, xe = 2.2, x0 + min(3.2, w)
        box(M, x0, xe, yb - d, yb - 0.12, 0, 2.0, T["board"])
        _quad(M, [(x0 - 0.12, yb - d - 0.2, 2.0), (xe + 0.12, yb - d - 0.2, 2.0), (xe + 0.12, yb - 0.05, 2.45), (x0 - 0.12, yb - 0.05, 2.45)], T["tin"])
        _wq(M, _Face(x0, yb - d, 1, 0, xe - x0), 0.5, 1.5, 0, 1.9, T["door"], 0.04)
        if x1 - xe > 1.4:
            box(M, xe + 0.3, xe + 1.3, yb - 1.4, yb - 0.4, 0, 0.9, T["wood2"])
    else:
        box(M, x0 + 0.1, x0 + 1.2, yb - 1.5, yb - 0.4, 0, 1.0, T["wood2"])
        box(M, x0 + 0.3, x0 + 1.0, yb - 1.3, yb - 0.6, 1.0, 1.65, T["wood"])
        box(M, x0 + 1.4, x0 + 2.3, yb - 1.3, yb - 0.4, 0, 0.8, T["wood"])
        if w > 3.6:
            cyl(M, x0 + 3.0, yb - 0.8, 0.33, 0, 0.9, T["oxblood"], n=6)
            cyl(M, x0 + 3.2, yb - 1.6, 0.33, 0, 0.9, T["green"], n=6)


class _Site:
    """A building lot at its real size (m), the origin at its middle, the street along -y."""

    def __init__(self, M, P, w, d, fit, tall, rot=0):
        self.M, self.P, self.T = M, P, _td(rot)
        self.rot = rot
        self.w, self.d, self.fit, self.tall = w, d, fit, tall
        self.W, self.D = w * fit, d * fit
        self.xl, self.xr, self.yf, self.yb = -self.W / 2, self.W / 2, -self.D / 2, self.D / 2
        self.bays, self.via, self.body = [], None, None

    def ground(self, x0, x1, y0, y1, m, h=PAD_H):
        if x1 - x0 > 0.01 and y1 - y0 > 0.01:
            box(self.M, x0, x1, y0, y1, 0, h, m)

    def lot(self, front=1.6, alley=3.2, yard=6.8, nbays=3, front_m=None, tandem=False, fence="board", yard_m=None,
            under=None, side=0.4, extra="auto"):
        """The usual town lot: the building up at the pavement (a strip of paving or garden `front` deep before
        it), an alley down the +x side and a yard behind, the cars in a row along its back fence (or, `tandem`,
        one behind the other up the alley). Returns the building's rectangle x0, x1, y0, y1."""
        T = self.T
        ax = self.xr - alley
        y0, y1 = self.yf + front, self.yb - yard
        self.ground(self.xl, ax, self.yf, y0, front_m or T["paving"])
        self.ground(self.xl, ax, y0, y1, under or T["kerb"])
        self.ground(ax, self.xr, self.yf, y1, T["cinder"])
        self.ground(self.xl, self.xr, y1, self.yb, yard_m or T["cinder"])
        ac = ax + alley / 2
        if tandem:
            self.bays = [(ac, self.yb - 0.7 - BAY_L / 2 - i * (BAY_L + 0.5)) for i in range(nbays)]
            self.via = (ac, self.yf + 1.5)
        else:
            self.bays = [(self.xl + 0.6 + BAY_W * (i + 0.5), self.yb - 0.5 - BAY_L / 2) for i in range(nbays)]
            self.via = (ac, y1 + min(2.2, yard * 0.3))
        if fence:
            m = {"board": T["board"], "white": T["white"], "green": T["green"]}[fence]
            box(self.M, self.xl, self.xr, self.yb - 0.1, self.yb, 0, 1.7, m)
            if yard > 1.5:
                box(self.M, self.xl, self.xl + 0.1, y1, self.yb - 0.1, 0, 1.7, m)
        # what stands in the yard's far corner, past the cars and clear of the way in: a garage, a shed, crates
        ex0, ex1 = self.xl + 0.6 + nbays * BAY_W + 1.6, ax - 0.4
        if extra and not tandem and yard >= 6 and ex1 - ex0 >= 2.6:
            _yard_extra(self, ex0, min(ex1, ex0 + 5.2), self.yb, (self.rot if extra == "auto" else extra) % 3)
        self.body = (self.xl + side, ax - 0.35, y0, y1)
        return self.body

    def finish(self):
        sx, sz = 1 / self.fit, 1 / (self.fit * self.tall)
        for v in self.M.bm.verts:
            v.co.x *= sx
            v.co.y *= sx
            v.co.z *= sz
        self.M.fx = [(k, x * sx, y * sx, z * sz, s) for k, x, y, z, s in self.M.fx]
        if self.via:
            self.M.fx.append(("via", self.via[0] * sx, self.via[1] * sx, PAD_H, 1.0))
        self.M.fx.append(("design", 0.0, 0.0, 0.0, (self.fit, self.tall, 1.0)))
        if self.body:
            x0, x1, y0, y1, top = self.body
            self.M.fx.append(("body", (x0 + x1) / 2 * sx, (y0 + y1) / 2 * sx, top * sz,
                              ((x1 - x0) / 2 * sx, (y1 - y0) / 2 * sx, 1.0)))
        L = Lot(self.w, self.d)
        L.bays = [(x * sx, y * sx) for x, y in self.bays]
        return L


def _town(name, kind, fit, tall, nbays, fn, rear=True, **kw):
    """Register a town model: `kind`'s footprint, made for lots where the game scales it by `fit` and `tall`."""
    w, d = BUILDINGS[kind][1], BUILDINGS[kind][2]
    rot = len(TOWN_DESIGN)

    def build(M, P):
        S = _Site(M, P, w, d, fit, tall, rot)
        fn(S, nbays=nbays, **kw)
        assert S.body is not None and len(S.body) == 5, name
        return S.finish()

    build.__doc__ = fn.__doc__
    BUILDINGS[name] = (build, w, d, nbays)
    TOWN_DESIGN[name] = (kind, fit, tall)
    if rear:
        REAR_PARK.add(name)

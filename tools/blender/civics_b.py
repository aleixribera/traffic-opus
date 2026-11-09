# Civic buildings, batch B (src/game/civics.ts): the water tower, the picture house, the county hospital, the
# ballpark, the county courthouse with its clock tower and the market hall. A town gets one when the player
# completes a town order for it. Exec'd into build_models.py's globals (see the hook after BUILDINGS), so it
# uses the helpers there (box, cyl, cone, taper, gable, _hip, band, frame, revolve, ribbon, poly_prism, tree,
# bench, fountain, _flagpole, Lot, ...). Helpers here carry a _cvb_ prefix; materials a cvb_ prefix.


# ------------------------------------------------------------------ batch B helpers

def _cvb_mats():
    return {
        "brick": mat("cvb_brick", "#a35a43"),
        "brick2": mat("cvb_brick2", "#8c4b39"),
        "cream": mat("cvb_cream", "#e9dfc6"),
        "stone": mat("cvb_stone", "#e3d9c2"),
        "stone2": mat("cvb_stone2", "#cbbfa4"),
        "tar": mat("cvb_tar", "#6f6c66"),
        "tar2": mat("cvb_tar2", "#7f7a71"),
        "tin": mat("cvb_tin", "#6b7486"),
        "lead": mat("cvb_lead", "#97948a"),
        "slate": mat("cvb_slate", "#5f6670"),
        "navy": mat("cvb_navy", "#2f4a78"),
        "red": mat("cvb_red", "#a13e36"),
        "gilt": mat("cvb_gilt", "#c49a3e"),
        "win": mat("cvb_win", "#46505e"),
        "vitro": mat("cvb_vitro", "#2a2f3a"),
        "glass": mat("cvb_glass", "#93a9b3"),
        "iron": mat("cvb_iron", "#3d4847"),
        "copper": mat("cvb_copper", "#6f9e8a"),
        "steel": mat("cvb_steel", "#c3c8c4"),
        "steel2": mat("cvb_steel2", "#a9afab"),
        "chain": mat("cvb_chain", "#9fa29c"),
        "clay": mat("cvb_clay", "#b07f57"),
        "clay2": mat("cvb_clay2", "#9c6f4a"),
        "turf": mat("cvb_turf", "#7f9447"),
        "turf2": mat("cvb_turf2", "#8b9f50"),
        "boards": mat("cvb_boards", "#4c5d43"),
        "seat": mat("cvb_seat", "#5d7a55"),
        "wood": mat("cvb_wood", "#9a7650"),
        "flower": mat("cvb_flower", "#b4574a"),
    }


def _cvb_ground(M, w, d, m):
    """The lot's own ground over the whole footprint, no parking bays."""
    L = Lot(w, d)
    L.bays = []
    box(M, -w / 2, w / 2, -d / 2, d / 2, 0, PAD_H, m)
    return L


def _cvb_rod(M, p, q, t, m):
    """Square bar of side t between two 3D points (legs, braces)."""
    p, q = Vector(p), Vector(q)
    dv = (q - p).normalized()
    a = Vector((0, 0, 1)) if abs(dv.z) < 0.9 else Vector((1, 0, 0))
    u = dv.cross(a).normalized() * (t / 2)
    v = dv.cross(u).normalized() * (t / 2)
    sq = [u + v, -u + v, -u - v, u - v]
    M.loft([tuple(p + o) for o in sq], [tuple(q + o) for o in sq], m)


def _cvb_disc(M, cx, cy, cz, r, axis, t, m, n=12):
    """Flat disc (clock face) standing on a wall: axis '-y' faces the street, 'x' / '-x' / 'y' the others."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        u, v = r * math.cos(a), r * math.sin(a)
        pts.append((u, v))
    s = -1 if axis.startswith("-") else 1
    if axis.endswith("y"):
        lo = [(cx + u, cy, cz + v) for u, v in pts]
        hi = [(cx + u, cy + s * t, cz + v) for u, v in pts]
    else:
        lo = [(cx, cy + u, cz + v) for u, v in pts]
        hi = [(cx + s * t, cy + u, cz + v) for u, v in pts]
    M.loft(lo, hi, m)


def _cvb_clock(M, P, C, cx, cy, cz, r, axis):
    """A clock on a wall: gilt ring, pale face, two dark hands (ten past ten)."""
    _cvb_disc(M, cx, cy, cz, r, axis, 0.08, C["gilt"], n=12)
    s = -1 if axis.startswith("-") else 1
    o = 0.08 * s
    if axis.endswith("y"):
        _cvb_disc(M, cx, cy + o, cz, r * 0.84, axis, 0.04, P["lm_clock"], n=12)
        y = cy + o + 0.04 * s
        _cvb_rod(M, (cx, y, cz), (cx - 0.45 * r, y, cz + 0.32 * r), 0.1 * r, P["ind_dark"])
        _cvb_rod(M, (cx, y, cz), (cx + 0.55 * r, y, cz + 0.45 * r), 0.07 * r, P["ind_dark"])
    else:
        _cvb_disc(M, cx + o, cy, cz, r * 0.84, axis, 0.04, P["lm_clock"], n=12)
        x = cx + o + 0.04 * s
        _cvb_rod(M, (x, cy, cz), (x, cy - 0.45 * r, cz + 0.32 * r), 0.1 * r, P["ind_dark"])
        _cvb_rod(M, (x, cy, cz), (x, cy + 0.55 * r, cz + 0.45 * r), 0.07 * r, P["ind_dark"])


def _cvb_rrect(x0, x1, y0, y1, rf, rb=0.0, n=4):
    """Rectangle outline (CCW) with the front corners rounded by rf and the back ones by rb."""
    def arc(cx, cy, r, a0, a1):
        if r <= 1e-6:
            return [(cx, cy)]
        return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n))
                for i in range(n + 1)]
    pts = arc(x0 + rf, y0 + rf, rf, math.pi, 1.5 * math.pi)
    pts += arc(x1 - rf, y0 + rf, rf, 1.5 * math.pi, 2 * math.pi)
    pts += arc(x1 - rb, y1 - rb, rb, 0.0, 0.5 * math.pi)
    pts += arc(x0 + rb, y1 - rb, rb, 0.5 * math.pi, math.pi)
    return pts


def _cvb_arch(half, zs, rise, n, grow=0.0):
    """Segmental arch from (-half, zs) over to (half, zs) with the given rise, as (u, z) points, left to right;
    grow pushes the curve out radially (a thicker shell or a rib over it)."""
    R = (half * half + rise * rise) / (2 * rise)
    zc = zs + rise - R
    phi = math.asin(half / R)
    return [((R + grow) * math.sin(-phi + 2 * phi * i / n), zc + (R + grow) * math.cos(-phi + 2 * phi * i / n))
            for i in range(n + 1)]


def _cvb_arch_z(half, zs, rise, u):
    R = (half * half + rise * rise) / (2 * rise)
    return zs + rise - R + math.sqrt(max(R * R - u * u, 0.0))


def _cvb_fence(M, C, pts, h=2.1, step=3.0):
    """Chain-link fence along a polyline: galvanised posts, a top rail and the grey mesh between them."""
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        bar(M, (ax, ay), (bx, by), 0.04, 0.12, h - 0.1, C["chain"])
        bar(M, (ax, ay), (bx, by), 0.09, h - 0.1, h, C["steel2"])
        n = max(1, int(round(math.hypot(bx - ax, by - ay) / step)))
        for i in range(n + 1):
            px, py = ax + (bx - ax) * i / n, ay + (by - ay) * i / n
            box(M, px - 0.07, px + 0.07, py - 0.07, py + 0.07, 0, h + 0.06, C["steel2"])


# ------------------------------------------------------------------ water tower

def b_watertower(M, P):
    """Water tower: a silver steel tank with a conical cap and a town-name band, on six raking legs with X
    bracing and a catwalk round the tank; a small brick pump house and a chain-link gravel yard."""
    C = _cvb_mats()
    L = _cvb_ground(M, 24, 24, P["grass"])
    z = PAD_H
    f = 10.2
    box(M, -f, f, -f, f, z, z + 0.03, P["gravel"])
    box(M, -1.7, 1.7, -12.0, -f, z, z + 0.04, P["concrete"])
    cx, cy = 1.2, 1.8
    ribbon(M, [(0.0, -f), (0.0, -6.0), (cx, cy - 1.6)], 2.6, z + 0.03, z + 0.07, P["concrete"])
    box(M, -4.4, -0.6, -7.2, -6.0, z + 0.03, z + 0.07, P["concrete"])
    _cvb_fence(M, C, [(-1.7, -f), (-f, -f), (-f, f), (f, f), (f, -f), (1.7, -f)])
    for x in (-1.7, 1.7):
        box(M, x - 0.14, x + 0.14, -f - 0.14, -f + 0.14, 0, 2.5, C["steel2"])
    # hedges along the street either side of the gate
    for x0, x1 in ((-11.2, -3.0), (3.0, 11.2)):
        box(M, x0, x1, -11.6, -10.8, z, 1.0, P["hg_leaf"], bevel=0.12)
    # six raking legs on concrete piers, the riser pipe up the middle with its ladder
    rb, rt, zt = 6.0, 5.25, 21.3
    ang = [math.radians(30 + 60 * k) for k in range(6)]
    def leg(a, zz):
        r = rb + (rt - rb) * zz / zt
        return (cx + r * math.cos(a), cy + r * math.sin(a), zz)
    for a in ang:
        bx, by, _ = leg(a, 0.0)
        box(M, bx - 0.6, bx + 0.6, by - 0.6, by + 0.6, 0, 0.7, P["concrete"])
        _cvb_rod(M, leg(a, 0.3), leg(a, zt), 0.5, C["steel2"])
    levels = (0.9, 7.6, 14.4, 20.4)
    for i, a in enumerate(ang):
        b = ang[(i + 1) % 6]
        for zz in levels[1:3]:
            _cvb_rod(M, leg(a, zz), leg(b, zz), 0.24, C["steel2"])
        for z0, z1 in zip(levels, levels[1:]):
            _cvb_rod(M, leg(a, z0), leg(b, z1), 0.1, P["ind_dark"])
            _cvb_rod(M, leg(b, z0), leg(a, z1), 0.1, P["ind_dark"])
    cyl(M, cx, cy, 0.75, 0, 19.2, C["steel2"], n=8)
    for x in (-0.3, 0.3):
        box(M, cx + x - 0.05, cx + x + 0.05, cy - 0.98, cy - 0.88, 0.3, 19.0, P["ind_dark"])
    # the tank: a dished bottom, straight sides with the name band, the catwalk and the conical cap
    tank = C["steel"]
    revolve(M, cx, cy, [(0.0, 18.8), (2.6, 19.2), (4.5, 20.0), (5.1, 20.9), (5.1, 26.4), (0.0, 26.4)], tank, n=16)
    cyl(M, cx, cy, 5.95, 20.85, 21.05, P["ind_dark"], n=16)
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        px, py = cx + 5.85 * math.cos(a), cy + 5.85 * math.sin(a)
        box(M, px - 0.05, px + 0.05, py - 0.05, py + 0.05, 21.05, 22.1, P["ind_dark"])
    cyl(M, cx, cy, 5.16, 22.6, 25.0, C["cream"], n=16)
    cyl(M, cx, cy, 5.19, 22.35, 22.6, C["navy"], n=16)
    cyl(M, cx, cy, 5.19, 25.0, 25.25, C["navy"], n=16)
    cone(M, cx, cy, 5.5, 26.4, 29.4, tank, n=16)
    cyl(M, cx, cy, 5.5, 26.2, 26.45, C["steel2"], n=16)
    cyl(M, cx, cy, 0.22, 29.0, 30.4, P["ind_dark"], n=6)
    revolve(M, cx, cy, [(0.0, 30.3), (0.4, 30.5), (0.4, 30.8), (0.0, 31.0)], C["navy"], n=6)
    box(M, cx - 0.6, cx + 0.6, cy - 3.6, cy - 2.6, 27.1, 27.7, C["steel2"])
    # pump house: brick under a slate gable, door to the yard drive, a vent stack
    hx0, hx1, hy0, hy1 = -9.2, -4.4, -9.2, -4.8
    band(M, hx0, hx1, hy0, hy1, 0, 0.5, C["stone2"], o=0.05)
    box(M, hx0, hx1, hy0, hy1, 0, 3.4, C["brick"])
    band(M, hx0, hx1, hy0, hy1, 3.1, 3.4, C["stone"], o=0.05)
    gable(M, hx0, hx1, hy0, hy1, 3.4, 5.0, "x", C["slate"], C["brick"], oh_u=(0.4, 0.4), oh_a=(0.4, 0.4))
    box(M, hx1, hx1 + 0.06, -7.3, -6.1, 0.06, 2.3, P["ind_dark"])
    box(M, -7.6, -6.0, hy0 - 0.06, hy0, 1.3, 2.5, P["lm_glass"])
    box(M, -8.6, -8.0, -6.0, -5.4, 4.0, 6.0, C["brick2"])
    cyl(M, -2.6, -6.6, 0.25, 0.1, 0.7, C["steel2"], n=6)
    box(M, -3.2, -2.0, -8.6, -7.6, z, z + 1.4, P["fl_house"])
    tree(M, P, 8.0, 8.0, 0.6, alt=True)
    tree(M, P, -8.0, 7.6, 0.55)
    return L


# ------------------------------------------------------------------ picture house

def b_picturehouse(M, P):
    """Picture house: a cream streamline lobby with rounded corners and navy speed bands, a stepped tower with a
    tall red blade sign, a triangular marquee over the doors and a ticket kiosk; the brick auditorium a long box
    behind with a tar roof and a taller stage house."""
    C = _cvb_mats()
    L = _cvb_ground(M, 32, 32, P["asphalt"])
    z = PAD_H
    # sidewalk forecourt across the front, paved yard down each side
    box(M, -16, 16, -16, -11.0, z, z + 0.05, P["lm_paving"])
    box(M, -16, 16, -16, -15.7, z + 0.05, z + 0.12, P["stone"])
    cream, navy, red, gilt = C["cream"], C["navy"], C["red"], C["gilt"]
    # lobby: streamline block with rounded front corners
    fy = -11.0
    outline = _cvb_rrect(-10.5, 10.5, fy, -2.5, 2.6, 0.0)
    poly_prism(M, outline, 0, 8.2, cream)
    poly_prism(M, _cvb_rrect(-10.56, 10.56, fy - 0.06, -2.44, 2.66, 0.0), 0, 1.0, C["vitro"])
    for z0 in (6.5, 7.0, 7.5):
        poly_prism(M, _cvb_rrect(-10.57, 10.57, fy - 0.07, -2.43, 2.67, 0.0), z0, z0 + 0.22, navy)
    poly_prism(M, _cvb_rrect(-10.1, 10.1, fy + 0.4, -2.9, 2.2, 0.0), 8.2, 8.26, C["tar"])
    ribbon(M, _cvb_rrect(-10.35, 10.35, fy + 0.15, -2.65, 2.45, 0.0), 0.3, 8.2, 8.75, cream, closed=True)
    # strip windows over the marquee, poster cases by the doors
    for x0, x1 in ((-9.2, -5.6), (5.6, 9.2)):
        box(M, x0, x1, fy - 0.08, fy, 4.6, 5.7, C["win"])
    for x in (-7.6, -5.6, 5.6, 7.6):
        box(M, x - 0.6, x + 0.6, fy - 0.1, fy, 1.4, 3.4, red)
        box(M, x - 0.45, x + 0.45, fy - 0.12, fy - 0.1, 1.55, 3.25, C["stone"])
    # stepped tower over the entrance with navy fluting and a gilt crown
    ty = fy - 0.35
    tiers = ((4.6, 12.0), (3.4, 13.9), (2.1, 15.6))
    for k, (hw, top) in enumerate(tiers):
        box(M, -hw, hw, ty + 0.25 * k, -6.0 + 0.6 * k, 0, top, cream)
        box(M, -hw - 0.12, hw + 0.12, ty + 0.25 * k - 0.12, -6.0 + 0.6 * k + 0.12, top - 0.35, top,
            gilt if k == 2 else C["stone"])
        box(M, -hw + 0.3, hw - 0.3, ty + 0.25 * k + 0.3, -6.0 + 0.6 * k - 0.3, top, top + 0.04, C["tar"])
    for x in (-3.6, -2.4, 2.4, 3.6):
        box(M, x - 0.22, x + 0.22, ty - 0.08, ty, 8.6, 11.5, navy)
    box(M, -0.9, 0.9, ty + 0.5 - 0.06, -7.4, 15.6, 16.5, gilt)
    # the blade sign: a tall red fin with cream letters down both faces and a gilt top
    by0, by1 = ty - 2.2, ty
    box(M, -0.38, 0.38, by0, by1, 5.8, 19.0, red)
    box(M, -0.3, 0.3, by0 - 0.1, by1, 5.8, 19.0, C["stone"])
    for k in range(6):
        zz = 7.0 + k * 1.85
        box(M, -0.45, 0.45, by0 + 0.45, by1 - 0.45, zz, zz + 1.3, C["stone"])
    taper(M, (-0.42, 0.42, by0 - 0.12, by1), (-0.1, 0.1, by0 + 0.6, by1 - 0.6), 19.0, 20.4, gilt)
    # triangular marquee pointing at the street
    tri = [(-7.2, fy), (7.2, fy), (0.0, -15.0)]
    def grow(o):
        return [(-7.2 - 1.6 * o, fy), (7.2 + 1.6 * o, fy), (0.0, -15.0 - 1.8 * o)]
    poly_prism(M, grow(0.08), 3.7, 3.95, navy)
    poly_prism(M, tri, 3.95, 5.05, C["stone"])
    poly_prism(M, grow(0.1), 5.05, 5.35, red)
    poly_prism(M, grow(-0.25), 5.35, 5.4, gilt)
    # doors and the round ticket kiosk under the marquee
    box(M, -3.4, 3.4, ty - 0.06, ty, 0.1, 3.3, C["win"])
    for x in (-2.3, 0.0, 2.3):
        box(M, x - 0.06, x + 0.06, ty - 0.1, ty, 0.1, 3.3, gilt)
    cyl(M, 0.0, -13.0, 1.0, z, 0.9, navy, n=10)
    cyl(M, 0.0, -13.0, 0.9, 0.9, 2.6, C["glass"], n=10)
    cyl(M, 0.0, -13.0, 1.15, 2.6, 2.95, gilt, n=10)
    # brick auditorium with a tar roof, a painted wall sign on its side, and the stage house at the back
    ax0, ax1, ay0, ay1 = -12.0, 12.0, -2.5, 11.8
    zw, rise = 11.4, 2.2
    box(M, ax0, ax1, ay0, ay1, 0, zw, C["brick"])
    for x0, x1 in ((ax0 - 0.12, ax0 + 0.3), (ax1 - 0.3, ax1 + 0.12)):
        box(M, x0, x1, ay0 - 0.12, ay1, zw, zw + 0.5, cream)
    shell_o = _cvb_arch(12.0, zw, rise, 8, 0.2)
    shell_i = _cvb_arch(12.0, zw, rise, 8, 0.0)
    extrude_profile(M, shell_o + shell_i[::-1], "y", ay0 + 0.3, ay1, C["tin"])
    for k in range(5):
        y = ay0 + 2.6 + k * (ay1 - ay0 - 4.6) / 4
        rib_o = _cvb_arch(12.0, zw, rise, 8, 0.32)
        extrude_profile(M, rib_o + shell_o[::-1], "y", y - 0.12, y + 0.12, C["stone2"])
    gw = [(ax0 - 0.12, zw - 0.6), (ax1 + 0.12, zw - 0.6)] + [(u * 1.01, zz) for u, zz in _cvb_arch(12.12, zw, rise, 8, 0.5)][::-1]
    extrude_profile(M, gw, "y", ay0 - 0.12, ay0 + 0.3, cream)
    def zr(x):
        return _cvb_arch_z(12.0, zw, rise, x) + 0.15
    for x in (ax0 - 0.06, ax1):
        box(M, x, x + 0.06, 1.5, 10.0, 7.2, 11.2, cream)
        box(M, x - 0.02, x + 0.08, 1.9, 9.6, 8.6, 9.7, red)
        box(M, x - 0.02, x + 0.08, 1.5, 10.0, 7.0, 7.25, navy)
    sx0, sx1, sy0, sy1 = -11.0, 11.0, ay1, 15.4
    box(M, sx0, sx1, sy0, sy1, 0, 16.0, C["brick2"])
    box(M, sx0 - 0.08, sx1 + 0.08, sy0 - 0.08, sy1 + 0.08, 16.0, 16.15, C["tar"])
    frame(M, sx0 - 0.12, sx1 + 0.12, sy0 - 0.12, sy1 + 0.12, 16.0, 16.5, 0.35, cream)
    for x, y in ((-6.0, 2.0), (0.0, 5.5), (6.0, 2.0)):
        cyl(M, x, y, 0.75, zr(x) - 0.2, zr(x) + 1.0, C["steel2"], n=8)
        cone(M, x, y, 1.15, zr(x) + 1.0, zr(x) + 1.8, C["steel2"], n=8)
    box(M, -8.0, -6.6, 12.6, 14.0, 16.15, 18.0, C["brick"])
    # fire escapes down the auditorium sides, and two street trees on the sidewalk
    for s in (-1, 1):
        x = s * 12.0
        box(M, min(x, x + s * 1.4), max(x, x + s * 1.4), 3.5, 7.5, 3.6, 3.75, P["ind_dark"])
        _cvb_rod(M, (x + s * 0.7, 3.6, 3.7), (x + s * 0.7, 9.0, 0.7), 1.1, P["ind_dark"])
    for x in (-13.3, 13.3):
        tree(M, P, x, -13.4, 0.7, alt=x > 0)
    return L


# ------------------------------------------------------------------ county hospital

def b_countyhospital(M, P):
    """County hospital: three storeys of brick in an H, stone base, stringcourses and coping, flat tar roofs; a
    stone entrance pavilion with a columned portico and a white cupola; a circular drive round a lawn with a
    flagpole, parking either side, a boiler house with its tall stack in the back garden."""
    C = _cvb_mats()
    w, d = 40, 40
    L = _cvb_ground(M, w, d, P["grass"])
    z = PAD_H
    yf, yp = L.yf, L.yf + PARK_DEPTH
    # parking either side of the drive
    bays = bay_row(4, -13.4) + bay_row(4, 13.4)
    for x0, x1 in ((-19.5, -7.6), (7.6, 19.5)):
        box(M, x0, x1, yf, yp, z, z + 0.02, P["asphalt"])
    for bx in bays:
        for s in (-1, 1):
            lx = bx + s * BAY_W / 2
            box(M, lx - 0.06, lx + 0.06, yf + BAY_Y0, yf + BAY_Y0 + BAY_L, z + 0.02, z + 0.032, P["line"])
    L.bays = [(bx, yf + BAY_Y0 + BAY_L / 2) for bx in bays]
    # circular drive: a stem from the street to a loop round a lawn island with the flagpole and a flower bed
    rc, ry = 4.6, -10.4
    box(M, -2.6, 2.6, yf, ry - rc + 0.6, z, z + 0.02, P["asphalt"])
    ring = [(rc * math.cos(2 * math.pi * i / 18), ry + rc * math.sin(2 * math.pi * i / 18)) for i in range(18)]
    ribbon(M, ring, 3.2, z, z + 0.02, P["asphalt"], closed=True)
    cyl(M, 0.0, ry, 1.6, z, z + 0.12, C["flower"], n=10)
    _flagpole(M, P, 0.0, ry, 10.0)
    brick, stone, tar = C["brick"], C["stone"], C["tar"]
    H = 11.2
    def block(x0, x1, y0, y1, h):
        box(M, x0, x1, y0, y1, 0, h, brick)
        band(M, x0, x1, y0, y1, 0, 1.0, C["stone2"], o=0.08)
        for zz in (4.1, 7.6):
            band(M, x0, x1, y0, y1, zz, zz + 0.3, stone, o=0.08)
        box(M, x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.3, h, h + 0.06, tar)
        frame(M, x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, h - 0.4, h + 0.55, 0.4, stone)
    def windows(x0, x1, y, n, h, face=-1):
        for k in range(n):
            x = x0 + (k + 0.5) * (x1 - x0) / n
            box(M, x - 0.55, x + 0.55, y - 0.06 if face < 0 else y, y if face < 0 else y + 0.06, 1.6, h - 1.0, C["win"])
    def windows_x(x, y0, y1, n, h, face):
        for k in range(n):
            y = y0 + (k + 0.5) * (y1 - y0) / n
            box(M, x - 0.06 if face < 0 else x, x if face < 0 else x + 0.06, y - 0.55, y + 0.55, 1.6, h - 1.0, C["win"])
    # the H: two wings running back from the street joined by the centre block
    wy0, wy1 = -5.4, 17.6
    for s in (-1, 1):
        x0, x1 = sorted((s * 9.0, s * 17.6))
        block(x0, x1, wy0, wy1, H)
        windows(x0 + 0.6, x1 - 0.6, wy0, 3, H)
        windows_x(x1 if s > 0 else x0, wy0 + 1.0, wy1 - 1.0, 7, H, s)
        box(M, (x0 + x1) / 2 - 1.2, (x0 + x1) / 2 + 1.2, wy1 - 4.0, wy1 - 1.8, H + 0.06, H + 2.2, brick)
        ac_unit(M, (x0 + x1) / 2, wy0 + 5.0, H + 0.06, P)
    cy0, cy1 = 1.2, 9.6
    block(-9.0, 9.0, cy0, cy1, H)
    windows(-8.4, -4.4, cy0, 2, H)
    windows(4.4, 8.4, cy0, 2, H)
    windows(-8.4, 8.4, cy1, 6, H, face=1)
    # stone entrance pavilion with a four-column portico and pediment, a white cupola on the roof behind
    px0, px1 = -4.4, 4.4
    box(M, px0, px1, cy0 - 1.0, cy1 - 2.0, 0, H + 1.2, stone)
    box(M, px0 - 0.1, px1 + 0.1, cy0 - 1.1, cy1 - 1.9, H + 1.2, H + 1.6, C["stone2"])
    box(M, px0 + 0.3, px1 - 0.3, cy0 - 0.7, cy1 - 2.3, H + 1.6, H + 1.66, tar)
    for zz in (1.6, 5.4, 8.9):
        box(M, -1.4, 1.4, cy0 - 1.06, cy0 - 1.0, zz, zz + 2.2, C["win"])
    qy0 = cy0 - 4.2
    for i, sh in enumerate((0.0, 0.5, 1.0)):
        box(M, px0 - 0.6 + sh, px1 + 0.6 - sh, qy0 - 1.6 + sh * 0.5, cy0 - 1.0, 0, 0.25 * (i + 1), C["stone2"])
    for k in range(4):
        x = -3.3 + k * 2.2
        cyl(M, x, qy0 + 0.6, 0.38, 0.75, 6.0, P["column"], n=8)
    box(M, px0 + 0.2, px1 - 0.2, qy0, cy0 - 1.0, 6.0, 6.9, stone)
    gable(M, px0 + 0.2, px1 - 0.2, qy0, cy0 - 1.0, 6.9, 8.4, "y", C["slate"], stone, oh_u=(0.25, 0.25), oh_a=(0.25, 0.0))
    box(M, -1.0, 1.0, cy0 - 1.06, cy0 - 1.0, 0.75, 3.4, P["ind_dark"])
    ux, uy = 0.0, 4.6
    H = H + 1.6
    box(M, ux - 1.8, ux + 1.8, uy - 1.8, uy + 1.8, H + 0.06, H + 1.4, P["column"])
    cyl(M, ux, uy, 1.35, H + 1.4, H + 3.4, P["column"], n=8)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        box(M, ux + 1.3 * math.cos(a) - 0.3, ux + 1.3 * math.cos(a) + 0.3, uy + 1.3 * math.sin(a) - 0.3,
            uy + 1.3 * math.sin(a) + 0.3, H + 2.0, H + 3.0, P["ind_dark"])
    cyl(M, ux, uy, 1.6, H + 3.4, H + 3.7, P["column"], n=8)
    revolve(M, ux, uy, [(1.55, H + 3.7), (1.35, H + 4.5), (0.85, H + 5.2), (0.0, H + 5.6)], P["dome"], n=8)
    cyl(M, ux, uy, 0.06, H + 5.5, H + 6.6, P["ind_steel"], n=4)
    # back garden: lawn paths, benches, trees; a brick boiler house with the tall stack
    ribbon(M, [(-9.0, 12.4), (-3.0, 12.4), (-3.0, 9.6)], 1.4, z, z + 0.03, P["path"])
    ribbon(M, [(3.0, 9.6), (3.0, 12.4), (9.0, 12.4)], 1.4, z, z + 0.03, P["path"])
    bx0, bx1, by0, by1 = -3.6, 3.6, 15.0, 19.2
    box(M, bx0, bx1, by0, by1, 0, 4.6, C["brick2"])
    box(M, bx0 - 0.15, bx1 + 0.15, by0 - 0.15, by1 + 0.15, 4.6, 4.9, C["stone2"])
    box(M, bx0 + 0.2, bx1 - 0.2, by0 + 0.2, by1 - 0.2, 4.9, 4.95, tar)
    cyl(M, 2.0, 17.4, 0.9, 4.9, 21.0, C["brick2"], n=8)
    cyl(M, 2.0, 17.4, 1.02, 20.2, 21.0, C["stone2"], n=8)
    cyl(M, 2.0, 17.4, 0.62, 21.0, 21.05, P["ind_dark"], n=8)
    box(M, -19.6, -17.8, 18.4, 19.8, z, 1.3, P["fl_house"])
    for x, y, s, k in ((-6.0, 13.0, 0.7, 0), (6.0, 13.4, 0.75, 1), (-18.2, -10.0, 0.75, 1), (18.2, -10.0, 0.75, 0),
                       (-12.6, -9.6, 0.8, 0), (12.6, -9.6, 0.8, 1)):
        tree(M, P, x, y, s, alt=bool(k))
    bench(M, P, 0.0, 12.6, 0.0)
    return L


# ------------------------------------------------------------------ ballpark

def b_ballpark(M, P):
    """Small-town ballpark: a red-roofed wooden grandstand wrapped behind home plate (green seats under the
    roof), a clay infield diamond with white bases, a striped outfield, a green board fence with painted ad
    panels round the outfield, a scoreboard in left-centre and two floodlight towers down the lines."""
    C = _cvb_mats()
    w, d = 48, 40
    L = _cvb_ground(M, w, d, C["turf"])
    z = PAD_H
    hx, hy = 0.0, -7.6               # home plate
    def at(r, a, zz=0.0):
        return (hx + r * math.cos(a), hy + r * math.sin(a), zz)
    # outfield: mowing stripes inside the fence arc, a clay warning track along it
    RF = 25.6
    q = math.radians(45)
    arc = [at(RF, q + (math.pi / 2) * i / 14)[:2] for i in range(15)]
    for i in range(0, 14, 2):
        poly_prism(M, [(hx, hy), arc[i], arc[i + 1]], z, z + 0.02, C["turf2"])
    ribbon(M, [at(RF - 1.0, q + (math.pi / 2) * i / 14)[:2] for i in range(15)], 1.6, z, z + 0.035, C["clay2"])
    # infield: clay fan, grass diamond inside the base paths, the mound, bases and foul lines
    B = 11.0                       # base path
    fan = [(hx, hy - 0.4)] + [at(15.2, q - 0.08 + (math.pi / 2 + 0.16) * i / 10)[:2] for i in range(11)]
    poly_prism(M, fan, z, z + 0.04, C["clay"])
    dia = [at(1.8, q)[:2], at(B - 1.0, q)[:2], at((B - 1.0) * math.sqrt(2) * 0.97, math.pi / 2)[:2],
           at(B - 1.0, 3 * q)[:2], at(1.8, 3 * q)[:2]]
    poly_prism(M, dia, z, z + 0.06, C["turf2"])
    mx, my, _ = at(B * math.sqrt(2) / 2, math.pi / 2)
    cyl(M, mx, my, 1.4, z, z + 0.16, C["clay"], n=10)
    box(M, mx - 0.3, mx + 0.3, my - 0.08, my + 0.08, z + 0.16, z + 0.2, P["line"])
    cyl(M, hx, hy, 2.0, z, z + 0.07, C["clay"], n=10)
    for a, r in ((q, B), (math.pi / 2, B * math.sqrt(2)), (3 * q, B)):
        bx, by, _ = at(r, a)
        box(M, bx - 0.4, bx + 0.4, by - 0.4, by + 0.4, z, z + 0.2, P["line"])
    poly_prism(M, [(hx - 0.3, hy + 0.2), (hx + 0.3, hy + 0.2), (hx + 0.3, hy - 0.1), (hx, hy - 0.4), (hx - 0.3, hy - 0.1)],
               z + 0.07, z + 0.1, P["line"])
    for a in (q, 3 * q):
        ribbon(M, [at(0.6, a)[:2], at(RF - 0.3, a)[:2]], 0.14, z + 0.07, z + 0.09, P["line"])
    # board fence round the outfield with painted ad panels, and the scoreboard beyond left-centre
    fence = [at(RF, q + (math.pi / 2) * i / 14)[:2] for i in range(15)]
    for i, (p0, p1) in enumerate(zip(fence, fence[1:])):
        bar(M, p0, p1, 0.35, 0, 2.6, C["boards"])
        if i % 3 == 1:
            m = (C["cream"], C["red"], P["ind_yellow"])[(i // 3) % 3]
            mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
            u = Vector((p1[0] - p0[0], p1[1] - p0[1])).normalized()
            nrm = Vector((-u.y, u.x))
            c = Vector(mid) - nrm * 0.18
            bar(M, tuple(c - u * 1.6), tuple(c + u * 1.6), 0.06, 0.6, 2.2, m)
    for p in fence[::2]:
        box(M, p[0] - 0.12, p[0] + 0.12, p[1] - 0.12, p[1] + 0.12, 0, 2.9, C["boards"])
    sa = math.radians(118)
    sx, sy, _ = at(RF + 2.2, sa)
    u = Vector((math.cos(sa + math.pi / 2), math.sin(sa + math.pi / 2)))
    nv = Vector((math.cos(sa), math.sin(sa)))
    c = Vector((sx, sy))
    bar(M, tuple(c - u * 4.2), tuple(c + u * 4.2), 0.5, 2.8, 7.4, C["boards"])
    bar(M, tuple(c - u * 4.5 + nv * 0.1), tuple(c + u * 4.5 + nv * 0.1), 1.2, 7.4, 7.7, C["cream"])
    cc = c - nv * 0.27
    bar(M, tuple(cc - u * 3.6), tuple(cc + u * 3.6), 0.06, 3.4, 4.4, C["cream"])
    bar(M, tuple(cc - u * 3.6), tuple(cc + u * 3.6), 0.06, 5.0, 6.8, P["ind_dark"])
    for s in (-3.2, 3.2):
        p = c + u * s
        box(M, p.x - 0.18, p.x + 0.18, p.y - 0.18, p.y + 0.18, 0, 2.8, C["wood"])
    # front plaza with the gate and ticket windows
    box(M, -24, 24, -20, -17.2, z, z + 0.05, P["lm_paving"])
    box(M, -2.0, 2.0, -17.2, hy - 4.2, z, z + 0.05, P["lm_paving"])
    # the grandstand: a ring of wooden seating tiers behind home plate, a back wall, a shed roof over the
    # back rows on posts; red roof, green seats
    a0, a1, n = math.radians(150), math.radians(390), 12
    tiers = ((4.6, 6.2, 0.5), (6.2, 7.6, 1.3), (7.6, 9.0, 2.1), (9.0, 10.3, 2.9))
    for i in range(n):
        t0, t1 = a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n
        for r0, r1, h in tiers:
            pts = [at(r0, t0)[:2], at(r0, t1)[:2], at(r1, t1)[:2], at(r1, t0)[:2]]
            poly_prism(M, pts, 0, h, C["seat"])
        pts = [at(10.3, t0)[:2], at(10.3, t1)[:2], at(10.8, t1)[:2], at(10.8, t0)[:2]]
        poly_prism(M, pts, 0, 6.0, C["wood"])
        # shed roof falling toward the field, from over the back wall to above the middle rows
        lo = [at(6.6, t0, 5.0), at(6.6, t1, 5.0), at(11.3, t1, 6.3), at(11.3, t0, 6.3)]
        M.loft(lo, [(x, y, zz + 0.25) for x, y, zz in lo], C["red"])
        if i % 2 == 0:
            for r in (6.9,):
                px, py, _ = at(r, t0)
                box(M, px - 0.12, px + 0.12, py - 0.12, py + 0.12, 0.5, 5.1, C["cream"])
    # gate through the stand at the back of home: a cream arch frame with a sign board
    box(M, -2.2, -1.6, hy - 11.4, hy - 10.6, 0, 6.8, C["cream"])
    box(M, 1.6, 2.2, hy - 11.4, hy - 10.6, 0, 6.8, C["cream"])
    box(M, -2.6, 2.6, hy - 11.5, hy - 10.5, 6.8, 7.8, C["navy"])
    box(M, -2.2, 2.2, hy - 11.4, hy - 10.6, 0.06, 3.2, P["ind_dark"])
    for x in (-8.5, 8.5):
        box(M, x - 1.3, x + 1.3, -19.4, -18.0, 0, 2.6, C["cream"])
        gable(M, x - 1.3, x + 1.3, -19.4, -18.0, 2.6, 3.4, "x", C["red"], C["cream"], oh_u=(0.25, 0.25), oh_a=(0.25, 0.25))
        box(M, x - 0.7, x + 0.7, -19.46, -19.4, 1.1, 2.0, P["ind_dark"])
    # dugouts down the lines
    for a in (math.radians(31), math.radians(149)):
        p0, p1 = at(13.6, a - 0.17)[:2], at(13.6, a + 0.17)[:2]
        bar(M, p0, p1, 1.4, 0, 1.2, C["cream"])
        bar(M, p0, p1, 1.8, 1.2, 1.4, C["boards"])
    # light towers down the lines in foul territory
    for s in (-1, 1):
        lx, ly = s * 19.6, 2.4
        M.loft(rect(lx - 0.7, lx + 0.7, ly - 0.7, ly + 0.7, 0), rect(lx - 0.25, lx + 0.25, ly - 0.25, ly + 0.25, 18.0), C["steel2"])
        box(M, lx - 1.9, lx + 1.9, ly - 0.3, ly + 0.3, 17.6, 18.0, C["steel2"])
        for k in range(4):
            x = lx - 1.5 + k
            box(M, x - 0.4, x + 0.4, ly - 0.1, ly + 0.5, 18.0, 19.0, P["fl_house"])
            box(M, x - 0.33, x + 0.33, ly + 0.5, ly + 0.56, 18.1, 18.9, P["fl_lens"])
    for x, y, s in ((-21.6, -15.4, 0.75), (21.6, -15.4, 0.75), (21.4, 17.6, 0.9), (17.6, 18.2, 0.75), (21.6, 13.4, 0.7)):
        tree(M, P, x, y, s, alt=x > 0)
    return L


# ------------------------------------------------------------------ county courthouse with clock tower

def b_clocktower(M, P):
    """County courthouse: a stripped-classical limestone block on a raised base, tall windows between pilasters,
    a columned entrance up broad steps, flat roofs behind a parapet with two glazed courtroom skylights; a
    stepped Deco clock tower with four clock faces and a copper lantern; a lawn square with diagonal walks,
    elms, a war memorial obelisk and flagpole."""
    C = _cvb_mats()
    w, d = 40, 40
    L = _cvb_ground(M, w, d, P["grass"])
    z = PAD_H
    pm = P["path"]
    zp = (z, z + 0.035)
    ribbon(M, [(-18.8, -18.8), (18.8, -18.8), (18.8, 18.8), (-18.8, 18.8)], 1.6, *zp, pm, closed=True)
    ribbon(M, [(0.0, -20.0), (0.0, -11.0)], 3.2, *zp, pm)
    ribbon(M, [(-18.8, -18.8), (-6.0, -11.8)], 1.6, *zp, pm)
    ribbon(M, [(18.8, -18.8), (6.0, -11.8)], 1.6, *zp, pm)
    ribbon(M, [(-18.8, 18.8), (-14.2, 15.2)], 1.6, *zp, pm)
    ribbon(M, [(18.8, 18.8), (14.2, 15.2)], 1.6, *zp, pm)
    cyl(M, 0.0, -14.2, 3.6, z, z + 0.05, P["lm_paving"], n=16)
    box(M, -8.0, 8.0, -11.8, -10.0, z, z + 0.05, P["lm_paving"])
    # war memorial obelisk on a stepped plinth
    cyl(M, 0.0, -14.2, 1.6, z, 0.4, C["stone2"], n=8)
    box(M, -0.8, 0.8, -15.0, -13.4, 0.4, 1.6, C["stone"])
    taper(M, (-0.55, 0.55, -14.75, -13.65), (-0.32, 0.32, -14.52, -13.88), 1.6, 8.4, C["stone"])
    M.cone(rect(-0.32, 0.32, -14.52, -13.88, 8.4), (0.0, -14.2, 9.2), C["stone"])
    for x in (-5.0, 5.0):
        _flagpole(M, P, x, -11.0, 11.0)
    stone, stone2, win, gilt = C["stone"], C["stone2"], C["win"], C["gilt"]
    # raised base and front steps
    bx0, bx1, by0, by1 = -15.0, 15.0, -6.6, 14.6
    box(M, bx0, bx1, by0, by1, 0, 1.4, stone2)
    for i, s in enumerate((0.0, 0.7, 1.4, 2.1)):
        box(M, -6.6 + s * 0.3, 6.6 - s * 0.3, by0 - 3.2 + s, by0, 0, 0.35 * (i + 1), stone2)
    # main block: lower side ranges, taller centre range
    hx0, hx1, hy0, hy1 = -14.0, 14.0, -5.6, 13.6
    def range_(x0, x1, y0, y1, top):
        box(M, x0, x1, y0, y1, 1.4, top, stone)
        box(M, x0 - 0.2, x1 + 0.2, y0 - 0.2, y1 + 0.2, top - 0.9, top - 0.5, stone2)
        box(M, x0 + 0.35, x1 - 0.35, y0 + 0.35, y1 - 0.35, top, top + 0.05, C["lead"])
        frame(M, x0, x1, y0, y1, top, top + 0.6, 0.35, stone)
    range_(hx0, -7.0, hy0, hy1, 12.4)
    range_(7.0, hx1, hy0, hy1, 12.4)
    range_(-7.0, 7.0, hy0 - 0.6, hy1, 14.6)
    # tall windows between pilasters
    def tall_windows(xs, y, z0, z1):
        for x in xs:
            box(M, x - 0.55, x + 0.55, y - 0.07, y, z0, z1, win)
            box(M, x - 0.6, x + 0.6, y - 0.1, y, 6.6, 7.0, stone2)
    tall_windows((-12.2, -10.0, -7.8, 7.8, 10.0, 12.2), hy0, 2.4, 11.0)
    for x in (hx0 - 0.07, hx1):
        for y in (-3.4, 0.6, 4.6, 8.6, 12.2):
            box(M, x, x + 0.07, y - 0.55, y + 0.55, 2.4, 11.0, win)
    # entrance: recessed doors behind six square columns and a gilt-banded entablature
    ey = hy0 - 0.6
    box(M, -5.6, 5.6, ey - 0.07, ey, 1.4, 6.0, P["ind_dark"])
    for zz in (7.0, 9.6):
        for x in (-3.5, 0.0, 3.5):
            box(M, x - 0.9, x + 0.9, ey - 0.07, ey, zz, zz + 2.0, win)
    for k in range(6):
        x = -5.6 + k * 2.24
        box(M, x - 0.42, x + 0.42, ey - 2.2, ey - 1.36, 1.4, 12.2, stone)
    box(M, -6.3, 6.3, ey - 2.6, ey, 12.2, 13.4, stone)
    box(M, -6.36, 6.36, ey - 2.66, ey - 2.6, 12.45, 12.75, gilt)
    box(M, -6.3, 6.3, ey - 2.6, ey, 13.4, 13.46, C["tar2"])
    # glazed courtroom skylights over the side ranges
    for s in (-1, 1):
        sx = s * 10.5
        taper(M, (sx - 2.0, sx + 2.0, 1.0, 8.0), (sx - 0.5, sx + 0.5, 2.5, 6.5), 12.45, 13.6, C["glass"])
        frame(M, sx - 2.1, sx + 2.1, 0.9, 8.1, 12.45, 12.75, 0.2, C["iron"])
    # the stepped clock tower over the centre
    tx, ty = 0.0, 4.6
    def sq(hw, z0, z1, m):
        box(M, tx - hw, tx + hw, ty - hw, ty + hw, z0, z1, m)
    sq(4.2, 14.6, 24.0, stone)
    for k in (-1, 1):
        box(M, tx + k * 1.4 - 0.3, tx + k * 1.4 + 0.3, ty - 4.28, ty + 4.28, 16.0, 23.0, stone2)
        box(M, tx - 4.28, tx + 4.28, ty + k * 1.4 - 0.3, ty + k * 1.4 + 0.3, 16.0, 23.0, stone2)
    sq(4.45, 24.0, 24.5, gilt)
    sq(3.9, 24.5, 29.0, stone)
    _cvb_clock(M, P, C, tx, ty - 3.9, 26.75, 1.75, "-y")
    _cvb_clock(M, P, C, tx, ty + 3.9, 26.75, 1.75, "y")
    _cvb_clock(M, P, C, tx - 3.9, ty, 26.75, 1.75, "-x")
    _cvb_clock(M, P, C, tx + 3.9, ty, 26.75, 1.75, "x")
    sq(4.1, 29.0, 29.5, stone2)
    sq(3.0, 29.5, 31.6, stone)
    sq(3.15, 31.6, 31.9, stone2)
    sq(2.1, 31.9, 33.4, stone)
    cyl(M, tx, ty, 1.6, 33.4, 35.0, P["column"], n=8)
    for k in range(4):
        a = k * math.pi / 2
        box(M, tx + 1.56 * math.cos(a) - 0.35, tx + 1.56 * math.cos(a) + 0.35, ty + 1.56 * math.sin(a) - 0.35,
            ty + 1.56 * math.sin(a) + 0.35, 33.7, 34.7, P["ind_dark"])
    cyl(M, tx, ty, 1.85, 35.0, 35.3, stone2, n=8)
    revolve(M, tx, ty, [(1.8, 35.3), (1.5, 36.4), (0.9, 37.4), (0.0, 38.2)], C["copper"], n=8)
    cyl(M, tx, ty, 0.08, 38.0, 39.6, gilt, n=4)
    # elms round the square, benches by the walks
    for x, y, s, k in ((-15.6, -15.2, 0.95, 0), (15.6, -15.2, 0.95, 1), (-16.6, -6.0, 0.9, 1), (16.6, -6.0, 0.9, 0), (-16.8, 4.0, 0.95, 0), (16.8, 4.0, 0.95, 1),
                       (-16.4, 13.0, 0.85, 1), (16.4, 13.0, 0.85, 0)):
        tree(M, P, x, y, s, alt=bool(k))
    for x in (-5.0, 5.0):
        bench(M, P, x, -16.4, 0.0)
    return L


# ------------------------------------------------------------------ market hall

def b_markethall(M, P):
    """Market hall in the railway-station style: a long barrel-vaulted glass roof on dark iron ribs with a
    ventilating lantern along the crown, brick end walls (the front with a great arched window over three
    doorways, a stone clock gable above), lean-to aisles under slate, square brick corner towers with slate
    pyramids; striped stall awnings along a paved forecourt."""
    C = _cvb_mats()
    w, d = 48, 40
    L = _cvb_ground(M, w, d, P["lm_paving"])
    z = PAD_H
    brick, iron, glass, stone = C["brick"], C["iron"], C["glass"], C["stone"]
    box(M, -24, 24, -20, -19.7, z, z + 0.12, P["stone"])
    # the vault: glass shell over the nave, iron ribs, and a lantern along the crown
    half, zs, rise = 12.6, 9.2, 6.8
    vy0, vy1 = -9.0, 16.6
    n = 10
    outer = _cvb_arch(half, zs, rise, n, 0.25)
    inner = _cvb_arch(half, zs, rise, n, 0.0)
    extrude_profile(M, outer + inner[::-1], "y", vy0, vy1, glass)
    crown = zs + rise
    for k in range(7):
        y = vy0 + 0.4 + k * (vy1 - vy0 - 0.8) / 6
        rib_o = _cvb_arch(half, zs, rise, n, 0.55)
        rib_i = _cvb_arch(half, zs, rise, n, 0.2)
        extrude_profile(M, rib_o + rib_i[::-1], "y", y - 0.22, y + 0.22, iron)
    box(M, -1.8, 1.8, vy0, vy1, crown + 0.1, crown + 1.2, glass)
    box(M, -2.2, 2.2, vy0, vy1, crown + 1.2, crown + 1.4, C["slate"])
    for x in (-1.85, 1.75):
        box(M, x, x + 0.1, vy0, vy1, crown + 0.1, crown + 1.2, iron)
    # nave side walls up to the springing, clerestory glazing above the aisle roofs
    for s in (-1, 1):
        x0, x1 = sorted((s * (half - 0.3), s * (half + 0.1)))
        box(M, x0, x1, vy0, vy1, 0, zs, brick)
        box(M, x0 - 0.06, x1 + 0.06, vy0 + 0.6, vy1 - 0.6, 6.9, 8.7, C["win"])
    # lean-to aisles: brick walls, slate roofs, arched windows down the long sides
    ax, az_in, az_out = 21.0, 6.6, 5.0
    for s in (-1, 1):
        xi, xo = s * half, s * ax
        prof = [(xi, 0.0), (xo, 0.0), (xo, az_out), (xi, az_in)]
        if s < 0:
            prof = prof[::-1]
        extrude_profile(M, prof, "y", -7.0, vy1, brick)
        sl = (az_in - az_out) / (ax - half)
        rp = [(xi, az_in + 0.3), (xo + s * 0.5, az_out + 0.3 - sl * 0.5), (xo + s * 0.5, az_out + 0.05 - sl * 0.5),
              (xi, az_in + 0.05)]
        if s < 0:
            rp = rp[::-1]
        extrude_profile(M, rp, "y", -7.3, vy1 + 0.3, C["slate"])
        for k in range(5):
            y = -3.0 + k * 4.6
            x = xo if s > 0 else xo - 0.07
            box(M, x, x + 0.07, y - 0.7, y + 0.7, 1.2, 3.9, C["win"])
        box(M, min(xi, xo), max(xi, xo), -7.06, -7.0, 1.0, 3.6, C["win"])
    # front end wall: brick gable following the vault, stone-framed arched window over three doorways
    fy0, fy1 = -10.0, -9.0
    wall = [(-half - 0.6, 0.0), (half + 0.6, 0.0), (half + 0.6, zs)] + \
        [p for p in _cvb_arch(half, zs, rise, n, 0.9)[::-1]][1:-1] + [(-half - 0.6, zs)]
    extrude_profile(M, wall, "y", fy0, fy1, brick)
    wh, wz, wr = 8.4, 8.0, 5.4
    surround = [(-wh - 0.7, 4.0), (wh + 0.7, 4.0)] + [p for p in _cvb_arch(wh + 0.7, wz, wr + 0.4, 8)][::-1]
    extrude_profile(M, surround, "y", fy0 - 0.06, fy0, stone)
    win_pts = [(-wh, 4.6), (wh, 4.6)] + [p for p in _cvb_arch(wh, wz, wr, 8)][::-1]
    extrude_profile(M, win_pts, "y", fy0 - 0.1, fy0 - 0.06, glass)
    R = (wh * wh + wr * wr) / (2 * wr)
    zc = wz + wr - R
    for x in (-5.6, -2.8, 0.0, 2.8, 5.6):
        top = zc + math.sqrt(max(R * R - x * x, 0.0))
        box(M, x - 0.12, x + 0.12, fy0 - 0.14, fy0 - 0.06, 4.6, top, iron)
    for zz in (wz,):
        box(M, -wh, wh, fy0 - 0.14, fy0 - 0.06, zz - 0.12, zz + 0.12, iron)
    box(M, -wh - 0.7, wh + 0.7, fy0 - 0.2, fy0, 3.8, 4.6, stone)
    for x in (-5.0, 0.0, 5.0):
        box(M, x - 1.6, x + 1.6, fy0 - 0.08, fy0, 0.06, 3.6, P["ind_dark"])
    # clock gable over the crown
    box(M, -3.2, 3.2, fy0 - 0.2, fy1 + 0.4, crown - 1.0, crown + 3.2, stone)
    box(M, -3.4, 3.4, fy0 - 0.3, fy1 + 0.5, crown + 3.2, crown + 3.6, C["stone2"])
    box(M, -1.4, 1.4, fy0 - 0.15, fy1 + 0.3, crown + 3.6, crown + 4.6, stone)
    _cvb_clock(M, P, C, 0.0, fy0 - 0.2, crown + 1.1, 1.6, "-y")
    # back end wall
    bwall = [(x, zz) for x, zz in wall]
    extrude_profile(M, bwall, "y", vy1, vy1 + 0.9, brick)
    box(M, -3.0, 3.0, vy1 + 0.9, vy1 + 0.96, 0.06, 4.0, P["ind_dark"])
    # square brick corner towers with stone bands and slate pyramids
    for s in (-1, 1):
        cx, cy, hw = s * 19.4, -8.8, 2.8
        box(M, cx - hw, cx + hw, cy - hw, cy + hw, 0, 13.0, brick)
        band(M, cx - hw, cx + hw, cy - hw, cy + hw, 0, 0.9, C["stone2"], o=0.08)
        band(M, cx - hw, cx + hw, cy - hw, cy + hw, 12.2, 13.0, stone, o=0.15)
        box(M, cx - 0.7, cx + 0.7, cy - hw - 0.07, cy - hw, 5.0, 10.6, C["win"])
        x = cx + s * hw if s > 0 else cx - hw - 0.07
        box(M, x, x + 0.07, cy - 0.7, cy + 0.7, 5.0, 10.6, C["win"])
        cone(M, cx, cy, (hw + 0.4) * math.sqrt(2), 13.0, 17.2, C["slate"], n=4)
        cyl(M, cx, cy, 0.1, 16.8, 18.2, C["gilt"], n=4)
    # forecourt: two rows of stalls under striped awnings either side of the walk, carts and lamps
    awn = (C["red"], C["cream"], P["hs_awning"], C["red"], C["cream"], P["hs_awning"])
    for s in (-1, 1):
        for k in range(4):
            x = s * (5.6 + k * 3.6)
            x0, x1 = x - 1.6, x + 1.6
            yb = -14.0
            box(M, x0 + 0.2, x1 - 0.2, yb - 1.2, yb, 0, 0.95, C["wood"])
            for j, m in enumerate((P["crop_g1"], P["ind_orange"], C["flower"])):
                cxx = x0 + 0.6 + j * 1.0
                box(M, cxx - 0.4, cxx + 0.4, yb - 1.1, yb - 0.3, 0.95, 1.25, m)
            box(M, x0 + 0.1, x1 - 0.1, yb - 0.1, yb, 0, 3.0, C["wood"])
            _awning(M, x0, x1, yb, 3.0, 2.6, awn[(k + (s > 0)) % 6])
    for x in (-21.0, 21.0):
        tree(M, P, x, -16.4, 0.75, alt=x > 0)
    for x in (-3.4, 3.4):
        cyl(M, x, -17.6, 0.1, z, 4.2, P["lp_iron"], n=6)
        revolve(M, x, -17.6, [(0.0, 4.0), (0.35, 4.2), (0.35, 4.6), (0.0, 4.8)], P["lp_glass"], n=6)
    return L


BUILDINGS.update({
    "watertower": (b_watertower, 24, 24, 0),
    "picturehouse": (b_picturehouse, 32, 32, 0),
    "countyhospital": (b_countyhospital, 40, 40, 8),
    "ballpark": (b_ballpark, 48, 40, 0),
    "clocktower": (b_clocktower, 40, 40, 0),
    "markethall": (b_markethall, 48, 40, 0),
})

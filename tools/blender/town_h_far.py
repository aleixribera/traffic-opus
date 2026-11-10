# The family homes from a way off (the game draws these once a pixel is over half a metre: render/buildings3d.ts
# HOUSE_FAR_FROM). A grown town holds thousands of houses, and the full models (430 to 580 triangles each, most of it
# window frames, fence boards, the vegetable rows and the bevels) were most of the map's triangles at every zoom. Each
# far model keeps what still reads at a few pixels: the house's blocks and roof shapes and colours, every window's
# glass (so the street still lights up at night: win_home), the doors, the porch, the chimney, and the lot's driveway,
# garage, back fence and yard. 130 to 150 triangles. Run by build_models.py with the other town_*.py files.


def _far_gable(M, x0, x1, y0, y1, ze, zr, axis, roof, wall, oh_u=(0.4, 0.4), oh_a=(0.4, 0.4)):
    """A pitched roof as one closed prism: the two slopes (and their overhang) in the roof's colour, its gable ends
    in the wall's. 8 triangles instead of gable()'s chevron shell and wall triangle."""
    u0, u1, a0, a1 = (y0, y1, x0, x1) if axis == "x" else (x0, x1, y0, y1)
    um = (u0 + u1) / 2
    s = (zr - ze) / ((u1 - u0) / 2)
    fs = extrude_profile(M, [(u0 - oh_u[0], ze - s * oh_u[0]), (um, zr), (u1 + oh_u[1], ze - s * oh_u[1])],
                         axis, a0 - oh_a[0], a1 + oh_a[1], roof)
    for f in fs[:2]:
        f.material_index = M.mi(wall)


def _far_hip(M, r0, r1, z0, z1, roof):
    """A hipped roof (taper) without the underside no one sees: 10 triangles."""
    fs = taper(M, r0, r1, z0, z1, roof)
    bmesh.ops.delete(M.bm, geom=[fs[0]], context="FACES_ONLY")


def _far_flat(M, x0, x1, y0, y1, z, m):
    """A flat patch on the ground (a driveway, a path, a bed): one quad, face up."""
    _quad(M, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], m)


def _far_fence(M, x0, x1, y0, y1, h, m):
    """A fence seen from a way off: a thin block without its underside (its top is the white line it draws from
    above), its boards and posts gone. 10 triangles."""
    _open_box(M, x0, x1, y0, y1, 0, h, m)


def _far_window(M, F, a, w=1.0, z0=0.95, z1=2.15):
    """A window's glass only (its frame is under a pixel from here): lights at night like the full model's."""
    _wq(M, F, a - w / 2, a + w / 2, z0, z1, _td()["win_home"], 0.055)


def _far_door(M, F, a, m, w=0.95, h=2.05):
    _wq(M, F, a - w / 2, a + w / 2, 0, h, m, 0.055)


def home_lot_far(M, P, garage_roof, yard="veg"):
    """home_lot from a way off: the driveway and its apron, the garage under its gable with its doors, the path to the
    front door, the back fence (back and right side), and the yard's one big thing (the bed, the shed, the birdbath's
    lawn has nothing that shows)."""
    L = Lot(12, 15)
    drive = P["drive"]
    x0, x1 = HOUSE_DRIVE_X - 1.4, HOUSE_DRIVE_X + 1.4
    _far_flat(M, x0, x1, -7.5, 2.0, 0.05, drive)
    gx0, gx1, gy0, gy1 = -5.8, -2.2, 2.0, 6.6
    _open_box(M, gx0, gx1, gy0, gy1, 0, 2.5, P["res_wall2"])
    _far_gable(M, gx0, gx1, gy0, gy1, 2.5, 3.6, "y", garage_roof, P["res_wall2"], oh_u=(0.25, 0.25), oh_a=(0.3, 0.2))
    _wq(M, _faces(gx0, gx1, gy0, gy1)["f"], 0.4, gx1 - gx0 - 0.4, 0.0, 2.1, P["res_trim"], 0.04)
    _far_flat(M, x1, -0.6, -1.4, -0.7, 0.04, drive)
    _far_fence(M, -6.0, 6.0, 7.38, 7.5, 1.1, P["fence_w"])
    _far_fence(M, 5.88, 6.0, 0.8, 7.38, 1.1, P["fence_w"])
    _far_fence(M, -2.2, -0.2, 2.6, 2.72, 1.1, P["fence_w"])
    if yard == "veg":
        _far_flat(M, 0.6, 5.2, 4.9, 7.0, 0.05, P["soil"])
        _far_flat(M, 0.8, 5.0, 5.15, 6.75, 0.12, P["crop"])
    elif yard == "shed":
        _open_box(M, 3.4, 5.6, 5.0, 7.0, 0, 2.1, P["res_wall2"])
        _far_gable(M, 3.4, 5.6, 5.0, 7.0, 2.1, 2.7, "x", garage_roof, P["res_wall2"], oh_u=(0.15, 0.15), oh_a=(0.15, 0.15))
    L.bays = [(HOUSE_DRIVE_X, -3.0)]
    return L


def b_house_far(M, P):
    """b_house (the cross-gable) from a way off."""
    L = home_lot_far(M, P, P["res_roof2"], "veg")
    T = _td()
    wall, roof = P["res_wall"], P["res_roof"]
    B, W = _faces(-1.4, 5.4, -0.2, 4.6), _faces(2.4, 5.4, -2.4, -0.2)
    _far_door(M, B["f"], 1.9, T["door_g"])
    _far_window(M, B["f"], 0.7, 1.0)
    _far_window(M, W["f"], 1.5, 1.5)
    _far_window(M, W["f"], 1.5, 0.6, 3.15, 3.75)
    _far_window(M, W["r"], 1.1, 0.9)
    _far_window(M, B["r"], 2.6, 1.0)
    _far_window(M, B["r"], 2.4, 0.7, 3.3, 4.05)
    _far_window(M, B["l"], 1.5, 1.0)
    _far_window(M, B["l"], 3.4, 1.0)
    _far_window(M, B["l"], 2.4, 0.7, 3.3, 4.05)
    _far_window(M, B["b"], 1.6, 1.0)
    _far_door(M, B["b"], 3.6, T["door"], w=0.85)
    _open_box(M, -1.4, 5.4, -0.2, 4.6, 0, 3.0, wall)
    _far_gable(M, -1.4, 5.4, -0.2, 4.6, 3.0, 5.0, "x", roof, wall)
    _open_box(M, 2.4, 5.4, -2.4, -0.2, 0, 3.0, wall)
    _far_gable(M, 2.4, 5.4, -2.4, 0.2, 3.0, 4.5, "y", roof, wall, oh_a=(0.4, 0.0))
    _far_flat(M, -0.8, 2.4, -1.3, -0.2, 2.55, roof)
    _open_box(M, 0.2, 0.9, 3.0, 3.7, 2.5, 5.7, P["res_trim"])
    return L


def b_house_b_far(M, P):
    """b_house_b (the brick bungalow) from a way off."""
    L = home_lot_far(M, P, P["res_roof"], "shed")
    wall, roof, tr = P["brick_home"], P["slate"], P["res_trim"]
    T = _td()
    B, W = _faces(-1.4, 5.4, -1.8, 4.4), _faces(0.6, 3.0, -3.0, -1.8)
    _far_door(M, W["f"], 1.2, T["oxblood"])
    _far_window(M, B["f"], 1.0, 1.2)
    _far_window(M, B["f"], 5.6, 1.2)
    _far_window(M, B["r"], 1.3, 1.0)
    _far_window(M, B["r"], 4.9, 1.0)
    _far_window(M, B["l"], 1.6, 1.0)
    _far_window(M, B["l"], 4.6, 1.0)
    _far_window(M, B["b"], 1.5, 1.0)
    _far_door(M, B["b"], 3.6, T["door"], w=0.85)
    _open_box(M, -1.4, 5.4, -1.8, 4.4, 0, 2.9, wall)
    _far_hip(M, (-1.8, 5.8, -2.2, 4.8), (0.6, 3.4, 1.28, 1.32), 2.9, 4.7, roof)
    _open_box(M, 0.6, 3.0, -3.0, -1.8, 0, 2.5, tr)
    _far_gable(M, 0.6, 3.0, -3.0, -1.8, 2.5, 3.4, "y", roof, tr, oh_u=(0.2, 0.2), oh_a=(0.25, 0.0))
    _open_box(M, 5.2, 5.9, 1.0, 1.8, 0, 5.2, wall)
    return L


def b_house_c_far(M, P):
    """b_house_c (the Dutch colonial) from a way off: the gambrel as one five-sided prism, the dormer a block."""
    L = home_lot_far(M, P, P["res_roof2"], "lawn")
    wall, roof = P["res_trim"], P["shingle"]
    y0, y1 = -1.0, 4.4
    T = _td()
    B, D = _faces(-1.0, 5.4, y0, y1), _faces(-0.2, 4.6, y0 + 0.35, y0 + 1.6)
    _far_door(M, B["f"], 3.2, T["oxblood"])
    _far_window(M, B["f"], 1.75, 0.95)
    _far_window(M, B["f"], 4.85, 0.95)
    for a in (0.9, 2.4, 3.9):
        _far_window(M, D["f"], a, 0.85, 3.35, 4.3)
    _far_window(M, B["r"], 1.5, 0.95)
    _far_window(M, B["r"], 3.9, 0.95)
    _far_window(M, B["l"], 1.4, 0.95)
    _far_window(M, B["b"], 1.5, 0.95)
    _far_window(M, B["b"], 5.0, 0.95)
    _far_door(M, B["b"], 3.3, T["door"], w=0.85)
    _open_box(M, -1.0, 5.4, y0, y1, 0, 2.8, wall)
    ym = (y0 + y1) / 2
    fs = extrude_profile(M, [(y0 - 0.3, 2.8), (y0 + 0.5, 4.6), (ym, 5.6), (y1 - 0.5, 4.6), (y1 + 0.3, 2.8)], "x",
                         -1.2, 5.6, roof)
    for f in fs[:2]:
        f.material_index = M.mi(wall)
    _open_box(M, -0.2, 4.6, y0 + 0.35, y0 + 1.6, 2.8, 4.75, wall)
    _far_hip(M, (-0.35, 4.75, y0 + 0.2, y0 + 1.75), (-0.35, 4.75, y0 + 1.0, y0 + 1.75), 4.75, 5.05, roof)
    _open_box(M, -1.0, -0.2, y0, y0 + 2.6, 0, 2.4, wall)
    _far_flat(M, -1.2, 0.0, y0 - 0.2, y0 + 2.8, 2.6, roof)
    _open_box(M, 4.6, 5.2, 3.0, 3.6, 2.5, 6.0, P["brick_home"])
    return L


def b_house_d_far(M, P):
    """b_house_d (the foursquare) from a way off."""
    L = home_lot_far(M, P, P["shingle"], "lawn")
    T, tr = _td(), P["res_trim"]
    wall, roof = mat("hd_clap", "#e0cf9a"), mat("hd_roof", "#566059")
    x0, x1, y0, y1, h = -0.8, 5.2, -0.6, 4.6, 5.6
    _open_box(M, x0, x1, y0, y1, 0, h, wall)
    _far_hip(M, (x0 - 0.5, x1 + 0.5, y0 - 0.5, y1 + 0.5), (2.0, 2.4, 1.9, 2.1), h, h + 1.9, roof)
    _open_box(M, 1.5, 2.9, y0 + 0.5, y0 + 1.6, h + 0.3, h + 1.15, wall)
    _far_hip(M, (1.35, 3.05, y0 + 0.35, y0 + 1.7), (2.1, 2.3, y0 + 1.0, y0 + 1.7), h + 1.15, h + 1.6, roof)
    # the porch: its deck and its low roof (the posts are under a pixel from here)
    _far_flat(M, x0, x1, y0 - 1.9, y0, 0.3, P["drive"])
    _far_hip(M, (x0 - 0.2, x1 + 0.2, y0 - 2.1, y0), (x0 + 0.5, x1 - 0.5, y0 - 1.2, y0), 2.6, 3.0, roof)
    B, D = _faces(x0, x1, y0, y1), _faces(1.5, 2.9, y0 + 0.5, y0 + 1.6)
    _far_door(M, B["f"], 1.6, T["door"])
    _far_window(M, B["f"], 4.2, 1.3)
    _far_window(M, D["f"], 0.7, 0.9, h + 0.42, h + 1.02)
    for a in (1.5, 4.5):
        _far_window(M, B["f"], a, 1.0, 3.6, 4.85)
    for s, places in (("r", (1.4, 3.8)), ("l", (1.4, 3.8)), ("b", (1.5, 4.5))):
        for a in places:
            _far_window(M, B[s], a, 0.95)
            _far_window(M, B[s], a, 0.95, 3.6, 4.85)
    _far_door(M, B["b"], 3.0, T["door_g"], w=0.85)
    _open_box(M, x1 - 0.05, x1 + 0.55, 2.2, 3.0, 0, h + 2.4, P["brick_home"])
    # (the trim band between the storeys, as one strip on the front)
    _wq(M, B["f"], 0, x1 - x0, 2.75, 2.9, tr, 0.06)
    return L


def b_house_e_far(M, P):
    """b_house_e (the gable-front cottage) from a way off."""
    L = home_lot_far(M, P, P["res_roof2"], "shed")
    T = _td()
    wall, roof = mat("he_clap", "#c3ccd2"), mat("he_roof", "#8a4a3b")
    x0, x1, y0, y1, h = 0.0, 5.0, -1.4, 4.8, 2.9
    _open_box(M, x0, x1, y0, y1, 0, h, wall)
    _far_gable(M, x0, x1, y0, y1, h, h + 2.3, "y", roof, wall, oh_u=(0.4, 0.4), oh_a=(0.35, 0.3))
    _far_flat(M, x0, x1, y0 - 1.6, y0, 0.3, P["drive"])
    _quad(M, [(x0 - 0.2, y0 - 1.75, 2.3), (x1 + 0.2, y0 - 1.75, 2.3), (x1 + 0.2, y0 + 0.02, 2.85), (x0 - 0.2, y0 + 0.02, 2.85)], roof)
    B = _faces(x0, x1, y0, y1)
    _far_door(M, B["f"], 1.3, T["oxblood"])
    _far_window(M, B["f"], 3.5, 1.2)
    _far_window(M, B["f"], 2.5, 0.8, h + 0.55, h + 1.45)
    _far_window(M, B["b"], 2.5, 0.8, h + 0.55, h + 1.45)
    for s in ("r", "l"):
        for a in (1.3, 3.1, 4.9):
            _far_window(M, B[s], a, 0.9)
    _far_window(M, B["b"], 1.4, 0.9)
    _far_door(M, B["b"], 3.6, T["door"], w=0.85)
    _open_box(M, 3.3, 3.9, 3.6, 4.2, h + 0.6, h + 3.0, P["brick_home"])
    return L


for _n, _fn in (("house", b_house_far), ("house_b", b_house_b_far), ("house_c", b_house_c_far),
                ("house_d", b_house_d_far), ("house_e", b_house_e_far)):
    BUILDINGS[_n + "_far"] = (_fn, 12, 15, 1)


# ------------------------------------------------------------------ the garden hedges and fences, farthest out
# (render/buildings3d.ts STRIP_FLAT_FROM: a pixel is two metres or more, and a hedge a few tenths of a pixel wide.
# What it leaves on the screen is a speck of green, or white, along the front of a lot: a top and two sides keep
# that, at 6 triangles instead of the far model's 30 or 50. Many thousands of them on a grown map.)

def _flat_run(M, w, h, m):
    """A 4 m run along X as its top and its two long sides."""
    _quad(M, [(-2.0, -w, h), (2.0, -w, h), (2.0, w, h), (-2.0, w, h)], m)
    _quad(M, [(-2.0, -w, 0), (2.0, -w, 0), (2.0, -w, h), (-2.0, -w, h)], m)
    _quad(M, [(2.0, w, 0), (-2.0, w, 0), (-2.0, w, h), (2.0, w, h)], m)


def b_hedge_flat(M, P):
    L = Lot(4.0, 0.8)
    L.bays = []
    _flat_run(M, 0.37, 1.0, P["hg_leaf"])
    return L


def b_picket_flat(M, P):
    L = Lot(4.0, 0.24)
    L.bays = []
    _flat_run(M, 0.06, 1.0, P["pk_white"])
    return L


BUILDINGS["hedge_flat"] = (b_hedge_flat, 4.0, 0.8, 0)
BUILDINGS["picket_flat"] = (b_picket_flat, 4.0, 0.2, 0)

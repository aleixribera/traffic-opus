# What stands on the open land between the towns (src/render/landprops.ts places them on the enclosures of
# src/render/land.ts): the hedgerows round the pastures and hay meadows, the gate in each, the haystacks of a mown
# meadow, and the reeds along the water.
#
# A hedgerow piece is 8 m of overgrown field hedge along X, centred: hawthorn and hazel left to grow, a thorn tree
# standing out of it here and there. The game lays pieces end to end along a field's boundary, each turned end for
# end or not and a little taller or shorter, so no run repeats. Two pieces, so a run is not one shape over and over.
# A gate stands at the middle of its opening, along X. A haystack stands at its own middle (the game also sets small
# ones out in rows as haycocks). A clump of reeds stands at its middle, at the water's edge.
#
# Each of the hedges, the haystack and the reeds has a second, far model of a tenth of the faces (`*_far`), the same
# shape in the same colours: the game draws it once the camera has risen and a hedge is a few pixels high, where a
# screen holds thousands of them.
#
# Their colours are plain ones: the game's own shader turns the leaves with the season and lays the snow on them.


def _rng(seed):
    s = [seed * 2654435761 % 4294967296 or 1]

    def r(a=0.0, b=1.0):
        s[0] = (s[0] * 1664525 + 1013904223) % 4294967296
        return a + (b - a) * (s[0] / 4294967296)
    return r


def _ridge(M, secs, mats):
    """A long lumpy solid along X through cross-sections (x, y, half width, height): five points each, a face a side
    between one and the next, the two ends closed. Open underneath, where it stands on the ground."""
    bm = M.bm
    loops = [[bm.verts.new((x, y - w, 0.0)), bm.verts.new((x, y - w * 0.86, h * 0.56)), bm.verts.new((x, y, h)),
              bm.verts.new((x, y + w * 0.86, h * 0.56)), bm.verts.new((x, y + w, 0.0))] for x, y, w, h in secs]
    fs = []
    for k, (a, b) in enumerate(zip(loops, loops[1:])):
        for i in range(4):
            f = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
            f.material_index = M.mi(mats[(k + i // 2) % len(mats)])
            fs.append(f)
    for loop, m in ((loops[0][::-1], mats[0]), (loops[-1], mats[-1])):
        f = bm.faces.new(loop)
        f.material_index = M.mi(m)
        fs.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=fs)


def _hedgerow(M, seed, thorn, far=False):
    r = _rng(seed)
    foot, leaves, wood = mat("lh_foot", "#44552a"), (mat("lh_leaf", "#4a6a2a"), mat("lh_leaf2", "#56782f"), mat("lh_leaf3", "#3f5f27")), mat("lh_wood", "#5a4634")
    # (the bramble at its foot, end to end: what gives the piece its full length)
    if not far:
        box(M, -4.0, 4.0, -0.5, 0.5, 0, 0.3, foot, bevel=0.1)
    x = -3.3
    k = 0
    lumps = []
    while x < 3.4:
        rad = r(0.72, 0.98)
        h = r(1.7, 2.5)
        y = r(-0.1, 0.1)
        x = max(-4.0 + rad, min(4.0 - rad, x))
        m = leaves[k % 3]
        rot = r(0, 1.0)
        lumps.append((x, y, rad, h))
        if not far:
            revolve(M, x, y, [(rad * 0.62, 0.1), (rad, h * 0.42), (rad * 0.86, h * 0.74), (rad * 0.4, h), (0.0, h + 0.12)], m,
                    n=6, rot=rot)
        x += rad * r(1.05, 1.3)
        k += 1
    if far:
        # (the same lumps as one ridge: its top at three of theirs, high, low and high, its ends where the next
        # piece's meet it)
        secs = [(-4.0, 0.0, 0.74, lumps[0][3] * 0.78)]
        for at, wide, tall in ((-2.3, 1.0, 1.04), (0.2, 0.84, 0.7), (2.4, 1.0, 1.0)):
            lx, ly, rad, h = min(lumps, key=lambda l: abs(l[0] - at))
            secs.append((lx, ly, rad * wide, h * tall))
        secs.append((4.0, 0.0, 0.74, lumps[-1][3] * 0.78))
        _ridge(M, secs, leaves)
    if thorn:
        # (a thorn tree left standing in the hedge: a stem, a crown twice the hedge's height)
        tx = r(-1.6, 1.6)
        if far:
            revolve(M, tx + 0.15, 0.05, [(0.72, 2.1), (1.08, 3.05), (0.6, 3.95), (0.0, 4.4)], leaves[1], n=5, rot=0.3)
            return
        revolve(M, tx, 0.0, [(0.13, 0.0), (0.09, 2.6)], wood, n=5)
        revolve(M, tx, 0.0, [(0.7, 2.2), (1.02, 3.0), (0.88, 3.7), (0.35, 4.3), (0.0, 4.42)], leaves[1], n=7, rot=0.3)
        revolve(M, tx + 0.55, 0.25, [(0.45, 2.5), (0.66, 3.05), (0.3, 3.6), (0.0, 3.68)], leaves[0], n=6, rot=0.7)


def b_land_hedgerow_a(M, P):
    """8 m of overgrown field hedge along X: lumps of hawthorn and hazel over a foot of rank grass."""
    L = Lot(8.0, 2.0)
    L.bays = []
    _hedgerow(M, 11, False)
    return L


def b_land_hedgerow_b(M, P):
    """The same hedge with a thorn tree standing out of it."""
    L = Lot(8.0, 2.0)
    L.bays = []
    _hedgerow(M, 29, True)
    return L


def b_land_hedgerow_a_far(M, P):
    """The hedge from far off: one lumpy ridge."""
    L = Lot(8.0, 1.9)
    L.bays = []
    _hedgerow(M, 11, False, far=True)
    return L


def b_land_hedgerow_b_far(M, P):
    """The hedge and its thorn tree from far off."""
    L = Lot(8.0, 2.0)
    L.bays = []
    _hedgerow(M, 29, True, far=True)
    return L


def b_land_gate(M, P):
    """A five-bar field gate between two oak posts, along X: 3.6 m of gate, braced corner to corner, hung on the
    left post, weathered silver-grey."""
    L = Lot(4.2, 0.3)
    L.bays = []
    post, bar_m = mat("lg_post", "#6b5a48"), mat("lg_bar", "#9a9080")
    for s in (-1, 1):
        box(M, s * 1.95 - 0.15, s * 1.95 + 0.15, -0.15, 0.15, 0, 1.55, post, bevel=0.03)
    for z in (0.3, 0.55, 0.8, 1.05, 1.3):
        box(M, -1.8, 1.8, -0.035, 0.035, z - 0.045, z + 0.045, bar_m)
    for x in (-1.76, 0.0, 1.76):
        box(M, x - 0.05, x + 0.05, -0.05, 0.05, 0.22, 1.36, bar_m)
    _beam(M, (-1.72, 0.045, 0.3), (1.72, 0.045, 1.3), 0.03, 0.09, bar_m)
    return L


def b_land_haystack(M, P):
    """A haystack as a farm built it by hand: round, waisted, thatched to a point, a few props leaning on it."""
    L = Lot(4.35, 4.35)
    L.bays = []
    hay, thatch, wood = mat("ly_hay", "#cdb671"), mat("ly_thatch", "#b39a5c"), mat("lh_wood", "#5a4634")
    n = 12
    revolve(M, 0, 0, [(1.95, 0.0), (2.25, 1.5), (2.12, 2.1)], hay, n=n, rot=math.pi / n)
    revolve(M, 0, 0, [(2.25, 2.02), (1.2, 3.25), (0.3, 4.0), (0.0, 4.12)], thatch, n=n, rot=math.pi / n)
    # (the props that keep the thatch down)
    for a in (0.5, 2.4, 4.3):
        _beam(M, (2.2 * math.cos(a), 2.2 * math.sin(a), 0.2), (1.5 * math.cos(a), 1.5 * math.sin(a), 2.9), 0.09, 0.09, wood)
    return L


def b_land_haystack_far(M, P):
    """The haystack from far off (and the haycocks): the same waisted shape, six-sided."""
    L = Lot(3.9, 4.5)
    L.bays = []
    hay, thatch = mat("ly_hay", "#cdb671"), mat("ly_thatch", "#b39a5c")
    revolve(M, 0, 0, [(1.95, 0.0), (2.25, 1.5), (2.2, 2.05)], hay, n=6, rot=math.pi / 6)
    revolve(M, 0, 0, [(2.2, 2.05), (1.2, 3.25), (0.0, 4.12)], thatch, n=6, rot=math.pi / 6)
    return L


def b_land_reeds(M, P):
    """A clump of reeds and bulrushes at the water's edge: blades leaning out from the middle, a few brown heads."""
    L = Lot(1.71, 2.11)
    L.bays = []
    r = _rng(7)
    blades, head = (mat("lr_reed", "#8a9440"), mat("lr_reed2", "#9aa64c"), mat("lr_reed3", "#7a8a3a")), mat("lr_head", "#5e4028")
    for k in range(26):
        a = r(0, 2 * math.pi)
        d = r(0.05, 0.85)
        cx, cy = d * math.cos(a), d * math.sin(a)
        h = r(1.3, 2.3)
        lean = r(0.1, 0.42)
        tip = (cx + math.cos(a) * lean, cy + math.sin(a) * lean, h)
        M.cone(ngon(cx, cy, r(0.05, 0.085), 3, 0.0, rot=r(0, 2)), tip, blades[k % 3])
        if k % 5 == 0:
            # (a bulrush: its brown head a hand's length below the blade's tip)
            hx, hy, hz = cx + (tip[0] - cx) * 0.8, cy + (tip[1] - cy) * 0.8, h * 0.8
            cyl(M, hx, hy, 0.06, hz - 0.16, hz + 0.16, head, n=5)
    # (the wet tussock they stand in: what gives the clump its full footprint)
    revolve(M, 0, 0, [(0.8, 0.0), (0.62, 0.12), (0.0, 0.2)], blades[2], n=8, rot=math.pi / 8)
    return L


def b_land_reeds_far(M, P):
    """The clump from far off: a few broad blades over the tussock."""
    L = Lot(1.61, 1.66)
    L.bays = []
    r = _rng(7)
    blades = (mat("lr_reed", "#8a9440"), mat("lr_reed2", "#9aa64c"), mat("lr_reed3", "#7a8a3a"))
    for k in range(7):
        a = k * 0.9 + r(0, 0.5)
        d = r(0.15, 0.7)
        cx, cy = d * math.cos(a), d * math.sin(a)
        h = r(1.5, 2.3)
        lean = r(0.1, 0.42)
        M.cone(ngon(cx, cy, r(0.2, 0.3), 3, 0.0, rot=r(0, 2)), (cx + math.cos(a) * lean, cy + math.sin(a) * lean, h), blades[k % 3])
    revolve(M, 0, 0, [(0.8, 0.0), (0.62, 0.12), (0.0, 0.2)], blades[2], n=5, rot=math.pi / 8)
    return L


BUILDINGS["land_hedgerow_a"] = (b_land_hedgerow_a, 8.0, 2.0, 0)
BUILDINGS["land_hedgerow_b"] = (b_land_hedgerow_b, 8.0, 2.0, 0)
BUILDINGS["land_gate"] = (b_land_gate, 4.2, 0.3, 0)
BUILDINGS["land_haystack"] = (b_land_haystack, 4.35, 4.35, 0)
BUILDINGS["land_reeds"] = (b_land_reeds, 1.71, 2.11, 0)
BUILDINGS["land_hedgerow_a_far"] = (b_land_hedgerow_a_far, 8.0, 1.9, 0)
BUILDINGS["land_hedgerow_b_far"] = (b_land_hedgerow_b_far, 8.0, 2.0, 0)
BUILDINGS["land_haystack_far"] = (b_land_haystack_far, 3.9, 4.5, 0)
BUILDINGS["land_reeds_far"] = (b_land_reeds_far, 1.61, 1.66, 0)
POST_ORIGIN.update(("land_hedgerow_a", "land_hedgerow_b", "land_gate", "land_haystack", "land_reeds",
                    "land_hedgerow_a_far", "land_hedgerow_b_far", "land_haystack_far", "land_reeds_far"))

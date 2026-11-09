"""Civic buildings, batch A: the schoolhouse, church, bandstand green, post office, fire hall and Carnegie library a
town gets when the player completes one of its town orders (src/game/civics.ts).

Exec'd into build_models.py's globals (see the hook after BUILDINGS), so it uses that module's helpers, palette and
conventions: 1 unit = 1 m, Z up, the lot is the whole w x d footprint centred on the origin, the street side at -Y,
the entrance path centred on x = 0 and reaching the lot's front edge. Lots without parking are grass over the whole
footprint (the parks' style) and have no park_N empties. Period: a 1920s-40s American small town, read from straight
above: each has its own roof shape and colour, a contrasting tower, cupola or dome, and some yard detail.
"""


def _cva():
    """Batch A's own flat colours (prefixed cv_): muted, satellite-like, the period palette."""
    return {k: mat(k, v) for k, v in {
        "cv_redclap": "#9b4636", "cv_tinroof": "#7a3a30", "cv_tinroof2": "#6a322a", "cv_white": "#eeeadf", "cv_white2": "#dcd7c9",
        "cv_slate": "#4c525b", "cv_slate2": "#5a616b", "cv_dirt": "#b7a37f", "cv_stone": "#d9d0ba",
        "cv_stone2": "#c4b99f", "cv_brick": "#97503d", "cv_brick2": "#83443a", "cv_firedoor": "#a8342a",
        "cv_tar": "#7a7772", "cv_poslate": "#56625e", "cv_hose": "#cbbd98", "cv_tile": "#965a48", "cv_lead": "#8d9294", "cv_mailbox": "#2c4a7e", "cv_brass": "#b08a3c",
        "cv_bandroof": "#a03c32", "cv_lattice": "#7f8a6c", "cv_deck": "#8f8576", "cv_headstone": "#c3c0b6", "cv_mown": "#86924a",
        "cv_gravel": "#cfc6ad", "cv_door": "#4a3b30", "cv_flower": "#b5583f",
    }.items()}


def _cva_win(M, axis, plane, sgn, u, z0, z1, wd, gm, fm, t=0.14):
    """A window on the wall plane `plane` (y = plane for axis 'y', x = plane for axis 'x') whose outward normal is
    sgn: a painted surround standing 0.05 proud and the glass 0.09 proud inside it."""
    for out, e, m in ((0.05, t, fm), (0.09, 0.0, gm)):
        a, b = sorted((plane, plane + sgn * out))
        if axis == "y":
            box(M, u - wd / 2 - e, u + wd / 2 + e, a, b, z0 - e, z1 + e, m)
        else:
            box(M, a, b, u - wd / 2 - e, u + wd / 2 + e, z0 - e, z1 + e, m)


def _cva_fence(M, pts, m, post, h=1.05, step=3.2):
    """A low painted fence along a polyline: two rails and square capped posts."""
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        bar(M, (ax, ay), (bx, by), 0.16, h - 0.16, h, m)
        bar(M, (ax, ay), (bx, by), 0.1, 0.35, 0.47, m)
        n = max(1, round(math.hypot(bx - ax, by - ay) / step))
        for i in range(n + 1):
            px, py = ax + (bx - ax) * i / n, ay + (by - ay) * i / n
            box(M, px - 0.13, px + 0.13, py - 0.13, py + 0.13, 0, h + 0.12, post)


def _cva_lamp(M, P, x, y, h=3.8):
    """Cast-iron park lamp: dark post, frosted globe."""
    cyl(M, x, y, 0.2, PAD_H, 0.45, P["lp_iron"], n=6)
    cyl(M, x, y, 0.08, 0.45, h, P["lp_iron"], n=6)
    revolve(M, x, y, [(0.0, h - 0.05), (0.26, h + 0.12), (0.3, h + 0.35), (0.2, h + 0.58), (0.0, h + 0.64)],
            P["lp_glass"], n=8)


def _cva_steps(M, x0, x1, y_front, y_back, z_top, n, m):
    """A flight of n steps rising toward +Y, from the ground at y_front to z_top at y_back."""
    for i in range(n):
        y = y_front + (y_back - y_front) * i / n
        box(M, x0, x1, y, y_back, 0, z_top * (i + 1) / n, m)


# ------------------------------------------------------------------ schoolhouse

def b_schoolhouse(M, P):
    """One-room-and-a-half country schoolhouse: red clapboard under a red-oxide tin gable, gable end to the street,
    a white bell cupola on the ridge over the entry porch, a brick stove chimney at the back, a flagpole in the
    front yard, and behind it a packed-earth playground with a swing set, a see-saw and the two privies, all inside
    a white rail fence round the lot."""
    C = _cva()
    L = green_lot(M, P, 24, 32)
    wall, roof, white, glass = C["cv_redclap"], C["cv_tinroof"], C["cv_white"], P["lm_glass"]
    z0 = PAD_H
    # packed-earth yard behind the school, the path to the front gate
    box(M, -10.6, 10.6, 6.6, 14.8, z0, z0 + 0.03, C["cv_dirt"])
    box(M, -1.0, 1.0, -16.0, -10.6, z0, z0 + 0.04, P["path"])
    box(M, -1.6, 1.6, -7.0, 6.6, z0, z0 + 0.025, C["cv_dirt"])
    # the schoolroom: ridge along Y, eaves 4.4, ridge 7.6
    x0, x1, y0, y1 = -5.2, 5.2, -8.0, 5.6
    box(M, x0 - 0.12, x1 + 0.12, y0 - 0.12, y1 + 0.12, 0, 0.55, P["stone"])
    box(M, x0, x1, y0, y1, 0.55, 4.4, wall)
    gable(M, x0, x1, y0, y1, 4.4, 7.6, "y", roof, wall, oh_u=(0.55, 0.55), oh_a=(0.5, 0.5), th=0.24)
    box(M, -0.22, 0.22, y0 - 0.5, y1 + 0.5, 7.5, 7.68, C["cv_tinroof2"])          # ridge cap
    for sx in (x0, x1):          # white corner boards
        for sy in (y0, y1):
            box(M, sx - 0.12, sx + 0.12, sy - 0.12, sy + 0.12, 0.55, 4.0, white)
    for k in range(4):           # four tall sash windows down each side
        wy = y0 + 2.0 + k * (y1 - y0 - 4.0) / 3
        _cva_win(M, "x", x0, -1, wy, 1.4, 3.6, 1.1, glass, white)
        _cva_win(M, "x", x1, 1, wy, 1.4, 3.6, 1.1, glass, white)
    for wx in (-2.9, 2.9):       # two front windows either side of the porch
        _cva_win(M, "y", y0, -1, wx, 1.6, 3.6, 1.0, glass, white)
    box(M, -0.9, 0.9, y0 - 0.06, y0, 5.2, 6.2, white)      # louvred gable vent
    box(M, -0.6, 0.6, y0 - 0.1, y0 - 0.06, 5.35, 6.05, P["ind_dark"])
    # entry porch: a little gabled vestibule, the door, two steps
    vx0, vx1, vy0 = -1.9, 1.9, y0 - 2.4
    box(M, vx0, vx1, vy0, y0, 0.55, 3.3, wall)
    box(M, vx0 - 0.1, vx1 + 0.1, vy0 - 0.1, y0, 0, 0.55, P["stone"])
    gable(M, vx0, vx1, vy0, y0, 3.3, 4.9, "y", roof, white, oh_u=(0.35, 0.35), oh_a=(0.35, 0.0), th=0.2)
    box(M, -0.65, 0.65, vy0 - 0.06, vy0, 0.55, 2.8, C["cv_door"])
    box(M, -0.85, 0.85, vy0 - 0.1, vy0 - 0.06, 2.8, 3.05, white)
    _cva_steps(M, -1.1, 1.1, vy0 - 0.9, vy0 - 0.1, 0.55, 2, P["stone"])
    # bell cupola on the ridge over the front: white box, open belfry, bell, red pyramid cap
    cy = y0 + 1.9
    box(M, -1.2, 1.2, cy - 1.2, cy + 1.2, 6.6, 8.3, white)
    box(M, -1.32, 1.32, cy - 1.32, cy + 1.32, 8.3, 8.45, C["cv_white2"])
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(M, sx * 1.02 - 0.17, sx * 1.02 + 0.17, cy + sy * 1.02 - 0.17, cy + sy * 1.02 + 0.17, 8.45, 9.8, white)
    revolve(M, 0.0, cy, [(0.0, 8.75), (0.48, 8.75), (0.38, 9.2), (0.22, 9.6), (0.0, 9.65)], C["cv_brass"], n=8)
    box(M, -1.45, 1.45, cy - 1.45, cy + 1.45, 9.8, 10.05, C["cv_white2"])
    cone(M, 0.0, cy, 2.1, 10.05, 11.7, white, n=4)
    cyl(M, 0.0, cy, 0.05, 11.6, 12.4, P["ind_steel"], n=4)
    # stove chimney at the back of the ridge
    box(M, -0.45, 0.45, y1 - 1.9, y1 - 1.1, 6.0, 8.7, C["cv_brick"])
    box(M, -0.55, 0.55, y1 - 2.0, y1 - 1.0, 8.7, 8.95, C["cv_brick2"])
    # front yard: flagpole on a stone base, two shade trees
    cyl(M, -5.6, -12.6, 0.55, z0, 0.35, P["stone"], n=8)
    _flagpole(M, P, -5.6, -12.6, 9.5)
    tree(M, P, 8.3, -11.0, 1.05)
    tree(M, P, -8.8, -6.4, 0.85, alt=True)
    # the playground: swing set and see-saw on the earth yard
    sx, sy, z = -5.6, 10.8, z0 + 0.03
    bar(M, (sx - 2.4, sy), (sx + 2.4, sy), 0.16, 2.5, 2.7, C["cv_white2"])
    for dx in (-2.3, 2.3):
        for dy in (-0.7, 0.7):
            bar(M, (sx + dx, sy + dy), (sx + dx, sy + dy * 0.1), 0.14, z, 2.6, C["cv_white2"])
    for dx in (-1.1, 1.1):
        box(M, sx + dx - 0.32, sx + dx + 0.32, sy - 0.16, sy + 0.16, 0.55, 0.63, P["wood"])
        for ex in (-0.26, 0.26):
            box(M, sx + dx + ex - 0.025, sx + dx + ex + 0.025, sy - 0.025, sy + 0.025, 0.63, 2.5, P["ind_dark"])
    tx, ty = 3.2, 10.8
    box(M, tx - 0.3, tx + 0.3, ty - 0.25, ty + 0.25, z, 0.6, P["ind_dark"])
    lo = [(tx - 2.2, ty - 0.18, 0.25), (tx + 2.2, ty - 0.18, 0.95), (tx + 2.2, ty + 0.18, 0.95), (tx - 2.2, ty + 0.18, 0.25)]
    M.loft(lo, [(x, y, zz + 0.1) for x, y, zz in lo], P["wood"])
    # the two privies in the back corner, under shed roofs
    for px in (7.6, 9.6):
        box(M, px - 0.75, px + 0.75, 12.6, 14.0, z, 2.3, C["cv_white2"])
        taper(M, (px - 0.9, px + 0.9, 12.4, 14.2), (px - 0.9, px + 0.9, 12.4, 12.6), 2.3, 2.65, roof)
        box(M, px - 0.35, px + 0.35, 12.54, 12.6, 0.1, 1.9, C["cv_door"])
    tree(M, P, -9.6, 13.6, 0.8, alt=True)
    # white rail fence round the lot, a gate gap at the path
    e = 11.75
    _cva_fence(M, [(-1.3, -15.75), (-e, -15.75), (-e, 15.75), (e, 15.75), (e, -15.75), (1.3, -15.75)], white,
               C["cv_white2"])
    return L


# ------------------------------------------------------------------ church

def b_church(M, P):
    """White clapboard meeting-house church: a steep slate nave with tall windows, a square tower at the front with a
    louvred belfry, an octagonal stage and a tall white spire, a lower chancel behind, and a walled graveyard of
    headstone rows on the mown lawn, with an old shade tree and two cedars."""
    C = _cva()
    L = green_lot(M, P, 24, 40)
    white, white2, roof, glass = C["cv_white"], C["cv_white2"], C["cv_slate"], P["lm_glass"]
    z0 = PAD_H
    box(M, -1.1, 1.1, -20.0, -16.6, z0, z0 + 0.04, P["path"])
    # nave: ridge along Y, eaves 7.0, ridge 13.6
    nx0, nx1, ny0, ny1 = -6.0, 6.0, -10.4, 9.0
    box(M, nx0 - 0.1, nx1 + 0.1, ny0 - 0.1, ny1 + 0.1, 0, 0.6, P["stone"])
    box(M, nx0, nx1, ny0, ny1, 0.6, 7.0, white)
    gable(M, nx0, nx1, ny0, ny1, 7.0, 13.6, "y", roof, white, oh_u=(0.6, 0.6), oh_a=(0.4, 0.4), th=0.26)
    for k in range(4):
        wy = ny0 + 3.6 + k * (ny1 - ny0 - 6.0) / 3
        _cva_win(M, "x", nx0, -1, wy, 2.2, 5.8, 1.2, glass, white2)
        _cva_win(M, "x", nx1, 1, wy, 2.2, 5.8, 1.2, glass, white2)
    # chancel at the back, lower
    cx0, cx1, cy1 = -3.6, 3.6, 12.6
    box(M, cx0, cx1, ny1, cy1, 0.6, 5.2, white)
    box(M, cx0 - 0.1, cx1 + 0.1, ny1, cy1 + 0.1, 0, 0.6, P["stone"])
    gable(M, cx0, cx1, ny1, cy1, 5.2, 9.0, "y", roof, white, oh_u=(0.45, 0.45), oh_a=(0.0, 0.45), th=0.22)
    _cva_win(M, "y", cy1, 1, 0.0, 1.8, 4.4, 1.3, glass, white2)
    # the tower: shaft, louvred belfry, cornice, octagonal stage and the spire
    t, ty0, ty1 = 2.7, -15.6, -10.4
    tyc = (ty0 + ty1) / 2
    box(M, -t - 0.1, t + 0.1, ty0 - 0.1, ty1, 0, 0.6, P["stone"])
    box(M, -t, t, ty0, ty1, 0.6, 16.2, white)
    band(M, -t, t, ty0, ty1, 11.4, 11.8, white2, o=0.12)
    for (ax, pl, sg, u) in (("y", ty0, -1, 0.0), ("x", -t, -1, tyc), ("x", t, 1, tyc)):
        _cva_win(M, ax, pl, sg, u, 12.6, 15.4, 1.7, P["ind_dark"], white2)
    _cva_win(M, "y", ty0, -1, 0.0, 6.2, 8.6, 1.0, glass, white2)       # round-headed window over the door
    box(M, -t - 0.3, t + 0.3, ty0 - 0.3, ty1 + 0.3, 16.2, 16.8, white2)
    for sx in (-1, 1):           # corner urns on the cornice
        for sy in (-1, 1):
            cone(M, sx * (t - 0.1), tyc + sy * (t - 0.1), 0.3, 16.8, 17.7, white, n=4)
    cyl(M, 0.0, tyc, 1.9, 16.8, 18.9, white, n=8)
    cyl(M, 0.0, tyc, 2.1, 18.9, 19.3, white2, n=8)
    cone(M, 0.0, tyc, 2.0, 19.3, 29.5, white, n=8)
    cyl(M, 0.0, tyc, 0.06, 29.3, 30.6, C["cv_brass"], n=4)
    # door: a pedimented frame, double doors, stone steps down to the path
    box(M, -1.0, 1.0, ty0 - 0.06, ty0, 0.6, 3.6, C["cv_door"])
    box(M, -1.4, 1.4, ty0 - 0.22, ty0, 3.6, 4.0, white2)
    gable(M, -1.4, 1.4, ty0 - 0.22, ty0, 4.0, 4.8, "x", white2, None, oh_u=(0.0, 0.0), oh_a=(0.05, 0.05), th=0.2)
    _cva_steps(M, -1.6, 1.6, ty0 - 1.1, ty0 - 0.1, 0.6, 3, P["stone"])
    # graveyard: a low fieldstone wall round the back and the right-hand lawn, headstone rows inside
    gx0, gy0, gy1 = 6.4, 13.6, 19.6
    box(M, gx0 + 0.6, 11.6, -9.6, gy1 - 0.4, z0, z0 + 0.02, C["cv_mown"])
    box(M, -11.6, 11.6, gy0 + 0.4, gy1 - 0.4, z0, z0 + 0.02, C["cv_mown"])
    wm = C["cv_stone2"]
    ribbon(M, [(-11.6, gy0), (gx0 - 0.4, gy0), (gx0 + 0.4, gy0 - 0.8), (gx0 + 0.4, -10.0), (11.65, -10.0),
               (11.65, 19.65), (-11.65, 19.65), (-11.65, gy0 + 1.4)], 0.5, 0, 0.75, wm)
    hs = C["cv_headstone"]
    for row, y in enumerate((15.3, 17.6)):
        for k in range(11):
            x = -10.4 + k * 2.0 + (0.5 if row else 0.0)
            if abs(x - 2.8) < 0.8:
                continue
            box(M, x - 0.42, x + 0.42, y - 0.16, y + 0.16, z0, 0.95, hs)
    for col, x in enumerate((8.4, 10.4)):
        for k in range(10):
            y = -8.4 + k * 2.2 + (0.8 if col else 0.0)
            if y > gy0 - 1.0:
                continue
            box(M, x - 0.16, x + 0.16, y - 0.42, y + 0.42, z0, 0.95, hs)
    for x, y in ((2.8, 16.4), (9.4, 2.0)):              # two obelisk family monuments
        box(M, x - 0.55, x + 0.55, y - 0.55, y + 0.55, z0, 0.5, hs)
        taper(M, (x - 0.3, x + 0.3, y - 0.3, y + 0.3), (x - 0.12, x + 0.12, y - 0.12, y + 0.12), 0.5, 2.8, hs)
    # trees: an old elm by the front path, two cedars at the back of the graveyard
    tree(M, P, -7.8, -14.2, 1.25)
    tree(M, P, -9.2, 3.8, 1.05, alt=True)
    conifer(M, P, -9.4, 16.8, 0.7)
    conifer(M, P, 9.4, 16.4, 0.62, alt=True)
    return L


# ------------------------------------------------------------------ bandstand green

def b_bandstand(M, P):
    """Bandstand green: an octagonal white bandstand on a latticed base under a red bell-cast roof, on a round
    gravel plaza where four paths cross the green, with benches round the plaza, iron lamps and shade trees in the
    four quarters."""
    C = _cva()
    L = green_lot(M, P, 32, 32)
    z0, z1, pm = PAD_H, PAD_H + 0.03, P["path"]
    white, white2 = C["cv_white"], C["cv_white2"]
    # the paths: a round plaza and a cross out to the four edges
    cyl(M, 0, 0, 8.0, z0, z1, pm, n=20)
    for a, b in (((0.0, -16.0), (0.0, -7.8)), ((0.0, 7.8), (0.0, 16.0)),
                 ((-16.0, 0.0), (-7.8, 0.0)), ((7.8, 0.0), (16.0, 0.0))):
        ribbon(M, [a, b], 2.4, z0, z1, pm)
    # a ring of flower bed round the bandstand, open at the steps
    ring = [(5.6 * math.cos(math.radians(a)), 5.6 * math.sin(math.radians(a))) for a in range(-68, 250, 22)]
    ribbon(M, ring, 0.8, z1, z1 + 0.32, P["hg_leaf2"])
    for a in range(-57, 245, 22):
        r = math.radians(a)
        cyl(M, 5.6 * math.cos(r), 5.6 * math.sin(r), 0.3, z1 + 0.3, z1 + 0.46, C["cv_flower"], n=5)
    # the bandstand: latticed base, deck, eight posts, rail, frieze, red bell-cast roof, finial
    rot = math.pi / 8
    revolve(M, 0, 0, [(4.2, 0.0), (4.2, 1.1), (0.0, 1.1)], C["cv_lattice"], n=8, rot=rot)
    revolve(M, 0, 0, [(4.5, 1.1), (4.5, 1.3), (0.0, 1.3)], white, n=8, rot=rot)
    revolve(M, 0, 0, [(4.1, 1.3), (4.1, 1.33), (0.0, 1.33)], C["cv_deck"], n=8, rot=rot)
    _cva_steps(M, -1.2, 1.2, -5.8, -4.1, 1.1, 4, white2)
    pts = [(4.05 * math.cos(rot + i * math.pi / 4), 4.05 * math.sin(rot + i * math.pi / 4)) for i in range(8)]
    for x, y in pts:
        box(M, x - 0.14, x + 0.14, y - 0.14, y + 0.14, 1.3, 4.7, white)
    rail = pts[5:] + pts[:5]     # all round but the front side, where the steps come up
    ribbon(M, rail[1:] + rail[:1], 0.12, 2.15, 2.3, white)
    ribbon(M, pts + pts[:1], 0.32, 4.45, 5.0, white2)
    revolve(M, 0, 0, [(5.1, 4.85), (4.7, 5.0), (3.9, 5.35), (3.0, 5.95), (2.1, 6.75), (1.2, 7.6), (0.5, 8.45),
                      (0.0, 8.75)], C["cv_bandroof"], n=8, rot=rot)
    cyl(M, 0, 0, 0.18, 8.65, 9.2, white, n=6)
    revolve(M, 0, 0, [(0.0, 9.2), (0.26, 9.35), (0.26, 9.55), (0.0, 9.7)], C["cv_brass"], n=6)
    # benches round the plaza, facing in; lamps on the diagonals
    for a in (28, 62, 118, 152, 208, 242, 298, 332):
        t = math.radians(a)
        bench(M, P, 7.1 * math.cos(t), 7.1 * math.sin(t), t + math.pi / 2)
    for a in (45, 135, 225, 315):
        t = math.radians(a)
        _cva_lamp(M, P, 8.7 * math.cos(t), 8.7 * math.sin(t))
    for x, y in ((-1.9, -14.6), (1.9, -14.6)):
        _cva_lamp(M, P, x, y)
    # shade trees in the four quarters
    for x, y, s, k in ((-11.6, -11.4, 1.25, 0), (11.4, -11.8, 1.1, 1), (-11.8, 11.2, 1.15, 1), (11.6, 11.6, 1.3, 0),
                       (-13.4, -4.4, 0.75, 1), (13.2, 4.6, 0.8, 0), (4.6, 13.2, 0.7, 1)):
        tree(M, P, x, y, s, alt=bool(k))
    return L


# ------------------------------------------------------------------ post office

def b_postoffice(M, P):
    """Small-town federal post office (the 1930s Treasury pattern): one tall storey of red brick on a limestone base,
    limestone cornice and entrance frontispiece with a fanlit door, tall arched windows, a hipped slate roof with a
    white cupola, steps and a stone walk to the street, a flag on the lawn and a blue mailbox by the walk. Two
    parking bays on the left."""
    C = _cva()
    L = lot(M, P, 24, 24, bay_row(2, -8.6), asphalt=(-12.0, -5.0))
    brick, stone, stone2, roof, glass = C["cv_brick"], C["cv_stone"], C["cv_stone2"], C["cv_slate"], P["lm_glass"]
    z0 = PAD_H
    yp = L.yf + PARK_DEPTH
    # lawns over the pad, a stone walk down the middle
    box(M, -12.0, 12.0, yp, 12.0, z0, z0 + 0.02, P["grass"])
    box(M, -5.0, 12.0, -12.0, yp, z0, z0 + 0.02, P["grass"])
    box(M, -1.5, 1.5, -12.0, -2.6, z0, z0 + 0.05, P["lm_paving"])
    box(M, -12.0, -5.0, yp, yp + 1.6, z0, z0 + 0.05, P["lm_paving"])    # kerb walk behind the bays
    # the block: base course, brick, cornice, hipped slate roof
    x0, x1, y0, y1 = -8.4, 8.4, -0.8, 10.6
    box(M, x0 - 0.12, x1 + 0.12, y0 - 0.12, y1 + 0.12, 0, 1.0, stone)
    box(M, x0, x1, y0, y1, 1.0, 6.4, brick)
    box(M, x0 - 0.35, x1 + 0.35, y0 - 0.35, y1 + 0.35, 6.4, 7.0, stone, bevel=0.06)
    _hip(M, x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, 7.0, 10.2, C["cv_poslate"], oh=0.35)
    # tall windows with limestone keystones; entrance frontispiece in the middle
    for wx in (-6.4, -3.9, 3.9, 6.4):
        _cva_win(M, "y", y0, -1, wx, 1.7, 5.0, 1.3, glass, C["cv_white"])
        box(M, wx - 0.85, wx + 0.85, y0 - 0.12, y0, 1.3, 1.5, stone)
        box(M, wx - 0.3, wx + 0.3, y0 - 0.14, y0, 5.1, 5.6, stone)
    for k in range(3):
        wy = y0 + 2.6 + k * (y1 - y0 - 5.2) / 2
        _cva_win(M, "x", x0, -1, wy, 1.7, 5.0, 1.3, glass, C["cv_white"])
        _cva_win(M, "x", x1, 1, wy, 1.7, 5.0, 1.3, glass, C["cv_white"])
    box(M, -2.1, 2.1, y0 - 0.45, y0, 1.0, 6.4, stone)
    for px in (-1.75, 1.75):
        box(M, px - 0.3, px + 0.3, y0 - 0.65, y0 - 0.45, 1.0, 6.2, C["cv_white"])
    box(M, -0.95, 0.95, y0 - 0.5, y0 - 0.45, 1.0, 3.8, C["cv_door"])
    _cva_win(M, "y", y0 - 0.45, -1, 0.0, 4.1, 5.2, 1.6, glass, C["cv_white"], t=0.1)
    box(M, -2.3, 2.3, y0 - 0.75, y0 - 0.45, 6.4, 7.0, stone)
    _cva_steps(M, -2.0, 2.0, -2.8, y0 - 0.45, 1.0, 4, stone2)
    # white cupola on the roof with a lead cap and a gilt finial
    cy = (y0 + y1) / 2 + 1.0
    box(M, -1.0, 1.0, cy - 1.0, cy + 1.0, 8.6, 11.4, C["cv_white"])
    for sx in (-1, 1):
        box(M, -0.45, 0.45, cy + sx * 1.0 - 0.04, cy + sx * 1.0 + 0.04, 9.9, 11.0, P["ind_dark"])
        box(M, sx * 1.0 - 0.04, sx * 1.0 + 0.04, cy - 0.45, cy + 0.45, 9.9, 11.0, P["ind_dark"])
    box(M, -1.2, 1.2, cy - 1.2, cy + 1.2, 11.4, 11.65, C["cv_white2"])
    revolve(M, 0.0, cy, [(1.05, 11.65), (0.95, 12.2), (0.6, 12.75), (0.15, 13.1), (0.0, 13.15)], P["dome"], n=8,
            rot=math.pi / 8)
    cyl(M, 0.0, cy, 0.05, 13.1, 13.9, C["cv_brass"], n=4)
    # flag on the lawn, blue mailbox by the walk, lamps at the steps, trees
    cyl(M, 7.0, -7.8, 0.6, z0, 0.4, stone, n=8)
    _flagpole(M, P, 7.0, -7.8, 10.0)
    box(M, 1.85, 2.45, -9.2, -8.7, z0, 0.35, P["ind_dark"])
    box(M, 1.8, 2.5, -9.25, -8.65, 0.35, 1.05, C["cv_mailbox"])
    extrude_profile(M, [(-9.25, 1.05), (-8.65, 1.05), (-8.75, 1.22), (-8.95, 1.3), (-9.15, 1.22)], "x", 1.8, 2.5,
                    C["cv_mailbox"])
    for x in (-2.6, 2.6):
        _cva_lamp(M, P, x, -3.4, 3.2)
    for hx0, hx1 in ((-8.4, -2.6), (2.6, 8.4)):
        box(M, hx0, hx1, y0 - 1.4, y0 - 0.5, z0, 0.85, P["hg_leaf"], bevel=0.08)
    tree(M, P, 9.9, -8.6, 0.95, alt=True)
    tree(M, P, -10.3, 8.4, 0.8)
    tree(M, P, 10.2, 8.8, 0.75, alt=True)
    return L


# ------------------------------------------------------------------ fire hall

def b_firehall(M, P):
    """Two-bay brick fire hall: two tall red engine doors onto a concrete apron, a stone name panel on a raised front
    parapet, crew rooms upstairs, a gravel flat roof, and at the back corner the tall hose-drying tower with an open
    bell stage under a slate pyramid roof. A side lawn with a flagpole; one parking bay at each side of the apron."""
    C = _cva()
    L = lot(M, P, 24, 32, [-10.2, 10.2])
    brick, brick2, stone, door, glass = C["cv_brick"], C["cv_brick2"], C["cv_stone"], C["cv_firedoor"], P["lm_glass"]
    z0 = PAD_H
    x0, x1, y0, y1, h = -7.0, 7.0, -6.6, 12.6, 8.6
    yp = L.yf + PARK_DEPTH
    # concrete apron from the street to the doors, lawn either side
    box(M, -6.8, 6.8, -16.0, y0, z0, z0 + 0.04, P["concrete"])
    for jy in (-12.0, -8.4):
        box(M, -6.8, 6.8, jy - 0.05, jy + 0.05, z0 + 0.04, z0 + 0.05, C["cv_tar"])
    box(M, -12.0, -6.8, yp, 16.0, z0, z0 + 0.02, P["grass"])
    box(M, 6.8, 12.0, yp, 16.0, z0, z0 + 0.02, P["grass"])
    box(M, -6.8, 6.8, y1, 16.0, z0, z0 + 0.03, P["concrete"])
    # the hall: brick walls, stone base, stone band between the floors, gravel roof inside a coped parapet
    box(M, x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, 0, 0.6, stone)
    box(M, x0, x1, y0, y1, 0.6, h, brick)
    band(M, x0, x1, y0, y1, 4.9, 5.25, stone, o=0.08)
    box(M, x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.3, h, h + 0.15, C["cv_tar"])
    frame(M, x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, h, h + 0.7, 0.4, brick2)
    frame(M, x0 - 0.18, x1 + 0.18, y0 - 0.18, y1 + 0.18, h + 0.7, h + 0.85, 0.55, stone)
    # raised front parapet with the name panel
    box(M, -3.6, 3.6, y0 - 0.1, y0 + 0.5, h + 0.7, h + 1.9, brick2)
    box(M, -3.8, 3.8, y0 - 0.18, y0 + 0.6, h + 1.9, h + 2.05, stone)
    box(M, -2.8, 2.8, y0 - 0.16, y0 - 0.1, h + 0.85, h + 1.65, stone)
    # two engine doors with stone lintels, a crew door; upstairs windows
    for dx in (-3.2, 3.2):
        box(M, dx - 1.95, dx + 1.95, y0 - 0.1, y0, 0.06, 4.5, door)
        for k in range(1, 4):    # panel rails
            box(M, dx - 1.95, dx + 1.95, y0 - 0.14, y0 - 0.1, 0.06 + k * 1.1 - 0.05, 0.06 + k * 1.1 + 0.05, C["cv_white"])
        box(M, dx - 0.04, dx + 0.04, y0 - 0.14, y0 - 0.1, 0.06, 4.5, C["cv_white"])
        box(M, dx - 2.25, dx + 2.25, y0 - 0.16, y0, 4.5, 4.9, stone)
        for wx in (dx - 1.1, dx + 1.1):
            _cva_win(M, "y", y0, -1, wx, 5.8, 7.6, 1.1, glass, stone)
    for k in range(4):
        wy = y0 + 3.0 + k * 3.4
        _cva_win(M, "x", x0, -1, wy, 5.8, 7.6, 1.1, glass, stone)
        _cva_win(M, "x", x1, 1, wy, 5.8, 7.6, 1.1, glass, stone)
    box(M, x0 - 0.06, x0, 1.0, 2.0, 0.6, 2.8, C["cv_door"])
    # roof: a long skylight over each engine bay, a ventilator between them
    for dx in (-3.2, 3.2):
        box(M, dx - 1.3, dx + 1.3, y0 + 1.6, 6.8, h + 0.15, h + 0.45, C["cv_white2"])
        taper(M, (dx - 1.15, dx + 1.15, y0 + 1.75, 6.65), (dx - 0.1, dx + 0.1, y0 + 1.75, 6.65), h + 0.45, h + 1.25,
              glass)
    box(M, -0.9, 0.9, 1.0, 2.8, h + 0.15, h + 0.9, C["cv_lead"])
    taper(M, (-1.1, 1.1, 0.8, 3.0), (-1.1, 1.1, 1.85, 1.95), h + 0.9, h + 1.4, C["cv_lead"])
    # hose-drying rack in the back yard, hoses hung over the bar
    for hx in (-5.6, -0.4):
        box(M, hx - 0.1, hx + 0.1, 14.3, 14.5, z0, 3.2, P["ind_dark"])
    box(M, -5.7, -0.3, 14.32, 14.48, 3.0, 3.2, P["ind_dark"])
    for k in range(6):
        hx = -5.0 + k * 0.8
        box(M, hx - 0.09, hx + 0.09, 14.12, 14.68, 0.8, 3.0, C["cv_hose"])
    # hose-drying tower in the back-right corner: brick shaft, stone bands, open bell stage, slate pyramid
    tx0, tx1, ty0, ty1 = 2.4, 7.0, 8.0, 12.6
    txc, tyc = (tx0 + tx1) / 2, (ty0 + ty1) / 2
    box(M, tx0, tx1, ty0, ty1, 0.6, 15.6, brick)
    for z in (h + 0.85, 12.6):
        band(M, tx0, tx1, ty0, ty1, z, z + 0.35, stone, o=0.1)
    _cva_win(M, "y", ty0, -1, txc, 10.6, 12.0, 0.8, glass, stone)
    box(M, tx0 - 0.2, tx1 + 0.2, ty0 - 0.2, ty1 + 0.2, 15.6, 15.95, stone)
    for sx in (tx0 + 0.4, tx1 - 0.4):
        for sy in (ty0 + 0.4, ty1 - 0.4):
            box(M, sx - 0.4, sx + 0.4, sy - 0.4, sy + 0.4, 15.95, 18.4, brick)
    revolve(M, txc, tyc, [(0.0, 16.3), (0.85, 16.3), (0.7, 17.0), (0.42, 17.7), (0.0, 17.8)], C["cv_brass"], n=8)
    box(M, txc - 0.06, txc + 0.06, tyc - 0.06, tyc + 0.06, 17.8, 18.4, P["ind_dark"])
    box(M, tx0 - 0.3, tx1 + 0.3, ty0 - 0.3, ty1 + 0.3, 18.4, 18.8, stone)
    cone(M, txc, tyc, (tx1 - tx0 + 1.0) / math.sqrt(2.0), 18.8, 22.0, C["cv_slate"], n=4)
    cyl(M, txc, tyc, 0.05, 21.9, 22.8, P["ind_steel"], n=4)
    # side lawn: flagpole, a bench, a tree; a tree behind
    cyl(M, -9.4, -6.4, 0.5, z0, 0.35, stone, n=8)
    _flagpole(M, P, -9.4, -6.4, 10.5)
    bench(M, P, -9.4, 0.6, math.pi / 2)
    tree(M, P, -9.6, 7.6, 1.0)
    tree(M, P, 9.6, 2.0, 0.9, alt=True)
    tree(M, P, 9.8, 12.6, 0.8)
    return L


# ------------------------------------------------------------------ library

def b_library(M, P):
    """Carnegie library: a limestone classical block on a raised rusticated plinth, a portico of four columns under a
    pediment at the head of a broad flight of steps, a balustraded flat roof round a low green copper dome on a
    drum, and a lawn with two big shade trees, clipped hedges and lamps at the steps."""
    C = _cva()
    L = green_lot(M, P, 32, 32)
    stone, stone2, trim, glass, roof = C["cv_stone"], C["cv_stone2"], P["th_trim"], P["lm_glass"], C["cv_lead"]
    z0 = PAD_H
    pz = 1.7                      # plinth top / main floor
    x0, x1, y0, y1 = -11.0, 11.0, -3.2, 11.4
    # walk: broad from the street, a cross-walk along the front
    box(M, -2.4, 2.4, -16.0, -11.6, z0, z0 + 0.05, P["lm_paving"])
    box(M, -13.4, 13.4, -14.0, -12.4, z0, z0 + 0.04, P["lm_paving"])
    # plinth and the main block
    box(M, x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, 0, pz, stone2)
    box(M, x0, x1, y0, y1, pz, 8.6, stone)
    box(M, x0 - 0.4, x1 + 0.4, y0 - 0.4, y1 + 0.4, 8.6, 9.3, trim, bevel=0.06)
    _hip(M, x0 - 0.2, x1 + 0.2, y0 - 0.2, y1 + 0.2, 9.3, 12.6, C["cv_tile"], oh=0.45)
    # windows: tall ones either side of the portico, down the sides; basement lights in the plinth
    for wx in (-9.0, -6.6, 6.6, 9.0):
        _cva_win(M, "y", y0, -1, wx, 3.0, 7.2, 1.3, glass, trim)
    for k in range(4):
        wy = y0 + 2.2 + k * (y1 - y0 - 4.4) / 3
        _cva_win(M, "x", x0, -1, wy, 3.0, 7.2, 1.3, glass, trim)
        _cva_win(M, "x", x1, 1, wy, 3.0, 7.2, 1.3, glass, trim)
    # portico: deck, four columns, entablature, pediment
    px0, px1, py0 = -4.8, 4.8, y0 - 4.2
    box(M, px0, px1, py0, y0, 0, pz, stone2)
    for k in range(4):
        cx = px0 + 1.0 + k * (px1 - px0 - 2.0) / 3
        cyl(M, cx, py0 + 0.8, 0.62, pz, pz + 0.3, trim, n=8)
        cyl(M, cx, py0 + 0.8, 0.45, pz + 0.3, 7.7, trim, n=8)
        cyl(M, cx, py0 + 0.8, 0.6, 7.7, 7.95, trim, n=8)
    box(M, px0, px1, py0, y0, 7.95, 9.3, trim)
    gable(M, px0, px1, py0, y0 + 3.0, 9.3, 11.6, "y", C["cv_tile"], trim, oh_u=(0.35, 0.35), oh_a=(0.35, 0.0),
          th=0.22)
    box(M, -1.1, 1.1, y0 - 0.06, y0, pz, 5.2, C["cv_door"])
    _cva_win(M, "y", y0, -1, 0.0, 5.6, 7.0, 1.8, glass, trim, t=0.12)
    _cva_steps(M, -3.8, 3.8, -11.6, py0, pz, 6, stone2)
    for sx in (-1, 1):           # cheek walls with lamps at the foot of the steps
        box(M, min(sx * 3.8, sx * 4.5), max(sx * 3.8, sx * 4.5), -11.6, py0, 0, pz + 0.35, stone2)
        _cva_lamp(M, P, sx * 4.15, -11.2, 3.6)
    # copper dome on a drum over the reading room
    dyc = (y0 + y1) / 2 + 1.0
    cyl(M, 0.0, dyc, 3.6, 10.5, 13.4, stone, n=16)
    cyl(M, 0.0, dyc, 3.85, 13.4, 13.75, trim, n=16)
    revolve(M, 0.0, dyc, [(3.6, 13.75), (3.35, 14.7), (2.7, 15.55), (1.8, 16.2), (0.8, 16.55), (0.0, 16.6)],
            P["dome"], n=16)
    cyl(M, 0.0, dyc, 0.6, 16.5, 17.2, trim, n=8)
    cone(M, 0.0, dyc, 0.75, 17.2, 17.8, P["dome"], n=8)
    # lawn: clipped hedges along the plinth, two big shade trees, benches by the cross-walk
    for hx0, hx1 in ((-11.2, -5.2), (5.2, 11.2)):
        box(M, hx0, hx1, y0 - 1.5, y0 - 0.6, z0, 0.95, P["hg_leaf"], bevel=0.08)
    tree(M, P, -11.4, -9.2, 1.35)
    tree(M, P, 11.4, -9.0, 1.3, alt=True)
    for x in (-8.0, 8.0):
        bench(M, P, x, -11.4, 0.0)
    tree(M, P, -13.4, 9.6, 0.8, alt=True)
    tree(M, P, 13.4, 11.6, 0.85)
    return L


BUILDINGS.update({
    "schoolhouse": (b_schoolhouse, 24, 32, 0),
    "church": (b_church, 24, 40, 0),
    "bandstand": (b_bandstand, 32, 32, 0),
    "postoffice": (b_postoffice, 24, 24, 2),
    "firehall": (b_firehall, 24, 32, 2),
    "library": (b_library, 32, 32, 0),
})

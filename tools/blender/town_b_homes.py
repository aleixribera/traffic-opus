# Where a town's people live once it outgrows its houses: brick row houses with stoops, walk-up tenements with fire
# escapes and roof tanks, garden and courtyard apartment houses. (The apartment towers are in town_d_towers.py.)
# Kit and conventions: town_a_kit.py.


def _rowhouses(S, n=3, floors=2, bricks=("brick_r",), trim="cream", doors=("door", "door_g", "oxblood"), bay=(),
               front=2.3, yard=3.4, alley=3.0, nbays=2, step=(), hood="tar3", seed=1):
    """A row of brick houses on the pavement: stoops up to the front doors, a cornice along the front, party walls
    and chimneys standing through the tar roofs, small fenced yards with the wash out behind, a side drive."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=front, alley=alley, yard=yard, nbays=nbays, tandem=True, front_m=T["lawn"],
                           yard_m=T["lawn"], fence="board", under=T["kerb"])
    fh, base = 3.1, 0.9
    hw = (x1 - x0) / n
    tr = T[trim]
    top = 0
    for i in range(n):
        a0, a1 = x0 + i * hw, x0 + (i + 1) * hw
        brick = T[bricks[i % len(bricks)]]
        h = base + floors * fh + 0.5 + (step[i % len(step)] if step else 0)
        top = max(top, h)
        box(M, a0, a1, y0, y1, 0, h, brick)
        box(M, a0 + 0.15, a1 - 0.15, y0 + 0.3, y1 - 0.15, h, h + 0.04, T[("tar", "tar2", "tar3")[(i + seed) % 3]])
        # the front parapet with its cornice, the party wall standing through the roof
        box(M, a0, a1, y0, y0 + 0.3, h, h + 0.45, brick)
        box(M, a0 - 0.02, a1 + 0.02, y0 - 0.26, y0 + 0.34, h + 0.1, h + 0.5, tr)
        if i > 0:
            box(M, a0 - 0.14, a0 + 0.14, y0 + 0.3, y1, h - 0.3, h + 0.42, T["brick_b"])
            _chimney(S, a0, y0 + (y1 - y0) * (0.35 if i % 2 else 0.62), h + 0.42, h + 1.5, T["brick_b"], w=0.6, d=1.1, cap=T["tar3"])
        F = _faces(a0, a1, y0, y1)
        f, bk = F["f"], F["b"]
        dc = hw * (0.26 if i % 2 == 0 else 0.74)       # the door's side alternates down the row
        wc = hw - dc
        # the front: the door at the head of its stoop, one window beside it (or a bay window), two a floor above
        _stoop(S, f, dc, 0, rise=base, w=1.5, door=T[doors[(i + seed) % len(doors)]], hood=T[hood] if hood else None)
        _wq(M, f, dc - 0.4, dc + 0.4, base + 2.2, base + 2.6, T["win_home"], 0.05)
        if i in bay:
            bh = base + min(floors, 2) * fh - 0.25
            _fbox(M, f, wc - 1.25, wc + 1.25, 0, 0.7, 0, bh, brick)
            _fbox(M, f, wc - 1.35, wc + 1.35, 0, 0.8, bh, bh + 0.18, tr)
            G = _Face(*f.p(wc - 1.25, 0.7, 0)[:2], f.ux, f.uy, 2.5)
            for k in range(min(floors, 2)):
                _wq(M, G, 0.3, 2.2, base + k * fh + 0.9, base + k * fh + 2.5, T["win_home"], 0.04)
                _wq(M, G, 0.2, 2.3, base + k * fh + 2.5, base + k * fh + 2.72, tr, 0.04)
            for k in range(2, floors):
                _wins(M, f, wc - 1.2, wc + 1.2, base + k * fh, 1, fh, T["win_home"], cols=1, ww=1.2, lintel=tr, sillm=tr)
        else:
            _wins(M, f, wc - 1.2, wc + 1.2, base, floors, fh, T["win_home"], cols=1, ww=1.25, lintel=tr, sillm=tr)
        _wins(M, f, dc - 0.7, dc + 0.7, base + fh, floors - 1, fh, T["win_home"], cols=1, ww=1.0, lintel=tr, sillm=tr)
        # the back: plain windows, the kitchen door and its step
        _wins(M, bk, 0.3, hw - 0.3, base, floors, fh, T["win_home"], cols=2, ww=1.0, skip=((0, 0),))
        _wq(M, bk, hw * 0.25 - 0.45, hw * 0.25 + 0.45, base, base + 2.05, T["door"], 0.05)
        _fbox(M, bk, hw * 0.25 - 0.7, hw * 0.25 + 0.7, 0, 0.9, 0, base, T["lime3"])
        # each yard its own: a board fence between neighbours, the washing on the line
        if yard > 2.5:
            if i > 0:
                box(M, a0 - 0.05, a0 + 0.05, y1, S.yb, 0, 1.5, T["board"])
            if i == (seed % n):
                _tree(S, (a0 + a1) / 2, y1 + yard * 0.5, 0.72, alt=seed % 2 == 1)
            else:
                _washline(S, a0 + 0.6, a1 - 0.6, y1 + yard * 0.55, seed=seed * 7 + i)
    # the end walls
    for s in ("l", "r"):
        _wins(M, _faces(x0, x1, y0, y1)[s], 1.0, (y1 - y0) - 1.0, base, floors, fh, T["win_home"], cols=2, ww=1.0)
    # a path from the pavement to each stoop, a clipped hedge before each front window
    for i in range(n):
        dc = x0 + i * hw + hw * (0.26 if i % 2 == 0 else 0.74)
        wc = x0 + i * hw + hw * (0.74 if i % 2 == 0 else 0.26)
        if front > 1.7:
            box(M, dc - 0.7, dc + 0.7, S.yf, y0 - 1.4, 0, 0.09, T["paving"])
            box(M, wc - 1.5, wc + 1.5, S.yf + 0.15, S.yf + 0.6, 0, 0.7, T["hedge"])
    S.body = (x0, x1, y0, y1, top + 0.5)


def _tenement(S, x0, x1, y0, y1, floors, brick, trim, tar="tar", escape=True, shop=None, tank=True, seed=1, base=0.7,
              cornice=None, door="door", sides="lr"):
    """One walk-up tenement block: a brick front under a deep cornice, stone lintels and sills, a stoop (or a shop
    on the ground floor), the fire escape zigzagging down the front, a wooden tank, a stair bulkhead, a skylight
    and chimneys on the tar roof."""
    M, T = S.M, S.T
    fh = 3.15
    br, tr = T[brick], T[trim]
    h = base + floors * fh
    box(M, x0, x1, y0, y1, 0, h, br)
    top = _roof(S, x0, x1, y0, y1, h, br, T[tar], cop=tr, par=0.85)
    _cornice(S, x0, x1, y0, y1, h + 0.35, T[cornice or trim], proj=0.32, h=0.5, sides="f")
    F = _faces(x0, x1, y0, y1)
    f = F["f"]
    w, d = x1 - x0, y1 - y0
    cols = max(2, int((w - 0.8) / 2.5))
    mid = cols // 2
    if shop:
        _shopfront(S, f, 0.5, w - 0.5, 0, base + fh - 0.1, T[shop.get("frame", "green")], T[shop.get("sign", "cream")],
                   awn=(T[shop.get("awn", "oxblood")], T["cream"]), letters=T[shop.get("ink", "oxblood")], seed=seed)
        _wins(M, f, 0.4, w - 0.4, base + fh, floors - 1, fh, T["win_home"], cols=cols, lintel=tr)
    else:
        _wins(M, f, 0.4, w - 0.4, base, floors, fh, T["win_home"], cols=cols, lintel=tr, skip=((mid, 0),))
        st = (w - 0.8) / cols
        _stoop(S, f, 0.4 + st * (mid + 0.5), 0, rise=base, w=1.7, door=T[door], hood=tr)
        box(M, x0, x1, y0 - 0.06, y0, base + fh - 0.25, base + fh - 0.05, tr)
    if escape:
        st = (w - 0.8) / cols
        e0 = 0.4 + st * (0 if mid > 1 else mid) + 0.1
        _fire_escape(S, f, e0, e0 + st * (2 if cols > 2 else 1) - 0.2, base, floors, fh, first=1)
    _wins(M, F["b"], 0.5, w - 0.5, base, floors, fh, T["win_home"], cols=cols, ww=1.0, skip=((0, 0),))
    _wq(M, F["b"], 0.6, 1.6, 0.2, 2.3, T["door"], 0.05)
    sc = max(2, int((d - 1.0) / 2.9))
    for s in sides:
        _wins(M, F[s], 0.7, d - 0.7, base, floors, fh, T["win_home"], cols=sc, ww=1.0)
    # the roof
    r = _random.Random(seed)
    xs = (x0 + w * 0.28, x0 + w * 0.72)
    r.shuffle(xs := list(xs))
    if tank:
        _tank(S, xs[0], y0 + d * 0.62, h + 0.05, r=min(1.35, w * 0.14))
    _bulkhead(S, xs[1], y0 + d * 0.7, h + 0.05, w=2.2, d=2.8, wall=br)
    if d > 9:
        _skylight(S, xs[1] - 1.0, xs[1] + 1.0, y0 + d * 0.22, y0 + d * 0.22 + 2.6, h + 0.05)
    _chimney(S, x0 + 0.65, y0 + d * 0.45, h, h + 2.0, br, cap=T["tar3"])
    _chimney(S, x1 - 0.65, y0 + d * 0.3, h, h + 1.8, br, cap=T["tar3"], smoke=w > 9)
    return top


def _tenements(S, blocks, front=1.5, yard=7.2, alley=3.2, nbays=4, gap=0.0, lines=2, tandem=False, fence="board",
               seed=1, stoop_m=None):
    """A lot of walk-up tenements side by side (each its own brick, height and cornice), the yard behind hung with
    washing between the back wall and the poles by the fence, the cars along the fence."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=front, alley=alley, yard=yard, nbays=nbays, tandem=tandem, fence=fence,
                           yard_m=S.T["yard"])
    tot = sum(b["w"] for b in blocks)
    a = x0
    top = 0
    for i, b in enumerate(blocks):
        bw = (x1 - x0 - gap * (len(blocks) - 1)) * b["w"] / tot
        kw = {k: v for k, v in b.items() if k != "w"}
        sides = ("l" if i == 0 else "") + ("r" if i == len(blocks) - 1 else "")
        top = max(top, _tenement(S, a, a + bw, y0, y1, seed=seed + i * 5, sides=sides, **kw))
        if not tandem and yard > 6 and lines:
            # washing on pulley lines from the back windows to a tall pole
            px, py = a + bw * 0.5, S.yb - 0.5
            box(M, px - 0.09, px + 0.09, py - 0.09, py + 0.09, 0, 9.5, T["wood"])
            for k in range(lines):
                z = 5.2 + k * 3.1
                wx = a + bw * (0.25 + 0.5 * k)
                ln = math.hypot(px - wx, py - y1)
                G = _Face(wx, y1, (px - wx) / ln, (py - y1) / ln, ln)
                rr = _random.Random(seed * 31 + i * 7 + k)
                t = 0.8
                while t < ln - 1.2:
                    ww = rr.choice((0.5, 0.7, 0.9))
                    m = T[rr.choice(("wash1", "wash1", "wash2", "wash3"))]
                    hh = rr.choice((0.6, 0.8, 1.0))
                    _wq(M, G, t, t + ww, z - hh, z, m, 0.0)
                    _quad(M, [G.p(t + ww, 0, z - hh), G.p(t, 0, z - hh), G.p(t, 0, z), G.p(t + ww, 0, z)], m)
                    t += ww + rr.choice((0.25, 0.4, 1.0))
        a += bw + gap
    _cans(S, x0 + 2.4, y1 + 0.5, 3)
    if not tandem and yard > 6:
        _tree(S, S.xl + 2.1, y1 + 1.4, 0.85, alt=seed % 2 == 0)
    S.body = (x0, x1, y0, y1, top)


def _garden_apts(S, brick="brick_y", trim="cream", roof="tile", floors=3, yard=7.0, nbays=4, wing=7.5, seed=1,
                 door="door_g"):
    """A garden apartment house: three storeys of brick round a forecourt open to the street, hipped tile roofs,
    a lawn and a path up to the door under its canopy."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=1.6, alley=3.2, yard=yard, nbays=nbays, front_m=T["lawn"], fence="green", side=0.55)
    fh, base = 3.1, 0.6
    br, tr = T[brick], T[trim]
    h = base + floors * fh
    w, d = x1 - x0, y1 - y0
    bar = min(8.5, d * 0.5)
    blocks = [(x0, x1, y1 - bar, y1), (x0, x0 + wing, y0, y1 - bar), (x1 - wing, x1, y0, y1 - bar)]
    for i, (a0, a1, b0, b1) in enumerate(blocks):
        box(M, a0, a1, b0, b1, 0, h, br)
        box(M, a0 - 0.05, a1 + 0.05, b0 - 0.05, b1 + 0.05, base + fh - 0.3, base + fh - 0.1, tr)
        if i == 0:
            taper(M, (a0 - 0.45, a1 + 0.45, b0 - 0.45, b1 + 0.45), (a0 + bar * 0.5, a1 - bar * 0.5, (b0 + b1) / 2 - 0.05, (b0 + b1) / 2 + 0.05), h, h + bar * 0.33, T[roof])
        else:
            xm = (a0 + a1) / 2
            taper(M, (a0 - 0.45, a1 + 0.45, b0 - 0.45, b1 + 0.2), (xm - 0.05, xm + 0.05, b0 + wing * 0.5, b1 + bar * 0.5), h, h + wing * 0.33 * bar / max(bar, wing), T[roof])
    wh = T["win_home"]
    B, Lw, Rw = (_faces(*b) for b in blocks)
    _wins(M, B["b"], 0.6, w - 0.6, base, floors, fh, wh, pitch=2.7, ww=1.05)
    _wins(M, B["f"], wing + 0.5, w - wing - 0.5, base, floors, fh, wh, pitch=2.7, lintel=tr, skip=((1, 0),) if w - 2 * wing < 9 else ((2, 0),))
    for s in ("l", "r"):
        _wins(M, B[s], 0.6, bar - 0.6, base, floors, fh, wh, pitch=2.7, ww=1.05)
    wd = d - bar
    for Wg in (Lw, Rw):
        _wins(M, Wg["f"], 0.5, wing - 0.5, base, floors, fh, wh, cols=2, ww=1.2, lintel=tr, sillm=tr)
    _wins(M, Lw["l"], 0.5, wd - 0.3, base, floors, fh, wh, pitch=2.7, ww=1.05)
    _wins(M, Lw["r"], 0.3, wd - 0.5, base, floors, fh, wh, pitch=2.7, ww=1.05)
    _wins(M, Rw["r"], 0.3, wd - 0.5, base, floors, fh, wh, pitch=2.7, ww=1.05)
    _wins(M, Rw["l"], 0.5, wd - 0.3, base, floors, fh, wh, pitch=2.7, ww=1.05)
    # the forecourt: the door under a canopy at its head, the path, clipped hedges
    cx = (x0 + x1) / 2
    cy = y1 - bar
    _wq(M, B["f"], w / 2 - 0.7, w / 2 + 0.7, 0.1, 2.4, T[door], 0.05)
    box(M, cx - 1.6, cx + 1.6, cy - 1.8, cy, 2.6, 2.8, tr)
    for sx in (-1.4, 1.4):
        box(M, cx + sx - 0.07, cx + sx + 0.07, cy - 1.7, cy - 1.56, 0, 2.6, T["iron"])
    box(M, x0 + wing, x1 - wing, y0 - 0.2, cy, 0, 0.08, T["lawn"])
    box(M, cx - 0.9, cx + 0.9, S.yf, cy, 0, 0.1, T["paving"])
    for sx in (-1, 1):
        hx = cx + sx * (w / 2 - wing - 0.6)
        box(M, min(hx, cx + sx * 1.5), max(hx, cx + sx * 1.5), y0 + 0.3, y0 + 0.8, 0, 0.7, T["hedge"])
        if w - 2 * wing > 8:
            _tree(S, cx + sx * (w / 2 - wing) * 0.55, y0 + (d - bar) * (0.5 + 0.12 * sx), 0.7, alt=sx > 0)
    # chimneys through the hips
    _chimney(S, x0 + wing * 0.5, cy + bar * 0.5, h, h + bar * 0.33 + 1.2, br, w=0.9, d=0.9, cap=tr)
    _chimney(S, x1 - wing * 0.5, cy + bar * 0.5, h, h + bar * 0.33 + 1.2, br, w=0.9, d=0.9, cap=tr)
    _cans(S, x0 + 3.0, y1 + 0.5, 4)
    S.body = (x0, x1, y0, y1, h + bar * 0.33)


def _court_apts(S, floors=6, brick="brick_r", stone="lime", band="terra", trim="cream", yard=6.6, nbays=4,
                wing=None, court=None, seed=1, tanks=1, awn=None):
    """A courtyard apartment house of the 1920s: six storeys of brick on a limestone ground floor, two wings
    round a garden court open to the street, the entrance under a canopy at the head of the court, a terracotta
    band under the parapet, roof tanks and stair bulkheads."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=1.5, alley=3.2, yard=yard, nbays=nbays, fence="board")
    fh, base = 3.15, 0.5
    br, st, tr = T[brick], T[stone], T[trim]
    w, d = x1 - x0, y1 - y0
    wing = wing or w * 0.33
    bar = d - (court or d * 0.5)
    g = base + fh            # top of the stone ground floor
    h = base + floors * fh
    blocks = [(x0, x1, y1 - bar, y1), (x0, x0 + wing, y0, y1 - bar), (x1 - wing, x1, y0, y1 - bar)]
    tars = ("tar", "tar2", "tar")
    for i, (a0, a1, b0, b1) in enumerate(blocks):
        box(M, a0, a1, b0, b1, 0, g, st)
        box(M, a0, a1, b0, b1, g, h, br)
        _roof(S, a0, a1, b0, b1, h, br, T[tars[i]], cop=tr, par=0.9)
        box(M, a0 - 0.06, a1 + 0.06, b0 - 0.06, b1 + 0.06, h - 0.75, h - 0.2, T[band])
    wh = T["win_home"]
    B, Lw, Rw = (_faces(*b) for b in blocks)
    p = 2.75
    _wins(M, B["b"], 0.6, w - 0.6, base, floors, fh, wh, pitch=p, ww=1.05)
    cw = w - 2 * wing
    cc = max(2, int(cw / p))
    _wins(M, B["f"], wing + 0.3, w - wing - 0.3, base, floors, fh, wh, cols=cc, ww=1.05, skip=((cc // 2, 0),))
    for s in ("l", "r"):
        _wins(M, B[s], 0.6, bar - 0.6, base, floors, fh, wh, pitch=p, ww=1.05)
    wd = d - bar
    for Wg in (Lw, Rw):
        _wins(M, Wg["f"], 0.5, wing - 0.5, base, floors, fh, wh, pitch=p, ww=1.2, lintel=tr, sillm=tr)
    _wins(M, Lw["l"], 0.5, wd - 0.3, base, floors, fh, wh, pitch=p, ww=1.05)
    _wins(M, Lw["r"], 0.3, wd - 0.5, base, floors, fh, wh, pitch=p, ww=1.05)
    _wins(M, Rw["r"], 0.3, wd - 0.5, base, floors, fh, wh, pitch=p, ww=1.05)
    _wins(M, Rw["l"], 0.5, wd - 0.3, base, floors, fh, wh, pitch=p, ww=1.05)
    # the court: lawn either side of the walk, the door under its canopy
    cx, cy = (x0 + x1) / 2, y1 - bar
    box(M, x0 + wing, x1 - wing, y0 - 0.2, cy, 0, 0.08, T["lawn"])
    box(M, cx - 1.0, cx + 1.0, S.yf, cy, 0, 0.1, T["paving"])
    st0 = (cw - 0.6) / cc
    dc = wing + 0.3 + st0 * (cc // 2 + 0.5)
    _wq(M, B["f"], dc - 0.8, dc + 0.8, 0.1, 2.5, T["door_g"], 0.05)
    box(M, x0 + dc - 1.5, x0 + dc + 1.5, cy - 2.4, cy, 2.75, 2.95, T[awn] if awn else T["green"])
    for sx in (-1.3, 1.3):
        box(M, x0 + dc + sx - 0.06, x0 + dc + sx + 0.06, cy - 2.3, cy - 2.18, 0, 2.75, T["brass"])
    for sx in (-1, 1):
        box(M, cx + sx * 1.6 - 0.25, cx + sx * 1.6 + 0.25, y0 + 0.4, cy - 3.0, 0, 0.7, T["hedge"])
        if cw > 8.5:
            _tree(S, cx + sx * cw * 0.3, y0 + (d - bar) * (0.42 + 0.14 * sx), 0.78, alt=sx < 0)
    # the roofs
    for k in range(tanks):
        bx = (x0 + wing * 0.5, x1 - wing * 0.5)[(k + seed) % 2]
        _tank(S, bx, y0 + wd * (0.35 + 0.3 * k), h + 0.05, r=1.5, h=2.6, leg=1.8)
    _bulkhead(S, x0 + wing * 0.5 if (tanks + seed) % 2 == 0 else x1 - wing * 0.5, y0 + wd * 0.7, h + 0.05, wall=br)
    _bulkhead(S, cx + w * 0.12, y1 - bar * 0.5, h + 0.05, w=3.0, d=3.4, h=3.0, wall=br)
    _chimney(S, x0 + 0.8, y1 - 1.0, h, h + 2.4, br, w=0.9, d=0.9, cap=tr)
    _vent(S, cx - w * 0.2, y1 - bar * 0.4, h + 0.05)
    _vent(S, x1 - wing * 0.4, y0 + wd * 0.3, h + 0.05)
    _cans(S, x0 + 3.0, y1 + 0.5, 4)
    S.body = (x0, x1, y0, y1, h + 1.0)


# ------------------------------------------------------------------ the catalogue

# terrace (24 x 17): row houses on 3-cell lots, a pair on 2-cell lots; tall, a tenement
_town("terrace", "terrace", 0.85, 1.0, 2, _rowhouses, n=3, bricks=("brick_r",), trim="cream", seed=1)
_town("terrace_b", "terrace", 0.85, 1.0, 2, _rowhouses, n=3, bricks=("brick_b", "brick_d", "brick_b"), trim="lime2",
      bay=(0, 1, 2), doors=("oxblood", "door", "navy"), seed=2)
_town("terrace_c", "terrace", 0.85, 1.0, 2, _rowhouses, n=3, floors=3, bricks=("brick_y", "brick_r2", "brick_t"),
      trim="green", step=(0, 0.5, 0.2), doors=("door_g", "door", "black"), bay=(1,), seed=3)
_town("terrace_s", "terrace", 0.6, 1.0, 1, _rowhouses, n=2, bricks=("brick_r2", "brick_b"), trim="cream", front=1.6,
      yard=1.2, alley=2.8, bay=(1,), seed=4)
_town("terrace_n", "terrace", 0.6, 1.65, 1, _tenements, blocks=[dict(w=1, floors=4, brick="brick_r2", trim="lime")],
      front=1.6, yard=1.2, alley=2.8, tandem=True, seed=5)
_town("terrace_t", "terrace", 1.235, 1.65, 4, _tenements, blocks=[
    dict(w=1.0, floors=5, brick="brick_r", trim="lime", shop=dict(awn="green", ink="green")),
    dict(w=1.1, floors=4, brick="brick_y", trim="cream", cornice="green", tar="tar2")], yard=7.0, seed=6)

# apartments (30 x 30): walk-up tenements; a garden apartment house
_town("apartments", "apartments", 0.95, 1.0, 5, _tenements, blocks=[
    dict(w=1.0, floors=4, brick="brick_r", trim="lime"),
    dict(w=1.0, floors=5, brick="brick_b", trim="cream", tar="tar2", cornice="lime2")], front=1.6, yard=9.0, seed=7)
_town("apartments_b", "apartments", 0.95, 1.0, 4, _garden_apts, brick="brick_y", trim="cream", roof="tile", yard=7.2, seed=8)
_town("apartments_m", "apartments", 0.7, 1.0, 3, _tenements, blocks=[
    dict(w=1, floors=4, brick="brick_d", trim="cream", cornice="mustard")], front=1.5, yard=7.0, seed=9)
_town("apartments_n", "apartments", 0.7, 1.0, 3, _garden_apts, brick="brick_r", trim="lime", roof="slate", yard=6.6, wing=5.2, seed=10)
_town("apartments_s", "apartments", 0.433, 1.8, 1, _tenements, blocks=[
    dict(w=1, floors=5, brick="brick_r", trim="cream", tar="tar2")], front=1.6, yard=1.2, alley=2.8, tandem=True, seed=11)

# modernflats (30 x 30): the courtyard apartment house
_town("modernflats", "modernflats", 0.967, 1.05, 4, _court_apts, floors=6, brick="brick_r", stone="lime", band="terra", seed=12)
_town("modernflats_b", "modernflats", 0.967, 1.05, 4, _court_apts, floors=6, brick="brick_y", stone="lime2", band="green",
      trim="lime", tanks=2, seed=13)
_town("modernflats_m", "modernflats", 0.7, 1.2, 3, _court_apts, floors=6, brick="brick_b", stone="lime", band="cream",
      yard=6.2, wing=5.6, court=4.5, seed=14)

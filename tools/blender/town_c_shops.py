# Main street, 1920-1940: brick shop-houses under striped awnings and painted signs, the corner drugstore, the diner,
# the five-and-dime, the department store with its marquee and blade sign, the bank behind its columns, the brick and
# terracotta office block with a tank on the roof, the market hall, the filling station. Kit: town_a_kit.py.


def _ghost_sign(S, F, a0, a1, z0, z1, ground="cream", ink="navy", seed=1):
    """An advertisement painted on a bare brick side wall."""
    M, T = S.M, S.T
    _wq(M, F, a0, a1, z0, z1, T[ground], 0.03)
    h = z1 - z0
    _letters(M, F, a0 + 0.4, a1 - 0.4, z0 + h * 0.55, z0 + h * 0.85, T[ink], 0.05, seed, n=5)
    _letters(M, F, a0 + 0.8, a1 - 0.8, z0 + h * 0.16, z0 + h * 0.4, T[ink], 0.05, seed + 1, n=6)


def _shophouse(S, x0, x1, y0, y1, floors=2, brick="brick_r", trim="cream", awn="green", sign="cream", ink="oxblood",
               frame="green", parapet="flat", tar="tar", sides="", ghost=None, seed=1, gh=3.9, chim=True, escape=False,
               tank=False, door=0.5):
    """One shop-house of a main street row: the shopfront and its awning on the pavement, flats or stockrooms
    above behind sash windows, a parapet (flat with a cornice, stepped, or a little pediment), party walls and a
    chimney through the tar roof, the back door on the yard."""
    M, T = S.M, S.T
    fh = 3.1
    br, tr = T[brick], T[trim]
    h = gh + (floors - 1) * fh + (0.5 if floors == 1 else 0.3)
    w, d = x1 - x0, y1 - y0
    box(M, x0, x1, y0, y1, 0, h, br)
    box(M, x0 + 0.2, x1 - 0.2, y0 + 0.3, y1 - 0.2, h, h + 0.04, T[tar])
    # party walls standing through the roof, a low rim along the back
    for x in (x0, x1):
        box(M, x - 0.13 if x == x1 else x, x if x == x1 else x + 0.13, y0 + 0.3, y1, h, h + 0.35, br)
    box(M, x0, x1, y1 - 0.2, y1, h, h + 0.25, br)
    top = h + 0.75
    if parapet == "flat":
        box(M, x0, x1, y0, y0 + 0.3, h, h + 0.6, br)
        box(M, x0 - 0.04, x1 + 0.04, y0 - 0.26, y0 + 0.34, h + 0.25, h + 0.7, tr)
    elif parapet == "step":
        box(M, x0, x1, y0, y0 + 0.3, h, h + 0.55, br)
        box(M, x0 - 0.03, x1 + 0.03, y0 - 0.06, y0 + 0.34, h + 0.55, h + 0.67, tr)
        box(M, x0 + w * 0.25, x1 - w * 0.25, y0, y0 + 0.3, h + 0.55, h + 1.25, br)
        box(M, x0 + w * 0.25 - 0.05, x1 - w * 0.25 + 0.05, y0 - 0.06, y0 + 0.34, h + 1.25, h + 1.37, tr)
        top = h + 1.4
    else:  # a little pediment
        box(M, x0, x1, y0, y0 + 0.3, h, h + 0.4, br)
        extrude_profile(M, [(x0 - 0.05, h + 0.4), (x1 + 0.05, h + 0.4), ((x0 + x1) / 2, h + 0.4 + w * 0.2)], "y", y0 - 0.05, y0 + 0.32, tr)
        top = h + 0.4 + w * 0.2
    F = _faces(x0, x1, y0, y1)
    f = F["f"]
    _shopfront(S, f, 0.3, w - 0.3, 0, gh, T[frame], T[sign], awn=(T[awn], T["cream"]) if awn else None, letters=T[ink],
               seed=seed, door=door)
    cols = max(2, int(w / 2.3))
    if floors > 1:
        _wins(M, f, 0.35, w - 0.35, gh - 0.75, floors - 1, fh, T["win_home"], cols=cols, lintel=tr, sillm=tr, wh=1.75)
        _wins(M, F["b"], 0.4, w - 0.4, gh - 0.75, floors - 1, fh, T["win_home"], cols=max(1, cols - 1), ww=1.0)
    _wq(M, F["b"], w * 0.3 - 0.5, w * 0.3 + 0.5, 0, 2.15, T["door"], 0.05)
    _wq(M, F["b"], w * 0.72 - 0.6, w * 0.72 + 0.6, 1.2, 2.5, T["win_shop"], 0.05)
    for s in sides:
        dcols = max(2, int(d / 3.2))
        if ghost and s == ghost.get("side", "r") and floors > 1:
            _ghost_sign(S, F[s], d * 0.18, d * 0.82, gh + 0.2, h - 0.5, ghost.get("ground", "cream"), ghost.get("ink", "navy"), seed)
        elif floors > 1:
            _wins(M, F[s], 0.6, d - 0.6, gh - 0.75, floors - 1, fh, T["win_home"], cols=dcols, ww=1.0)
        if ghost and s == ghost.get("side", "r") and floors == 1:
            _ghost_sign(S, F[s], d * 0.2, d * 0.8, 1.0, h - 0.4, ghost.get("ground", "cream"), ghost.get("ink", "navy"), seed)
    if escape and floors > 2:
        _fire_escape(S, F["b"], w * 0.45, w * 0.45 + 2.6, gh - fh, floors, fh, first=1)
    if chim:
        _chimney(S, x0 + 0.5 if seed % 2 else x1 - 0.5, y0 + d * 0.66, h, h + 1.7, br, cap=T["tar3"])
    if tank:
        _tank(S, x0 + w * 0.5, y0 + d * 0.55, h + 0.04, r=min(1.3, w * 0.17))
    elif w > 5 and d > 8:
        _skylight(S, x0 + w * 0.5 - 0.9, x0 + w * 0.5 + 0.9, y0 + d * 0.3, y0 + d * 0.3 + 2.2, h + 0.04)
    _vent(S, x0 + w * 0.3, y0 + d * 0.85, h + 0.04, r=0.22, h=0.6)
    return top


def _mainstreet(S, units, nbays=3, front=1.6, yard=6.8, alley=3.0, tandem=False, seed=1, fence="board", crates=True):
    """A piece of main street: shop-houses side by side on the pavement, each its own brick and height; the
    yard behind them down the alley, with the back doors, the ash cans and the delivery crates."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=front, alley=alley, yard=yard, nbays=nbays, tandem=tandem, fence=fence)
    tot = sum(u["w"] for u in units)
    a, top = x0, 0
    for i, u in enumerate(units):
        bw = (x1 - x0) * u["w"] / tot
        kw = {k: v for k, v in u.items() if k != "w"}
        sides = ("l" if i == 0 else "") + ("r" if i == len(units) - 1 else "")
        top = max(top, _shophouse(S, a, a + bw, y0, y1, sides=sides, seed=seed + i * 3, **kw))
        a += bw
    _cans(S, x0 + 0.6, y1 + 0.45, 2)
    if crates and yard > 3:
        box(M, x1 - 2.2, x1 - 1.2, y1 + 0.2, y1 + 1.2, 0, 0.9, T["wood2"])
        box(M, x1 - 1.9, x1 - 1.3, y1 + 0.3, y1 + 0.9, 0.9, 1.5, T["wood"])
    S.body = (x0, x1, y0, y1, top)


def _poly_faces(pts):
    out = []
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        ln = math.hypot(q[0] - p[0], q[1] - p[1])
        out.append(_Face(p[0], p[1], (q[0] - p[0]) / ln, (q[1] - p[1]) / ln, ln))
    return out


def _drugstore(S, nbays=3, brick="brick_b", trim="cream", awn="oxblood", sign="green", ink="cream", blade="win_sign_red",
               annex=dict(brick="brick_y", awn="navy", parapet="step", sign="cream", ink="navy", frame="navy"), seed=1):
    """The corner drugstore: two storeys of brick with the door set in the cut-off corner under a blade sign,
    display windows and awnings down both fronts, the doctor's and the dentist's rooms upstairs; a one-storey
    shop beside it."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=1.6, alley=3.0, yard=6.8, nbays=nbays)
    br, tr = T[brick], T[trim]
    xs = x0 + (x1 - x0) * 0.62 if annex else x1
    gh, fh, c = 4.0, 3.2, 1.9
    h = gh + fh + 0.3
    pts = [(x0 + c, y0), (xs, y0), (xs, y1), (x0, y1), (x0, y0 + c)]
    poly_prism(M, pts, 0, h, br)
    poly_prism(M, [(x0 + c + 0.2, y0 + 0.3), (xs - 0.2, y0 + 0.3), (xs - 0.2, y1 - 0.2), (x0 + 0.3, y1 - 0.2), (x0 + 0.3, y0 + c + 0.2)], h, h + 0.04, T["tar2"])
    Fs = _poly_faces(pts)
    for i, F in enumerate(Fs):
        p, q = F.p(0, -0.15, 0)[:2], F.p(F.ln, -0.15, 0)[:2]
        if i == 1 and annex:
            bar(M, p, q, 0.28, h, h + 0.35, br)
            continue
        bar(M, p, q, 0.3, h, h + 0.6, br)
        if i in (0, 3, 4):
            bar(M, F.p(-0.1, -0.05, 0)[:2], F.p(F.ln + 0.1, -0.05, 0)[:2], 0.6, h + 0.3, h + 0.7, tr)
    front, left, cut, back = Fs[0], Fs[3], Fs[4], Fs[2]
    _shopfront(S, front, 0.1, front.ln - 0.3, 0, gh, T["black"], T[sign], awn=(T[awn], T["cream"]), letters=T[ink], seed=seed, door=0.82)
    _shopfront(S, left, (y1 - y0) * 0.35, left.ln - 0.1, 0, gh, T["black"], T[sign], awn=None, letters=T[ink], seed=seed + 1, door=0.12)
    # the corner door under its own little canopy, the blade sign over it
    _wq(M, cut, cut.ln / 2 - 0.6, cut.ln / 2 + 0.6, 0, 2.3, T["door_g"], 0.05)
    _wq(M, cut, cut.ln / 2 - 0.4, cut.ln / 2 + 0.4, 0.9, 2.1, T["win_shop"], 0.07)
    _quad(M, [cut.p(0.3, 0.5, 2.8), cut.p(cut.ln - 0.3, 0.5, 2.8), cut.p(cut.ln - 0.1, 0.02, 3.05), cut.p(0.1, 0.02, 3.05)], T[awn])
    cx, cy = cut.p(cut.ln / 2, 0.0, 0)[:2]
    G = _Face(cx, cy, cut.ux, cut.uy, 1.0)
    _blade(S, G, 0.0, 0.15, 1.35, gh + 0.2, h + 1.6, T[blade], letters=T["win_sign_cream"], th=0.3)
    wh = T["win_home"]
    _wins(M, front, 0.3, front.ln - 0.3, gh - 0.75, 1, fh, wh, pitch=2.3, lintel=tr, sillm=tr, wh=1.75)
    _wins(M, left, 0.4, left.ln - 0.3, gh - 0.75, 1, fh, wh, pitch=2.6, lintel=tr, sillm=tr, wh=1.75)
    _wins(M, cut, 0.3, cut.ln - 0.3, gh - 0.75, 1, fh, wh, cols=1, lintel=tr, sillm=tr, wh=1.75)
    _wins(M, back, 0.4, back.ln - 0.4, gh - 0.75, 1, fh, wh, pitch=2.8, ww=1.0)
    _wq(M, back, 1.0, 2.0, 0, 2.15, T["door"], 0.05)
    _chimney(S, xs - 0.6, y0 + (y1 - y0) * 0.6, h, h + 1.8, br, cap=T["tar3"])
    _skylight(S, x0 + (xs - x0) * 0.5 - 1.0, x0 + (xs - x0) * 0.5 + 1.0, y0 + (y1 - y0) * 0.45, y0 + (y1 - y0) * 0.45 + 2.4, h + 0.04)
    top = h + 1.6
    if annex:
        _shophouse(S, xs, x1, y0, y1, floors=1, sides="r", seed=seed + 4, ghost=dict(side="r", ground="cream", ink="oxblood"), **annex)
    else:
        _wins(M, Fs[1], 0.5, Fs[1].ln - 0.5, gh - 0.75, 1, fh, wh, pitch=2.8, ww=1.0)
    _cans(S, x0 + 0.6, y1 + 0.45, 3)
    S.body = (x0, x1, y0, y1, top)


def _diner(S, nbays=3, stripe="oxblood", sign="win_sign_red", brick="brick_r", seed=1):
    """The diner: a steel dining car set end-on to nothing, its long side on the pavement, round-ended under a
    barrel roof, a ribbon of windows over an enamel stripe, the sign on the roof; the brick kitchen behind it
    with its flue smoking, the yard for the cars."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=1.9, alley=3.0, yard=6.8, nbays=nbays)
    steel, chrome = T["steel"], T["chrome"]
    cd = 4.6                                   # the car's depth
    r = cd / 2
    c0, c1, ym = x0 + r, x1 - r, y0 + r
    hc = 2.9
    box(M, c0, c1, y0, y0 + cd, 0, hc, steel)
    for cx in (c0, c1):
        cyl(M, cx, ym, r, 0, hc, steel, n=12)
        cyl(M, cx, ym, r + 0.03, 0.75, 1.05, T[stripe], n=12)
        cyl(M, cx, ym, r * 0.98, hc, hc + 0.45, chrome, n=12)
    box(M, c0, c1, y0 - 0.03, y0 + cd + 0.03, 0.75, 1.05, T[stripe])
    # the barrel roof
    n = 6
    prof = [(y0 + r - (r * 0.98) * math.cos(math.pi * i / n), hc + 0.45 * 0 + 0.75 * math.sin(math.pi * i / n)) for i in range(n + 1)]
    extrude_profile(M, prof, "x", c0, c1, chrome)
    box(M, c0 + 0.6, c1 - 0.6, ym - 0.5, ym + 0.5, hc + 0.7, hc + 0.95, T["tin"])
    # the ribbon of windows, the door in a little vestibule
    f = _Face(c0, y0, 1, 0, c1 - c0)
    dc = (c1 - c0) * 0.5
    nw = max(4, int((c1 - c0) / 1.5))
    st = (c1 - c0) / nw
    for i in range(nw):
        a = st * i
        if abs(a + st / 2 - dc) < st * 0.6:
            continue
        _wq(M, f, a + 0.15, a + st - 0.15, 1.25, 2.3, T["win_shop"], 0.04)
    _fbox(M, f, dc - 0.9, dc + 0.9, 0, 0.9, 0, 2.6, steel)
    _fbox(M, f, dc - 1.0, dc + 1.0, -0.1, 1.0, 2.6, 2.75, T[stripe])
    G = _Face(*f.p(dc - 0.9, 0.9, 0)[:2], 1, 0, 1.8)
    _wq(M, G, 0.35, 1.45, 0, 2.15, T["door"], 0.04)
    _wq(M, G, 0.5, 1.3, 0.95, 1.95, T["win_shop"], 0.06)
    b = _Face(c1, y0 + cd, -1, 0, c1 - c0)
    for i in range(nw):
        _wq(M, b, st * i + 0.2, st * (i + 1) - 0.2, 1.35, 2.2, T["win_shop"], 0.04) if i % 2 == 0 else None
    for cx, s in ((c0, -1), (c1, 1)):
        e = _Face(cx + s * (r + 0.02), ym - s * 1.0, 0, s, 2.0)
        _wq(M, e, 0.1, 1.9, 1.25, 2.3, T["win_shop"], 0.02)
    # the sign on the roof
    _roofsign(S, c0 + (c1 - c0) * 0.2, c1 - (c1 - c0) * 0.2, y0 + 0.9, hc + 0.3, 1.3, T[sign], T["win_sign_cream"], seed=seed, legs=0.75)
    # the kitchen
    kx0, kx1, ky0, ky1 = x0 + (x1 - x0) * 0.22, x1 - 0.2, y0 + cd, y1
    kh = 3.6
    box(M, kx0, kx1, ky0, ky1, 0, kh, T[brick])
    _roof(S, kx0, kx1, ky0, ky1, kh, T[brick], T["tar"], cop=T["cream"], par=0.5)
    K = _faces(kx0, kx1, ky0, ky1)
    _wq(M, K["b"], 0.8, 1.8, 0, 2.15, T["door"], 0.05)
    _wins(M, K["b"], 2.4, kx1 - kx0 - 0.4, 0.4, 1, 3, T["win_shop"], pitch=2.4, ww=1.2, wh=1.2)
    _wins(M, K["r"], 0.4, ky1 - ky0 - 0.4, 0.4, 1, 3, T["win_shop"], cols=1, ww=1.2, wh=1.2)
    _chimney(S, kx0 + 1.0, ky1 - 1.0, kh, kh + 2.6, T["tin"], w=0.55, d=0.55, cap=T["tin"])
    _vent(S, kx1 - 1.2, ky0 + 1.2, kh + 0.05)
    _cans(S, x0 + 0.5, y1 - 2.4, 3, along="y")
    S.body = (x0, x1, y0, y1, hc + 2.3)


def _block(S, x0, x1, y0, y1, floors, wall, base=None, trim="cream", gh=4.5, fh=3.7, bay=4.0, win="win_office",
           piers=None, spandrel=None, cornice=None, tar="tar", shops=None, entrance=None, sides="lr", band=None,
           par=0.95, back_cols=None):
    """A commercial block of the 1920s: a stone or terracotta ground floor of display windows (or plain windows)
    between piers, floors of wide windows above with spandrel panels under them, piers running up between the
    bays to a heavy cornice, a flat roof behind a parapet. Returns (roof height, top)."""
    M, T = S.M, S.T
    wl, tr = T[wall], T[trim]
    h = gh + (floors - 1) * fh
    if base:
        box(M, x0, x1, y0, y1, 0, gh, T[base])
        box(M, x0, x1, y0, y1, gh, h, wl)
    else:
        box(M, x0, x1, y0, y1, 0, h, wl)
    top = _roof(S, x0, x1, y0, y1, h, wl, T[tar], cop=tr, par=par)
    _cornice(S, x0, x1, y0, y1, h + 0.2, T[cornice or trim], proj=0.36, h=0.55, sides="f" + sides)
    _cornice(S, x0, x1, y0, y1, gh - 0.3, T[band or trim], proj=0.12, h=0.3, sides="f" + sides)
    F = _faces(x0, x1, y0, y1)
    for s in "f" + sides:
        f = F[s]
        n = max(1, int(f.ln / bay + 0.3))
        st = f.ln / n
        ent = n // 2 if (s == "f" and entrance is not None) else -1
        for i in range(n):
            a = st * i
            # the ground floor
            if shops and (s == "f" or shops.get("sides")):
                if i == ent:
                    _wq(M, f, a + 0.5, a + st - 0.5, 0, gh - 1.3, T["black"], 0.04)
                    _wq(M, f, a + st / 2 - 1.3, a + st / 2 + 1.3, 0, 2.5, T[entrance.get("door", "brass")], 0.06)
                    _wq(M, f, a + st / 2 - 1.3, a + st / 2 + 1.3, 2.6, gh - 1.4, T["win_shop"], 0.06)
                else:
                    _wq(M, f, a + 0.45, a + st - 0.45, 0, gh - 1.1, T[shops.get("frame", "black")], 0.04)
                    _wq(M, f, a + 0.6, a + st - 0.6, 0.6, gh - 1.25, T["win_shop"], 0.07)
                    if shops.get("awn") and s == "f":
                        _awn(M, f, a + 0.4, a + st - 0.4, gh - 1.05, 1.25, T[shops["awn"]], T["cream"])
            else:
                if i == ent:
                    _wq(M, f, a + st / 2 - 1.0, a + st / 2 + 1.0, 0, 2.6, T[entrance.get("door", "brass")], 0.05)
                    _wq(M, f, a + st / 2 - 1.0, a + st / 2 + 1.0, 2.7, gh - 0.9, T[win], 0.05)
                else:
                    _wq(M, f, a + 0.7, a + st - 0.7, 1.1, gh - 0.9, T[win], 0.05)
            # the floors above: a wide window a bay, a spandrel panel under it
            for k in range(1, floors):
                z = gh + (k - 1) * fh
                _wq(M, f, a + 0.55, a + st - 0.55, z + 0.95, z + fh - 0.55, T[win], 0.05)
                if spandrel:
                    _wq(M, f, a + 0.55, a + st - 0.55, z + 0.1, z + 0.9, T[spandrel], 0.04)
        if piers and s == "f":
            for i in range(n + 1):
                a = min(max(st * i, 0.3), f.ln - 0.3)
                _fbox(M, f, a - 0.3, a + 0.3, 0, 0.2, 0, h + 0.2, T[piers])
    # the back: plain windows on the yard
    b = F["b"]
    bc = back_cols or max(2, int(b.ln / 3.4))
    _wins(M, b, 0.6, b.ln - 0.6, gh, floors - 1, fh, T[win], cols=bc, ww=1.4, wh=1.8, sill=1.0)
    if "l" not in sides or "r" not in sides:
        pass
    return h, top


def _dock(S, x0, x1, y, depth=2.0, doors=2, canopy="tar3"):
    """A loading dock on a back wall: the platform, the roller doors, a canopy over them."""
    M, T = S.M, S.T
    box(M, x0, x1, y, y + depth, 0, 1.1, T["lime3"])
    f = _Face(x1, y, -1, 0, x1 - x0)
    st = (x1 - x0) / doors
    for i in range(doors):
        _wq(M, f, st * i + 0.5, st * (i + 1) - 0.5, 1.1, 3.6, T["tin"], 0.05)
    box(M, x0 - 0.2, x1 + 0.2, y, y + depth + 0.4, 3.9, 4.05, T[canopy])
    box(M, x0 + 0.6, x0 + 1.5, y + depth + 0.3, y + depth + 1.2, 0, 0.9, T["wood2"])


def _dept_store(S, nbays=5, floors=3, wall="brick_r", base="lime", trim="cream", piers="lime", spandrel="terra",
                awn="green", blade="win_sign_red", sign="win_sign_red", marquee="oxblood", yard=8.0, bay=4.2,
                tanks=1, corner=None, seed=1, fh=3.9, cornice=None):
    """The department store: display windows along the pavement under awnings, the entrance under a lit marquee,
    floors of wide showroom windows between stone piers, a blade sign down the corner and a sign on the roof,
    skylights, a tank and the lift house up there; the loading dock on the yard behind."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=1.8, alley=3.4, yard=yard, nbays=nbays)
    h, top = _block(S, x0, x1, y0, y1, floors, wall, base=base, trim=trim, piers=piers, spandrel=spandrel, bay=bay,
                    win="win_shop", shops=dict(awn=awn, sides=True), entrance=dict(door="brass"), fh=fh, cornice=cornice)
    w, d = x1 - x0, y1 - y0
    f = _faces(x0, x1, y0, y1)["f"]
    n = max(1, int(w / bay + 0.3))
    st = w / n
    ec = st * (n // 2 + 0.5)
    # the marquee over the doors: a canopy edged with bulbs, lettered on its face
    _fbox(M, f, ec - st * 0.62, ec + st * 0.62, 0, 1.6, 3.2, 3.75, T[marquee])
    G = _Face(*f.p(ec - st * 0.62, 1.6, 0)[:2], f.ux, f.uy, st * 1.24)
    _wq(M, G, 0, st * 1.24, 3.2, 3.32, T["win_sign_cream"], 0.02)
    _wq(M, G, 0, st * 1.24, 3.63, 3.75, T["win_sign_cream"], 0.02)
    _letters(M, G, 0.4, st * 1.24 - 0.4, 3.36, 3.6, T["win_sign_cream"], 0.02, seed, n=6)
    # the blade sign on the corner pier, the sign on the roof
    if blade:
        _blade(S, f, 0.3 if seed % 2 else w - 0.3, 0.25, 1.5, 4.6, h - 0.3, T[blade], letters=T["win_sign_cream"], th=0.3)
    if sign:
        _roofsign(S, x0 + w * 0.2, x1 - w * 0.2, y0 + 1.2, h + 0.05, 1.9, T[sign], T["win_sign_cream"], seed=seed + 2, legs=1.6)
    if corner:
        # a corner tower: a storey higher, under a little copper roof
        cw = st
        cx0 = x0 if seed % 2 == 0 else x1 - cw
        box(M, cx0, cx0 + cw, y0, y0 + cw, h, h + fh + 0.6, T[wall])
        _cornice(S, cx0, cx0 + cw, y0, y0 + cw, h + fh + 0.2, T[trim], proj=0.3, h=0.45)
        taper(M, (cx0 - 0.2, cx0 + cw + 0.2, y0 - 0.2, y0 + cw + 0.2), (cx0 + cw / 2 - 0.2, cx0 + cw / 2 + 0.2, y0 + cw / 2 - 0.2, y0 + cw / 2 + 0.2), h + fh + 0.65, h + fh + 0.65 + cw * 0.5, T[corner])
        C = _faces(cx0, cx0 + cw, y0, y0 + cw)
        for s in "fblr":
            _wq(M, C[s], 0.8, cw - 0.8, h + 1.3, h + fh - 0.3, T["win_shop"], 0.05)
        box(M, cx0 + cw / 2 - 0.05, cx0 + cw / 2 + 0.05, y0 + cw / 2 - 0.05, y0 + cw / 2 + 0.05, h + fh + 0.65 + cw * 0.5, h + fh + 3.2 + cw * 0.5, T["iron"])
        top = max(top, h + fh + 0.65 + cw * 0.5)
    # the roof
    for k in range(tanks):
        _tank(S, x0 + w * (0.78 - 0.5 * k), y0 + d * 0.72, h + 0.05, r=1.5, h=2.6, leg=1.8)
    _bulkhead(S, x0 + w * 0.5, y0 + d * 0.78, h + 0.05, w=3.4, d=3.4, h=3.2, wall=T[wall])
    ns = max(1, int(w / 9))
    for i in range(ns):
        sx = x0 + w * (i + 0.5) / ns
        _skylight(S, sx - 1.6, sx + 1.6, y0 + d * 0.36, y0 + d * 0.36 + 3.4, h + 0.05)
    _vent(S, x0 + 1.5, y0 + d * 0.6, h + 0.05)
    _dock(S, x0 + w * 0.5, x0 + w * 0.5 + min(9.0, w * 0.4), y1, doors=2)
    _cans(S, x0 + 1.0, y1 + 0.5, 3)
    S.body = (x0, x1, y0, y1, top + 0.5)


def _dime_row(S, nbays=5, seed=1, yard=8.0, units=None):
    """The five-and-dime and its neighbours: a long low front under one red and gold sign, a furniture store and
    a tall narrow hardware store beside it."""
    M, T = S.M, S.T
    units = units or [
        dict(w=1.25, floors=2, brick="brick_y", trim="cream", awn="oxblood", sign="oxblood", ink="mustard", frame="black", parapet="flat", tar="tar2", door=0.5),
        dict(w=0.8, floors=3, brick="brick_r2", trim="lime", awn="green", sign="cream", ink="green", frame="green", parapet="ped", escape=True, tank=True),
        dict(w=0.7, floors=2, brick="brick_b", trim="cream", awn="mustard", sign="navy", ink="cream", frame="navy", parapet="step", ghost=dict(side="r")),
    ]
    _mainstreet(S, units, nbays=nbays, front=1.7, yard=yard, alley=3.4, seed=seed)


def _bank(S, nbays=3, stone="lime", stone2="lime2", roof="copper", yard=6.6, seed=1, door="brass"):
    """The bank: a limestone temple on the main street, four columns and a pediment over brass doors, tall
    windows down the sides, a low copper roof with a skylight over the banking hall."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=1.2, alley=3.2, yard=yard, nbays=nbays)
    st, s2 = T[stone], T[stone2]
    pd = 2.6                         # the portico's depth
    w = x1 - x0
    h = 8.2
    b0 = y0 + pd
    box(M, x0, x1, b0, y1, 0, h, st)
    box(M, x0 - 0.1, x1 + 0.1, b0 - 0.1, y1 + 0.1, 0, 0.9, s2)
    box(M, x0 - 0.2, x1 + 0.2, y0 + 0.2, y1 + 0.2, h, h + 0.9, s2)          # the entablature, round the whole bank
    # the steps, the columns, the pediment
    box(M, x0 + 0.6, x1 - 0.6, y0, b0, 0, 0.9, s2)
    box(M, x0 + 1.0, x1 - 1.0, y0 - 0.5, y0, 0, 0.45, s2)
    nc = 4 if w > 11 else 2
    for i in range(nc):
        cx = x0 + 1.6 + (w - 3.2) * i / (nc - 1)
        cyl(M, cx, y0 + 0.9, 0.5, 0.9, h, st, n=8)
        box(M, cx - 0.65, cx + 0.65, y0 + 0.25, y0 + 1.55, h - 0.35, h, s2)
    extrude_profile(M, [(x0 - 0.3, h + 0.9), (x1 + 0.3, h + 0.9), ((x0 + x1) / 2, h + 0.9 + w * 0.17)], "y", y0 + 0.1, b0 + 1.2, st)
    # the roof: a low hip in copper behind the pediment, a skylight
    taper(M, (x0 - 0.1, x1 + 0.1, b0 + 0.6, y1 + 0.1), (x0 + 2.4, x1 - 2.4, b0 + 3.2, y1 - 2.4), h + 0.9, h + 1.9, T[roof])
    _skylight(S, (x0 + x1) / 2 - 1.6, (x0 + x1) / 2 + 1.6, (b0 + y1) / 2 - 1.2, (b0 + y1) / 2 + 2.2, h + 1.85)
    F = _faces(x0, x1, b0, y1)
    f = F["f"]
    _wq(M, f, w / 2 - 1.2, w / 2 + 1.2, 0.9, 4.4, T[door], 0.05)
    _wq(M, f, w / 2 - 1.2, w / 2 + 1.2, 4.6, 6.6, T["win_office"], 0.05)
    for a in (w * 0.2, w * 0.8):
        _wq(M, f, a - 0.7, a + 0.7, 2.2, 6.4, T["win_office"], 0.05)
    d = y1 - b0
    for s in ("l", "r"):
        _wins(M, F[s], 0.8, d - 0.8, 0, 1, 8, T["win_office"], pitch=3.0, ww=1.5, wh=4.3, sill=2.0)
        n = max(1, int((d - 1.6) / 3.0 + 0.15))
        for i in range(n + 1):
            a = 0.8 + (d - 1.6) * i / n
            _fbox(M, F[s], a - 0.25, a + 0.25, 0, 0.16, 0.9, h, s2)
    _wins(M, F["b"], 0.8, w - 0.8, 0, 1, 8, T["win_office"], pitch=3.4, ww=1.3, wh=2.4, sill=4.0)
    _wq(M, F["b"], w * 0.5 - 0.6, w * 0.5 + 0.6, 0, 2.3, T["black"], 0.05)
    # a flag over the door
    box(M, (x0 + x1) / 2 - 0.05, (x0 + x1) / 2 + 0.05, y0 + 0.6, y0 + 0.7, h + 0.9 + w * 0.17 - 0.3, h + 0.9 + w * 0.17 + 3.4, T["iron"])
    S.body = (x0, x1, y0, y1, h + 2.0)


def _office_block(S, nbays=3, floors=4, wall="brick_r", base="lime", trim="cream", piers=None, spandrel="terra",
                  yard=6.8, tank=True, sign=None, seed=1, fh=3.5, bay=3.3, front=1.5, alley=3.2, tandem=False,
                  cornice=None, flag=False, shops=None):
    """An office block in brick and terracotta: lawyers, the insurance agent, the telephone exchange, the
    newspaper. A stone ground floor with the door in the middle bay, floors of wide windows over terracotta
    spandrels, a heavy cornice; on the roof a wooden tank, the lift house, a skylight over the stair."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=front, alley=alley, yard=yard, nbays=nbays, tandem=tandem)
    h, top = _block(S, x0, x1, y0, y1, floors, wall, base=base, trim=trim, piers=piers, spandrel=spandrel, bay=bay,
                    win="win_office", entrance=dict(door="brass"), fh=fh, gh=4.3, cornice=cornice, shops=shops)
    w, d = x1 - x0, y1 - y0
    f = _faces(x0, x1, y0, y1)["f"]
    # the door's stone surround and a canopy
    n = max(1, int(w / bay + 0.3))
    ec = (w / n) * (n // 2 + 0.5)
    _fbox(M, f, ec - 1.5, ec + 1.5, 0, 0.9, 2.9, 3.1, T[trim])
    if tank:
        _tank(S, x0 + w * (0.3 if seed % 2 else 0.7), y0 + d * 0.66, h + 0.05, r=min(1.4, w * 0.12))
    _bulkhead(S, x0 + w * (0.7 if seed % 2 else 0.3), y0 + d * 0.7, h + 0.05, w=2.6, d=3.0, h=2.8, wall=T[wall])
    if d > 8:
        _skylight(S, x0 + w * 0.5 - 1.1, x0 + w * 0.5 + 1.1, y0 + d * 0.25, y0 + d * 0.25 + 2.6, h + 0.05)
    if sign:
        _roofsign(S, x0 + w * 0.15, x1 - w * 0.15, y0 + 1.0, h + 0.05, 1.5, T[sign], T["win_sign_cream"], seed=seed, legs=1.4)
    if flag:
        box(M, x0 + w / 2 - 0.05, x0 + w / 2 + 0.05, y0 + 0.4, y0 + 0.5, h, h + 5.5, T["iron"])
        _quad(M, [(x0 + w / 2 + 0.05, y0 + 0.45, h + 4.2), (x0 + w / 2 + 1.9, y0 + 0.45, h + 4.2), (x0 + w / 2 + 1.9, y0 + 0.45, h + 5.4), (x0 + w / 2 + 0.05, y0 + 0.45, h + 5.4)], T["oxblood"])
        _quad(M, [(x0 + w / 2 + 1.9, y0 + 0.45, h + 4.2), (x0 + w / 2 + 0.05, y0 + 0.45, h + 4.2), (x0 + w / 2 + 0.05, y0 + 0.45, h + 5.4), (x0 + w / 2 + 1.9, y0 + 0.45, h + 5.4)], T["oxblood"])
    _chimney(S, x1 - 0.7, y1 - 0.8, h, h + 2.4, T[wall], w=0.8, d=0.8, cap=T[trim])
    _cans(S, x0 + 0.8, y1 + 0.5, 3)
    S.body = (x0, x1, y0, y1, top + 0.3)


def _deco_office(S, nbays=3, floors=3, stone="lime", stone2="lime2", accent="green", yard=6.8, seed=1, fh=3.7):
    """A savings bank and its offices behind a Deco stone front: fluted piers running the whole height between
    tall strips of window, a stepped parapet with a flagstaff over the brass doors."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=1.5, alley=3.2, yard=yard, nbays=nbays)
    st, s2 = T[stone], T[stone2]
    w, d = x1 - x0, y1 - y0
    gh = 4.6
    h = gh + (floors - 1) * fh
    box(M, x0, x1, y0, y1, 0, h, st)
    box(M, x0 - 0.08, x1 + 0.08, y0 - 0.08, y1 + 0.08, 0, 1.0, T["black"])
    top = _roof(S, x0, x1, y0, y1, h, st, T["tar2"], cop=s2, par=0.9)
    F = _faces(x0, x1, y0, y1)
    f = F["f"]
    n = max(3, int(w / 2.9) | 1)
    stp = w / n
    for i in range(n):
        a = stp * i
        mid = i == n // 2
        if mid:
            _wq(M, f, a + 0.3, a + stp - 0.3, 0, 3.0, T["brass"], 0.05)
            _wq(M, f, a + 0.3, a + stp - 0.3, 3.2, h - 1.2, T["win_office"], 0.05)
        else:
            _wq(M, f, a + 0.55, a + stp - 0.55, 1.6, h - 1.2, T["black"], 0.04)
            for k in range(floors):
                z = (0 if k == 0 else gh + (k - 1) * fh)
                _wq(M, f, a + 0.55, a + stp - 0.55, z + (1.7 if k == 0 else 0.8), z + (gh if k == 0 else fh) - 0.5, T["win_office"], 0.06)
    for i in range(n + 1):
        a = min(max(stp * i, 0.28), w - 0.28)
        _fbox(M, f, a - 0.28, a + 0.28, 0, 0.22, 0, h + 0.5, s2)
    # the stepped parapet over the door, the accent band, the flagstaff
    cx = x0 + w / 2
    box(M, cx - stp * 1.5, cx + stp * 1.5, y0 - 0.1, y0 + 0.4, h + 0.5, h + 1.7, st)
    box(M, cx - stp * 0.6, cx + stp * 0.6, y0 - 0.16, y0 + 0.46, h + 1.7, h + 2.6, st)
    box(M, cx - stp * 1.5 - 0.05, cx + stp * 1.5 + 0.05, y0 - 0.16, y0 + 0.46, h + 1.1, h + 1.3, T[accent])
    box(M, cx - 0.06, cx + 0.06, y0 + 0.1, y0 + 0.22, h + 2.6, h + 7.5, T["iron"])
    for s in ("l", "r"):
        _wins(M, F[s], 0.7, d - 0.7, 0, 1, gh, T["win_office"], pitch=3.0, ww=1.5, wh=2.2, sill=1.5)
        _wins(M, F[s], 0.7, d - 0.7, gh, floors - 1, fh, T["win_office"], pitch=3.0, ww=1.5, wh=2.2, sill=0.8)
    _wins(M, F["b"], 0.7, w - 0.7, gh, floors - 1, fh, T["win_office"], pitch=3.2, ww=1.3, wh=1.8, sill=0.9)
    _wq(M, F["b"], w * 0.3 - 0.5, w * 0.3 + 0.5, 0, 2.2, T["black"], 0.05)
    _bulkhead(S, x0 + w * 0.68, y0 + d * 0.7, h + 0.05, w=2.6, d=3.0, h=2.6, wall=s2)
    _skylight(S, cx - 1.6, cx + 1.6, y0 + d * 0.25, y0 + d * 0.25 + 3.0, h + 0.05)
    _vent(S, x0 + 1.2, y1 - 1.5, h + 0.05)
    S.body = (x0, x1, y0, y1, top + 1.5)


def _market(S, nbays=8, brick="brick_r", trim="cream", roof="tin", seed=1, yard=8.0):
    """The covered market: a long brick hall under a glazed monitor roof, tall windows down its sides, the big
    doors at each end under a lettered gable, the greengrocers' and butchers' stalls under striped awnings
    along the pavement and down the side, farm trucks' dock on the yard."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=3.2, alley=3.6, yard=yard, nbays=nbays, front_m=T["paving"])
    br, tr = T[brick], T[trim]
    w, d = x1 - x0, y1 - y0
    eh = 6.4
    rise = d * 0.16
    box(M, x0, x1, y0, y1, 0, eh, br)
    ym = (y0 + y1) / 2
    # the roof: two slopes up to a long glazed monitor along the ridge
    extrude_profile(M, [(y0 - 0.4, eh), (ym - 2.2, eh + rise), (ym + 2.2, eh + rise), (y1 + 0.4, eh),
                        (y1 + 0.4, eh - 0.15), (y0 - 0.4, eh - 0.15)], "x", x0 - 0.3, x1 + 0.3, T[roof])
    box(M, x0 + 1.5, x1 - 1.5, ym - 2.0, ym + 2.0, eh + rise - 0.05, eh + rise + 1.3, tr)
    extrude_profile(M, [(ym - 2.3, eh + rise + 1.3), (ym, eh + rise + 2.0), (ym + 2.3, eh + rise + 1.3)], "x", x0 + 1.3, x1 - 1.3, T[roof])
    nm = max(4, int((w - 3) / 3.0))
    for s, yy in ((1, ym - 2.0), (-1, ym + 2.0)):
        G = _Face(x0 + 1.5 if s > 0 else x1 - 1.5, yy, s, 0, w - 3.0)
        for i in range(nm):
            a = (w - 3.0) * i / nm
            _wq(M, G, a + 0.2, a + (w - 3.0) / nm - 0.2, eh + rise + 0.2, eh + rise + 1.15, T["win_shop"], 0.03)
    # the gable ends over the big doors
    for xe, s in ((x0, "l"), (x1, "r")):
        extrude_profile(M, [(y0, eh), (y1, eh), (ym + 2.2, eh + rise), (ym - 2.2, eh + rise)], "x", xe - 0.02 if s == "l" else xe - 0.3, xe + 0.3 if s == "l" else xe + 0.02, br)
        E = _faces(x0, x1, y0, y1)[s]
        _wq(M, E, d / 2 - 2.2, d / 2 + 2.2, 0, 4.2, T["door_g"], 0.05)
        _wq(M, E, d / 2 - 2.0, d / 2 + 2.0, 4.5, 5.4, T["cream"], 0.05)
        _letters(M, E, d / 2 - 1.7, d / 2 + 1.7, 4.65, 5.25, T["oxblood"], 0.07, seed, n=6)
        _wq(M, E, d / 2 - 1.6, d / 2 + 1.6, eh - 0.2, eh + rise - 0.5, T["win_shop"], 0.05)
    F = _faces(x0, x1, y0, y1)
    # tall windows down the long sides over the stalls
    for s in ("f", "b"):
        _wins(M, F[s], 0.8, w - 0.8, 0, 1, eh, T["win_shop"], pitch=3.6, ww=2.0, wh=2.0, sill=3.7)
        n = max(2, int((w - 1.6) / 3.6 + 0.15))
        for i in range(n + 1):
            a = 0.8 + (w - 1.6) * i / n
            _fbox(M, F[s], a - 0.3, a + 0.3, 0, 0.18, 0, eh, br)
    # the stalls: counters heaped with produce under striped awnings
    f = F["f"]
    ns = max(3, int(w / 5.2))
    stp = w / ns
    cols = (("oxblood", "crop"), ("green", "mustard"), ("navy", "terra"), ("mustard", "crop"))
    T["crop"] = S.P["crop"]
    for i in range(ns):
        a = stp * i
        aw, heap = cols[(i + seed) % len(cols)]
        _awn(M, f, a + 0.4, a + stp - 0.4, 3.4, 2.4, T[aw], T["cream"], drop=0.9)
        _fbox(M, f, a + 0.7, a + stp - 0.7, 0.9, 1.9, 0, 0.85, T["wood2"])
        _fbox(M, f, a + 0.85, a + stp * 0.5, 1.0, 1.8, 0.85, 1.1, T[heap])
        _fbox(M, f, a + stp * 0.5 + 0.1, a + stp - 0.85, 1.0, 1.8, 0.85, 1.05, T[cols[(i + seed + 1) % len(cols)][1]])
        for b in (a + 0.45, a + stp - 0.45):
            _fbox(M, f, b - 0.05, b + 0.05, 2.25, 2.35, 0, 2.5, T["iron"])
    _dock(S, x0 + w * 0.3, x0 + w * 0.3 + 10.0, y1, doors=3, canopy="tin")
    _cans(S, x0 + 1.0, y1 + 0.5, 4)
    _chimney(S, x1 - 2.0, y1 - 1.6, eh, eh + rise + 2.2, br, w=0.9, d=0.9, cap=tr)
    S.body = (x0, x1, y0, y1, eh + rise + 2.0)


def _filling_station(S, nbays=2, wall="white", stripe="oxblood", roof="tile", seed=1):
    """A filling station of the 1930s: a little white station house with a red stripe under a tiled roof, its
    canopy carried out over the pump island on two piers, tall pumps with glass globes, a service bay with its
    door up, the oil rack and the air tower, a round enamel sign on a post at the kerb."""
    M, T = S.M, S.T
    asph = S.P["drive"]
    S.ground(S.xl, S.xr, S.yf, S.yb, T["cinder"])
    box(M, S.xl + 1.0, S.xr - 1.0, S.yf + 0.3, S.yb - 8.5, PAD_H, PAD_H + 0.012, asph)
    # the cars' two bays, front left
    S.bays = [(S.xl + 2.6 + i * BAY_W, S.yf + 0.8 + BAY_L / 2) for i in range(nbays)]
    wl = T[wall]
    # the station house at the back, the service bay beside it
    hx0, hx1, hy0, hy1 = -1.5, S.xr - 1.6, S.yb - 7.6, S.yb - 1.2
    h = 3.4
    box(M, hx0, hx1, hy0, hy1, 0, h, wl)
    box(M, hx0 - 0.04, hx1 + 0.04, hy0 - 0.04, hy1 + 0.04, 2.55, 2.85, T[stripe])
    taper(M, (hx0 - 0.5, hx1 + 0.5, hy0 - 0.5, hy1 + 0.5), (hx0 + 2.2, hx1 - 2.2, (hy0 + hy1) / 2 - 0.1, (hy0 + hy1) / 2 + 0.1), h, h + 1.9, T[roof])
    H = _faces(hx0, hx1, hy0, hy1)
    hw = hx1 - hx0
    _wq(M, H["f"], hw * 0.5 - 0.5, hw * 0.5 + 0.5, 0, 2.15, T["door_g"], 0.05)
    _wq(M, H["f"], 0.5, hw * 0.5 - 0.9, 0.8, 2.3, T["win_shop"], 0.05)
    _wq(M, H["f"], hw * 0.5 + 0.9, hw - 0.5, 0.8, 2.3, T["win_shop"], 0.05)
    _wins(M, H["r"], 0.6, hy1 - hy0 - 0.6, 0, 1, 3, T["win_shop"], cols=2, ww=1.2, wh=1.3, sill=1.0)
    _wins(M, H["b"], 0.6, hw - 0.6, 0, 1, 3, T["win_shop"], cols=2, ww=1.0, wh=1.0, sill=1.2)
    gx0, gx1 = S.xl + 1.6, hx0
    gh = 3.8
    box(M, gx0, gx1, hy0 + 0.6, hy1, 0, gh, wl)
    box(M, gx0 - 0.04, gx1, hy0 + 0.56, hy1 + 0.04, 2.55, 2.85, T[stripe])
    _roof(S, gx0, gx1, hy0 + 0.6, hy1, gh, wl, T["tar"], cop=T[stripe], par=0.5)
    G = _faces(gx0, gx1, hy0 + 0.6, hy1)
    gw = gx1 - gx0
    _wq(M, G["f"], 0.7, gw - 0.7, 0, 3.0, T["black"], 0.04)
    _wq(M, G["f"], 0.7, gw - 0.7, 2.2, 3.0, T["tin"], 0.07)
    _wins(M, G["l"], 0.6, hy1 - hy0 - 1.2, 0, 1, 3, T["win_shop"], cols=2, ww=1.3, wh=1.3, sill=1.2)
    _chimney(S, gx0 + 0.8, hy1 - 0.8, gh, gh + 1.6, T["brick_r"], w=0.6, d=0.6, cap=T["tar3"])
    # the canopy out over the island: a tiled gable on two stout piers
    cx = (hx0 + hx1) / 2
    cy0 = hy0 - 6.2
    for px in (cx - 2.6, cx + 2.6):
        box(M, px - 0.3, px + 0.3, cy0 + 0.2, cy0 + 0.8, 0, 3.1, wl)
        box(M, px - 0.34, px + 0.34, cy0 + 0.16, cy0 + 0.84, 0, 0.9, T[stripe])
    box(M, cx - 3.3, cx + 3.3, cy0 - 0.2, hy0, 3.1, 3.45, wl)
    box(M, cx - 3.34, cx + 3.34, cy0 - 0.24, hy0 - 0.3, 3.18, 3.38, T[stripe])
    extrude_profile(M, [(cx - 3.6, 3.45), (cx, 4.9), (cx + 3.6, 3.45)], "y", cy0 - 0.5, hy0 + 0.6, T[roof])
    # the island and its pumps: tall cabinets, glass globes on top
    box(M, cx - 2.2, cx + 2.2, cy0 + 0.1, cy0 + 0.9, PAD_H, 0.26, T["lime3"])
    for i, px in enumerate((cx - 1.4, cx, cx + 1.4)):
        col = T[(stripe, "mustard", "green")[i % 3]]
        box(M, px - 0.26, px + 0.26, cy0 + 0.28, cy0 + 0.72, 0.26, 2.0, col)
        cyl(M, px, cy0 + 0.5, 0.2, 2.0, 2.25, T["black"], n=6)
        cyl(M, px, cy0 + 0.5, 0.3, 2.25, 2.75, T["win_sign_cream"], n=8)
    # the enamel sign on its post at the kerb, the air tower, the oil rack
    sx, sy = S.xr - 1.4, S.yf + 1.2
    box(M, sx - 0.08, sx + 0.08, sy - 0.08, sy + 0.08, 0, 4.3, T["iron"])
    for s in (-1, 1):
        cyl_y = sy + s * 0.07
        pts = [(sx + 1.1 * math.cos(2 * math.pi * k / 10), cyl_y, 5.4 + 1.1 * math.sin(2 * math.pi * k / 10)) for k in range(10)]
        _quad(M, pts if s < 0 else pts[::-1], T["win_sign_red"])
        pts = [(sx + 0.72 * math.cos(2 * math.pi * k / 10), cyl_y + s * 0.02, 5.4 + 0.72 * math.sin(2 * math.pi * k / 10)) for k in range(10)]
        _quad(M, pts if s < 0 else pts[::-1], T["win_sign_cream"])
    box(M, hx1 + 0.3, hx1 + 0.7, hy0 - 1.0, hy0 - 0.6, 0, 1.5, T[stripe])
    cyl(M, hx1 + 0.5, hy0 - 0.8, 0.26, 1.5, 1.9, T["win_sign_cream"], n=6)
    box(M, gx0 + 0.3, gx0 + 2.3, hy0 - 0.2, hy0 + 0.4, 0, 1.1, T["iron"])
    for k in range(4):
        cyl(M, gx0 + 0.55 + k * 0.5, hy0 + 0.1, 0.2, 1.1, 1.45, T[("oxblood", "mustard", "green", "navy")[k]], n=6)
    box(M, S.xl, S.xr, S.yb - 0.1, S.yb, 0, 1.7, T["board"])
    S.body = (gx0, hx1, cy0, hy1, 5.3)


# ------------------------------------------------------------------ the catalogue

# highstreet (18 x 20): a village's main street, on 3- and 2-cell fronts
_town("highstreet", "highstreet", 0.92, 1.0, 3, _mainstreet, units=[
    dict(w=1.0, floors=2, brick="brick_r", trim="cream", awn="green", sign="cream", ink="green", frame="green", parapet="step"),
    dict(w=0.95, floors=3, brick="brick_y", trim="lime", awn="oxblood", sign="oxblood", ink="cream", frame="black", parapet="flat", tar="tar2", ghost=dict(side="r", ink="oxblood"))], seed=21)
_town("highstreet_b", "highstreet", 0.92, 1.0, 3, _drugstore, seed=22)
_town("highstreet_c", "highstreet", 0.92, 1.0, 3, _diner, seed=23)
_town("highstreet_d", "highstreet", 0.92, 1.0, 3, _mainstreet, units=[
    dict(w=0.8, floors=3, brick="brick_b", trim="cream", awn="mustard", sign="navy", ink="cream", frame="navy", parapet="ped", ghost=dict(side="l", ground="white", ink="navy")),
    dict(w=1.0, floors=2, brick="brick_r2", trim="lime", awn="navy", sign="cream", ink="navy", frame="black", parapet="flat", tar="tar2")], seed=24)

# shop (18 x 20): the single shop on a 2-cell lot; tall, a shop-house of four storeys
_town("shop", "shop", 0.65, 1.0, 1, _mainstreet, units=[
    dict(w=1, floors=1, brick="brick_r", trim="cream", awn="mustard", sign="green", ink="cream", frame="green", parapet="step", ghost=dict(side="r"))],
    yard=1.2, alley=2.8, tandem=True, seed=25)
_town("shop_b", "shop", 0.65, 1.0, 1, _mainstreet, units=[
    dict(w=1, floors=2, brick="brick_y", trim="cream", awn="green", sign="cream", ink="oxblood", frame="oxblood", parapet="flat", tar="tar2")],
    yard=1.2, alley=2.8, tandem=True, seed=26)
_town("shop_c", "shop", 0.65, 1.0, 1, _mainstreet, units=[
    dict(w=1, floors=2, brick="brick_d", trim="lime", awn="navy", sign="white", ink="navy", frame="black", parapet="ped", ghost=dict(side="r", ground="white", ink="oxblood"))],
    yard=1.2, alley=2.8, tandem=True, seed=27)
_town("shop_t", "shop", 0.65, 1.6, 1, _mainstreet, units=[
    dict(w=1, floors=4, brick="brick_r2", trim="cream", awn="oxblood", sign="cream", ink="oxblood", frame="black", parapet="flat", escape=True, tank=True)],
    yard=1.2, alley=2.8, tandem=True, seed=28)
_town("shop_u", "shop", 0.65, 1.6, 1, _mainstreet, units=[
    dict(w=1, floors=4, brick="brick_t", trim="lime", awn="green", sign="green", ink="cream", frame="green", parapet="step", tank=True, tar="tar2", ghost=dict(side="r", ink="green"))],
    yard=1.2, alley=2.8, tandem=True, seed=29)

# store (30 x 28): the department store, the five-and-dime row; on 3-cell lots the bank
_town("store", "store", 1.0, 1.0, 5, _dept_store, floors=3, wall="brick_r", seed=31)
_town("store_b", "store", 1.0, 1.0, 5, _dime_row, seed=32)
_town("store_m", "store", 0.75, 1.0, 3, _bank, seed=33)
_town("store_n", "store", 0.75, 1.0, 3, _dept_store, floors=3, wall="brick_y", base="lime2", spandrel="green", awn="oxblood",
      blade="win_sign_green", sign=None, marquee="green", yard=7.0, bay=3.8, tanks=1, seed=34)

# office (20 x 22): the office block; a Deco savings bank; tall, six and seven storeys
_town("office", "office", 0.955, 1.0, 3, _office_block, floors=4, wall="brick_r", seed=41)
_town("office_b", "office", 0.955, 1.0, 3, _deco_office, floors=3, seed=42)
_town("office_c", "office", 0.955, 1.0, 3, _office_block, floors=4, wall="brick_y", base="lime2", spandrel="green", trim="lime",
      sign="win_sign_blue", tank=False, seed=43)
_town("office_t", "office", 0.955, 1.45, 3, _office_block, floors=6, wall="brick_b", base="lime", spandrel="cream", piers="brick_b",
      flag=True, seed=44)
_town("office_u", "office", 0.955, 1.45, 3, _office_block, floors=6, wall="lime", base="lime2", spandrel="lime3", piers="lime2",
      trim="lime2", cornice="terra", sign="win_sign_red", seed=45)
_town("office_s", "office", 0.59, 1.8, 1, _office_block, floors=5, wall="brick_r2", base="lime", spandrel="terra", yard=1.2,
      alley=2.8, tandem=True, bay=2.6, tank=True, seed=46)

# mall (48 x 40): the big department store, the covered market
_town("mall", "mall", 0.925, 1.0, 8, _dept_store, floors=4, wall="brick_y", base="lime", spandrel="terra", piers="lime",
      awn="oxblood", blade="win_sign_red", sign="win_sign_red", yard=9.0, bay=4.6, tanks=2, corner="copper", seed=51)
_town("mall_b", "mall", 0.925, 1.0, 8, _market, seed=52)
_town("mall_c", "mall", 0.925, 1.0, 8, _dept_store, floors=4, wall="brick_r2", base="lime2", spandrel="cream", piers="lime2",
      awn="green", blade="win_sign_green", sign="win_sign_gold", marquee="green", yard=9.0, bay=4.6, tanks=1, corner="slate", cornice="lime", seed=53)

# fuelstation (24 x 24)
_town("fuelstation", "fuelstation", 0.875, 1.0, 2, _filling_station, rear=False, seed=61)

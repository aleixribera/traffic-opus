# The street wall, 1920-1940 (docs/design.md "The street wall"): the party-wall fronts of a main street. Shop-houses
# shoulder to shoulder under their awnings, the drugstore turning the corner, the picture house, the office blocks
# and the department store of a town's centre, and the towers of a city's core on their podiums. Kit: town_a_kit.py,
# with the shop-house of town_c_shops.py and the tiers and crowns of town_d_towers.py.
#
# The game builds these fronts to the pavement, each exactly as wide as its lot (one to four zone cells of 8 m), so
# neighbours share a wall (src/game/growables.ts WALL_LOTS; src/render/townmodels.ts WALL_MODELS lists them). So a
# wall model differs from the other town models:
#   - its building takes the whole width of its lot: no alley, no side yard, no parking (customers pull up at the
#     kerb). A walled yard behind it holds the back doors, the ash cans and the sheds.
#   - its front wall stands on the lot's front line. The awnings and canopies reach WALL_P m out over the pavement in
#     front of the lot, and the model's footprint starts there: the game reads the front wall from `body_0`.
#   - its side walls are dressed (windows, a painted advertisement), for where it stands at the end of a row or
#     taller than its neighbour; against a neighbour as tall they are simply hidden.
#   - a corner model has a cut-off corner and a second front on its left; `mirror` makes its right-hand twin (and
#     gives the plain rows a second look for free).

WALL_P = 1.3     # how far an awning or a canopy stands out over the pavement (every wall model has one that does)
WALL_IN = 0.04   # a front's side walls stand this far inside its lot (cornices and copings overhang by as much)
WALL_MODELS = {}  # model -> (kind, cells, tall): what build_models writes into each GLB's `design_0`


def _wall_site(S, depth, yard, fence="board"):
    """The ground of a wall lot: the building line on the lot's front, the building `depth` deep across the whole
    width, a fenced yard behind."""
    M, T = S.M, S.T
    S.wy0 = S.yf + WALL_P
    S.wy1 = S.wy0 + depth
    S.yb = S.wy1 + yard
    S.ground(S.xl, S.xr, S.wy0, S.wy1, T["kerb"])
    S.ground(S.xl, S.xr, S.wy1, S.yb, T["cinder"])
    m = {"board": T["board"], "white": T["white"], "green": T["green"], "brick": T["brick_b"]}[fence]
    box(M, S.xl, S.xr, S.yb - 0.12, S.yb, 0, 1.8, m)
    for x in (S.xl, S.xr - 0.1):
        box(M, x, x + 0.1, S.wy1, S.yb - 0.12, 0, 1.8, m)
    S.bays, S.via = [], None


def _wall(name, kind, cells, tall, fn, depth=13.0, yard=5.0, mirror=False, fence="board", **kw):
    """Register a model of the street wall: `kind`'s footprint width scaled to a front of `cells` zone cells."""
    w = BUILDINGS[kind][1]
    fit = cells * 8.0 / w
    d = (WALL_P + depth + yard) / fit
    rot = len(TOWN_DESIGN)

    def build(M, P):
        S = _Site(M, P, w, d, fit, tall, rot)
        _wall_site(S, depth, yard, fence)
        fn(S, **kw)
        assert S.body is not None and len(S.body) == 5, name
        xs = [v.co.x for v in M.bm.verts]
        ys = [v.co.y for v in M.bm.verts]
        # (the footprint the game is told: the lot's width, from the awnings' edge to the back fence)
        assert abs(min(ys) - S.yf) < 0.02 and abs(max(ys) - S.yb) < 0.02, (name, min(ys), S.yf, max(ys), S.yb)
        assert min(xs) > S.xl - 0.12 and max(xs) < S.xr + 0.12, (name, min(xs), S.xl, max(xs), S.xr)
        # (a coping or a sill that oversails the side wall by a few centimetres is cut off at the lot's side, where
        # the neighbour's wall stands)
        for v in M.bm.verts:
            v.co.x = min(S.xr, max(S.xl, v.co.x))
        if mirror:
            for v in M.bm.verts:
                v.co.x = -v.co.x
            bmesh.ops.reverse_faces(M.bm, faces=M.bm.faces[:])
            M.fx = [(k, -x, y, z, s) for k, x, y, z, s in M.fx]
            x0, x1, y0, y1, top = S.body
            S.body = (-x1, -x0, y0, y1, top)
        return S.finish()

    build.__doc__ = fn.__doc__
    BUILDINGS[name] = (build, w, d, 0)
    TOWN_DESIGN[name] = (kind, fit, tall)
    WALL_MODELS[name] = (kind, cells, tall)


def _wyard(S, seed=1, cans=3, extra=True):
    """What stands in a wall lot's yard: the ash cans by the back door, a shed, a garage or crates in the corner."""
    w = S.xr - S.xl
    yard = S.yb - S.wy1
    _cans(S, S.xl + 0.7, S.wy1 + 0.5, min(cans, max(1, int(w / 3))))
    if extra and yard >= 3.2 and w >= 7:
        x1 = S.xr - 0.3
        _yard_extra(S, max(S.xl + 2.6, x1 - 4.8), x1, S.yb - 0.1, seed % 3)


# ------------------------------------------------------------------ shop-house rows

def _wrow(S, units, seed=1, left=WALL_IN):
    """A length of main street: shop-houses wall to wall on the pavement, each its own brick, height and awning."""
    x0, x1, y0, y1 = S.xl + left, S.xr - WALL_IN, S.wy0, S.wy1
    tot = sum(u["w"] for u in units)
    a, top = x0, 0
    for i, u in enumerate(units):
        bw = (x1 - x0) * u["w"] / tot
        kw = {k: v for k, v in u.items() if k not in ("w", "dd", "roofsign")}
        yu = y1 - u.get("dd", 0)
        h = _shophouse(S, a, a + bw, y0, yu, sides="lr", seed=seed + i * 3, **kw)
        if u.get("roofsign"):
            _roofsign(S, a + 0.5, a + bw - 0.5, y0 + 1.0, h - 0.7, 1.3, S.T[u["roofsign"]], S.T["win_sign_cream"], seed=seed + i, legs=0.9)
            h += 1.6
        top = max(top, h)
        a += bw
    _wyard(S, seed)
    S.body = (S.xl, S.xr, y0, y1, top)


def _wcinema(S, x0, x1, y0, y1, wall="lime", aud="brick_b", marquee="oxblood", blade="win_sign_red", seed=1):
    """The picture house: a stucco front stepping up to its name in lights, the marquee over the doors edged with
    bulbs, the poster cases, and the blank brick auditorium behind."""
    M, T = S.M, S.T
    w = x1 - x0
    lob = 5.0                                  # the lobby block's depth
    hl, ha = 8.6, 10.4
    box(M, x0, x1, y0, y0 + lob, 0, hl, T[wall])
    box(M, x0, x1, y0 + lob, y1, 0, ha, T[aud])
    box(M, x0 + 0.25, x1 - 0.25, y0 + lob + 0.25, y1 - 0.25, ha, ha + 0.05, T["tar2"])
    frame(M, x0, x1, y0 + lob, y1, ha, ha + 0.45, 0.25, T[aud])
    box(M, x0 + 0.25, x1 - 0.25, y0 + 0.25, y0 + lob, hl, hl + 0.05, T["tar"])
    # the stepped front
    box(M, x0, x1, y0, y0 + 0.3, hl, hl + 0.7, T[wall])
    box(M, x0 + w * 0.2, x1 - w * 0.2, y0, y0 + 0.3, hl + 0.7, hl + 1.6, T[wall])
    box(M, x0 + w * 0.36, x1 - w * 0.36, y0, y0 + 0.3, hl + 1.6, hl + 2.5, T[wall])
    f = _faces(x0, x1, y0, y1)["f"]
    for a in (0.5, w - 1.0):                   # fluted piers at the ends
        _fbox(M, f, a, a + 0.5, 0, 0.16, 0, hl + 0.7, T["lime2"])
    # the doors in a dark recess, poster cases either side
    _wq(M, f, w / 2 - 2.6, w / 2 + 2.6, 0, 3.1, T["black"], 0.04)
    for k in range(4):
        a = w / 2 - 2.3 + k * 1.2
        _wq(M, f, a, a + 1.0, 0, 2.3, T["brass"], 0.07)
        _wq(M, f, a + 0.15, a + 0.85, 0.9, 2.1, T["win_shop"], 0.09)
    for a in (1.3, w - 2.5):
        _wq(M, f, a, a + 1.2, 0.9, 2.7, T["win_sign_cream"], 0.06)
        _wq(M, f, a + 0.15, a + 1.05, 1.05, 2.55, T[marquee], 0.08)
    # the marquee: its edge in lights, the programme lettered on it
    _fbox(M, f, 0.9, w - 0.9, 0, WALL_P, 3.3, 4.15, T[marquee])
    G = _Face(*f.p(0.9, WALL_P, 0)[:2], f.ux, f.uy, w - 1.8)
    _wq(M, G, 0, w - 1.8, 3.3, 3.42, T["win_sign_cream"], 0.0)
    _wq(M, G, 0, w - 1.8, 4.03, 4.15, T["win_sign_cream"], 0.0)
    _wq(M, G, 0.3, w - 2.1, 3.5, 3.95, T["win_sign_cream"], 0.0)
    _letters(M, G, 0.6, w - 2.4, 3.56, 3.89, T["black"], 0.01, seed, n=7)
    # the name down the front in lights
    _blade(S, f, w / 2, 0.1, 1.15, 4.4, hl + 3.6, T[blade], letters=T["win_sign_cream"], th=0.5)
    for a in (w * 0.2, w * 0.8 - 1.2):
        _wq(M, f, a, a + 1.2, 5.0, 7.4, T["win_office"], 0.05)
    # the auditorium: blank walls in panels, the exit doors, the vents
    F = _faces(x0, x1, y0 + lob, y1)
    for s in "lr":
        n = max(2, int(F[s].ln / 3.4))
        st = F[s].ln / n
        for i in range(n):
            _wq(M, F[s], st * i + 0.5, st * (i + 1) - 0.5, hl + 0.2, ha - 0.5, T["brick_d"], 0.03)
    _wq(M, F["b"], 1.0, 2.2, 0, 2.2, T["door"], 0.05)
    _wq(M, F["b"], F["b"].ln - 2.2, F["b"].ln - 1.0, 0, 2.2, T["door"], 0.05)
    _vent(S, x0 + w * 0.3, y1 - 2.0, ha + 0.05)
    _vent(S, x0 + w * 0.7, y1 - 2.0, ha + 0.05)
    _bulkhead(S, x0 + w * 0.5, y0 + lob + 2.2, ha + 0.05, w=2.2, d=2.4, h=2.2, wall=T[aud], face="b")
    return hl + 3.6


def _wpictures(S, units, cine=12.0, seed=1, **kw):
    """The picture house in the row, shop-houses beside it."""
    x0, x1, y0, y1 = S.xl + WALL_IN, S.xr - WALL_IN, S.wy0, S.wy1
    tot = cine + sum(u["w"] for u in units)
    k = (x1 - x0) / tot
    lead = [u for u in units if u.get("before")]
    a, top = x0, 0
    for i, u in enumerate(lead):
        uk = {q: v for q, v in u.items() if q not in ("w", "before")}
        top = max(top, _shophouse(S, a, a + u["w"] * k, y0, y1 - 1.0, sides="lr", seed=seed + i * 3, **uk))
        a += u["w"] * k
    top = max(top, _wcinema(S, a, a + cine * k, y0, y1, seed=seed, **kw))
    a += cine * k
    for i, u in enumerate([u for u in units if not u.get("before")]):
        uk = {q: v for q, v in u.items() if q not in ("w", "before")}
        top = max(top, _shophouse(S, a, a + u["w"] * k, y0, y1 - 1.0, sides="lr", seed=seed + 9 + i * 3, **uk))
        a += u["w"] * k
    _wyard(S, seed, extra=False)
    S.body = (S.xl, S.xr, y0, y1, top)


# ------------------------------------------------------------------ the corner

def _wcorner(S, cw=None, floors=2, brick="brick_b", trim="cream", awn="oxblood", sign="green", ink="cream",
             blade="win_sign_red", frame="black", units=(), seed=1, c=2.2, stone=False):
    """The corner of the street wall, the side street on its left: the door set in the cut-off corner under a blade
    sign, display windows down both fronts, rooms upstairs behind sash windows; the row carries on to its right."""
    M, T = S.M, S.T
    xl, xr, y0, y1 = S.xl + 0.16, S.xr - WALL_IN, S.wy0, S.wy1
    tot = (cw or 1.0) + sum(u["w"] for u in units)
    xs = xl + (xr - xl) * (cw or 1.0) / tot
    br, tr = T[brick], T[trim]
    gh, fh = 4.0, 3.2
    h = gh + (floors - 1) * fh + 0.3
    pts = [(xl + c, y0), (xs, y0), (xs, y1), (xl, y1), (xl, y0 + c)]
    poly_prism(M, pts, 0, h, br)
    poly_prism(M, [(xl + c + 0.2, y0 + 0.3), (xs - 0.2, y0 + 0.3), (xs - 0.2, y1 - 0.2), (xl + 0.3, y1 - 0.2), (xl + 0.3, y0 + c + 0.2)], h, h + 0.04, T["tar2"])
    Fs = _poly_faces(pts)
    for i, F in enumerate(Fs):
        p, q = F.p(0, -0.15, 0)[:2], F.p(F.ln, -0.15, 0)[:2]
        bar(M, p, q, 0.3, h, h + (0.35 if i in (1, 2) else 0.6), br)
        if i in (0, 3, 4):
            # (the coping stays inside the lot on the side street's side)
            bar(M, F.p(0.0, -0.13, 0)[:2], F.p(F.ln, -0.13, 0)[:2], 0.5, h + 0.3, h + 0.7, tr)
    front, right, back, left, cut = Fs
    aw = (T[awn], T["cream"]) if awn else None
    if stone:
        # a bank: tall windows between pilasters, no shopfront
        for F, a0, a1 in ((front, 0.2, front.ln - 0.3), (left, 0.3, left.ln - 0.2)):
            n = max(2, int((a1 - a0) / 2.6))
            st = (a1 - a0) / n
            for i in range(n):
                _wq(M, F, a0 + st * i + 0.5, a0 + st * (i + 1) - 0.5, 1.0, gh - 0.5, T["win_office"], 0.05)
                _fbox(M, F, a0 + st * i - 0.18, a0 + st * i + 0.18, 0, 0.1, 0, h, tr)
            _fbox(M, F, a0 + st * n - 0.18, a0 + st * n + 0.18, 0, 0.1, 0, h, tr)
            _fbox(M, F, a0, a1, 0, 0.12, gh - 0.3, gh + 0.05, tr)
    else:
        _shopfront(S, front, 0.1, front.ln - 0.3, 0, gh, T[frame], T[sign], awn=aw, letters=T[ink], seed=seed, door=0.82)
        _shopfront(S, left, left.ln * 0.3, left.ln - 0.1, 0, gh, T[frame], T[sign], awn=None, letters=T[ink], seed=seed + 1, door=0.12)
    # the corner door under its own little canopy, the blade sign over it
    _wq(M, cut, cut.ln / 2 - 0.6, cut.ln / 2 + 0.6, 0, 2.3, T["door_g"], 0.05)
    _wq(M, cut, cut.ln / 2 - 0.4, cut.ln / 2 + 0.4, 0.9, 2.1, T["win_shop"], 0.07)
    _quad(M, [cut.p(0.3, 0.5, 2.8), cut.p(cut.ln - 0.3, 0.5, 2.8), cut.p(cut.ln - 0.1, 0.02, 3.05), cut.p(0.1, 0.02, 3.05)], T[awn or "green"])
    if blade:
        cx, cy = cut.p(cut.ln / 2, 0.0, 0)[:2]
        G = _Face(cx, cy, cut.ux, cut.uy, 1.0)
        _blade(S, G, 0.0, 0.15, min(1.35, c * 0.6), gh + 0.2, h + 1.6, T[blade], letters=T["win_sign_cream"], th=0.3)
    wh = T["win_home"] if not stone else T["win_office"]
    if floors > 1:
        _wins(M, front, 0.3, front.ln - 0.3, gh - 0.75, floors - 1, fh, wh, pitch=2.3, lintel=tr, sillm=tr, wh=1.75)
        _wins(M, left, 0.4, left.ln - 0.3, gh - 0.75, floors - 1, fh, wh, pitch=2.6, lintel=tr, sillm=tr, wh=1.75)
        _wins(M, cut, 0.3, cut.ln - 0.3, gh - 0.75, floors - 1, fh, wh, cols=1, lintel=tr, sillm=tr, wh=1.75)
        _wins(M, back, 0.4, back.ln - 0.4, gh - 0.75, floors - 1, fh, wh, pitch=2.8, ww=1.0)
        _wins(M, right, 0.6, right.ln - 0.6, gh - 0.75, floors - 1, fh, wh, pitch=3.0, ww=1.0)
    _wq(M, back, 1.0, 2.0, 0, 2.15, T["door"], 0.05)
    _chimney(S, xs - 0.6, y0 + (y1 - y0) * 0.6, h, h + 1.8, br, cap=T["tar3"])
    _skylight(S, xl + (xs - xl) * 0.5 - 1.0, xl + (xs - xl) * 0.5 + 1.0, y0 + (y1 - y0) * 0.45, y0 + (y1 - y0) * 0.45 + 2.4, h + 0.04)
    top = h + (1.6 if blade else 0.7)
    a = xs
    for i, u in enumerate(units):
        bw = (xr - xl) * u["w"] / tot
        kw = {k: v for k, v in u.items() if k != "w"}
        top = max(top, _shophouse(S, a, a + bw, y0, y1 - 0.8, sides="lr", seed=seed + 4 + i * 3, **kw))
        a += bw
    _wyard(S, seed)
    S.body = (S.xl, S.xr, y0, y1, top)


# ------------------------------------------------------------------ blocks

def _wblock(S, x0, x1, y0, y1, floors, wall, base=None, trim="cream", gh=4.6, fh=3.6, bay=4.0, win="win_office",
            piers=None, spandrel=None, cornice=None, tar="tar", awn="green", entrance="brass", band=None, par=0.95,
            frame="black", shops=True, escape=True, ghost=None, seed=1, cut=0.0):
    """A commercial block in the street wall: shopfronts under awnings between piers (the office door among them),
    floors of wide windows over spandrel panels, piers running up to a heavy cornice along the front, the side
    walls plain brick with a few windows, the fire escape down the back. `cut`: a cut-off corner on its left, a
    second front down that side (the side street's). Returns (roof height, top)."""
    M, T = S.M, S.T
    wl, tr = T[wall], T[trim]
    h = gh + (floors - 1) * fh
    w = x1 - x0
    if cut:
        pts = [(x0 + cut, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0 + cut)]
        if base:
            poly_prism(M, pts, 0, gh, T[base])
            poly_prism(M, pts, gh, h, wl)
        else:
            poly_prism(M, pts, 0, h, wl)
        poly_prism(M, [(x0 + cut + 0.2, y0 + 0.3), (x1 - 0.28, y0 + 0.3), (x1 - 0.28, y1 - 0.28), (x0 + 0.3, y1 - 0.28), (x0 + 0.3, y0 + cut + 0.2)], h, h + 0.05, T[tar])
        Fs = _poly_faces(pts)
        for i, F in enumerate(Fs):
            bar(M, F.p(0, -0.14, 0)[:2], F.p(F.ln, -0.14, 0)[:2], 0.28, h, h + par, wl)
            bar(M, F.p(0, -0.14, 0)[:2], F.p(F.ln, -0.14, 0)[:2], 0.4, h + par, h + par + 0.12, tr)
        top = h + par + 0.12
        fronts = [Fs[0], Fs[3], Fs[4]]
        sides, back = [Fs[1]], Fs[2]
    else:
        if base:
            box(M, x0, x1, y0, y1, 0, gh, T[base])
            box(M, x0, x1, y0, y1, gh, h, wl)
        else:
            box(M, x0, x1, y0, y1, 0, h, wl)
        top = _roof(S, x0, x1, y0, y1, h, wl, T[tar], cop=tr, par=par)
        F4 = _faces(x0, x1, y0, y1)
        fronts, sides, back = [F4["f"]], [F4["l"], F4["r"]], F4["b"]
    for fi, f in enumerate(fronts):
        main = fi == 0
        diag = cut and fi == 2
        # the cornice and the band over the shops (kept inside the lot's width; no awnings over the side street)
        if diag:
            p, q = f.p(0, 0.0, 0)[:2], f.p(f.ln, 0.0, 0)[:2]
            bar(M, p, q, 0.3, h + 0.2, h + 0.75, T[cornice or trim])
            bar(M, p, q, 0.2, gh - 0.3, gh, T[band or trim])
        else:
            _fbox(M, f, 0, f.ln, 0, 0.14 if not main else 0.34, h + 0.2, h + 0.75, T[cornice or trim])
            _fbox(M, f, 0, f.ln, 0, 0.1, gh - 0.3, gh, T[band or trim])
        n = 1 if diag else max(1, int(f.ln / bay + 0.3))
        st = f.ln / n
        ent = n // 2 if (main and entrance and not cut) else -1
        for i in range(n):
            a = st * i
            if diag:
                _wq(M, f, f.ln / 2 - 0.8, f.ln / 2 + 0.8, 0, 2.6, T[entrance or "brass"], 0.06)
                _wq(M, f, f.ln / 2 - 0.8, f.ln / 2 + 0.8, 2.7, gh - 0.8, T["win_shop"], 0.06)
            elif i == ent:
                _wq(M, f, a + 0.5, a + st - 0.5, 0, gh - 1.3, T["black"], 0.04)
                _wq(M, f, a + st / 2 - 1.2, a + st / 2 + 1.2, 0, 2.5, T[entrance], 0.06)
                _wq(M, f, a + st / 2 - 1.2, a + st / 2 + 1.2, 2.6, gh - 1.4, T["win_shop"], 0.06)
                _fbox(M, f, a + st / 2 - 1.7, a + st / 2 + 1.7, 0, WALL_P, 2.75, 2.98, T[entrance])
            elif shops:
                _wq(M, f, a + 0.45, a + st - 0.45, 0, gh - 1.1, T[frame], 0.04)
                _wq(M, f, a + 0.6, a + st - 0.6, 0.6, gh - 1.25, T["win_shop"], 0.07)
                if awn and main:
                    _awn(M, f, a + 0.4, a + st - 0.4, gh - 1.05, WALL_P, T[awn], T["cream"])
            else:
                _wq(M, f, a + 0.7, a + st - 0.7, 1.1, gh - 0.9, T[win], 0.05)
            for k in range(1, floors):
                z = gh + (k - 1) * fh
                wa0, wa1 = (f.ln / 2 - 0.9, f.ln / 2 + 0.9) if diag else (a + 0.55, a + st - 0.55)
                _wq(M, f, wa0, wa1, z + 0.95, z + fh - 0.55, T[win], 0.05)
                if spandrel:
                    _wq(M, f, wa0, wa1, z + 0.1, z + 0.9, T[spandrel], 0.04)
        if piers and not diag:
            for i in range(n + 1):
                a = min(max(st * i, 0.3), f.ln - 0.3)
                _fbox(M, f, a - 0.3, a + 0.3, 0, 0.12 if not main else 0.2, 0, h + 0.2, T[piers])
    # the side walls: brick, a show window by the front, a few windows above (or an advertisement painted on it)
    for f in sides:
        right = f.nx > 0
        a0 = 0.6 if right else f.ln - 3.4
        _wq(M, f, a0, a0 + 2.8, 0.7, gh - 1.3, T["win_shop"], 0.03)
        if ghost and right == (ghost.get("side", "r") == "r") and floors > 2:
            g0, g1 = f.ln * 0.14, f.ln * 0.86
            _wq(M, f, g0, g1, h - 6.4, h - 0.9, T[ghost.get("ground", "cream")], 0.02)
            _letters(M, f, g0 + 0.5, g1 - 0.5, h - 3.4, h - 1.6, T[ghost.get("ink", "navy")], 0.03, seed, n=5)
            _letters(M, f, g0 + 0.9, g1 - 0.9, h - 5.6, h - 4.2, T[ghost.get("ink", "navy")], 0.03, seed + 1, n=6)
            if floors > 4:
                _wins(M, f, 0.9, f.ln - 0.9, gh, floors - 3, fh, T[win], cols=max(2, int(f.ln / 4.2)), ww=1.2, wh=1.8, sill=1.0, off=0.03)
        else:
            _wins(M, f, 0.9, f.ln - 0.9, gh, floors - 1, fh, T[win], cols=max(2, int(f.ln / 4.2)), ww=1.2, wh=1.8, sill=1.0, off=0.03)
    # the back: plain windows on the yard, the door, the fire escape
    bc = max(2, int(back.ln / 3.4))
    _wins(M, back, 0.6, back.ln - 0.6, gh, floors - 1, fh, T[win], cols=bc, ww=1.4, wh=1.8, sill=1.0)
    _wq(M, back, back.ln * 0.2, back.ln * 0.2 + 1.1, 0, 2.2, T["door"], 0.05)
    if escape and floors > 2:
        _fire_escape(S, back, back.ln * 0.55, back.ln * 0.55 + 2.8, gh - fh, floors, fh, first=1)
    return h, top


def _woffice(S, floors=4, seed=1, tank=False, sign=None, blade=None, bulk=True, skylight=False, cut=0.0, turret=None,
             chim=True, **kw):
    """An office block of the street wall, with what stands on its roof: the lift house, a tank, a sign in lights."""
    M, T = S.M, S.T
    left = 0.16 if cut else WALL_IN
    x0, x1, y0, y1 = S.xl + left, S.xr - WALL_IN, S.wy0, S.wy1
    h, top = _wblock(S, x0, x1, y0, y1, floors, seed=seed, cut=cut, **kw)
    w, d = x1 - x0, y1 - y0
    if bulk:
        _bulkhead(S, x0 + w * 0.3, y1 - 2.4, h + 0.05, w=2.4, d=3.0, h=2.5, wall=T[kw.get("wall", "brick_r")], face="b")
        top = max(top, h + 2.6)
    if tank:
        _tank(S, x0 + w * 0.68, y0 + d * 0.62, h + 0.05, r=min(1.5, w * 0.1 + 0.4), h=2.5, leg=1.5)
        top = max(top, h + 5.2)
    if skylight:
        _skylight(S, x0 + w * 0.5 - 1.6, x0 + w * 0.5 + 1.6, y0 + d * 0.3, y0 + d * 0.3 + 3.0, h + 0.05)
    if sign:
        _roofsign(S, x0 + w * 0.12 + cut, x1 - w * 0.12, y0 + 1.3, h + 0.05, 1.9, T[sign], T["win_sign_cream"], seed=seed + 2, legs=1.5)
        top = max(top, h + 3.5)
    if blade:
        f = _faces(x0 + cut, x1, y0, y1)["f"]
        a = 0.35 if (seed % 2 and not cut) else f.ln - 0.35
        _blade(S, f, a, 0.2, 1.25, kw.get("gh", 4.6) + 0.3, h - 0.4, T[blade], letters=T["win_sign_cream"], th=0.3)
    if turret and cut:
        # the corner carried up a storey under a little roof
        r = cut * 0.7
        cx, cy = x0 + r + 0.2, y0 + r - 0.1
        cyl(M, cx, cy, r, h, h + 3.3, T[kw.get("wall", "brick_r")], n=8)
        cyl(M, cx, cy, r + 0.12, h + 3.3, h + 3.6, T[kw.get("trim", "cream")], n=8)
        cone(M, cx, cy, r + 0.1, h + 3.6, h + 3.6 + r * 1.5, T[turret], n=8)
        top = max(top, h + 3.6 + r * 1.5)
    if chim:
        _chimney(S, x1 - 0.9, y1 - 1.2, h, h + 2.4, T[kw.get("wall", "brick_r")], cap=T["tar3"])
    _vent(S, x0 + w * 0.5, y1 - 1.6, h + 0.05)
    _wyard(S, seed, cans=4)
    S.body = (S.xl, S.xr, y0, y1, top)


def _wstore(S, floors=4, seed=1, marquee="oxblood", blade="win_sign_red", sign="win_sign_red", tower=None, **kw):
    """The department store in the street wall: display windows under awnings the length of its front, the doors
    under a marquee edged in lights, a blade sign and its name on the roof, skylights, a tank; the loading dock on
    the yard."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.xl + WALL_IN, S.xr - WALL_IN, S.wy0, S.wy1
    bay = kw.pop("bay", 4.4)
    h, top = _wblock(S, x0, x1, y0, y1, floors, seed=seed, bay=bay, win="win_shop", entrance="brass", escape=False, **kw)
    w, d = x1 - x0, y1 - y0
    f = _faces(x0, x1, y0, y1)["f"]
    n = max(1, int(w / bay + 0.3))
    st = w / n
    ec = st * (n // 2 + 0.5)
    _fbox(M, f, ec - st * 0.62, ec + st * 0.62, 0, WALL_P, 3.2, 3.85, T[marquee])
    G = _Face(*f.p(ec - st * 0.62, WALL_P, 0)[:2], f.ux, f.uy, st * 1.24)
    _wq(M, G, 0, st * 1.24, 3.2, 3.32, T["win_sign_cream"], 0.0)
    _wq(M, G, 0, st * 1.24, 3.73, 3.85, T["win_sign_cream"], 0.0)
    _letters(M, G, 0.4, st * 1.24 - 0.4, 3.38, 3.68, T["win_sign_cream"], 0.01, seed, n=6)
    if blade:
        _blade(S, f, 0.4 if seed % 2 else w - 0.4, 0.22, 1.25, 4.8, h - 0.3, T[blade], letters=T["win_sign_cream"], th=0.32)
    if sign:
        _roofsign(S, x0 + w * 0.2, x1 - w * 0.2, y0 + 1.3, h + 0.05, 2.0, T[sign], T["win_sign_cream"], seed=seed + 2, legs=1.6)
        top = max(top, h + 3.7)
    if tower:
        # the corner bay carried up a storey under a little copper roof
        cw = st
        cx0 = x0 if seed % 2 == 0 else x1 - cw
        fh = kw.get("fh", 3.6)
        box(M, cx0, cx0 + cw, y0, y0 + cw, h, h + fh + 0.6, T[kw.get("wall", "brick_r")])
        box(M, cx0, cx0 + cw, y0 - 0.2, y0 + cw, h + fh + 0.2, h + fh + 0.65, T[kw.get("trim", "cream")])
        taper(M, (cx0, cx0 + cw, y0 - 0.2, y0 + cw), (cx0 + cw / 2 - 0.2, cx0 + cw / 2 + 0.2, y0 + cw / 2 - 0.3, y0 + cw / 2 + 0.1), h + fh + 0.65, h + fh + 0.65 + cw * 0.5, T[tower])
        C = _faces(cx0, cx0 + cw, y0, y0 + cw)
        for s in "fblr":
            _wq(M, C[s], 0.8, cw - 0.8, h + 1.3, h + fh - 0.3, T["win_shop"], 0.03)
        top = max(top, h + fh + 0.65 + cw * 0.5)
    _skylight(S, x0 + w * 0.3, x0 + w * 0.3 + 4.0, y0 + d * 0.45, y0 + d * 0.45 + 3.0, h + 0.05)
    _skylight(S, x0 + w * 0.62, x0 + w * 0.62 + 4.0, y0 + d * 0.45, y0 + d * 0.45 + 3.0, h + 0.05)
    _tank(S, x1 - 3.4, y1 - 3.2, h + 0.05, r=1.5, h=2.6, leg=1.6)
    _bulkhead(S, x0 + 3.0, y1 - 2.6, h + 0.05, w=2.6, d=3.2, h=2.6, wall=T[kw.get("wall", "brick_r")], face="b")
    top = max(top, h + 5.4)
    _dock(S, x0 + w * 0.5, x0 + w * 0.5 + 6.0, y1, depth=1.6, doors=2)
    _cans(S, x0 + 1.0, y1 + 0.5, 4)
    S.body = (S.xl, S.xr, y0, y1, top)


# ------------------------------------------------------------------ towers

def _wtower(S, tiers=((3, 0, 0), (9, 2.6, 2.2), (4, 2.2, 2.0), (2, 2.0, 1.8)), wall="lime", upper=None, strip="lime3",
            win="win_office", cap="lime2", accent="copper", crown="zig", fh=3.45, bay=3.3, pylons="lime2",
            canopy="brass", base="lime2", awn=None, tars=("tar", "tar2", "tar3"), seed=1, ww=None, gh=5.0, mast=9.0,
            back=0.0, twin=None):
    """A setback tower in the street wall: its podium takes the lot's whole width on the pavement, shop windows and
    the doors under a canopy; the shaft steps back from it and climbs in bays of windows between piers to a crown.
    `back`: the shaft stands this much further back from the street than from the yard."""
    M, T = S.M, S.T
    px0, px1, py0, py1 = S.xl + 0.1, S.xr - 0.1, S.wy0, S.wy1
    x0, x1, y0, y1 = px0, px1, py0, py1
    z = 0
    n = len(tiers)
    for i, (fl, ix, iy) in enumerate(tiers):
        x0, x1, y0, y1 = x0 + ix, x1 - ix, y0 + iy + (back if i == 1 else 0), y1 - iy
        wl = wall if (i < n - 2 or not upper) else upper
        if i == 0:
            z1 = _tier(S, x0, x1, y0, y1, 0, fl, fh, base or wl, win, strip=strip, bay=bay + 0.6, cap=cap, tar=tars[0], gh=gh, shops=True, ww=ww)
            f = _faces(x0, x1, y0, y1)["f"]
            w = x1 - x0
            _wq(M, f, w / 2 - 1.9, w / 2 + 1.9, 0, gh - 0.6, T["black"], 0.08)
            _wq(M, f, w / 2 - 1.5, w / 2 + 1.5, 0, 2.7, T[canopy], 0.1)
            _wq(M, f, w / 2 - 1.5, w / 2 + 1.5, 3.1, gh - 0.9, T["win_sign_cream"], 0.1)
            _fbox(M, f, w / 2 - 2.6, w / 2 + 2.6, 0, WALL_P, 2.8, 3.05, T[canopy])
            if awn:
                nb = max(1, int(w / (bay + 0.6) + 0.2))
                st = w / nb
                for k in range(nb):
                    if abs(st * (k + 0.5) - w / 2) > st * 0.6:
                        _awn(M, f, st * k + 0.5, st * (k + 1) - 0.5, gh - 0.95, WALL_P - 0.1, T[awn], T["cream"])
        else:
            z1 = _tier(S, x0, x1, y0, y1, z, fl, fh, wl, win, strip=strip, bay=bay, cap=cap, tar=tars[i % len(tars)], ww=ww)
            if pylons:
                _pylons(S, x0, x1, y0, y1, z + 0.5, z1 + (1.6 if i < n - 1 else 2.4), T[pylons], t=min(1.1, (x1 - x0) * 0.09))
        z = z1
    if twin:
        fl, tw = twin
        d = y1 - y0
        top = z
        for s in (0, 1):
            ax0 = x0 if s == 0 else x1 - tw
            zt = _tier(S, ax0, ax0 + tw, y0 + d * 0.15, y1 - d * 0.15, z, fl, fh, upper or wall, win, strip=strip, bay=bay, cap=cap, ww=ww)
            top = max(top, _crown(S, ax0, ax0 + tw, y0 + d * 0.15, y1 - d * 0.15, zt, crown, upper or wall, accent, mast=0))
        _tank(S, (x0 + x1) / 2, (y0 + y1) / 2, z, r=1.6, h=2.8, leg=1.6)
    else:
        top = _crown(S, x0, x1, y0, y1, z, crown, upper or wall, accent, mast=mast)
    # what stands on the podium's roof behind the shaft: the lift house, the vents; the dock on the yard
    zb = (gh + (tiers[0][0] - 1) * fh) + 0.74
    if len(tiers) > 1 and tiers[1][2] >= 2.4:
        _bulkhead(S, px0 + (px1 - px0) * 0.3, py1 - tiers[1][2] * 0.5, zb, w=2.4, d=min(2.6, tiers[1][2] - 0.4), h=2.4, wall=T[wall], face="b")
        _vent(S, px0 + (px1 - px0) * 0.6, py1 - tiers[1][2] * 0.5, zb)
        _vent(S, px0 + (px1 - px0) * 0.75, py1 - tiers[1][2] * 0.5, zb)
    if tiers[1][1] >= 2.4:
        _tank(S, px0 + tiers[1][1] * 0.5 + 0.2, py0 + (py1 - py0) * 0.6, zb, r=min(1.2, tiers[1][1] * 0.42), h=2.0, leg=1.2)
    _cans(S, px0 + 1.0, py1 + 0.5, 4)
    if S.yb - py1 > 3.4 and px1 - px0 > 16:
        _dock(S, px0 + (px1 - px0) * 0.55, px0 + (px1 - px0) * 0.55 + 6.0, py1, depth=1.6, doors=2)
    S.body = (S.xl, S.xr, py0, py1, top + (mast if (mast and not twin) else 0) * 0.0)


# ------------------------------------------------------------------ the catalogue

_U = dict  # (a unit of a row)

# highstreet (18 wide): two cells (16 m) and three (24 m) of main street
_wall("highstreet_wa", "highstreet", 2, 1.0, _wrow, depth=12.6, yard=5.2, seed=101, units=[
    _U(w=8.2, floors=2, brick="brick_r", awn="green", sign="cream", ink="oxblood", frame="green", parapet="flat"),
    _U(w=7.7, floors=3, brick="brick_y", awn="navy", sign="navy", ink="cream", frame="navy", parapet="step", chim=False, dd=0.8,
       ghost=dict(side="l", ground="cream", ink="navy"))])
_wall("highstreet_wb", "highstreet", 2, 1.0, _wrow, depth=12.2, yard=5.4, seed=104, units=[
    _U(w=5.5, floors=3, brick="brick_t", awn="oxblood", sign="oxblood", ink="cream", frame="black", parapet="flat", chim=False),
    _U(w=5.0, floors=2, brick="lime", trim="lime2", awn="green", sign="green", ink="cream", frame="door_g", parapet="step", dd=1.2),
    _U(w=5.5, floors=2, brick="brick_d", awn="mustard", sign="cream", ink="navy", frame="navy", parapet="ped", chim=False)])
_wall("highstreet_wc", "highstreet", 2, 1.0, _wrow, depth=13.0, yard=4.8, seed=107, units=[
    _U(w=9.6, floors=2, brick="brick_y", awn="oxblood", sign="oxblood", ink="cream", frame="oxblood", parapet="flat", door=0.3,
       roofsign="win_sign_red"),
    _U(w=6.3, floors=3, brick="brick_r2", awn="navy", sign="cream", ink="navy", frame="black", parapet="flat", chim=False, dd=1.0,
       escape=True, ghost=dict(side="l", ground="white", ink="oxblood"))])
_wall("highstreet_wd", "highstreet", 3, 1.0, _wrow, depth=12.8, yard=5.2, seed=110, units=[
    _U(w=8, floors=3, brick="brick_r", awn="green", sign="green", ink="cream", frame="green", parapet="flat", chim=False,
       ghost=dict(side="r", ground="cream", ink="oxblood")),
    _U(w=8, floors=2, brick="brick_y", awn="oxblood", sign="cream", ink="oxblood", frame="oxblood", parapet="ped", dd=0.9),
    _U(w=8, floors=2, brick="brick_b", awn="navy", sign="navy", ink="cream", frame="navy", parapet="step", chim=False)])
_wall("highstreet_we", "highstreet", 3, 1.0, _wrow, depth=12.4, yard=5.4, seed=114, units=[
    _U(w=6, floors=2, brick="brick_d", awn="mustard", sign="cream", ink="navy", frame="black", parapet="step", chim=False),
    _U(w=6.2, floors=3, brick="lime", trim="lime2", awn="oxblood", sign="oxblood", ink="cream", frame="oxblood", parapet="flat", dd=0.6),
    _U(w=5.6, floors=2, brick="brick_r2", awn="green", sign="green", ink="cream", frame="door_g", parapet="ped", chim=False, dd=1.4),
    _U(w=6.2, floors=3, brick="brick_t", awn="navy", sign="cream", ink="navy", frame="navy", parapet="step", chim=False,
       ghost=dict(side="l", ground="cream", ink="navy"))])
_wall("highstreet_wf", "highstreet", 3, 1.0, _wpictures, depth=15.0, yard=3.6, seed=118, cine=12.4, units=[
    _U(w=5.8, floors=2, brick="brick_r", awn="green", sign="cream", ink="oxblood", frame="green", parapet="flat", chim=False, before=True),
    _U(w=5.8, floors=2, brick="brick_y", awn="navy", sign="navy", ink="cream", frame="navy", parapet="step")])
_wall("highstreet_wg", "highstreet", 3, 1.0, _wrow, depth=12.8, yard=5.0, seed=121, units=[
    _U(w=9, floors=2, brick="lime", trim="lime2", awn="green", sign="green", ink="cream", frame="door_g", parapet="flat", door=0.7, chim=False),
    _U(w=7.4, floors=3, brick="brick_b", awn="oxblood", sign="cream", ink="oxblood", frame="black", parapet="flat", dd=0.7,
       ghost=dict(side="r", ground="cream", ink="navy")),
    _U(w=7.6, floors=1, brick="brick_y", awn="mustard", sign="navy", ink="cream", frame="navy", parapet="step", chim=False, dd=2.0,
       roofsign="win_sign_gold")])
# the corner (the side street on its left), and its right-hand twin
for _n, _m in (("highstreet_wk", False), ("highstreet_wl", True)):
    _wall(_n, "highstreet", 2, 1.0, _wcorner, depth=12.6, yard=5.2, mirror=_m, seed=125, floors=2, brick="brick_b", awn="oxblood",
          sign="green", ink="cream", blade="win_sign_red", cw=10.4, units=[
              _U(w=5.4, floors=2, brick="brick_y", awn="navy", sign="cream", ink="navy", frame="navy", parapet="step", chim=False)])
    _wall(_n.replace("wk", "wm").replace("wl", "wn"), "highstreet", 3, 1.0, _wcorner, depth=12.8, yard=5.0, mirror=_m, seed=129,
          floors=2, brick="lime", trim="lime2", awn=None, blade=None, stone=True, cw=11.0, c=2.6, units=[
              _U(w=6.4, floors=3, brick="brick_r", awn="green", sign="cream", ink="oxblood", frame="green", parapet="flat", chim=False),
              _U(w=6.2, floors=2, brick="brick_t", awn="oxblood", sign="oxblood", ink="cream", frame="black", parapet="ped", chim=False)])

# shop (18 wide): a single cell (8 m), the narrow front that fills the last gap of a row; taller in a town's and a
# city's centre
_wall("shop_wa", "shop", 1, 1.0, _wrow, depth=12.4, yard=5.2, seed=133, units=[
    _U(w=8, floors=2, brick="brick_r", awn="green", sign="cream", ink="oxblood", frame="green", parapet="step")])
_wall("shop_wb", "shop", 1, 1.0, _wrow, depth=12.0, yard=5.4, seed=136, units=[
    _U(w=8, floors=3, brick="brick_y", awn="oxblood", sign="oxblood", ink="cream", frame="black", parapet="flat", chim=False)])
_wall("shop_wc", "shop", 1, 1.0, _wrow, depth=12.6, yard=5.0, seed=139, units=[
    _U(w=8, floors=2, brick="lime", trim="lime2", awn="navy", sign="navy", ink="cream", frame="navy", parapet="ped")])
_wall("shop_wt", "shop", 1, 1.32, _wrow, depth=12.8, yard=5.0, seed=142, units=[
    _U(w=8, floors=4, brick="brick_b", awn="green", sign="cream", ink="navy", frame="black", parapet="flat", escape=True, chim=False)])
_wall("shop_wu", "shop", 1, 1.6, _woffice, depth=13.4, yard=4.8, seed=145, floors=6, wall="lime", base="lime2", trim="lime2",
      piers="lime2", spandrel="lime3", awn="oxblood", bay=3.6, entrance=None, bulk=False, tank=True, chim=False, fh=3.5)

# office (20 wide): the blocks of a town's centre, two cells (16 m) and three (24 m)
_wall("office_wa", "office", 2, 1.0, _woffice, depth=14.4, yard=4.8, seed=151, floors=4, wall="brick_r", base="lime", piers="lime",
      spandrel="brick_d", awn="green", tank=True, ghost=dict(side="r", ground="cream", ink="oxblood"))
_wall("office_wb", "office", 2, 1.0, _woffice, depth=14.8, yard=4.6, seed=154, floors=5, wall="lime", base="lime2", trim="lime2",
      piers="lime2", spandrel="terra", awn="oxblood", sign="win_sign_red", blade="win_sign_red", fh=3.5)
_wall("office_wc", "office", 3, 1.0, _woffice, depth=15.0, yard=4.6, seed=157, floors=5, wall="brick_y", base="lime", piers="lime",
      spandrel="terra", awn="navy", tank=True, skylight=True, ghost=dict(side="l", ground="cream", ink="navy"))
_wall("office_wd", "office", 3, 1.0, _woffice, depth=15.4, yard=4.4, seed=160, floors=4, wall="lime", base="lime2", trim="lime2",
      piers="lime2", spandrel="lime3", awn="green", sign="win_sign_gold", fh=3.9, gh=5.0, bay=4.6, cornice="lime2")
_wall("office_we", "office", 3, 1.0, _woffice, depth=15.0, yard=4.6, seed=163, floors=6, wall="brick_b", base="lime", piers="brick_b",
      spandrel="brick_d", awn="oxblood", tank=True, blade="win_sign_blue", fh=3.5,
      ghost=dict(side="r", ground="white", ink="oxblood"))
for _n, _m in (("office_wk", False), ("office_wl", True)):
    _wall(_n, "office", 3, 1.0, _woffice, depth=15.0, yard=4.6, mirror=_m, seed=167, floors=5, wall="brick_r", base="lime", piers="lime",
          spandrel="terra", awn="green", cut=2.8, turret="copper", tank=True, chim=False)
# (a city's and a metropolis's narrow lots: the same block drawn up taller)
_wall("office_wt", "office", 2, 1.38, _woffice, depth=14.8, yard=4.6, seed=171, floors=7, wall="brick_t", base="lime", piers="lime",
      spandrel="brick_b", awn="navy", tank=True, fh=3.5, cornice="lime")

# store (30 wide): four cells (32 m) of department store
_wall("store_wa", "store", 4, 1.0, _wstore, depth=16.0, yard=4.6, seed=175, floors=4, wall="brick_r", base="lime", piers="lime",
      spandrel="terra", awn="green", fh=3.9)
_wall("store_wb", "store", 4, 1.0, _wstore, depth=16.4, yard=4.4, seed=178, floors=3, wall="brick_y", base="lime", piers="lime",
      spandrel="brick_b", awn="oxblood", sign="win_sign_gold", blade="win_sign_blue", marquee="navy", tower="copper", fh=4.2, bay=4.6)

# tower (30 wide): the office towers of a city's core, on four cells (32 m) and three (24 m)
_wall("tower_wa", "tower", 4, 1.0, _wtower, depth=22.0, yard=5.0, seed=181, tiers=((3, 0, 0), (7, 3.4, 2.6), (3, 2.4, 2.2)),
      wall="brick_y", upper="lime", strip="brick_b", cap="lime", base="lime", crown="lantern", accent="copper", awn="green",
      mast=0, back=1.6)
_wall("tower_wb", "tower", 4, 1.0, _wtower, depth=22.4, yard=4.8, seed=184, tiers=((4, 0, 0), (6, 3.0, 2.4), (3, 3.0, 2.6)),
      wall="brick_r", upper="brick_r", strip="brick_d", cap="lime", base="lime2", crown="zig", accent="green", pylons="lime",
      awn="oxblood", mast=5.0, back=2.0)
_wall("tower_wc", "tower", 3, 1.0, _wtower, depth=16.0, yard=4.0, seed=187, tiers=((3, 0, 0), (8, 2.4, 1.6), (3, 1.8, 1.6)),
      wall="lime", strip="lime3", crown="spire", accent="copper", mast=6.0, bay=3.0, back=1.2)
_wall("tower_wd", "tower", 3, 1.0, _wtower, depth=16.2, yard=3.9, seed=190, tiers=((3, 0, 0), (7, 2.2, 1.6), (2, 2.0, 1.8)),
      wall="brick_t", upper="lime", strip="brick_b", cap="lime", base="lime", crown="zig", accent="green", pylons="lime",
      awn="navy", mast=4.0, bay=3.0, back=1.0)

# glasstower (30 wide): the Deco skyscrapers, the skyline's points
_wall("glasstower_wa", "glasstower", 4, 1.0, _wtower, depth=22.0, yard=5.0, seed=193,
      tiers=((3, 0, 0), (10, 3.6, 2.6), (4, 2.2, 2.0), (2, 2.0, 1.8)), wall="lime", strip="lime3", crown="zig", accent="copper",
      mast=9.0, back=1.8)
_wall("glasstower_wb", "glasstower", 4, 1.0, _wtower, depth=22.4, yard=4.8, seed=196,
      tiers=((4, 0, 0), (9, 3.4, 2.6), (5, 2.4, 2.2), (2, 2.2, 2.0)), wall="brick_y", upper="lime", strip="brick_b", cap="lime",
      base="lime", crown="spire", accent="copper", pylons="lime", awn="navy", mast=10.0, back=2.0)

# a metropolis's towers: taller ones, their floors at their true height
_wall("tower_wt", "tower", 4, 1.4, _wtower, depth=22.4, yard=4.8, seed=199,
      tiers=((4, 0, 0), (11, 3.2, 2.4), (5, 2.4, 2.2), (2, 2.0, 1.8)), wall="brick_y", upper="lime", strip="brick_b", cap="lime",
      base="lime", crown="zig", accent="copper", pylons="lime", awn="oxblood", mast=8.0, back=2.0)
_wall("glasstower_wt", "glasstower", 4, 1.4, _wtower, depth=22.4, yard=4.8, seed=202,
      tiers=((4, 0, 0), (15, 3.6, 2.6), (6, 2.2, 2.0), (3, 2.0, 1.8)), wall="lime", strip="lime3", crown="spire", accent="copper",
      mast=12.0, back=1.8)

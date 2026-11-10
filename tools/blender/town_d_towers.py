# The city's skyline, 1925-1940: Deco setback towers in limestone and brick. Offices step back to a crown and a mast,
# apartment towers to a penthouse and the tank house; never a glass curtain wall. Kit: town_a_kit.py.


def _tier(S, x0, x1, y0, y1, z0, floors, fh, wall, win, strip=None, bay=3.3, ww=None, cap=None, tar="tar", gh=None,
          shops=False, sides="fblr"):
    """One step of a tower: its walls, a strip of dark spandrels up each bay with a window a floor in it, a
    coping, the tar roof of the setback. Returns the top of its walls."""
    M, T = S.M, S.T
    z1 = z0 + (gh or 0) + (floors - (1 if gh else 0)) * fh
    box(M, x0, x1, y0, y1, z0, z1 + 0.25, T[wall])
    box(M, x0 - 0.1, x1 + 0.1, y0 - 0.1, y1 + 0.1, z1 + 0.25, z1 + 0.7, T[cap or wall])
    box(M, x0 + 0.35, x1 - 0.35, y0 + 0.35, y1 - 0.35, z1 + 0.68, z1 + 0.74, T[tar])
    F = _faces(x0, x1, y0, y1)
    for s in sides:
        f = F[s]
        n = max(1, int(f.ln / bay + 0.2))
        st = f.ln / n
        w = ww or st * 0.56
        for i in range(n):
            c = st * (i + 0.5)
            zf = z0
            if gh:
                if shops and s != "b":
                    _wq(M, f, c - st / 2 + 0.5, c + st / 2 - 0.5, z0 + 0.5, z0 + gh - 1.0, T["win_shop"], 0.06)
                else:
                    _wq(M, f, c - w / 2, c + w / 2, z0 + 1.2, z0 + gh - 0.9, T[win], 0.06)
                zf = z0 + gh
            nf = floors - (1 if gh else 0)
            if strip and nf > 0:
                _wq(M, f, c - w / 2 - 0.14, c + w / 2 + 0.14, zf + 0.25, z1 - 0.1, T[strip], 0.04)
            for k in range(nf):
                z = zf + k * fh
                _wq(M, f, c - w / 2, c + w / 2, z + 0.95, z + fh - 0.75, T[win], 0.06)
    return z1 + 0.7


def _pylons(S, x0, x1, y0, y1, z0, z1, m, t=1.0, out=0.14):
    """Piers standing at a tier's corners and rising past its roof."""
    for cx, sx in ((x0, -1), (x1, 1)):
        for cy, sy in ((y0, -1), (y1, 1)):
            ax0, ax1 = (cx - out, cx + t) if sx < 0 else (cx - t, cx + out)
            ay0, ay1 = (cy - out, cy + t) if sy < 0 else (cy - t, cy + out)
            box(S.M, ax0, ax1, ay0, ay1, z0, z1, m)


def _crown(S, x0, x1, y0, y1, z, kind, wall, accent, lit="win_sign_cream", mast=9.0):
    """What a tower ends in. Returns its top (the mast apart)."""
    M, T = S.M, S.T
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, d = x1 - x0, y1 - y0
    if kind == "zig":
        # a ziggurat: two steps, a band of light, a copper cap, the mast and its beacon
        k = min(w, d)
        s1, s2, s3 = k * 0.14, k * 0.26, k * 0.34
        box(M, x0 + s1, x1 - s1, y0 + s1, y1 - s1, z, z + 2.6, T[wall])
        box(M, x0 + s2, x1 - s2, y0 + s2, y1 - s2, z + 2.6, z + 4.6, T[wall])
        box(M, x0 + s2 + 0.25, x1 - s2 - 0.25, y0 + s2 + 0.25, y1 - s2 - 0.25, z + 4.6, z + 5.8, T[lit])
        box(M, x0 + s2 - 0.1, x1 - s2 + 0.1, y0 + s2 - 0.1, y1 - s2 + 0.1, z + 5.8, z + 6.2, T[wall])
        taper(M, (x0 + s2, x1 - s2, y0 + s2, y1 - s2), (cx - 0.3, cx + 0.3, cy - 0.3, cy + 0.3), z + 6.2, z + 6.2 + (k - 2 * s2) * 0.7, T[accent])
        top = z + 6.2 + (k - 2 * s2) * 0.7
    elif kind == "spire":
        k = min(w, d)
        s1 = k * 0.12
        box(M, x0 + s1, x1 - s1, y0 + s1, y1 - s1, z, z + 1.6, T[lit])
        box(M, x0 + s1 - 0.15, x1 - s1 + 0.15, y0 + s1 - 0.15, y1 - s1 + 0.15, z + 1.6, z + 2.0, T[wall])
        taper(M, (x0 + s1, x1 - s1, y0 + s1, y1 - s1), (cx - 0.25, cx + 0.25, cy - 0.25, cy + 0.25), z + 2.0, z + 2.0 + k * 0.95, T[accent])
        top = z + 2.0 + k * 0.95
    elif kind == "lantern":
        r = min(w, d) * 0.3
        cyl(M, cx, cy, r, z, z + 3.4, T[wall], n=8)
        cyl(M, cx, cy, r * 0.86, z + 3.4, z + 4.8, T[lit], n=8)
        cyl(M, cx, cy, r * 0.98, z + 4.8, z + 5.2, T[wall], n=8)
        cone(M, cx, cy, r * 0.98, z + 5.2, z + 5.2 + r * 1.3, T[accent], n=8)
        top = z + 5.2 + r * 1.3
    elif kind == "tank":
        # an apartment tower's top: the penthouse and the tank house under a tiled hip, a chimney
        s1 = min(w, d) * 0.16
        box(M, x0 + s1, x1 - s1, y0 + s1, y1 - s1, z, z + 4.2, T[wall])
        C = _faces(x0 + s1, x1 - s1, y0 + s1, y1 - s1)
        for s in "fblr":
            _wins(M, C[s], 0.6, C[s].ln - 0.6, z, 1, 4.2, T["win_home"], pitch=2.6, ww=1.2, wh=2.0, sill=1.0)
        taper(M, (x0 + s1 - 0.4, x1 - s1 + 0.4, y0 + s1 - 0.4, y1 - s1 + 0.4), (cx - 0.8, cx + 0.8, cy - 0.3, cy + 0.3), z + 4.2, z + 4.2 + min(w, d) * 0.28, T[accent])
        top = z + 4.2 + min(w, d) * 0.28
        box(M, x1 - s1 - 1.3, x1 - s1 - 0.5, cy - 0.4, cy + 0.4, z + 4.2, top + 0.9, T[wall])
        mast = 0
    else:
        top = z
        mast = 0
    if mast:
        box(M, cx - 0.09, cx + 0.09, cy - 0.09, cy + 0.09, top - 0.4, top + mast, T["iron"])
        box(M, cx - 0.2, cx + 0.2, cy - 0.2, cy + 0.2, top + mast, top + mast + 0.4, T["win_sign_red"])
    return top


def _deco_tower(S, nbays=4, tiers=((3, 0, 0), (9, 2.6, 2.2), (4, 2.2, 2.0), (2, 2.0, 1.8)), wall="lime", upper=None,
                strip="lime3", win="win_office", cap="lime2", accent="copper", crown="zig", fh=3.45, bay=3.3,
                yard=6.4, front=2.2, alley=3.4, pylons="lime2", canopy="brass", base="lime2", shops=True, twin=None,
                tars=("tar", "tar2", "tar3"), seed=1, ww=None, gh=5.0, mast=9.0, tandem=False):
    """A setback tower: a stone base of tall windows on the pavement with the doors under a canopy, the shaft
    rising in bays of windows between piers and stepping back as it climbs, corner piers standing past each
    setback, and a crown."""
    M, T = S.M, S.T
    x0, x1, y0, y1 = S.lot(front=front, alley=alley, yard=yard, nbays=nbays, tandem=tandem)
    body = (x0, x1, y0, y1)
    z = 0
    n = len(tiers)
    for i, (fl, ix, iy) in enumerate(tiers):
        x0, x1, y0, y1 = x0 + ix, x1 - ix, y0 + iy, y1 - iy
        wl = wall if (i < n - 2 or not upper) else upper
        if i == 0:
            z1 = _tier(S, x0, x1, y0, y1, 0, fl, fh, base or wl, win, strip=strip, bay=bay + 0.6, cap=cap, tar=tars[0], gh=gh, shops=shops, ww=ww)
            # the doors and the canopy over them
            f = _faces(x0, x1, y0, y1)["f"]
            w = x1 - x0
            _wq(M, f, w / 2 - 1.9, w / 2 + 1.9, 0, gh - 0.6, T["black"], 0.08)
            _wq(M, f, w / 2 - 1.5, w / 2 + 1.5, 0, 2.7, T[canopy], 0.1)
            _wq(M, f, w / 2 - 1.5, w / 2 + 1.5, 3.1, gh - 0.9, T["win_sign_cream"], 0.1)
            _fbox(M, f, w / 2 - 2.6, w / 2 + 2.6, 0, 1.9, 2.8, 3.05, T[canopy])
        else:
            z1 = _tier(S, x0, x1, y0, y1, z, fl, fh, wl, win, strip=strip, bay=bay, cap=cap, tar=tars[i % len(tars)], ww=ww)
            if pylons and i >= 1:
                _pylons(S, x0, x1, y0, y1, z + 0.5, z1 + (1.6 if i < n - 1 else 2.4), T[pylons], t=min(1.1, (x1 - x0) * 0.09))
        z = z1
    top = z
    if twin:
        # two towers on the block's shoulders instead of one crown
        fl, tw = twin
        d = y1 - y0
        for s in (0, 1):
            ax0 = x0 if s == 0 else x1 - tw
            zt = _tier(S, ax0, ax0 + tw, y0 + d * 0.15, y1 - d * 0.15, z, fl, fh, upper or wall, win, strip=strip, bay=bay, cap=cap, ww=ww)
            top = _crown(S, ax0, ax0 + tw, y0 + d * 0.15, y1 - d * 0.15, zt, crown, upper or wall, accent, mast=0)
        _tank(S, (x0 + x1) / 2, (y0 + y1) / 2, z, r=1.6, h=2.8, leg=1.6)
    else:
        top = _crown(S, x0, x1, y0, y1, z, crown, upper or wall, accent, mast=mast)
    # what stands on the setbacks: a tank behind the shaft, a bulkhead, vents
    bx0, bx1, by0, by1 = body
    t0 = tiers[0]
    zb = (gh + (t0[0] - 1) * fh) + 0.74
    if len(tiers) > 1 and tiers[1][2] >= 1.8:
        _bulkhead(S, bx0 + (bx1 - bx0) * 0.3, by1 - tiers[1][2] * 0.5, zb, w=2.4, d=min(2.6, tiers[1][2] - 0.4), h=2.4, wall=T[wall], face="b")
        _vent(S, bx0 + (bx1 - bx0) * 0.6, by1 - tiers[1][2] * 0.5, zb)
        _vent(S, bx0 + (bx1 - bx0) * 0.75, by1 - tiers[1][2] * 0.5, zb)
    _cans(S, bx0 + 1.0, by1 + 0.5, 4)
    if yard > 5:
        _dock(S, bx0 + (bx1 - bx0) * 0.55, bx0 + (bx1 - bx0) * 0.55 + 6.0, by1, depth=1.6, doors=2)
    S.body = (bx0, bx1, by0, by1, top)


# ------------------------------------------------------------------ the catalogue

# tower (30 x 30): the office building of ten storeys; tall, fifteen
_town("tower", "tower", 0.967, 1.0, 4, _deco_tower, tiers=((2, 0, 0), (5, 2.4, 2.0), (2, 2.4, 2.2)), wall="brick_y", upper="lime",
      strip="brick_b", cap="lime", base="lime", crown="lantern", accent="copper", mast=0, seed=71)
_town("tower_b", "tower", 0.967, 1.0, 4, _deco_tower, tiers=((2, 0, 0), (5, 1.8, 1.6), (2, 3.2, 2.6)), wall="brick_r", upper="brick_r",
      strip="brick_d", cap="lime", base="lime2", crown="zig", accent="green", pylons="lime", mast=5.0, seed=72)
_town("tower_t", "tower", 0.967, 1.5, 4, _deco_tower, tiers=((3, 0, 0), (7, 2.6, 2.2), (2, 2.4, 2.2), (1, 2.0, 1.8)), wall="lime",
      strip="lime3", crown="zig", accent="copper", mast=5.0, seed=73)
_town("tower_u", "tower", 0.967, 1.5, 4, _deco_tower, tiers=((3, 0, 0), (7, 3.0, 2.4), (3, 2.2, 2.0)), wall="brick_t", upper="lime",
      strip="brick_b", cap="lime", base="lime", crown="spire", accent="green", pylons="lime", seed=74)

# glasstower (30 x 30): the Deco skyscraper, the skyline's point
_town("glasstower", "glasstower", 0.967, 1.15, 4, _deco_tower, tiers=((3, 0, 0), (9, 3.0, 2.4), (4, 2.2, 2.0), (2, 2.0, 1.8)),
      wall="lime", strip="lime3", crown="zig", accent="copper", mast=9.0, seed=75)
_town("glasstower_c", "glasstower", 0.967, 1.15, 4, _deco_tower, tiers=((3, 0, 0), (8, 2.8, 2.4), (5, 2.4, 2.2), (2, 2.2, 2.0)),
      wall="brick_y", upper="lime", strip="brick_b", cap="lime", base="lime", crown="spire", accent="copper", pylons="lime", mast=10.0, seed=76)
_town("glasstower_b", "glasstower", 0.967, 0.78, 4, _deco_tower, tiers=((3, 0, 0), (7, 2.8, 2.4), (3, 2.4, 2.2), (1, 2.2, 2.0)),
      wall="lime2", strip="black", cap="lime", crown="lantern", accent="green", mast=7.0, seed=77)
_town("glasstower_m", "glasstower", 0.7, 1.0, 2, _deco_tower, tiers=((2, 0, 0), (7, 1.6, 1.3), (3, 1.6, 1.4), (1, 1.4, 1.2)),
      wall="lime", strip="lime3", crown="zig", accent="copper", yard=6.2, alley=3.2, front=1.9, bay=3.0, mast=8.0, seed=78)

# aptower (30 x 30): the apartment tower
_town("aptower", "aptower", 0.967, 1.0, 4, _deco_tower, tiers=((2, 0, 0), (8, 2.2, 2.0), (3, 2.2, 2.0)), wall="brick_r",
      upper="brick_r", strip=None, win="win_home", cap="lime", base="lime", crown="tank", accent="tile", pylons="lime",
      fh=3.15, bay=2.9, ww=1.3, shops=False, gh=4.2, canopy="green", seed=81)
_town("aptower_b", "aptower", 0.967, 1.0, 4, _deco_tower, tiers=((2, 0, 0), (8, 1.6, 2.0)), wall="brick_y", upper="lime",
      strip=None, win="win_home", cap="lime", base="lime2", crown="spire", accent="copper", pylons=None, twin=(4, 7.5),
      fh=3.15, bay=2.9, ww=1.3, shops=False, gh=4.2, canopy="oxblood", seed=82)
_town("aptower_m", "aptower", 0.7, 1.0, 2, _deco_tower, tiers=((2, 0, 0), (8, 1.4, 1.2), (2, 1.5, 1.3)), wall="brick_b",
      upper="brick_b", strip=None, win="win_home", cap="cream", base="lime", crown="tank", accent="slate", pylons="cream",
      fh=3.15, bay=2.8, ww=1.3, shops=False, gh=4.2, yard=6.2, alley=3.2, front=1.9, canopy="green", seed=83)

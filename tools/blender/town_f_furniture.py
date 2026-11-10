# What stands along the country roads of 1930 (src/render/furniture.ts places them): the telegraph line and the
# billboards a town puts out to meet the traffic coming in.
#
# The pole stands at its own foot, its crossarms across X, the wires running along Y. The wire is one span of the
# line a metre long, from its origin towards -Y (the game's +z): the game stretches it from one pole to the next, and
# its sag, set here in metres of height, stays what it is. A billboard stands at the middle of its hoarding, the
# poster facing -Y; its poster is win_sign_* (render/models.ts), so it shows at night as under its own lamps.

# where the wires hang on a pole: (x, z) of each insulator's top
_TP_WIRES = ((-0.93, 8.02), (-0.45, 8.02), (0.45, 8.02), (0.93, 8.02), (-0.72, 7.34), (0.72, 7.34))
_TP_Y = -0.11


def b_telegraphpole(M, P):
    """A telegraph pole: a creosoted pine pole a little over eight metres tall, two crossarms bolted to its face on
    iron braces, glass insulators along them."""
    L = Lot(2.1, 0.34)
    L.bays = []
    pole, arm, glass, iron = mat("tp_pole", "#54402f"), mat("tp_arm", "#6d5642"), mat("tp_glass", "#a5c9ba"), P["lp_iron"]
    revolve(M, 0, 0, [(0.17, 0.0), (0.115, 8.3), (0.0, 8.38)], pole, n=6, rot=math.pi / 6)
    for z, hw in ((7.72, 1.05), (7.04, 0.84)):
        box(M, -hw, hw, -0.17, -0.05, z, z + 0.13, arm)
        for s in (-1, 1):
            _beam(M, (s * hw * 0.58, -0.19, z + 0.03), (0.0, -0.19, z - 0.52), 0.05, 0.05, iron)
    for x, z in _TP_WIRES:
        box(M, x - 0.05, x + 0.05, _TP_Y - 0.05, _TP_Y + 0.05, z - 0.17, z, glass)
    return L


def b_telegraphwire(M, P):
    """One span of the telegraph line, a metre long (the game stretches it pole to pole): six wires, each sagging
    half a metre between its insulators."""
    L = Lot(1.94, 1.0)
    L.bays = []
    bm, idx = M.bm, M.mi(mat("tp_wire", "#2c2724"))
    n, w = 5, 0.075
    for x, z0 in _TP_WIRES:
        sag = 0.5 if z0 > 7.6 else 0.56
        rings = []
        for k in range(n + 1):
            u = k / n
            z = z0 - sag * 4 * u * (1 - u)
            rings.append([bm.verts.new((x - w / 2, -u, z - w * 0.4)), bm.verts.new((x + w / 2, -u, z - w * 0.4)),
                          bm.verts.new((x, -u, z + w * 0.5))])
        fs = [bm.faces.new(rings[0]), bm.faces.new(rings[-1][::-1])]
        for a, b in zip(rings, rings[1:]):
            for i in range(3):
                j = (i + 1) % 3
                fs.append(bm.faces.new((a[i], a[j], b[j], b[i])))
        for f in fs:
            f.material_index = idx
        bmesh.ops.recalc_face_normals(bm, faces=fs)
    return L


# ------------------------------------------------------------------ billboards

_BB_W, _BB_H, _BB_Z = 7.2, 3.0, 1.75   # the poster: width, height, its foot above the ground
_BB_Y = -0.13                          # the hoarding's face
_BB_YB = 0.43                          # its other face: a second poster, for the traffic going the other way


def _bb_mats():
    return {k: mat("win_sign_bb_" + k, v) for k, v in {
        "cream": "#efe4c2", "ox": "#8a2f2b", "navy": "#2b4059", "mustard": "#d3a23c", "green": "#2c5f55",
        "black": "#2a2a2c", "sky": "#9fc0c4", "orange": "#cf7a3c", "brick": "#a9553f", "white": "#f4efe2",
    }.items()}


class _Poster:
    """The poster's sheet: x from 0 at its left edge, z from 0 at its foot, each layer a hair proud of the last."""

    def __init__(self, M, back=False):
        self.M, self.C, self.back = M, _bb_mats(), back

    def pt(self, x, z, layer):
        if self.back:
            return (_BB_W / 2 - x, _BB_YB + 0.02 + 0.022 * layer, _BB_Z + z)
        return (x - _BB_W / 2, _BB_Y - 0.02 - 0.022 * layer, _BB_Z + z)

    def rect(self, x0, x1, z0, z1, c, layer=1):
        _quad(self.M, [self.pt(x0, z0, layer), self.pt(x1, z0, layer), self.pt(x1, z1, layer), self.pt(x0, z1, layer)], self.C[c])

    def poly(self, pts, c, layer=1):
        """A flat shape, its points anticlockwise as the poster is read."""
        _quad(self.M, [self.pt(x, z, layer) for x, z in pts], self.C[c])

    def disc(self, cx, cz, r, c, layer=1, n=12, a0=0.0, a1=2 * math.pi):
        full = a1 - a0 > 2 * math.pi - 1e-6
        m = n if full else n + 1
        pts = [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cz + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(m)]
        self.poly(pts, c, layer)

    def word(self, text, x0, z0, h, c, layer=2, gap=0.24, wide=0.72):
        """Block capitals as a sign painter cuts them: each letter of straight strokes."""
        w, t = h * wide, h * 0.22
        x = x0
        for ch in text:
            if ch == " ":
                x += w * 0.6
                continue
            R = lambda a0, a1, b0, b1: self.rect(x + a0, x + a1, z0 + b0, z0 + b1, c, layer)
            lw = w
            if ch == "I":
                lw = t
                R(0, t, 0, h)
            elif ch == "L":
                R(0, t, 0, h), R(t, w, 0, t)
            elif ch == "C":
                R(0, t, 0, h), R(t, w, 0, t), R(t, w, h - t, h)
            elif ch == "O":
                R(0, t, 0, h), R(w - t, w, 0, h), R(t, w - t, 0, t), R(t, w - t, h - t, h)
            elif ch == "A":
                R(0, t, 0, h), R(w - t, w, 0, h), R(t, w - t, h - t, h), R(t, w - t, h * 0.36, h * 0.36 + t)
            elif ch == "E":
                R(0, t, 0, h), R(t, w, 0, t), R(t, w, h - t, h), R(t, w * 0.82, (h - t) / 2, (h + t) / 2)
            elif ch == "T":
                R(0, w, h - t, h), R((w - t) / 2, (w + t) / 2, 0, h - t)
            elif ch == "S":
                R(0, w, 0, t), R(0, w, (h - t) / 2, (h + t) / 2), R(0, w, h - t, h)
                R(0, t, (h + t) / 2, h - t), R(w - t, w, t, (h - t) / 2)
            elif ch == "U":
                R(0, t, 0, h), R(w - t, w, 0, h), R(t, w - t, 0, t)
            elif ch == "P":
                R(0, t, 0, h), R(t, w, h - t, h), R(w - t, w, h * 0.45 + t, h - t), R(t, w, h * 0.45, h * 0.45 + t)
            elif ch == "R":
                R(0, t, 0, h), R(t, w, h - t, h), R(w - t, w, h * 0.45 + t, h - t), R(t, w, h * 0.45, h * 0.45 + t)
                R(w - t, w, 0, h * 0.45)
            x += lw + gap * h
        return x


def _hoarding(M, P, lamps=3):
    """The hoarding the posters are pasted to, one on each face: two boarded panels in painted frames either side of
    four timber posts, knee braces at its ends, a lattice apron under each, a stepped head and gooseneck lamps over
    both."""
    T = _td()
    hw, z0, z1 = _BB_W / 2 + 0.18, _BB_Z - 0.18, _BB_Z + _BB_H + 0.18
    frame, wood, iron = T["green"], T["board"], P["lp_iron"]
    box(M, -hw, hw, _BB_Y, 0.02, z0, z1, frame)
    box(M, -hw, hw, 0.28, _BB_YB, z0, z1, frame)
    # the head: a stepped crest in the middle, a cap along the top
    box(M, -hw - 0.08, hw + 0.08, _BB_Y - 0.06, _BB_YB + 0.06, z1, z1 + 0.14, T["cream"])
    box(M, -1.5, 1.5, _BB_Y - 0.03, _BB_YB + 0.03, z1 + 0.14, z1 + 0.42, frame)
    box(M, -0.8, 0.8, _BB_Y - 0.03, _BB_YB + 0.03, z1 + 0.42, z1 + 0.62, T["cream"])
    # the posts between the two faces, a knee brace out each way from the end ones
    for i, x in enumerate((-3.3, -1.1, 1.1, 3.3)):
        box(M, x - 0.1, x + 0.1, 0.04, 0.26, 0, z1 - 0.2, wood)
        if i in (0, 3):
            _beam(M, (x, 0.0, z0 - 0.15), (x, -0.95, 0.08), 0.14, 0.14, T["wood"])
            _beam(M, (x, 0.3, z0 - 0.15), (x, 1.25, 0.08), 0.14, 0.14, T["wood"])
    # the aprons: lattice painted green, as a field of slats on the side the traffic into town comes by
    az0, az1 = 0.55, z0 - 0.04
    box(M, -hw + 0.1, hw - 0.1, _BB_Y + 0.05, -0.02, az0, az1, T["door_g"])
    box(M, -hw + 0.1, hw - 0.1, 0.32, _BB_YB - 0.05, az0, az1, T["door_g"])
    n = 9
    for i in range(n):
        xa = -hw + 0.25 + (2 * hw - 0.5) * i / n
        xb = xa + (2 * hw - 0.5) / n
        _quad(M, [(xa, _BB_Y + 0.03, az0 + 0.08), ((xa + xb) / 2 - 0.05, _BB_Y + 0.03, az0 + 0.08),
                  (xb - 0.05, _BB_Y + 0.03, az1 - 0.08), ((xa + xb) / 2, _BB_Y + 0.03, az1 - 0.08)], frame)
    # the lamps over each poster
    lit = mat("win_sign_cream", "#f0e6c4")
    for face, y0, sg in ((0, _BB_Y, -1), (1, _BB_YB, 1)):
        nl = lamps if face == 0 else lamps - 1
        for k in range(nl):
            x = (k - (nl - 1) / 2) * (2.6 if face == 0 else 3.6)
            ya, yb = sorted((y0 + sg * 0.7, y0))
            box(M, x - 0.03, x + 0.03, ya, yb, z1 + 0.2, z1 + 0.26, iron)
            ya, yb = sorted((y0 + sg * 0.94, y0 + sg * 0.56))
            yc, yd = sorted((y0 + sg * 0.82, y0 + sg * 0.68))
            taper(M, (x - 0.19, x + 0.19, ya, yb), (x - 0.07, x + 0.07, yc, yd), z1 + 0.02, z1 + 0.2, iron)
            ya, yb = sorted((y0 + sg * 0.62, y0 + sg * 0.88))
            _quad(M, [(x - 0.13, yb, z1 + 0.015), (x + 0.13, yb, z1 + 0.015), (x + 0.13, ya, z1 + 0.015), (x - 0.13, ya, z1 + 0.015)], lit)
    L = Lot(2 * hw + 0.16, 2.44)
    L.bays = []
    return L


def b_billboard_a(M, P):
    """The road company's own: the road running to the sun between green hills, in the travel posters' manner."""
    L = _hoarding(M, P)
    S = _Poster(M)
    W, H = _BB_W, _BB_H
    S.rect(0, W, 0, H, "mustard", 0)
    S.disc(W / 2, 1.0, 1.6, "orange", 1, n=12, a0=0, a1=math.pi)
    S.disc(W / 2, 1.0, 1.05, "cream", 2, n=10, a0=0, a1=math.pi)
    # rays
    for a in (0.22, 0.56, 0.9, math.pi - 0.9, math.pi - 0.56, math.pi - 0.22):
        c, s = math.cos(a), math.sin(a)
        r0, r1 = 1.8, min(3.35, (H - 0.6 - 1.0) / s)
        S.poly([(W / 2 + c * r0 + s * 0.07, 1.0 + s * r0 - c * 0.07), (W / 2 + c * r1 + s * 0.16, 1.0 + s * r1 - c * 0.16),
                (W / 2 + c * r1 - s * 0.16, 1.0 + s * r1 + c * 0.16), (W / 2 + c * r0 - s * 0.07, 1.0 + s * r0 + c * 0.07)], "cream", 1)
    # the hills and the road
    S.poly([(0, 0), (W, 0), (W, 0.75), (W * 0.78, 1.18), (W * 0.58, 1.0), (W * 0.42, 1.0), (W * 0.2, 1.3), (0, 0.9)], "green", 3)
    S.poly([(W / 2 - 1.5, 0), (W / 2 + 1.5, 0), (W / 2 + 0.16, 1.0), (W / 2 - 0.16, 1.0)], "black", 4)
    S.poly([(W / 2 - 0.12, 0.05), (W / 2 + 0.12, 0.05), (W / 2 + 0.04, 0.42), (W / 2 - 0.04, 0.42)], "cream", 5)
    S.poly([(W / 2 - 0.035, 0.55), (W / 2 + 0.035, 0.55), (W / 2 + 0.015, 0.8), (W / 2 - 0.015, 0.8)], "cream", 5)
    # the band along the top
    S.rect(0, W, H - 0.5, H, "ox", 6)
    S.rect(0.3, 1.9, H - 0.34, H - 0.16, "cream", 7)
    S.rect(W - 1.9, W - 0.3, H - 0.34, H - 0.16, "cream", 7)
    S.disc(W / 2, H - 0.25, 0.14, "mustard", 7, n=8)
    # the other face: the diner down the road
    B = _Poster(M, back=True)
    B.rect(0, W, 0, H, "cream", 0)
    B.rect(0, W, 0, 0.42, "ox", 1)
    B.rect(0, W, H - 0.14, H, "ox", 1)
    B.disc(1.45, 1.62, 0.95, "mustard", 1, n=12)
    B.disc(1.45, 1.62, 0.6, "white", 2, n=10)
    x = B.word("EAT", 2.95, 1.0, 1.3, "ox", 2)
    B.rect(2.95, x - 0.3, 0.64, 0.78, "navy", 2)
    B.word("ROAST PIES TEA", 2.97, 2.5, 0.22, "navy", 2)
    return L


def b_billboard_b(M, P):
    """A soda: the bottle on a cream sun, COLA in letters a metre high."""
    L = _hoarding(M, P)
    S = _Poster(M)
    W, H = _BB_W, _BB_H
    S.rect(0, W, 0, H, "ox", 0)
    S.rect(0, W, 0, 0.3, "cream", 1)
    S.rect(0, W, H - 0.16, H, "cream", 1)
    S.disc(1.55, 1.55, 1.12, "cream", 1, n=14)
    # the bottle: body, shoulder, neck, cap, label
    S.poly([(1.27, 0.62), (1.83, 0.62), (1.83, 1.55), (1.66, 1.95), (1.66, 2.42), (1.44, 2.42), (1.44, 1.95), (1.27, 1.55)], "green", 2)
    S.rect(1.42, 1.68, 2.42, 2.52, "mustard", 2)
    S.rect(1.27, 1.83, 0.95, 1.35, "white", 3)
    S.rect(1.27, 1.83, 1.1, 1.2, "ox", 4)
    x = S.word("COLA", 2.95, 0.98, 1.05, "cream", 2)
    S.rect(2.95, x - 0.25, 0.6, 0.76, "mustard", 2)
    S.word("ICE", 2.98, 2.36, 0.34, "mustard", 2)
    S.disc(W - 0.62, 2.5, 0.3, "mustard", 2, n=8)
    # the other face: the coal and ice dealer
    B = _Poster(M, back=True)
    B.rect(0, W, 0, H, "mustard", 0)
    B.rect(0, W, 0, 0.2, "black", 1)
    B.rect(0, W, H - 0.2, H, "black", 1)
    B.word("COAL", 0.45, 0.85, 1.25, "black", 2)
    B.poly([(5.05, 0.2), (W, 0.2), (W, H - 0.2), (5.45, H - 0.2)], "navy", 1)
    B.word("ICE", 5.72, 1.3, 0.62, "white", 2, wide=0.6)
    B.rect(5.72, W - 0.3, 1.02, 1.12, "sky", 2)
    return L


def b_billboard_c(M, P):
    """Motor oil: a tyre and a can on navy, OIL across a cream bar."""
    L = _hoarding(M, P)
    S = _Poster(M)
    W, H = _BB_W, _BB_H
    S.rect(0, W, 0, H, "navy", 0)
    S.poly([(0, 0), (2.6, 0), (4.1, H), (0, H)], "cream", 1)
    S.word("OIL", 0.4, 1.05, 1.3, "navy", 2, wide=0.7)
    S.rect(0.4, 2.55, 0.62, 0.8, "ox", 2)
    S.word("PURE", 0.42, 2.5, 0.3, "ox", 2)
    # the tyre
    S.disc(5.45, 1.5, 1.2, "black", 2, n=14)
    S.disc(5.45, 1.5, 0.7, "cream", 3, n=12)
    S.disc(5.45, 1.5, 0.3, "black", 4, n=8)
    # the mustard flash
    S.poly([(3.2, 0.3), (4.3, 0.3), (4.75, 0.62), (3.42, 0.62)], "mustard", 2)
    S.poly([(3.95, 2.3), (4.35, 2.3), (4.2, 2.72), (3.8, 2.72)], "mustard", 2)
    # the other face: the tyre shop
    B = _Poster(M, back=True)
    B.rect(0, W, 0, H, "green", 0)
    B.rect(0, W, 0, 0.34, "cream", 1)
    B.disc(1.4, 1.62, 1.05, "black", 1, n=14)
    B.disc(1.4, 1.62, 0.6, "green", 2, n=10)
    x = B.word("TIRES", 2.85, 1.1, 1.05, "cream", 2, wide=0.66)
    B.rect(2.85, x - 0.25, 0.72, 0.86, "mustard", 2)
    B.word("REPAIRS", 2.87, 2.42, 0.28, "mustard", 2)
    return L


BUILDINGS["telegraphpole"] = (b_telegraphpole, 2.1, 0.34, 0)
BUILDINGS["telegraphwire"] = (b_telegraphwire, 1.94, 1.0, 0)
for _n, _f in (("billboard_a", b_billboard_a), ("billboard_b", b_billboard_b), ("billboard_c", b_billboard_c)):
    BUILDINGS[_n] = (_f, _BB_W + 0.52, 2.44, 0)
POST_ORIGIN.update(("telegraphpole", "telegraphwire", "billboard_a", "billboard_b", "billboard_c"))

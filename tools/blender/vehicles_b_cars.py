# The townspeople's cars, the delivery van, the Motor Works' streamliner, the town bus and the convoy's pilot car
# (see vehicles_a_kit.py for what a vehicle model is). Each keeps the footprint, origin, front and axles of the model
# it replaces: the sim drives a length, not a shape.


def pv_car_far(F, style, h, hw, bw, rad, cowl, tail, zs, belt, roof, paint, wings):
    """A car at a few pixels: its wings as one slab, the bonnet, the body, the glass and the roof."""
    F.box(wings, -hw, hw, -h + 0.1, h - 0.1, 0.14, 0.52)
    F.taper(paint, (-0.36, 0.36, rad, cowl), (-0.44, 0.44, rad + 0.05, cowl), 0.52, 1.14)
    F.box(paint, -bw, bw, cowl, tail, 0.52, belt)
    if style in ("sedan", "coupe", "van", "streamliner"):
        y1 = {"sedan": 1.4, "coupe": 0.62, "van": tail, "streamliner": 1.2}[style]
        F.taper("glass", (-bw + 0.02, bw - 0.02, cowl + 0.04, y1), (-bw + 0.1, bw - 0.1, cowl + 0.2, y1 - 0.12), belt, roof - 0.09)
        top = {"sedan": paint, "coupe": "canvas", "van": "cloth", "streamliner": paint}[style]
        F.taper(top, (-bw + 0.03, bw - 0.03, cowl + 0.1, y1), (-bw + 0.16, bw - 0.16, cowl + 0.3, y1 - 0.17), roof - 0.09, roof)


def pv_car(style, L=4.4, W=1.85, fa=-1.38, ra=1.36, r=0.36, paint="body", wings="second"):
    """A car of about 1930 on separate wings and running boards, an upright radiator between two lamps on stalks:
    `sedan` (four doors, a fabric roof, the spare on the back), `coupe` (a short cabin and a long sloping tail),
    `tourer` (open, the hood folded behind the seats, a spare in each front wing) or `pickup` (a cab and a wooden
    bed with something in it)."""
    def fn(Ms, P):
        K = PV(Ms["model"])
        h, hw = L / 2, W / 2
        rad = -h + 0.34
        cowl = -0.42 if style == "coupe" else -0.62
        bw = hw - 0.225
        zs, belt, roof = 0.40, 1.04, 1.68
        tail = {"sedan": 1.62, "coupe": 2.0, "tourer": 1.86, "pickup": 0.4}[style]
        pv_pan(K, wings, [fa, ra], r, hw)
        K.wheels(fa, r, hw - 0.04)
        K.wheels(ra, r, hw - 0.04)
        K.box("chrome", -hw + 0.05, hw - 0.05, -h, -h + 0.07, 0.42, 0.56)
        K.box("chrome", -hw + 0.05, hw - 0.05, h - 0.07, h, 0.42, 0.56)
        pv_radiator(K, rad, 0.33, 0.50, 1.14)
        pv_lamps(K, 0.56, rad - 0.1, 0.9)
        pv_hood(K, paint, rad + 0.12, cowl, 0.34, 0.5, 0.45, 1.10, 1.16)
        K.pair("tail", hw - 0.2, hw - 0.08, h - 0.24, h - 0.17, 0.52, 0.66)
        if style == "sedan":
            K.px(paint, [(cowl, zs), (tail, zs), (tail, belt - 0.14), (tail - 0.14, belt), (cowl, belt)], -bw, bw)
            K.taper("glass", (-bw + 0.02, bw - 0.02, cowl + 0.04, 1.42), (-bw + 0.1, bw - 0.1, cowl + 0.2, 1.3), belt, roof - 0.09)
            K.taper(paint, (-bw + 0.03, bw - 0.03, cowl + 0.1, 1.42), (-bw + 0.16, bw - 0.16, cowl + 0.3, 1.25), roof - 0.09, roof)
            K.box(wings, -bw + 0.24, bw - 0.24, cowl + 0.42, 1.14, roof, roof + 0.02)                  # the fabric insert
            K.box("black", -bw + 0.08, bw - 0.08, cowl - 0.05, cowl + 0.16, roof - 0.2, roof - 0.14)   # visor
            K.tube("tyre", tail + 0.02, tail + 0.22, 0.33, 0.33, 0.82, n=8)                           # the spare
            K.tube("chrome", tail + 0.22, tail + 0.25, 0.17, 0.17, 0.82, n=4)
        elif style == "coupe":
            K.px(paint, [(cowl, zs), (tail, zs), (tail, 0.74), (0.72, belt), (cowl, belt)], -bw, bw)
            K.taper("glass", (-bw + 0.02, bw - 0.02, cowl + 0.04, 0.62), (-bw + 0.1, bw - 0.1, cowl + 0.2, 0.5), belt, roof - 0.13)
            K.taper("canvas", (-bw + 0.03, bw - 0.03, cowl + 0.1, 0.62), (-bw + 0.16, bw - 0.16, cowl + 0.3, 0.45), roof - 0.13, roof - 0.04)   # a soft top
            K.box("black", -bw + 0.08, bw - 0.08, cowl - 0.05, cowl + 0.16, roof - 0.24, roof - 0.18)
            K.tube("tyre", tail - 0.06, tail + 0.12, 0.33, 0.33, 0.86, n=8)
            K.tube("chrome", tail + 0.12, tail + 0.15, 0.17, 0.17, 0.86, n=4)
        elif style == "tourer":
            zt = belt - 0.06
            K.px(paint, [(cowl, zs), (tail, zs), (tail, zt - 0.12), (tail - 0.14, zt), (cowl, zt)], -bw, bw)
            K.box("tan", -bw + 0.09, bw - 0.09, cowl + 0.3, 1.42, zt, zt + 0.02)                      # the open tub
            K.box("tan", -bw + 0.12, bw - 0.12, 0.05, 0.4, zt, zt + 0.2)                             # seats
            K.box("tan", -bw + 0.12, bw - 0.12, 1.0, 1.36, zt, zt + 0.2)
            K.box("glass", -bw + 0.04, bw - 0.04, cowl + 0.14, cowl + 0.19, zt, zt + 0.42)           # the screen
            K.box("canvas", -bw - 0.02, bw + 0.02, 1.42, 1.84, zt - 0.02, zt + 0.2)                  # the folded hood
            K.drum("tyre", cowl - 0.36, 0.84, 0.33, -bw - 0.02, bw + 0.02)                           # a spare in each wing
            K.drum("chrome", cowl - 0.36, 0.84, 0.13, -bw - 0.04, bw + 0.04, n=6)
        else:   # pickup
            K.px(paint, [(cowl, zs), (tail, zs), (tail, belt), (cowl, belt)], -bw, bw)
            K.taper("glass", (-bw + 0.02, bw - 0.02, cowl + 0.04, tail), (-bw + 0.1, bw - 0.1, cowl + 0.2, tail - 0.04), belt, roof - 0.13)
            K.taper(wings, (-bw + 0.03, bw - 0.03, cowl + 0.1, tail + 0.04), (-bw + 0.16, bw - 0.16, cowl + 0.3, tail - 0.06), roof - 0.13, roof - 0.04)
            K.box(paint, -bw + 0.01, bw - 0.01, tail - 0.1, tail + 0.01, belt, roof - 0.13)          # the cab's back
            y0, y1, zf = tail + 0.04, h - 0.1, 0.6
            K.box("wood2", -bw - 0.04, bw + 0.04, y0, y1, zs + 0.06, zf)                             # the bed
            K.pair("wood", bw - 0.03, bw + 0.04, y0, y1, zf, zf + 0.42)
            K.box("wood", -bw + 0.03, bw - 0.03, y0, y0 + 0.07, zf, zf + 0.5)
            K.box("wood", -bw + 0.03, bw - 0.03, y1 - 0.07, y1, zf, zf + 0.36)
            K.box("canvas", -bw + 0.12, 0.1, y0 + 0.16, y0 + 0.95, zf, zf + 0.5)                     # sacks
            K.box("wood2", 0.0, bw - 0.12, y0 + 0.75, y1 - 0.2, zf, zf + 0.34)                       # a crate
        if "far" in Ms:
            F = PV(Ms["far"])
            pv_car_far(F, style, h, hw, bw, rad, cowl, tail if style != "pickup" else h - 0.1, zs,
                       belt if style not in ("pickup",) else 0.95, roof, paint, wings)
            if style == "pickup":
                F.taper("glass", (-bw + 0.02, bw - 0.02, cowl + 0.04, tail), (-bw + 0.1, bw - 0.1, cowl + 0.2, tail - 0.04), 0.95, roof - 0.13)
                F.box(wings, -bw + 0.1, bw - 0.1, cowl + 0.2, tail - 0.04, roof - 0.13, roof - 0.04)
    return fn


def pv_escort_car(Ms, P):
    """The pilot and escort car of an oversized-load convoy (4.6 m): a saloon in the company's colour (`body`) on
    black wings, a lettered board across its roof with an amber lamp at each end, a red flag on each front wing."""
    pv_car("sedan", L=4.6, W=1.9, fa=-1.3, ra=1.3, paint="body", wings="black")(Ms, P)
    K = PV(Ms["model"])
    K.box("cream", -0.86, 0.86, 0.3, 0.42, 1.68, 2.02)
    K.box("black", -0.72, 0.72, 0.29, 0.43, 1.78, 1.92)
    for x in (-0.84, 0.84):                                                                            # a red flag on each front wing
        K.box("black", x - 0.015, x + 0.015, -1.62, -1.59, 0.7, 1.42)
        K.box("flag", x - 0.02, x + 0.02, -1.59, -1.2, 1.1, 1.42)
    for x in (-0.76, 0.76):
        cyl(K.M, x, 0.36, 0.1, 2.02, 2.18, pv_mat("beacon"), n=6)


def pv_van(Ms, P):
    """A tradesman's delivery van (5 m): the car's front, a tall panelled body with a lettered board down each side
    and a fabric roof, two small windows in the back doors."""
    K = PV(Ms["model"])
    L, W, fa, ra, r = 5.0, 2.0, -1.65, 1.6, 0.38
    h, hw = L / 2, W / 2
    rad, cowl, bw = -h + 0.34, -0.98, hw - 0.17
    zs, belt, top = 0.42, 1.18, 2.0
    tail = h - 0.1
    pv_pan(K, "second", [fa, ra], r, hw)
    K.wheels(fa, r, hw - 0.04)
    K.wheels(ra, r, hw - 0.04)
    K.box("chrome", -hw + 0.05, hw - 0.05, -h, -h + 0.07, 0.42, 0.58)
    K.box("chrome", -hw + 0.05, hw - 0.05, h - 0.07, h, 0.42, 0.58)
    pv_radiator(K, rad, 0.35, 0.52, 1.24)
    pv_lamps(K, 0.6, rad - 0.1, 0.96)
    pv_hood(K, "body", rad + 0.12, cowl, 0.36, 0.52, 0.47, 1.2, 1.26)
    K.box("body", -bw, bw, cowl, -0.2, zs, belt)                                                       # the cab
    K.taper("glass", (-bw + 0.02, bw - 0.02, cowl + 0.04, -0.2), (-bw + 0.08, bw - 0.08, cowl + 0.2, -0.2), belt, top - 0.12)
    K.box("body", -bw, bw, -0.2, tail, zs, top - 0.12)                                                 # the body
    K.py("cloth", [(-bw - 0.02, top - 0.12), (bw + 0.02, top - 0.12), (bw - 0.16, top + 0.04), (-bw + 0.16, top + 0.04)],
         cowl + 0.02, tail + 0.03)                                                                     # the roof
    K.box("black", -bw + 0.08, bw - 0.08, cowl - 0.07, cowl + 0.1, top - 0.24, top - 0.18)            # visor
    K.box("cream", -bw - 0.015, bw + 0.015, 0.05, tail - 0.3, 1.1, 1.62)                               # lettered boards
    K.box("black", -bw - 0.02, bw + 0.02, 0.3, tail - 0.55, 1.27, 1.45)
    K.pair("glass", 0.1, 0.6, tail, tail + 0.02, 1.2, 1.64)                                            # back doors
    K.pair("tail", hw - 0.2, hw - 0.08, h - 0.2, h - 0.13, 0.54, 0.68)
    if "far" in Ms:
        F = PV(Ms["far"])
        F.box("second", -hw, hw, -h + 0.1, h - 0.1, 0.14, 0.54)
        F.taper("body", (-0.38, 0.38, rad, cowl), (-0.46, 0.46, rad + 0.05, cowl), 0.54, 1.24)
        F.box("body", -bw, bw, cowl, tail, 0.54, top - 0.12)
        F.box("cloth", -bw + 0.1, bw - 0.1, cowl + 0.1, tail, top - 0.12, top + 0.04)
        F.box("cream", -bw - 0.015, bw + 0.015, 0.05, tail - 0.3, 1.1, 1.62)


def pv_streamliner(Ms, P):
    """A Motor Works car (4.9 m): the streamlined saloon of the late thirties, all one paint (`second` is the same
    paint a shade deeper, for the wings): full wings with the lamps set into them, a narrow bright prow the bonnet
    runs out to, a steel roof falling to the tail in one line, a bright spear down each side."""
    K = PV(Ms["model"])
    L, W, fa, ra, r = 4.92, 1.84, -1.55, 1.6, 0.36
    h, hw = L / 2, W / 2
    rad, cowl, bw = -h + 0.3, -0.72, hw - 0.17
    zs, belt, roof = 0.36, 1.0, 1.55
    pv_pan(K, "second", [fa, ra], r, hw, zb=0.44, t=0.12, nose=0.3, tail=0.3, sweep=0.7)
    K.wheels(fa, r, hw - 0.04)
    K.wheels(ra, r, hw - 0.04)
    K.box("chrome", -hw + 0.04, hw - 0.04, -h, -h + 0.07, 0.36, 0.5)
    K.box("chrome", -hw + 0.04, hw - 0.04, h - 0.07, h, 0.36, 0.5)
    K.box("chrome", -0.13, 0.13, rad, rad + 0.16, 0.48, 1.12)                                          # the prow
    pv_hood(K, "body", rad + 0.12, cowl, 0.2, 0.56, 0.45, 1.1, 1.2, c=0.12)
    K.pair("lamp", 0.5, 0.74, fa - 0.6, fa - 0.5, 0.62, 0.84)
    K.px("body", [(cowl, zs), (h - 0.16, zs), (h - 0.16, 0.7), (1.3, belt + 0.04), (cowl, belt + 0.04)], -bw, bw)
    K.taper("glass", (-bw + 0.03, bw - 0.03, cowl + 0.05, 1.0), (-bw + 0.18, bw - 0.18, cowl + 0.45, 0.8), belt + 0.04, roof - 0.07)
    K.taper("body", (-bw + 0.07, bw - 0.07, cowl + 0.22, 0.86), (-bw + 0.22, bw - 0.22, cowl + 0.52, 0.8), roof - 0.2, roof)
    # the fastback: the roof runs down to the tail in one line, a small window in it
    K.px("body", [(0.7, belt), (h - 0.2, 0.68), (h - 0.2, 0.76), (0.8, roof), (0.7, roof)], -bw + 0.16, bw - 0.16)
    K.box("glass", -0.3, 0.3, 1.02, 1.3, 1.3, 1.36)
    K.box("chrome", -bw - 0.012, bw + 0.012, cowl, 1.1, 0.86, 0.91)                                    # the spear
    K.pair("tail", hw - 0.24, hw - 0.1, h - 0.2, h - 0.14, 0.56, 0.7)
    if "far" in Ms:
        F = PV(Ms["far"])
        F.box("second", -hw, hw, -h + 0.1, h - 0.1, 0.14, 0.6)
        F.taper("body", (-0.24, 0.24, rad, cowl), (-0.5, 0.5, rad + 0.1, cowl), 0.6, 1.14)
        F.box("body", -bw, bw, cowl, h - 0.16, 0.6, belt)
        F.taper("glass", (-bw + 0.03, bw - 0.03, cowl + 0.05, 1.6), (-bw + 0.18, bw - 0.18, cowl + 0.45, 0.62), belt, roof - 0.07)
        F.box("body", -bw + 0.2, bw - 0.2, cowl + 0.5, 0.64, roof - 0.07, roof)


def pv_slab8(K, mn, hw, y0, y1, c, z0, z1, hw1=None, y01=None, y11=None, c1=None):
    """A slab with its four corners cut (a coach's rounded ends, seen from above); the top can differ from the
    foot: hw1, y01, y11, c1."""
    ring = lambda w, a, b, k, z: [(-w + k, a, z), (w - k, a, z), (w, a + k, z), (w, b - k, z), (w - k, b, z),
                                  (-w + k, b, z), (-w, b - k, z), (-w, a + k, z)]
    K.loft(mn, ring(hw, y0, y1, c, z0),
           ring(hw if hw1 is None else hw1, y0 if y01 is None else y01, y1 if y11 is None else y11, c if c1 is None else c1, z1))


def pv_bus(Ms, P):
    """The town bus (12 m), a bonneted coach of about 1930: the truck's front (radiator, big lamps, black wings), a
    long body with a row of separate windows, rounded at the back, a clerestory down the roof, luggage on the rack
    behind it and the destination board over the screen. `body` (the panels, the pillars and the roof) wears its
    line's colour, `second` is the cream of its waistband and cantrail. (The front axle stands under the bonnet now, 0.95 m ahead of where the
    forward-control bus had it; the rear one is where it was.)"""
    K = PV(Ms["model"])
    L, W, r = 12.17, 2.575, 0.5
    h, hw = L / 2, W / 2
    bw = hw - 0.05
    fa, ra = -4.85, 3.2
    rad, cowl = -h + 0.3, -4.2
    y1 = h - 0.08
    K.box("chrome", -hw + 0.08, hw - 0.08, -h, -h + 0.08, 0.5, 0.68)
    pv_radiator(K, rad, 0.44, 0.62, 1.62)
    pv_lamps(K, 0.82, rad - 0.08, 1.22, s=0.3, deep=0.22)
    pv_hood(K, "body", rad + 0.12, cowl, 0.46, 0.66, 0.6, 1.6, 1.7, c=0.14)
    pv_pan(K, "black", [fa], r, hw, zb=0.58, step_to=cowl + 1.0, nose=0.28)
    K.wheels(fa, r, hw - 0.05)
    K.wheels(ra, r, hw - 0.015)
    pv_slab8(K, "body", bw, cowl, y1, 0.34, 0.5, 1.42, c1=0.34)                                         # the panels
    pv_slab8(K, "second", bw + 0.012, cowl, y1, 0.34, 1.24, 1.42)                                      # the waistband
    pv_slab8(K, "glass", bw - 0.03, cowl + 0.03, y1 - 0.03, 0.34, 1.42, 2.3)                           # the windows
    n = 8
    for i in range(n):                                                                                 # pillars
        y = cowl + 0.9 + (y1 - 0.95 - cowl - 0.9) * i / (n - 1)
        K.box("body", -bw, bw, y, y + 0.34, 1.42, 2.3)
    pv_slab8(K, "second", bw, cowl, y1, 0.34, 2.3, 2.48)                                               # the cantrail
    pv_slab8(K, "body", bw, cowl, y1, 0.34, 2.48, 2.68, hw1=bw - 0.32, y01=cowl + 0.3, y11=y1 - 0.4)   # the roof
    yc = 1.7                                                                                           # the clerestory
    K.box("glass", -0.4, 0.4, cowl + 1.2, yc, 2.66, 2.88)
    K.taper("body", (-0.5, 0.5, cowl + 1.05, yc + 0.12), (-0.34, 0.34, cowl + 1.2, yc), 2.88, 2.98)
    K.pair("black", 0.74, 0.8, yc + 0.5, y1 - 0.7, 2.66, 2.86)                                         # the luggage rail
    K.box("tan", -0.6, 0.1, yc + 0.7, yc + 1.7, 2.66, 3.0)                                             # trunks
    K.box("wood2", -0.1, 0.62, yc + 1.5, yc + 2.5, 2.66, 2.94)
    K.box("canvas", -0.55, 0.3, yc + 2.6, y1 - 0.9, 2.66, 2.9)
    K.box("cream", -0.62, 0.62, cowl - 0.06, cowl + 0.1, 2.36, 2.74)                                   # destination board
    K.box("black", -0.5, 0.5, cowl - 0.07, cowl - 0.06, 2.44, 2.66)
    K.box("black", -hw + 0.02, -bw + 0.01, cowl + 0.3, cowl + 1.05, 0.58, 2.24)                        # the door (kerb side)
    K.pair("black", bw - 0.02, bw + 0.02, ra - 0.68, ra + 0.68, 0.5, 1.14)                             # rear wheel arches
    K.box("chrome", -bw + 0.2, bw - 0.2, h - 0.08, h, 0.5, 0.66)
    K.pair("tail", bw - 0.5, bw - 0.34, y1, y1 + 0.03, 1.0, 1.16)
    K.tube("tyre", y1 - 0.04, y1 + 0.02, 0.44, 0.44, 1.0, n=8)                                         # the spare, on the back
    K.tube("chrome", y1 + 0.02, y1 + 0.05, 0.2, 0.2, 1.0, n=4)


VEHICLES.update({
    "car": (pv_car("sedan"), ("model", "far"), (1.85, 4.4, None)),
    "car_coupe": (pv_car("coupe"), ("model", "far"), (1.85, 4.4, None)),
    "car_tourer": (pv_car("tourer"), ("model", "far"), (1.85, 4.4, None)),
    "car_pickup": (pv_car("pickup"), ("model", "far"), (1.85, 4.4, None)),
    "van": (pv_van, ("model", "far"), (2.0, 5.0, None)),
    "motorcar": (pv_streamliner, ("model", "far"), (1.84, 4.92, None)),
    "bus": (pv_bus, ("model",), (2.575, 12.17, None)),
    "escort_car": (pv_escort_car, ("model",), (1.9, 4.6, None)),
})

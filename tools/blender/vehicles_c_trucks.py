# The company's lorries of 1925-1940 (see vehicles_a_kit.py for what a vehicle model is): a long bonnet behind an
# upright radiator, black wings, a separate cab, and behind it the body for what is carried. `body` is the company's
# colour (bonnet, cab, the panels of the body), `second` its lettering colour (the cab roof, the crest on the doors,
# the band down the body, a reefer's roof), `cargo` the load, or the tilt or tank over it.
#
# Three classes (src/game/trucks.ts), each visibly heavier: the light lorry on two axles, the heavy rigid on four
# (twin steering axles under a longer bonnet and a deeper cab, a tandem behind), and the road train: a tractor and
# two trailers. Lengths, origins and axle places are the old models' (the sim articulates by them); only the light
# lorry's rear tandem became one axle, at the tandem's middle.

PV_CLASS = {
    #         length  wheel   steer axles           wings' half width, radiator half width, bonnet top
    "light": dict(L=8.5, r=0.5, steer=[-3.35], hwf=1.2, rhw=0.42, bt=1.74, zc=0.95,
                  cowl=-2.4, back=-1.0, chw=0.98, belt=1.72, roof=2.6, rear=[2.55], zf=1.05, top=2.85),
    "heavy": dict(L=12.0, r=0.54, steer=[-4.85, -3.2], hwf=1.35, rhw=0.5, bt=2.02, zc=1.05,
                  cowl=-3.72, back=-2.0, chw=1.12, belt=2.0, roof=2.98, rear=[3.35, 4.6], zf=1.15, top=3.3),
    "rt": dict(L=6.4, r=0.54, steer=[-1.9], hwf=1.35, rhw=0.52, bt=2.06, zc=1.05,
               cowl=-1.12, back=0.5, chw=1.14, belt=2.02, roof=3.04, rear=[1.35, 2.55]),
    "ll": dict(L=6.6, r=0.56, steer=[-2.0], hwf=1.32, rhw=0.54, bt=2.1, zc=1.08,
               cowl=-1.2, back=0.34, chw=1.14, belt=2.06, roof=3.08, rear=[0.75, 1.85]),
}


def pv_cab(K, y0, y1, hw, zf, belt, roof, paint="body", ink="second"):
    """A lorry's cab: doors with the company's crest, glass round the front, a solid back, the roof in the
    lettering colour, a visor over the screen."""
    K.box(paint, -hw, hw, y0, y1, zf, belt)
    K.taper("glass", (-hw + 0.02, hw - 0.02, y0 + 0.03, y1 - 0.34), (-hw + 0.1, hw - 0.1, y0 + 0.2, y1 - 0.34), belt, roof - 0.12)
    K.box(paint, -hw + 0.01, hw - 0.01, y1 - 0.34, y1, belt, roof - 0.12)
    K.taper(ink, (-hw - 0.02, hw + 0.02, y0 + 0.08, y1 + 0.03), (-hw + 0.14, hw - 0.14, y0 + 0.26, y1 - 0.1), roof - 0.12, roof)
    K.box("black", -hw + 0.06, hw - 0.06, y0 - 0.1, y0 + 0.1, roof - 0.26, roof - 0.2)
    K.box(ink, -hw - 0.012, hw + 0.012, y0 + 0.4, y0 + 0.86, zf + 0.26, belt - 0.16)


def pv_truck_front(K, c, paint="body", ink="second", board=True):
    """Everything ahead of the body: bumper, radiator and lamps, the bonnet, the wings over the steering axle(s)
    running back as the cab's step, their wheels, the cab. Returns where the cab ends. The heavy classes (big
    wheels) wear the lettering colour down the bonnet's hinge and, with `board`, a lettered headboard over the cab:
    what tells them from a light lorry from above."""
    yf, r, hwf, zc = -c["L"] / 2, c["r"], c["hwf"], c["zc"]
    rad, cowl, back = yf + 0.3, c["cowl"], c["back"]
    K.box("black", -hwf + 0.1, hwf - 0.1, yf, yf + 0.1, zc - 0.5, zc - 0.26)
    pv_radiator(K, rad, c["rhw"], zc - 0.2, c["bt"] + 0.04)
    pv_lamps(K, c["rhw"] + 0.32, rad - 0.08, zc + 0.44, s=0.3 if r > 0.5 else 0.26)
    pv_hood(K, paint, rad + 0.12, cowl, c["rhw"] - 0.02, c["rhw"] + 0.16, zc - 0.15, c["bt"], c["bt"] + 0.08, c=0.12)
    pv_pan(K, "black", c["steer"], r, hwf, zb=zc - 0.3, step_to=back - 0.15, nose=0.26)
    for a in c["steer"]:
        K.wheels(a, r, hwf - 0.05)
    pv_cab(K, cowl, back, c["chw"], zc - 0.1, c["belt"], c["roof"], paint, ink)
    if r > 0.52:
        ring = lambda y, z: [(-0.11, y, z - 0.03), (0.11, y, z - 0.03), (0.11, y, z + 0.035), (-0.11, y, z + 0.035)]
        K.loft(ink, ring(rad + 0.16, c["bt"]), ring(cowl - 0.03, c["bt"] + 0.08))
        if board:
            K.box(ink, -c["chw"] + 0.08, c["chw"] - 0.08, cowl + 0.16, cowl + 0.3, c["roof"] - 0.04, c["roof"] + 0.36)
            K.box("black", -c["chw"] + 0.26, c["chw"] - 0.26, cowl + 0.15, cowl + 0.31, c["roof"] + 0.09, c["roof"] + 0.25)
    return back


def pv_deck_car(K, yc, z):
    """A new car riding a transporter's deck (the batch's paint is the tinted cargo)."""
    K.box("black", -0.78, 0.78, yc - 1.75, yc + 1.75, z, z + 0.4)
    K.taper("cargo", (-0.36, 0.36, yc - 1.55, yc - 0.5), (-0.4, 0.4, yc - 1.5, yc - 0.5), z + 0.4, z + 0.86)
    K.box("cargo", -0.6, 0.6, yc - 0.5, yc + 1.4, z + 0.4, z + 0.86)
    K.taper("cargo", (-0.58, 0.58, yc - 0.45, yc + 1.2), (-0.48, 0.48, yc - 0.28, yc + 1.05), z + 0.86, z + 1.3)


def pv_body(K, kind, y0, y1, zf, top, half, guard=False):
    """A freight body from y0 (its front) to y1 on a floor at zf, about `top` high and `half` wide at its widest:
    `truck` (a panelled van body under a tilt), `tipper` (a steel tub and the heap in it), `tanker`, `flatbed`
    (a staked platform and the stacks on it), `reefer` (a coach-built insulated van, iced through the roof) or
    `carrier` (two decks of new cars)."""
    ln = y1 - y0
    if kind == "truck":
        hw, zr = half - 0.03, top - 0.72
        K.box("body", -hw, hw, y0, y1 - 0.03, zf, zr)
        K.box("second", -hw - 0.015, hw + 0.015, y0 + 0.35, y1 - 0.4, zf + (zr - zf) * 0.4, zf + (zr - zf) * 0.74)
        # the tilt: canvas drawn over hoops (a valance down each side, rounded over the top) and roped at each hoop
        g = 0.014
        tilt = lambda e: [(-half + g - e, zr), (half - g + e, zr), (half - g + e, zr + 0.3), (hw * 0.68 + e, top - 0.12 + e),
                          (0.0, top + e), (-hw * 0.68 - e, top - 0.12 + e), (-half + g - e, zr + 0.3)]
        ya = y0 - (0.03 if guard else 0.0)
        K.py("cargo", tilt(0.0), ya, y1)
        n = max(2, int(ln / 2.0))
        for i in range(n + 1):
            y = ya + 0.14 + (y1 - ya - 0.38) * i / n
            K.py("wood2", tilt(g), y, y + 0.1)
        K.box("black", -0.025, 0.025, y1 - 0.03, y1 - 0.015, zf + 0.08, zr - 0.08)                    # the doors' meeting
    elif kind == "tipper":
        zt = zf + (top - zf) * 0.56
        K.box("frame", -half + 0.1, half - 0.1, y0, y1, zf - 0.02, zf + 0.1)
        K.pair("body", half - 0.14, half - 0.04, y0, y1, zf, zt)
        K.pair("second", half - 0.17, half - 0.01, y0, y1, zt - 0.02, zt + 0.08)                       # the top rail
        zh = top if guard else zt + 0.44
        K.box("body", -half + 0.04, half - 0.04, y0, y0 + 0.14, zf, zh)                                # headboard
        if guard:
            K.box("body", -half + 0.12, half - 0.12, y0 - 0.55, y0 + 0.02, zh - 0.1, zh)               # over the cab
        K.box("body", -half + 0.04, half - 0.04, y1 - 0.12, y1, zf, zt - 0.06)                         # tailgate
        n = max(2, int(ln / 1.7))
        for i in range(1, n):
            y = y0 + ln * i / n
            K.pair("black", half - 0.05, half, y - 0.07, y + 0.07, zf, zt - 0.02)
        ya, yb = y0 + 0.14, y1 - 0.12
        K.box("steel", -half + 0.14, half - 0.14, ya, yb, zf + 0.1, zf + 0.14)                         # the floor, scoured bright:
        k = max(1, int(round(ln / 3.0)))                                                               # an empty one shows it
        for i in range(k):
            a, b = ya + (yb - ya) * i / k, ya + (yb - ya) * (i + 1) / k
            m = (a + b) / 2 + (0.2 if i % 2 else -0.2)
            K.taper("cargo", (-half + 0.14, half - 0.14, a, b), (-half * 0.16, half * 0.16, m - 0.3, m + 0.3),
                    zt - 0.16, zt + (0.78 if i % 2 == 0 else 0.6))
    elif kind == "tanker":
        rx = half - 0.02
        rz = (top - zf) / 2 - 0.12
        cz = zf + 0.14 + rz
        K.tube("cargo", y0 + 0.32, y1 - 0.32, rx, rz, cz, n=10)
        K.tube("cargo", y0, y0 + 0.32, rx * 0.7, rz * 0.7, cz, n=10, rx1=rx, rz1=rz)
        K.tube("cargo", y1 - 0.32, y1, rx, rz, cz, n=10, rx1=rx * 0.7, rz1=rz * 0.7)
        for y in (y0 + ln * 0.3, y0 + ln * 0.7):                                                       # lettering bands
            K.tube("second", y - 0.16, y + 0.16, rx + 0.02, rz + 0.02, cz, n=10)
        K.box("frame", -0.2, 0.2, y0 + 0.5, y1 - 0.5, cz + rz - 0.02, cz + rz + 0.06)                  # the catwalk
        n = max(2, int(ln / 2.6))
        for i in range(n):
            cyl(K.M, 0.0, y0 + 1.0 + (ln - 2.0) * i / max(1, n - 1), 0.27, cz + rz + 0.06, cz + rz + 0.2, pv_mat("chrome"), n=6)
        for y in (y0 + 0.7, y1 - 0.7):                                                                 # cradles
            K.box("frame", -rx * 0.8, rx * 0.8, y - 0.12, y + 0.12, zf - 0.08, cz - rz * 0.55)
        K.box("body", -rx * 0.7, rx * 0.7, y1 - 0.26, y1 - 0.02, zf - 0.1, zf + 0.34)                  # the valve box
    elif kind == "reefer":
        # a coach-built insulated van, iced through the roof: cream panels over a dado in the company's colour, its
        # lettering colour over the whole roof (no other body has that from above), the dairy's band between
        hw = half - 0.022
        yb = y0 + 0.02
        zd = zf + (top - zf) * 0.36
        K.box("cream", -hw, hw, yb, y1 - 0.02, zf, top - 0.16)
        K.box("body", -hw - 0.012, hw + 0.012, yb - 0.01, y1 - 0.01, zf, zd)                           # the dado
        K.box("cargo", -hw - 0.022, hw + 0.022, yb + 0.25, y1 - 0.25, zd, zd + 0.2)                    # the dairy's band
        for y in (yb - 0.01, y1 - 0.11):                                                               # corner posts
            K.box("body", -hw - 0.012, hw + 0.012, y, y + 0.1, zd, top - 0.15)
        K.py("second", [(-hw - 0.02, top - 0.16), (hw + 0.02, top - 0.16), (hw - 0.26, top), (-hw + 0.26, top)], yb - 0.02, y1)
        for y in (yb + ln * 0.2, yb + ln * 0.64):                                                      # ice hatches
            K.box("frame", -0.36, 0.36, y, y + 0.6, top, top + 0.07)
        K.box("black", -0.02, 0.02, y1 - 0.02, y1 - 0.008, zd + 0.06, top - 0.26)                      # the doors' meeting
        for z in (zd + 0.34, top - 0.5):                                                               # strap hinges
            K.pair("black", 0.14, hw - 0.12, y1 - 0.02, y1 - 0.006, z, z + 0.07)
    elif kind == "carrier":
        zu = zf + 1.5
        K.box("frame", -half + 0.06, half - 0.06, y0, y1, zf - 0.02, zf + 0.1)
        K.box("frame", -half + 0.06, half - 0.06, y0 + 0.2, y1, zu - 0.08, zu)
        K.box("body", -half + 0.06, half - 0.06, y0, y0 + 0.14, zf, zu + 0.9)
        n = max(2, int(ln / 2.6))
        for i in range(n + 1):
            y = y0 + 0.08 + (ln - 0.16) * i / n
            K.pair("body", half - 0.14, half, y - 0.07, y + 0.07, zf, zu + 0.5)
        K.pair("second", half - 0.11, half - 0.03, y0 + 0.2, y1, zu + 0.38, zu + 0.5)
        k = max(1, int((ln - 0.3) / 3.7))
        step = (ln - 0.3) / k
        for z in (zf + 0.1, zu):
            for i in range(k):
                pv_deck_car(K, y0 + 0.3 + step * (i + 0.5), z)
    else:   # flatbed
        zd = zf + 0.14
        K.box("wood2", -half, half, y0, y1, zf, zd)
        K.box("body", -half + 0.04, half - 0.04, y0, y0 + 0.12, zd, zd + 1.3)
        K.box("second", -half + 0.04, half - 0.04, y0 - 0.01, y0 + 0.13, zd + 1.0, zd + 1.3)
        n = max(3, int(ln / 1.5))
        for i in range(n + 1):
            y = y0 + 0.5 + (ln - 0.7) * i / n
            K.pair("wood", half - 0.09, half - 0.01, y - 0.06, y + 0.06, zd, zd + 0.85)
        K.pair("wood", half - 0.07, half - 0.03, y0 + 0.12, y1 - 0.1, zd + 0.42, zd + 0.56)
        # the load in stacks along the deck, a gap between, each on a bearer that stays on the empty deck
        k = max(2, int(ln / 2.3))
        ya, yb = y0 + 0.3, y1 - 0.28
        for i in range(k):
            a = ya + (yb - ya) * i / k + 0.1
            b = ya + (yb - ya) * (i + 1) / k - 0.1
            K.box("wood", -half + 0.16, half - 0.16, (a + b) / 2 - 0.09, (a + b) / 2 + 0.09, zd, zd + 0.07)
            K.box("cargo", -half + 0.22, half - 0.22, a, b, zd + 0.07, zd + 0.64)
            if i % 2 == 0:
                K.box("cargo", -half + 0.48, half - 0.48, a + 0.12, b - 0.12, zd + 0.64, zd + 1.14)
            else:
                K.box("cargo", -half + 0.3, half - 0.3, a + 0.3, b - 0.06, zd + 0.64, zd + 0.92)


def pv_rear(K, y, hw, z=0.55):
    """The back of a frame: a bar across and a red lamp at each end of it."""
    K.box("black", -hw, hw, y - 0.08, y, z, z + 0.2)
    K.pair("tail", hw - 0.22, hw - 0.06, y - 0.02, y + 0.0, z + 0.22, z + 0.36)


def pv_rigid(kind, cls, W, BW):
    """A rigid lorry of a class with the body for what it carries: W wide at its widest, its body BW."""
    def fn(Ms, P):
        K = PV(Ms["model"])
        c = PV_CLASS[cls]
        h = c["L"] / 2
        back = pv_truck_front(K, c)
        K.box("frame", -0.5, 0.5, -h + 0.4, h - 0.1, c["zc"] - 0.32, c["zc"])
        whw = min(BW / 2, 1.27) - 0.02
        for a in c["rear"]:
            K.wheels(a, c["r"], whw)
        if cls == "heavy":
            cyl(K.M, c["chw"] - 0.06, back + 0.1, 0.07, c["zc"], c["roof"] + 0.3, pv_mat("black"), n=5)   # the exhaust
        pv_body(K, kind, back + 0.12, h, c["zf"], c["top"], BW / 2, guard=True)
        pv_rear(K, h, whw - 0.1)
    return fn


def pv_rt_tractor(Ms, P):
    """The road train's tractor (6.4 m): the biggest bonnet and cab of the fleet, twin stacks behind it, a tandem
    under the turntable its first trailer rides on."""
    K = PV(Ms["model"])
    c = PV_CLASS["rt"]
    h = c["L"] / 2
    back = pv_truck_front(K, c)
    K.box("frame", -0.5, 0.5, -h + 0.4, h - 0.05, c["zc"] - 0.32, c["zc"])
    for a in c["rear"]:
        K.wheels(a, c["r"], 1.25)
    K.box("black", -1.0, 1.0, 1.1, 2.75, c["zc"], c["zc"] + 0.14)                                       # the turntable
    K.pair("second", 0.72, 1.3, 0.72, 3.15, 2 * c["r"] + 0.06, 2 * c["r"] + 0.14)                       # mudguards
    for x in (-c["chw"] + 0.06, c["chw"] - 0.06):
        cyl(K.M, x, back + 0.12, 0.08, c["zc"], c["roof"] + 0.35, pv_mat("chrome"), n=5)
    K.pair("black", 0.62, 1.12, back - 0.9, back + 0.1, 0.5, 0.95)                                      # fuel tanks
    pv_rear(K, h, 1.1)


def pv_trailer(kind, lead, W):
    """A road train's trailer on its tandem: the lead one (9.4 m) carries its body ahead of a turntable for the
    second; the rear one (10 m) is body all the way. The pin is 0.8 m from its front."""
    L = 9.4 if lead else 10.0
    def fn(Ms, P):
        K = PV(Ms["model"])
        h, zf, top = L / 2, 1.3, 3.55
        whw = min(W / 2, 1.27) - 0.02
        K.box("frame", -0.5, 0.5, -h + 0.1, h - 0.05, 0.9, zf)
        for y in (3.05, 4.15):
            K.wheels(y, 0.5, whw)
        K.pair("frame", 0.8, 0.94, -h + 1.9, -h + 2.04, 0.4, zf)                                       # landing legs
        half = W / 2
        if lead:
            pv_body(K, kind, -h, 2.5, zf, top, half)
            K.box("frame", -1.1, 1.1, 2.55, h, zf - 0.1, zf + 0.06)
            K.box("black", -0.85, 0.85, 3.05, 4.15, zf + 0.06, zf + 0.18)                              # the turntable
            K.pair("black", whw - 0.52, whw, 2.4, 4.7, 1.06, 1.14)                                     # mudguards
        else:
            pv_body(K, kind, -h, h - 0.1, zf, top, half)
        pv_rear(K, h, whw - 0.1)
    return fn


# The oversized-load convoy (src/game/convoys.ts, CONVOY_UNITS): the pilot car (vehicles_b_cars.py), the heavy-haul
# tractor in the company's colours, the low-loader with the piece, an escort behind. `beacon` is the amber lamps the
# renderer flashes. Lengths and axles are CONVOY_UNITS'. Nothing here is hazard yellow: the convoy is the company's
# own, flagged in red and boarded in cream, as an abnormal load of the thirties was.

def pv_ll_tractor(Ms, P):
    """The heavy-haul tractor (6.6 m): the road train's, dressed for the job: a lettered board on the bumper and
    over the cab, an amber lamp on the roof, the low-loader's neck on its tandem."""
    K = PV(Ms["model"])
    c = PV_CLASS["ll"]
    h = c["L"] / 2
    back = pv_truck_front(K, c, board=False)
    K.box("frame", -0.55, 0.55, -h + 0.4, h - 0.05, c["zc"] - 0.34, c["zc"])
    for a in c["rear"]:
        K.wheels(a, c["r"], 1.24)
    K.box("black", -1.0, 1.0, 0.6, 2.2, c["zc"], c["zc"] + 0.12)                                        # the turntable
    K.pair("second", 0.7, 1.3, 0.4, 2.6, 2 * c["r"] + 0.06, 2 * c["r"] + 0.14)                          # mudguards
    for x in (-c["chw"] + 0.06, c["chw"] - 0.06):
        cyl(K.M, x, back + 0.1, 0.08, c["zc"], c["roof"] + 0.4, pv_mat("chrome"), n=5)
    K.box("cream", -1.15, 1.15, -h - 0.004, -h + 0.11, 0.54, 0.88)                                      # the warning board
    K.box("black", -0.95, 0.95, -h - 0.008, -h - 0.004, 0.64, 0.78)
    K.box("cream", -0.9, 0.9, c["cowl"] + 0.3, c["cowl"] + 0.4, c["roof"], c["roof"] + 0.3)
    K.box("black", -0.76, 0.76, c["cowl"] + 0.29, c["cowl"] + 0.41, c["roof"] + 0.08, c["roof"] + 0.22)
    cyl(K.M, 0.0, c["cowl"] + 0.9, 0.14, c["roof"], c["roof"] + 0.2, pv_mat("beacon"), n=6)
    K.pair("black", 0.62, 1.12, back - 0.9, back + 0.04, 0.5, 0.98)                                     # fuel tanks
    pv_rear(K, h, 1.1)


def pv_ll_trailer(piece):
    """The low-loader (14 m): a neck over the tractor's turntable (the pin 0.8 m from its front), a timbered well
    slung low between it and a four-axle bogie, and the oversized piece chained down on timber cribs, flagged at its
    widest and boarded at the back."""
    def fn(Ms, P):
        K = PV(Ms["model"])
        prof = [(-7.0, 1.25), (-7.0, 1.75), (-4.1, 1.75), (-3.4, 0.75), (3.5, 0.75), (3.9, 1.25), (7.0, 1.25),
                (7.0, 0.85), (3.8, 0.85), (3.4, 0.4), (-3.5, 0.4), (-4.3, 1.25)]
        K.px("frame", prof, -1.24, 1.24)                                                               # black ironwork,
        K.box("body", -1.25, 1.25, -6.96, -4.28, 1.29, 1.77)                                           # the neck in the company's colour
        K.box("wood", -1.2, 1.2, -3.3, 3.4, 0.75, 0.8)                                                 # the well's timbers
        K.pair("second", 1.2, 1.262, -3.38, 3.48, 0.6, 0.76)                                           # its side rails
        K.box("second", -1.26, 1.26, -6.9, -4.3, 1.4, 1.62)                                            # the neck's band
        K.box("black", -0.9, 0.9, -6.6, -5.8, 1.18, 1.25)
        for y in (4.2, 5.0, 5.8, 6.6):
            K.wheels(y, 0.38, 1.22, hub=None)
        K.box("black", -1.0, 1.0, 6.9, 7.0, 0.5, 0.85)
        K.pair("tail", 0.7, 0.9, 6.99, 7.0, 0.9, 1.04)
        K.box("cream", -1.25, 1.25, 6.88, 6.96, 1.25, 1.95)                                             # the board behind
        K.box("black", -1.0, 1.0, 6.96, 6.98, 1.45, 1.72)
        for x in (-1.1, 1.1):                                                                           # amber lamps on it
            cyl(K.M, x, 6.92, 0.09, 1.95, 2.1, pv_mat("beacon"), n=6)
        if piece == "turbine":
            # a generator's stator: a casing on two cribs, flanged at each end, the shaft's stub behind
            cz = 0.79 + 0.35 + 1.55
            for y in (-1.9, 1.5):
                K.box("wood", -1.2, 1.2, y - 0.4, y + 0.4, 0.79, 1.5)
            # (a steam turbine's casing: the narrow high-pressure end swelling to the exhaust casing, the bolted
            # joint all round its middle, the shaft out of each end, the steam chest on top, the exhaust boarded over)
            K.tube("turbine", -2.7, -0.5, 1.02, 1.02, cz, n=12, rx1=1.45, rz1=1.45)
            K.tube("turbine", -0.5, 2.3, 1.55, 1.55, cz, n=12)
            K.box("turbine2", -1.7, 1.7, -2.7, 2.3, cz - 0.09, cz + 0.09)                             # the joint flange
            for ya, yb, rr in ((-2.86, -2.7, 1.2), (-0.62, -0.44, 1.66), (2.3, 2.46, 1.7)):
                K.tube("turbine2", ya, yb, rr, rr, cz, n=12)
            K.tube("steel", -3.3, -2.86, 0.3, 0.3, cz, n=8)                                             # the shaft
            K.tube("steel", 2.46, 3.05, 0.38, 0.38, cz, n=8)
            K.tube("steel", 3.05, 3.2, 0.62, 0.62, cz, n=8)                                             # its coupling
            K.box("turbine2", -0.55, 0.55, -2.3, -1.15, cz + 0.95, cz + 1.4)                            # the steam chest
            for y in (-2.0, -1.45):
                cyl(K.M, 0.0, y, 0.2, cz + 1.4, cz + 1.62, pv_mat("steel"), n=6)
            K.box("turbine2", -0.92, 0.92, 0.25, 1.95, cz + 1.46, cz + 1.6)                             # the exhaust's flange
            K.box("wood", -0.82, 0.82, 0.35, 1.85, cz + 1.6, cz + 1.67)                                 # boarded over
            for y in (-0.1, 2.12):                                                                      # chains over the top
                K.box("chain", -1.6, 1.6, y - 0.06, y + 0.06, cz + 1.5, cz + 1.6)
            for x in (-1.64, 1.64):                                                                     # red flags at its widest
                for y in (-2.6, 2.2):
                    K.box("flag", x - 0.06, x + 0.06, y - 0.25, y + 0.25, cz + 0.09, cz + 0.55)
        else:
            # a pair of plate girders braced together, on cribs in the well and over the bogie
            zb = 1.45
            K.box("wood", -1.2, 1.2, -2.9, -2.1, 0.79, zb)
            K.box("wood", -1.2, 1.2, 5.0, 5.8, 1.25, zb)
            # (in red oxide, as steel left the works: two I girders a pace apart, a frame across at each stiffener
            # and the wind bracing zigzagging between: from above, a bridge and nothing else)
            ya, yb, zt, gx = -3.3, 6.86, zb + 2.14, 0.96
            for x in (-gx, gx):
                K.box("girder", x - 0.25, x + 0.25, ya, yb, zb, zb + 0.12)
                K.box("girder2", x - 0.06, x + 0.06, ya, yb, zb + 0.12, zt - 0.12)
                K.box("girder", x - 0.25, x + 0.25, ya, yb, zt - 0.12, zt)
            n = 6
            ys = [ya + 0.25 + (yb - ya - 0.5) * i / n for i in range(n + 1)]
            for y in ys:
                K.pair("girder", gx + 0.06, gx + 0.24, y - 0.05, y + 0.05, zb + 0.12, zt - 0.12)       # stiffeners outside
                K.box("girder2", -gx + 0.24, gx - 0.24, y - 0.07, y + 0.07, zt - 0.34, zt - 0.16)      # a frame across
            for i in range(n):
                s = 1 if i % 2 == 0 else -1
                bar(K.M, (-s * (gx - 0.26), ys[i] + 0.06), (s * (gx - 0.26), ys[i + 1] - 0.06), 0.12, zt - 0.3, zt - 0.2, pv_mat("girder2"))
            K.pair("flag", gx + 0.06, gx + 0.26, yb - 0.5, yb, zt - 0.5, zt - 0.05)
    return fn


_BODIES = ("truck", "tipper", "tanker", "flatbed", "reefer", "carrier")
_LIGHT_W = {"truck": 2.5, "tipper": 2.7, "tanker": 2.46, "flatbed": 2.52, "reefer": 2.58, "carrier": 2.58}
_TRAIL_W = {"truck": 2.54, "tipper": 2.7, "tanker": 2.44, "flatbed": 2.52, "reefer": 2.58, "carrier": 2.58}
for _b in _BODIES:
    VEHICLES[_b] = (pv_rigid(_b, "light", _LIGHT_W[_b], _LIGHT_W[_b]), ("model",), (_LIGHT_W[_b], 8.5, None))
    VEHICLES["heavy_" + _b] = (pv_rigid(_b, "heavy", 2.7, _LIGHT_W[_b]), ("model",), (2.7, 12.0, None))
    VEHICLES[f"rt_{_b}_a"] = (pv_trailer(_b, True, _TRAIL_W[_b]), ("model",), (_TRAIL_W[_b], 9.4, None))
    VEHICLES[f"rt_{_b}_b"] = (pv_trailer(_b, False, _TRAIL_W[_b]), ("model",), (_TRAIL_W[_b], 10.0, None))
VEHICLES.update({
    "rt_tractor": (pv_rt_tractor, ("model",), (2.7, 6.4, None)),
    "ll_tractor": (pv_ll_tractor, ("model",), (2.64, 6.6, None)),
    "ll_trailer_turbine": (pv_ll_trailer("turbine"), ("model",), (3.4, 14.0, None)),
    "ll_trailer_girder": (pv_ll_trailer("girder"), ("model",), (2.5, 14.0, None)),
})

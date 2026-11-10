# The vehicles of 1925-1940: the kit they are built from. Run into build_models.py's module (after its own vehicle
# section) with the other tools/blender/vehicles_*.py, which register their models in VEHICLES.
#
# What a vehicle model is now (src/render/models.ts splitVehicle reads it):
#   - one mesh node `model` with a material per colour, and for the cars a second node `far`: the same car in a few
#     dozen triangles, drawn when it is a handful of pixels long;
#   - the material's NAME is its part in the paint: `body` (the main paint), `second` (the wings and roof of a car,
#     the lettering colour of a company truck), `cargo` (the load or the tilt over it) are white and take the colour
#     the game gives each vehicle; `beacon` flashes; `lamp` and `tail` are the head and tail lamp lenses, and where
#     the night's lights are hung; every other material keeps its own colour;
#   - front at Blender -Y (glTF +Z), origin at the ground centre of the footprint, wheels on z = 0.
#
# The look: flat palette colour, the geometry carries the detail. What reads from above is exaggerated on purpose:
# wings standing clear of a narrow bonnet, round lamps on stalks, a long bonnet, the load.

PV_ROLES = ("body", "second", "cargo", "beacon", "lamp", "tail")
PV_HEX = {
    "body": "#ffffff", "second": "#ffffff", "cargo": "#ffffff",
    "beacon": "#ffa21f", "lamp": "#f8e9b4", "tail": "#b3261e",
    "glass": "#7f96a3", "black": "#2a2c31", "tyre": "#1f2023", "frame": "#3a3d42",
    "chrome": "#d8d5c8", "wood": "#a8804f", "wood2": "#7e5d3c", "canvas": "#cdbf9d", "tan": "#a9794d",
    "insul": "#ecebe3", "cloth": "#8e8a7d", "steel": "#8b9297", "cream": "#efe6cf", "yellow": "#e2b13a", "flag": "#d8322a",
    "turbine": "#566f84", "turbine2": "#33475a", "girder": "#a6523b", "girder2": "#7a3a2b", "chain": "#3b3e43",
}


def pv_mat(n):
    return mat(n if n in PV_ROLES else "v_" + n, PV_HEX[n])


class PV:
    """One mesh being built (a vehicle's `model`, or its `far`), with pieces named by material."""

    def __init__(self, M):
        self.M = M

    def box(self, mn, x0, x1, y0, y1, z0, z1):
        return box(self.M, x0, x1, y0, y1, z0, z1, pv_mat(mn))

    def pair(self, mn, x0, x1, y0, y1, z0, z1):
        """The same box on both sides (x0..x1 on the right, mirrored on the left)."""
        self.box(mn, x0, x1, y0, y1, z0, z1)
        self.box(mn, -x1, -x0, y0, y1, z0, z1)

    def taper(self, mn, r0, r1, z0, z1):
        return taper(self.M, r0, r1, z0, z1, pv_mat(mn))

    def px(self, mn, prof, x0, x1):
        """A side profile (y, z) run across the width."""
        return extrude_profile(self.M, prof, "x", x0, x1, pv_mat(mn))

    def py(self, mn, prof, y0, y1):
        """A cross-section (x, z) run along the length."""
        return extrude_profile(self.M, prof, "y", y0, y1, pv_mat(mn))

    def loft(self, mn, lo, hi):
        return self.M.loft(lo, hi, pv_mat(mn))

    def tube(self, mn, y0, y1, rx, rz, cz, n=10, x=0.0, rx1=None, rz1=None):
        """A tube along the length, elliptical (rx wide, rz tall) about (x, cz), a flat of it on top and its sides
        exactly rx out; rx1, rz1 taper its far end."""
        rx1 = rx if rx1 is None else rx1
        rz1 = rz if rz1 is None else rz1
        off = math.pi / n if n % 4 == 0 else 0.0
        k = 1 / math.cos(off)
        ring = lambda y, a, b: [(x + a * k * math.cos(2 * math.pi * i / n + off), y,
                                 cz + b * k * math.sin(2 * math.pi * i / n + off)) for i in range(n)]
        return self.M.loft(ring(y0, rx, rz), ring(y1, rx1, rz1), pv_mat(mn))

    def drum(self, mn, y, z, r, x0, x1, n=8):
        """A drum across the width (an axle's two wheels in one, a spare lying against the bonnet)."""
        ring = [(y + r * math.cos(2 * math.pi * i / n + math.pi / n), z + r * math.sin(2 * math.pi * i / n + math.pi / n))
                for i in range(n)]
        return extrude_profile(self.M, ring, "x", x0, x1, pv_mat(mn))

    def wheels(self, y, r, hw, n=8, hub="chrome", tread=None):
        """An axle's wheels: one drum across (the chassis hides the middle), a flat of it on the ground, and a hub
        cap just proud of each tyre. `tread`: the tyres' width, where the middle would show (a trailer's bogie)."""
        zc = r * math.cos(math.pi / n)
        if tread is None:
            self.drum("tyre", y, zc, r, -hw, hw, n)
        else:
            self.drum("tyre", y, zc, r, hw - tread, hw, n)
            self.drum("tyre", y, zc, r, -hw, -hw + tread, n)
        if hub:
            self.drum(hub, y, zc, r * 0.46, -hw - 0.015, hw + 0.015, 6)


def pv_hood(K, mn, y0, y1, hw0, hw1, zb, zt0, zt1, c=0.1):
    """A bonnet: six-sided, narrower and lower at the radiator (y0) than at the scuttle (y1)."""
    ring = lambda y, hw, zt: [(-hw, y, zb), (hw, y, zb), (hw, y, zt - c), (hw - c, y, zt), (-hw + c, y, zt), (-hw, y, zt - c)]
    K.loft(mn, ring(y0, hw0, zt0), ring(y1, hw1, zt1))


def pv_pan(K, mn, axles, r, hw, zb=0.4, g=0.07, t=0.08, nose=0.2, tail=0.14, step_to=None, sweep=0.42):
    """The wings: a mudguard arched over each axle in `axles` (front first), a running board at height zb joining a
    front one to a rear one, or (step_to) running back from the last as a cab step. One piece across the whole
    width: the body hides its middle. Wheels of radius r stand clear under the arches."""
    R, ri, zc = r + g + t, r + g, r
    crown, zf = zc + R, zc * 0.72
    a = axles[0]
    top = [(a - R - nose, zc * 1.05), (a - R * 0.72, zc + R * 0.74), (a - R * 0.12, crown)]
    bot = []          # the underside, rear to front
    for i in range(1, len(axles)):
        p, a = axles[i - 1], axles[i]
        if a - p > 2 * R + 1.0:
            top += [(p + R * 0.55, zc + R * 0.9), (p + R + sweep, zb), (a - R - 0.30, zb),
                    (a - R * 0.78, zc + R * 0.82), (a - R * 0.1, crown)]
        else:
            top += [(p + R * 0.3, crown), (a - R * 0.3, crown)]
    last = axles[-1]
    if step_to is not None:
        top += [(last + R * 0.55, zc + R * 0.9), (last + R + sweep, zb), (step_to, zb)]
        bot += [(step_to, zb - 0.08), (last + R + sweep, zb - 0.08)]
    else:
        top += [(last + R * 0.6, zc + R * 0.86), (last + R + tail, zc)]
    for i in range(len(axles) - 1, -1, -1):
        a = axles[i]
        bot += [(a + ri, zf), (a + ri * 0.62, zc + ri * 0.84), (a - ri * 0.62, zc + ri * 0.84), (a - ri, zf)]
        if i and a - axles[i - 1] > 2 * R + 1.0:
            p = axles[i - 1]
            bot += [(a - R - 0.30, zb - 0.07), (p + R + sweep, zb - 0.07)]
    K.px(mn, top + bot, -hw, hw)


def pv_radiator(K, y, hw, z0, z1, shell="chrome", deep=0.12):
    """An upright radiator: its shell and the dark core set in it."""
    K.box(shell, -hw, hw, y, y + deep, z0, z1)
    K.box("black", -hw + 0.06, hw - 0.06, y - 0.025, y, z0 + 0.08, z1 - 0.08)


def pv_lamps(K, x, y, z, s=0.22, deep=0.2):
    """A pair of headlamps on their stalks: a lens facing forward, the bowl tapering back from it."""
    for sx in (-x, x):
        K.tube("lamp", y, y + deep, s * 0.7, s * 0.7, z, n=4, x=sx, rx1=s * 0.4, rz1=s * 0.4)


def VEHICLE_TRIS(name):
    """The triangles a vehicle model may have, and its far model: cars and vans are the many (every parked car is
    one), freight, the bus and the convoy the few."""
    if name.startswith(("ll_", "rt_", "heavy_")) or name in ("truck", "tipper", "tanker", "flatbed", "reefer", "carrier"):
        return 880, 0
    if name in ("bus", "escort_car"):
        return 700, 0
    return 420, 110

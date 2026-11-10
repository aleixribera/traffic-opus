# The people and the small things of a town's centre (src/render/townlife.ts places them): townspeople on the
# pavements and the square, the benches, market stalls, newsstand, telephone kiosk, memorial, fountain and planters
# round the hall, and the timber hoarding round a building site waiting for its materials (render/construction3d.ts).
#
# Each stands at its own foot, its front to -Y (the game's +z). A person is a few dozen faces, made to be read at a
# dozen pixels tall from the tilted camera: the hat and the shoulders are what show, so they carry the colour. Each has
# a far model (`_far`), two boxes, for when they are a few pixels tall.

_SKIN = ("#e2b993", "#c99470", "#8f5f42")


def _lm():
    return {k: mat("life_" + k, v) for k, v in {
        "iron": "#2c3a33", "slat": "#4f6b4a", "slat2": "#7a5a3c", "stone": "#d6cdb8", "stone2": "#bdb39c",
        "stone3": "#a39a84", "bronze": "#5f6d5c", "water": "#7f9fa8", "wreath": "#4a6a3a", "soil": "#6e5640",
        "shrub": "#4f7d3c", "shrub2": "#5f8a40", "canvas": "#efe6cf", "red": "#a8402f", "green": "#356a52",
        "navy": "#2f4560", "mustard": "#c99b3a", "wood": "#7a5a3c", "wood2": "#9b7a52", "crate": "#a8865a",
        "apple": "#b83b2c", "cabbage": "#7fa04f", "orange": "#d98a32", "flowers": "#d6789a", "bread": "#c99a5a",
        "paper": "#e8e2d2", "paper2": "#c9c1ad", "glass": "#5a6f78", "kiosk": "#2e5a4c", "cream": "#ece2c6",
        "board": "#8d7553", "board2": "#7c6546", "post_a": "#c94f35", "post_b": "#2f5c7a", "post_c": "#d9b44a",
        "post_d": "#ebe2c9", "black": "#26282a",
    }.items()}


# ------------------------------------------------------------------ people

# (coat or jacket, trousers or skirt, hat, hat band, skin, kind) - the clothes of 1930: dark suits and felt hats,
# overcoats, a woman's coat and cloche, a working man's overalls and cap
_PEOPLE = {
    "a": ("#3a3d44", "#33363c", "#5b5e5f", "#26282a", 0, "suit"),
    "b": ("#a5835a", "#4a4440", "#5a4434", "#2a2420", 1, "coat"),
    "c": ("#7a2f34", "#7a2f34", "#e7dcc0", "#7a2f34", 0, "dress"),
    "d": ("#2f6a66", "#2f6a66", "#2b3540", "#c99b3a", 2, "dress"),
    "e": ("#3f5f86", "#3f5f86", "#4a4a48", "#4a4a48", 1, "work"),
    "f": ("#c9a14a", "#5a4a3c", "#3b2d28", "#3b2d28", 0, "coat"),
}


def _person(M, key, far=False):
    coat_h, legs_h, hat_h, band_h, skin_i, kind = _PEOPLE[key]
    coat, legs, hat, band = (mat("life_p%s_%s" % (key, n), h) for n, h in
                             (("coat", coat_h), ("legs", legs_h), ("hat", hat_h), ("band", band_h)))
    skin, shoe = mat("life_skin%d" % skin_i, _SKIN[skin_i]), mat("life_shoe", "#2a2522")
    if far:
        # two boxes: the body in its coat, the head under its hat
        box(M, -0.2, 0.2, -0.12, 0.12, 0, 1.45, coat)
        box(M, -0.13, 0.13, -0.13, 0.13, 1.45, 1.78, hat)
        return
    hem = {"suit": 0.86, "coat": 0.52, "dress": 0.42, "work": 0.86}[kind]
    # legs mid-stride (one forward, one back), each in its shoe
    for s, dy in ((-1, -0.1), (1, 0.1)):
        x = s * 0.085
        box(M, x - 0.065, x + 0.065, dy - 0.07, dy + 0.07, 0.07, hem + 0.02, legs if kind != "dress" else skin)
        box(M, x - 0.07, x + 0.07, dy - 0.11, dy + 0.08, 0, 0.08, shoe)
    if kind == "dress":
        taper(M, (-0.24, 0.24, -0.16, 0.16), (-0.16, 0.16, -0.11, 0.11), hem, 1.0, legs)
    elif kind == "coat":
        taper(M, (-0.23, 0.23, -0.15, 0.15), (-0.17, 0.17, -0.12, 0.12), hem, 1.0, coat)
    else:
        box(M, -0.17, 0.17, -0.11, 0.11, 0.84, 1.0, legs if kind == "work" else coat)
    # the body to the shoulders, the arms at its sides (swinging a little, the other way to the legs)
    taper(M, (-0.17, 0.17, -0.12, 0.12), (-0.21, 0.21, -0.12, 0.12), 1.0, 1.44, coat)
    for s, dy in ((-1, 0.07), (1, -0.07)):
        x = s * 0.25
        _beam(M, (x, dy * 0.2, 1.4), (x, dy, 0.86), 0.09, 0.1, coat if kind != "work" else mat("life_shirt", "#e4dccb"))
        box(M, x - 0.045, x + 0.045, dy - 0.045, dy + 0.045, 0.74, 0.86, skin)
    if kind == "work":
        box(M, -0.15, 0.15, -0.125, -0.11, 1.0, 1.36, legs)   # the overalls' bib
    # the head, and the hat that is what shows from above
    revolve(M, 0, 0, [(0.06, 1.44), (0.06, 1.5), (0.105, 1.54), (0.11, 1.64), (0.085, 1.72), (0.0, 1.74)], skin, n=6)
    if kind in ("suit", "coat"):
        cyl(M, 0, 0, 0.19, 1.68, 1.705, hat, n=8)             # a felt hat's brim
        revolve(M, 0, 0, [(0.115, 1.7), (0.115, 1.74), (0.11, 1.81), (0.0, 1.83)], band if kind == "suit" else hat, n=6)
    elif kind == "dress":
        revolve(M, 0, 0, [(0.15, 1.6), (0.13, 1.7), (0.08, 1.79), (0.0, 1.8)], hat, n=7)   # a cloche
        box(M, -0.135, 0.135, -0.12, 0.08, 1.63, 1.66, band)
    else:
        revolve(M, 0, 0.02, [(0.12, 1.66), (0.12, 1.71), (0.0, 1.76)], hat, n=6)          # a flat cap, its peak
        box(M, -0.09, 0.09, -0.21, -0.08, 1.665, 1.69, hat)


def _person_builder(key, far):
    def b(M, P):
        L = Lot(0.5, 0.4)
        L.bays = []
        _person(M, key, far)
        return L
    return b


# ------------------------------------------------------------------ the square's furniture

def b_life_bench(M, P):
    """A park bench, 1.9 m: cast-iron ends, green-painted slats for the seat and the back, facing -Y."""
    C = _lm()
    L = Lot(1.9, 0.62)
    L.bays = []
    for x in (-0.85, 0.85):
        box(M, x - 0.04, x + 0.04, -0.26, 0.2, 0, 0.42, C["iron"])          # the leg frame
        _beam(M, (x, 0.12, 0.42), (x, 0.26, 0.86), 0.08, 0.06, C["iron"])  # the back's upright
        box(M, x - 0.04, x + 0.04, -0.3, -0.24, 0.42, 0.62, C["iron"])      # the arm
    for i, y in enumerate((-0.22, -0.08, 0.06)):
        box(M, -0.95, 0.95, y - 0.055, y + 0.055, 0.4, 0.45, C["slat"])
    for z, y in ((0.58, 0.17), (0.74, 0.22)):
        box(M, -0.95, 0.95, y - 0.03, y + 0.03, z - 0.06, z + 0.06, C["slat"])
    return L


def _stall(M, C, stripe, goods):
    # the trestle table under its goods, a rail of crates in front, four posts and a striped canvas awning
    box(M, -1.4, 1.4, -0.5, 0.5, 0.78, 0.84, C["wood2"])
    for x in (-1.25, 1.25):
        for y in (-0.42, 0.42):
            box(M, x - 0.04, x + 0.04, y - 0.04, y + 0.04, 0, 0.78, C["wood"])
    for x in (-1.5, 1.5):
        for y in (-0.95, 0.75):
            box(M, x - 0.04, x + 0.04, y - 0.04, y + 0.04, 0, 2.15 if y < 0 else 2.45, C["wood"])
    for i, g in enumerate(goods):
        x = -1.05 + i * 0.7
        box(M, x - 0.3, x + 0.3, -0.42, 0.1, 0.84, 1.0, C["crate"])
        box(M, x - 0.26, x + 0.26, -0.38, 0.06, 1.0, 1.08, C[g])
    for x in (-0.95, 0.95):
        box(M, x - 0.32, x + 0.32, -0.75, -0.42, 0, 0.36, C["crate"])
        box(M, x - 0.28, x + 0.28, -0.71, -0.46, 0.36, 0.43, C[goods[0] if x < 0 else goods[-1]])
    # the awning: a sloped canvas from the back down over the front, in stripes, its scalloped valance
    n = 8
    for i in range(n):
        x0, x1 = -1.65 + 3.3 * i / n, -1.65 + 3.3 * (i + 1) / n
        m = C[stripe] if i % 2 == 0 else C["canvas"]
        _quad(M, [(x0, -1.15, 2.1), (x1, -1.15, 2.1), (x1, 0.85, 2.5), (x0, 0.85, 2.5)], m)
        _quad(M, [(x0, 0.85, 2.48), (x1, 0.85, 2.48), (x1, -1.15, 2.08), (x0, -1.15, 2.08)], m)
        box(M, x0, x1, -1.17, -1.13, 1.88, 2.1, m)


def b_life_stall_a(M, P):
    """A market stall, red and cream: apples, cabbages, oranges."""
    C = _lm()
    L = Lot(3.3, 2.0)
    L.bays = []
    _stall(M, C, "red", ("apple", "cabbage", "orange", "apple"))
    return L


def b_life_stall_b(M, P):
    """A market stall, green and cream: flowers, bread, cabbages."""
    C = _lm()
    L = Lot(3.3, 2.0)
    L.bays = []
    _stall(M, C, "green", ("flowers", "bread", "cabbage", "flowers"))
    return L


def b_life_kiosk(M, P):
    """A newsstand: a green-painted timber kiosk, its front let down as a counter of papers, a lit sign over it."""
    C = _lm()
    L = Lot(2.4, 1.9)
    L.bays = []
    sign = mat("win_sign_life_news", "#efe4c2")
    box(M, -1.1, 1.1, -0.6, 0.85, 0, 0.95, C["kiosk"])
    box(M, -1.1, -0.95, -0.6, 0.85, 0.95, 2.25, C["kiosk"])
    box(M, 0.95, 1.1, -0.6, 0.85, 0.95, 2.25, C["kiosk"])
    box(M, -1.1, 1.1, 0.7, 0.85, 0.95, 2.25, C["kiosk"])
    box(M, -0.95, 0.95, -0.4, 0.7, 0.95, 2.0, C["glass"])                # the dark inside
    box(M, -1.15, 1.15, -0.95, -0.6, 0.88, 0.95, C["wood2"])             # the counter
    for i in range(5):
        x = -0.95 + i * 0.4
        box(M, x, x + 0.33, -0.92, -0.63, 0.95, 0.98, C["paper"] if i % 2 == 0 else C["paper2"])
    box(M, -1.2, 1.2, -0.75, 0.95, 2.25, 2.35, C["kiosk"])               # the roof, a step and a cap
    box(M, -1.0, 1.0, -0.55, 0.75, 2.35, 2.48, C["kiosk"])
    box(M, -1.0, 1.0, -0.66, -0.6, 2.0, 2.24, sign)
    return L


def b_life_phonebox(M, P):
    """A telephone kiosk: cream-painted with a deep green base and roof, glazed in small panes, a lit sign band."""
    C = _lm()
    L = Lot(1.1, 1.1)
    L.bays = []
    sign = mat("win_sign_life_phone", "#e8dfbf")
    box(M, -0.55, 0.55, -0.55, 0.55, 0, 0.18, C["green"])
    for x in (-0.5, 0.42):
        for y in (-0.5, 0.42):
            box(M, x, x + 0.08, y, y + 0.08, 0.18, 2.3, C["cream"])
    box(M, -0.44, 0.44, -0.44, 0.44, 0.18, 2.3, C["glass"])
    for z in (0.95, 1.4, 1.85):
        box(M, -0.46, 0.46, -0.46, 0.46, z, z + 0.05, C["cream"])
    box(M, -0.52, 0.52, -0.52, 0.52, 2.3, 2.52, sign)
    box(M, -0.58, 0.58, -0.58, 0.58, 2.52, 2.6, C["green"])
    box(M, -0.4, 0.4, -0.4, 0.4, 2.6, 2.72, C["green"])
    return L


def b_life_memorial(M, P):
    """The town's memorial: three stone steps, a tall tapering shaft with a bronze wreath on its face, an urn on top."""
    C = _lm()
    L = Lot(3.6, 3.6)
    L.bays = []
    box(M, -1.8, 1.8, -1.8, 1.8, 0, 0.2, C["stone3"])
    box(M, -1.35, 1.35, -1.35, 1.35, 0.2, 0.42, C["stone2"])
    box(M, -0.9, 0.9, -0.9, 0.9, 0.42, 0.66, C["stone2"])
    box(M, -0.62, 0.62, -0.62, 0.62, 0.66, 1.9, C["stone"])
    box(M, -0.68, 0.68, -0.68, 0.68, 1.9, 2.05, C["stone2"])
    taper(M, (-0.42, 0.42, -0.42, 0.42), (-0.28, 0.28, -0.28, 0.28), 2.05, 6.2, C["stone"])
    box(M, -0.34, 0.34, -0.34, 0.34, 6.2, 6.38, C["stone2"])
    revolve(M, 0, 0, [(0.12, 6.38), (0.24, 6.55), (0.26, 6.7), (0.12, 6.86), (0.18, 6.92), (0.0, 6.98)], C["bronze"], n=8)
    revolve(M, 0, -0.64, [(0.0, 1.06), (0.3, 1.1), (0.3, 1.5), (0.0, 1.54)], C["wreath"], n=8)
    return L


def b_life_fountain(M, P):
    """A Deco fountain: a round stone basin of water, a fluted column rising in three bowls."""
    C = _lm()
    L = Lot(6.0, 6.0)
    L.bays = []
    revolve(M, 0, 0, [(0.0, 0.0), (3.0, 0.0), (3.0, 0.55), (2.7, 0.55), (2.7, 0.3), (0.0, 0.3)], C["stone2"], n=16)
    revolve(M, 0, 0, [(0.0, 0.42), (2.72, 0.42), (2.72, 0.44), (0.0, 0.44)], C["water"], n=16)
    revolve(M, 0, 0, [(0.5, 0.3), (0.38, 1.0), (0.3, 2.4), (0.24, 3.2), (0.0, 3.3)], C["stone"], n=8)
    for z, r in ((1.3, 1.25), (2.3, 0.8), (3.0, 0.45)):
        revolve(M, 0, 0, [(0.3, z - 0.25), (r, z), (r, z + 0.08), (0.0, z + 0.08)], C["stone"], n=12)
        revolve(M, 0, 0, [(0.0, z + 0.09), (r - 0.06, z + 0.09), (r - 0.06, z + 0.1), (0.0, z + 0.1)], C["water"], n=12)
    return L


def b_life_planter(M, P):
    """A square concrete urn on a foot, a clipped box shrub in it."""
    C = _lm()
    L = Lot(1.0, 1.0)
    L.bays = []
    taper(M, (-0.3, 0.3, -0.3, 0.3), (-0.3, 0.3, -0.3, 0.3), 0, 0.15, C["stone2"])
    taper(M, (-0.32, 0.32, -0.32, 0.32), (-0.48, 0.48, -0.48, 0.48), 0.15, 0.7, C["stone"])
    box(M, -0.5, 0.5, -0.5, 0.5, 0.7, 0.78, C["stone2"])
    box(M, -0.42, 0.42, -0.42, 0.42, 0.78, 0.8, C["soil"])
    revolve(M, 0, 0, [(0.0, 0.78), (0.36, 0.86), (0.42, 1.12), (0.3, 1.38), (0.0, 1.45)], C["shrub"], n=7)
    return L


# ------------------------------------------------------------------ the hoarding round a waiting site

def b_con_hoarding(M, P):
    """Four metres of a builder's hoarding: boards on posts, 2.2 m tall, with bill posters pasted on it (the game sets
    them round a site waiting for its materials, a run at a time). Boards face -Y."""
    C = _lm()
    L = Lot(4.0, 0.42)
    L.bays = []
    for i in range(8):
        x0 = -2.0 + i * 0.5
        box(M, x0, x0 + 0.5, -0.05, 0.03, 0.05, 2.2 - (i % 3) * 0.03, C["board"] if i % 2 == 0 else C["board2"])
    for x in (-1.9, 1.9):
        box(M, x - 0.06, x + 0.06, 0.03, 0.15, 0, 2.3, C["wood"])
        _beam(M, (x, 0.15, 1.5), (x, 0.38, 0.06), 0.08, 0.08, C["wood"])
    box(M, -2.0, 2.0, 0.03, 0.09, 1.95, 2.05, C["wood"])
    # the bills: a big one and two small, pasted a little crooked
    for x0, x1, z0, z1, m in ((-1.7, -0.3, 0.7, 1.85, "post_a"), (0.0, 0.85, 1.05, 1.85, "post_d"),
                               (0.95, 1.75, 0.6, 1.5, "post_b"), (0.05, 0.8, 0.45, 0.95, "post_c")):
        _quad(M, [(x0, -0.06, z0), (x1, -0.06, z0 + 0.02), (x1, -0.06, z1 + 0.02), (x0, -0.06, z1)], C[m])
    return L


for _k in _PEOPLE:
    BUILDINGS["life_person_" + _k] = (_person_builder(_k, False), 0.62, 0.41, 0)
    BUILDINGS["life_person_" + _k + "_far"] = (_person_builder(_k, True), 0.4, 0.26, 0)
BUILDINGS["life_bench"] = (b_life_bench, 1.9, 0.62, 0)
BUILDINGS["life_stall_a"] = (b_life_stall_a, 3.3, 2.0, 0)
BUILDINGS["life_stall_b"] = (b_life_stall_b, 3.3, 2.0, 0)
BUILDINGS["life_kiosk"] = (b_life_kiosk, 2.4, 1.9, 0)
BUILDINGS["life_phonebox"] = (b_life_phonebox, 1.16, 1.16, 0)
BUILDINGS["life_memorial"] = (b_life_memorial, 3.6, 3.6, 0)
BUILDINGS["life_fountain"] = (b_life_fountain, 6.0, 6.0, 0)
BUILDINGS["life_planter"] = (b_life_planter, 1.0, 1.0, 0)
BUILDINGS["con_hoarding"] = (b_con_hoarding, 4.0, 0.44, 0)
POST_ORIGIN.update(["life_person_" + k for k in _PEOPLE] + ["life_person_%s_far" % k for k in _PEOPLE]
                   + ["life_bench", "life_stall_a", "life_stall_b", "life_kiosk", "con_hoarding"])

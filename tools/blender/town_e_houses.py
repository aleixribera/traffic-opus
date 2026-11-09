# Two more family homes for the towns' streets of houses (the first three are in build_models.py: b_house,
# b_house_b, b_house_c). Same lot as theirs (home_lot: the driveway down the left side to the garage, the fenced back
# yard), so the game's driveway, bay and garage clip serve all five.


def b_house_d(M, P):
    """An American foursquare: two full storeys of cream clapboard under a hipped roof with a front dormer, a porch
    the width of the house on square posts, a brick chimney up the side."""
    L = home_lot(M, P, P["shingle"], "lawn")
    T, tr = _td(), P["res_trim"]
    wall, roof = mat("hd_clap", "#e0cf9a"), mat("hd_roof", "#566059")
    x0, x1, y0, y1, h = -0.8, 5.2, -0.6, 4.6, 5.6
    box(M, x0, x1, y0, y1, 0, h, wall)
    box(M, x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, 2.75, 2.9, tr)
    taper(M, (x0 - 0.5, x1 + 0.5, y0 - 0.5, y1 + 0.5), (2.0, 2.4, 1.9, 2.1), h, h + 1.9, roof)
    # the dormer on the front slope
    box(M, 1.5, 2.9, y0 + 0.5, y0 + 1.6, h + 0.3, h + 1.15, wall)
    taper(M, (1.35, 3.05, y0 + 0.35, y0 + 1.7), (2.1, 2.3, y0 + 1.0, y0 + 1.7), h + 1.15, h + 1.6, roof)
    # the porch: a deck, three posts, a low hipped roof
    box(M, x0, x1, y0 - 1.9, y0, 0, 0.3, P["drive"])
    for x in (x0 + 0.15, (x0 + x1) / 2, x1 - 0.15):
        box(M, x - 0.1, x + 0.1, y0 - 1.8, y0 - 1.6, 0.3, 2.6, tr)
    taper(M, (x0 - 0.2, x1 + 0.2, y0 - 2.1, y0), (x0 + 0.5, x1 - 0.5, y0 - 1.2, y0), 2.6, 3.0, roof)
    B, D = _faces(x0, x1, y0, y1), _faces(1.5, 2.9, y0 + 0.5, y0 + 1.6)
    home_door(M, B["f"], 1.6, T["door"], frame=tr)
    home_window(M, B["f"], 4.2, 1.3, frame=tr)
    home_window(M, D["f"], 0.7, 0.9, h + 0.42, h + 1.02)
    for a in (1.5, 4.5):
        home_window(M, B["f"], a, 1.0, 3.6, 4.85, frame=tr)
    for s, places in (("r", (1.4, 3.8)), ("l", (1.4, 3.8)), ("b", (1.5, 4.5))):
        for a in places:
            home_window(M, B[s], a, 0.95, frame=tr)
            home_window(M, B[s], a, 0.95, 3.6, 4.85, frame=tr)
    home_door(M, B["b"], 3.0, T["door_g"], w=0.85, frame=tr)
    box(M, x1 - 0.05, x1 + 0.55, 2.2, 3.0, 0, h + 2.4, P["brick_home"], bevel=0.04)
    emitter(M, "chimney", x1 + 0.25, 2.6, h + 2.4, 0.6)
    return L


def b_house_e(M, P):
    """A gable-front cottage: a storey and a half of blue-grey clapboard, its gable to the street over a porch
    under a lean-to roof, an attic window, a stove chimney at the back."""
    L = home_lot(M, P, P["res_roof2"], "shed")
    T, tr = _td(), P["res_trim"]
    wall, roof = mat("he_clap", "#c3ccd2"), mat("he_roof", "#8a4a3b")
    x0, x1, y0, y1, h = 0.0, 5.0, -1.4, 4.8, 2.9
    box(M, x0, x1, y0, y1, 0, h, wall)
    gable(M, x0, x1, y0, y1, h, h + 2.3, "y", roof, wall, oh_u=(0.4, 0.4), oh_a=(0.35, 0.3))
    # the porch across the front
    box(M, x0, x1, y0 - 1.6, y0, 0, 0.3, P["drive"])
    for x in (x0 + 0.15, x1 - 0.15):
        box(M, x - 0.09, x + 0.09, y0 - 1.5, y0 - 1.32, 0.3, 2.3, tr)
    _quad(M, [(x0 - 0.2, y0 - 1.75, 2.3), (x1 + 0.2, y0 - 1.75, 2.3), (x1 + 0.2, y0 + 0.02, 2.85), (x0 - 0.2, y0 + 0.02, 2.85)], roof)
    box(M, x0 - 0.2, x1 + 0.2, y0 - 1.75, y0 - 1.6, 2.12, 2.3, tr)
    B = _faces(x0, x1, y0, y1)
    home_door(M, B["f"], 1.3, T["oxblood"], frame=tr)
    home_window(M, B["f"], 3.5, 1.2, frame=tr)
    home_window(M, B["f"], 2.5, 0.8, h + 0.55, h + 1.45, frame=tr)
    home_window(M, B["b"], 2.5, 0.8, h + 0.55, h + 1.45, frame=tr)
    for s in ("r", "l"):
        for a in (1.3, 3.1, 4.9):
            home_window(M, B[s], a, 0.9, frame=tr)
    home_window(M, B["b"], 1.4, 0.9, frame=tr)
    home_door(M, B["b"], 3.6, T["door"], w=0.85, frame=tr)
    box(M, 3.3, 3.9, 3.6, 4.2, h + 0.6, h + 3.0, P["brick_home"], bevel=0.04)
    emitter(M, "chimney", 3.6, 3.9, h + 3.0, 0.6)
    return L


BUILDINGS["house_d"] = (b_house_d, 12, 15, 1)
BUILDINGS["house_e"] = (b_house_e, 12, 15, 1)

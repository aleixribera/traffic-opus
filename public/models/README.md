# Models

Built by `tools/blender/build_models.py` (Blender 5.2, run headless:
`blender -b --factory-startup -P tools/blender/build_models.py`). Do not edit the GLBs by hand;
change the script and rebuild. Previews are in `tools/blender/previews/`.

Units are metres. glTF is +Y up. In Blender the road-facing front is -Y, which the exporter turns
into **+Z in glTF**. Origins sit at the ground centre of the lot (or vehicle), resting on y = 0.
Flat base-colour materials only (roughness 0.8, metallic 0, no textures).

## Buildings

One mesh per building (named after the model, several materials) plus `park_N` empty nodes.
The whole w × d footprint is the lot: a light pad (#eef0ee, 0.06 m tall) with an asphalt
parking strip (6.5 m deep) at the front. `park_N` nodes sit at bay centres, at height 0.06.
Each node's local +Y in Blender (= local **-Z in glTF**) is the direction a parked car's nose
faces: cars park nose-in, toward the building. All bays are in the front row, so every node has
identity rotation. The vehicle models point their nose along glTF +Z, so a car placed on a
bay needs a 180° turn about the up axis relative to the node (or copy the node's transform and
rotate the car by π).

| model | footprint w × d (m) | height (m) | tris | park empties |
|---|---|---|---|---|
| house | 12 × 15 | 5.7 | 342 | 1 |
| terrace | 24 × 17 | 8.5 | 704 | 3 |
| apartments | 30 × 30 | 12.9 | 930 | 6 |
| shop | 18 × 20 | 5.6 | 314 | 4 |
| store | 30 × 28 | 8.2 | 670 | 8 |
| mall | 48 × 40 | 10.3 | 1424 | 14 |
| office | 20 × 22 | 12.4 | 502 | 5 |
| tower | 30 × 30 | 28.2 | 954 | 9 |
| mine | 26 × 30 | 7.0 | 506 | 2 |
| farm | 40 × 40 | 10.8 | 824 | 2 |
| works | 36 × 32 | 23.2 | 566 | 4 |
| foodplant | 32 × 30 | 9.0 | 962 | 4 |

## Vehicles

Front at glTF +Z (Blender -Y), origin at the ground centre, wheels on y = 0. Separate mesh nodes per
material: `body` and `cargo` are pure white (#ffffff) for per-instance tinting, `glass` is
#2b3440, `dark` (tyres, bumpers, chassis) is #30343a.

| model | W × L × H (m) | tris | nodes |
|---|---|---|---|
| car | 1.85 × 4.4 × 1.45 | 156 | `body`, `dark`, `glass` |
| van | 2 × 5 × 2 | 164 | `body`, `dark`, `glass` |
| truck | 2.5 × 8.5 × 3.2 | 228 | `body`, `cargo`, `dark`, `glass` |

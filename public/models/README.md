# Models

Built by `tools/blender/build_models.py` (Blender 5.2, run headless:
`blender -b --factory-startup -P tools/blender/build_models.py`). Do not edit the GLBs by hand;
change the script and rebuild. Previews are in `tools/blender/previews/`.

Units are metres. glTF is +Y up. In Blender the road-facing front is -Y, which the exporter turns
into **+Z in glTF**. Origins sit at the ground centre of the lot (or vehicle), resting on y = 0.
Flat base-colour materials only (roughness 0.8, metallic 0, no textures).

## Buildings

One mesh per building (named after the model, several materials) plus `park_N` empty nodes.
The whole w × d footprint is the lot. `park_N` nodes sit at bay centres, at height 0.06.
Each node's local +Y in Blender (= local **-Z in glTF**) is the direction a parked car's nose
faces. The vehicle models point their nose along glTF +Z, so a car placed on a
bay needs a 180° turn about the up axis relative to the node (or copy the node's transform and
rotate the car by π).

### Town buildings (1920-1940)

The kinds a town grows (`house`, `terrace`, `apartments`, `modernflats`, `aptower`, `highstreet`,
`shop`, `store`, `office`, `mall`, `tower`, `glasstower`, `fuelstation`) are built by
`tools/blender/town_*.py` (run by the same script). Each kind has several models, `kind`, `kind_b`,
`kind_c`...: all share the kind's footprint, origin, front (+Z) and entrance side, and differ in
architecture, brick and stone, roof and yard. The list is `src/render/townmodels.ts`; the renderer
picks one per building (`tests/townmodels.test.ts` checks every one of them).

- **Made for a lot.** The game scales a model by the lot's `fit` and stretches it by `tall`. A model
  carries the fit and tall it was made for as a `design_0` empty (its scale: fit, tall, 1): the renderer
  draws a building with the model made nearest its own, so doors and storeys keep their true size.
  Models named `_s`, `_m`, `_n` are made for narrow lots, `_t`, `_u` for tall ones.
- **Stand on the pavement.** A town building's front wall is at the lot's front; its cars park in the
  yard behind, reached down an alley beside it. `via_0` is where that alley ends (the driveway is
  drawn to it), `body_0` the block itself without its yard (at its centre and top; its scale the half
  width and half depth): what a building site scaffolds, and what the night's window light spills
  round. Homes have neither; the filling station has no alley.
- **Glass that lights.** Window materials are named `win_home`, `win_shop`, `win_office`, `win_hall`:
  the renderer lights each pane by the hour (`src/render/daylight.ts`). `win_sign_*` materials
  (signs, marquees, a billboard's poster) glow in their own colour while the street lamps burn.
- **Chimneys.** `chimney_N` empties mark where smoke rises (houses, row houses, main street).

### Roadside furniture

`telegraphpole` (origin at its foot), `telegraphwire` (one span a metre long from the origin toward
glTF +Z, hanging at the crossarms' height: the renderer stretches it between two poles) and
`billboard_a`, `_b`, `_c` (a hoarding with a poster on each face, origin under its posts, the main
face toward +Z). Placed by `src/render/furniture.ts`.

| model | footprint w × d (m) | height (m) | tris | park empties |
|---|---|---|---|---|
| con_stake | 0.3 × 0.3 | 0.9 | 48 | 0 |
| con_slab | 1 × 1 | 0.3 | 44 | 0 |
| con_trench | 1 × 1 | 0.0 | 12 | 0 |
| con_string | 1 × 0.12 | 0.7 | 24 | 0 |
| con_deck_wood | 3 × 2.98 | 0.1 | 120 | 0 |
| con_frame_wood | 3 × 3 | 3.0 | 168 | 0 |
| con_frame_steel | 6 × 6 | 4.0 | 336 | 0 |
| con_wall_wood | 3 × 0.2 | 3.0 | 60 | 0 |
| con_wall_brick | 3 × 0.32 | 4.0 | 34 | 0 |
| con_scaffold | 3 × 1.05 | 3.9 | 180 | 0 |
| con_lumber | 4 × 1.4 | 0.9 | 280 | 0 |
| con_bricks | 3.15 × 1.2 | 1.0 | 204 | 0 |
| con_steel | 6.2 × 1.6 | 0.8 | 216 | 0 |
| con_gravel | 3.343 × 3.149 | 0.9 | 180 | 0 |
| con_hut | 5.4 × 3.2 | 2.9 | 82 | 0 |
| con_crane | 3 × 22.217 | 21.2 | 852 | 0 |
| con_mixer | 2.3 × 7.858 | 3.0 | 708 | 0 |
| con_lumbertruck | 2.3 × 8.298 | 2.5 | 768 | 0 |
| house | 12.05 × 15 | 5.7 | 556 | 1 |
| house_b | 12.05 × 15 | 5.2 | 544 | 1 |
| house_c | 12.05 × 15 | 6.0 | 434 | 1 |
| terrace | 24 × 17 | 10.9 | 742 | 2 |
| apartments | 30 × 30 | 22.1 | 1492 | 5 |
| shop | 18 × 20 | 9.6 | 396 | 1 |
| store | 30 × 28 | 17.6 | 1260 | 5 |
| fuelstation | 24 × 24 | 7.4 | 690 | 2 |
| mall | 48 × 40 | 27.6 | 1776 | 8 |
| office | 20 × 22 | 18.6 | 640 | 3 |
| tower | 30 × 30 | 46.1 | 1098 | 4 |
| highstreet | 18 × 20 | 13.3 | 816 | 3 |
| modernflats | 30 × 30 | 24.4 | 1570 | 4 |
| glasstower | 30 × 30 | 76.2 | 1478 | 4 |
| aptower | 30 × 30 | 54.5 | 1182 | 4 |
| farm | 40 × 40 | 10.8 | 824 | 2 |
| farm_young | 40 × 40 | 10.8 | 824 | 2 |
| farm_ripe | 40 × 40 | 10.8 | 824 | 2 |
| farm_cut | 40 × 40 | 10.8 | 964 | 2 |
| farm_bare | 40 × 40 | 10.8 | 824 | 2 |
| foodplant | 32 × 30 | 14.3 | 1090 | 4 |
| loggingcamp | 36 × 32 | 9.2 | 1476 | 2 |
| sawmill | 40 × 34 | 14.1 | 1432 | 3 |
| ironmine | 38 × 36 | 19.9 | 986 | 3 |
| coalmine | 38 × 36 | 18.9 | 858 | 3 |
| quarry | 42 × 40 | 9.0 | 550 | 3 |
| smelter | 52 × 44 | 38.1 | 1538 | 5 |
| cementworks | 48 × 42 | 35.4 | 1622 | 4 |
| oilwell | 30 × 30 | 6.5 | 934 | 2 |
| sandpit | 40 × 38 | 9.4 | 562 | 3 |
| refinery | 60 × 50 | 37.2 | 2198 | 6 |
| glassworks | 46 × 38 | 30.1 | 1260 | 4 |
| furniture | 40 × 34 | 9.0 | 588 | 4 |
| constructionplant | 50 × 42 | 18.3 | 912 | 5 |
| coppermine | 44 × 40 | 10.0 | 710 | 3 |
| coppersmelter | 50 × 42 | 46.1 | 1492 | 4 |
| electronics | 44 × 36 | 12.9 | 1750 | 5 |
| machineworks | 52 × 44 | 25.1 | 1428 | 5 |
| warehouse | 72 × 44 | 11.9 | 1514 | 6 |
| fueldepot | 38 × 28 | 6.3 | 718 | 2 |
| site_truckyard | 44 × 30 | 3.6 | 562 | 8 |
| site_hall_l | 60 × 34 | 12.3 | 134 | 0 |
| site_hall_m | 40 × 26 | 8.4 | 198 | 0 |
| site_silos | 24 × 22 | 22.4 | 610 | 0 |
| site_tanks | 36 × 24 | 8.4 | 636 | 0 |
| site_office | 26 × 18 | 8.2 | 330 | 0 |
| site_workshop | 30 × 22 | 8.0 | 256 | 0 |
| site_field_g | 64 × 64 | 0.5 | 238 | 0 |
| site_field_w | 64 × 64 | 0.5 | 238 | 0 |
| site_field_young | 64 × 64 | 0.2 | 238 | 0 |
| site_field_cut | 64 × 64 | 1.5 | 518 | 0 |
| site_field_bare | 64 × 64 | 0.2 | 238 | 0 |
| site_barn | 30 × 24 | 12.6 | 212 | 0 |
| site_logyard | 40 × 30 | 3.4 | 162 | 0 |
| site_heap_ore | 30 × 24 | 6.9 | 130 | 0 |
| site_heap_coal | 30 × 24 | 6.9 | 130 | 0 |
| site_heap_lime | 30 × 24 | 6.9 | 130 | 0 |
| site_heap_sand | 30 × 24 | 6.9 | 130 | 0 |
| site_heap_cu | 30 × 24 | 6.9 | 130 | 0 |
| pile_ore_a | 13 × 13 | 5.6 | 152 | 0 |
| pile_ore_b | 13 × 13 | 4.8 | 152 | 0 |
| pile_coal_a | 13 × 13 | 5.6 | 152 | 0 |
| pile_coal_b | 13 × 13 | 4.8 | 152 | 0 |
| pile_lime_a | 13 × 13 | 5.6 | 152 | 0 |
| pile_lime_b | 13 × 13 | 4.8 | 152 | 0 |
| pile_sand_a | 13 × 13 | 5.6 | 152 | 0 |
| pile_sand_b | 13 × 13 | 4.8 | 152 | 0 |
| pile_cu_a | 13 × 13 | 5.6 | 152 | 0 |
| pile_cu_b | 13 × 13 | 4.8 | 152 | 0 |
| pile_logs_1 | 12.5 × 4.8 | 1.3 | 180 | 0 |
| pile_logs_2 | 12.5 × 4.8 | 2.2 | 288 | 0 |
| pile_logs_3 | 12.5 × 4.8 | 3.1 | 360 | 0 |
| chemworks | 50 × 42 | 30.0 | 1606 | 4 |
| dairyfarm | 40 × 40 | 15.2 | 1070 | 2 |
| creamery | 36 × 32 | 13.1 | 758 | 4 |
| rubberplant | 46 × 38 | 24.0 | 1460 | 4 |
| motorworks | 64 × 50 | 21.6 | 2098 | 6 |
| site_pasture | 64 × 64 | 3.8 | 1030 | 0 |
| site_cowshed | 30 × 24 | 7.4 | 380 | 0 |
| site_carlot | 40 × 30 | 3.0 | 1642 | 0 |
| busstop | 4.4 × 1.88 | 3.0 | 140 | 0 |
| fence | 9 × 0.28 | 2.3 | 80 | 0 |
| hedge | 4 × 0.76 | 1.0 | 176 | 0 |
| picket | 4.02 × 0.22 | 1.2 | 300 | 0 |
| streetlamp | 0.88 × 2.001 | 6.3 | 562 | 0 |
| floodmast | 2.3 × 2.15 | 13.9 | 900 | 0 |
| bridge_pier | 12 × 3.2 | 5.1 | 138 | 0 |
| bridge_abutment | 15.8 × 8 | 5.3 | 180 | 0 |
| bridge_pylon | 1.6 × 1.6 | 3.7 | 214 | 0 |
| bridge_truss | 11.6 × 10 | 6.2 | 216 | 0 |
| coalplant | 64 × 52 | 62.1 | 1770 | 6 |
| townhall | 40 × 36 | 24.0 | 1246 | 4 |
| hamlethall | 20 × 18 | 11.3 | 740 | 2 |
| villagehall | 28.047 × 24 | 14.2 | 936 | 3 |
| cityhall | 60 × 50 | 37.0 | 2480 | 6 |
| mega_hydrodam_1 | 150 × 80 | 39.0 | 2382 | 0 |
| mega_hydrodam_2 | 150 × 80 | 49.0 | 4096 | 0 |
| mega_hydrodam_3 | 150 × 80 | 31.0 | 3300 | 0 |
| mega_skylinetower_1 | 80 × 80 | 45.0 | 1904 | 0 |
| mega_skylinetower_2 | 80 × 80 | 97.0 | 3420 | 0 |
| mega_skylinetower_3 | 80 × 80 | 152.0 | 3102 | 0 |
| mega_exposition_1 | 170 × 120 | 35.0 | 2208 | 0 |
| mega_exposition_2 | 170 × 120 | 57.0 | 4552 | 0 |
| mega_exposition_3 | 170 × 120 | 74.0 | 4414 | 0 |
| link_conveyor | 3 × 12 | 7.7 | 300 | 0 |
| link_pipe | 3 × 12 | 7.7 | 144 | 0 |
| link_tower | 6 × 6 | 11.2 | 170 | 0 |
| link_load | 1 × 1.4 | 0.6 | 24 | 0 |
| link_flow | 0.951 × 0.9 | 1.0 | 36 | 0 |
| schoolhouse | 24 × 32 | 12.4 | 1776 | 0 |
| church | 24 × 40 | 30.6 | 1582 | 0 |
| bandstand | 32 × 32 | 9.7 | 2266 | 0 |
| postoffice | 24 × 24 | 13.9 | 1340 | 2 |
| firehall | 24 × 32 | 22.8 | 1422 | 2 |
| library | 32 × 32 | 17.8 | 1860 | 0 |
| watertower | 24 × 24 | 31.0 | 2314 | 0 |
| picturehouse | 32 × 32 | 20.4 | 1934 | 0 |
| countyhospital | 40 × 40 | 21.1 | 2316 | 8 |
| ballpark | 48 × 40 | 19.0 | 2476 | 0 |
| clocktower | 40 × 40 | 39.6 | 2460 | 0 |
| markethall | 48 × 40 | 20.6 | 2376 | 0 |
| terrace_b | 24 × 17 | 10.9 | 804 | 2 |
| terrace_c | 24 × 17 | 15.1 | 824 | 2 |
| terrace_s | 24 × 17 | 15.4 | 378 | 1 |
| terrace_n | 24 × 17 | 16.0 | 606 | 1 |
| terrace_t | 24 × 17 | 10.3 | 1546 | 4 |
| apartments_b | 30 × 30 | 14.8 | 808 | 4 |
| apartments_m | 30 × 30 | 22.6 | 872 | 3 |
| apartments_n | 30 × 30 | 19.1 | 614 | 3 |
| apartments_s | 30 × 30 | 26.9 | 778 | 1 |
| modernflats_b | 30 × 30 | 24.4 | 1612 | 4 |
| modernflats_m | 30 × 30 | 29.5 | 1166 | 3 |
| highstreet_b | 18 × 20 | 10.3 | 758 | 3 |
| highstreet_c | 18 × 20 | 6.9 | 780 | 3 |
| highstreet_d | 18 × 20 | 13.3 | 796 | 3 |
| shop_b | 18 × 20 | 14.1 | 386 | 1 |
| shop_c | 18 × 20 | 14.4 | 400 | 1 |
| shop_t | 18 × 20 | 17.3 | 628 | 1 |
| shop_u | 18 × 20 | 14.8 | 484 | 1 |
| store_b | 30 × 28 | 12.3 | 1266 | 5 |
| store_c | 30 × 28 | 12.1 | 844 | 5 |
| store_d | 30 × 28 | 21.6 | 1094 | 5 |
| store_e | 30 × 28 | 15.2 | 1054 | 5 |
| store_m | 30 × 28 | 20.9 | 502 | 3 |
| store_n | 30 × 28 | 20.9 | 886 | 3 |
| office_b | 20 × 22 | 20.4 | 520 | 3 |
| office_c | 20 × 22 | 18.6 | 832 | 3 |
| office_t | 20 × 22 | 19.7 | 916 | 3 |
| office_u | 20 × 22 | 17.9 | 956 | 3 |
| office_s | 20 × 22 | 21.3 | 712 | 1 |
| mall_b | 48 × 40 | 13.9 | 1324 | 8 |
| mall_c | 48 × 40 | 27.6 | 1734 | 8 |
| tower_b | 30 × 30 | 52.1 | 1052 | 4 |
| tower_t | 30 × 30 | 43.8 | 1346 | 4 |
| tower_u | 30 × 30 | 48.9 | 1162 | 4 |
| glasstower_c | 30 × 30 | 77.1 | 1434 | 4 |
| glasstower_b | 30 × 30 | 90.2 | 1374 | 4 |
| glasstower_m | 30 × 30 | 93.6 | 1068 | 2 |
| aptower_b | 30 × 30 | 58.3 | 1308 | 4 |
| aptower_m | 30 × 30 | 68.9 | 916 | 2 |
| house_d | 12.05 × 15 | 8.0 | 444 | 1 |
| house_e | 12.05 × 15 | 5.9 | 580 | 1 |
| telegraphpole | 2.1 × 0.385 | 8.4 | 162 | 0 |
| telegraphwire | 1.935 × 1 | 1.3 | 192 | 0 |
| billboard_a | 7.72 × 2.44 | 5.5 | 520 | 0 |
| billboard_b | 7.72 × 2.44 | 5.5 | 460 | 0 |
| billboard_c | 7.72 × 2.44 | 5.5 | 528 | 0 |

## Vehicles

The vehicles of 1925-1940 (`tools/blender/vehicles_*.py`). Front at glTF +Z (Blender -Y), origin at the
ground centre, wheels on y = 0; each keeps the footprint and the axles the simulation drives. One mesh
node `model` with a material per colour; the cars, the van and the Motor Works car also have a node
`far`, a few boxes drawn instead once a car is a handful of pixels long. A material's name is its role:
`body`, `second` and `cargo` are white and tinted per vehicle (its paint; a car's wings or a lorry's
lettering colour; the load, tilt or tank). `lamp` and `tail` are the lenses the night's lights hang on,
`beacon` flashes, and every other (`v_glass`, `v_black`, `v_tyre`, `v_chrome`, `v_wood`, ...) keeps the
colour it was given. Limits (`VEHICLE_TRIS`): 420 triangles a car, 700 the bus and the escort car, 880
a lorry, a trailer or a convoy piece, 110 a far model.

| model | W × L × H (m) | tris | far tris | nodes |
|---|---|---|---|---|
| car | 1.85 × 4.4 × 1.7 | 392 | 60 | `far`, `model` |
| van | 2 × 5 × 2.04 | 396 | 60 | `far`, `model` |
| truck | 2.5 × 8.51 × 2.864 | 472 |  | `model` |
| tipper | 2.7 × 8.51 × 2.85 | 520 |  | `model` |
| tanker | 2.46 × 8.51 × 2.95 | 592 |  | `model` |
| flatbed | 2.52 × 8.51 × 2.6 | 568 |  | `model` |
| heavy_truck | 2.7 × 12 × 3.34 | 668 |  | `model` |
| heavy_tipper | 2.7 × 12 × 3.34 | 728 |  | `model` |
| heavy_tanker | 2.7 × 12 × 3.4 | 784 |  | `model` |
| heavy_flatbed | 2.7 × 12 × 3.34 | 824 |  | `model` |
| rt_tractor | 2.7 × 6.4 × 3.4 | 516 |  | `model` |
| rt_truck_a | 2.54 × 9.4 × 3.564 | 372 |  | `model` |
| rt_truck_b | 2.54 × 10 × 3.564 | 348 |  | `model` |
| rt_tipper_a | 2.7 × 9.4 × 3.34 | 408 |  | `model` |
| rt_tipper_b | 2.7 × 10 × 3.34 | 396 |  | `model` |
| rt_tanker_a | 2.44 × 9.4 × 3.65 | 468 |  | `model` |
| rt_tanker_b | 2.44 × 10 × 3.65 | 440 |  | `model` |
| rt_flatbed_a | 2.52 × 9.41 × 2.74 | 504 |  | `model` |
| rt_flatbed_b | 2.52 × 10.01 × 2.74 | 540 |  | `model` |
| reefer | 2.58 × 8.51 × 2.92 | 496 |  | `model` |
| heavy_reefer | 2.7 × 12 × 3.37 | 668 |  | `model` |
| rt_reefer_a | 2.58 × 9.4 × 3.62 | 372 |  | `model` |
| rt_reefer_b | 2.58 × 10 × 3.62 | 324 |  | `model` |
| carrier | 2.58 × 8.51 × 3.85 | 568 |  | `model` |
| heavy_carrier | 2.7 × 12 × 3.95 | 860 |  | `model` |
| rt_carrier_a | 2.58 × 9.4 × 4.1 | 444 |  | `model` |
| rt_carrier_b | 2.58 × 10 × 4.1 | 516 |  | `model` |
| motorcar | 1.84 × 4.92 × 1.55 | 356 | 60 | `far`, `model` |
| bus | 2.575 × 12.17 × 3 | 670 |  | `model` |
| escort_car | 1.9 × 4.6 × 2.18 | 504 |  | `model` |
| ll_tractor | 2.64 × 6.608 × 3.48 | 560 |  | `model` |
| ll_trailer_turbine | 3.4 × 14.01 × 4.39 | 816 |  | `model` |
| ll_trailer_girder | 2.524 × 14.01 × 3.59 | 772 |  | `model` |
| car_coupe | 1.85 × 4.4 × 1.68 | 380 | 60 | `far`, `model` |
| car_tourer | 1.85 × 4.4 × 1.4 | 412 | 36 | `far`, `model` |
| car_pickup | 1.85 × 4.4 × 1.64 | 420 | 58 | `far`, `model` |

# Trafficity teardown → what we keep, what we fix

Sources: Orbital Potato's 65-min pre-release playthrough (main source: full caption track + ~60 stills at every complaint), the official trailer, five dev shorts (stack, highway, cloverleaf, double trumpet, wide road).

## What Trafficity is (keep all of this)

- **View**: straight-down camera, flat pastel map (cream ground `#ECEAE0`, grass `#C3F08F`, sand `#F2E7A8`, water `#9DB8F5`), terraced grey mountains, soft long shadows to the lower right. Buildings are simple extruded blocks coloured by zone (green homes, blue shops, purple offices, grey/orange industry). Roads are near-white with a grey kerb outline, yellow centre line, dashed lane lines; elevated decks get a black edge and a drop shadow.
- **Loop**: each *City Level* hands you a budget ($8,000 road money), a list of buildings to place, sometimes a map-tile unlock. Objectives: *all buildings placed*, *a trip taken by every new resident*, *≥ X% building satisfaction*, *≥ X% traffic flow* (95 → 88 % as levels grow). Hit them all → next level.
- **Buildings** must face a road. Residents make journeys (visit nearby shop, target ≈ 80–90 s; visit workplace, target 150 s). Satisfaction = journey times vs target, access to commercial / workplaces / workers / input resources, air pollution, road noise. Industry chains: mine/farm → factory → consumer goods → commercial, carried by trucks. Mines must sit against a mountain.
- **Road tools**: single-lane one-way, 2-lane, 4-lane, 6-lane two-way, 2- and 3-lane one-way; straight / curve mode; elevation 0–3 (R/F); grid tool (density, one-way/two-way); roundabout ($500); traffic lights with a phase editor and lane-connection editor; keep-clear boxes; traffic eraser; bulldozer with an elevation filter and partial refund. Drawing alongside a road adds lanes / slip roads.
- **Feedback**: preview is translucent cyan when valid, dark red when not, with chips for cost, angle, length and the error. Overlays (traffic flow, satisfaction, access, pollution, noise) colour buildings and roads. Clicking a building shows each resident's journeys: time, penalty, total, target.

## What breaks in the footage (fix every one)

| When | What happened | Our fix |
|---|---|---|
| 2:34, 19:40, 44:00 | Grid tool lags, scrolling lags, game freezes while editing | Incremental network rebuild (only touched nodes), chunked road meshes, one draw call per vehicle model, sim on a fixed tick decoupled from rendering |
| 4:15, 9:00, 9:30, 19:15, 43:50, 45:30 | "Building is in the way" with no clue which building; hitboxes far larger than the art | Tight footprints = what you see. The blocking building flashes red and the chip names it |
| 7:40 | Roads can't be built opposite houses | Only the real footprint blocks; driveways don't |
| 12:00, 17:00 | Can't tell why traffic flow is 93 % | Flow is measured per road, the objective's magnifier jumps to the worst spot, the overlay shows it |
| 13:40, 42:50, 46:30, 50:00 | Edits break the simulation, a reload "fixes it" | Vehicles survive edits: re-mapped onto split roads, re-routed when their path changes, removed only if their road is deleted |
| 21:15 | Every car wobbles after an edit | Positions are arc-length on stable lane curves; edits never move existing lane geometry outside the touched junctions |
| 27:00–38:00, 48:00–52:40 | "Can't build slip road", "connection isn't long enough", "overlaps existing road", "do that in two moves", "ramp too short" | One general road tool: any road can start or end on any road at the same height; the junction works out lanes. The preview shows the minimum ramp length live, and errors say what to change |
| 41:00 | "How do I delete traffic lights?" → bulldozed the whole junction | Click a junction → panel: signals on/off, phase timings. Bulldozing a signalled junction removes just the signals first |
| 41:50 | "This roundabout is not real" — ghost roundabout after deletion | Roundabouts are ordinary roads + junctions, so deleting them leaves no hidden state |
| 39:20, 53:00, 54:30, 55:40, 59:40 | Gridlocks; lead car "refuses to turn in" and holds everything; only fix is the traffic eraser | Don't-block-the-box everywhere, gap acceptance with growing impatience, and a car stuck in the wrong lane re-routes instead of waiting forever |
| 52:40 | Wrong elevation level selected, confusing | Snapping to a road adopts its height; the elevation is shown on the preview |
| 47:40 | Bulldozing needed "delete at one height" | Bulldozer highlights exactly what's under the cursor (top deck first) before you click |
| 30:00, 53:00 | Can't make a 2-lane roundabout; multi-lane roads pointless because every car queues in one lane | Roundabouts come in 1- and 2-lane sizes; cars pick lanes for their next turn and spread over the free ones |
| 14:30 | Cars reverse-park in lots, slowing the main road | Cars pull off the road onto the driveway with no reversing on the carriageway |
| 58:00, 63:50 | No fast-forward | Pause / 1× / 2× / 4× |
| 50:20 | Saving sometimes crashes | Saves are plain JSON of the network + buildings + progress, validated, with autosave and a backup slot |
| 17:30 | Forced zoom-out, then nothing is readable | No forced camera moves; at far zoom cars and roads stay legible |

## The player's suggestions we *don't* take

- "Use six-lane roads by default" — he takes it back immediately; capacity isn't the puzzle, junctions are.
- Erasing traffic as a routine fix — if that's needed the sim is broken. We keep the eraser out of the base game.
- Vehicle-class restrictions ("only lorries through here") — a nice later feature, not base.
- Tunnels through mountains — later; mountains stay as the map's hard constraint.

## Base-game scope (this milestone)

Map + tile unlocks, the full road toolset above (minus lane-connection editing and keep-clear, which become automatic), the zone set (homes S/M/L, shops S/M/L, offices S/M, copper mine, farm, two factories), trucks for the goods chain, satisfaction and flow, ten City Levels, overlays, save/load, undo/redo.

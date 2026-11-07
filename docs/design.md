# Kilometre Zero: design

An industrial company on a road map.

Decided 2026-11-07 with the owner. You run an **industrial company**. You claim deposits, build big extractors
and plants, found towns that grow on their own, and draw the roads that tie it all together. Freight routes
itself; your job is the network and the buildings. References: Captain of Industry for resources and chains,
Transport Fever 2 for self-growing towns with needs, Cities: Skylines 2 only for roads, traffic and controls.
Our own names, look and art throughout.

## Pillars

1. **Roads are the logistics.** Trafficity-grade road tools and a lane-level traffic sim. Every load is a real
   truck in traffic and every worker a real commuter, so a good junction or highway is directly more output.
2. **Far apart on purpose.** Each resource lives in its own regions, kilometres from the others. Getting every
   chain running takes tens of kilometres of road over a playthrough.
3. **Deep chains, visible.** Every building shows what it is short of and why: workers, an input, trucks,
   power, a buyer, or a jammed road.
4. **A long game with no waiting.** Many unlocks across many company levels, several things worth doing at any
   moment, and no idle stretches spent waiting for money.

## The map

- An endless procedural world in 640 m tiles. Roads can go anywhere. Buildings need land the company owns:
  tiles are bought next to land you own or along your roads, and company levels raise how many you may own.
- **Deposits** sit in distinct regions that never run out, spread by tier:

  | Tier | Deposit | Where | Distance from start |
  |---|---|---|---|
  | 1 | Fertile soil (crops), forest (logs) | river plains, forest belts | within 1-3 km |
  | 2 | Iron ore, coal, limestone | foothills of the ranges, each its own field | 3-8 km |
  | 3 | Oil, sand | oil basins; river and lake shores | 6-15 km |
  | 4 | Copper ore | high ranges | 10-20 km |

  Every kind recurs further out, so later sites can be chosen for convenience. Two different kinds are never
  next to each other: the chains are always a drive apart.
- No outside world: no gateway cities, imports or exports. Your towns and your own plants are the only
  customers. The start is an empty region with one small town and a few hundred metres of road.

## Chains

| Tier | Extractors (on a deposit) | Plants |
|---|---|---|
| 1 | Farm: crops. Logging camp: logs | Food plant: crops to food. Sawmill: logs to planks |
| 2 | Iron mine: iron ore. Coal mine: coal. Quarry: limestone | Smelter: iron ore + coal to steel. Cement works: limestone + coal to cement. Power plant: coal to power |
| 3 | Oil well: crude. Sand pit: sand | Refinery: crude to fuel + plastics. Glassworks: sand + coal to glass. Furniture factory: planks + glass to household goods. Construction plant: steel + cement to construction parts |
| 4 | Copper mine: copper ore | Copper smelter: copper ore + coal to copper. Electronics: copper + plastics to electronics. Machine works: steel + copper to machinery |

- Each building has jobs, input stores, output stores and a rate. Rate = base x staffing x inputs on hand
  (x power, from tier 2). A full output store stops production, and the building says so.
- **Sizes:** each building can be upgraded twice (more output, jobs and truck bays) once the company level
  allows it.
- **Construction:** tier 1 buildings cost money only. From tier 2 a new plant or upgrade is a site that waits
  for materials trucked to it: planks (tier 2), planks + cement (tier 3), construction parts (tier 4).
- **Power** runs along the roads from power plants that burn coal brought by truck.

## Freight (routes itself)

- Every building owns trucks (two to start; it gets more bays as the company level allows). A truck loads
  output, drives it over your roads to a customer, unloads and comes back. Throughput is trucks x round-trip
  time, which is why road design matters.
- Destinations are automatic. Your own plants short of an input come first, then towns that need the product,
  nearest and neediest first. You never draw lines; you can block a destination for a building if you need to.
- Truck classes unlock over the levels: light truck, heavy truck, road train, plus tankers (crude, fuel),
  flatbeds (logs, steel) and tippers (ore, coal, sand, limestone).
- **Fuel** is a running cost per km at a market price. Once your refinery stocks your fuel depots, trucks that
  pass one fill up there at cost.
- **Warehouses** (tier 2) buffer any product and re-ship it, so long chains can be split into legs.

## Transport modes

Every mode makes roads matter more: it crosses them, feeds them, or forces new junctions. Freight still routes
itself across modes; you build tracks, docks and the transfer points, never lines.

- **Trucks** (from the start): the base layer and the last mile everywhere.
- **Freight rail** (late: after a long road-and-truck first half, around tier 4): tracks drawn with the road tools (curves, heights, bridges, tunnels).
  Stations at plants and towns, each fed by trucks. One train carries 20+ truckloads, which is the answer to the
  exponential demand. **Level crossings** stop road traffic while a train passes; busy ones jam until you
  replace them with a bridge.
- **River barges** (late game): docks on rivers and lakes. Barges are slow and carry enormous loads. Bridges over
  navigable water need clearance: build them high, or build **lift bridges** that open for barges and stop
  the traffic on them.
- **Workers** ride buses only. Commuters stay on the roads, competing with trucks.

## Towns (like Transport Fever 2)

- Found a town by picking a spot. It lays out its own streets, growing outward in a rough circle, and joins
  them to your roads where they meet. Houses and shops build themselves along its streets. How many towns you
  can run grows with company level.
- Every resident is simulated: a home in a town, a job at one of your buildings within reach, a commute in
  traffic. Buses carry workers to plants and take cars off the roads your trucks need.
- **Needs** open with town size, and a town grows past each size only while that tier is supplied:

  | Size | Population | Needs |
  |---|---|---|
  | Hamlet | 0+ | food |
  | Village | 300+ | + building materials (planks, later cement) |
  | Town | 1,500+ | + household goods and fuel |
  | City | 6,000+ | + electronics and machinery |

  Supply is the share of each need delivered over the last day. Good supply speeds growth, bigger and denser
  buildings, and more workers; shortfalls stall growth and finally shrink the town.
- Deliveries go to the town's shops, filling stations and building sites, so trucks drive into town streets.
- No city services, taxes, policies or zoning.

## Company

- Income: payment for every load delivered to a town. Plant-to-plant transfers earn nothing; they keep the
  chain running.
- Costs: roads (build and upkeep), buildings and upgrades, wages, trucks, fuel, land. Loans exist; going
  bankrupt ends the game.
- The company panel is a balance sheet: income and costs per building and per product, profit per plant, fleet
  use, and town supply.

## Milestones

Unlocks come from **milestones**, concrete achievements, never from cumulative XP. Examples:
- a town reaches Village;
- 20 loads of food delivered in a day;
- three towns supplied with every need of their size;
- a day's delivered value passes a threshold.

There are about 40 milestones in a rough ladder, with a few open at once so there is always a choice of what to
chase next. Each unlocks something concrete: a chain, a building size, a truck class, a road type or junction
tool, town slots, land, warehouses, fuel depots. The last ones unlock **company projects**: huge buildings that
take hundreds of mixed loads, as long-term goals and goods sinks.

**Order of the long game:** the first half is a pure road-and-truck game. Tiers 1-3 chains, truck classes, every
road type, highways and interchanges all come before trains. **Freight rail unlocks late** (around tier 4, when
demand has outgrown even road trains on a good highway network), and barges after it.

## Pacing (no waiting)

- At every stage there should be at least three useful things to do: something new to build, a bottleneck to
  fix, and a town to supply or found.
- Early income is quick (tier 1 sells to the first town), so the first hour flows: road to the farm, food
  plant, first deliveries, second town, sawmill.
- The bottleneck moves on its own: more towns mean more commuters on the roads trucks use, and longer chains
  mean longer trips, so road work keeps being needed.
- **Demand rises exponentially.** From the mid game it should be obvious that each town size multiplies its
  needs (per-resident use rises with size, and towns grow faster when supplied). In the long road phase that
  means bigger trucks, more of them, highways and interchanges; only once volumes outgrow even that do rail
  trunks with truck feeders arrive, then barges. The late game is borderline-madness logistics: huge flows,
  terminals jammed by feeders, crossings to grade-separate.
- Speed controls up to very fast; the sim must stay smooth at that speed.

## Roads (core features from mods)

- Existing tools stay: draw straight/curve/S, height levels, bridges/ramps, roundabouts, grids, upgrade,
  reverse, bulldoze. Road types: street, avenue, boulevard, one-way 1/2, highway 2/3/4, plus rural road and
  gravel road.
- Ideas taken from popular mods:
  - **Lane connector**, **priority signs** (stop/yield/priority road), **turn restrictions** and a
    **traffic light editor** with timed and actuated phases (from the Traffic mod).
  - **Move nodes and curves** of built roads (from Move It).
  - **Parallel and offset drawing**, snapping guides and angle/length readouts (from the line tools).
  - **Area bulldoze** and per-element bulldoze (from Better Bulldozer).
  - **Custom road configurator** for lane counts, median and speed (from Road Builder), at a later milestone.
- Traffic info views: flow per road, congestion hotspots, routes through a selected road or building, and a
  journey breakdown per resident.

## Controls and road building (owner, 2026-11-07: "exactly like Cities: Skylines 2")

Controls follow CS2's defaults. Trafficity's systems stay only where they are better than CS2: undo/redo,
height levels shown while drawing, and the instant upgrade preview.

**Camera:**
- W/A/S/D pan; edge scroll is optional.
- Q/E rotate; middle-mouse drag rotates.
- R/F and the mouse wheel zoom.
- Right-drag pans the map (left-drag too while nothing is being drawn).
- The view is 2D top-down, so there's no tilt (T/G). A north arrow appears while the map is turned; clicking it
  turns the map back north-up.
- Touch: one-finger drag pans, two-finger pinch zooms and twists to rotate.

**Tools:**
- Left mouse applies the tool.
- Right mouse goes back one step (a road in progress loses its last click; with nothing left it ends the chain).
- Esc closes an open panel, else leaves the tool.
- Tab / Shift+Tab cycle the road modes.
- B selects the bulldozer.
- Page Up/Page Down change elevation, in steps shown as a height in metres.

**Simulation:** Space pauses; 1/2/3 set normal, fast and very fast speed.

**Panels:**
- M: map tiles. P: progression; Z: economy; C: city info; V: statistics; X: transportation, as those panels
  arrive.
- F5/F9: quicksave and quickload.
- ` (backtick): hide the UI.
- Ctrl+Z / Ctrl+Y: undo and redo. CS2 has none; this is kept from Trafficity.

**Road tool modes** (a mode bar inside the road panel):
- Straight: two clicks.
- Simple Curve: three clicks (start, bend, end).
- Complex Curve: four clicks (start, two bends, end).
- Continuous: clicks keep chaining curves.
- Grid: three clicks (corner, width, length).
- Replace: hover a road and click to change its type or upgrades; right-click a feature to remove it.

**Parallel:** a toggle with a spacing ([ and ] or the − / + buttons; default is the two roads side by side with a
4 m median) that works with every drawing mode. The twin goes on the left of the drawn direction; one-way twins
run the other way, so a one-way pair is a dual carriageway in one stroke. Its ends join the road the main stroke
starts or ends on, and each new piece carries on from the last twin.

**Snapping:**
- A menu of toggles: existing roads and junctions, guidelines and right angles, alongside other roads, and 8 m
  length steps (off by default; the others default on). Zone-grid and building-side snapping come with zoning.
- Shift gives 15° angle steps.

**Readouts:** next to the cursor while drawing, show length, slope %, angle to the road you connect to, and cost.

**Intersections, roundabouts and ramps:**
- Roads crossing at the same elevation make intersections automatically.
- Roundabouts come in four sizes (small 1-lane ring, medium and large 2-lane, huge 3-lane) and are placed on an
  existing junction or on empty ground.
- Prefab interchanges (trumpet, diamond, cloverleaf) are a later milestone.
- Ramps are one-way roads that join a carriageway with a merge, not a stop.

## Look

Realistic top-down, straight down, the owner's chosen direction (2026-11-07): dry olive grassland with large soft
patches and fine specks, scattered round trees and shrubs with soft shadows cast down-right, dark charcoal
asphalt with crisp markings (double yellow centre lines on two-way roads, white dashed lanes, stop bars, zebra
crossings, rounded kerbs and light verges), dense small realistic cars and trucks with shadows, rail on gravel
beds. A muted, satellite-like but clean palette, in our own models and colours. Buildings are Blender models
in the same realistic register, with deposit regions readable on the ground. Clear company HUD (money and
milestones at the top, build categories at the bottom: roads, extraction, plants, logistics, towns), inspector
panels, no generic AI look.

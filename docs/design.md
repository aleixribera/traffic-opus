# Design: regional multi-city builder

Decided 2026-11-07 with the owner. The rule for anything not listed: do it the way Cities: Skylines 2 does,
and make the fixes from CS2's most popular mods core features. Our own names, look and art throughout.

## Pillars

1. **Roads are the game.** Trafficity-grade road tools (curves, heights, bridges, ramps, roundabouts, signals,
   upgrades) and a lane-level traffic sim. No glitches, no odd angles, no surprising connections, and it must be
   intuitive. Every other system exists to create traffic or depend on it.
2. **Cities, plural.** One large continuous region. The player founds several cities, grows big ones, and ties
   them together with highways. People commute between cities and goods are trucked between them.
3. **Cause you can see.** Every number has a breakdown (Info Loom-style). If a factory closes, the player can see
   that it's short of workers and where the workers are.

## Region (owner, 2026-11-07: "almost infinite", "massive highways and interchanges should be the main focus")

- **Endless procedural world.** Terrain is generated in 1 km chunks on demand, deterministic from the seed,
  with level-of-detail rendering from street level out to tens of kilometres.
- **Large-scale geography with distinct regions**, so there are reasons to build far away:
  - River valleys with fertile farm plains.
  - Forest belts.
  - Mountain ranges holding ore, kilometres from the start.
  - Rare oil fields.
  - Lakes and scenic hills.
  Polluting industry also wants to sit far from homes.
- **Land**: 640 m tiles. Roads can be built anywhere. Zoning and buildings need owned tiles. A tile can be bought
  when it's next to land you own or one of your roads runs through it. Price rises with the number owned.
  Milestones raise how many tiles you may own.
- **Gateway cities**: big outside cities (port, capital, industrial hub, farm town...) placed far apart
  (10-40 km). They act as outside connections:
  - Imports, exports, migrants and tourists come and go through them.
  - Each one wants different goods and pays its own prices.
  The start has one pre-built motorway to the nearest gateway (as in CS2). Linking the others with your own
  motorways and interchanges opens their trade. This is the road-centred long game.

## Cities

- A city is founded by placing a **City Hall**: name, colour, and a city area (radius grows with population;
  areas never overlap). Zoning needs a city area. Extraction industry and roads can go anywhere you own.
- One shared treasury (CS2 has one budget). Taxes are set region-wide per zone, with optional per-city overrides.
- Each city has its own population, demand, milestones-progress panel, specialisation and statistics.
  Region milestones count total population and unlock new City Hall slots.
- **Specialisations**: when a city's output in one chain passes thresholds it becomes e.g. a Farming / Forestry /
  Mining / Oil / Manufacturing / Tech city: +productivity in that chain and a signature building.

## Zoning (CS2)

- Zone cells (8 m) appear along both sides of roads that allow access, 6 cells deep, following curves.
  Overlapping cells resolve oldest-first. Cells under roads, water, steep ground or other lots are disabled.
- Tools: paint brush, fill along a road, marquee, unzone. Zoning can be switched off per road side
  (Zoning Toolkit).
- Zone types: Residential, Commercial, Industrial and Office, each in Low and High density, plus Extraction zones
  painted only on resource ground (CS2 specialised industry areas).
- Buildings **grow on their own** when their zone has demand: they pick a lot of contiguous cells, are built,
  and **level up** (1-5) with land value. They are abandoned when they fail economically, then demolished
  automatically.

## People and economy (CS2 + Realistic Workplaces/Households + Time2Work)

- Households live in homes. Households and workplaces scale with building volume (no 2-job skyscrapers).
- Each resident has a home, a job found by commute time (they may work in another city), education level and
  schedule. Work shifts are staggered, so there are morning and evening rush hours, quieter weekends and some
  night shifts.
- Trips: commute, shopping, leisure, deliveries, service calls, imports and exports. Each car on screen is a real
  trip by a real household or company. At large populations one vehicle trip may stand for one household's
  shared trip; the scale is shown in statistics.
- **Demand** (bars per zone, each with a factor breakdown):
  - Residential: free jobs within reach, taxes, services and attractiveness.
  - Commercial: resident spending vs shop capacity.
  - Industrial: goods needed by shops, other industry and exports, vs available workers.
  - Office: educated workers.
- **Businesses** earn from sales and pay wages, rent and taxes. A workplace that can't fill its jobs or sell its
  output loses money, and is abandoned after a while. Too many factories and too few workers means factories
  close (owner's example).
- Land value comes from road access, services coverage, parks and nearby shops, minus pollution and noise. It
  drives leveling and rent. Proximity matters only here, through these CS-style effects.
- Budget: tax income by zone, road and service upkeep, loans. You lose by going bankrupt.

## Industry (CS2)

- Raw (extraction zones on deposits): Crops, Wood, Ore, Oil. Ore and oil deposits deplete.
- Processing (Industrial zone; each building picks a product by demand):
  - Food comes from crops.
  - Paper and timber come from wood.
  - Metals come from ore.
  - Petrochemicals come from oil.
- Manufacturing (Industrial High):
  - Electronics: metals + petrochemicals.
  - Furniture: timber + metals.
  - Vehicles: metals + petrochemicals.
- Commercial sells food, retail goods (furniture, electronics, paper) and fuel. Offices produce services that
  boost industry productivity in their city.
- Cargo moves by truck from producer to the nearest consumer with demand, or out through outside connections
  for export. Missing inputs are imported (dearer). Warehouses buffer stock (later milestone).

## Services (traffic-generating only)

Garbage, fire, police, health, education (school and university; offices need educated workers) and parks.
- **Coverage is measured by road travel time**, so service buildings dispatch vehicles that use your roads.
- **Buses**: a line tool, stops and depots.
- **Road maintenance**: roads wear with heavy-vehicle traffic, and maintenance trucks repair them.
- No water, power, sewage or deathcare.

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

## Progression (CS2 milestones by population)

- 0: streets, low-density R/C/I, City Hall #1, garbage.
- 240: avenue, roundabouts, signals, police, fire, health, extraction (farming).
- 1k: second city, forestry, buses, education (school), one-way 2.
- 2.5k: highways and ramps, office low, ore, warehouses.
- 5k: high-density R/C, oil, university.
- 10k: third city, manufacturing, office high, boulevard.
- 20k / 40k / 80k / 150k / 250k: more city slots, tiles, signature buildings and region projects.

Each milestone also grants money and tile slots.

## Look

Top-down orthographic 3D with low-poly Blender models (current style), polished:
- Day/night lighting, zone tints, soft shadows.
- Building variety per zone, density and level.
- Clear CS2-like HUD: top bar (city switcher, population, money, time); bottom tool categories; info views;
  inspector panels.
- No generic AI look.

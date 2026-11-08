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
5. **Hard because of traffic, never because of money** (owner, 2026-11-08). Money comes easily from playing and
   snowballs: the late game has far more than it can spend. The difficulty is throughput. Towns always want
   more than the roads can carry, so the limit on income is how many loads get through, and the game is a
   constant cycle of finding the jam and fixing it.

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
- **Sites (owner, 2026-11-08):** every extractor and plant is a big fenced complex, about 5x the old lots:
  plants roughly 160-220 m on a side, farms, pits and the refinery up to ~300 m. A deposit (600-800 m across)
  holds one or two. See "Industry sites" below.
- **Construction:** tier 1 buildings cost money only. From tier 2 a new plant is a construction site that waits
  for materials trucked to it: planks (tier 2), planks + cement (tier 3), construction parts (tier 4).
- **Power** runs along the roads from power plants that burn coal brought by truck.

## Industry sites (owner, 2026-11-08)

- **Placed anywhere, connected later.** A site can go down with no road near it: you place it free-standing
  (`,` and `.` turn it in 15 degree steps; with a road close by it turns its gate to face it). Its **gate** is
  the middle of one side, marked on the map while it has no road. Any road that passes the gate or ends in front
  of it (within ~12 m) connects it; the site says "Connected" and its trucks start. Until then it shows
  "No road to the gate" and does nothing but wait.
- **Four levels, growing by themselves (like TF2).** Level 1 is the core plant by the gate with its truck yard,
  about a fifth of the plot; levels 2-4 fill the plot to roughly 45%, 70% and full. A site grows one level when
  it has run near its capacity for a sustained stretch (most of a few in-game days) with its output being
  shipped, and its inputs coming in for a plant. It never shrinks (an idle site simply stops). Each level
  multiplies output, jobs and trucks (x1, x2, x3, x4.5 of the level-1 rate).
- **Look.** A fence round the plot, natural ground inside, internal service roads from the gate, and faint
  concrete pads where the next level's buildings will stand, so you can read what the site will become. Every
  building on a site is a Blender model in the usual lot style (pad, front apron facing an internal road): the
  kind's own model is the core; the rest are repeats of it and shared support models (halls, silos, tanks,
  heaps tinted to the material, offices, workshops, truck yards; fields for farms, log yards for camps).
- **Trucks** stop at the truck yard by the gate; internal movement isn't simulated.
- **Towns** never grow into a site's fence.
- **Land:** a site needs only the tile under its centre (a 290 m plot spans several 640 m tiles; owning every one
  made land, not traffic, the wall by day 8).

## Freight (routes itself)

- Every site runs its own fleet, which comes with its level: nothing to buy, no trucks to manage (owner,
  2026-11-08). At each level it has enough trucks to carry everything the site makes 3 km away and back over
  streets (FLEET_HAUL); bigger loads, truck classes and faster roads stretch the same fleet further. Idle trucks
  wait in the yard, so a big fleet on a short haul adds no traffic. A truck loads output, drives it over your
  roads to a customer, unloads and comes back. Past the haul it was sized for, or on a jammed road, the yard
  fills: the fix is the road, never a purchase.
- Destinations are automatic. Your own plants short of an input come first, then towns that need the product,
  nearest and neediest first. You never draw lines; you can block a destination for a building if you need to.
- **Truck classes** unlock over the levels, and every fleet moves up on its own (owner, 2026-11-08: no truck
  micromanagement). Once a milestone unlocks heavy trucks or road trains, every building's new trips use the
  best class unlocked; trucks already on the road finish their trip as they are. Nothing to buy or pick per
  building: the panel shows the class read-only. The class sets the load and the road it takes; the body still
  comes from the product: tankers (crude, fuel, chemicals, cement), flatbeds (logs, planks, steel, parts),
  tippers (ore, coal, sand, limestone, gravel), box trucks for the rest.

  | Class | Loads a trip | Length | Speed / pull-away | Load x speed per truck | Fuel per km |
  |---|---|---|---|---|---|
  | Light truck | 1x | 8.5 m | 85% / 1x | 0.85 | 1x |
  | Heavy truck (four-axle rigid) | 2x | 12 m | 82% / 0.8x | 1.64 | 1.5x |
  | Road train (tractor + two trailers) | 4x | 22 m | 75% / 0.6x | 3.0 | 2.6x |

  Each step up roughly doubles what one truck moves, so the same flow puts fewer trucks on the road: that is
  the traffic payoff. Moving up costs no money (pillar 5) and fuel per load falls. What it costs is road: a
  road train waits for half a load before it sets off, takes a long time to clear a junction, and fills a ring.
- **Long vehicles in traffic.** A heavy or a road train is drawn piece by piece along the path its front drove,
  so trailers cut corners through a turn. The sim keeps the whole body in mind, not just its front:
  - a junction movement stays reserved until the last trailer has left it, and its tail blocks the lanes and
    connectors it still covers;
  - turns that pass close without crossing (closer than 3.5 m, or 4.3 m for two curved turns) conflict when
    one of the vehicles is long;
  - a roundabout counts its load in car-sized slots, so a road train counts as about three cars and a heavy as two. It won't enter unless the
    ring has room for its whole length, counting the long trucks already waiting at the other entries;
  - a lane change needs a gap beside its whole length;
  - one long truck at a time pulls out of a lot's gate: the next waits in the yard until the last trailer
    has cleared the kerb.
- **Fuel** is a running cost per km at a market price ($4 per light-truck km, both ways). Once your refinery's
  tankers stock a **fuel depot**, every truck whose run passes within 1.5 km of it fills up there at cost
  ($1 per km): one load of fuel lasts 400 light-truck km. The depot's panel shows its fuel, the trucks it
  filled and the money saved.
- **Warehouses** (tier 2) store any product and re-ship it with their own trucks (a fleet that comes with its
  size, like a plant's), so long chains can be split
  into legs. A load's destination comes in this order: a plant short of the input, then a town that needs it,
  then a warehouse with room as overflow, never another warehouse. The exception is a warehouse set as a
  **feeder** for the product: it comes first when it is nearer than where the load would otherwise go. In
  the panel the player picks the products it takes (all by default) and the ones it feeds, and sees the stock.
- **Unlocks:** heavy trucks with "Heavy haulage" (after "Lights on"), warehouses with
  "Stockpiles" (tier 2), depots with "Own pumps" (the first refined fuel), road trains with "Road trains"
  (on the way to a Town).

## Freight: oversized loads (owner, 2026-11-08: "make it look cool and feel special")

Some loads are too big for any truck, and moving one is an event the whole map notices. The player never
manages or approves it; their part is the road it takes.

- **Where pieces come from.** A machine works builds one oversized piece for every 12 loads of machinery it
  makes, at no extra input. That is a turbine, or a steel girder for a landmark. Its yard holds two, and it
  builds no more until one ships.
- **Where they go.** One convoy at a time leaves each works, by itself:
  - first to a landmark that still waits for that kind of piece;
  - otherwise a turbine goes to one of the company's coal power plants. It takes three at most, and each adds
    25% to its output for good. The plant's panel shows the turbines as slots.
  - A piece with nowhere to go waits in the yard.
- **The convoy.** It is one vehicle in the traffic sim, 33 m long, drawn piece by piece along the path its
  front drove, like a road train. Front to back:
  - a yellow pilot car;
  - the haulier's red tractor;
  - a low-loader with the piece chained down on cribs: a blue-grey generator stator, or a pair of grey plate
    girders, with red flags at its widest and an OVERSIZE LOAD banner on the back;
  - a trailing escort car.

  All of these are Blender models. The cars carry roof boards, and amber beacons flash on every vehicle at
  1.6 Hz, each on its own beat, throwing a glow on the road around them.
- **In traffic.** It crawls at 8.5 m/s at most, pulls away slowly and never changes lane to overtake, so
  traffic queues behind it. The same junction and roundabout rules as long vehicles apply. There are no route
  or curve rules: it takes the route any truck would.
- **The moment.**
  - A toast when it sets off ("Oversized load: a turbine leaves the Machine Works for the Power Plant, under
    escort") and when it arrives.
  - A tag rides just above it on the map: "OVERSIZE LOAD · Turbine", with a lamp flashing like its beacons.
  - Click the tag to follow the convoy with the camera. Panning lets it go.
- **Panels.** The machine works panel shows:
  - the next piece's progress;
  - pieces waiting;
  - the convoy on the road and its destination;
  - pieces delivered.
- **Milestones.**
  - "Oversized load" (the first piece shipped) unlocks the Hydro Dam.
  - "Skyline" (three pieces) unlocks the Skyline Tower.

## Industrial parks

Two of the company's plants placed fence to fence (within 60 m), where one makes what the other uses, are
linked automatically. The link is a belt conveyor on trestles, or a pipe bridge for crude and fuel, with a
transfer tower in each yard. It can bridge a street.

- Loads cross the link from yard to yard with no truck, up to 3 an hour; the trucks carry the rest.
- The goods visibly move: loads ride the belt in the product's colour, and pulses run along the pipe. They
  run closer together the busier the link is, and stop while the game is paused.
- **It is a trade-off, not a free win:**
  - it carries only a few loads an hour, so a busy chain still needs its trucks;
  - it costs $60 an hour in upkeep;
  - linked plants pollute together: each one's smoke reaches 30% further into the towns' land value;
  - the park's other freight funnels through gates a stone's throw apart.
- Nothing to build or set: put the plants close and the link appears; pull one down and it goes. Both panels
  list the link ("Conveyor to Construction Plant: 2 of 3 loads/h of steel").

## Landmarks

Three one-off megaprojects at the top of the ladder, one of each. They are the long-term goals and goods
sinks the milestones promise.

| Landmark | Where | Waits for | When it opens |
|---|---|---|---|
| Hydro Dam | on a river or lake shore | 160 cement, 100 steel, 60 parts, 30 machinery, 3 turbines | 360 MW with no coal, to every building on its roads within 15 km |
| Skyline Tower | in a City (6,000+ people) | 120 steel, 80 glass, 100 parts, 30 electronics, 4 girders | its city grows 1.5x as fast and buys 30% more |
| Grand Exposition | within 800 m of a town's edge | 100 planks, 60 glass, 60 parts, 50 goods, 40 electronics, 2 girders | that town grows 2x as fast; every other town 20% faster |

- **Construction.** The player places it like any site.
  - The usual freight trucks its materials in over days: after the chains' own needs, ahead of a town's
    extra sales. Trucks from every chain converging on one site make a traffic crunch the player plans for.
  - The pieces come by convoy. Deliveries earn nothing.
- **Visible stages.** The model on the map grows with its progress (a piece counts as 10 loads):
  - foundations and scaffolding with tower cranes, below 40%;
  - the frame rising, from 40% until the last load is in and while it is finished off;
  - the finished landmark.
- **The panel** shows:
  - a progress ring and the stage;
  - each material as a bar;
  - the pieces as slots (outlined while a convoy is on its way);
  - the loads and convoys coming;
  - what it will do once open.
- **The opening.**
  - A banner in the period's manner ("The Company Presents · The Grand Exposition is open") with its reward
    and a "Show me" button.
  - The camera glides over to it, and a fireworks show goes up above it.
- **Unlocks.** "Finish a landmark" ("World's fair") unlocks the Grand Exposition and a town slot. The catalog
  has a Landmarks tab.

## Seasons

A game year is four game days, one per season, so a session sees the harvest come and go. Day 1 at dawn is
the start of spring.

- **Towns eat the same all year.** The farms swing instead:
  - crops: spring 0.85, summer 1.05, an autumn surge of 1.6, winter 0.5;
  - logging camps fell most in winter on hard ground: 0.9 / 0.75 / 1.0 / 1.35.

  The pace eases smoothly between the middles of the seasons. Its year-round average is exactly 1, so a
  year's output, money and balance are unchanged; only the timing moves. Warehouses buffer the harvest for
  the lean months.
- **On the map.** Every farm's fields change with the season, the farmyard's own plots as well as the fields
  that come with its levels:
  - spring shoots on tilled soil;
  - summer green;
  - ripe gold in early autumn, then cut to stubble with round bales;
  - winter's frosted furrows.
- **In the HUD.**
  - The clock shows the season with its glyph ("Autumn · Day 7").
  - A farm's or logging camp's panel shows its season pace now ("Autumn harvest · x1.54") and the next
    season's average.
- Pure functions of the sim clock: nothing to save.

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
- **Filling stations and construction parts (tier 3, 2026-11-08).** A Town keeps filling stations on its
  commercial land: one from Town size, two from 4,000 people. A station grows like a shop, or, when the
  commercial land is full, is rebuilt from the town's outermost shop as one of its redevelopments. Fuel goes to
  the stations; a town with none standing yet takes its fuel at its shops. Household goods go to the shops.
  Construction parts are not a need on the list. Once the company can make them (the construction plant is
  unlocked), every block a town puts up from its 1960s era on is a building site that waits for its parts, the
  way a plant's site waits for planks and cement. That covers new growth and redevelopment alike: apartment
  blocks, stores and offices take 1 load, modern flats 2, malls and towers 3, glass towers 4. The town pays for
  them on delivery. Houses, terraces and high-street shops need none. This gives steel its buyer from Town
  size; tier 4 plant sites will take parts too.
- **Electronics and machinery (tier 4, 2026-11-08).** A City's electronics go to its shops. Its machinery goes to its
  offices and office towers, the firms that fit out its works; a city with none standing yet takes it at its shops,
  the way fuel falls back to the shops before the first filling station. Tier 4 plant sites wait for construction
  parts on top of planks and cement. Copper ore lies in the high ranges: on the flat floor of an upland valley, with
  mountain round it. Copper opens before a town reaches City (as oil opens before a town wants fuel), so the chains
  are running when it gets there. A Metropolis adds no needs of its own yet.
- No city services, taxes, policies or zoning.

### Towns grow into cities (owner, 2026-11-08)

A town should visibly turn from a hamlet into a city over a playthrough: bigger, denser, more modern.

- **Town hall at the centre.** Every town is founded round its hall on a square at the first crossroads. The
  hall is rebuilt bigger at each size: hamlet hall (chapel-like, bell cupola), village hall (arcaded market
  house), town hall (domed, courtyard), city hall (belfry and copper spire, square with fountains). The square
  and the hall stay as the old heart; everything round them modernises.
- **Each size has its own era of building:**

  | Size | Homes | Shops and work |
  |---|---|---|
  | Hamlet | houses | high-street shop-houses |
  | Village | houses, terraces in the middle | high street |
  | Town | terraces, 1960s apartment blocks in the middle | stores, offices |
  | City | modern flats, apartment towers in the core | malls, office towers |
  | Metropolis | towers in the core | glass towers (the skyline) |

- **Redevelopment, not just sprawl.** When a town reaches a size, its inner rings are rezoned denser. Old
  buildings in a denser ring are pulled down one at a time, centre first, and rebuilt (a construction site,
  then the new building). So the houses you saw at the start become terraces, then flats, then towers, while
  the edge keeps growing new houses.
- **Each new size is a moment:** a banner ("Millbrook is now a Town"), the hall goes up as a building site,
  the label shows the new size.
- **Towns are inspectable.** Click a town (label or hall) for its panel: population over time, supply per need
  with a bar each, growth toward the next size, deliveries per product, homes, jobs, and what it is short of.
  The map shows each town's label with a supply bar and an icon for any need in shortage.

## Company

- Income: payment for every load delivered to a town. Plant-to-plant transfers earn nothing; they keep the
  chain running.
- Costs: roads (build and upkeep), buildings and upgrades, wages, trucks, fuel, land. Loans exist; going
  bankrupt ends the game.
- **Money is not the challenge.** Every sensible build pays for itself within a game day or two; the first
  chain is in profit as soon as its first trucks deliver. Demand outruns supply at every size (a town always
  wants more than one chain makes), so more plants and trucks always earn more, until the roads jam. Costs
  grow far slower than income: by the mid game money stops limiting anything except the very biggest
  projects. What earns less is a jammed road: a truck stuck in traffic delivers nothing, so the money tells
  you where the traffic is bad.
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

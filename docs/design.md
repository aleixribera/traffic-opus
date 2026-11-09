# Kilometre Zero: design

An industrial company on a road map.

Decided 2026-11-07 with the owner. You run an **industrial company**. You claim deposits, build big extractors
and plants, serve towns that spring up and grow on their own, and draw the roads that tie it all together. Freight routes
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

- An endless procedural world with no land to buy (owner decision, 2026-11-08): the company builds anywhere its
  roads reach, and a site can go down anywhere before them. Nothing on the map is locked or for sale; what opens
  it up is the milestones unlocking each tier's plants, and that tier's deposits lying kilometres further out.
- **Deposits** sit in distinct regions that never run out, spread by tier:

  | Tier | Deposit | Where | Distance from start |
  |---|---|---|---|
  | 1 | Fertile soil (crops), forest (logs) | river plains, forest belts | within 1-3 km |
  | 2 | Iron ore, coal, limestone | foothills of the ranges, each its own field | 3-8 km |
  | 3 | Oil, sand | oil basins; river and lake shores | 6-15 km |
  | 4 | Copper ore | high ranges | 10-20 km |

  Every kind recurs further out, so later sites can be chosen for convenience. Two different kinds are never
  next to each other: the chains are always a drive apart.
- **Finding them (owner, 2026-11-08: "hard to find and know what resources I need").** While an extractor is
  placed, only its own deposit is tinted strongly (the rest faint), each deposit of its kind carries an enamel
  tag at its middle ("COAL"), and the nearest two off screen get a pointer at the screen's edge with the
  distance; click one to fly there. The Resources view tags every kind on screen, and its legend lists each
  mined kind with the distance to its nearest deposit, a click away. The tool card says what ground it needs.
- No outside world: no gateway cities, imports or exports. Your towns and your own plants are the only
  customers. The start is an empty region with one small town and a few hundred metres of road.

## Chains

| Tier | Extractors (on a deposit) | Plants |
|---|---|---|
| 1 | Farm: crops. Logging camp: logs | Food plant: crops to food. Sawmill: logs to planks (+ wood chips) |
| 2 | Iron mine: iron ore. Coal mine: coal. Quarry: limestone. Dairy farm (fertile soil): milk | Smelter: iron ore + coal to steel (+ slag). Cement works: limestone (or slag) + coal to cement. Power plant: coal (or chips) to power. Creamery: milk to cheese |
| 3 | Oil well: crude. Sand pit: sand | Refinery: crude to fuel + plastics. Glassworks: sand + coal to glass. Furniture factory: planks + glass to household goods. Construction plant: steel + cement to construction parts. Chemical works: limestone + coal to fertilizer + explosives |
| 4 | Copper mine: copper ore | Copper smelter: copper ore + coal to copper. Electronics: copper + plastics to electronics. Machine works: steel + copper to machinery |
| 5 | | Rubber plant: plastics + coal to rubber. Motor Works: steel + glass + rubber + electronics to cars |

- Each building has jobs, input stores, output stores and a rate. Rate = base x staffing x inputs on hand
  (x power, from tier 2). A full output store stops production, and the building says so.
- **Sites (owner, 2026-11-08):** every extractor and plant is a big fenced complex, about 5x the old lots:
  plants roughly 160-220 m on a side, farms, pits and the refinery up to ~300 m. A deposit (600-800 m across)
  holds one or two. See "Industry sites" below.
- **Construction:** tier 1 buildings cost money only. From tier 2 a new plant is a construction site that waits
  for materials trucked to it: planks (tier 2), planks + cement (tier 3), construction parts (tier 4).
  **A real haul (owner, 2026-11-08: "waaaaay tougher"):** every site from tier 2 waits for at least 30 loads (a
  mine 30 planks, a smelter 50, a refinery 60 planks + 50 cement, a machine works 60 + 60 + 50 parts): a
  stream of lorries to the site, so building out a chain is itself a traffic job, and bigger truck classes pay
  off. Town blocks and towers built from construction parts need 3-12 loads each, and the company projects
  twice their old bill.
- **Power** runs along the roads from power plants that burn coal brought by truck.
- **Supplies (2026-11-08): the chain feeds itself.** The chemical works' fertilizer goes back to farms and dairy
  farms from level 3; its explosives go to iron, coal and copper mines, quarries, sand pits and oil wells from
  level 3. Every site except the machine works draws machinery at level 4. A site keeps a small store of each
  (shown as a Supplies row in its panel) and draws it down as it works. Out of a supply, it drops back to the pace
  of the level below (never under level 2), and it only grows to a level once that level's supply is in stock. No
  town buys supplies; the company's own trucks route them like any input. **In the world:** a site running on
  supplies shows a badge by its gate: a green chevron, the supply icons and the total it adds ("+50%"). Its panel
  says what each one adds, e.g. "+50% from fertilizer" (a level-3 farm on fertilizer vs. the level-2 pace).
- **Perishables (2026-11-08).** Milk (dairy farm) and cheese (creamery) travel in refrigerated trucks. A load keeps
  its full value for its shelf time (milk 540 s, about 13 in-game hours; cheese 1500 s, about 37 hours). After
  that it loses value linearly to a 20% floor at twice the shelf time. Spoiled loads still sell for what is left.
  Villages buy milk and cheese as extras (they add to growth but never hold it back). The panel shows the share
  that arrived fresh and what spoiled. The answer is a nearer buyer or a quicker road, never a purchase.
  **In the world:**
  - The reefer bodies (light, heavy and road-train) are banded in their load's colour (blue for milk, gold for
    cheese) with a dark fridge unit.
  - Every reefer on screen carries a ring that runs down its shelf time: teal, amber in the last third, then red
    and pulsing once it spoils.
  - At the shop a fresh load pops "Fresh +$", a late one pops "47% fresh −$1,440 spoiled".
  - The ticker calls out a spoiled plant at most once an in-game hour, naming the plant, the town and the money
    lost.
- **Alternate inputs and by-products (2026-11-08).** The sawmill also makes wood chips and the smelter slag. A
  power plant burns chips in place of coal, and a cement works takes slag in place of limestone. By-products only
  go to plants that take them (no town buys them). When a load of one leaves, a tag pops at the gate ("Slag ·
  by-product, to the cement works") so it reads as its own cargo, on its own trucks.
- **Motor Works (tier 5, 2026-11-08).** The rubber plant turns the refinery's plastics and coal into rubber. The
  Motor Works builds cars from steel, glass, rubber and electronics and stops when any of the four runs out. A
  Town (1,500+) buys cars as an extra; each truckload is 4 cars, and towns scrap 2% of their cars a day. Cars
  sold raise the town's **motoring**: up to +50% more of its people's trips are driven, full at one new car per
  household. More income, more traffic on the town's own streets: the Motor Works is a traffic multiplier, not just
  a money one. **In the world:**
  - The cars go out on car transporters (two decks of cars painted in the company's four livery colours).
  - The town pops "8 new cars +$8,000", and the ticker says it took delivery once an hour.
  - The households that bought them drive 1930s Motor Works sedans in livery colours through town, a share that
    grows with motoring.
  - The Motor Works is a showpiece: a deco front with a stepped tower crowned by a winged brass emblem, sawtooth
    roof lights, a paint shop, a lot of finished cars, a loaded transporter at the dock, and a test track with a
    grandstand round the back.

## Industry sites (owner, 2026-11-08)

- **Placed anywhere, connected later.** A site can go down with no road near it: you place it free-standing
  (`,` and `.` turn it in 15 degree steps; with a road close by it turns its gate to face it). Its **gate** is
  the middle of one side, marked on the map while it has no road. Any road that passes the gate or ends in front
  of it (within ~12 m) connects it; the site says "Connected" and its trucks start. Until then it shows
  "No road to the gate" and does nothing but wait. A gate never joins the road in a junction's mouth: within
  24 m of one (a road train's length) its drive runs along the kerb to a point that far down the road, so trucks
  waiting to turn in or pull out stand clear of the box.
- **Four levels, growing by themselves (like TF2).** Level 1 is the core plant by the gate with its truck yard,
  about a fifth of the plot; levels 2-4 fill the plot to roughly 45%, 70% and full. A site grows one level when
  it has run near its capacity for a sustained stretch (most of a few in-game days) with its output being
  shipped, and its inputs coming in for a plant. It never shrinks (an idle site simply stops). Each level
  multiplies output, jobs and trucks (x1, x2, x3, x4.5 of the level-1 rate).
- **Levels 3 and 4 open with milestones (owner, 2026-11-08).** Every kind of site grows to level 2 on its own;
  a milestone clears named kinds for level 3 ("Logging Camps and Sawmills grow to level 3"), and a later one for
  level 4. Farms, mines, wells and pits have no goal for level 3: theirs waits on the chemical works'
  fertilizer or explosives, so a goal never promises a level the player can't yet supply. A site at its kind's cap says which goal opens the next level. Milestones never add trucks or loads:
  a site's fleet comes from its level, and a truck carries more only as a bigger class (light 1 load, heavy 2,
  road train 4), the way real fleets grow.
- **Look.** A fence round the plot, natural ground inside, internal service roads from the gate, and faint
  concrete pads where the next level's buildings will stand, so you can read what the site will become. Every
  building on a site is a Blender model in the usual lot style (pad, front apron facing an internal road): the
  kind's own model is the core; the rest are repeats of it and shared support models (halls, silos, tanks,
  heaps tinted to the material, offices, workshops, truck yards; fields for farms, log yards for camps).
- **Trucks** stop at the truck yard by the gate; internal movement isn't simulated.
- **Towns** never grow into a site's fence.
- **No land to own:** a site stands wherever its plot fits (owning map tiles once made land, not traffic, the
  wall by day 8, and then got in the player's way; it was dropped on 2026-11-08).

## Freight (routes itself)

- Every site runs its own fleet, which comes with its level: nothing to buy, no trucks to manage (owner,
  2026-11-08). At each level it has enough trucks to carry everything the site makes 3 km away and back over
  streets (FLEET_HAUL); bigger truck classes and faster roads stretch the same fleet further. Idle trucks
  wait in the yard, so a big fleet on a short haul adds no traffic. A truck loads output, drives it over your
  roads to a customer, unloads and comes back. Past the haul it was sized for, or on a jammed road, the yard
  fills: the fix is the road, never a purchase.
- Destinations are automatic. Your own plants short of an input come first, then towns that need the product,
  nearest and neediest first. You never draw lines; you can block a destination for a building if you need to.
- **Truck classes** unlock with milestones, and a site's level sets its fleet's mix (owner, 2026-11-08: no truck
  micromanagement; "each level increases the number of higher tier trucks ... up until last level, where they
  should be greatly favoring the better option"). LEVEL_MIX (light / heavy / road train): level 1 all light,
  level 2 55/40/5, level 3 25/50/25, level 4 10/30/60; a class not unlocked yet hands its share to the best one
  that is, and a warehouse runs level 3's mix. The classes take turns: the one with the most of its trucks at
  home goes next. The truck at the dock waits for a full load (or what the customer takes, or half the yard,
  whichever is least) for up to HOLD, a game hour, per product, so a big truck never sets off with one load on
  board (owner: "they will keep sending the lightest truck as soon as 1 food is available"). Trucks already on
  the road finish their trip as they are. Nothing to buy or pick per building: the panel shows the mix read-only. The class sets the load and the road it takes; the body still
  comes from the product: tankers (crude, fuel, chemicals, cement), flatbeds (logs, planks, steel, parts),
  tippers (ore, coal, sand, limestone, gravel), box trucks for the rest.

  | Class | Loads a trip | Length | Speed / pull-away | Load x speed per truck | Fuel per km |
  |---|---|---|---|---|---|
  | Light truck | 1x | 8.5 m | 85% / 1x | 0.85 | 1x |
  | Heavy truck (four-axle rigid) | 2x | 12 m | 82% / 0.8x | 1.64 | 1.5x |
  | Road train (tractor + two trailers) | 4x | 22 m | 75% / 0.6x | 3.0 | 2.6x |

  Each step up roughly doubles what one truck moves, so the same flow puts fewer trucks on the road: that is
  the traffic payoff. Moving up costs no money (pillar 5) and fuel per load falls. What it costs is road: a
  road train takes a long time to clear a junction, and fills a ring.
- **Long vehicles in traffic.** A heavy or a road train is drawn piece by piece along the path its front drove,
  so trailers cut corners through a turn. The sim keeps the whole body in mind, not just its front:
  - a junction movement stays reserved until the last trailer has left it, and its tail blocks the lanes and
    connectors it still covers;
  - turns that pass close without crossing (closer than 3.5 m, or 4.3 m for two curved turns) conflict when
    one of the vehicles is long;
  - a roundabout counts its load in car-sized slots, so a road train counts as about three cars and a heavy as two. It won't enter unless the
    ring has room for its whole length, counting the long trucks already waiting at the other entries;
  - a lane change needs a gap beside its whole length;
  - one road train at a time pulls out of a lot's gate: the next waits in the yard until the last trailer
    has cleared the kerb. Heavies pull out of the yard's bays like light trucks (gating them too halved what
    a heavy fleet moved in the balance run).
  - Trucks queued in a yard behind the first wait their turn; only the first's wait for a gap counts toward
    "blocked driveway" (90 s).
- **Giving up.** A driver gives up ("gave up in traffic": the load goes back to its yard) only after standing
  240 s without getting 8 m further on, the last resort against a broken layout (see the jam breaker under Roads),
  and only the one at the front of the frozen queue: it shrinks away where it stands, and the rest move up
  (2026-11-08; it was 150 s, and every car in the queue went at once). A queue that crawls on gets there.
- **Jammed hauls in the panels.** A full site whose trucks are held up says so: "the road at its gate is jammed"
  (the first truck out of its yard has waited 20 s+ for a gap) or "its trucks are stuck in traffic on the haul"
  (standing 30 s+), and a plant waiting for an input says when the loads on their way are stuck in traffic. So
  the panel tells a road to fix from a long haul or no buyer.
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
- **Unlocks:** heavy trucks with "Village" (with the mines), warehouses with "First cement", depots with "First fuel",
  road trains with "Town".

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
  - "Oversized load" (the first piece shipped) unlocks the Hydro Dam and the Skyline Tower.

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
- **Unlocks.** "Finish a landmark" ("World's fair") unlocks the Grand Exposition, and a new town springs up. The catalog
  has a Landmarks tab.

## Seasons

A game year is 64 game days, **16 per season** (owner, 2026-11-08: "For the seasons, let's have 16 days for each
season"), long enough to settle into a season and enjoy its scenery: at 1x a season is about four hours of play
and the year about seventeen. A new game starts at dawn in late spring ("Spring · Day 11", calendar.START_YDAY), so summer is six days off and
the first harvest comes in on the game's day 23.

- **Towns eat the same all year.** The farms swing instead:
  - crops: spring 0.85, summer 1.05, an autumn surge of 1.6, winter 0.5;
  - logging camps fell most in winter on hard ground: 0.9 / 0.75 / 1.0 / 1.35.

  The pace eases smoothly between the middles of the seasons. Its year-round average is exactly 1, so a
  year's output, money and balance are unchanged; only the timing moves. Warehouses buffer the harvest for
  the lean months.
- **The harvest rush** comes once a year, in autumn: the farms run above 1.3x from the eve of autumn to about
  its 13th day, peaking at 1.6x mid-autumn.
- **On the map.** Every farm's fields change with the season, the farmyard's own plots as well as the fields
  that come with its levels:
  - spring shoots on tilled soil;
  - summer green;
  - ripe gold for the first half of autumn (days 1-8), then cut to stubble with round bales;
  - winter's frosted furrows.
- **In the HUD.**
  - The clock shows the season with its glyph and the day within it, 1 to 16 ("Autumn · Day 7"); its tooltip
    adds the year and how long until the next season.
  - A farm's or logging camp's panel shows its season pace now ("Autumn harvest · x1.54") and the next
    season's average.
  - **The season's title card** (owner, 2026-11-09: "a cool visual text when changing seasons, and show a bit which
    building bonuses/debuffs that means"). The moment the calendar crosses into a new season, a newsreel title card
    drops in at the top centre: the season's name in tall poster capitals, a line under it ("The harvest rush is
    on"), then what the season does to the seasonal kinds the player runs ("Farms ▲ +60%", "Logging camps ≈ steady"),
    each the kind's mid-season value in `SEASONAL` against the year's average, and one practical hint ("Warehouses
    bank the surplus for winter"). With none of them, one line gives the general effect. It holds about 4.5 s and
    fades; it never takes a click, waits behind a milestone banner and gives way to one, and never shows for a new
    game or a loaded save (ui/seasonCard.ts).
  - Hovering or clicking the clock's season line shows the same lines, with the day and the next season.
- Pure functions of the sim clock: nothing to save. A save from the four-day year keeps its clock and lands in
  whichever season that day falls in now.

## Day and night, and the seasons' looks (owner, 2026-11-08)

"Add a day-night cycle with illumination and everything." "Also the different seasons should have different
visuals." Time to enjoy the scenery: the light moves through the day, and the map turns through the year.

- **The light** follows the sun, from the sim clock (render/daylight.ts):
  - a warm, pale dawn; a neutral midday (the palette as drawn); a golden evening; a blue hour after sunset; then
    a moonlit blue-grey night, never black;
  - the sun rises in the east-north-east, stands to the north-west at noon (as the art has always been lit) and
    sets in the west-south-west, and the shadows follow it, longer when it is low;
  - the days lengthen and shorten with the year: about 15 hours of daylight and a 73° noon sun in midsummer, 9
    hours and 27° in midwinter, so a winter 6 pm is dark and a summer one isn't;
  - autumn's light is a touch warmer.
- **Lamps.** Deco cast-iron street lamps (a Blender model) stand along the kerbs, closer on main streets, on both
  sides of avenues and along highways; they come on through dusk and throw warm pools on the road. From far out
  a lit town is a string of pearls.
- **Windows** light the ground round homes, shops, offices and town halls, each kind on its own evening: homes
  fill up after work and most are lit at 9 pm, fewer by midnight, a few early risers before dawn; shops stay lit
  into the evening; offices empty after work; the hall is lit late. The lit share eases through the hours and
  each building's windows come on in their own order.
- **Works** get lattice floodlight masts (a Blender model) round the yard as built so far, throwing an even
  white light over it; farms work by daylight and have none.
- **Vehicles** carry headlights (a beam on the road ahead) and red tail lights; **signals** keep a halo so they
  read at night. The HUD, labels and overlays are unaffected: an overlay lifts the night most of the way to day
  so its colours read.
- **No real lights.** The lamps, windows and beams are instanced quads that brighten what is under them (a little
  light added, then a multiply against the night's own light, so lit grass stays grass), and a shared set of
  shader uniforms grades every material at night and in each season. Nothing is duplicated per season.
- **The seasons' looks** blend in over a few days and never pop (render/daylight.ts, render/envShader.ts):
  - spring: a fresh, yellow-green grass and new leaves, blossom on about a third of the trees;
  - summer: lush green, drying to gold late on;
  - autumn: the deciduous trees turn orange, red, gold and russet one by one, the grass browns, fallen leaves
    gather on the ground late in the season;
  - winter: bare grey-brown branches, the evergreens dark with snow on their lit side, partial snow in drifts on
    the ground and settling on roofs, the roads ploughed clear, frost at the water's edge.
- **The setting** (pause menu, Nights; saved as `flowtown.nights`): Full cycle (the default: the nights are
  moonlit, not black, and the lamps are the point), Soft nights (the darkness lifted to about half), Always day.
- **The title menu** runs an autumn day as a time-lapse, a day every two minutes: afternoon, golden hour, a
  lamplit night, dawn. Its clock follows the light.
- **Dev hook**: `__env.set({ hour: 20, season: "winter", day: 6 })` fixes the look at a moment, `__env.set({ speed:
  40 })` lets it run, `__env.set({ mode: "soft" })` tries a setting, `__env.clear()` goes back to the sim's clock.
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

- A town lays out its own streets, growing out unevenly along its roads, and joins them to your roads where they
  meet. Houses and shops build themselves along its streets.
- **Towns spring up; the player never founds one (owner, 2026-11-08).** The company starts with one hamlet. Fresh
  hamlets (level 0) appear as milestones are reached, and the milestones that bring them are about the towns
  there are growing: a hamlet of 150 people (1), two villages (1), a big village of 1,000 (1), a Town (2), a
  Town supplied (1), a market town of 4,000 (2), a City (2), a City supplied (2), the World's fair (1) and the
  first cars (1): 14 in all. The Towns window (the Towns button in the bar, or C) lists every town with its
  size, people and worst-supplied need ("No road yet" for one nothing reaches), and above them one line on when
  the next town springs up: "Next town springs up at Two villages · 1 / 2 · opens after 4 more goals".
  - **Where.** Each one lies further from the start town than the last, roughly exponentially: the first about
    1.9 km out, each next one 1.55x further, capped at 16 km (settlements.ts `spawnDistance`). It is never nearer
    another town than 1.8 km or about half that distance, and stands on open dry land (not in water, not on a
    site, not boxed in by mountains or a lake), at least 450 m clear of the company's roads, with soil, forest and
    other deposits within reach so it is worth serving. The spot is deterministic from the seed.
  - **Cut off.** It comes with its first few streets, hall and homes already lived in, and no road to the
    company's network: joining it up is the player's job.
  - **The arrival.** A Deco banner names it, with its distance and direction ("Fort Pryor has sprung up 3.2 km
    north-east of Alder Run") and buttons to fly there or open its panel. The milestone banner reads "A new town:
    Fort Pryor". A ticker line says the same. Until the company first delivers to it, a ring pulses over its
    hall, and while it is off screen a pointer at the screen's edge shows the way and the distance; clicking
    it glides the camera there (a jump instead with reduced motion) and opens the town.
- Every resident is simulated: a home in a town, a job at one of your buildings within reach, a commute in
  traffic. Buses carry workers to plants and take cars off the roads your trucks need.
- **A gentle daily rhythm (2026-11-09, owner: "realistic schedules might be too much, maybe make it a bit
  noticeable"; reshaped the same day so the rushes, not lunch and midnight, are the busiest).** Plant day shifts start
  at 8:00, 9:00 or 10:00 (42%, a third each); plants also run an early shift from 4:00-6:00 (18%), a late one from
  12:00, 14:00 or 17:00 (32%) and a skeleton night shift from 23:00 (8%); shops open at 9:00, 10:00 or 11:00 and close
  by 19:00. A commute takes a game hour or two at this time scale, so people are at work 7 hours from the shift's
  start and stay on up to 1.5 more, evenly spread. Someone who gets to work early waits for the shift. A quarter of
  the 8:00 and 9:00 shifts go out to the shops at lunch and back after (a shop's own staff to another shop), and
  people without a job run errands at any hour, most from 9:00 to 16:00. Trucks keep running round the clock. In
  the showcase (cars on the road by hour, twelve three-day runs averaged) the morning rush peaks at 7:00-8:00 (40) and
  the evening one at 18:00 (40), lunch is a bump at 13:00 (34), and 0:00-5:00 are the quietest (24-26): the busiest
  hour is 1.7 times the quietest. Before, it was 2.16 with no daily shape (peaks from the shift changes at 5:00,
  15:00 and 23:00); the first soft version was 1.58 but busiest at 13:00 and midnight. A save from before the new
  shifts moves everyone to one of them on load (the same one each time, by who they are).
- **Needs** open with town size, and a town grows past each size only while that tier is supplied:

  | Size | Population | Needs |
  |---|---|---|
  | Hamlet | 0+ | food |
  | Village | 300+ | + building materials (planks from 100 people, cement from 600) |
  | Town | 1,500+ | + household goods and fuel |
  | City | 6,000+ | + electronics and machinery |

  Supply is the loads a day of each need delivered, averaged over the last 48 game hours (32 minutes at 1x) and
  rolling hour by hour. Towns grow hour by hour on it. Good supply speeds growth, bigger and denser buildings, and
  more workers; a long shortfall shrinks the town, slowly (a need that opens ahead of the town's size, a hamlet's
  planks, only stalls it). A small town grows fastest for its size (several times faster at a few dozen people,
  tapering off by 450), so the first hour moves.
- **Steady growth on a proven supply (owner, 2026-11-08: "it should be 100% sure the supplies will continue before
  growing crazily"; "the last 48h-72h average or something"; "keep the early game fast as it is now, but more
  'sure' before growing").** Towns used to grow while the last day's supply covered 80% of their needs, overshoot
  what it could feed, then lose people the first bad day: waves of growth and regression. Now:
  - *Proven supply* is the 48-hour average above. A supply that began less than two days ago is averaged over the
    hours since its first load (the empty hours before it are not a shortfall), but over at least 8 hours, so a
    first truckload alone never counts as a supply.
  - *Grow only toward what it supports.* A town grows toward the people whose needs its proven supply covers 80%
    of (the "supplied" bar of the panels), each size eating 1.6x a head more. The worst-supplied need sets the
    level and the panel names it. It eases in over the last stretch and never passes it. The further the supply
    runs ahead of the town, the faster it fills in (up to 4/3 of the base pace at three times its needs). The
    safety is in time, not in quantity: two days of proof before growing. (A bigger margin, tried at 100% and 110%,
    stalled the start town: its plants are worked by its own people.)
  - *Crossing a size line.* A supply that covers a size's people all the way to the next size line carries the town
    3% past the line on the appetite it had. Beyond that it needs the new size's appetite covered.
  - *Shrinking, with hysteresis.* A town shrinks only after 48 hours in a row of its supply covering less than 85%
    of what its households need, judged on the better of the two-day and the last day's average, so a day without
    deliveries, made good since, never counts. Then it loses at most 3% of its households a day, never below what
    the supply still covers. A town held back by a need it can't buy yet, or one opened ahead of its size, holds
    rather than shrinks.
  - Measured with steady deliveries of 100 food, 40 planks and 20 cement a day, no traffic (households every 6 h,
    tests/growth.test.ts): the start town rises without a dip to 257 households (about 620 people) by day 2.5 and
    holds there; its people vary by 1-2% as homes are rebuilt (before: up to ~660 people with dips back to ~620, and a day without deliveries cost 30 people in a
    day). A day without deliveries now changes nothing. A cut lets it hold two days, then lose about 1% of its
    people a day (633 to 551 over four days; before, 624 to 433 by day 14, much of it at once).
  - The town panel shows the same two-day average in its needs ("X a day (2-day average) of Y needed"), what its
    supply supports ("supplies support N"), and what holds it back and how many more loads a day would grow it.
- **Loads that land in time (owner, 2026-11-09: "deliveries to towns seem to always be late"; "add an invisible
  margin: the factories receive the alert before the player sees the need and supply automatically"; "give a minute
  or two of grace after the town needs it").** A town has only what has landed: a load on the road never counts
  toward its needs or supply.
  - *Send ahead.* The plants see a town's need about to read below "Enough" before its people do: a town whose
    landed supply would fall below the line sooner than a truck sent now could land (the trip as the plant's last
    trucks there took, or by distance; a quarter of it again and two game hours spare for loading and the yard)
    goes first among the towns, and its truck leaves without waiting at the dock for a full load (so does one in its
    grace, below). A town already showing short goes on the daily shortfall as before: putting it first too set the
    first Village back five minutes (day 2.32 against 2.00 on seed 7); as built it comes on day 1.95. Loads already on
    their way count for this only while they are on time (up to half their trip late), so a jammed truck doesn't
    hold the next one back. It is an invisible line above "Enough", sized by what the town uses over the lead
    time, so a far town is seen to earlier than one next door. The player never sees it.
  - *Grace.* A need whose landed supply falls below "Enough" still reads as it did for GRACE, 3 game hours (two
    real minutes at 1x), and its growth, shrinking and the goals go on as if it were met at the line. A load that
    puts it back in that time and nothing was ever shown or counted; when the grace runs out the drop shows and
    counts from then on, never backdated. Only a load landing brings a grace back, so a supply that has dried up
    shows within three hours. A jammed road still lets a town run low.
- Deliveries go to the town's shops, filling stations and building sites, so trucks drive into town streets.
- **Towns grow away from the works (owner, 2026-11-08: "avoid pollution/noise").** A dirty plant's smoke reaches
  its pollution radius ×1.6 past its fence (further in a park) and its noise 60 m beyond that; building sites count
  as the plant they will be. A town lays no street where that is worse than 35% (1 at the fence, 0 at the reach),
  zones no new homes past 12%, and rebuilds no homes there denser. Shops don't mind the works (only right at a
  fence, past 90%): a hamlet with its food plant a block off still gets its shop. The land it gives up stays
  open, a green belt between the works and the homes, and its street radius stretches the other way so it keeps
  the area its people need. Homes already standing stay (their land value falls). New towns spring up clear of
  the smoke too.
- **Front strips (owner, 2026-11-08: upgrading a street must not demolish its homes).** Homes, shops and the town
  hall's square stand back from their street's centreline by `ZONE_SETBACK` (about 11.7 m: the half-width of the
  widest road that still takes driveways, a divided avenue, plus its pavement). Each lot's driveway crosses the
  strip to the kerb, and the hall's path runs on to it. The strip reads as part of each plot: a home's lawn runs
  out to the pavement, more than half with a clipped hedge or a white picket fence (houses and terraces) along it,
  open at the driveway, and some with a tree in a deep enough front lawn; a shop, office or filling station has
  a paved apron instead, a town square its paving or lawn out to every kerb, and a corner lot's side runs on to
  the side street's pavement. All of it lies under the pavements and roads, so upgrading the street lets the road and its
  pavement take the strip: the lawns narrow, the driveways shorten to the new kerb, and the hedges and trees that
  no longer fit go (none at a divided avenue). Downgrading gives it all back. Street trees make way for driveways.
  A block runs five rows of lots back behind the strip, so a 96 m town block splits five rows and four and both
  sides take the deeper lots; a City keeps about the shops and jobs it had before the strips. Saves from before
  this move their homes and shops back behind the strip on load (as deep as their block has room for, refitted),
  and their town squares shrink to the new inset.
- **Company sites keep the strip too (owner, 2026-11-08: "the same empty space proof relative to roads as normal
  buildings have in towns, letting me upgrade").** A site put down beside a road stands with its fence behind the
  same strip (`siteSetback`: `ZONE_SETBACK`, or the gate drive off the kerb of anything wider), its gate drive
  crossing it to the kerb. Widening that road, up to a divided avenue or a boulevard's carriageway, needs no move:
  the road takes the strip and the drive shortens to the new kerb (and stretches back on a downgrade). A site put
  down before its road steps back behind the strip when the player draws a road past its gate inside it (where the
  land behind is free; one undo takes the road and the step together), and a site turned by the player with its
  gate on a road close by stands back the same way. A road that ends at the gate (the street laid to a free site)
  needs no strip: it widens sideways. Old saves' sites still hug their roads; an upgrade pushes such a site back to
  behind the strip when there is room, and when there isn't, the upgrade is refused with the site named ("Food
  Plant in the way"). A boulevard takes no driveways, so a site whose only road becomes one loses its gate road,
  as a home loses its driveway.
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
  The map shows each town's label with an icon for any need in shortage.
- **Needs a child can read (owner, 2026-11-08: "I don't understand this part. Can you make it easier to see, like
  for children almost, and also add icons to the town").** Each need in the town panel is its picture, its name, one
  word ("Plenty", "Enough", "Running low", "None!") and a row of crates: the loads a day coming, filled, against the
  loads a day it wants (at most ten crates; past ten loads each crate stands for a round number of them, said under
  the row). Under that, one sentence of what to do ("Bring 4 more loads of food a day", "Food is fine"). The words
  follow the sim: "Enough" from 80% of a day's need (where growthPerDay grows a town at full pace), "Plenty" from
  all of it, "None!" while not one crate's worth is coming. The need still to come shows greyed: "Soon: Planks, when
  it reaches 100 people". The figures (loads a day, what the shops buy at most, today's tally) sit in the row's
  tooltip and under Details. On the map, a town's nameplate shows its needs only while one wants seeing to: each
  picture on a disc ringed green, ochre or brick (with a "!" for none), the fine ones smaller; zoomed far out only the
  needs in trouble stay. A town no road reaches yet shows its needs greyed with "No road yet". The supply bar is gone.
- **Growth in words, no numbers (owner, 2026-11-08: "remove the numbers and just tell the player 'growing' and
  'growing a lot'").** A town's panel, the Towns list and its status say "Shrinking", "Not growing", "Growing
  slowly", "Growing" or "Growing fast", with the reason when it is held back ("Not growing, needs food"). The word is
  its pace against its own best (every need met in full), so it means the same in a hamlet and a city: all needs
  "Enough" reads "Growing", all "Plenty" "Growing fast" (95% of its best and up; 50% for "Growing"), one running low
  holds it to a trickle, "Growing slowly". The figure in households a day stays under Details only.

### Towns run themselves (owner, 2026-11-08)

"Make the cities less dense overall, have more of an outwards expansion rather than having the centre crammed with
houses." "Let villages fully control themselves apart from just growing, let them upgrade some roads and build a
cool layout aswell, not just squared, let them eventually build an outwards road that ends up connecting to maybe
an external road, but don't overdo it, this is the player's job."

- **A plan of its own (townplan.ts).** Every town still grows a street at a time on a lattice of 96 m blocks, laid
  out as a small American town that grew over time (PLAN_TOWN, 2026-11-09), seeded from the town and the same every
  time it is loaded. The main street runs along the road the town began on, straight through the hall's crossroads
  and bending gently once past the old town; the crossroads and the four blocks round it stay square, so the hall's
  square is the same in every town. Every fourth line is a through street. The land between them is a quarter laid
  out by its own builder: long blocks along the main street (or across it) with staggered cross streets, a loose
  grid, a spine with short closes off it, or a loop drive (sometimes round a green). Through streets meet them
  mostly in T-junctions; blocks differ in size, quarters bow, cross roads sometimes run at an angle, and side
  streets curve with low-frequency noise. The town leans as it grows: it reaches further along the main street and
  the cross road, toward the player's roads and other towns within 2.5 km, and less toward water, mountains,
  steep ground, forest and the company's sites. Junctions near water are drawn back as before, or left out. Towns
  from v0.0.69 keep their rings-and-spokes plan, and older ones their square grid.
- **Less crowded, spreading outward.** About one block in ten is kept as a green: a lawn inside its pavements with
  a row of trees round it and clumps within. There are more greens among the inner streets, and always the town
  green across the main street from the hall's square. The green shows once three of the block's streets are laid (on today's plan: every street round it, two at
  least, or a loop drive's eight; one whose streets can't be laid goes to homes instead of lying bare). A
  sixth of the house and terrace fronts are left as gardens (26 m gaps between homes). Lots keep 12 m clear of
  the streets still to come. The town's radius for its people grows faster (200 + 12·√people m, up to 2.2 km;
  was 150 + 9·√people, up to 1.6 km), so it spreads instead of packing in. On seed 7, with every need well served
  (twice what it uses: `Game.fastForward` with `ample` 2), the start town reaches Village on day 2.1, Town on day
  7.0 and City on day 13.5 (the growth before steady growth, on the same supply: 2.0, 7.4 and 15.1). With every
  need met exactly (`ample` 1, the tests' default) it grows a step behind its own supply, as steady growth means
  it to: Village on day 10.7, Town on day 20.0, City on day 29.7 (before: 4.9, 11.8 and 20.5). A real supply
  doesn't shrink to fit the town like that. At Town size it
  houses 4.4 homes a hectare within 150 m of its hall (was 7.2) and reaches 720 m out (was 547). At City size it
  has 6.5 homes a hectare within 150 m (was 68) and reaches 1.3 km. It lays about a third more street for the same
  people.
- **It widens its own busy streets.** A town watches the traffic on its own streets every eighth of an hour,
  smoothed over about two hours. Once a day it takes its busiest street, if that carried at least 1.6 cars per
  100 m of lane at its peak (a street at capacity carries about 3.5), and widens the run of it that carries on
  straight through its junctions, up to 700 m: a street becomes an avenue, and at City size an avenue becomes a
  divided avenue. The ticker says "Alder Run widened Main Street", with no banner. It widens a street once at
  Village size and up to 3, 6 and 10 times in all at Town, City and Metropolis. It touches only streets it laid
  itself, never the player's. It never pulls down or pushes back a building: the front strips leave room for it,
  and if the wider road or a reshaped junction mouth would still touch a lot, the street is left as it was.
- **One road out, once.** From Town size, a town looks every three days for a road within 2 km of its centre
  that isn't its own. That is the player's road, or another town's, that it doesn't yet reach that way (a road it
  is already joined to only counts in a direction at least 60° from its existing ways out). It builds one street
  from a junction or dead end on its edge that faces the road, curving to meet it square. The street keeps 30 m
  from the company's sites, never crosses water, a mountain or another road, and never goes through a home. The
  ticker says "Alder Run built a road out to the north-east, joining yours" (or "... to Fort Pryor"). It builds
  only one, ever, and with nothing in reach it builds nothing at all, not even a stub: joining towns up stays
  the player's job.

### Town orders (owner, 2026-11-08)

"Like milestones we have to complete for each town, randomly appearing from time to time, getting bigger depending
on the town's scale, and they add a specific special building to the town" (game/orders.ts, game/civics.ts,
ui/orders.ts).

- **Each town has its own set.** Five to eight civic buildings drawn from the catalogue below and seeded from the
  map seed and the town, so a save always deals the same set. Every set holds at least two a hamlet can ask for.
  Each order has a fixed grade from 1 to 3, its difficulty, and opens only once the town is the size its building
  wants. Each building comes once per town. The town panel counts them: "Orders · 4 of 7 filled".
- **They are rare: one at a time, five to ten days apart** (owner, 2026-11-09: "one every 5-10 days, maximum 1
  active whole map"). The first opens 5 to 10 game days into the game; each next one 5 to 10 days after the last
  one closed, filled or missed (the gap drawn evenly). At most one is open on the whole map. It opens in a random
  town that can take one: a town that has had a delivery and has 40 people. The town asked last rests a turn while
  another could be asked, so orders spread over the map. The numbers are named at the top of orders.ts.
- **What an order asks.** Either freight in a window ("Millbrook wants a schoolhouse: 30 planks and 20 cement in 4
  days") or, for a fair, a need kept at Plenty for some days ("Ridgefield's Fair: keep food at Plenty for 3
  days").
  - Freight orders are sized to the town as it is when the order opens, and to its grade: 1.15 to 1.55 times what
    the town takes over the window, which is 3 + grade days. They ask for one product in a hamlet, two from
    Village size, and three at grade 3 from Town size. Only products the town buys and the company can bring
    (a plant makes it, or the town has had some lately) are asked for.
  - A fair counts the hours the town's last day of loads stays at or above its need plus a quarter, for the
    crowds, and fills after 2 to 4 days of them.
  - Either way the difficulty is the freight, pushed through the player's roads, not the money (pillar 5).
- **Filled.**
  - **Building:** the town builds its building on its own streets, as near the centre as there is room. It may
    pull down a few homes, but never a corridor kept for a future street, a square, a hall or a company site. It
    goes up as a building site, rises like a hall, and can't be bulldozed. With no room yet, it tries again each
    day.
  - **Grant:** a cash grant of about 60% of the loads' worth, at least $5,000.
  - **Perk:** a small, lasting perk in words, which applies exactly once.
  - **The moment:** a banner ("Order filled · Millbrook builds its schoolhouse"), the camera gliding over, and a
    small fireworks show.
- **Missed.** Nothing is lost. A toast says it ran out of time. The town doesn't ask for that building again for
  six to twelve days, and then sizes it afresh to the town as it is. A save from the first, busier pacing keeps
  its open orders and draws a full gap before the next.
- **On screen.**
  - A note under the toasts when an order opens. Orders opening together share one note, it can be put away,
    and a click opens the town.
  - A tag beside the town's map nameplate.
  - The town panel's Orders section, with each open order's loads, days left and what it brings, and each
    building filled so far with its perk.
  - A short list of every open order in the Towns window.
- **Saves.** The sets, the open orders and the draw count are saved. A save from before orders loads with none
  open, its towns are dealt their sets, and orders start to roll.

| Building | From | Lot (cells) | Asks for | Perk |
|---|---|---|---|---|
| Schoolhouse | Hamlet | 3×4 | planks, food | grows 5% faster |
| Church | Hamlet | 3×5 | planks, cement, food | land value +6 nearby |
| Bandstand Green | Hamlet | 4×4 | fair: food, milk | land value +5, grows 2% faster |
| Post Office | Hamlet | 3×3 | planks, food, goods | shops buy 4% more |
| Fire Hall | Village | 3×4 | cement, planks, fuel | land value +5, grows 2% faster |
| Library | Village | 4×4 | planks, cement, goods | grows 5% faster |
| Water Tower | Village | 3×3 | cement, planks, machinery | grows 6% faster |
| Picture House | Town | 4×4 | goods, cement, electronics | shops buy 6% more |
| County Hospital | Town | 5×5 | cement, goods, food, machinery | grows 8% faster |
| Ballpark | Town | 6×5 | fair ("Opening Day"): food, cheese, milk | land value +7, shops buy 3% more |
| County Courthouse | City | 5×5 | cement, machinery, electronics | shops buy 6% more, land value +4 |
| Market Hall | City | 6×5 | fair ("Market Week"): food, milk, cheese, goods | shops buy 8% more |

The models are real Blender models (tools/blender/civics_a.py and civics_b.py), period-correct for the 1920s to
1940s.

## Company

- Income: payment for every load delivered to a town. Plant-to-plant transfers earn nothing; they keep the
  chain running.
- Costs: roads (build and upkeep), buildings and upgrades, wages, trucks, fuel. Loans exist; going
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

There are 20 milestones in a ladder, three open at once so there is always a choice of what to chase next.
Each unlocks something concrete: a chain, the next level for named kinds of site, a truck class, a road type or
junction tool, a new town springing up, warehouses, fuel depots, a grant. The last ones unlock **company
projects**: huge buildings that take hundreds of mixed loads, as long-term goals and goods sinks.

### Trimmed to real steps (owner, 2026-11-08)

"Some goals and objectives are just weird, let's trim them down a lot." The ladder went from 54 milestones to
20. A goal stays when it is a real step in the company's story: a town reaching a size, a chain's first load,
a town kept supplied, a landmark. Cut: one-day volume goals ("Deliver 30 loads of planks in one day"), lifetime
tallies ("Deliver 300 loads to your towns in all"), trade-value days, a supply goal met the moment it opened
("Village supplied": a well-fed hamlet that grows to 300 already is), and goals that were an odd proxy for the
thing they unlocked ("Quarry 120 loads of limestone" for the chemical works, "Make 30 loads of coal" for
warehouses). One tally stays, renamed from Heavy haulage to Steady trade (150 loads delivered; its heavy trucks
come with Village): it lands about half a day after Village, and its grant pays for the power plant and smelter
Village opened (tests/balance.test.ts: with that money moved to First steel, the scripted company had made no
steel by day 11).

Nothing was lost: every building, road type, junction tool, truck class and level the cut goals unlocked comes
with the kept step nearest where it used to, and so do their grants (still $1,505,000 in all) and their new
towns (still 14). A whole tier's plants now open together (tier 2 with Village, tier 3 with Big village, tier 4
with Market town). A save that reached a cut goal keeps what it unlocked, without being marked as having reached
the kept one (progression.ts `RETIRED`, `Progress.legacy`).

| Kept (in order) | Now also unlocks (from the cut goals) | Cut goals merged into it |
|---|---|---|
| First customers | | |
| Growing hamlet | | |
| Village | smelter, heavy trucks, +$40k | Market day (part), Village supplied (part), Heavy haulage (part) |
| Sawn timber | Food plants to level 3 | Market day (part) |
| Steady trade (was Heavy haulage) | quarry, cement works | Village supplied (part) |
| First steel | Power plants to level 3 | Lights on |
| First cement | warehouses, Cement works and Smelters to level 3 | Stockpiles, Concrete |
| Two villages | dairy farm, creamery, divided boulevard, $10k | Milk round, Fresh milk, Two towns supplied |
| Big village | sand pit, glassworks, furniture factory, $30k | Building boom |
| First fuel | fuel depots, Refineries to level 3 | Own pumps, Fuelling the roads |
| Home comforts | construction plant, Glassworks and Furniture to level 3 | Concrete age, Rising blocks |
| Town | road trains, chemical works, 4-lane one-way | Feeding thousands, Chemistry, Road trains |
| Town supplied | a new town; Construction plants, Chemical works and Creameries to level 3; +$80k | Good trading day, Fed back, Prefab, Three villages, Furnished |
| Market town | copper mine and smelter, electronics, machine works, one more town, +$190k | Big trading day, Twin towns, Prefab streets, Copper country, Shopping streets (part), Red metal |
| City | Copper smelters to level 3 | Shopping streets (part) |
| Heavy industry | $80k | Circuit boards |
| City supplied | one more town; oil, sand, refinery, glass, furniture, construction, chemical and copper sites to level 4 | Wired city, Tooled up |
| Oversized load | Skyline Tower, +$80k | Skyline |
| World's fair | rubber plant, Motor Works, +$150k | Synthetic rubber, Assembly line |
| Motor age | a new town; Rubber plants and Motor Works to level 4 | Rush hour |

**Order of the long game:** the first half is a pure road-and-truck game. Tiers 1-3 chains, truck classes, every
road type, highways and interchanges all come before trains. **Freight rail unlocks late** (around tier 4, when
demand has outgrown even road trains on a good highway network), and barges after it.

## Tips (owner, 2026-11-08)

"Fixing the tutorials that appear, they are annoying, and sometimes wrong for the current state of the map."
One quiet tip at most sits under the goals, inside the goals card (it never covers them), and only for steps the
game doesn't show by itself. Each one checks the live map before it shows and goes away once its step is done or
no longer applies; it names a town only when that town is the one that needs it (src/ui/tips.ts, tests/tips.test.ts).

| Tip | Shows while |
|---|---|
| Start a food chain | no farm placed. Worded for the map: place one on soil within reach of a road, or, when no fertile soil lies near any road, lay a road out to some first. Names the biggest reachable town that wants food. |
| No road reaches your site | a site's roads reach no town and no other site (placed out past where its gate street reaches) |
| Build a Food plant | a farm and no food plant |
| Nobody to sell to | a built plant whose roads reach no buyer |
| Planks | no sawmill, and a town is at 60% of the size that wants planks (names it, "will want" or "wants now") |
| A new town has no road | a town that sprang up isn't joined by road to anything beyond its own streets |
| A site waits for something | a building site needs a product none of the company's plants makes |
| Where a deposit lies | a mined kind is unlocked and none placed: the nearest deposit's distance and direction |
| Power | a built plant draws power and no power plant is placed |
| Construction parts | the construction plant is unlocked, none placed, and a town's new blocks wait for parts |
| Fresh milk | the dairy farm is unlocked and none placed |
| Supplies | the chemical works is unlocked, none placed, and a farm or mine has reached level 2 |

Cut: the "keep the town fed" filler, and the "build X next" tips for each later plant (the goals card's unlock
line already says what opened). Each tip has a dismiss button; the pause menu's Tips switch turns them all off,
and turning it back on brings every dismissed tip back. Both are kept per browser (`flowtown.tips.off`,
`flowtown.tips.dismissed`). The category button a tip points at gets a still marker, no pulse.

## Pacing (no waiting)

- At every stage there should be at least three useful things to do: something new to build, a bottleneck to
  fix, and a town to supply or join up.
- **The first hour must not drag (owner, 2026-11-08).** A day is 16 real minutes at 1x. Targets at 1x:
  something new every 3 to 6 minutes; the second chain (logging and sawmill) inside 10 to 15 minutes; a Village
  in 20 to 30 minutes; first steel and first cement inside about an hour and a half. The flow: road to the farm,
  food plant, first deliveries, the hamlet asks for planks at 100 people, sawmill, the first new town springs up
  at 150, a road to it, Village. A site's first level comes in under a day of work; the later ones take longer.
  The milestones around Village pay grants (Village $80k, Steady trade $30k, First steel $20k) so the steel
  chain is in reach as soon as it opens: traffic, not money, is what holds the player up.
  The late game is unchanged.
- The bottleneck moves on its own: more towns mean more commuters on the roads trucks use, and longer chains
  mean longer trips, so road work keeps being needed.
- **The map paces itself by tier, not by land.** There is no land cap and nothing to buy before building: each
  tier's plants unlock with milestones, and its deposits lie kilometres further out than the last, so the
  company's reach grows with the roads it can afford to run out to them.
- **Demand rises exponentially.** From the mid game it should be obvious that each town size multiplies its
  needs (per-resident use rises with size, and towns grow faster when supplied). In the long road phase that
  means bigger trucks, more of them, highways and interchanges; only once volumes outgrow even that do rail
  trunks with truck feeders arrive, then barges. The late game is borderline-madness logistics: huge flows,
  terminals jammed by feeders, crossings to grade-separate.
- Speed controls up to very fast; the sim must stay smooth at that speed.

## Roads (core features from mods)

- Existing tools stay: draw Curve/Straight, height levels, bridges/ramps, roundabouts, upgrade,
  reverse, bulldoze. Road types: dirt road, street, avenue, boulevard, one-way 1/2, highway 2/3/4, plus rural
  road and gravel road.
- **Dirt road (2026-11-08: "Roads are hella expensive for early game").** 1+1 packed earth at $1.5/m, a quarter of
  a street, first in the build bar and open from the start. 32 km/h; loaded heavy trucks run at 0.85 of that.
  Houses and sites can face it. Drawing a paved road over it paves it in place (same nodes and buildings, priced
  like any road upgrade). It stays on the ground: a bridge on a dirt road is built as a
  paved street at a street's price, and the chip says so.
- Ideas taken from popular mods:
  - **Lane connector**, **priority signs** (stop/yield/priority road), **turn restrictions** and a
    **traffic light editor** for which roads go in which phase and left-turn arrows (from the Traffic mod; the
    lights themselves keep a fixed clock, see "Dumb lights" below).
  - **Move nodes and curves** of built roads (from Move It).
  - **Parallel and offset drawing**, snapping guides and angle/length readouts (from the line tools).
  - **Area bulldoze** and per-element bulldoze (from Better Bulldozer).
  - **Custom road configurator** for lane counts, median and speed (from Road Builder), at a later milestone.
- Traffic info views: flow per road, congestion hotspots, routes through a selected road or building, and a
  journey breakdown per resident.
- **Lights never lock up (2026-11-08).** A car waiting to turn into a driveway across a standing queue (the queue
  for a red, above all) drives on after 8 s and comes back round, taking the way on that gets it back soonest.
- **Really stuck traffic shows (2026-11-08: "a tiny but persistent alert").** Where cars have stood still for a
  minute and a half, a small amber warning diamond stands on the map, and one chip above the clock says how many
  places and for how long ("Traffic stuck · 2 places · 3 min"). Click the chip to fly to each in turn. An alert
  stays until its cars have moved on for a few seconds, so a shuffling queue doesn't make it flicker.
- **Roundabouts flow (2026-11-08: "fix traffic into roundabouts").** Traffic going round has the right of way and
  never stops for a car waiting to come on. An entry looks back round the ring as far as a driver would (on a small
  ring that is several short pieces) and comes on only into a real gap; a car about to turn off before it is no
  reason to wait. Entries hold back once the ring is about 60% full, the density it flows best at, so it never
  fills into a circle of cars each waiting for the next. The car that has waited longest at an entry (a heavy
  truck, say) gets the next gap. A small ring at 500 cars an hour per arm moves ~280 where it locked at ~180.
- **Dumb lights (2026-11-08: "keep lights dumb, they don't read traffic ... 24 seconds for each is enough").**
  Lights keep a fixed clock: every phase gets 24 s of green (a left-turn arrow 8 s), then 3 s of amber and 1.5 s
  of all red, round and round whatever the traffic does; only a phase that lets nobody go is passed over. They
  used to follow the traffic, ending a green early or stretching it, and three greens in four ended on a queue
  still moving: the start-stop that jammed crossings. Now a queue goes in one steady green. Left-turn arrows come
  after the road's green, when the cars going straight on ahead of a turner in its lane have gone, so the turners
  stand at the line ready (that halves their worst wait; an arrow before the green barely helped). The junction
  panel shows the times; they aren't per-junction settings, and the times old saves stored are not used. A left
  turn that gets no gap in the oncoming stream all green goes at the change of the lights, in the amber and the
  moment of all red, as drivers do (a "sneaker"): before, on a one-lane street it stood round after round with the
  queue behind it backed up through the next junction. At a four-way at 900 cars an hour per arm: 294 through in
  10 min where it was 254, and the longest wait 39 s where it was 106 s.
- **Cars drive briskly through junctions (2026-11-08: "cars feel painfully slow, especially in intersections").**
  Measured against real driving, they were timid: pulling away at 1.8 m/s² (0 to 29 km/h in 5.6 s), a queue
  crossing the line every 3.0 s, turns at 15-18 km/h, braking for a junction from 40 m out. Now they pull away at
  2.6 m/s² (2.2 over the first 2 s, 4.7 s to 29 km/h), keep a 1.0 s gap rather than 1.1, take turns a notch faster
  (sqrt(3.6 r) for the corner's radius r: lefts ~20 km/h, rights ~17) and brake later and firmer (2.0 m/s² into
  the bend's speed). A queue now crosses every 2.5-2.7 s and each car starts ~1 s after the one ahead. Faster still
  (3 m/s², 0.9 s) made grants at a busy four-way flip, so this is where smooth stays smooth. Gaps accepted at a
  give-way stay 3.2 s, already at the short end of what real drivers take. The ring of a roundabout keeps the
  gentler sqrt(3.2 r) (a 2-lane ring under ~30 km/h): held all the way round, the faster ring let long loads
  and road trains get drawn through each other.
- **Trucks pull out like drivers (2026-11-08: "a truck getting blocked because another one just got out of a
  building").** A truck pulls out of a lot across a lane only when the lane it joins has room for its whole length
  and nobody on the near lane is about to reach the strip it sweeps through as it turns. Queues leave its mouth
  clear for a body length, and the lanes it crosses stay held until its tail is straight in its lane, not just its
  front. Two trucks never pull out across each other at once. At lights, a long truck that has waited for oncoming
  traffic it can't squeeze past gets its turn: the oncoming cars hold back for it.
- **The jam breaker (2026-11-08: "let infinite traffic jams get a bit fixed into non infinite ones").** The last
  resort for a spot that locks solid anyway: once cars at a junction have stood 2 minutes without moving at all,
  the one that has waited longest goes in regardless of give-way or room on its exit (never at a red, never
  through a car in its way), and for a minute after that the next ones there go after 15 s. If it is still frozen
  at 4 minutes, the car at the front fades off the road and its trip fails. In a grown 5,000-person town it fires a
  handful of times in hours of play.
- **Drivers differ (2026-11-09: "make the game feel more real ... traffic intelligence").** Each car's driver is
  brisk or calm, fixed by the vehicle (most near the middle): the gap it keeps behind the car ahead is 0.9-1.1 s
  (was 1.0 s for everyone), it pulls away 8% harder or softer, and the gap it takes at a give-way is 12% shorter or
  longer. Cars behind a slow truck string out at 12.7-15.1 m apart instead of exactly 14.0 m each. Everyone still
  cruises at the same share of the limit: varying that by 4-6% made streams so lumpy that a crossing's left-turn
  arrow helped or didn't by luck, and took more go-aheads back at a busy four-way. Throughput on the junction bench
  is unchanged (3,489 cars through vs 3,482 over 12 runs; three more seeds +0.2%).
- **Picking the lane early for a stop just past a merge (2026-11-09).** A car whose destination is less than
  400 m along a road it joins without a junction (past an on-ramp's merge, a lane gain, a bend) gets into the lane
  that leads to the destination's side on the road before. Before, a car that had overtaken a truck on the inner
  lane could find no gap in the near lane, where the on-ramp traffic comes in, and missed its turn. At a real
  junction drivers still keep to both lanes and get over after it (doing it there too halved the near lane's
  share of a green). The early pick never stops a car: its lane still leads on, so with no gap it keeps going and
  gets over on the last road (asking to be let in, cars stood in the motorway's inner lane for over a minute
  with the near lane full).

## Controls and road building (owner, 2026-11-07: "exactly like Cities: Skylines 2")

Controls follow CS2's defaults. Trafficity's systems stay only where they are better than CS2: undo/redo,
height levels shown while drawing, and the instant upgrade preview.

**Camera:**
- W/A/S/D pan; edge scroll is optional.
- Q/E turn the camera. A middle-mouse drag turns it (sideways) and tilts it (up and down).
- Y/H tilt it from the keys: Y up toward the Map view, H down toward the horizon. (CS2's tilt keys T/G drive the
  camera modes here.)
- R/F and the mouse wheel zoom, about the ground under the cursor.
- Right-drag pans the map (left-drag too while nothing is being drawn): the ground that was grabbed stays under
  the cursor, at any tilt and turn.
- A north arrow appears while the map is turned; clicking it turns the map back north-up.
- **The Diorama (2026-11-09, docs/direction.md):** the game is filmed by a tilted orthographic camera
  (`src/render/view.ts`, the maths in `src/render/viewmath.ts`). `tilt` is the angle from straight down: 40° by
  default, free between 0° and 58°. It stays orthographic: no perspective, so sizes and road widths read the same
  all over the screen.
  - **Map view (M):** straight down, the old view, and back to the Diorama at the tilt the player last had. Eased
    over 0.4 s; at once with reduced motion.
  - **The Camera setting** (pause menu, next to Nights and Scroll wheel; saved as `flowtown.camera`): Diorama (the
    default) or Map. It is the view a game opens in and the view the camera comes back to after a Tour or a
    Vehicle cam, and choosing it switches the view at once. **M flips this same setting**, so the menu always tells
    the truth, and so does the camera block. Tilting by hand keeps it true too: pitched all the way to straight down
    it becomes Map; pitched down out of the Map view by key (H) it becomes Diorama. In the Map view a middle drag
    only turns the map (it never tilts it by accident), so with Map chosen the whole game plays without a tilt.
  - **The camera block** (top-left bar, by the camera button): a small block drawn as the camera sees the map,
    turned and tilted with it, brick on its north side; from straight above it is a plain square. A click is M.
    Dragging it turns and tilts the camera: the way to do it on a touchpad with no middle button.
  - **Remembered:** the player's turn (`flowtown.cameraTurn`) and Diorama tilt (`flowtown.cameraTilt`, never less
    than 12°) are kept in localStorage with the setting, across games and reloads.
  - **Pointing is by line of sight.** A click is a ray, not a ground point (`View.screenToGround(px, py, h)` and
    `View.worldToScreen(x, y, h)` are the one pair of helpers; `src/ui/pick.ts` picks along the ray). Ground tools
    meet the plane of the level being drawn (6 m a level), so a bridge end lands under the cursor at its own
    height; the road tool tries its snapping on the height of every road the ray passes (`heightsOn`), so pointing
    at a bridge's end snaps to it up there. Inspecting picks what is seen: a building by its walls and roof (the
    boxes of its model, `Buildings3D.solidsOf`), a raised road by its deck, a vehicle at its own height, and what
    stands in front hides what is behind. Snap and pick radii are in ground metres per pixel averaged over the two
    screen axes (`View.pickMpp`).
  - **Overlays stand at real heights.** Town names sit over the hall's roof, a home's or shop's icon over its roof,
    a works' over its gate, convoy tags over the load, pops over the roof or the truck. Tool previews and the
    Inspector's highlights are drawn over the scene at the height of what they mark (a route climbs its bridge),
    not on one flat layer above everything.
  - **What is drawn:** the ground footprint of the tilted, turned screen (`View.bounds`), with room below the
    bottom edge for tall things that lean into view. The sun's shadow map is fitted to that footprint and to the
    long shadows of a low sun falling into it, snapped to texels, its bias in metres.
  - **Save pictures** are always the Diorama, whichever view the player works in.
- Camera modes (the camera button in the top-left bar, or keys):
  - Follow (G, or a convoy's tag) rides with the truck nearest the middle of the screen, with a damped camera and a
    slight look-ahead. A "Following" chip names its cargo and destination. When it arrives the camera holds, then picks
    up the same truck's next run, or lets go. Zooming, Esc (which clears panels) and clicks on the map keep it (a click
    on another vehicle rides with that one instead); only panning, a build tool's click or the chip's Stop let go.
  - Tour (T) is a Cities: Skylines-style automatic camera. Slow 8–14 s pans and zooms over the busiest junctions, towns,
    works, bridges, convoys and recent events, weighted by live activity, never the same place twice in a row, fading
    through black between shots. Each shot has its own tilt and turn, drifting slowly: low sweeping angles on a
    works, a convoy or a bridge, higher over a junction or a whole town (`SHOT_TILT` in `src/render/cinema.ts`).
  - Vehicle cam (Shift+T) rides with one interesting vehicle after another (convoys, road trains, heavy trucks) for
    10–15 s each, low (40–58°), sometimes turned to its heading so the camera looks along the road from behind.
  - Both cinematic modes hide the whole interface (an "Esc to exit" hint shows for 2 s), keep the game running, and
    any key or click gives back the interface and the view as it was.
  - **Which views tilt:** Follow keeps the player's own view (Diorama or Map; M works while following). Tour,
    Vehicle cam and the title menu's backdrop always film the Diorama, whatever the Camera setting says, and give
    the player's view back when they end. The title backdrop is tilted 50° and sways slowly round the town (still,
    with reduced motion).
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
- P: progression; Z: economy; C: city info; V: statistics; X: transportation, as those panels
  arrive.
- F5/F9: quicksave and quickload.
- ` (backtick): hide the UI.
- Ctrl+Z / Ctrl+Y: undo and redo. CS2 has none; this is kept from Trafficity.

**Road tool modes** (owner, 2026-11-08: "build roads like Transport Fever 2"; a mode bar inside the road panel;
Tab / Shift+Tab cycle them):
- Curve (the default): a freeform arc that leaves its start along the road it carries on (or, from open ground,
  straight until the first piece sets a heading). Each click lays a piece and the next carries on tangent from
  it, so a chain of curves never kinks; right click or Esc ends the chain. An arc tighter than the road type's
  minimum radius is shown red with "Curve too tight ... swing wider", never built tighter silently.
- Straight: two clicks; chains the same way, each piece starting where the last ended.
- Upgrade: hover a road and click to change its type or upgrades; right-click a feature to remove it.
- Kept from before: roundabouts (Intersections tab), Parallel, heights (Page Up/Page Down), undo/redo. Simple,
  complex and continuous curves and Grid were dropped (2026-11-08): Curve chaining covers them.

**Parallel:** a toggle with a spacing ([ and ] or the − / + buttons; default is the two roads side by side with a
4 m median) that works with every drawing mode. The twin goes on the left of the drawn direction; one-way twins
run the other way, so a one-way pair is a dual carriageway in one stroke. Its ends join the road the main stroke
starts or ends on, and each new piece carries on from the last twin.

**Snapping** (src/roads/snapping.ts; free drawing stays, with CS2-style soft guides, owner 2026-11-08):
- Existing roads and junctions catch the cursor within a radius that scales with the zoom (so it feels the same
  at every zoom). Within 12 m of a junction an end joins the junction rather than making a second one beside it.
  Aimed within ~7° of square at a road, an end slides to the exact right angle.
- Whatever it caught it keeps until the cursor is ~1.7x further away than where it caught (hysteresis), so the
  target never flickers. The target is highlighted (a ring on a junction, a wash on a road).
- Guides, dashed in the Deco brass, fading with distance; the one in use is drawn solid and brighter:
  - straight on from a dead end;
  - parallels to a nearby straight road: kerb to kerb, 8 m further, one lot deep (48 m) and a town block (96 m)
    away;
  - lines square to a road through its junctions, and rays square to it from where the new road starts;
  - right angles and straight on from the start, and the world's axes;
  - along the road being drawn, its end stops level with a nearby junction (so blocks line up across a street).
  Two guides that cross catch their crossing. The start of a road gets the same guides as its end.
- The snapping menu: Roads (existing roads and junctions), Guidelines, Parallels, 8 m lengths (default off) and
  15° angles (default off). Shift flips the angle steps while held; Alt ignores every snap and guide.

**Readouts** (next to the cursor, in the HUD's Deco chips): length (in 8 m steps when that's on), cost (red when
it's more than the company has), the steepest average climb of any piece (↗ %), each bridge's deck length, what
it crosses and cost, what the end joins and at what angle ("Joins the street at 90°"), or, for a road off another,
its angle to that road ("90.0° to the road"). A cream right-angle mark sits in the corner wherever it meets or
leaves a road square.

**Errors that don't block:** each is fixed on the spot, confirmed with its cost, or explained where it happens
with what to do:
- An end just short of a junction joins the junction ("Moved onto the junction").
- An end that overshoots a road it crosses by a few metres ends on that road ("Ends on the road it crossed").
- Water, or a road it can't meet at grade (a highway, a level crossing too shallow, or one at another height):
  an automatic bridge (below).
- Homes and shops in the way: outlined red, and the readout shows the compensation ("Demolishes 3 homes: $1,200
  compensation"); the first click asks ("Click again to demolish 3 homes ($1,200)"), the second builds and pays
  the owners. Company sites, civic buildings
  and anything else are never demolished: "Building in the way".
- Everything else (too tight, too steep, too shallow a crossing, junctions too close, no room for a ramp, out of
  money) is shown red at the spot with what to do about it.

**Bridges** (owner, 2026-11-08: "built automatically ... more visible when built"):
- Drawn over water, or over a road it can't meet at grade, a road rises onto a bridge by itself: the deck 6 m up
  (one level over another road's deck), the ramps either side fitted to the 11% limit. Page Up/Page Down still
  set heights by hand. The preview marks the deck's ends and the readout shows "Bridge 74 m over water · $2,140".
  Where it can't fit it says why and what to do ("No room for the bridge's ramp over the water: start 27 m further
  back", "Can't end on the water: carry the road on past it", "Too high to bridge here: cross somewhere lower").
- Built, a bridge reads top-down in the 1920s-40s Deco style: cream concrete parapets along both edges, a soft
  navy shadow thrown down-right by its height (as the sun's), fluted concrete piers with a hammerhead cap every
  ~24 m (none in a road below), and where the deck meets a ramp an abutment with stepped wing walls and a Deco
  pylon with a lamp either side. A deck of 50 m or more over water is a red-oxide steel through truss (Warren
  panels, overhead bracing) on piers 40 m apart. The pieces are Blender models (tools/blender/build_models.py:
  bridge_pier, bridge_abutment, bridge_pylon, bridge_truss) scaled to the deck.

**Intersections, roundabouts and ramps:**
- Roads crossing at the same elevation make intersections automatically.
- Roundabouts come in four sizes (small 1-lane ring, medium and large 2-lane, huge 3-lane) and are placed on an
  existing junction or on empty ground.
- Prefab interchanges (trumpet, diamond, cloverleaf) are a later milestone.
- Ramps are one-way roads that join a carriageway with a merge, not a stop.

## Look

Since 2026-11-09 the map is seen as a diorama, at a tilt (see "Camera" above); the straight-down view below stays
as the Map view, and the ground, roads and markings are still drawn for it.

Realistic top-down, straight down, the owner's chosen direction (2026-11-07): dry olive grassland with large soft
patches and fine specks, scattered round trees and shrubs with soft shadows cast down-right, dark charcoal
asphalt with crisp markings (double yellow centre lines on two-way roads, white dashed lanes, stop bars, zebra
crossings, rounded kerbs and light verges), dense small realistic cars and trucks with shadows, rail on gravel
beds. A muted, satellite-like but clean palette, in our own models and colours. Buildings are Blender models
in the same realistic register, with deposit regions readable on the ground. Clear company HUD (money and
milestones at the top, build categories at the bottom: roads, extraction, plants, logistics, towns), inspector
panels, no generic AI look.

- **Everything is clickable (owner, 2026-11-08: "Almost everything in the game should be clickable, and open its
  info/overlay/visualization etc. For example for a truck we can show its info (what it is carrying, how many...)
  as well as its exact path. For ores open the overlay and ...").** Every click opens the inspector and draws what
  it is about on the map, cleared with the selection (Esc, a click on empty ground). A truck: its loads, their
  worth and arrival, the exact route left as running dashes to a square at its end and the way it came faded; a
  car or bus: its errand and route. A deposit, fertile soil or forest: the Resources view focused on that kind, the
  yield an extractor would get there, its size, the sites working it, and "Place a … here". A road: everyone's
  whole routes through it (CS's route view). A junction: each approach's queue and longest wait, the lights' green
  and red on its roads. A site: product-coloured flow lines with arrowheads to its suppliers and buyers, and its
  reach ring (power, depot). A town: supply lines from the sites that feed it. A home: lines to where its people
  work and are out now; a shop or workplace: its staff's homes and its customers. A stuck-traffic diamond: the
  vehicles standing there and the junctions holding them. Water and hills say one line; plain land clears. Details
  in docs/ui-style.md "Inspector".

### Look: Industry Booming America (owner, 2026-11-08)

The game's setting is 1920s-40s American industry: steel, oil, highways, Deco.

- **Town names** are original American place names from curated parts (src/game/names.ts): "<Surname>
  Falls/Junction/Springs/Crossing/Landing...", "<Stem>ville/-burg/-ton/-field/-wood/-brook", "<Tree> Creek",
  "<Red/Iron/Lone...> Bluff/Butte/Prairie", "New/Fort/Port <Surname>". Never a famous city whole (a reject list
  catches the few the parts can make), at most 16 characters, unique in a world, deterministic per seed (a name
  takes two draws from the game's generator, as before). Saved towns keep their names.
- **US road markings.** 1+1 streets: a dashed yellow centre line. Wider two-way roads: double solid yellow.
  Divided roads: a solid yellow line down each side of the median, closing to a double yellow past its nose at a
  junction. Lane lines between same-direction lanes: white, 3 m dashes with 9 m gaps. One-way town streets: all
  white. Highways and ramps (US freeway): solid yellow along the left (median) edge, solid white along the right.
  Stop bars white (0.6 m at a stop sign); crosswalks at lit junctions in town are white continental bars, three to
  a lane. Town roads have kerbs, so no white edge lines.
- **The company** has a period name ("Carver & Sons Haulage", "Great Western Freight Co.", "Halston Iron & Rail")
  and a **herald**: a Deco badge (shield, roundel, winged roundel or lozenge) with its monogram, in a colour pair
  from the period palette (navy, ochre, brick red, cream, forest green). Both come from the seed at a new game; a
  new game opens on the company dialog to rename it or draw another name or badge, and the HUD's company button
  (top left, by the menu) and the pause menu's Company item reopen it. Name and herald show in the HUD, on the
  pause menu, in the saves list and on milestone banners, and are saved (older saves get one from their seed).
  Not on the trucks: the camera looks straight down, so cab doors never show, and a roof badge is a few pixels.

### Look: how things are built (owner, 2026-11-09: "make the game feel more real: from the way buildings are built, layouts, roads...")

- **Construction in stages** (src/game/construction.ts, src/render/construction3d.ts). Every home, shop, block,
  tower, hall and works building goes up in steps, each a Blender model: the plot dug over and set out with
  stakes and a builder's line (and its material piles growing load by load while a town block or a works waits
  for planks, cement or parts), the slab poured with a 1930s mixer truck parked by it, a timber frame (homes,
  shops, small halls, first-tier works) or a riveted steel skeleton (blocks, towers, big halls, the rest of the
  works) raised bay by bay and floor by floor while a stake-side lumber truck unloads, the walls closing in behind
  a tube-and-plank scaffold with the floors decked over, then the roof on as the raw timber and brick take their
  paint, the scaffold coming down last. Big steel jobs get a lattice tower crane that slews over them; big lots a
  site hut. Trucks drive in off the street and away again. A site's new buildings after it grows go up the same
  way over 8 game hours (the new level works from the start). Construction is slower, the one thing the owner
  wanted slower: a house takes 3 game hours, a terrace 4, apartment blocks, stores and offices 6, modern flats,
  malls and the office tower 9, the apartment and glass towers and the city hall 12; a first-tier works 3 (a
  first farm opens two minutes after it is placed, at 1x), tier 2 works 6, deeper ones 8 to 12; a landmark 6, once
  its last convoy is in.
- **Lived-in home lots** (tools/blender/build_models.py `home_lot`, src/render/buildings3d.ts `VARIANTS`,
  `DRIVE_X`). A street of homes is no longer one house stamped down: three 1920s homes share one lot plan, picked
  per building (a cross-gable clapboard house with a vegetable patch, a brick bungalow under a hipped slate roof
  with a shed and a washing line, a white Dutch colonial with a gambrel roof, a birdbath and a bench). Each has a
  concrete driveway down its left side to a detached garage at the back, the family car on it, a path to the
  door, and a picket fence round the back yard; no paved pad, the town's lawn runs up to the walls. The street's
  driveway strip, the gap in the front hedge and the way cars drive in all follow the driveway to the side.
- **Stockpiles** (src/game/stockpiles.ts, src/render/stockpiles3d.ts, tools/blender `pile_*`). A works' yards show
  what it holds: an ore, coal, limestone, sand or copper bay's two heaps grow taller and wider as the store fills
  and shrink as trucks haul it off, down to the scrapings; a log yard's five stacks come in stack by stack and layer
  by layer (logs don't squash). What lies in a yard is the works' store of that product plus its output waiting
  for a truck, over one store; the piles of every yard of a product fill one after another, so a half-full store
  is full heaps and empty bays rather than every heap half height. A bay of a product the works doesn't handle is
  dressed as 60% full. An empty bay keeps a spill of its material along the back wall, so it still says what it is.
- **Town streets and country roads** (src/game/rural.ts, src/render/roads3d.ts). Out in the country a paved road
  has no kerbs, pavements, street lamps or street trees: its asphalt runs out to a worn, slightly broken edge onto
  a grey-tan gravel shoulder (about 1.2 m, ragged on the outside), then a strip of short grass fading into the
  field. A town's streets keep all of them. Which stretch is which comes from the map, along each road and not
  saved: a road is a town street where it runs through a town's land, where a town laid it on its own land (half
  a block past its edge, so a town's road out stops being a street soon after the last houses), and in front of
  homes, shops and town halls that face it. A company's works never make a road a street. The pavement rounds off
  where the town ends, so the road a hamlet starts on runs on out of it as a country road. Junctions and bends
  follow their roads: between two country roads the corner is gravel, between two town streets it is kerbed, and
  where they meet the town's pavement stops at the corner. Highways keep their own paved shoulders, with gravel
  past them. Only the roads that change are redrawn, when roads or buildings change.

## Sound

Everything heard is made in the page with the Web Audio API: no audio files, no samples, no libraries. The
register is the game's own, 1920s-40s America: warm, mechanical, a little dusty, never sharp, modest at the default
levels so three hours of it don't tire. Code in src/audio/; the measuring bench is `?audiotest`.

- **What is on screen is what is heard.** The listener is the camera. Five times a second the scene on screen is
  summed up (src/audio/scene.ts: vehicles by class and their speeds, idling queues, jams, works running and their
  levels, building sites, homes, shops, town size, woods, water, hour, season, zoom), and a pure function
  (src/audio/mixer.ts `mixFor`) turns that into levels and how often each small event should come. Nothing follows
  one car unless the camera is down at street level.
- **Air.** A wind bed, fuller and lower from far up, thinner and colder in winter. Birdsong by day near trees:
  several species, most at dawn (the chorus), few in winter, none at night; a wood under a built-up town thins
  out. Crickets and an owl on summer nights. Water laps near the shore.
- **Traffic.** Engine beds per class (car, light and heavy truck, tractor, train) and tyre noise that rises with
  speed; they swell as the camera comes down and give way to wind as it goes up. At street level the three nearest
  vehicles pass by on their own voices: left to right with the camera's turn, louder at the middle, with a little
  Doppler. A queue idles lower than moving traffic. In a jam a klaxon or a truck horn now and then, never a
  chorus. Air brakes and a door at a works' gate.
- **Works.** Each kind has its own bed, heard only while it runs and louder with its level: the saw at a sawmill
  or furniture works, the furnace at a smelter, the crusher at a mine, quarry or pit, the power station's turbine,
  the oil well's pump jack, steam and hiss at a refinery, chemical or rubber works, light machinery at a food
  plant, creamery or electronics works, a tractor at a farm, dairy or logging camp, the cement kiln, the
  glassworks, the assembly line at the motor and machine works. Their events over it: a blast at the quarry, a
  clank, a steam release, an axe in the woods, a cow, a rooster at dawn, bottles clinking. A building site hammers
  and saws by day. Warehouses, depots and landmarks are quiet.
- **Towns.** A murmur that grows with the town, by day; a shop bell, a dog, children in mid-afternoon. The town
  hall clock strikes the hour (three strokes at three). A church bell on every seventh game day.
- **Moments** are short stings in one key (F), on the interface bus so the world never buries them: a milestone,
  a new town, a town grown, each season, a convoy leaving and arriving, a landmark, a town order opened and done,
  spoiled goods, a town giving up.
- **The interface** is a desk: typewriter keys for clicks, a brass switch for tools and toggles, a ledger stamp
  for placing, a cash drawer for money, a gravel crunch when a road is laid (longer for a longer road), a dull
  double knock for "can't do that". Never two within 40 ms. Money pops over the map tick softly, panned to
  where they are.
- **The wireless.** A swing combo that never plays the same tune twice: piano, a walking upright bass, brushes and
  a hi-hat, and one lead (trumpet or clarinet). The tune is composed, not looped
  (src/audio/music/compose.ts, pure and seeded): a form (twelve-bar blues, a minor blues, a 32-bar song, a ballad), an
  intro, a head, solos with call and response, an out-chorus and a tag. Its mood follows the game (day, night,
  winter: slower and sparser at night, more clarinet in winter), and its name uses the save's own towns and company ("Market Day in Alder Run"). By
  default it comes through an old set (narrow band, a little crackle) and sits under the world; the Sound dialog
  can switch the old tone off. The wireless control by the clock turns it on and off, skips to the next tune, and
  shows the name. It keeps playing while the game is paused.
- **Speed and pause.** A pause ducks the world by about 11 dB and leaves the wireless alone. At 2x and 4x nothing
  is pitched up: events only come a little denser.
- **Settings** (pause menu, Sound): Master, Music, World and Interface sliders, Mute, and the old wireless tone,
  saved on this computer (`flowtown.audio`). **N** mutes.
- **Budget.** Every sound is a short buffer rendered once in a worker from page load (141 of them, 24 kHz), then
  played and looped: beds glide with `setTargetAtTime`, nothing is made per frame. At most 48 sources sound at
  once, with the least important refused first. The mix goes through a sub filter, a gentle compressor and a soft
  ceiling. Sound starts on the first click or key, stops scheduling while the tab is hidden, and picks up again
  after the browser suspends it.
- **How it is checked** (src/audio/harness.ts, `await __audiotest.run()` on a `?audiotest` page). The same engine
  renders each layer offline and is measured: no clipping, no clicks, no silence where sound belongs, the
  wireless 3 to 14 dB under a busy street, the full mix modest, a pass-by crossing from left to right, the clock
  striking three. `__audiotest.show("music", 2, 26)` draws a spectrogram; `capture(30)` tapes the running game's
  scene for the "street" renders. The mixer and the composer have their own unit tests (tests/audio.*.test.ts).

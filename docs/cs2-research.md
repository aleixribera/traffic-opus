# Cities: Skylines II — mods, mechanics, complaints and regional play

Research for an original 2D top-down **regional** city-builder: several cities on one map joined by roads, with traffic simulation and road building at its core. It adopts CS2's mechanics and treats the fixes from CS2's most important mods as base-game features.

Compiled 2026-11-07. Current CS2 version: 1.6.x. Development moved from Colossal Order to Iceflake Studios in 2026.

---

## 0. Method and caveats

- **Popularity numbers are real install counts.** I queried the public API behind the Paradox Mods site (`POST https://api.paradox-interactive.com/mods?metadata=yes`, game `cities_skylines_2`, tag `Code Mod`, ~1,580 code mods). For each mod I took `installedCount`, which is its subscriber count, plus its rating count and long description. The figures are a snapshot from 2026-11-07. Mod pages are at `https://mods.paradoxplaza.com/mods/<id>/Windows`.
- **Install counts favour old mods.** Mods published around launch in Feb–Apr 2024 (Move It, Anarchy, Find It) have had about 2.5 years to collect subscribers. Mods from 2025–26 with 30–150k installs (Traffic Tool Essentials, Platter, Network Tools, Node Controller, Better Transit View) are growing fastest.
- **Libraries inflate the top of the list.** Unified Icon Library (1.41M), I18n Everywhere (1.06M), ExtraLib (0.92M) and Asset Icon Library (0.82M) are installed automatically as dependencies. They are not player choices, so I left them out of the rankings.
- **Reddit was not reachable.** reddit.com blocked scripted access, so community sentiment comes from Steam discussions, Paradox forums, Metacritic user reviews and press coverage. Treat those as anecdotes, not a survey.
- **The wikis lag the game.** The Paradox wiki (cs2.paradoxwikis.com) is the best structured source, but several pages are marked "verified for 1.0/1.1.5". The Fandom wiki returned HTTP 402.

---

## 1. The essential CS2 mods, grouped by area

The ★ column is the number of player ratings, a rough proxy for how engaged the mod's users are. Every mod listed has a 5/5 rating average.

### 1.1 Traffic and lanes

| Mod (author) | Installs | ★ | Vanilla problem it fixes | What it adds |
|---|---:|---:|---|---|
| **Traffic** (krzychu124) [80095](https://mods.paradoxplaza.com/mods/80095/Windows) | **1,101,003** | 20,726 | Vanilla has no control over which lane feeds which lane at a junction, and no priority signs. Vehicles weave and make illegal turns. | The successor to TM:PE. **Lane Connector** (safe, unsafe, track-only, road-only and shared connections) and a **Priorities tool** (yield/stop/priority per lane). It has the most ratings of any CS2 mod. Known limits: no roundabout-upgrade support, and custom connections are wiped when the road composition changes ([GitHub](https://github.com/krzychu124/Traffic)). |
| **Traffic Tool Essentials** (ZessonsMOD) [125342](https://mods.paradoxplaza.com/mods/125342/Windows) | 274,705 | 4,297 | Vanilla signals use fixed, unconfigurable phases, there is no coordination between them, and there are no traffic statistics. | Phase editor (sequential or priority, split phasing, protected turns), **self-adjusting phases** that learn from measured demand, **green waves** across grouped junctions, a Traffic Control Center (city-wide stats), a flow visualisation with turning-movement "sankeys", extended clearance (amber) time, **pathfinding cost sliders** (crossings, U-turns, turns, lane changes), and service-vehicle scheduling around rush hour. Published Nov 2025, already in the top 25. |
| **Traffic Lights Enhancement** (C2VMTLE → Bruceyboy24804) [78960](https://mods.paradoxplaza.com/mods/78960/Windows) / [128911](https://mods.paradoxplaza.com/mods/128911/Windows) | 170,460 + 114,523 | 4,274 + 1,146 | No custom signal modes. | Predefined signal modes, split phasing with protected left turns, traffic groups and green waves. |
| **Realistic Parking** (DaancingBanana) [87313](https://mods.paradoxplaza.com/mods/87313/Windows) | 212,743 | 1,747 | Cars circle for parking that doesn't exist. Vanilla detects a taken spot up to **40,000 nodes away** and reroutes erratically. Apartment garages hold 2–3 cars for hundreds of residents, and towers have about 30 spaces regardless of jobs. | Parking as **induced demand**: each spot accepts a limited number of pathfinding reservations. A short reroute radius. Garage capacity scales with households and workers. |
| **Realistic PathFinding** (ruzbeh0) [121226](https://mods.paradoxplaza.com/mods/121226/Windows) | 64,619 | 918 | Vanilla routes ignore road hierarchy, turn delays, transit waits, transfers and crowding, so cars rat-run through neighbourhoods. | **Turn delays** (extra for sharp turns and U-turns), a **road-hierarchy bias** (prefer arterials, avoid cut-throughs), **congestion avoidance**, transit wait and transfer penalties, crowding aversion, per-mode comfort weights, age-based walking speeds, and long-walk aversion. Everything is on sliders. |
| **Traffic Settings** (Espur04) [140062](https://mods.paradoxplaza.com/mods/140062/Windows) | 65,234 | 693 | Fixing junctions one at a time is tedious, and U-turns happen at junctions Traffic can't edit. | City-wide bulk actions: remove U-turns, remove unsafe connections, reset to vanilla. |
| **Traffic: Clear the Way** (BastiAkAHitNix) [151583](https://mods.paradoxplaza.com/mods/151583/Windows) | 49,754 | 677 | Ambulances queue at red lights. **On a fully blocked road vanilla finds no route past a wreck and deletes the whole queue.** Wrecks are "repaired" in place. | Emergency corridors, green-light pre-emption for responders, traffic that waits instead of despawning, wrecks pushed to the outer lane, and tow depots with tow trucks that haul wrecks away. |
| **Road Rules — Lane & Vehicle Restrictions** (progamer8785) [155436](https://mods.paradoxplaza.com/mods/155436/Windows) | 42,859 | 627 | No per-lane vehicle rules. | Per-lane truck and private-car bans, transit-only lanes, per-lane speed limits and lane closures, all enforced in the pathfinding graph. |
| **AdvancedTrafficSync** (elpitu) [115220](https://mods.paradoxplaza.com/mods/115220/Windows) | 44,030 | 1,145 | Signals and pedestrian crossings are uncoordinated. | Signal and crossing synchronisation. |
| **Outside Traffic Adjuster** (DaancingBanana) [124947](https://mods.paradoxplaza.com/mods/124947/Windows) | 22,096 | 243 | Through ("dummy") traffic between outside connections clogs highways. | Per-mode spawn rate for edge-to-edge traffic. |
| Pathfinding Customizer / Pathfind Costs / PedestrianPathfinding | 2–13k | — | Jaywalking, unsafe U-turns. | Cost sliders for each action. |

### 1.2 Road building and network tools

| Mod | Installs | ★ | Vanilla problem | What it adds |
|---|---:|---:|---|---|
| **Anarchy** (yenyang) [74604](https://mods.paradoxplaza.com/mods/74604/Windows) | **1,164,701** | 14,644 | Overly strict placement validation. | Turns off error checks, overlaps props and vegetation, and includes a **network upgrade overhaul**: quays, retaining walls, grass strips, street trees, **constant slope, force-ground, force-elevated**, and a wider elevation range. It replaced Extended Road Upgrades. |
| **Move It** (Quboid → yenyang) [74324](https://mods.paradoxplaza.com/mods/74324/Windows) | **1,072,965** | 18,140 | You can't move or reshape anything after placing it. | Moves and rotates trees, props, buildings, nodes and **segment curves**. Marquee selection and filters. |
| **Road Builder** (TDW, Trejak, BadPeanut) [87190](https://mods.paradoxplaza.com/mods/87190/Windows) | **655,494** | 10,465 | The vanilla road catalogue is fixed (CS2 shipped with no asset editor for roads). | **A live road-cross-section editor**: compose lanes (car, bus, tram, bike, parking, medians, sidewalks) for roads, highways, tracks and paths. Custom roads are saved in the city file, and *Edit All Instances* updates every placed segment. PCGamesN called it ["perhaps the most essential CS2 mod"](https://www.pcgamesn.com/cities-skylines-2/road-builder). Known conflict: it resets Traffic's lane connections when you edit a road. |
| **Extended Road Upgrades** (ST-Apps) [76971](https://mods.paradoxplaza.com/mods/76971/Windows) | 133,929 | 5,326 | Elevation and edge treatment need terraforming. | Quay, retaining wall, elevated and tunnel as *upgrades* on existing roads and tracks. Deprecated in favour of Anarchy; a [continuation](https://mods.paradoxplaza.com/mods/164028/Windows) exists. |
| **Network Tools** (LucaDevDesign) [133736](https://mods.paradoxplaza.com/mods/133736/Windows) | 145,876 | 1,467 | No node editing. | The successor to Network Multitool: add, remove and merge nodes ("super node"), reshape slope and curve, **parallel roads**, grid and circle generators. |
| **Node Controller** (Bruceyboy24804) [138523](https://mods.paradoxplaza.com/mods/138523/Windows) | 145,114 | 1,069 | Junction geometry is fixed. | Per-node segment-end offset, rotation and flat/slope/free modes, plus crosswalk overrides. |
| **Extra Networks and Areas** (Mimonsi) [77175](https://mods.paradoxplaza.com/mods/77175/Windows) | 435,798 | 3,531 | — | Invisible roads, custom park areas, integrated transit stops. |
| **Road Speed Adjuster** / **Adjust All Speed Limits** | 74,866 / 26,603 | — | Speed limits are fixed by road type. | Per-road speed limits. |
| **InterchangeBuilder** (TheJof) [153013](https://mods.paradoxplaza.com/mods/153013/Windows) | 28,246 | 431 | Ramps and loops are fiddly. | Ramp, loop, S-curve and U-turn tools with **lane snapping**, symmetry and grade control. |
| **Grid Road Generator** (Ti4goc) [151745](https://mods.paradoxplaza.com/mods/151745/Windows) | 30,229 | 325 | Laying out blocks is repetitive. | Fills an area with nine street patterns (grid, organic, terrain-following, superblock, radial…) with automatic upgrades and zoning. |
| **Bridge Builder** (cxhe) [160320](https://mods.paradoxplaza.com/mods/160320/Windows) | 32,502 | 384 | No custom bridges. | Custom bridges, including double-deck. |
| **Image Overlay** (algernon) [74539](https://mods.paradoxplaza.com/mods/74539/Windows) | 52,369 | 1,007 | — | Overlays a real map or plan image for tracing. |

### 1.3 Zoning and plopping

| Mod | Installs | ★ | Vanilla problem | What it adds |
|---|---:|---:|---|---|
| **Plop the Growables** (algernon) [75826](https://mods.paradoxplaza.com/mods/75826/Windows) | 474,765 | 3,451 | Growables are condemned if their zoning changes, and you can't place a chosen building. | Place any growable anywhere. Plopped buildings can be made historical (no levelling), naturally spawned ones optionally still need zoning, and abandonment can be cleared. |
| **Zone Organizer** (Mimonsi) [95965](https://mods.paradoxplaza.com/mods/95965/Windows) | 289,634 | 1,965 | The zoning menu lumps densities together. | Splits zones into low, medium, high and mixed tabs. |
| **Platter** (LucaDevDesign) [125278](https://mods.paradoxplaza.com/mods/125278/Windows) | 149,128 | 2,598 | **Zoning only grows from road edges on a rigid grid.** Curves, corners and gaps zone badly, and buildings face odd ways on corners. | **Ploppable parcels** of zone cells at any angle, with setbacks (front yards, space to widen roads later), snapping, and buildings that always face the parcel. It still uses vanilla demand and growth. |
| **Zoning Toolkit** (zeeshanabid94) [75750](https://mods.paradoxplaza.com/mods/75750/Windows) | 113,937 | 2,993 | Every road zones both sides, so parallel roads produce overlapping zone blocks. | Zone left, right, both or neither, on new or existing roads. |
| **Zone Tools** (River-mochi) [128269](https://mods.paradoxplaza.com/mods/128269/Windows) | 66,997 | 586 | Same as above. | Same idea, actively maintained. |
| **Advanced Road Tools** (Kemorno) [102147](https://mods.paradoxplaza.com/mods/102147/Windows) | 43,103 | 997 | Zone depth is fixed. | Zoning controller with preview. Planned: **zone depth from 0 to 12+** (2-deep for warehouses, 3-deep for row homes). |
| **Specialized Industrial Zones** (DillN2) [106939](https://mods.paradoxplaza.com/mods/106939/Windows) | 64,094 | 823 | **The generic industrial zone spawns any product at random**, so you can't plan a supply chain. | Twelve zones (Agriculture, Forestry, Oil, Ore × General, Warehouse-only, Manufacturing-only), filtered by product family. |
| **Industrial Zoning Expanded** (DaftHuman) [130356](https://mods.paradoxplaza.com/mods/130356/Windows) | 58,257 | 891 | Industry is one dirty, mixed zone. | **Light industry** (food, furniture, electronics…; low pollution), **heavy industry** (metals, steel, chemicals…), and **warehouse-only** zoning to place storage near cargo hubs. |
| **Clean Industry Zones** (Mimonsi) | 40,890 | 456 | — | Clean manufacturing and warehouse zones. |
| **Custom Zones** (dvovo) | 846 | — | — | User-defined zones with chosen building lists. |

### 1.4 Economy and simulation realism

| Mod | Installs | ★ | Vanilla problem | What it adds |
|---|---:|---:|---|---|
| **Realistic Trips** (ruzbeh0) [77171](https://mods.paradoxplaza.com/mods/77171/Windows) | 74,578 | 1,493 | Activity is spread over an "average" day. There are no real rush hours, no weekdays or weekends, and the day is too short for the trip lengths. | **Rush hours, quiet nights, lunch breaks, a seven-day week**, school, shopping and leisure timing, and arrival/departure distributions where the evening commute is wider than the morning one. Presets for 18 countries from travel surveys. Optionally a **slower clock without slowing the simulation**. Successor to Time2Work. |
| **Realistic Workplaces And Households** (ruzbeh0) [87755](https://mods.paradoxplaza.com/mods/87755/Windows) | 33,088 | 924 | Capacities don't match building size: a **30-storey office holds 100–150 jobs** ([Steam](https://steamcommunity.com/app/949230/discussions/0/3937895062998454828)). | Households and jobs (and service capacities and staffing) computed from **building dimensions**: footprint × estimated floors ÷ m² per unit. Balancing helpers for upkeep, consumption and rent. |
| **Realistic JobSearch** (ruzbeh0) [123500](https://mods.paradoxplaza.com/mods/123500/Windows) | 24,180 | 357 | **Vanilla job choice ignores distance**, which gives long, arbitrary cross-city commutes. | A **gravity model**: attraction rises with employer size and falls with distance. Produces job clusters plus some cross-city commuting. |
| **Population Rebalance** (Infixo) [76037](https://mods.paradoxplaza.com/mods/76037/Windows) | 39,784 | 1,692 | The life cycle is unrealistic: 21/36/84 age thresholds, many people move away, education doesn't match jobs. | 12/20/75 thresholds, stricter graduation, fewer births and more deaths, and a cap on new households when housing vacancy is low. |
| **Change Company** (rcav8tr) [114101](https://mods.paradoxplaza.com/mods/114101/Windows) | 44,804 | 583 | You can't pick what a building produces, production is unbalanced, and companies leave. | Change or lock a building's company, **automatic production balancing**, and overrides for workplaces, storage and vehicles per company type. |
| **Demand Master Control** (StarQ) [86944](https://mods.paradoxplaza.com/mods/86944/Windows) | 23,800 | 446 | Demand is opaque and swings wildly. | Sliders for every demand input: happiness, free jobs, tax, homelessness, vacancy threshold, extractor demand, commuter mode preference. |
| **Economy Rebalance** (Infixo) [77509](https://mods.paradoxplaza.com/mods/77509/Windows) | 9,037 | — | Big cities can't be self-sufficient, per-capita consumption "skyrockets", and the workforce's education doesn't match job mixes. | Bigger extractor output (enough for >300k cities), consumption fixes, price tweaks, lower company profitability (slower levelling), rebalanced commercial demand. |
| **Land Value Overhaul** (jimmyok) [77397](https://mods.paradoxplaza.com/mods/77397/Windows) | 9,207 | — | Land value either runs away (₡1–2M) or, after 1.1.0, depends on only five coverages. Low density gets "high rent", commercial gets "not enough customers". | A "soft market" land value model plus a reworked upgrade mechanism. |
| **Profit Based Industry And Office** (Adwozo) [83825](https://mods.paradoxplaza.com/mods/83825/Windows) | 10,380 | — | **Vanilla companies hire based on how full their storage is**, not on profit: hire below ¼ full, fire above ½, minimum 5 staff. | Headcount follows profit and accounts for material costs. Minimum headcount is ¼ of capacity. |
| **Market Based Economy** (Adwozo) | 1,483 | — | Prices are static. | Dynamic resource prices, wages that respond to unemployment and skill gaps, minimum staffing. |
| **No Office Demand Fix** (AnotherFireFox) [137126](https://mods.paradoxplaza.com/mods/137126/Windows) | 7,060 | — | Office demand gets stuck: phantom vacancies in signature buildings, an office AI loop bug, and software imports with no seller. | Targeted fixes (still current in 2026). |
| **Tourism Overhaul** (Meapy) [153543](https://mods.paradoxplaza.com/mods/153543/Windows) | 54,126 | 633 | Each tourist rolls a transport mode once (10% road, 10% train, 50% air, 30% sea). **With no airport or harbour, 80% of tourists are silently deleted.** Outside connections have no capacity limit. | Redistributes arrivals over the connections you actually have, adds congestion-aware arrival routing, and adds a tourism demand bar. |
| **Hard Mode (Continued)** | 416 | — | The economy is too easy ("an auto-scaling counter", [Steam](https://steamcommunity.com/app/949230/discussions/0/565911724530819738/)). | Shrinking subsidies, flat milestone rewards, demolition cost based on evictions and land value, terraforming costs. |
| **529 Tiles** (algernon) [74328](https://mods.paradoxplaza.com/mods/74328/Windows) | 472,376 | 7,081 | Only 441 of 529 tiles can be bought. | Unlock all tiles, or spread them over milestones. |
| **Historical Start** (algernon) [74535](https://mods.paradoxplaza.com/mods/74535/Windows) | 35,897 | 561 | Milestones lock rail, shipping and industry, so you can't found a railway or mining town. | Unlocks rail, shipping, highways and resource industries from the start, at reduced XP. |
| Super Fast Building and Leveling / InfiniteDemand | 91,744 / 44,365 | — | Growth is slow and demand runs dry. | Cheats. Their popularity shows how frustrating demand is. |

### 1.5 Information and UI

| Mod | Installs | ★ | Vanilla problem | What it adds |
|---|---:|---:|---|---|
| **Better Bulldozer** (yenyang) [75250](https://mods.paradoxplaza.com/mods/75250/Windows) | **896,707** | 5,217 | You can't delete stuck vehicles or cims, invisible paths, surfaces or markers. | Bulldozes moving objects (radius mode), targets surfaces, markers and invisible networks exclusively, and can skip the confirmation prompt. |
| **Find It** (TDW) [77240](https://mods.paradoxplaza.com/mods/77240/Windows) | **798,270** | 5,846 | The asset menu is hard to browse. | Search, tags, favourites, picker tool. |
| **Skyve** (TDW) [75804](https://mods.paradoxplaza.com/mods/75804/Windows) | 370,904 | 8,087 | — | Mod and playset manager, log sharing. |
| **Extended Tooltip** (Mimonsi) [78188](https://mods.paradoxplaza.com/mods/78188/Windows) | 320,671 | 2,658 | Key numbers are hidden. | Hover shows efficiency, employees, what a building produces or sells, transit waiting counts and times, road length/upkeep/condition, rent and household balance. |
| **Toggle Overlays** (TDW) | 166,152 | 1,407 | Overlay clutter. | — |
| **Better Transit View** (gnznroses) [139595](https://mods.paradoxplaza.com/mods/139595/Windows) | 165,471 | 1,234 | The transit overview is unusable. | Thicker lines when zoomed out, shared-stop indicators, per-stop waiting and transfer info. |
| **InfoLoom** (Infixo → Bruceyboy24804) [91433](https://mods.paradoxplaza.com/mods/91433/Windows) | 88,577 (+2,738 original) | 956 | **Demand is a black box.** The household demand that controls spawning is hidden. | Eleven windows: demographics, workforce by education (including "working below education" and "working outside"), workplace distribution, residential data, **demand factors with numeric values**, commercial/industrial/office data, trade costs, districts. |
| **Show Text Trends** / **City Stats** | 90,620 / 30,791 | — | No trend readout. | Money and population trends. |
| **Traffic Spy** (gnznroses) [128566](https://mods.paradoxplaza.com/mods/128566/Windows) | 33,777 | 486 | The vanilla route view has no volume and no reasons. | Route lines **coloured by volume**, breakdown by trip purpose, a list of jams and bottlenecks (including ones the game doesn't flag), per-platform analysis. |
| **Cim Route Highlighter** (mattswarthout) [76662](https://mods.paradoxplaza.com/mods/76662/Windows) | 33,448 | 892 | You can't see where workers live or where residents work. | Highlights employees' homes, residents' jobs, routes through a segment, and passengers' destinations. |

### 1.6 Public transport

| Mod | Installs | Vanilla problem | What it adds |
|---|---:|---|---|
| **Xtended Transport Manager** (klyte45) [74238](https://mods.paradoxplaza.com/mods/74238/Windows) | 87,956 | Poor line management. | Linear line maps, automatic colours, naming, line shields. Successor to TLM/ITM. |
| **TransportPolicyAdjuster** (TheSonnyX) [78622](https://mods.paradoxplaza.com/mods/78622/Windows) | 85,079 | Vehicle count is tied to route length. | Free per-line vehicle counts. |
| **All Aboard!** (ethnicboyfriend) [86605](https://mods.paradoxplaza.com/mods/86605/Windows) | 57,290 | **Vehicles wait until every assigned passenger boards** (including pets or kids blocks away), so trains stall in cities over 250k. | A cap on dwell time. |
| **Depot Capacity Changer** / **Adjust Transit Capacity** | 38,864 / 32,367 | Depot limits. | — |
| **Concurrent Bus Boarding** (Meapy) [152153](https://mods.paradoxplaza.com/mods/152153/Windows) | 35,462 | Only one bus can board at a stop. | Two or more buses board at once, with stop length editable. |
| **SmartTransportation** (ruzbeh0) [90264](https://mods.paradoxplaza.com/mods/90264/Windows) | 31,172 | Fixed fares and fleets regardless of peak or off-peak. | Automatic fares and fleet size toward a target occupancy. |
| **Auto Bus Lines** (kl09joker) [161531](https://mods.paradoxplaza.com/mods/161531/Windows) | 25,049 | Building a bus network is tedious. | Automatically plans stops and loop lines per district. |

### 1.7 Other widely installed mods (not core to our design)

Water Features (485k), ExtraLandscapingTools (508k), Advanced Line Tool (560k), ExtraDetailingTools (564k), ExtraAssetsImporter (620k), Tree Controller (378k), First Person Camera (293k), Time & Weather Anarchy (284k) and Recolor (223k) are mostly about detailing and visuals. They are irrelevant to the simulation, but they show that CS2 players spend a lot of time on detailing.

### 1.8 What the install data says

1. The top five player-chosen mods are all **tools that undo vanilla restrictions**: Anarchy, Traffic, Move It, Better Bulldozer, Find It. The two most-rated mods (Traffic with 20.7k ratings, Move It with 18.1k) are both about controlling roads.
2. **Road Builder (655k)** ranks next to them, so player-defined road cross-sections are a mainstream expectation, not a niche one.
3. **Simulation-realism mods are a smaller, committed group** (25–75k installs each). The ruzbeh0 suite (Trips, Workplaces, JobSearch, PathFinding) and Realistic Parking (213k) are the core of it.
4. Mods from 2025–26 that are growing fastest focus on **signals** (Traffic Tool Essentials, 275k in about a year), **ploppable zoning** (Platter, 149k), **network geometry** (Network Tools, Node Controller, about 145k each) and **diagnostics** (Better Transit View, Traffic Spy).

---

## 2. The biggest complaints about vanilla CS2, and the community's fix for each

| Area | Complaint | Evidence | What the community says the fix should be |
|---|---|---|---|
| **Lane changing** | Vehicles change lanes at the last second, cut across several lanes, or **back up** to merge. | [Steam](https://steamcommunity.com/app/949230/discussions/0/4406291330030559509); Iceflake still listed "cars changing lanes at the last second" as under investigation in Feb 2026 ([City Corner #2](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/upcoming-gameplay-updates)). | Choose lanes early, using the route several segments ahead. **Lane connectors** (Traffic). Restrict weaving zones. Players work around it by rebuilding roads as one long segment and limiting each node to two choices. |
| **U-turns** | Illegal or unnecessary U-turns at junctions and mid-road. | Patch 1.5.9f1 "Morning Dew" (May 2026) raised the U-turn pathfinding cost ([PCGamesN](https://www.pcgamesn.com/cities-skylines-2/update-morning-dew)); Traffic Settings exists to strip them city-wide. | Ban U-turns by default, allow them only where a junction or turnaround permits, and give the player a per-junction toggle. |
| **Pathfinding** | Cims take routes "significantly longer than necessary", rat-run through local streets, and bus/taxi lanes fill with private cars ([2026 Metacritic user review](https://www.metacritic.com/game/cities-skylines-ii/user-reviews/)). | CS2 routes on a cost of **time, comfort, money and "behaviour"**, weighted by age group ([Paradox: Traffic AI](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/traffic-ai)). | **Turn penalties, road-hierarchy bias, live congestion feedback** (Realistic PathFinding); strict lane permissions (Road Rules); expose cost sliders (Traffic Tool Essentials). |
| **Accidents and blockages** | Queues behind a crash **are deleted** when no route exists; responders are stuck in traffic. | [Traffic: Clear the Way](https://mods.paradoxplaza.com/mods/151583/Windows) | Never despawn; wait and reroute. Emergency corridors and signal pre-emption. Visible tow and clean-up. |
| **Parking** | Cars search for non-existent parking and reroute erratically across the map; building garages are far too small. | [Realistic Parking](https://mods.paradoxplaza.com/mods/87313/Windows) | Treat parking as a reservable, limited resource that feeds mode choice. Garage size scales with the building's occupants. |
| **Signals** | Fixed phases, no coordination, no data. | Traffic Tool Essentials (275k) and TLE (285k combined) | Phase editor, adaptive timing, green waves, counts per approach. |
| **Commute realism** | **Job choice ignores distance**, so commutes are random and cross-city ([Realistic JobSearch](https://mods.paradoxplaza.com/mods/123500/Windows)). Trips are spread across the day with no rush hour ([Realistic Trips](https://mods.paradoxplaza.com/mods/77171/Windows)). The 1.1.12 "job seeking optimisation" reportedly cut transit demand sharply ([r/CitiesSkylines patch thread](https://lr.eu.psf.lt/r/CitiesSkylines/comments/1h07m3b/patch_notes_for_cities_skylines_ii_v1112f1)). Patch 1.6.0 (June 2026) added per-purpose trip-length limits to stop "absurdly long trips across the map" ([patched.gg](https://patched.gg/games/cities-skylines-ii/patch-160f1-summer-solstice)). | Gravity-model job and shop choice. Time-of-day trip schedules with weekday/weekend patterns. A day long enough for travel times to make sense. Some players complain that fixing performance by **removing** simulation (shorter trips, fewer trips) made the city feel hollow ([Steam](https://steamcommunity.com/app/949230/discussions/0/565911724530819738/)). |
| **Economy is shallow** | "Basically an auto-scaling counter": taxes can be maxed with little consequence, and late game is unlimited money. The simulation is called "hollow" and "more of a city painter" ([Steam, 2025](https://steamcommunity.com/app/949230/discussions/0/565911724530819738/)). Economy 2.0 (1.1.5f1, June 2024) removed subsidies and tied demand to household wealth and consumption ([Dexerto](https://www.dexerto.com/gaming/cities-skylines-2-patch-notes-1-1-5f1-economy-changes-bug-fixes-more-2794481/), [dev diary](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-one)), but reviewers in 2026 still call it inconsistent. | Real costs (demolition, terraforming), profit-driven companies, dynamic prices and wages (PBIAO, Market Based Economy, Hard Mode). Make consequences legible. |
| **Demand opacity** | Demand bars swing, the hidden household demand controls spawning, and players can't tell why nothing grows. | InfoLoom, Demand Master Control, Demand Debug, Calmer Demand Bars mods | Show **every demand factor with its value**. Smooth the bars. |
| **Workplaces and capacity** | Building capacity doesn't match size: 30-storey offices with 100–150 jobs. A commercial-workplaces bug (fixed in 1.3.6). Education mix doesn't match the job mix. | [Steam](https://steamcommunity.com/app/949230/discussions/0/3937895062998454828), [Commercial Workplaces Fix](https://mods.paradoxplaza.com/mods/117866/Windows), Economy Rebalance | Derive capacity from floor area; align the education distribution with the job mix. |
| **Land value and rent** | "High rent" warnings even for educated households; commercial "not enough customers"; low density dies next to towers. | [Land Value Overhaul](https://mods.paradoxplaza.com/mods/77397/Windows), [GamesRadar](https://gamesradar.com/cities-skylines-2-high-rent-fix-solution) | A stable land-value model. Rent that tracks what residents can afford. |
| **Industry** | Generic industry spawns random products, so supply chains can't be planned. Specialized output is too small for big cities. Some signature industrial buildings stayed empty ([SignatureFix](https://mods.paradoxplaza.com/mods/76065/Windows)). Company hiring follows storage, not profit. | Specialized Industrial Zones, Industrial Zoning Expanded, Change Company, PBIAO, Economy Rebalance | **Zones per product family**, warehouse zoning, light vs heavy industry, profit-based hiring, and a visible production balance. |
| **Offices** | Office demand gets stuck (signature phantom vacancy, software import seller bug). | [No Office Demand Fix](https://mods.paradoxplaza.com/mods/137126/Windows) | Robust immaterial-goods trade. |
| **Cargo and outside connections** | Constant dummy through-traffic. Early reports that ships, trains and planes **leave empty** (only trucks exported, 2023). Outside connections have **no capacity concept**. Tourists are deleted when no matching connection exists. | [Paradox forum request](https://admin-forum.paradoxplaza.com/forum/threads/configure-passing-through-transportation-and-cargo-vehicles-on-outside-connections-ban-allow.1622031), [Steam](https://steamcommunity.com/app/949230/discussions/0/3877095833482632634/), Tourism Overhaul, Outside Traffic Adjuster | Edge connections with **capacity and a real origin**. Controllable through-traffic. Every inter-city flow is a real trip. |
| **Transit** | Vehicles dwell forever waiting for every assigned passenger; buses queue at a stop; fleet size is tied to route length; 80% of bike traffic was cut as a stop-gap. | All Aboard!, Concurrent Bus Boarding, TransportPolicyAdjuster, City Corner #2 | Capped dwell time, multi-berth stops, free fleet sizing, timetables. |
| **Scale and performance** | The simulation "breaks down" around 200k and lags at 400k ([Steam](https://steamcommunity.com/app/949230/discussions/0/565911724530819738/)); severe CPU bottlenecks are reported even at low population ([Metacritic 2026](https://www.metacritic.com/game/cities-skylines-ii/user-reviews/)). | EconomyEX/MapExt patches for large cities | Simulate fewer agents with more meaning each (see §6). |
| **Progression** | XP milestones lock rail, harbour and mining, so there are no historical "railway town" starts. 88 tiles can't be bought. | Historical Start, 529 Tiles | Let the region's geography (a port, a mine, a rail line) decide what each town starts with. |

Studio context: Paradox and Colossal Order split in Nov 2025, and Iceflake Studios took over development in 2026 ([PC Gamer](https://www.pcgamer.com/games/city-builder/after-the-bungled-launch-of-cities-skylines-2-paradox-interactive-and-colossal-order-part-ways-as-development-moves-to-a-new-studio), [Paradox](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/an-update-on-cities-skylines-ii)). 2026 patches have targeted traffic (1.5.9 Morning Dew: U-turn cost) and pathfinding (1.6.0 Summer Solstice: trip limits per purpose).

---

## 3. How CS2 industry works

Sources: [Paradox wiki: Industry](https://cs2.paradoxwikis.com/Industry), [Resources](https://cs2.paradoxwikis.com/Resources), [Economy](https://cs2.paradoxwikis.com/Economy), [Traffic AI feature page](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/traffic-ai), [Cargo feature page](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation), mod descriptions. Parts of the wiki are verified only for 1.0/1.1.5.

### 3.1 The pieces

- **Specialized industry (extractors).** You place a central building, then drag the corners of an **extraction area** within a ring around it (the corners stay editable). Most types need a matching natural resource under the area (fertile land, forest, ore, oil); livestock and stone need none. Companies move in and out of the area depending on desirability, but **the buildings never become abandoned**. Oil and ore are finite. Oil drilling carries extra fire risk. All extractors are noisy and polluting.
  - Agriculture: livestock, grain, vegetables, cotton (textile fibre). Forestry: wood. Ore: stone (rock), coal, metal ore. Oil: crude oil.
  - Fish: the 2023 feature list and the wiki give four farm types plus forestry, stone, coal, ore and oil ([Neowin](https://www.Neowin.Net/news/cities-skylines-2-offers-much-deeper-control-over-its-economy-and-production-over-original/)). Fish appears as a storable resource in mods such as Industrial Zoning Expanded, but no source confirmed a fishing extractor in the base game. Treat fishing as unconfirmed or DLC.
- **Zoned industrial (manufacturing).** A single zone in which any processing company can spawn. **The player can't choose which product a building makes**, which is what several mods fix. Some storage (warehouse) companies also spawn in industrial zones.
- **Office zones** produce **immaterial goods**: software, telecom and financial services. Low-density offices unlock at milestone 4, high-density at milestone 10.
- **Commercial zones** sell goods to households and produce immaterial services (meals, lodging, entertainment, media, recreation).
- **Warehouses (storage companies).** They buffer goods so producers have time to find buyers. Empty warehouse space creates industrial ("storage") demand of its own. InfoLoom shows industrial demand as the higher of building demand and storage demand.
- **Cargo terminals** (truck, train, harbour, airport). Trains, ships and planes bring goods from outside connections to a terminal, where **city-owned trucks do the last-mile delivery**. With no cargo lines at all, a terminal still acts as a distribution centre.
- **Outside connections** (highway, rail, sea, air, plus power and water lines). Goods in deficit are **imported** and surpluses **exported**. Imports don't cut industry revenue but add traffic. Exports earn less because shipping distance costs money.

### 3.2 Production chains (Paradox wiki; table partly inferred, verify against the in-game Production tab)

```
Extractors
  Forestry ............ Wood ─┬─► Timber ─┬─► Paper (consumers, offices)
                              │           └─► Furniture (consumers, offices)
                              └─► heating
  Grain ............... Grain ──► Beverages*, Convenience Food*, Petrochemicals*
  Livestock ........... Livestock ──► Food*, Convenience Food*, Textiles*
  Vegetables .......... Vegetables ──► Food*, Beverages*
  Cotton .............. Cotton ──► Textiles*
  Oil ................. Crude Oil ──► Petrochemicals*, Chemicals*
  Ore ................. Metal Ore ──► Metals ──► Steel*, Machinery*, Vehicles*
  Coal ................ Coal ──► Steel*, electricity
  Stone ............... Rock ──► Concrete (building upkeep), Minerals ──► Chemicals*, Electronics*

Manufacturing (* = needs two inputs)
  Steel = Coal + Metals            Machinery = Metals + Steel
  Petrochemicals = Crude + Grain   Chemicals = Crude + Minerals
  Plastics = Chemicals + Petrochem Pharmaceuticals = Chemicals
  Electronics = Minerals + Plastics Vehicles = Metals + Plastics
  Beverages = Grain + Vegetables   Convenience Food = Grain + Livestock
  Food = Livestock + Vegetables    Textiles = Cotton + Livestock (+ Petrochem)

Offices (immaterial)
  Software = Electronics ─► Telecom, Financial  (consumed by industry, offices, citizens)

Commercial (immaterial services)
  Meals ◄ Beverages · Lodging ◄ Food · Media ◄ (wiki says Food) · Entertainment · Recreation
```

City services consume some goods too: healthcare uses pharmaceuticals, fire and rescue uses food, and **building upkeep consumes concrete and timber**.

### 3.3 How companies behave

- Companies **sell locally first** because it is the most profitable. Delivery cost rises with distance; the "money" term in pathfinding covers fuel and fees.
- Location choice weighs land value and rent against production value and **transport costs for inputs and outputs**.
- **Hiring in vanilla follows inventory**, not profit: hire when stock is below ¼ of storage, fire when above ½, minimum 5 staff ([PBIAO](https://mods.paradoxplaza.com/mods/83825/Windows)).
- Since Economy 2.0, a company in an unprofitable location goes bankrupt instead of relocating, and taxes and workforce affect profitability.
- Higher building levels (1–5) are more efficient: less electricity, water, garbage and pollution per unit of output.

### 3.4 Ties to progression and specialization

- **Milestones unlock extractors.** Since 1.1.5 livestock and stone are available from the start; grain and forestry come before Grand Village; cotton before Boom Town; ore before Busy Town; oil before Big Town. Before 1.1.5 they were gated at milestones 3–8.
- The **Production panel** (economy tab) unlocks at milestone 2 and shows production against consumption for each resource.
- **Signature buildings** unlock through production and transport targets, for example *Sporting Goods Store* after 10,000 cotton goods produced and *Conference Center* after 20,000 ship passengers. Their effects include industrial efficiency, lower import costs and attractiveness ([wiki](https://cs2.paradoxwikis.com/Signature_buildings)).
- **City specialization is emergent in CS2**, not a formal system. It comes from whatever natural resources the map has under it, your choice of specialized areas, and signature buildings. There is no CS1-style district specialization for industry. CS1's *Industries* DLC had industry *areas* with levels, worker counts and unique factories.

### 3.5 Known problems and what mods change

| Problem | Mod response |
|---|---|
| Random product mix in generic industry | Specialized Industrial Zones (zones per product family), Industrial Zoning Expanded (light, heavy, warehouse), Clean Industry Zones, Change Company (pick or lock the company) |
| Big cities can't be self-sufficient; extractor output too low; consumption explodes | Economy Rebalance |
| Hiring tied to stock levels | PBIAO, Market Based Economy |
| Production imbalance | Change Company "Production Balance", Resource Locator |
| Empty signature industry; office demand stalls | SignatureFix, No Office Demand Fix |
| Warehouses placed randomly, so truck traffic crosses the city | Warehouse-only zoning near cargo hubs (Industrial Zoning Expanded) |
| Through cargo and dummy traffic | Outside Traffic Adjuster, CityPlayer Traffic Custom Mod |
| Imports and exports untuned | Market Based Economy (external market reference prices) |

---

## 4. Zoning, levelling, land value, demand, signature buildings, milestones

### 4.1 Zoning grid

- **Cell = 8 m.** Zone blocks grow from road edges **up to 6 cells (48 m) deep**; the engine's maximum block width is 10 cells ([CS2 modding reference: ZoneUtils](https://ps1ke.github.io/Cities-Skylines-2-Modding-Guide/Game/Zones/ZoneUtils)). Lot sizes ([wiki](https://cs2.paradoxwikis.com/Zoning)):
  - Low-density residential: 2×2 to 4×6
  - Row housing: 1×2 to 1×6 (one cell wide)
  - Medium, high, mixed and low-rent residential: 2×2 to 6×6
  - Low commercial: 2×2 to 5×6
  - High commercial, office and industrial: 2×2 to 6×6
- Community grid maths: zoning six deep on both sides takes 96 m, so the ideal square blocks are 112 m (gravel), 128 m (2-lane) and 144 m (4-lane) ([gameplay.tips](https://gameplay.tips/guides/cities-skylines-ii-practical-engineering-efficient-grids.html)).
- Tools: fill, marquee, paint; right-drag unzones. Every road zones both sides with no option to turn it off, which is why Zoning Toolkit and Zone Tools exist. Zones follow the road and suffer on curves, which is what Platter fixes with free parcels.

### 4.2 Zone types

- **Residential:** low density (houses: higher tax per household, families and seniors), **row housing** (medium density), medium density, high density (towers: students and singles, lower tax per resident), **mixed** (shops on the ground floor, flats above), **low-rent** (small cheap units).
- **Commercial:** low (shops, restaurants), high (malls, hotels).
- **Office:** low, high.
- **Industrial:** manufacturing, plus specialized extraction areas, which are painted as areas rather than zoned.
- Regional themes (EU/NA and region packs) change the architecture, not the mechanics.

### 4.3 Levelling, rent and land value

- Buildings have **levels 1–5**. A building **levels up when rent paid exceeds upkeep** and occupants pool the surplus. It **declines when rent can't cover upkeep**: people leave, then the building is abandoned, then it collapses. Higher levels mean more apartments (at levels 3 and 5 for medium/high density), more efficiency and higher rent. The look changes every other level.
- **Land value** spreads along roads. It rises when residents' and companies' needs are met (shops, services in use), not merely when services are placed. High demand pushes rent up. Low density feels rises most, which pushes poorer households into medium density. It can be managed through taxes, zoning supply, or limiting services.
- Known problems: runaway or flat land value and "high rent" spirals (§2).

### 4.4 Demand

- Four bars: **residential, commercial, industrial, office**. There is also a hidden household demand that controls whether new households spawn, which InfoLoom exposes.
- **Residential** demand rises with job growth and arrivals, and falls with unemployment and vacancies. Since Economy 2.0 it also depends on happiness, homelessness, tax, open student places and jobs.
- **Commercial** demand comes from local goods supply, purchasing power and workforce.
- **Industrial** demand comes from available workers, commercial need for goods, nearby extraction, and empty warehouse space.
- **Office** demand comes from office-educated job seekers and demand for immaterial goods; software output spurs more offices.
- Taxes can be set **per education level** (residential) and **per product** (commercial, industrial, office), from −10% to 30%. Taxes now feed into demand.

### 4.5 Signature buildings

Unique zoned buildings for residential, mixed, commercial, office and industrial; each can be built once. They are **free to place once unlocked**. Unlock conditions are milestones (e.g. M5, M10, M16), zoning volume (e.g. 5,000 cells of EU row housing, 100 level-5 high-density buildings), or production and transport targets. Their effects include well-being in a radius, attractiveness, efficiency and cheaper imports. Otherwise they behave like normal growables, with companies, workers and customers ([wiki](https://cs2.paradoxwikis.com/Signature_buildings)).

### 4.6 Milestones and progression

- **XP, not population.** XP comes from building (roads, services, power, grid connections) plus passive XP from population and happiness every 1.5 in-game hours ([The Review Geek](https://www.thereviewgeek.com/citiesskylines2-guide-progressionsystem/), [CO dev diary 10](https://colossalorder.fi/news/development-diary-10-game-progression/)). Each milestone gives cash, **development points** for the service skill trees, **expansion permits** (map tiles) and a higher loan limit. Exact XP thresholds weren't in the sources I could access.
- **Milestone table** ([wiki](https://cs2.paradoxwikis.com/Milestones), verified for 1.1.5):

| # | Name | Cash | Dev pts (total) | Tiles (total) | Key unlocks |
|---|---|---:|---:|---:|---|
| 0 | start | — | — | 9 | Low residential, low commercial, industry, 2-lane roads, basic utilities |
| 1 | Tiny Village | 25k | 1 | 3 | **Row housing**, healthcare, garbage, map tiles, taxation and budget, **4-lane roads** |
| 2 | Small Village | 50k | 3 | 7 | **Medium residential**, education, **Production panel** |
| 3 | Large Village | 75k | 6 | 12 | Fire, police and administration |
| 4 | Grand Village | 100k | 10 | 18 | **Low-rent housing, low offices**, **transportation**, parks, **districts and policies**, transport overview, disasters |
| 5 | Tiny Town | 125k | 15 | 25 | **Mixed housing**, communications, parking-fee policy, speed bumps |
| 6 | Boom Town | 150k | 21 | 33 | Heavy-traffic ban policy |
| 7 | Busy Town | 175k | 28 | 42 | Gated community |
| 8 | Big Town | 200k | 36 | 52 | **High-density residential** |
| 9 | Great Town | 225k | 45 | 64 | **High-density commercial** |
| 10 | Small City | 250k | 55 | 79 | **High-density offices**, high-speed highways, combustion-engine ban |
| 11–20 | Big City → Megalopolis | 275k → 500k | 66 → 232 | 97 → 432 | Money, development points, tiles, loans only |

  Population is only a side effect. Players commonly quote reaching milestone 20 at around 100k+ population depending on build style, but that is not an official threshold.
- Transport modes, services and upgrades are bought with development points in each service's tree. That is why rail, harbour and airport can feel locked behind progression (§2).

---

## 5. Multiple cities and regional play

### 5.1 Cities: Skylines I and II

- **Neither has multi-city regional play.** Each save is one city on one map: CS1 has 9 to 81 tiles via mods (about 17 km), CS2 has 441 tiles (529 with the mod) on a 14.3 km map (about 159 km²). The world beyond the edge is abstract: **outside connections** for road, rail, sea, air, power and water act as an infinite source and sink for goods, commuters (CS2 lets outside workers fill jobs; InfoLoom counts "working outside" and "commuting in"), tourists and dummy through-traffic.
- Players have long asked for SC4-style regions ([Steam](https://steamcommunity.com/app/255710/discussions/0/133258593408450169)). Developers and modders called it unlikely because of scalability. CS2's "Region Packs" are **architectural asset packs**, not regions ([eXputer](https://exputer.com/?p=318327)).
- The nearest mods: **MapExt / Map Extended** (Noel2) enlarges CS2 to 28, 43 or 57 km maps (4×4 the vanilla area) with economy and performance patches for metropolis scale ([forum](https://admin-forum.paradoxplaza.com/forum/threads/map-extended-mod-beta-57km-version.1738213), [EconomyEX](https://mods.paradoxplaza.com/mods/137149/Windows)). It means one giant city, not several, and players report crashes and heavy hardware demands. Players fake regions by building several towns on one map, joined by highways.
- Inter-city traffic in CS2 is only **dummy edge-to-edge traffic** plus outside-connection commuters and cargo, which has **no capacity concept**. Mods add rush-hour shaping to it ([CityPlayer Traffic Custom](https://thunderstore.io/c/cities-skylines-ii/p/CityPlayer/Cities2Mods_CityPlayerTrafficCustomMod/v/0.1.0/)) or cut it down (Outside Traffic Adjuster).

### 5.2 SimCity 4 (2003) — the reference for regions

How it worked (sources: [Wikipedia](https://en.wikipedia.org/wiki/SimCity_4), [Wikibooks](https://en.wikibooks.org/wiki/SimCity/SimCity_4), community FAQs; items marked † are from general knowledge of SC4, not re-verified here):
- A **region** is a grid of city tiles in small, medium and large sizes (about 1, 2 and 4 km per side), defined by a bitmap. Each tile is a separate city save.
- **Neighbour connections**: a road, rail, highway or pipe/wire that crosses the shared edge. They carry **commuters** (sims can live in one city and work in the next), **freight trips** (an industrial destination that raises the industrial demand cap), and **neighbour deals** that sell water, power and garbage disposal for money ([Tom's Hardware forum](https://forums.tomshardware.com/threads/simcity-4-regional-play.155571)).
- **Regional demand**: R/C/I demand and the demand caps are computed over the whole region, so unmet demand in one city spills into its neighbours. A bedroom suburb and an industrial city can depend on each other.
- †Only the city you are playing is simulated. The others are frozen until you open them, and their stats reach the region only when you save.

Why it worked:
1. **Specialization makes sense**: bedroom towns, industrial cities, a CBD and a landfill town, all tied together by commuting and deals.
2. **Edges have meaning**: building a highway to the neighbour is a real decision, and regional infrastructure is visible.
3. **Scale without one huge simulation**: each city is small enough to run on 2003 hardware.
4. It produced a **long-term canvas**, the region, that players filled over years.

Why it failed:
1. †**No simultaneous simulation**: a "round-robin" style of play, with commuters and deals going stale and **desync exploits** (play one city, build demand, switch). Cities don't change while you aren't watching.
2. Neighbour deals are fragile. They can vanish, and changing a deal means rebalancing every city in a chain ([Steam](https://steamcommunity.com/app/24780/discussions/0/3811784760595785825)).
3. †Commuting is limited in how far it can reach across city borders, and the cross-border traffic model is coarse. The fan-made Network Addon Mod (NAM) rewrote much of the traffic simulator.
4. Edges are seams. Building across a border is awkward and grid-aligned.

### 5.3 SimCity (2013) — regions done badly

- Cities were tiny (about a medium SC4 tile) and **80% of the visible region was unbuildable**. Cities were meant to share services, resources and Great Works, and **a single city couldn't survive on its own** ([GiantBomb](https://giantbomb.com/wiki/Games/SimCity_2013), [Medium](https://medium.com/@chrominance/simcity-the-most-disappointing-game-of-2013-3e9157cb80db)).
- In practice: always-online desyncs, commuters and transit lines that **didn't update across cities**, and the game never explained *why* splitting functions between cities was better than packing them into one ([GiantBomb forum](https://www.giantbomb.com/simcity/3030-37620/forums/the-mother-of-most-bugs-probably-region-commuting-1429908/), [EA forums](https://forums.ea.com/discussions/simcity-franchise-discussion-en/no-regional-commuting-between-cities-at-all/10418959)).
- Lesson: **forced interdependence plus small cities plus hidden flows = frustration.** Interdependence has to be an opportunity, not a tax, and cross-city flows have to be visible and reliable.

### 5.4 Other comparable games

- **Cities XL (2009–2012)**: several cities per player with **token trade**, where one token is a fixed surplus or shortage of a good. Some resources exist only on certain maps, which encourages specialization. Trade volume is limited per intercity road (20 tokens per road). Online trade was dropped in 2010 for single-player trade between your own cities and the NPC "Omnicorp" ([Cities XL wiki](https://breezewiki.discard.no/citiesxl/wiki/Planet), [GamePressure](https://www.gamepressure.com/citiesxxl/trade/z173cd)). Lesson: **link trade capacity to the physical roads between cities.**
- **Workers & Resources: Soviet Republic**: one large map with many towns, physical logistics of every resource, workers bussed between towns, and money earned only by delivering goods to **customs houses** at the Soviet and Western borders ([Hooded Horse wiki](https://wiki.hoodedhorse.com/Workers_Resources_Soviet_Republic/Questions_and_answers)). Players recommend it as the "hardcore economy" alternative to CS, while noting that CS is better at traffic and roads ([Steam](https://steamcommunity.com/app/949230/discussions/0/565911724530819738/)).
- **Transport Fever** (background knowledge): many self-growing towns on one map, linked by the player's transport. Towns grow from the supply and connectivity the player provides. It shows that "many towns, the player builds the links" works when the links are the core verb.

---

## 6. What this means for a road- and traffic-centred multi-city game

**Default answer:** "copy CS2 and add a region map". **Where to depart from it:** our core is *roads and traffic*, so the mods players install most (lane connectors, priorities, signals, road builder, Move It-style editing) should be the base toolset. The realism mods should become the base simulation, at an agent count a 2D top-down game can afford. The regional layer should exist **because of the roads between cities**, not as a separate mode.

### Recommended core features, ranked by evidence × fit

1. **Lane-level junction editor** (Traffic: 1.10M installs, most-rated mod): lane connectors and priority signs (yield/stop/priority), with **no U-turns by default**, plus a city-wide "remove unsafe/U-turn connections" (Traffic Settings).
2. **Signal editor with adaptive phases and green waves** (Traffic Tool Essentials 275k, TLE 285k): phases, protected turns, an adaptive mode, corridor coordination, counts per approach.
3. **Road cross-section builder** (Road Builder 655k) plus per-lane rules (Road Rules): bus, tram and truck-ban lanes, speed limits per lane, reused when upgrading a road in place.
4. **Free network editing** (Anarchy, Move It, Network Tools, Node Controller, Extended Road Upgrades): move nodes and curves after placing, parallel roads, constant slope. In 2D this means **editable curves and nodes, junction geometry and offsets, and elevated/tunnel as an upgrade**.
5. **Better pathfinding as the default** (Realistic PathFinding, 2026 patches): turn delays, **road-hierarchy bias**, live congestion feedback, transit wait and transfer costs, and **early lane choice** using the route several links ahead, which removes last-second lane changes.
6. **Gravity-model trip distribution and time-of-day schedules** (Realistic JobSearch, Realistic Trips): jobs and shops picked by size and distance; rush hours and weekdays/weekends; a day long enough for trip times. In a multi-city game this is also **what generates inter-city commuting**: a big employer in City A draws workers from City B in proportion to size and travel time.
7. **Parking as a capacity that feeds mode choice** (Realistic Parking 213k): reservations, garages sized to their buildings, no map-wide rerouting.
8. **No despawning** (Traffic: Clear the Way): jams persist and reroute; incidents block lanes; responders get corridors. If we ever cull agents, show it as a statistic, never as silent deletion.
9. **Diagnostics as first-class UI** (InfoLoom, Traffic Spy, Extended Tooltip, Better Transit View, Cim Route Highlighter): volume-coloured route tracing, trip-purpose breakdown, a bottleneck list, **every demand factor with its value**, a commute origin→destination view per city pair. For a traffic game this is the feedback loop.
10. **Capacity from building size** (Realistic Workplaces and Households): jobs and households from floor area, so a tower creates the traffic it should.
11. **Industry that can be planned** (Specialized Industrial Zones, Industrial Zoning Expanded, Change Company, PBIAO): zones per product family, light and heavy industry, **warehouse zoning near cargo hubs**, profit-driven hiring, a visible production balance per city. Keep CS2's chain table (§3.2) as the content.
12. **Real edge connections** (Tourism Overhaul, Outside Traffic Adjuster): the region edge and inter-city links have **capacity**; through-traffic is real and comes from the other cities; tourists and cargo choose connections that exist. *Every inter-city trip is a real trip on the player's roads*, which fixes CS2's dummy traffic by construction.
13. **Ploppable, angle-free zoning parcels with zone-side and depth control** (Platter, Zoning Toolkit, Advanced Road Tools). For a 2D grid game: zone left, right or none per road; depth of 1–6 cells; parcels with setbacks.
14. **Progression set by geography, not XP gates** (Historical Start, 529 Tiles): a port town starts with its harbour and a mining town with its mine. Unlock *capacity* (density, highways) with growth, not basic transport modes.

### Regional design rules drawn from SC4, SimCity 2013, Cities XL and W&R

- **Simulate every city at once, at the same clock**, so SC4's desync and round-robin play can't happen. Use a cheaper simulation for cities off-screen if needed, but keep all of them live.
- **Interdependence is an opportunity, never a requirement.** Each city can be self-sufficient; specialization (resources, a port, an employer hub) makes trade and commuting profitable. That avoids SimCity 2013's tax on splitting functions.
- **Inter-city flows travel on real roads, with their capacity.** Commuters, freight and through-traffic between cities are agents on the player's highways (Cities XL: trade limited by road capacity; SC4: neighbour connections). This puts the regional layer on top of the core traffic loop.
- **Make flows visible**: a city-pair matrix (commuters, freight, transit riders) and route tracing across borders. This addresses SimCity 2013's problem of hidden, unexplained flows.
- **No seams**: one continuous map with city *boundaries*, not separate tiles, so roads cross borders without special cases.

**What would prove this wrong:** if playtests show players don't use lane and signal tools when they're available from minute one (CS2 players install them *after* hitting problems), gate them behind the first congestion event rather than removing them. If agent-based inter-city traffic is too expensive at regional scale, fall back to aggregated flows on links (SC4-style counts) while keeping per-agent simulation inside the city on screen.

---

## Sources (main)

- Paradox Mods API and pages: `https://mods.paradoxplaza.com/mods/<id>/Windows` (ids in tables above); `https://api.paradox-interactive.com/mods?metadata=yes`
- Traffic GitHub: https://github.com/krzychu124/Traffic
- Paradox CS2 wiki: [Milestones](https://cs2.paradoxwikis.com/Milestones), [Industry](https://cs2.paradoxwikis.com/Industry), [Resources](https://cs2.paradoxwikis.com/Resources), [Zoning](https://cs2.paradoxwikis.com/Zoning), [Signature buildings](https://cs2.paradoxwikis.com/Signature_buildings), [Economy](https://cs2.paradoxwikis.com/Economy)
- Paradox feature pages: [Traffic AI](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/traffic-ai), [Public & cargo transportation](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation), [Economy dev diary](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-one), [City Corner #2 (Feb 2026)](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/upcoming-gameplay-updates), [Iceflake handover](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/an-update-on-cities-skylines-ii)
- Colossal Order: [Dev diary 10 — progression](https://colossalorder.fi/news/development-diary-10-game-progression/)
- Patches: [Morning Dew 1.5.9 (PCGamesN)](https://www.pcgamesn.com/cities-skylines-2/update-morning-dew), [Summer Solstice 1.6.0 (patched.gg)](https://patched.gg/games/cities-skylines-ii/patch-160f1-summer-solstice), [Economy 2.0 1.1.5 (Dexerto)](https://www.dexerto.com/gaming/cities-skylines-2-patch-notes-1-1-5f1-economy-changes-bug-fixes-more-2794481/)
- Press: [PCGamesN best mods 2026](https://www.pcgamesn.com/cities-skylines-2/mods), [PCGamesN Road Builder](https://www.pcgamesn.com/cities-skylines-2/road-builder), [PC Gamer on the CO/Paradox split](https://www.pcgamer.com/games/city-builder/after-the-bungled-launch-of-cities-skylines-2-paradox-interactive-and-colossal-order-part-ways-as-development-moves-to-a-new-studio)
- Community: [Steam — "Has CS2 improved? Economy"](https://steamcommunity.com/app/949230/discussions/0/565911724530819738/), [Steam — 30-storey office jobs](https://steamcommunity.com/app/949230/discussions/0/3937895062998454828), [Steam — lane changing](https://steamcommunity.com/app/949230/discussions/0/4406291330030559509), [Metacritic user reviews](https://www.metacritic.com/game/cities-skylines-ii/user-reviews/), [Paradox forum — dummy traffic toggle](https://admin-forum.paradoxplaza.com/forum/threads/configure-passing-through-transportation-and-cargo-vehicles-on-outside-connections-ban-allow.1622031)
- Zoning maths: [ZoneUtils modding reference](https://ps1ke.github.io/Cities-Skylines-2-Modding-Guide/Game/Zones/ZoneUtils), [gameplay.tips grids](https://gameplay.tips/guides/cities-skylines-ii-practical-engineering-efficient-grids.html)
- Regions: [SimCity 4 (Wikipedia)](https://en.wikipedia.org/wiki/SimCity_4), [SC4 Wikibooks](https://en.wikibooks.org/wiki/SimCity/SimCity_4), [Tom's Hardware SC4 regional](https://forums.tomshardware.com/threads/simcity-4-regional-play.155571), [SimCity 2013 (GiantBomb)](https://giantbomb.com/wiki/Games/SimCity_2013), [SimCity 2013 retrospective (Medium)](https://medium.com/@chrominance/simcity-the-most-disappointing-game-of-2013-3e9157cb80db), [Cities XL Planet (wiki)](https://breezewiki.discard.no/citiesxl/wiki/Planet), [Cities XXL trade](https://www.gamepressure.com/citiesxxl/trade/z173cd), [W&R Q&A](https://wiki.hoodedhorse.com/Workers_Resources_Soviet_Republic/Questions_and_answers), [MapExt forum](https://admin-forum.paradoxplaza.com/forum/threads/map-extended-mod-beta-57km-version.1738213), [CS1 region request (Steam)](https://steamcommunity.com/app/255710/discussions/0/133258593408450169)

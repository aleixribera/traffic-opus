/**
 * What changed in each version, newest first, in a player's words (the main menu's "What's new" and the version in
 * the corner). Each release is a git tag of the same name; add the new one here in the commit that tags it.
 */
export interface Release {
  /** the tag, e.g. "v0.0.57" */
  v: string;
  /** the day it shipped, YYYY-MM-DD */
  date: string;
  /** a few words: what the update is about */
  title: string;
  /** the key changes, one short sentence each */
  notes: string[];
}

export const CHANGELOG: Release[] = [
  {
    v: "v0.0.69", date: "2026-11-08", title: "Day and night, seasons, and a road anyone can afford",
    notes: [
      "Day turns to night: street lamps, floodlit works and lit windows come on at dusk, and headlights sweep the roads. The Nights setting in the pause menu softens them or turns them off.",
      "Seasons you can see: spring blossom, deep summer green, autumn colour and the harvest rush, and snow in winter. A season lasts 16 days, a year 64.",
      "Dirt road: a cheap track for the early game at a quarter of a street's price. Draw a street over it later to pave it in place.",
      "Smoother junctions: roads meet in one clean surface, forks get a paved gore, site gates have an apron, and trees no longer grow on roads.",
      "Traffic lights run a fixed clock, 24 seconds a phase. Roundabouts flow, trucks pull out of driveways cleanly, drivers are brisker, and a jam that locks solid breaks itself up.",
      "Towns run themselves: they grow outward along their own roads, widen their busy streets, build one road out of town, and grow steadily on a supply they can count on instead of booming and crashing.",
      "Front strips: the ground between a road and the homes along it becomes gardens, hedges and picket fences, and company sites sit back behind it.",
      "Click anything: trucks, roads, junctions, homes, shops, deposits and stuck traffic all open the Inspector, and the map shows their story. A town's needs read in words and crates.",
      "Cameras: follow a truck (G or its Follow button), a cinematic Tour of the busiest places (T), and a Vehicle cam that rides along (Shift+T).",
      "Fewer, clearer goals: 20 real steps instead of 56, and tips that fit what is on your map and can be dismissed. A Towns list shows every town at a glance.",
      "A new company starts with $250,000.",
    ],
  },
  {
    v: "v0.0.68", date: "2026-11-08", title: "Towns spring up, and building takes material",
    notes: [
      "You no longer found towns. Goals about towns growing bring new hamlets of their own, each a little further out than the last, with a banner to fly there and a pointer at the screen's edge until your road reaches them.",
      "A faster first hour: small towns grow quicker, a hamlet starts wanting planks at 100 people, a site's first level comes inside a day, and the early goals pay more.",
      "While you place a mine, quarry, well or pit, every deposit of its kind carries a tag on the map, and the nearest ones off screen get a pointer with the way and the distance. The Resources view tags every deposit on screen.",
      "Building takes far more material: plant sites need five times the planks, cement and parts, landmarks twice as much, and a town's apartments, shops and towers three times the construction parts.",
      "Towns keep away from your smoky, noisy works: no new streets or homes close by them, a strip of open ground in between, and the town grows the other way instead.",
      "Traffic lights no longer lock up: a car whose way out is full doesn't take a green it can't use, and one stuck waiting to turn into a driveway drives on and comes back round.",
      "Traffic that has stood still for a minute and a half gets a small amber warning on the map, and a chip above the clock counts the places; click it to fly to each.",
      "Cars leaving a roundabout no longer wait behind a car still going round once it is past the exit.",
    ],
  },
  {
    v: "v0.0.67", date: "2026-11-08", title: "Sites earn their levels",
    notes: [
      "Goals no longer hand out an extra truck at every building or an extra load on every truck. A site's fleet comes from its level, and trucks carry more only as bigger classes: a light truck 1 load, a heavy truck 2, a road train 4.",
      "Instead, goals clear named kinds of site for their next level: \"Logging Camps and Sawmills grow to level 3\". Every site grows to level 2 by itself; levels 3 and 4 open with the goals (farms, mines, wells and pits reach level 3 with fertilizer or explosives, as before).",
      "A site waiting at its cap says which goal opens its next level.",
      "Towns keep rebuilding their high streets as shops: a building with no room to grow along its street no longer holds up the ones behind it.",
    ],
  },
  {
    v: "v0.0.66", date: "2026-11-08", title: "A road tool that helps",
    notes: [
      "Two ways to draw, like the classics: Curve (the default) bends freely from where the last road left off, and each click carries on smoothly from the end; Straight draws straight lines. Right click or Esc ends the chain.",
      "Snapping helps instead of fighting: ends catch roads and junctions from further out when zoomed out, hold steady instead of flickering, and slide to a clean right angle when you aim nearly square.",
      "Guide lines like CS2's: parallels a lot or a town block away, perpendiculars, and stops level with nearby junctions.",
      "Rivers and roads in the way get a bridge by themselves, with its cost shown before you click. Built bridges now stand out with parapets, piers and a steel truss over wide water.",
      "Homes in the way are outlined with the compensation the owners get; click again to build through. Sites and civic buildings are never demolished.",
      "Small misses fix themselves: an end just short of a junction joins it, and one that overshoots a road ends on it. Anything else says at the cursor why it can't be built and what to do.",
      "Replace is now called Upgrade. The 3-click curve, complex curve, continuous and grid modes are gone.",
      "Homes, shops and the town hall's square now stand back from the street behind a front strip their driveways cross, so upgrading a town street, even to a divided avenue, keeps every building: the road fills the strip and the driveways get shorter. (Homes already built in older saves keep their old place by the kerb.)",
      "A road whose cost plus the owners' compensation is more than you have isn't built (no more going into debt), and roundabouts and lanes through homes ask for the second click too.",
    ],
  },
  {
    v: "v0.0.65", date: "2026-11-08", title: "Freight jams ease",
    notes: [
      "A site's gate now stands well clear of a junction, so trucks turning in no longer stop with their tails across the crossing.",
      "Drivers in a slow, crawling queue keep going instead of giving up and sending their load back into the same jam.",
      "Trucks waiting their turn in a yard no longer count as a blocked driveway; only the one at the front does.",
      "Panels name the road to fix: a full site says when the road at its gate is jammed or its trucks are stuck on the haul, and a plant waiting for an input says when its loads are stuck in traffic.",
    ],
  },
  {
    v: "v0.0.64", date: "2026-11-08", title: "Heavy trucks get moving",
    notes: [
      "Heavy trucks pull out of a site's parking bays like light ones instead of queuing at the gate one at a time; only road trains still wait their turn.",
    ],
  },
  {
    v: "v0.0.63", date: "2026-11-08", title: "Fine turning",
    notes: [
      "Hold Shift while placing a building to turn it 1° at a time: one degree per wheel notch, or per press of the comma and period keys.",
      "While placing, a tag next to the cursor shows how far the building is turned.",
    ],
  },
  {
    v: "v0.0.62", date: "2026-11-08", title: "Deeper chains and the Motor Works",
    notes: [
      "A Chemical Works makes fertilizer and explosives: farms need fertilizer and mines need explosives to work at full pace from level 3, and a badge at the gate shows the boost.",
      "Dairy farms and creameries: milk and cheese ride in refrigerated trucks with a ring that counts down their shelf time, and arrive fresh or lose value.",
      "By-products: sawmills make wood chips that power plants burn, and smelters make slag that cement works take instead of limestone.",
      "Tier 5: a Rubber Plant and the Motor Works, whose cars ride car transporters to big towns. People there drive more, in sedans in your company's colours.",
      "Deliveries pop a shipping tag over the map: the money earned, how fresh a load came, the cars sold.",
    ],
  },
  {
    v: "v0.0.61", date: "2026-11-08", title: "A Deco skin for the whole interface",
    notes: [
      "Every panel is a navy enamel plate with an ochre pinstripe and rivets, headed in condensed display capitals.",
      "Every icon is redrawn in one flat period style, and town names sit on station nameplates that read over any ground.",
      "Money and the clock sit in inset counters; text is never smaller than 12 px and every colour passes contrast.",
      "Landmark openings get a gilt double frame, and convoy tags, landmark panels and the season in the clock match the rest.",
    ],
  },
  {
    v: "v0.0.60", date: "2026-11-08", title: "Convoys, landmarks, parks and seasons",
    notes: [
      "A machine works builds turbines and steel girders that leave as escorted convoys: a pilot car, a low-loader and an escort, beacons flashing, traffic queuing behind. Click its tag to follow it.",
      "Turbines delivered to a power plant raise its output for good, up to three.",
      "Landmarks: a Hydro Dam, a Skyline Tower and a Grand Exposition rise in three stages from the loads you deliver, then open with fireworks and boost the towns around them.",
      "Plants within 60 m of each other link up with conveyors or pipes and pass goods along them.",
      "A four-day year: fields go from shoots to ripe gold to stubble and frost, farms work faster at harvest, and the clock shows the season.",
    ],
  },
  {
    v: "v0.0.59", date: "2026-11-08", title: "Industry Booming America",
    notes: [
      "Your company has a name and a Deco badge: pick them when you start, change them from the top-left corner or the pause menu.",
      "Towns get American names, like Fort Pryor or Cedar Creek.",
      "Roads wear US markings: yellow centre lines, white lane dashes, wide crosswalk bars and a yellow line on the freeway's inside edge.",
      "Milestone banners and saves carry your company's badge.",
    ],
  },
  {
    v: "v0.0.58", date: "2026-11-08", title: "Build anywhere: no more land",
    notes: [
      "There is no land to buy: the company builds anywhere its roads reach, and the deposits kilometres apart are what open the map up.",
      "Goals that used to give land now give a town slot, a truck bay or a grant instead.",
      "Old saves still load; the land they owned is simply forgotten.",
    ],
  },
  {
    v: "v0.0.57", date: "2026-11-08", title: "Fleets mix truck sizes by level",
    notes: [
      "A site's level sets its fleet's mix: level 1 runs light trucks only, each level swaps some for heavies and road trains, and level 4 runs mostly road trains.",
      "A truck at the dock waits for a full load, up to an hour, instead of setting off with a single load.",
      "The plant panel shows the fleet as a split bar, and a young plant's output is compared with what it could make in the hours it has worked.",
      "The version is in the bottom-right corner; click it, or the line under the main menu, to read every update so far.",
    ],
  },
  {
    v: "v0.0.56", date: "2026-11-08", title: "Output a day",
    notes: [
      "A plant's panel shows what it made over the last 24 hours against what it can make at its level, fully staffed.",
      "Under it, its main product hour by hour, with its full pace as a dashed line: gaps show when it stood still.",
      "The Economy window lists the company's production per product for the last day, with a small bar of each hour.",
    ],
  },
  {
    v: "v0.0.55", date: "2026-11-08", title: "Truck classes and warehouses",
    notes: [
      "Trucks come in light, heavy and road train classes, and every fleet moves up to the best class you have unlocked.",
      "Warehouses store any product, take what plants and towns can't, and send it on with their own trucks.",
      "Fuel depots sell a refinery's fuel at cost to trucks passing within 1.5 km.",
      "Tier 4: copper mine, copper smelter, electronics plant and machine works, and a City needs electronics and machinery.",
    ],
  },
  {
    v: "v0.0.54", date: "2026-11-08", title: "Free rotation and gate streets",
    notes: [
      "The scroll wheel turns a building freely while you place it; Ctrl and the wheel zooms.",
      "A street is planned from the building's gate to the nearest road within 400 m, paid and undone with it.",
      "A site's truck fleet now comes with its level, so the + Truck button, truck prices and truck upkeep are gone.",
    ],
  },
  {
    v: "v0.0.53", date: "2026-11-08", title: "Zoom over town names",
    notes: [
      "The scroll wheel zooms the map when the cursor is over a town's name too.",
    ],
  },
  {
    v: "v0.0.52", date: "2026-11-08", title: "Tier 3 chains",
    notes: [
      "Oil wells, sand pits, a refinery, glassworks, furniture factory and construction plant join the industry.",
      "A Town of 1,500 people needs household goods and fuel, and fuel goes to its filling stations.",
      "Once construction plants unlock, a town's blocks and towers wait for construction parts before they rise.",
      "The industry catalog wraps onto a new row instead of hiding cards off the edge.",
    ],
  },
  {
    v: "v0.0.51", date: "2026-11-08", title: "Faster late game, civic squares",
    notes: [
      "A big company with tens of thousands of people runs smoothly, and big towns no longer stutter when they lay a street.",
      "Saves are compressed, so autosaves of a big company no longer fail without a word.",
      "Town hall squares get trees and paving that grow grander with each new hall.",
      "Cities line their main streets with shops and offices, so commerce keeps up with their homes.",
    ],
  },
  {
    v: "v0.0.50", date: "2026-11-08", title: "Industry sites that grow",
    notes: [
      "Company buildings are large fenced sites that grow through four levels after about three days near full output.",
      "A site can be placed before any road reaches it, and connects when a road meets its gate.",
      "Roads can't cross a site's fence except up to the gate, and towns never build inside one.",
      "A site's panel shows what is holding its growth back.",
    ],
  },
  {
    v: "v0.0.49", date: "2026-11-08", title: "Towns grow into cities",
    notes: [
      "Every town grows round its hall, which is rebuilt bigger at each size from hamlet to city.",
      "Bigger towns build denser in rings from the centre: terraces, blocks, flats, towers and malls.",
      "Inner rings are redeveloped a stretch at a time, and a banner marks each new town size.",
      "Click a town hall for the town panel: population, needs, shortages and deliveries.",
    ],
  },
  {
    v: "v0.0.48", date: "2026-11-08", title: "Money rebalance, buy trucks",
    notes: [
      "Town shops buy more than the town needs to grow, and towns short of something are served first.",
      "Tier 1 plants are cheaper, food, planks and cement sell for more, and small towns grow faster.",
      "A plant's panel has a + Truck button to buy up to eight extra trucks.",
    ],
  },
  {
    v: "v0.0.47", date: "2026-11-08", title: "Tier 2 chains and milestones",
    notes: [
      "Iron mines, coal mines, quarries, the smelter, cement works and power plant join the industry.",
      "A power plant reaches buildings within 4 km by road, and buildings without power work at 40%.",
      "From tier 2, a new plant starts as a building site that waits for trucked planks.",
      "Eighteen milestones unlock the game step by step, three open at a time, shown in the Goals card.",
    ],
  },
  {
    v: "v0.0.46", date: "2026-11-08", title: "Apartment tower model",
    notes: [
      "Groundwork: an apartment tower model, so dense city homes will no longer be stretched low blocks.",
    ],
  },
  {
    v: "v0.0.45", date: "2026-11-08", title: "Town halls for every size",
    notes: [
      "Groundwork: hamlet, village and city halls, plus high street, modern flats and glass tower models for growing towns.",
    ],
  },
  {
    v: "v0.0.44", date: "2026-11-08", title: "Industry site buildings",
    notes: [
      "Groundwork: sixteen support buildings for industry sites, from truck yards and halls to silos, fields and stockpiles.",
    ],
  },
  {
    v: "v0.0.43", date: "2026-11-08", title: "Readable town labels",
    notes: [
      "Town names on the map have a solid halo, so they stay readable over the roads.",
      "The tip card matches the rest of the interface, with a 'Next step' heading and an outline on the button it means.",
    ],
  },
  {
    v: "v0.0.42", date: "2026-11-08", title: "Tier 4 building models",
    notes: [
      "Groundwork: models for the copper mine, copper smelter, electronics plant and machine works.",
    ],
  },
  {
    v: "v0.0.41", date: "2026-11-08", title: "Tier 3 building models",
    notes: [
      "Groundwork: models for the oil well, sand pit, refinery, glassworks, furniture factory and construction plant.",
    ],
  },
  {
    v: "v0.0.40", date: "2026-11-08", title: "Tier 2 building models",
    notes: [
      "Groundwork: models for the iron mine, coal mine, quarry, smelter and cement works.",
      "Stockpiles look like rows of tipped heaps instead of roofed shapes.",
    ],
  },
  {
    v: "v0.0.39", date: "2026-11-07", title: "Company economy, self-growing towns",
    notes: [
      "Money now comes only from deliveries, carried by your company's own trucks over your roads.",
      "Farms, logging camps, food plants and sawmills make the first chains; extractors need a rich enough deposit.",
      "Towns lay and zone their own streets and grow on what you supply, and you found new towns instead of zoning.",
      "The zoning tool and demand bars are gone, and saves from older versions no longer load.",
    ],
  },
  {
    v: "v0.0.38", date: "2026-11-07", title: "Freight truck models",
    notes: [
      "Groundwork: tipper, tanker and flatbed truck models for bulk, liquid and long loads.",
    ],
  },
  {
    v: "v0.0.37", date: "2026-11-07", title: "Zebra crossings",
    notes: [
      "Town junctions with traffic lights get zebra crossings just past the stop line.",
    ],
  },
  {
    v: "v0.0.36", date: "2026-11-07", title: "Buildings restyled",
    notes: [
      "Buildings drop the bright zone colours for realistic roofs, walls and car parks.",
      "Each building gets a slight weathering tint, so a street of one model doesn't look stamped.",
    ],
  },
  {
    v: "v0.0.35", date: "2026-11-07", title: "Deposits by tier",
    notes: [
      "Iron ore, coal and limestone lie a few kilometres from the start, oil and sand further out, copper furthest.",
      "A fertile patch and a forest are always within reach of the start.",
      "Deposits show on the ground as their own soil and in the resources overlay.",
    ],
  },
  {
    v: "v0.0.34", date: "2026-11-07", title: "Grassland look, city systems removed",
    notes: [
      "The map looks like sunlit dry grassland: olive grass, shrubs and trees with shadows, and dark asphalt.",
      "City services, policies, water, offices, taxes and the outside world with its motorway and trade are removed.",
      "Power stays, and saves from older versions no longer load.",
    ],
  },
  {
    v: "v0.0.33", date: "2026-11-07", title: "Kilometre Zero: the new name",
    notes: [
      "The game is now Kilometre Zero, and it turns from a city builder into an industrial company game.",
      "Groundwork: logging camp and sawmill models for the first chain.",
    ],
  },
  {
    v: "v0.0.32", date: "2026-11-07", title: "Trade with gateway cities",
    notes: [
      "Gateway cities your roads reach become trade partners with their own prices and demand.",
      "Factories export to the best payers and buy materials where they are cheapest, and a Trade window lists it all.",
      "Shops are judged on a whole day's custom, so a quiet morning no longer flags them.",
    ],
  },
  {
    v: "v0.0.31", date: "2026-11-07", title: "Utilities, landmarks and policies",
    notes: [
      "Power, water and sewage run over the road network, with a Utilities window; shortages cut demand.",
      "Five landmarks, one per city, raise land value and happiness around them.",
      "A Policies window with recycling, free buses, a tourism campaign and more, each costing money every hour.",
      "Factories keep running, because freight counts the loads already on the way.",
    ],
  },
  {
    v: "v0.0.30", date: "2026-11-07", title: "Buses",
    notes: [
      "Place bus stops on a kerb and draw a bus line by clicking stops in order.",
      "Buses run in ordinary traffic, and residents ride when it is about as quick as driving.",
      "The Transportation window lists each line's riders and waiting passengers and lets you set its bus count.",
    ],
  },
  {
    v: "v0.0.29", date: "2026-11-07", title: "Lights for roads added later",
    notes: [
      "A road added to a junction with lights now gets a green, instead of staying red for good.",
      "Splitting an avenue no longer adds lights to a crossing you left without them.",
    ],
  },
  {
    v: "v0.0.28", date: "2026-11-07", title: "Adaptive lights and stop signs",
    notes: [
      "Traffic lights follow the traffic: greens end early on empty roads and run longer while cars keep coming.",
      "Stop signs can be set for each approach from the junction panel.",
      "New crossings of avenue-size roads get lights by themselves, and lights you removed stay removed.",
      "Cars may turn right on red after a full stop, giving way to cross traffic.",
    ],
  },
  {
    v: "v0.0.27", date: "2026-11-07", title: "Zoned land fills up",
    notes: [
      "Drawing a grid zones every street, not only the last one.",
      "Odd corners and leftover strips get small lots instead of staying empty.",
      "When every lot is built, the demand panel tells you to zone more.",
      "Slip lanes open out of the kerb in a smooth taper.",
    ],
  },
  {
    v: "v0.0.26", date: "2026-11-07", title: "Add lane tool and lane arrows",
    notes: [
      "The Add lane tool adds left- or right-turn lanes before a junction and lengthens motorway slip lanes.",
      "Lanes approaching a junction show painted arrows for the ways they may go.",
      "Cars merge into exit lanes more sensibly and pull in and out of buildings instead of vanishing.",
      "Highways allow 120 km/h, and a 15-degree angle lock helps you draw roads.",
    ],
  },
  {
    v: "v0.0.25", date: "2026-11-07", title: "Slip lanes adapt to the motorway",
    notes: [
      "A ramp's slip lane is laid beside the motorway, following its line and height, without changing the carriageway.",
      "Draw along the motorway to lengthen a slip lane or join it to the next ramp's lane.",
      "Cars keep their place when roads are rebuilt under them.",
    ],
  },
  {
    v: "v0.0.24", date: "2026-11-07", title: "Main menu over a showcase city",
    notes: [
      "The game opens on Brightwater, a live showcase city, behind a small main menu.",
      "Explore Brightwater to look round and try the tools; nothing there is saved.",
      "The pause menu has a Main menu button, and your city is autosaved first.",
    ],
  },
  {
    v: "v0.0.23", date: "2026-11-07", title: "Slip lanes you can lengthen",
    notes: [
      "Motorway ramps widen the carriageway with real deceleration and acceleration lanes.",
      "Draw a one-way road along a motorway to add a lane, lengthen a slip lane or join two.",
      "An entry lane and the next exit lane join into one when they come within 250 m.",
    ],
  },
  {
    v: "v0.0.22", date: "2026-11-07", title: "Roads with personality",
    notes: [
      "Town roads get pavements, bigger ones get street trees, and centre lines match each road's size.",
      "Highways stay bare grey with chevrons, so they no longer look like town one-ways.",
      "Slip roads leave and join a carriageway on a smooth easing curve.",
    ],
  },
  {
    v: "v0.0.21", date: "2026-11-07", title: "City services and Highway 1",
    notes: [
      "A Services menu with garbage, fire, police, health, schools and parks, whose vehicles drive your roads.",
      "Garbage, crime, fire and sickness appear from Hamlet size and affect happiness and land value.",
      "Highway 1, a one-lane highway ramp, is available from the start.",
      "Highways are drawn in darker asphalt with white edge lines.",
    ],
  },
  {
    v: "v0.0.20", date: "2026-11-07", title: "Smooth traffic",
    notes: [
      "Cars ease off smoothly behind slower traffic instead of braking hard.",
      "Cars roll through clear junctions at turn speed instead of stopping.",
      "Car bodies swing through turns and lane changes instead of snapping between lanes.",
      "Queues move off steadily instead of in constant stop-start.",
    ],
  },
  {
    v: "v0.0.19", date: "2026-11-07", title: "Traffic fixes, roads with medians",
    notes: [
      "Cars no longer get stranded on the road when they miss their stop or turn.",
      "Cars that need to change lanes line up behind a gap, and the car behind lets them in.",
      "Cars waiting a long time on a side street get let out by main-road traffic.",
      "New road types have a median separating the two directions.",
    ],
  },
  {
    v: "v0.0.18", date: "2026-11-07", title: "Zoning and a new interface",
    notes: [
      "Zone colours only show while zoning or in the Zoning info view.",
      "Lots take the full zoned depth, with yards and buildings at the front.",
      "A new bottom bar with categories, asset tabs and a tool options panel.",
      "Progression, Economy, City and Transport windows, and a pause menu.",
    ],
  },
  {
    v: "v0.0.16", date: "2026-11-07", title: "New controls and road tools",
    notes: [
      "The camera rotates and moves like Cities: Skylines 2, with WASD, Q/E and mouse controls.",
      "Road modes: straight, simple and complex curves, continuous, grid and replace.",
      "A parallel toggle builds dual carriageways that keep an even gap round corners.",
      "A snapping menu, cursor readouts for length, slope and cost, and roundabouts in four sizes.",
    ],
  },
  {
    v: "v0.0.15", date: "2026-11-07", title: "An endless region",
    notes: [
      "The fixed map is replaced by an endless world of mountains, rivers, forests, plains and lakes.",
      "Gateway cities lie 13 to 45 km out, and a motorway is already built past the start.",
      "The camera zooms out to about 60 km across, and Highway 2 is a new road type.",
      "You start owning a block of land tiles.",
    ],
  },
  {
    v: "v0.0.14", date: "2026-11-07", title: "Driveway gridlock fixed",
    notes: [
      "Cars waiting to turn into a driveway no longer cause gridlock, even at a busy crossroads.",
      "Two-lane roundabouts are wider and flow properly.",
      "Cars use the inner lane for driveways on the far side of the road.",
    ],
  },
  {
    v: "v0.0.13", date: "2026-11-07", title: "Any building can be moved",
    notes: [
      "Buildings from earlier levels can be picked up or bulldozed; they go back to the toolbar to place again.",
    ],
  },
  {
    v: "v0.0.12", date: "2026-11-07", title: "Playable online",
    notes: [
      "The game is playable online.",
    ],
  },
  {
    v: "v0.0.11", date: "2026-11-07", title: "Road bends stay one road",
    notes: [
      "Extending a road round a corner makes a smooth marked bend, not an intersection where cars yield.",
    ],
  },
  {
    v: "v0.0.10", date: "2026-11-06", title: "Interface fixes",
    notes: [
      "On phones the toolbar wraps into two rows, so every building is reachable.",
      "Colours have more contrast, and goals that can't be measured yet stay neutral instead of green.",
      "The level banner says 'Level N complete', and the first tip names the Street tool.",
      "The signal editor labels its arms, and the saves dialog asks once before deleting.",
    ],
  },
  {
    v: "v0.0.9", date: "2026-11-06", title: "Phone layout, autosave thumbnails",
    notes: [
      "The goals card folds and unfolds, and starts folded on phones.",
      "On small screens the top bar no longer covers the speed buttons.",
      "Autosaves show a thumbnail instead of a blank grey box.",
    ],
  },
  {
    v: "v0.0.8", date: "2026-11-06", title: "Bridge shadows, wider streets",
    notes: [
      "Bridges cast real shadows on the ground and roads below.",
      "Upgrading a street lined with houses pushes their lots back when there is room.",
      "The upgrade preview highlights and counts the buildings in the way.",
    ],
  },
  {
    v: "v0.0.7", date: "2026-11-06", title: "Roundabouts that flow",
    notes: [
      "Roundabouts no longer gridlock: cars join behind circulating traffic like real drivers.",
      "Driveways and junctions no longer deadlock, and queues stop short of cars turning in or out.",
      "One-way roads show chevron arrows.",
    ],
  },
  {
    v: "v0.0.6", date: "2026-11-06", title: "Roundabout connections",
    notes: [
      "Roads join a roundabout where you aim them, and can't be drawn through the island.",
      "Roundabouts are drawn as one ring with a grass island, kerbs and shaped mouths.",
      "The game autosaves when you hide or close the tab.",
    ],
  },
  {
    v: "v0.0.5", date: "2026-11-06", title: "First playable build",
    notes: [
      "The first playable build: a top-down 3D map with roads, buildings and traffic.",
      "A toolbar, objectives, a tutorial, overlays, a signal editor and saves.",
      "The game autosaves and loads your newest save when it starts.",
    ],
  },
  {
    v: "v0.0.4", date: "2026-11-06", title: "Buildings, levels and goals",
    notes: [
      "Groundwork: buildings, residents, freight, satisfaction, level objectives and saving.",
    ],
  },
  {
    v: "v0.0.3", date: "2026-11-06", title: "Road planner",
    notes: [
      "Groundwork: the road planner, with snapping, guides, curves, crossings, roundabouts and grids.",
    ],
  },
  {
    v: "v0.0.2", date: "2026-11-06", title: "Visual reference",
    notes: [
      "Groundwork: the visual direction for the game.",
    ],
  },
  {
    v: "v0.0.1", date: "2026-11-06", title: "Core simulation",
    notes: [
      "Groundwork: the road network and the traffic simulation behind every car.",
    ],
  },
];

/** The version this build is. */
export const VERSION = CHANGELOG[0].v;

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
    v: "v0.0.106", date: "2026-11-11", title: "Say it once",
    notes: [
      "Every word in the game was gone over: each fact shows once, panels lead with a state and a number, and help moved into tooltips.",
      "A new company opens calm: one goal, one arrow to it, no tip box. The goal says what to build and where.",
      "Panels lost their sub-titles and how-to paragraphs. Key-number captions fit on one line, and red is kept for trouble.",
      "A works whose towns are full says so calmly and names them; it no longer claims nobody buys its goods.",
      "Locked build cards say plainly what opens them. Upkeep and the one-line description show under the cards.",
      "A plot you can't build on shows its real reason, not a power warning. Road errors and building messages are short.",
    ],
  },
  {
    v: "v0.0.105", date: "2026-11-10", title: "Only what they need",
    notes: [
      "Towns buy what they use and no more. Their shops used to take three times their need, so any spare load sold somewhere; now a full town turns loads away, and they wait at your works or go to a warehouse.",
      "A short day can still be made up: a town takes up to two days' use over the two days its supply is judged on, rounded up to a whole load, so a well-fed town still reads Plenty.",
      "The town panel says how much its shops buy a day.",
    ],
  },
  {
    v: "v0.0.104", date: "2026-11-10", title: "Room to build",
    notes: [
      "Every build menu folds to a one-line strip while you place, and can be hidden without dropping the tool. The Goals card folds to the goal at hand and what's happening now.",
      "Esc lets go of the road you're drawing first, then the tool, then the menu.",
      "Milestone and new-town cards wait their turn and pause the game while you read them.",
      "Once every goal is reached, the Goals card names one long project with a progress bar, and lists the towns' shortfalls as the way there.",
      "A works placed too far from a road is offered a dirt road to it, priced, built in one click. Conveyor belts stop and say why while a plant has no road, and the ghost shows its belts before you build.",
      "The messages agree with the game: distances from towns, not the camera; the stuck count matches the sign; income survives a load; coal advice names buyers that exist.",
      "The goal tells you when a town is holding for want of planks, and first works go up in two hours instead of three: the first Village comes about four minutes sooner.",
    ],
  },
  {
    v: "v0.0.103", date: "2026-11-10", title: "Steady hands",
    notes: [
      "Keyboard panning moves the same share of the screen at every zoom, starting gently and speeding up as you hold the key. A quick tap at far zoom no longer throws you kilometres away.",
      "Edge scrolling, off by default: switch it on in the pause menu.",
      "Each wheel notch shows a small ring at the cursor, and a grey pulse when you reach the zoom limit.",
      "With a tool in hand, a town's name plate fades under the pointer so you can see the junction you're joining.",
      "No more regular stutters at top speed: new buildings are laid out over several frames, and shaders and models warm up when a game loads.",
      "Far zooms draw less than half as much, with simpler far models for houses, hedges and fences.",
      "The radio writes its tunes in the background, so a new tune never catches a frame.",
    ],
  },
  {
    v: "v0.0.102", date: "2026-11-10", title: "No more gridlock",
    notes: [
      "Fixed a lock where two cars at one junction each waited for the other forever, and the queue spread to the junctions around it.",
      "Junctions a car length or two apart now work as one: a car only goes onto the short road between them when there is room beyond the far one, and lights on one cover them all.",
      "Towns no longer lay a new junction right next to another.",
      "If cars ever do end up waiting on each other in a ring, after a minute and a half one takes another way out. Its delivery runs late, so a jam still costs you.",
      "The Traffic stuck panel calls a ring of waiting cars a deadlock, and offers lights for the whole cluster with one click.",
    ],
  },
  {
    v: "v0.0.101", date: "2026-11-10", title: "Someone lives here",
    notes: [
      "Townspeople walk the squares and the pavements in front of shops: busiest at midday, few at night, fewer in winter.",
      "Town squares furnish themselves as the town grows: a memorial on a village green, market stalls on a town square, fountains on a city plaza, with benches, a newsstand and a phone box.",
      "Big building sites waiting on materials are boarded up with posters until the slab is poured.",
      "Snow settles on town lots and gardens in winter.",
      "Dawn and dusk ramp the light up and down instead of jumping, and the night Map view is readable.",
    ],
  },
  {
    v: "v0.0.100", date: "2026-11-10", title: "Off to a good start",
    notes: [
      "Your home town fills its first streets faster, so the first Village comes sooner. Towns that spring up later grow as before.",
      "A town's first deliveries no longer set off advice to build another farm.",
      "The forest pointer finds the nearest forest you can actually reach, and the timber goal says where it is.",
      "A works only says its trucks can start once your roads reach something that takes its goods.",
      "A site placed with no road at its gate tells you straight away.",
      "The road cards fold away once you put down a road's first point, so you can see where you're drawing.",
    ],
  },
  {
    v: "v0.0.99", date: "2026-11-10", title: "Lighter",
    notes: [
      "A big map draws about half as much at every zoom, so it runs smoother on the same machine.",
      "Hedges and fences far off use simpler models, and buildings off screen are skipped.",
      "Loading a save no longer leaves the old map in memory.",
      "Laying a road next to a town is faster.",
      "With the sound muted, the game stops working on sound altogether.",
    ],
  },
  {
    v: "v0.0.98", date: "2026-11-10", title: "Why it grows",
    notes: [
      "A town says how it is growing and why: growing, growing slowly, holding or shrinking, and the need that holds it back.",
      "A works short of workers never reads \"At full output\". It names the towns its staff come from and says they need to grow, or another town needs linking to its roads.",
      "If the browser can't start the game's 3D view, or the graphics card drops it mid-game, the game says what to do. Your city is saved, and one click brings it back.",
    ],
  },
  {
    v: "v0.0.97", date: "2026-11-10", title: "Every counter in town",
    notes: [
      "Trucks share a town's shops between them instead of all unloading at the one nearest the works.",
      "A save keeps a truck changing lanes or leaving a gate exactly where it was.",
    ],
  },
  {
    v: "v0.0.96", date: "2026-11-10", title: "New wants, not more of the old",
    notes: [
      "A town wants each good most at the size that opened it. Food, planks and cement grow only a little after that, so a City asks mostly for what is new to it.",
      "Towns grow in bands. With all they need, a town grows slowly and steadily. Just over the bar, it barely grows. Between 60% and 85% it holds. Under 60% for two days, it starts to shrink.",
      "Towns rebuild old houses as they grow, not on a timer.",
      "A works short of power shows what it really makes, not its full rate.",
    ],
  },
  {
    v: "v0.0.95", date: "2026-11-10", title: "Say what's missing",
    notes: [
      "Every button on the top bar has its name under it. The Progression window is now Goals, and Transportation is now Traffic.",
      "When a goal waits on a missing link, it names it: a farm with no Food Plant, a smelter with nothing to bring it iron ore. If that building isn't open yet, it says which goal opens it.",
      "A town's people, needs met and its way to the next size sit at the top of its panel, never cut off.",
      "Economy and a works' own panel show the same made-a-day figure.",
    ],
  },
  {
    v: "v0.0.94", date: "2026-11-10", title: "Loads a day",
    notes: [
      "Goods are counted one way everywhere: loads a day. A town's needs are bars on one scale, so the biggest ask looks biggest.",
      "Economy shows each works as a bar of what it made against what it can make.",
      "While a panel is open, the current goal stays in a strip above it. Click it to go back to the goals.",
      "Text is larger and comes in fewer sizes, so panels read at a glance.",
      "Demolish sits on its own at the foot of each panel, away from Close.",
      "The radio says what is playing. Far out, a town shows one short line of what it needs instead of a pile of icons.",
    ],
  },
  {
    v: "v0.0.93", date: "2026-11-10", title: "Room to breathe",
    notes: [
      "New towns lay out wider blocks, keep more parks and gardens, and spread further out as they grow.",
      "Shopfronts stand wall to wall only along one short Main Street by the hall, in a Town or a City. A Village keeps a few separate shops.",
      "A City keeps a handful of towers by its hall instead of a ring of apartment blocks.",
      "Houses have back gardens: a hedge or fence behind each one, often with a tree, so a block reads as rows of yards.",
      "A town next to a neighbour now grows on its far side instead of stopping in a circle, so a City can pass 10,000 people.",
      "Towns in older saves keep their old blocks.",
    ],
  },
  {
    v: "v0.0.92", date: "2026-11-10", title: "One voice",
    notes: [
      "A town's panel says one thing: how it is doing, what to fix first with a button to show it, then the figures.",
      "Numbers agree everywhere. A works short of power never shows its full rate, a new works counts toward the advice while it starts up, and arrival times come from one place.",
      "Power and road messages name the cause and the fix: which plant is dark, which is at its limit and what to build, and a site with no road says so first.",
      "The road pointer reads as one short line. The catalog fills its bands. A works shows its gate when you place it and when you select it.",
      "An arrow at the screen edge points to fertile soil, and the goal pointer pulses.",
      "Far out, town names thin out instead of piling up. Money and the clock no longer jitter.",
      "Tips step aside while you place the building they talk about, and the wrong tips for the moment are gone.",
    ],
  },
  {
    v: "v0.0.91", date: "2026-11-10", title: "The lie of the land",
    notes: [
      "The seasons read as seasons: a green spring, a summer that dries only the driest ground, a gold and red autumn, and snow that lies evenly.",
      "The countryside is enclosed: pasture and meadow on a bent old survey, with hedgerows, field gates, hay in the mown meadows and haystacks through the winter.",
      "Water has a real shore: shallows, reeds, wavelets in the wind, and ice at the edges in winter.",
      "Zoomed far out the map becomes a period road atlas: inked roads by class, lettered towns, contour-shaded hills and dotted woods.",
      "All of it costs about the same to draw as the old ground.",
    ],
  },
  {
    v: "v0.0.90", date: "2026-11-10", title: "The fleet of 1930",
    notes: [
      "Every car, lorry, bus and convoy piece is rebuilt for 1925 to 1940: upright cabs, long bonnets, running boards, spoked wheels.",
      "Your lorries wear the company colours. A tilt is roped and tinted by its load, a tipper is heaped, a reefer is a coach-built insulated van.",
      "Heavy lorries look heavier. Convoys travel in company colours with red flags.",
      "Cars come in four bodies and lighter period paints.",
      "Real parked cars stand in the yards. Shops and offices fill in the morning and empty at night; homes do the reverse.",
      "Headlamps and tail lamps sit on each model's own lenses at night.",
    ],
  },
  {
    v: "v0.0.89", date: "2026-11-10", title: "Freight that never seizes",
    notes: [
      "A jam at a works gate gets slow. It no longer locks the whole company.",
      "A works keeps its trucks at the dock when the road outside cannot take them.",
      "Traffic lights or a roundabout at a busy gate now help. A short road can reach a gate.",
      "A site's gate faces the nearest road. Draw a road to its back and the gate turns to meet it.",
      "A save keeps every vehicle on the road, the lights, the speed and the pause. Loading puts you back in the same moment.",
      "Towns are served before building sites when a works cannot do both.",
      "Second-tier works need fewer planks to build, so first steel and cement come sooner.",
      "Trucks no longer roll out through each other, and trailers no longer fold.",
    ],
  },
  {
    v: "v0.0.88", date: "2026-11-10", title: "The game says what it needs",
    notes: [
      "A works at its limit says so: \"At full output\", and the town tells you what to build, with a button that shows you where.",
      "A building site says how many loads are still to come, about how long, and where the next one comes from.",
      "Every works card shows what goes in and what comes out. Opening Industry puts nothing in your hand.",
      "Esc goes back one thing at a time. R opens Roads, I opens Industry.",
      "The wheel always zooms, even with a building in hand. Shift and the wheel turn it.",
      "Zoomed far out, every works has a plate on the map, and the night is never too dark to read.",
      "Your first goal is your first load of food. After the last goal, the list shows what your towns are short of.",
      "Info views switch off with their window. A long road shows what share of your cash it costs.",
      "The Towns, Economy and Transport windows fly you to what they list.",
    ],
  },
  {
    v: "v0.0.87", date: "2026-11-10", title: "Main Street, 1930",
    notes: [
      "Every town building is rebuilt for the 1920s to 1940s: brick shop-houses with awnings and signs, department stores, banks, walk-ups, courtyard flats and Deco towers.",
      "Each kind comes in several models and brick tones, and no two neighbours share one.",
      "Roofs have tanks, skylights, stair heads and chimneys. Cars park in a yard behind, not in front.",
      "At night shop windows glow warm and stay lit until past ten.",
      "A telegraph line follows the country roads, and billboards stand where a road comes into town.",
      "Town buildings have period names.",
    ],
  },
  {
    v: "v0.0.86", date: "2026-11-10", title: "The camera, finished",
    notes: [
      "Pull back and the camera rises to a flat map; zoom in and your own tilt comes back.",
      "A new company opens close on its hamlet. A save opens where you left the camera.",
      "A middle-button drag now turns or tilts, not both at once, unless you drag clearly on the diagonal.",
      "Camera keys and the wheel ease in and out. Y lifts the camera towards straight down, H lowers it towards the horizon.",
      "Traffic lights stand at their junctions with lit lenses.",
      "Bridges have clean sides: a closed parapet, a pier at the joint and a solid approach.",
      "Notes at the cursor no longer run off the edge of the screen.",
    ],
  },
  {
    v: "v0.0.85", date: "2026-11-10", title: "Second look",
    notes: [
      "The spoiled-goods sound plays once, not for every late truck on a slow route.",
      "Laying a road no longer silences undo and the other desk sounds for a second.",
      "Trees far from the first town no longer flutter when the wind turns, least of all at high speed.",
      "A wood cleared for a road stays cleared after a long session.",
      "Building is smoother on a big map, and loading a save no longer piles up memory.",
    ],
  },
  {
    v: "v0.0.84", date: "2026-11-09", title: "A world that moves",
    notes: [
      "Trees are real trees now: forests, parks, squares, street trees and front gardens stand up and sway in the wind.",
      "Every works smokes as hard as it is working. A starved plant's stack dies away, and a bigger site smokes more.",
      "Steam, quarry dust, a flare at the refinery, chimney smoke on cold days and a dust trail behind a truck on a dirt road.",
      "A few birds wheel over the woods and fields by day.",
      "Park lawns now follow the season and the hour, and the sawmill's pines stay green in autumn.",
    ],
  },
  {
    v: "v0.0.83", date: "2026-11-09", title: "The game has a sound",
    notes: [
      "The map can be heard: engines and tyres on the street under you, each works at its own trade, towns that murmur by day and go quiet at night.",
      "Birds, wind and crickets follow the hour and the season. The town clock strikes the hours.",
      "A wireless set by the clock plays swing tunes made up as you go, named after your towns. Switch it off or skip a tune there.",
      "Pause menu: Sound has sliders for everything, the music, the world and the interface. N mutes.",
      "Milestones, new towns, orders and convoys each have their own short fanfare.",
    ],
  },
  {
    v: "v0.0.82", date: "2026-11-09", title: "The camera turns the right way",
    notes: [
      "Dragging with the middle button turns the map the way your hand moves: drag right and the ground in front of you comes round to the right, the same way E turns it.",
      "The tilt is calmer on that drag, so turning the map no longer throws the camera up or down.",
    ],
  },
  {
    v: "v0.0.81", date: "2026-11-09", title: "The Diorama view",
    notes: [
      "The map is seen at a tilt now, so buildings, stacks, bridges and trucks stand up like a model on a table.",
      "Press M for the Map view, straight down, for planning. Press it again to come back.",
      "Tilt with Y and H, or hold the middle mouse button and drag to turn and tilt.",
      "Pause menu: a Camera setting picks Diorama or Map, and the game remembers it.",
      "You click what you see: a tall building, a truck on a bridge and the road under it all pick correctly.",
    ],
  },
  {
    v: "v0.0.80", date: "2026-11-09", title: "Tidy lots, steadier building sites",
    notes: [
      "A building site is no longer held up by one works with a jammed gate: another works sends the load instead.",
      "New homes and shops no longer overlap their neighbours where a street bends or is laid out again.",
      "A town's day has more shape: busiest at the two rushes, a small bump at lunch, quietest in the small hours.",
      "Info views: Land value and Building level now say what moves them, such as your works next door or shops close by.",
    ],
  },
  {
    v: "v0.0.79", date: "2026-11-09", title: "Rarer town orders",
    notes: [
      "Town orders are rare now: one at a time on the whole map, five to ten days apart.",
      "The first order comes five to ten days into the game, and the town asked last waits its turn.",
    ],
  },
  {
    v: "v0.0.78", date: "2026-11-09", title: "A town's day",
    notes: [
      "Towns keep a gentle daily rhythm: busier mornings and evenings, quieter nights; drivers vary a little.",
    ],
  },
  {
    v: "v0.0.77", date: "2026-11-09", title: "Main Street",
    notes: [
      "Each town's Main Street through its old town is paved in brick.",
      "Main street shops stand on the pavement, with their car park out back down a side alley.",
      "Construction trucks drive off down the street when they're done instead of vanishing.",
      "Your first farms and camps take a couple of minutes to build before they start producing.",
      "A town that isn't growing tells you which delivery it needs more of.",
    ],
  },
  {
    v: "v0.0.76", date: "2026-11-09", title: "Town orders",
    notes: [
      "Town orders: towns ask for freight and build a schoolhouse, church, fire hall and more when you deliver.",
      "Each town has its own list of civic buildings; a filled order pays a grant and gives the town a lasting perk.",
      "A missed order costs nothing: the town asks again later.",
    ],
  },
  {
    v: "v0.0.75", date: "2026-11-09", title: "Towns that grow like towns, and buildings that go up",
    notes: [
      "Towns grow like real American towns: a main street, uneven growth along the roads, mostly T-junctions.",
      "Buildings go up in stages with construction crews.",
      "Lived-in home lots.",
      "Stockpiles you can watch rise and fall.",
      "Country roads with gravel shoulders instead of kerbs.",
    ],
  },
  {
    v: "v0.0.74", date: "2026-11-09", title: "Touchpad play",
    notes: [
      "Touchpad: two-finger scroll pans, pinch zooms, two-finger click cancels; Space+drag pans with any tool; a Scroll wheel setting in the pause menu.",
    ],
  },
  {
    v: "v0.0.73", date: "2026-11-09", title: "Deliveries that land on time",
    notes: [
      "Deliveries to towns: your plants send loads early enough to land before a town runs low, and a short gap of a couple of minutes no longer shows as a shortfall.",
    ],
  },
  {
    v: "v0.0.72", date: "2026-11-09", title: "Season title cards",
    notes: [
      "A title card for each new season, with what it means for your farms and camps; hover the clock for the same.",
    ],
  },
  {
    v: "v0.0.71", date: "2026-11-09", title: "Fixes: boulevard gates, old saves' seasons",
    notes: [
      "A works' gate on a boulevard is turned into from either side, so trucks no longer go the long way round. Divided roads stay right-in, right-out.",
      "Saves from before v0.0.70 keep their season and day instead of jumping ten days ahead.",
      "Dragging a bulldoze rectangle lets a followed vehicle go, so the map holds still under it.",
    ],
  },
  {
    v: "v0.0.70", date: "2026-11-09", title: "A bigger hamlet, late spring, and a clock that ticks every minute",
    notes: [
      "Your first hamlet starts with about 70 people, enough hands for a first farm, sawmill and food plant.",
      "A new game starts in late spring, on day 11, with green fields and summer a few days off.",
      "The clock counts every minute, and a truck's arrival time is shown to the minute too.",
      "Level bars name both ends, Level 1 to Level 2, and a fully grown site reads Level 4 · top level.",
      "Following a truck: Esc clears panels and keeps the camera riding along. Only moving the camera, the chip's Stop, or clicking another vehicle ends it.",
      "A works' gate can open onto a boulevard.",
      "No more street trees standing in driveways or a works' gate drive. The Towns button lights up while the Towns list is open, and the road tool's hints stay clear of the panels.",
    ],
  },
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

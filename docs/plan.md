# Build plan (living checklist)

The design is in docs/design.md. Each slice ends playable, tested, screenshotted at desktop and phone, committed,
tagged and pushed. Roads QA runs through every slice: the owner's top rule is no road glitches.

## Slice 1: region foundation
- [ ] 12.8 km map, 640 m tiles. Terrain fields at 16 m, B-spline sampled on CPU and in the shader; shader
      ground, so edges are crisp at any zoom. Contour-smoothed terraced mountains.
- [ ] Resource fields (fertile, forest, ore, oil) and a Resources overlay.
- [ ] Generated outside connections: a motorway across the map plus rural roads, with corridors carved
      through terrain.
- [ ] Buy tiles with money (slots from milestones). Owned-tile shading in the shader.
- [ ] Camera from street level to the whole map; hide cars when far out.
- [ ] New road types: rural road (1+1, 80 km/h, no zoning) and motorway (2+2 divided, 100 km/h, no access).

## Slice 1b: CS2 controls (owner request)
- [x] Camera: WASD, Q/E and middle-drag rotation (rotatable top-down view), R/F and wheel zoom, touch
      pinch/twist, north arrow.
- [x] Hotkeys per design.md (Esc, B, M, PgUp/PgDn, Space, 1/2/3, F5/F9, backtick, Tab for modes). Panel keys
      P/Z/C/V/X wait for their panels.
- [x] Right mouse goes back one step.
- [x] Road modes: Straight, Simple Curve, Complex Curve, Continuous, Grid (3-click), Replace; Parallel toggle with
      spacing; snapping menu.
- [x] Cursor readouts: length, slope, angle, cost.
- [x] Roundabouts in 4 sizes.

## Slice 2: zoning
- [ ] Zone blocks per road side (8 m cells, 6 deep, follow curves), oldest-first overlap resolution,
      invalidation on road edits.
- [ ] Zone tools: brush, road-side fill, marquee, unzone; per-side zoning toggle.
- [ ] Zone cell rendering (instanced quads, zone tints) and the Zoning info view.

## Slice 3: growth, people, cities
- [ ] City Hall founding, city areas, names. Remove levels, inventory and satisfaction.
- [ ] Demand per city per zone with a factor breakdown. Lots from cells; buildings grow on their own;
      leveling 1-5.
- [ ] Households and workers, job search by commute time (cross-city), shopping and leisure trips.
- [ ] Time of day, work shifts, rush hours. Vehicle-trip scaling.
- [ ] Pathfinding the way the top traffic mods fix it (docs/cs2-research.md §1.1): turn delays, a bias towards
      main roads over side streets, live congestion cost, lane choice several links ahead (no last-second
      weaving), no U-turns by default. Jams wait and reroute; vehicles never despawn.
- [ ] Inter-city links have real capacity: every trip between cities is a vehicle on the player's roads.
      A commuter and freight matrix per city pair.

## Slice 4: economy
- [ ] Taxes, rent, wages, upkeep, loans, budget panel. Business profit, abandonment and auto-demolish.
- [ ] Land value (access, services, parks, shops, pollution, noise). Leveling uses it.

## Slice 5: industry
- [ ] Extraction zones on deposits (crops, wood, ore, oil), with depletion.
- [ ] Processing and manufacturing chains, cargo trucks, import and export via outside connections.
- [ ] Commercial goods categories. Offices produce services.
- [ ] Specialisations per city.

## Slice 6: services
- [ ] Garbage, fire, police, health, education, parks: coverage by road travel time, with dispatched vehicles.
- [ ] Buses: line tool, stops, depot.
- [ ] Road wear and maintenance.

## Slice 7: progression
- [ ] Population milestones and unlocks, city slots, tile slots, signature buildings.

## Slice 8: road tools from mods
- [ ] Lane connector, priority signs, turn restrictions, traffic light editor (timed and actuated).
- [ ] Move nodes and curves (Move It). Parallel and offset drawing. Area bulldoze.
- [ ] Custom road configurator (later milestone).
- [ ] Traffic views: flow, hotspots, route highlighting, resident journey breakdown.

## Slice 9: art and UI
- [ ] Blender models: R/C/I/O low and high in several variants and levels, extraction, processing, services,
      vehicles, trees. Built by tools/blender/build_models.py.
- [ ] HUD redesign (top bar, tool categories, info views, inspectors, budget, milestones, notifications).
- [ ] Day/night lighting, onboarding, settings, audio.

## Slice 10: finish
- [ ] Performance at 100k+ population (worker thread if needed), saves, phone UX.
- [ ] design-audit, code review, then the Opus 5.5 (medium) review vs Cities: Skylines out of 10 per category.
      Iterate until every category is at least 9.

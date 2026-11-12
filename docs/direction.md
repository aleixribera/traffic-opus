> **History.** Replaced by `VISION.md` on 2026-11-13. The plan is in `PLAN.md`. Kept as the record of the 2026-11-09 redesign.

# Kilometre Zero: direction (2026-11-09)

This page is the north star. `docs/design.md` describes the systems as built; where the two disagree, this page
wins and design.md gets corrected in the same change.

## What the game is

A 1920s–40s freight company on a road map. You build roads and works; your trucks haul freight in real traffic;
towns spring up and grow on what lands. The difficulty is throughput, never money. The player's verbs are *draw a
road* and *place a works*; everything else runs itself and tells you plainly what it is short of.

## What was holding it back (played 2026-11-09, v0.0.79)

1. **It hid its best asset.** Over a hundred real Blender models (a domed town hall, a blast furnace with its
   stack, gabled houses, lattice floodlights) were filmed from straight above, so the game read as a flat diagram:
   grey roof rectangles on a green plane. Tilt the camera 40° and it is a diorama.
2. **It is silent.** Six synthesized beeps. No engines, no works, no town, no night, no music.
3. **Nothing moves but vehicles.** No smoke from a stack, no steam, flat tree discs, a plain green ground, fields
   that are faint pads. Between a town and a works there is nothing to look at.
4. **The towns are in the wrong decade.** Shops are grey sheds with car parks. Nothing says 1930.
5. **Small frictions everywhere.** A resource tint whose edge is not the edge the game uses; tooltips left on
   screen; Esc going from "cancel the tool" straight to the pause menu; paragraphs of help text where the map
   should speak.
6. **Leftovers.** Info views from the city-builder era (land value, building level), a build plan for a game this
   no longer is, diagnostics checked in as tests, two dozen dead worktrees.

The systems underneath (lane-level traffic, self-routing freight, self-growing towns, site levels, seasons, day and
night, convoys, landmarks) are deep and stay.

## Decisions

### Kept (the owner's rules; do not reopen)

Company game, not a city builder. Towns grow themselves and spring up on milestones. No land, no truck buying, no
per-building micromanagement. Freight routes itself. Hard because of traffic, never money. Fixed-time lights, 24 s
a phase. Per-car smoothness is the bar for traffic. Stable town growth on proven supply; no credit for goods in
transit. A mild daily rhythm; realism never changes route choice. Town orders are rare (one open on the map, 5–10
days apart). Seasons last 16 days and autumn is a freight rush. PC only (mouse and keyboard, 1440×900 and
1920×1080). Models are real Blender models; textures and materials are made by Claude only.

### Changed

- **The Diorama (camera).** The game is seen at a tilt: an orthographic camera pitched about 50° from the
  horizon by default, free to pitch between about 30° and straight down, and to turn. Straight down stays one key
  away as the **Map** view, for planning. This replaces "straight-down only". Everything must be right at any
  pitch: picking, snapping, labels, culling, shadows, level of detail, overlays, the camera modes.
- **A world that moves.** Stacks smoke and the smoke leans with a wind; cooling steam; real 3D trees that sway;
  fields that are crops; birds; dust behind a truck on a dirt road; cranes that turn. Every works should show it is
  working from across the map.
- **A soundscape.** Everything synthesized in the browser (no audio files): engines by class that swell as you
  zoom in, tyres, horns in a jam; each works its own bed (saws, a furnace roar, pumps); towns that murmur by day
  and go quiet at night; birds, wind, crickets, rain; a UI palette with weight; stings for the moments; and a
  wireless set playing generated period music that the player can turn down or off.
- **The 1930s on the street.** Brick main streets with awnings and painted signs, a picture house, a diner, a
  filling station with pumps, water towers, grain elevators, telegraph poles along country roads, billboards.
  Period cars and trucks that read at the default zoom.
- **The map speaks.** Less help text, more world: crisp resource edges that match the rule, a need shown where it
  is, a tool that says one thing at a time.

### Cut

- Info views and panel rows left from the city builder, where nothing in the company game reads them.
- `docs/plan.md`, `docs/cs2-research.md` and `docs/trafficity-analysis.md` (a different game's plan).
- `tests/_diag/` (one-off diagnostics; the suite that guards behaviour stays).

### Next, once the above is in and played

- A hard look at the first hour and at days 10–40 by someone playing, not by a script.
- Freight rail with level crossings (the owner's late-game mode, not yet built).
- An atlas look when zoomed far out (a period road map: inked roads, lettered towns, hachured hills).

## How work is done here

- One change, one branch, one worktree. Tests come in three sets (`vite.config.ts`):
  - **While working:** run only the test files for what you touched, by name (`npx vitest run tests/towns.test.ts`).
  - **Before every commit:** `npm test`, the quick set (about 770 tests, under a minute), and `npx tsc --noEmit -p .`.
    Both run in the foreground. If you changed the sim, also run the scenario files that cover it, by name.
  - **At integration only:** `npm run test:full` adds the long traffic and town scenarios (about 3 minutes on all
    cores). `npm run test:balance` plays whole games, so run it only when you need a balance measurement.
  - Never leave a test run or dev server going when you finish.
- **Browsers are always headless and muted** (the owner works on this PC): never pass `--headed`.
  `.playwright/cli.config.json` adds `--mute-audio` and is the default when `playwright-cli` runs from the repo
  root; from anywhere else pass `--config <repo>/.playwright/cli.config.json`.
- **Done means you watched it work**: `npx vite --port <your own port> --strictPort`, drive it with
  `playwright-cli -s=<your own session>` at 1600×900, and look at the screenshots. `window.app` is the game
  (`app.game`, `app.view`, `app.lookAt(p, halfH)`, `app.setSpeed(n)`); `__env.set({hour, season, day})` fixes the
  light. `tools/lategame.build.ts` writes a big save to `tools/out/lategame.json` that
  `app.loadGame(await (await fetch('/tools/out/lategame.json')).json())` loads.
- A release is a commit on `main` with a `CHANGELOG` entry in `src/changelog.ts` (player's words, short
  sentences) and an annotated tag. Pushing `main` deploys the game.
- Write for players in plain words. No em dashes in UI text.

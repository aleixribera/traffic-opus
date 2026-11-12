# State

## Now

Last pass shipped v0.0.118 Room to turn (roadplay item 6): a dead end's turning bulb shrinks to the room it has (`bulbFit` in `src/roads/network.ts`): twin dead ends share the gap, a road just past the end pulls the circle back, roads above or below don't count, and a neighbour added or removed reshapes untouched dead ends within 25 m. Test `tests/bulbs.test.ts`; frames `.scratch/b2.png`, `b3.png`. CI was green for v0.0.117. **Next pass: check CI for v0.0.118** (`gh run list -L 2`); if green, roadplay item 4 (parallel pinch at a corner, still unmeasured), then item 5 (stub left past a new junction).

## What works (latest)

- v0.0.118 turning bulbs fit their room (`tests/bulbs.test.ts`).
- v0.0.117 Transport cards fold on aim (`src/ui/hud.ts` aimed; browser-checked, DOM only).
- v0.0.116 bus stop plates (`src/ui/stopMarks.ts`; checked in the browser, no unit test: DOM only).
- v0.0.114 Works that land: a works by a road's dead end stands back and joins it (`tests/placesnap.test.ts`).
- v0.0.113 one-click Widen/Roundabout from queue advice (`tests/queuefix*`), v0.0.111 readable queues, v0.0.112 seeded sim (`tests/determinism.test.ts`).
- Review 2026-11-12 (`docs/review-2026-11-12.md`): scores 7.0–8.0. Weakest: traffic 7.0, towns 7.0, UI 7.0, polish 7.0, sound 7.0 (nobody has heard it).

## Broken / open

- Road play log (`docs/roadplay-log.md` on branch `t3/road-freight-playtesting`): 4 parallel pinch at a corner (unreproduced), 5 stub past a new junction, 7 ring message (6 done in v0.0.118, 9 in v0.0.116, 10 in v0.0.117). A bulb's kerb ring also crosses the road mouth (old look, shows more on small bulbs).
- Late-save soak: worktree `~/.t3/worktrees/traffic-opus/t3-64b370fb`, branch `t3/late-save-deadlock-test` (f94271f): lategame fixture + 10-day soak, day-5 gridlock not settled. Too long for light tests; needs its own project and a shorter run.
- Slow tests to shrink: see `.claude/iterate.md`.

## Needs Aleix

- Overridable choices made by the loop: the loop file's order of work (worktrees first, then road play log, then weakest review category). Say if you want a different order.
- Open since 2026-11-10: does any camera control still feel inverted; does the radio music please the ear; are the cheaper tier-2 build bills fine.

# State

## Now

Last pass shipped v0.0.116 Stops you can find (roadplay item 9): bus stops carry a plate on a stem from halfH 70 out to the works-plate zoom, tab per line colour, click opens the stop; bolder bay paint. Frames `.scratch/bus-after-175.png`, `bus-after-crop.png`. **Next pass: check CI for v0.0.116** (`gh run list -L 1`); if green, roadplay item 10 (Transport catalog stays fully open with a bus stop in hand).

## What works (latest)

- v0.0.116 bus stop plates (`src/ui/stopMarks.ts`; checked in the browser, no unit test: DOM only).
- v0.0.114 Works that land: a works by a road's dead end stands back and joins it (`tests/placesnap.test.ts`).
- v0.0.113 one-click Widen/Roundabout from queue advice (`tests/queuefix*`), v0.0.111 readable queues, v0.0.112 seeded sim (`tests/determinism.test.ts`).
- Review 2026-11-12 (`docs/review-2026-11-12.md`): scores 7.0–8.0. Weakest: traffic 7.0, towns 7.0, UI 7.0, polish 7.0, sound 7.0 (nobody has heard it).

## Broken / open

- Road play log (`docs/roadplay-log.md` on branch `t3/road-freight-playtesting`): 4 parallel pinch at a corner (unreproduced), 6 twin bulbs, 10 catalog fold with stop (9 done in v0.0.116).
- Late-save soak: worktree `~/.t3/worktrees/traffic-opus/t3-64b370fb`, branch `t3/late-save-deadlock-test` (f94271f): lategame fixture + 10-day soak, day-5 gridlock not settled. Too long for light tests; needs its own project and a shorter run.
- Slow tests to shrink: see `.claude/iterate.md`.

## Needs Aleix

- Overridable choices made by the loop: the loop file's order of work (worktrees first, then road play log, then weakest review category). Say if you want a different order.
- Open since 2026-11-10: does any camera control still feel inverted; does the radio music please the ear; are the cheaper tier-2 build bills fine.

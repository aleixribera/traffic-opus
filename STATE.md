# State

## Now

Last pass shipped v0.0.120 Rings that keep their roads (roadplay item 7, last half): the roundabout preview washes red only the road inside the ring (and a dead end it drops), not every trimmed road end to end. `ringCut` in `src/render/preview3d.ts`; tests `tests/ringcut.test.ts`; frames `.scratch/rb-before.png`, `rb-after.png`, `rb-after-huge.png`. CI for v0.0.119 was green. Roadplay items 5 and 7's message had already shipped in v0.0.107 (STATE was stale). **Next pass: check CI for v0.0.120** (`gh run list -L 2`); if green, roadplay item 3 (the placement chip by the pointer shows a power warning while the real blocker, e.g. overlap or water, hides in the side card; not in the changelog, check the code first). After that the log is done: weakest review category (traffic, towns, UI, polish, sound all 7.0).

## What works (latest)

- v0.0.120 roundabout preview marks only what goes (`tests/ringcut.test.ts`).
- v0.0.119 parallel pairs carry on round a corner from a fresh stroke (`tests/roadmodes.test.ts`).
- v0.0.118 turning bulbs fit their room (`tests/bulbs.test.ts`).
- v0.0.117 Transport cards fold on aim (`src/ui/hud.ts` aimed; browser-checked, DOM only).
- v0.0.116 bus stop plates (`src/ui/stopMarks.ts`; checked in the browser, no unit test: DOM only).
- v0.0.114 Works that land: a works by a road's dead end stands back and joins it (`tests/placesnap.test.ts`).
- v0.0.113 one-click Widen/Roundabout from queue advice (`tests/queuefix*`), v0.0.111 readable queues, v0.0.112 seeded sim (`tests/determinism.test.ts`).
- Review 2026-11-12 (`docs/review-2026-11-12.md`): scores 7.0–8.0. Weakest: traffic 7.0, towns 7.0, UI 7.0, polish 7.0, sound 7.0 (nobody has heard it).

## Broken / open

- Road play log (`docs/roadplay-log.md` on branch `t3/road-freight-playtesting`): open: 3 (placement chip). Done: 1, 2, 5, 7 message, 8 (v0.0.107/114), 4 in v0.0.119, 6 in v0.0.118, 7 preview in v0.0.120, 9 in v0.0.116, 10 in v0.0.117). A bulb's kerb ring also crosses the road mouth (old look, shows more on small bulbs). Ring preview misses two rare cases commit removes: an outside sliver under 7 m, and a road at an inner node that is not in removeSegs (a ramp).
- Late-save soak: worktree `~/.t3/worktrees/traffic-opus/t3-64b370fb`, branch `t3/late-save-deadlock-test` (f94271f): lategame fixture + 10-day soak, day-5 gridlock not settled. Too long for light tests; needs its own project and a shorter run.
- Slow tests to shrink: see `.claude/iterate.md`.

## Needs Aleix

- Overridable choices made by the loop: the loop file's order of work (worktrees first, then road play log, then weakest review category). Say if you want a different order.
- Open since 2026-11-10: does any camera control still feel inverted; does the radio music please the ear; are the cheaper tier-2 build bills fine.

# State

## Now

Last pass shipped v0.0.119 Pairs that pick up again (roadplay item 4): a parallel pair carries on round a corner after the drawing was broken off. `twinEnd` in `src/roads/planner.ts` finds the twin's dead end (left of the way on, within 2.5 m, running alongside) when a new stroke starts on a pair's end; before, the twin was refused ("Can't start on the road") or bent from the old twin's end and pinched. Drawing in one go was already even. Tests: `tests/roadmodes.test.ts` "fresh stroke"; frames `.scratch/parL.png`, `parR.png`. **Next pass: check CI for v0.0.119** (`gh run list -L 2`); if green, roadplay item 5 (stub left past a new junction), then 7 (ring message).

## What works (latest)

- v0.0.119 parallel pairs carry on round a corner from a fresh stroke (`tests/roadmodes.test.ts`).
- v0.0.118 turning bulbs fit their room (`tests/bulbs.test.ts`).
- v0.0.117 Transport cards fold on aim (`src/ui/hud.ts` aimed; browser-checked, DOM only).
- v0.0.116 bus stop plates (`src/ui/stopMarks.ts`; checked in the browser, no unit test: DOM only).
- v0.0.114 Works that land: a works by a road's dead end stands back and joins it (`tests/placesnap.test.ts`).
- v0.0.113 one-click Widen/Roundabout from queue advice (`tests/queuefix*`), v0.0.111 readable queues, v0.0.112 seeded sim (`tests/determinism.test.ts`).
- Review 2026-11-12 (`docs/review-2026-11-12.md`): scores 7.0–8.0. Weakest: traffic 7.0, towns 7.0, UI 7.0, polish 7.0, sound 7.0 (nobody has heard it).

## Broken / open

- Road play log (`docs/roadplay-log.md` on branch `t3/road-freight-playtesting`): 5 stub past a new junction, 7 ring message (4 done in v0.0.119, 6 in v0.0.118, 9 in v0.0.116, 10 in v0.0.117). A bulb's kerb ring also crosses the road mouth (old look, shows more on small bulbs).
- Late-save soak: worktree `~/.t3/worktrees/traffic-opus/t3-64b370fb`, branch `t3/late-save-deadlock-test` (f94271f): lategame fixture + 10-day soak, day-5 gridlock not settled. Too long for light tests; needs its own project and a shorter run.
- Slow tests to shrink: see `.claude/iterate.md`.

## Needs Aleix

- Overridable choices made by the loop: the loop file's order of work (worktrees first, then road play log, then weakest review category). Say if you want a different order.
- Open since 2026-11-10: does any camera control still feel inverted; does the radio music please the ear; are the cheaper tier-2 build bills fine.

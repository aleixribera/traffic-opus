# State

## Now

Paused by Aleix, 2026-11-12.

Last pass (after v0.0.120, CI green): roadplay item 3 was already fixed in code (power is a non-blocking warning pushed only when the plot is ok; an overlap leads the chip in amber, water as the refusal), so the road play log is done. Then the late-save soak (review top 5 #5, traffic at scale): branch rebased onto v0.0.120 and parked as `wip/late-save-soak` (supplied late save fixture, `tests/latesave.test.ts` soak project, probe `tools/zsoak.build.ts`). Probe on v0.0.120: 180 game hours (7.5 days) of the late save, 255-278 vehicles, at most 13 standing in any 90 h window, 0 cycle releases, 0 jam breaks, 0 quits: the old day-5 gridlock (+114 h) no longer forms. **Next:** run `npm run test:soak` on that branch in the background (~30 min, its strict checks never ran to the end), and if green merge it to main (no release: no player-visible change) and remove the worktree.

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

- Road play log (`docs/roadplay-log.md` on branch `t3/road-freight-playtesting`): all done (3 found already fixed by 42580ee). Done: 1, 2, 5, 7 message, 8 (v0.0.107/114), 4 in v0.0.119, 6 in v0.0.118, 7 preview in v0.0.120, 9 in v0.0.116, 10 in v0.0.117). A bulb's kerb ring also crosses the road mouth (old look, shows more on small bulbs). Ring preview misses two rare cases commit removes: an outside sliver under 7 m, and a road at an inner node that is not in removeSegs (a ramp).
- Late-save soak: worktree `~/.t3/worktrees/traffic-opus/t3-64b370fb`, parked as `wip/late-save-soak` (8518f08); see Now.
- Slow tests to shrink: see `.claude/iterate.md`.

## Needs Aleix

- Overridable choices made by the loop: the loop file's order of work (worktrees first, then road play log, then weakest review category). Say if you want a different order.
- Open since 2026-11-10: does any camera control still feel inverted; does the radio music please the ear; are the cheaper tier-2 build bills fine.

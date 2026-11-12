# State

## Now

Paused by Aleix, 2026-11-13.

Last pass: the late-save soak is merged (review top 5 #5 done). `npm run test:soak` (`tests/latesave.test.ts`, not on CI) runs ten days of the supplied late save in ~26 min: peak 316 vehicles, daily standing mean 1.1-2.3, worst single wait 54 s, 0 rings, 0 releases/breaks/quits, no build-up. Its "over 5 standing" bar is 3 game hours, not the review's 1 (a single red of the longest fixed-time plan is longer than 40 s). Worktree and `wip/late-save-soak` removed; no parked work left. **Next:** `PLAN.md` Stage 1 item 1, stage saves for testing (`tools/lategame.build.ts` already builds a supplied late save). A traffic lead from the soak: left turns across a busy unlit avenue junction wait up to 54 s at the peak (late save node 233; town road upgrades never add auto lights, `autoLights` in `src/game/city.ts` only lights new arms).

## What works (latest)

- Late save holds ten days at ~300 vehicles without a lasting jam (`npm run test:soak`, `tests/latesave.test.ts`).
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
- Slow tests to shrink: see `.claude/iterate.md`.

## Needs Aleix

- Overridable choices made by the loop: the loop file's order of work (worktrees first, then road play log, then weakest review category). Say if you want a different order.
- Open since 2026-11-10: does any camera control still feel inverted; does the radio music please the ear; are the cheaper tier-2 build bills fine.

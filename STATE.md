# State

## Now

Pass 2 (2026-11-12 evening), step: **CI red on v0.0.114** (pass 1 of 1). The placement step-back offered a spot standing free of every road, so test setups using `placeAlong` placed works with no road (18 failures in inspect, bottleneck, economy). Fix: a step back only offers a spot joined to a road; halving treats a free spot as "too far back". Check: the three files plus placesnap pass locally; CI green on the push.

## What works (latest)

- v0.0.114 Works that land: a works by a road's dead end stands back and joins it (`tests/placesnap.test.ts`).
- v0.0.113 one-click Widen/Roundabout from queue advice (`tests/queuefix*`), v0.0.111 readable queues, v0.0.112 seeded sim (`tests/determinism.test.ts`).
- Review 2026-11-12 (`docs/review-2026-11-12.md`): scores 7.0–8.0. Weakest: traffic 7.0, towns 7.0, UI 7.0, polish 7.0, sound 7.0 (nobody has heard it).

## Broken / open

- Road play log (`docs/roadplay-log.md` on branch `t3/road-freight-playtesting`): 4 parallel pinch at a corner (unreproduced), 6 twin bulbs, 9 bus stops invisible at normal zoom, 10 catalog fold with stop.
- Late-save soak: worktree `~/.t3/worktrees/traffic-opus/t3-64b370fb`, branch `t3/late-save-deadlock-test` (f94271f): lategame fixture + 10-day soak, day-5 gridlock not settled. Too long for light tests; needs its own project and a shorter run.
- Worktree `t3-76f64fe0` (`t3/road-play-fixes`): only item 8 (now on main) and a probe test. Remove it.
- Slow tests to shrink: see `.claude/iterate.md`.

## Needs Aleix

- Overridable choices made by the loop: the loop file's order of work (worktrees first, then road play log, then weakest review category). Say if you want a different order.
- Open since 2026-11-10: does any camera control still feel inverted; does the radio music please the ear; are the cheaper tier-2 build bills fine.

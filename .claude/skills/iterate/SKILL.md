---
name: iterate
description: One pass of the Kilometre Zero (traffic-opus) owner loop. Orient, pick one step a player would notice, build it, prove it in the running game with light tests, ship a tagged version, report, schedule the next pass. Use on "run the iterate skill" and on every /loop wake in this repo.
---

# Iterate

One pass of the owner loop. `docs/direction.md` and the user's rules in memory win over this file. Goals and checks are fixed; methods are starting points.

## 1. Orient

1. On `main`: `git fetch`, compare with `origin/main`, pull if behind. Never stage `tools/drift.build.ts` or `.scratch/`.
2. Read the memory file `loop-state` (the recovery point), the latest `docs/review-*.md` scores, and `git worktree list` for unmerged work.

## 2. Choose

In this order:
1. Broken: a failing build or test on main, a console error in the game, a deadlock, a save that won't load.
2. Finished-but-unmerged work in a worktree (review it, finish it, ship it).
3. The user's open requests in memory.
4. The weakest category of the latest review.

Take **one step a player would notice**, sized to finish this pass. Write it in `loop-state` with its acceptance check: what you will see in the running game.

## 3. Build

Do the work yourself, in this checkout or a branch. Subagents only for the second opinion, or for parallel parts with their own files (briefs carry the PC rules below).

## 4. Prove it (tests light and fast)

- `npx tsc --noEmit -p .` and only the test files the change touches: `npx vitest run --project quick tests/<file>.test.ts` (or `--project scenarios`). Tests run at idle priority with at most 3 workers; never more.
- No full suite on this PC. GitHub Actions (`pages.yml`, job `test`) runs every test but balance on each push to main: that is the full run. Check it with `gh run list` / `gh run view` after pushing, and make a red run the next pass's "broken" pick. A failing test in code you didn't touch, or a known flaky one: note it and move on.
- Watch the acceptance check in the game: `npx vite --port 5551 --strictPort`, then `playwright-cli` headless and muted (`.playwright/cli.config.json`), screenshots at 1600x900 and 1280x720 (PC only, no phone). Open the browser for one round, then close it and stop the dev server.
- For a bug: see it fail before the fix and pass after.

## 5. Ship

- Read the diff as a skeptical reviewer. Real logic gets one second-opinion subagent on the final diff (reads only).
- `npx vite build`, changelog entry in `src/ui/changelog.ts` (or wherever the in-game What's new lives), commit, annotated tag `v0.0.<n+1>`, push main and the tag, check `gh run list` for the Pages deploy.
- Unverified work goes to a branch, never main; note it in `loop-state`.

## 6. Report and continue

Update `loop-state` (short). Report in three lines: what shipped, how it was verified (screenshot path), what's next. Then `ScheduleWakeup` with the same /loop prompt. On "pause" or "stop": park work on a branch, update `loop-state`, `ScheduleWakeup stop: true`.

## PC rules (this PC runs out of CPU with web games)

One headless browser at a time, paused game unless it needs to run, close it right after, stop dev servers when done, at most two agents with a browser.

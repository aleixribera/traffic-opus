# Loop file: Kilometre Zero (traffic-opus)

Project specifics for the global `iterate` skill. Where this differs from the skill, this wins.

## Vision and plan

- Vision: `docs/direction.md` (wins over `docs/design.md`), plus the user's rules in Claude's project memory (`industry-focus`, `traffic-not-money`, `stable-growth`, `ui-words` rule book `docs/ui-words.md`, PC only, and the rest in MEMORY.md).
- Plan: `PLAN.md` (written by the director chat): the current stage, its items in order and each item's acceptance check, and the scorecard.
- Backlog: `BACKLOG.md` (written by the loop): work cut, found or deferred, for the director to promote.

## Notes

- `STATE.md` (repo root, cap 8,000 characters): Now, what works, broken, open branches/worktrees, Needs Aleix.
- Long history stays in memory `loop-state.md`; don't grow it further, STATE.md replaces it.

## Build

- `npx tsc --noEmit -p .` while working; `npx vite build` before shipping.
- Never stage `tools/drift.build.ts` or `.scratch/`.

## Test (light and fast)

- One run of the files that cover the change: `npx vitest run --project quick tests/a.test.ts tests/b.test.ts` (scenarios: `--project scenarios`; their list is `SCENARIOS` in `vite.config.ts`). Tests run at idle priority with at most 3 workers.
- To find the files: grep `tests/` for the changed functions **and for the helpers that call them** (e.g. `placeAlong` in `tests/helpers.ts` calls `placedPlan`; `tests/*.scenario.ts` build shared worlds). Missing these turned CI red on v0.0.114.
- No full suite on this PC. GitHub Actions (`.github/workflows/pages.yml`, job `test`) runs every test except balance on each push to main: that is the full run. Check it with `gh run list -L 2` on the next pass; red is the next pass's Broken pick. The balance playthrough runs only at a stage gate, in the background.
- Known slow files (shrink when touched): density, forecast, growth (quick); gatecures, trailers, gatejam, rhythm, junctionflow, deadlock (scenarios).

## See it working

- `npx vite --port 5551 --strictPort` (in the background), wait for HTTP 200, then `~/AppData/Roaming/npm/playwright-cli -s=it` (headless and muted via `.playwright/cli.config.json`). Helpers: `.scratch/it.sh` (`view cx cy halfH`, `clickw x y`, `movew x y`, `js "..."`, `shot name`). `app.view.worldToScreen(x,y)`; `window.app.game` is the sim; pause with `app.togglePause()`.
- Screenshots at 1600x900 (and 1280x720 for UI changes). PC only, no phone width.
- Close the browser (`playwright-cli -s=it close`) and stop the server (PowerShell: stop the process whose command line matches `vite --port 5551`) before the pass ends.
- UI changes: check against `~/.claude/skills/design-audit/design-rules.md` and `docs/ui-words.md`.

## Ship and release

- Every verified step is a release: entry at the top of `CHANGELOG` in `src/changelog.ts` (player words, short), commit on main, annotated tag `v0.0.<n+1>`, `git push origin main <tag>`. Pages deploys from main.
- Real logic gets one read-only review subagent on the final diff.

## Feedback

- The owner reports in chat; complaints and decisions are in Claude's project memory for traffic-opus. No in-game feedback file.

## Machine rules

- This PC runs out of CPU and memory with web games: one headless browser at a time, opened only for a round of checks, game paused unless it must run. At most two agents with a browser.
- Tests never slow the PC while the owner games: idle priority, 3 workers max (already in `vite.config.ts`).

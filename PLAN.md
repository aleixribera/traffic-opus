# Plan

The order of work for the loop. The director writes this file; the loop reads it every pass. Vision: `docs/direction.md` (mapped in `.claude/iterate.md`).

Carried over on 2026-11-12 from the loop file's old order of work, unchanged. The director is grilling Aleix on the next stage; this page changes once he answers.

Before any item: Broken, then Aleix's bugs and complaints (the iterate skill, step 2).

## Current stage: every review category at 9/10

Scorecard: the latest `docs/review-*.md`, scored against Cities: Skylines and Transport Fever 2 (now `docs/review-2026-11-12.md`, v0.0.108, scores 7.0 to 8.0).

1. **Finish unmerged work in worktrees** (`git worktree list`): finish, verify, ship, then remove the worktree. Now: the late-save soak on `wip/late-save-soak`.
   Check: `npm run test:soak` passes on the late save: about 250 vehicles, and "standing still" stays near 0 over 10 game days. Then merge and remove the worktree.
2. **The review's bug list and open top-5 items** in `docs/review-2026-11-12.md`. The road play log (`docs/roadplay-log.md` on `t3/road-freight-playtesting`) is done.
   Check, per item: the step to reproduce it no longer shows the bug in the running game.
3. **The weakest review category** (now traffic, towns, UI, polish and sound, all 7.0).
   Check: new evidence (a frame, a test, a measurement) that answers that category's "To reach a 9" list.
4. **Stage gate:** once every category has moved since the last review, a fresh reviewer re-scores the game.

## Later stages (in brief, from `docs/direction.md` "Next")

- Days 10 to 40, played by someone, not by a script.
- Freight rail with level crossings.

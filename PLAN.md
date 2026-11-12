# Plan

The order of work for the loop. The director writes this file; the loop reads it every pass. The vision is `VISION.md`.

Before any item: anything broken, then Aleix's bugs and complaints (iterate skill, step 2). Once every item below works roughly, the loop takes the weakest review category, leaning to the early game.

## Stage 1: the first two hours, plus tools for big networks (set 2026-11-13)

Aleix got bored for two reasons: too much waiting, and the same early game over days of testing. This stage fixes both.

1. **Stage saves for testing.** A hidden dev option (a URL flag or a dev menu, not shown to players) opens a real game saved at first steel, at the first tier-3 product, and at late game. The saves are built by playing the real rules (a script is fine), not by forcing towns to grow.
   Check: each of the three opens from the dev option in the browser, its towns are supplied (not "Shrinking"), and it runs at speed 4 for one game day with nothing standing for good.
2. **Find the boredom.** A fresh tester plays a new game on a random map for 2 to 3 real hours at speed 4. Every few minutes it notes what it is doing and what it is waiting for. It marks the minute the game goes flat and every stretch over 3 minutes with nothing worth doing. The log goes in `docs/boredom-<date>.md`, its findings go into `BACKLOG.md`, and the director promotes them.
   Check: the log exists, with the boredom minute and a timed list of waits.
3. **A fresh map each game.** The first-ever game no longer always uses seed 7 (`src/main.ts`, `src/ui/menu.ts`). The first goals still point at real deposits near the home town.
   Check: two fresh browser profiles get different maps, and in each, the first goal's pointer lands on a real deposit.
4. **No waiting over 3 minutes.** Cut every stretch from item 2 where the player has nothing worth doing for over 3 real minutes at speed 4, starting with the Smelter site (11 to 27 minutes in the last review). Make the next chain worth starting while a site fills, and fill sites faster where needed.
   Check: a timed play of the first two hours shows no stretch over 3 minutes with nothing worth doing.
5. **A first jam the player can manage.** By about 40 minutes, a jam forms on its own, at a works gate or a town junction, from trucks growing with site level and towns adding traffic. Nothing scripted. The Traffic window names its cause and offers a fix, and the fix clears it.
   Check: in a played new game, a jam forms between 30 and 45 minutes, the window names it, and the offered fix clears it within a game hour. No permanent gridlock.
6. **Bigger trucks as sites level up.** Finish the truck classes that come with site level, so the same freight takes fewer vehicles.
   Check: on the late-game stage save, a level-3 or higher site moves the same loads a day in visibly fewer vehicles than at level 1 (count before and after).
7. **Ready-made interchanges.** Diamond, trumpet and cloverleaf drop onto a highway as one placement, with a preview, a price and one undo, unlocked by a milestone.
   Check: each one placed on a highway in the late-game stage save connects every movement, and traffic flows through it at speed 4 for a game day.
8. **Stage review (the gate).** A fresh reviewer plays a real new game for at least 2 hours, scores the 13 categories against Cities: Skylines and Transport Fever 2, and notes the minute it got bored. Sound is not scored.
   Check: no category below `docs/review-2026-11-12.md`, the first-hour and progression categories higher, and the boredom minute later than in item 2.

Done already: the late save holds ten days at about 300 vehicles (`npm run test:soak`).

## Later stages (in brief)

- **Stage 2, the mid game:** tiers 3 to 5 played and fun over days 10 to 40, with long goals, convoys and landmarks proven in a real game.
- **Stage 3, the late game:** freight rail with level crossings.

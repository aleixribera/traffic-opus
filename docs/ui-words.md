# Words and weight: the interface text rework (2026-11-10)

The owner asked for an in-depth pass over every word and panel the game shows: "strip unnecessary text, make text
easier to read, stand out more/less". This file is the brief and the rule book for that pass and for every UI change
after it. `docs/ui-style.md` keeps the look (tokens, plates, type); this file is about what goes on them.

## What a player sees today (headless play, 1600x900, new game and the Elton showcase)

The look is right; the problem is volume and repetition. A new company opens with the same goal said four times
(the top pointer "FIRST GOAL · FERTILE SOIL", the Goals card's goal line, its WHERE box, and the tip under it), the
goal count three times (top bar Goals, Goals card header "0 of 20 reached", bottom-left "GOALS 0 of 20 / None
reached yet"), and the Goals card runs three goals deep with their unlocks. A selected truck says "1 load of planks"
in its header, "1 load planks" in its key number and "Planks 1 load" in its cargo chip, then a paragraph on how to
read the dashes on the map. Panels explain themselves in full sentences ("The map shows the Traffic flow view while
this is open: red roads are jammed.", "Nothing in hand. Pick a works, then click the map to build it.") where the
UI already shows it. Key-number captions wrap into broken lines ("food a day, can 24", "profit, last hour",
"arrives · 50 m to go"). Red trouble lines are used for things that are fine ("Towns on your roads have all the food
they take for now" in red on a plant whose towns are full; its To chip says "no buyer yet: towns buy it from 0
people", which is false).

## The rules

1. **One place per fact.** A fact shows once on screen at a time. The current goal lives in one place (the Goals
   card); the map pointer is the arrow to it, not a second copy of its words. A tip never restates the goal it
   serves: it adds the one step the goal doesn't say, or it doesn't show. A count shown in a header isn't repeated in
   a strip.
2. **State first, then a number, then (only if something is wrong) one action.** A status line is a state word or a
   short phrase ("Working", "No road to a buyer", "Short of food"). A second line appears only when the player can do
   something, and says what, in the imperative ("Build a road to Elton").
3. **No eyebrows, no subheads.** No small label over a title and no explanatory line under it (owner rule). A
   header is the name alone, plus a badge or icon action. A subtitle survives only when it carries a fact the panel
   doesn't show anywhere else.
4. **No instructions for the UI itself.** Don't explain what the map draws, how a panel works or what to click
   next, when the control is right there. If it truly needs saying, it goes in a tooltip (`title`) or the Controls
   page.
5. **Short.** Status lines and chips: under 8 words. Tips and toasts: one sentence, two at most, 20 words in all.
   Blurbs on build cards: one sentence. No semicolons, no colon chains ("x: y: z"), no parentheses, no "·"-joined
   lists longer than three items in running text.
6. **Plain, period voice.** Sentence case for everything but display-caps titles. Concrete nouns the game uses
   everywhere the same way: **works** for any company building that makes or moves goods (not plant/site/factory
   mixed), **town**, **load**, **truck**, **road**. Numbers with units the same way everywhere: "4 loads/day",
   "12 km", "$8,000", "+$410/h".
7. **Captions never wrap.** Key-number captions are one or two words ("loads/day", "profit/h", "trucks out",
   "arrives"). Anything more goes in the tooltip.
8. **Weight carries meaning.** Per panel: one thing in the accent (selection or progress), trouble in `--bad` only
   when it is trouble the player should act on, fine things quiet (`--cream-2` or good green, never red). Secondary
   detail in `--cream-2`; things you rarely need folded into Details. Bigger type for the one number that matters
   most; never bold whole sentences.
9. **Empty states say nothing or one short line.** No chart until there is data; no "0 of 8 filled" section header
   with a paragraph for something that hasn't started. "No orders yet" at most.
10. **True.** A message must match the game state. Wrong ones are bugs: fix the logic, not just the words.

## Per screen

- **Top bar**: the company name plate and nine buttons with captions. Keep; check each caption is the panel's name.
  Two "Towns" (top bar and bottom bar) open the same list: one goes (the bottom bar's build category keeps "Towns"
  only if it is a build category; otherwise drop it there).
- **Bottom bar**: the "GOALS 0 of 20 / None reached yet" block repeats the Goals card. Make it one thing (the
  current goal's progress, or remove it while the card is open).
- **Goals card** (top right): the goal at hand, its progress, its reward. Other open goals folded to one line each.
  The WHERE box and the tip merge into one line under the goal, only while it says something the goal doesn't.
- **Goal pointer** (top centre): an arrow and a distance, a few words. No "FIRST GOAL" eyebrow.
- **Tips**: state-aware, few, dismissible (owner, 2026-11-08); one sentence; never duplicate the goal.
- **Build catalog**: card = icon, name, cost; locked = what unlocks it. The footer hint "Nothing in hand..." goes;
  the hovered card's one-line blurb shows there instead.
- **Inspector** (works, town, truck, road, junction, ground, stuck spot): header name + level badge + actions, no
  subtitle that repeats; status one line; three key numbers with one-word captions; flow chips; one level line;
  Details folded. No "how to read the map" lines.
- **Town panel**: state, people, needs (word + bar + "35 of 23 loads/day"), what's next, orders only when there are
  any. "Soon: Cement when it reaches 600 people" stays (it is the goal).
- **Lists** (Towns, Economy, Traffic, Goals): tables of rows, no paragraphs; empty charts hidden.
- **Pause menu**: title only; settings rows show their value right-aligned the same way ("Camera Diorama", not
  "Camera · Diorama").
- **Toasts and banners**: one line; the banner's subline only when it says something new.
- **Cursor messages while building**: the one blocker or the price, never both a warning and a blocker.

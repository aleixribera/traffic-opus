# UI style: Deco industry

Kilometre Zero's interface is a Transport Fever 2 layout (compact, data-first dark panels, a bottom toolbar with
category tabs) dressed as 1920s-40s American industry: enamelled sign plates, WPA-poster lettering, works nameplates.
Readability comes first; the period details are kept to a rim, a pinstripe and two rivets.

All tokens live in **`src/ui/theme.css`** (imported first by `hud.css`). Don't hard-code a colour or size in a
component rule when a token exists; add a token if a new one is needed.

## Palette

| Token | Value | Use | Contrast |
| --- | --- | --- | --- |
| `--ink` | `#070d17` | readouts (money, clock), inputs, bar tracks | |
| `--bar` | `#0c1524` | bottom bar, cursor chips, map roundels | |
| `--plate` | `#122036` | panel body | |
| `--plate-2` | `#1a2c47` | header plates, cards, raised buttons | |
| `--plate-3` | `#24385a` | pressed / selected | |
| `--edge` | `#050a12` | the dark rim round every plate | |
| `--rule`, `--rule-2` | cream at 13% / 24% | hairlines; control borders | |
| `--cream` | `#f3ead6` | body lettering | 13.7 on plate, 11.7 on plate-2, 9.8 on plate-3 |
| `--cream-2` | `#cfc4ab` | secondary lettering | 9.4 / 8.1 / 6.8 |
| `--cream-3` | `#a99f8a` | tertiary, hints, disabled labels | 6.2 / 5.4 / 4.5 |
| `--ochre` | `#e0a833` | the one accent: selection, progress, focus, primary button | navy on it 8.6 |
| `--ochre-hi` | `#f0c25a` | accent lettering: section heads, costs, "Unlocks" | 9.8 on plate |
| `--pin` | ochre at 42% | the pinstripe | |
| `--brick` | `#9c3a28` | trouble fills (error chips, toasts, callouts) | cream on it 5.8 |
| `--bad` | `#ef8a6c` | trouble lettering | 6.6 on plate |
| `--good`, `--good-fill` | `#93c97a`, `#3a7036` | good lettering; go fills | 8.5; cream on fill 4.9 |
| `--info` | `#7fb6e0` | neutral data lines, power | 7.5 |
| `--bar-ok/mid/low` | green / ochre / red | supply and progress bars | |
| `--copper` | `#d07a45` | a material colour: copper, the road-train share of the fleet bar | |

Product colours (bars, pips, hour charts) go through `onPlate()` in `hud.ts`: a dark one (coal, crude oil) is lifted
toward cream until it reaches 3:1 on `--plate`. Selected text is ochre with navy lettering (`::selection`).

Each signal colour has one meaning. Ochre is selection and progress, never "warning"; brick is trouble. Text never
goes below 4.5:1 against the plate it sits on; `--cream-3` is the floor and only on `--plate`/`--plate-2`.

## Type

Two self-hosted SIL OFL families in `public/fonts/` (licences alongside), no runtime CDN:

- **Big Shoulders Display** 600/700/800 (`--f-display`): condensed Chicago-poster capitals. Panel titles, the bottom
  bar's town name, banners, the title. Always uppercase with 0.04-0.08em tracking. Never for numbers or body text.
- **Barlow** 400-700 (`--f-text`): a grotesque drawn from highway and rail signage. Everything else. All figures are
  Barlow with `tabular-nums lining-nums` so money and dates don't jitter (Big Shoulders has no tabular figures).

| Token | Size | Use |
| --- | --- | --- |
| `--t-xs` | 12px | the floor: units, captions, card sub-lines |
| `--t-sm` | 13px | body, table rows |
| `--t-md` | 14px | menu items, emphasised rows |
| `--t-plate` | 18px | panel titles (display caps) |
| `--t-big` | 18px | money and clock readouts |
| `--t-banner` | 30px | milestone / town banners |
| `--t-title` | 52px | the title menu |

Section heads inside a panel (`.sub-h`) are 12px Barlow 600 caps in `--ochre-hi` with a hairline under them: the
"stamped label" look without competing with the plate title.

## Panel anatomy

```
┌─ edge (1px --edge) ───────────────────────────┐
│ HEADER PLATE  (--plate-2, display caps 18px)  │  .win-head / .panel > header / .dialog > header / .gl-head ...
╞═ ochre rule + pinstripe ══════════════════════╡
│ body on --plate, 14px side padding            │
│  SECTION HEAD (.sub-h, ochre caps)            │
│  Label ............................. value    │  rows: cream-2 label, cream value, right-aligned numbers
│                                               │
│ •  (rivet)                          (rivet)  •│
└───────────────────────────────────────────────┘
   └ pinstripe: 1px --pin outline, 4px inside the edge
```

- **Plate** (`.card`): `--plate`, 1px `--edge` border, `--r` = 2px corners (stamped metal is nearly square),
  `--shadow`, an inner 1px `--pin` outline 4px in (the pinstripe), two rivets (`--rivet`) in the bottom corners.
- **Header plate**: one shared selector in `hud.css`; `--plate-2`, ochre bottom rule with a second pinstripe under
  it, title in display caps. A close button sits at the right as a plain glyph.
- **Buttons**: `.btn` raised on `--plate-2` with a `--rule-2` border; `.btn.primary` ochre with navy lettering;
  disabled = dashed border, `--cream-3` text. Selected toggles (`.seg-btn.on`, speed buttons) fill ochre.
- **Readouts**: money and the clock sit in inset `--ink` wells (Barlow 600 18px), like a counter on a panel.
- **Tabs and toolbar**: the bottom bar is `--bar` with an ochre top rule. A selected category is `--plate-3` with an
  ochre bar on top and a caret; a category the tips point at (`.cat.hint`) gets ochre lettering and a pulsing ochre
  diamond, so "look here" never looks like "selected".
- **Cards** (catalog `.asset`): `--plate-2`; selected = ochre border plus bottom bar; locked = dashed border, icon
  dimmed, name still legible in `--cream-2` with the lock reason.
- **Banners**: a proclamation plate (a `.card`) with an ochre/navy dashed band on top, display caps 30px title, ochre
  caps subline. Toasts drop below a visible banner (`.hud:has(> .banner:not([hidden])) .toasts`).
- **Focus**: every control shows `outline: 2px solid var(--ochre)` on `:focus-visible`.

No gradients except the rivets, no pill shapes, no icon-card grids, no centred hero.

## Icons

`src/ui/icons.ts` (UI pictograms), `src/ui/mapIcons.ts` (problem roundels on the map). One flat style, hand-written SVG:

- 28-unit grid for building and category icons, 16 for products, 14-22 for control glyphs.
- Bold silhouettes, filled shapes; strokes no thinner than 1.2 units; no gradients, no outlines round the whole shape.
- Light on dark: cream (`#f3ead6`) masses with one or two signal colours (ochre, brick, olive, steel, wood). A dark
  material (coal) gets a `--cream-2` rim so it reads on navy.
- Control glyphs (undo, play, modes...) use `currentColor` so they take the button's state colour.
- Every exported name and `ICON` key is part of the API (`keyof typeof ICON` is used by chips); add, don't rename.
- Map problems are enamel roundels: a full-colour disc carries the meaning (navy = gate to connect, ochre = cargo
  or warning, brick = cut off), the CSS adds the cream rim and the tail that points at the spot.

## Map labels

Town labels are station nameplates (`labels.ts`, `.ml-plate`): the name in display caps on a `--plate` plate with a
pinstripe, its size and population on an ochre tab underneath, the supply gauge inside the plate, need roundels below.
A solid plate (not a text halo) keeps the label at full contrast over any terrain.

## The company slot

`.company` is a button in the top-left bar, after the menu button: the company's 28px herald (`herald.ts`) then its
name in display caps (19px, max 250px, ellipsis). Hover raises it to `--plate-2` with ochre lettering; a click opens
the company dialog (`.co-dlg`): the badge on an inset `--ink` well with a pinstripe, the name field in display caps,
and Another name / Another badge / Done. The herald also signs the milestone banner (`.banner-co`), the pause menu
header (`.pm-co`) and each save (`.save-co`, ochre lettering). The explore strip at the top centre keeps clear of the
bar (`left: max(50%, 790px)`).

## Bulletins and readouts added with the industry chains

- **What's new** (`.dialog.news`): one release per block, version in `--ochre-hi` for the latest, date in small caps,
  points marked with ochre diamonds. The menu card's foot carries the latest as an inset `--ink` slip (`.mm-news`).
- **Version tab** (`.ver-tag`): 12px `--cream-3` on `--bar` (7.0:1), bottom right on the title menu, on the bottom
  bar's top rule in play so it never covers the speed buttons.
- **Hour bars and production ticks** (`.hb-chart`, `.pd-ticks`): bars in the product's colour on an inset `--ink` well.
- **Fleet split bar** (`.fm-bar`): light, heavy, road train as `--cream-2`, `--ochre`, `--copper`, pale to deep.
- **Warehouse table** (`.wh-opts`): ledger rows with hairlines, stamped TAKE / FEEDER heads, square ochre checkboxes.

## Viewports

PC only: designed and checked at 1440x900 and 1920x1080. The single `@media (max-width: 1100px)` rule only tightens
the bottom bar for small windows; there is no phone layout.

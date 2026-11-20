# Stonetop UI Style Guide

How the sheets, dialogs, chat cards and journal pages in this system are meant to look, and how to
write CSS and markup so new work looks the same. It describes what `styles/stonetop.css` already
does; where the stylesheet disagrees with itself, the guide says which way new work should go and
lists the stragglers under [Known gaps](#14-known-gaps).

The stylesheet's own comments are the long form of everything here. When a rule in this guide
seems arbitrary, search the stylesheet for the token or class it names: the reason is written
above it.

**Contents:** [The look](#1-the-look) · [Checklist](#2-before-you-write-a-rule) ·
[Colour](#3-colour) · [Type](#4-type) · [Shape, space, motion](#5-shape-space-stacking-motion) ·
[Surfaces](#6-surfaces) · [Controls](#7-controls) · [Dialogs](#8-dialogs-and-guided-windows) ·
[Chat, journal, HUD](#9-chat-cards-journal-pages-hud) · [Palettes](#10-palettes-and-accessibility) ·
[Icons](#11-icons-and-glyphs) · [Naming and CSS](#12-naming-and-css-authoring) ·
[Tests](#13-the-tests-that-hold-this) · [Known gaps](#14-known-gaps)

---

## 1. The look

A printed playbook on a table: near-white grained paper, near-black ink, thin rules, and one
accent.

- **Paper and ink.** Sheets and dialogs are parchment (`--st-page` under the spiral grain). Text is
  the five-step ink ramp. Structure comes from hairlines and faint washes, not from colour blocks
  or shadows.
- **Slate is the only interactive accent.** Title bars, primary buttons, selected states, focus
  rings and hover washes are slate. Foundry's orange never shows inside a Stonetop window.
- **Colour means something or it is absent.** Green is "active / done", blue is "a step, or needs
  your input", red is "destructive / harm", gold is "caution". A handful of palettes (seasons,
  playbooks, relationship-map inks, timeline kinds, roll tiers) are reserved for one job each.
- **Colour is never the only signal.** Two players at the table are red-green colour-blind and one
  reads on a screen magnifier. Every coloured thing also has a word, a glyph, a weight or a
  pattern.
- **The reader sets the size, the face, the page and the contrast.** Every surface has to hold up
  under three sheet fonts, a 0.9–1.4× text size, three pages (parchment, Lamplit, Slate), high
  contrast, no grain, no italics, and the black paper of a dead character.
- **The book's furniture.** Spiral bullets, diamonds and circles for marks, octagonal boxes for
  stats and vitals, small caps for stat labels.

## 2. Before you write a rule

1. **Is there already a class for this?** Section 7 lists the shared buttons, chips, checks and
   field rows. Reuse one before naming a new skin.
2. **Every colour is a token** (section 3). A literal written for white paper is black-on-black on
   the dark pages.
3. **Every text size is on the scale** (section 4) and never under the floor.
4. **Radius is a token**, a pill, or a circle (section 5).
5. **Scope it to `.stonetop`** (or a `stonetop-…` class) so core and other modules are untouched.
6. **Open it in Lamplit, in high contrast, at 1.4× text and on a dead character's sheet** before
   calling it done.
7. **Run `npm test`.** The style tests in `tests/styles/` fail on most of the mistakes this guide
   warns about.

---

## 3. Colour

All tokens are declared on `:root` at the top of `styles/stonetop.css`. The dark and
high-contrast palettes work by re-pointing these tokens, so a rule that reads a token follows every
palette for free and a rule that spells a colour out follows none.

### Surfaces

| Token | Paper value | Use |
|---|---|---|
| `--st-page` | `hsl(30 20% 98%)` | The page itself, under the grain. |
| `--stonetop-bg` | `hsl(30 20% 94%)` | The **panel** tone: things that sit on the page and read as inset — a stat box, a vital cell, a paper button, a chip. Not the page. |
| `--st-surface` | = `--st-page` | What a small cut-out must match to disappear. Re-declared by any surface that washes the page (see `.steading-card`). |
| `--st-card-fill` / `--st-card-rule` / `--st-card-veil` | 3% ink / 12% ink / half the page | The card recipe (section 6). |
| `--stonetop-bg-texture`, `--st-paper-veil-layer`, `--st-inverted-paper` | — | The grain. Never write the image url in a rule; the "Paper Texture" setting works by re-pointing these. |

### Ink

| Token | Paper | Use |
|---|---|---|
| `--st-text` | `#222` | Primary, emphasis, titles |
| `--st-text-body` | `#333` | Body |
| `--st-text-secondary` | `#555` | Secondary |
| `--st-text-muted` | `#777` | Captions, hints |
| `--st-text-faint` | `#999` | Disabled, empty states |
| `--st-quiet-ink` | `slategrey` | The quiet slate label: a step title, a section caption |
| `--st-slate-rule` | `slategrey` | Slate as an edge: an inline button's border, the tab rail's frame, a selected card's rim |
| `--st-heading-ink`, `--st-danger-ink` | `#2f2a24`, `#a02020` | Dialog date headings; a destructive control's ink and rule |

No other greys for text. `#666`, `#888`, `#aaa` and friends were folded into this ramp.

### Washes, rules and wells

Write a translucent black or white as a **channel**, never as `rgba(0,0,0,a)`:

```css
background: rgb(var(--st-ink-rgb) / 0.04);     /* a faint inset wash */
border: 1px solid rgb(var(--st-ink-rgb) / 0.12); /* a hairline */
background: rgb(var(--st-paper-rgb) / 0.7);    /* a field's well */
```

On paper `--st-ink-rgb` is `0 0 0` and `--st-paper-rgb` is `255 255 255`, so this is the same
pixel; the dark pages swap them. A translucent **slate** (under a selected option, a lane, a pip)
is `rgb(var(--st-slate-rgb) / a)` the same way. Common strengths: fills 0.02–0.06, hairlines 0.08–0.15, firmer
rules 0.18–0.25. **Shadows stay literal black** and do not use the channels.

### The semantic families

Each has `-border`, `-bg`, `-bg-hover` and `-text`. Use the whole family together; never mix a
family's fill with a hand-picked ink.

| Family | Meaning | Examples |
|---|---|---|
| `--st-btn-primary-*` (slate) | The primary action; the selected one of a set | Dialog confirm, CTA, active tab, active filter pill |
| `--st-accent-fill` | Slate as a fill that is not a button | Title bar, checked radio, selected chip |
| `--st-slate-hover-bg` / `-border` | Hover on a pickable surface | Season cards, option rows |
| `--st-green-*` | Active / chosen / done | Weather tiers, chosen tags, the current guide step |
| `--st-blue-*` | A numbered step; "needs your input" | Welcome guide badges, a follower's "needs your input" chip |
| `--st-red-*` | Destructive, harm, dead | Delete confirms, Dead and Condemned pills |
| `--st-gold-*` | Caution, not yet failure | A threat's clock, Death's Door accent, off-rules stat frame |
| `--st-tier-failure/partial/success-text` | A roll's 6- / 7-9 / 10+ | Tier ladders on move cards and chat cards |
| `--st-holy-light-*`, `--st-condemned-*`, `--st-levelup-accent` | One playbook feature each | Don't borrow them. |

### Reserved palettes

These belong to one job. Do not reuse them for decoration, and do not letter text in them unless
their note in the stylesheet says the contrast was measured for text.

- **Season inks** `--stonetop-season-*-ink`: the steading header's clock only
  (`tests/actors/steading/steading-header-season.test.js` counts their uses). The season picker,
  the Seasons Change banner and chat cards have each worn them and had them taken back off. The
  HUD's season banner is the one sanctioned place that colours by season, with gradients of its
  own that do not read these tokens; the timeline has its own four.
- **Playbook colours** `--color-the-*`.
- **Relationship-map inks** `--st-relmap-ink-*`: colour a line, never a word.
- **Timeline kinds** `--st-timeline-kind-*`: mark a card's edge and chip, never its text.
- **Route and fight inks** `--stonetop-route-*`, `--stonetop-fight-*`: drawn on maps; read by JS.

### When no token fits

1. **A hued ink or pale fill that only exists on paper** reads a dark-only lift with the paper
   literal as its fallback: `color: var(--st-on-dark-danger, #8b1a1a)`. The lift is declared in the
   dark blocks alone, so paper paints the fallback. Existing lifts: `danger`, `caution`, `ok`,
   `umber`, `ink`, `muted`, `raised`, `highlight`, `hover`, `selected`, `rule`, `rule-soft`, the
   `failure/partial/success/whisper-bg` fills and the `attack-*` tags.
2. **A colour used in more than one place** gets a token on `:root`, with a comment saying what it
   is for and what it is *not* for, and values in the dark and high-contrast blocks.
3. **Core's colour names** (`--color-text-*`, `--color-border-*`) are re-pointed on our window
   roots and chat cards, never on `:root`, where core's own element-level declarations shadow them.

Contrast bars the tests enforce: text 4.5:1 on paper and Lamplit, 7:1 in high contrast; a boundary
or graphical mark 3:1.

---

## 4. Type

### Faces

| Token | Face | Use |
|---|---|---|
| `--font-stonetop` | The reader's "Sheet Font": **Signika** (default), Libre Caslon Text, or IM Fell English | Everything: body, labels, buttons, fields |
| `--font-avara` | Avara | Display only: the sheet's title and name, the steading's name, logos, a threat's name |
| `--font-fell` | IM Fell English, then the sheet font | Labels on the prop cards only: a threat's type and doom, a hazard's advance, a site's foundation |

Always write `font-family: var(--font-stonetop)`. Never name a face in a rule (the font picker's
own preview options are the exception), and never use `--font-primary`, which Foundry redefines.
Inputs, selects and textareas do not inherit a font; `.vtt .stonetop input` etc. already handle
them.

### Size

Body text in a window is **0.875rem (14px) × the reader's Sheet Text Size** (`--stonetop-font-scale`,
0.9–1.4). Nothing readable is smaller than **0.95× body** (`tests/styles/font-floor.test.js`).

| Token | Value | Use |
|---|---|---|
| `--st-fs-2xs` | 0.95em | Micro labels, tags (the floor) |
| `--st-fs-xs` | 0.96em | Captions, hints, dense labels |
| `--st-fs-sm` | 0.97em | Secondary / compact body |
| `--st-fs-base` | 1em | Default |
| `--st-fs-md` | 1.05em | Near-body emphasis |
| `--st-fs-lg` | 1.15em | Sub-headings |
| `--st-fs-xl` | 1.3em | Headings |
| `--st-fs-floor`, `--st-fs-floor-sm` | 0.86rem, 0.84rem × scale | The floor in rem, for text nested inside another em |

Rules:

- Use a token. If none fits, write `calc(Xrem * var(--stonetop-font-scale, 1))`.
- **Never a bare `rem` or `px` for words.** Bare `rem` ignores the Sheet Text Size setting; bare
  `px` also ignores the interface size.
- `em` multiplies when nested (0.95em inside 0.97em is 0.92). For anything that nests, use the rem
  form.
- Display sizes (1.6em, 2.2em, `--font-size-display`) stay literal.
- Icons and numerals pinned inside a fixed-pixel shape may be smaller, by exact-selector exemption
  in the font-floor test. Words never go on that list.

### Weight, case, style

- Headings and names: **bold**, upright (`font-style: normal`).
- **Italic** is for flavour and hints: the playbook blurb, appearance line, instinct, a step hint.
  Brackets stay upright in italics (the `@font-face` blocks handle it). The "No Italics" setting
  turns all of it off, so italics may not be the only thing distinguishing two pieces of text.
- **Small caps** (`font-variant: small-caps`): stat names (Strength, Dexterity…).
- **Uppercase with tracking**: eyebrow labels and table headers — vitals titles, "FORTUNES", a
  follower section heading, a residents-table header. Use `letter-spacing: 0.04em` for dense
  labels and `0.06em` for eyebrows; no pixel tracking.
- Numbers that line up (HP, tier labels) use `font-variant-numeric: tabular-nums`.
- Capitals in a box sit high. Chips trim to their caps (section 7); other cases read
  `--st-caps-nudge` / `--st-caps-lift`, which the font setting rewrites per face. Never hand-tune a
  pixel nudge.

---

## 5. Shape, space, stacking, motion

### Radius

| Token | Value | Use |
|---|---|---|
| `--st-radius-sm` | 3px | Buttons, inputs, chips with square corners, small boxes |
| `--st-radius` | 4px | Cards, window frames, dashed add rows |
| `--st-radius-lg` | 6px | Larger containers: steading cards, follower cards, tables, chat cards |
| `999px` | — | Pills |
| `50%` | — | Discs and round radios |

Nothing else, apart from the on-canvas HUD (the time banner and the tab rail use 8–12px because
they hang off a screen or window edge) and 1–2px on glyph-sized boxes.

### Space

There are no spacing tokens. Use the scale the stylesheet already keeps:

- **2 · 4 · 6 · 8 · 10 · 12px**, then **14 · 16px** for gaps between sections.
- Icon to label: `0.4em` (or 4–6px in a compact control).
- Inside a card: `8px 12px`. Inside a larger steading-style card: `10px 14px 12px`.
- Between cards in a grid, and between page sections: **12px** (`--stonetop-section-gap`). Between
  stacked move cards: 6px. Between move groups / details sections: 14px.
- Sheet tab bodies: `padding: 0 12px 12px` (character) or `12px` (steading).

### Stacking

Foundry's ladder is window 100–9999, tooltip 9999, notification 99999. Inside a component use
single digits. For something that must sit above every window use `--st-z-above-windows` (9998);
for a hover pop-over opened from inside a window (a tooltip, a preview, an autocomplete list) use
`--st-z-popover`. Never a four-digit number of your own.

### Motion

- Transitions change **colour and opacity only**, and name their properties:
  `transition: background-color 0.15s, border-color 0.15s, color 0.15s`. Never `transition: all`
  and never a metric on a button — core's `transition: all 0.5s` on window buttons makes a resizing
  button flicker under the pointer.
- Durations, written in seconds: **0.15s** for a colour change, **0.12s** for a hover reveal, `--st-popout-fade`
  (250ms) for a pop-out tile, `--st-edit-reveal-delay` (reader's setting, default 1s) before an
  edit pencil fades in.
- Every animation needs both exits: the `.stonetop-reduce-motion` setting class (which zeroes
  durations inside `.stonetop` automatically) **and** an
  `@media (prefers-reduced-motion: reduce)` rule. JS checks `prefersReducedMotion()` from
  `module/utils/reduced-motion.js`.

---

## 6. Surfaces

### Windows

- A Stonetop window carries **`.stonetop`** on its root. That one class gives it the parchment, the
  slate title bar (`--st-accent-fill`), the 4px frame with its drop shadow, the reader's font, the
  slate focus glow and the font scale on `.window-content`.
- Scrollbars inside sheets are hidden (`scrollbar-width: none`) on purpose; content scrolls without
  a gutter.
- Core windows we restyle (currently only User Configuration) are tagged `.stonetop-themed` by the
  allowlist in `module/utils/window-theme.js`. Nothing untagged is touched.

### Cards

The shared recipe (move cards, invocation cards, special possessions):

```css
border: 1px solid var(--color-border-light-2);
border-radius: var(--st-radius);
padding: 8px 12px;
background: linear-gradient(var(--st-card-fill), var(--st-card-fill)), var(--st-card-veil);
/* header inside: */
border-bottom: 1px solid var(--st-card-rule); padding-bottom: 5px; margin-bottom: 4px;
```

Variants that exist for a reason:

- **Steading card** (`.steading-card`, also the relationships panel): a larger container —
  `--st-radius-lg`, `padding: 10px 14px 12px`, a 3.5% ink wash, a 10% ink border. It declares
  `--st-surface` so cut-outs drawn on it match.
- **Follower card**: opaque paper with a tinted header band and `--st-radius-lg`; beasts,
  livestock and custom followers add a 3px left edge.
- **Nested cards** (GM Toolkit entries): rule only, no fill. A third box deep gets no wash.
- **Threat / site / hazard cards and love letters**: their own parchment (`--tc-paper`, `--tc-ink`,
  `--tc-rule`) because they are props, not sheet furniture. Their accent arrives inline as
  `--threat-accent-raw` and the stylesheet derives `--threat-accent` from it.

### Headings and labels

- **Section heading on a sheet**: `<h3 class="stonetop-move-group-title">` from
  `templates/actor/partials/section-heading.hbs` — bold, upright, with core's maroon heading
  underline. Use the partial; it also carries the search field and edit pencil slots.
- **Heading inside a card**: `h3.steading-list-heading` — `--st-fs-xl`, bold, with a 12% ink
  hairline beneath. The maroon rule stays outside cards.
- **Eyebrow label**: `--st-fs-xs`/`sm`, bold, uppercase, tracked (`.steading-stat-label`,
  `.stonetop-follower-section-heading`).
- **Stat label**: small caps, bold, at the floor size.

### Boxes for numbers

Stats, vitals and the name plate are **octagons**: a 2px frame made by padding a
`--color-border-dark` box and clipping both it and its `--stonetop-bg` inner with a corner cut
(8px outer, 6px inner). Reuse `.stonetop-stat-box`, the vitals `.cell`, or
`.stonetop-follower-hp-octagon` (`--oct-cut`) rather than drawing another.

### Lists

- Every list the system renders uses a **spiral bullet**, not the browser's disc
  (`tests/styles/spiral-bullets.test.js`):

  ```css
  li { position: relative; padding-left: calc(var(--stonetop-bullet-size, 10px) + var(--stonetop-spiral-gap)); }
  li::before { content: ""; position: absolute; left: 0;
    top: calc((1lh - var(--stonetop-bullet-size, 10px)) / 2 - var(--st-caps-lift));
    width: var(--stonetop-bullet-size, 10px); height: var(--stonetop-bullet-size, 10px);
    background: var(--stonetop-spiral-icon) no-repeat center / contain; opacity: 0.55; }
  ```

  Write the `top` formula out in each rule; the test checks for it.
- **"Add a row"** is a full-width dashed button: `.steading-list-add` (or one of its siblings) —
  `1px dashed var(--color-border-light)`, `--st-radius`, transparent, `--st-fs-xs`, a `fa-plus`
  then the label, hover `var(--st-on-dark-raised, hsl(210 10% 92%))`.

### Tables

The residents table is the model: a `--st-radius-lg` frame with a 12% ink border; a header band
(8% ink wash, bold uppercase `--st-fs-sm`, 2px rule beneath); rows at least 32px tall, divided by
6% ink hairlines. No zebra striping and no row hover fill.

---

## 7. Controls

### Buttons

Four skins. Pick one; do not restate its colours in a new rule.

| Skin | Class | Look | Use |
|---|---|---|---|
| **Primary** (slate solid) | `.stonetop-cta`; `.stonetop-guide-btn--primary` in a guide's nav; any button in `.stonetop.dialog .dialog-buttons` | `--st-btn-primary-*`, weight 600, `--st-radius-sm`, `padding: 4px 14px`, min-height 32px | The one thing the window is for |
| **Secondary** (paper outline) | `.stonetop-guide-nav button`, `.stonetop-cf-mini-btn`, `.stonetop-camp-inline-btn` | `1px solid var(--color-border-dark)`, fill `--stonetop-bg`, hover `--st-on-dark-hover` | Back, Cancel, a neutral action beside a primary |
| **Inline** (slate outline, small) | `.stonetop-inline-btn` | transparent, `--st-slate-rule` border, `--st-quiet-ink`, `--st-fs-xs`, `padding: 2px 8px` | An action inside a card or row (Spend, Pay cost) |
| **Add** (dashed) | `.steading-list-add` and siblings; `.stonetop-add-chip` for the pill form | dashed border, transparent | Adding an entry to a list |

- **Destructive**: `.stonetop-dialog-btn--danger` on a dialog's confirm, `.stonetop-inline-btn--danger`
  inline, `.stonetop-cf-mini-btn--danger` for a boxless ✕. All paint from `--st-red-*`. Red is for
  what cannot be taken back; an action its neighbour undoes stays plain.
- **Icon-only**: no box at rest, muted ink, and a visible hover (a 6% ink wash, or `--st-red-bg`
  for a remove). Needs an `aria-label` and a `data-tooltip`.
- **Chat cards**: `.card-buttons button` (tan, uppercase) for secondary actions; the roll's main
  follow-up ("Roll your damage") is slate.
- Core gives every button in a V1 window `width: 100%`, `line-height: 28px` and
  `transition: all 0.5s`. The shared classes undo all three; a hand-rolled button has to as well.
- Icon first, then the label. Buttons name what they do (section 8).

### Buttons beside a field

Any row with a button next to an input or select is a **`.stonetop-field-btns`** row; the buttons
stretch to the field's height and never set their own (`tests/styles/field-btns.test.js`). Square
steppers read a per-row `--st-square` for both the input's height and the button's width.

### Fields

There is deliberately no global input skin. A field on the sheet is bare text on the page with a
slate focus glow. A field in a form or dialog is a **well**:

```css
background: rgb(var(--st-paper-rgb) / 0.7);
border: 1px solid var(--st-on-dark-rule, #999);
border-radius: var(--st-radius-sm);
padding: 4px 8px;
/* :focus */ border-color: var(--st-btn-primary-border); box-shadow: 0 0 4px var(--color-shadow-highlight);
```

Use `.stonetop-cf-input` / `.stonetop-cf-textarea` with a `.stonetop-cf-label` (column, 4px gap,
`--st-fs-sm`, weight 600, `--st-text-secondary`). Placeholders are `--st-text-muted`, italic, and
vanish on focus. Read-only state is `.stonetop-readonly` on an ancestor.

### Checks, radios, marks

- **Checkbox**: the SVG-skinned box, `--st-check-size` square (15px × scale). Use
  `class="stonetop-check"`. A checkbox with a class that is not in the master selector list falls
  back to the browser's own box, and `tests/styles/checkbox-skin-coverage.test.js` will say so.
- **Radio**: native with `accent-color: var(--st-accent-fill)`, or the drawn 13px slate ring whose
  checked state is `radial-gradient(circle, var(--st-accent-fill) 0 44%, transparent 48%)`.
- **Game marks** are glyphs, not form controls in disguise: ◇ diamonds for load and uses, ○
  circles for holds and tracks, blood drops on two arcana. They read `--stonetop-diamond-icon` and
  friends so the dark pages can swap the art. In prose use `.stonetop-glyph` (never italic).
- **Toggle switch**: `.stonetop-toggle-track` (36×20). **Segmented choice**:
  `.stonetop-segmented-picker`; the chosen segment takes `--st-btn-primary-bg` with
  `--st-btn-primary-text`.

### Chips, pills, tags, badges

| Kind | Shape | Class |
|---|---|---|
| Roll chip (`+STR`) | outline, `--st-radius-sm` | `.stonetop-move-roll-chip` |
| Tag / trait / filter / reminder | pill, `999px` | `.stonetop-follower-tag`, `.stonetop-reminder-chip`, `.stonetop-cf-tag` |
| Status (Dead, Condemned, NPC) | pill, uppercase, pinned height | `.stonetop-dead-tag`, `.stonetop-condemned-tag` |
| Count | 18px disc | `.stonetop-condemn-count` |

Centring is not optional and not done by eye (`tests/styles/chip-centring.test.js`):

- A **text-only chip** trims its own line box:
  `text-box: trim-both cap alphabetic; padding: calc(1px + var(--st-trim-top)) 8px calc(1px + var(--st-trim-bottom));`
- A chip with an **icon or a count** is `inline-flex; align-items: center`, its label is wrapped in
  **`<span class="stonetop-chip-text">`** (which takes the trim), and its icon is sized
  `round(1em, 1px)`.
- A chip whose words are **lowercase by convention** (follower tags) trims to `ex` and pads with
  `--st-trim-ex-top` / `-bottom`.
- No per-chip pixel nudges.

### The edit pencil

Editable sections show a pencil only on hover: `.stonetop-section-edit` at opacity 0, fading to
0.5 after `--st-edit-reveal-delay` when its section is hovered and to 1 under the pointer; shown
at 0.5 always on touch (`@media (hover: none)`). The matching confirm is `.stonetop-section-done`.
The glyph is `fa-pencil`.

### States

| State | Treatment |
|---|---|
| Hover, on a slate thing | `--st-btn-primary-bg-hover` |
| Hover, on a pickable surface | `--st-slate-hover-bg` (+ `--st-slate-hover-border`) |
| Hover, on a paper button or row | `--st-on-dark-hover` / `--st-on-dark-raised` fallbacks, or a 6% ink wash |
| Selected (one of a set: tab, filter, segment) | `.is-active` — slate fill, `--st-btn-primary-text` |
| Chosen (an option you have taken) | `.is-selected` / `.is-checked` — the green family, or a slate border |
| Disabled control or option | `opacity: 0.4`, and `cursor: not-allowed` on a button; a disabled primary also drops its slate fill. A control that is locked but must still read keeps `opacity: 1`. |
| Disabled check or mark | `opacity: 0.35` (the master skin's) |
| Focus | `outline: 2px solid var(--st-btn-primary-border); outline-offset: 2px` on `:focus-visible` (text fields keep the glow instead). Never the primary *fill* token: it is darker than the page on Lamplit, and the ring disappears. An inset ring (`outline-offset: -2px`) is right inside a container that clips. |

---

## 8. Dialogs and guided windows

### Getting the skin

| Window | How |
|---|---|
| AppV1 `Dialog` | `new Dialog({...}, { classes: ["dialog", "stonetop", "stonetop-<name>-dialog"] })` |
| `DialogV2` | `classes: themedDialogClasses("stonetop-<name>")` from `module/utils/window-theme.js` |
| A question with named answers | `askWithButtons()` / `confirmOutcome()` from `module/utils/ask-with-buttons.js` (the `.stonetop-ask` window: one full-width button per answer) |
| A custom `Application` | include `"stonetop"` in `defaultOptions.classes` |

A dialog opened without these comes up in Foundry's own chrome. There is no global hook that
catches it.

### Footer buttons

- **Buttons name the outcome they commit**: "Spend 1 Surplus, clear Malcontent", "Stand the muster
  down" — not "OK" / "Yes". Don't use `Dialog.confirm`, which hard-wires Yes/No.
- The affirmative sits on the **left**, the dismissive (`cancel` / `no` / `close`) on the right.
  The stylesheet orders them by `data-button`.
- Footer buttons are slate, at least 32px tall, and wrap a long label with normal leading. A
  per-dialog override of `display`, `align-items`, `justify-content`, `min-height` or `line-height`
  must carry the `.vtt .stonetop.dialog` scope or it silently loses
  (`tests/styles/dialog-button-specificity.test.js`).
- The destructive confirm takes `stonetop-dialog-btn--danger`.

### Guided windows

Walk-throughs (Welcome, Introductions, Spring, Seasons Change, Share) share the **guide shell**:
`.stonetop-guide-split` → `.stonetop-guide-toc` (a 168px rail; the current step is bold green) +
`.stonetop-guide-main` (padding `12px 20px 16px`, 12px gap) containing a `.stonetop-guide-banner`
(icon, title, italic sub-line) and ending in `.stonetop-guide-nav` (Back on one end, the
`.stonetop-guide-btn--primary` on the other, with `.stonetop-nav-arrow` glyphs).

Character creation and level-up have their own chrome (`.stonetop-onboarding-*`,
`.stonetop-levelup-*`): a slate header band with progress dots, an uppercase slate step title, an
italic hint, then option cards (`padding: 8px 10px`, 2px border, slate when hovered or selected).
New steps in those flows reuse those classes.

---

## 9. Chat cards, journal pages, HUD

- **Chat cards** are built by `module/utils/chat.js` as
  `<section class="pbta-chat-card stonetop-roll-card">`. The message gets the paper, a
  `--st-radius-lg` corner and body ink only because it contains that class. Every chat selector is
  prefixed `:is(#chat, #chat-notifications, #chat-popout)`. A plain chat message keeps core's look,
  so **never put Stonetop-tokened markup in a message without the card wrapper** — on the dark
  pages its ink would turn bone on core's light parchment.
- **Tier ladder**: `ul.stonetop-move-tiers` with `--st-tier-*-text` labels in a
  `--st-tier-label-width` column; the rolled rung gets a 10% wash and an inset 3px edge. The result
  block has a 5px left edge in the tier's colour.
- **Journal pages** (bestiary, threats, sites, the timeline) carry their own page classes. Printed
  book art gets the warm `--st-art-frame`, which deliberately stays paper-coloured on the dark
  pages.
- **HUD** (the season banner under the top edge, the fight ring round a token, the letter notice):
  drawn over the map rather than on paper, so they keep fixed colours through every palette and
  have their own tokens (`--stonetop-banner-*`, `--stonetop-fight-ring-*`). Name such tokens
  `-lettering` / `-paper`, not `-ink`: the palette tests measure every `-ink` against the sheet's
  page.
- **Pop-overs and tooltips** on the paper use `var(--st-on-dark-raised, #fffdf7)` with a
  `--st-radius-lg` corner.
- **Hover help is Foundry's tooltip, never a native `title`.** A `title` is drawn by the operating
  system and ignores the palette and the Sheet Text Size. Core draws a plain `data-tooltip` as
  HTML, so there are two spellings: **`data-tooltip`** for words we wrote or a `{{localize}}` of a
  key we ship, and **`data-tooltip-text`** for anything printed from data (a name a player typed).
  In JS set the attribute the same way; do not write `.title`.

---

## 10. Palettes and accessibility

Everything in this table is per player, and is a class or a custom property on `<html>` set from
`module/settings.js`:

| Setting | Class / property | What it does |
|---|---|---|
| Sheet Font | `--font-stonetop`, `--st-caps-nudge` | Signika / Libre Caslon Text / IM Fell English |
| Sheet Text Size | `--stonetop-font-scale` | 0.9–1.4× |
| Page: Lamplit | `.stonetop-dark` | Warm brown-black page, bone ink. Panels are a step **lighter** than the page. Primary buttons go near-black with a bone rule. |
| Page: Slate | `.stonetop-dark.stonetop-slate` | Lamplit with the warm tokens re-pointed cool. Hues unchanged. |
| High Contrast | `.stonetop-high-contrast` | Worn over any page. Every ink to 7:1, visible focus ring, underlined links, heavier hairlines. |
| Paper Texture | `.stonetop-no-texture` (+ fade) | Removes the grain and changes no colour. |
| No Italics | `.stonetop-no-italics` | All italics upright. |
| Reduce Motion | `.stonetop-reduce-motion` | Zeroes durations; hides hover image pop-ups. |

And one that is not a setting: **`.stonetop-past-death`**, the sheet (and chat cards, and dialogs
opened from the sheet) of a character who came back. The paper is inverted to black and that scope
re-declares the ink ramp, the families, the tier inks and the card tokens for itself.

What that means for a new component:

- **Read tokens and it works everywhere.** That is the whole method.
- **A surface that repaints its background for dark** is written as
  `:where(:root.stonetop-dark) <the original selector, verbatim> { … }` inside the dark section.
  Zero added specificity: it wins by coming later, and anything already more specific (a love
  letter, the black paper) keeps its own look.
- **Fixed near-black art** (a spiral, a checkbox, a diamond) is either a `mask` painted in
  `currentColor`, or a `background-image` read from a `--stonetop-*-icon` token that has a
  `-light.svg` twin for the dark pages. Never a bare `url()` to black art.
- **A token the dark or black-paper scopes don't name inherits its white-paper value.** If you add
  a token that carries ink, add it to `:root.stonetop-dark`, to the dark + high-contrast block, to
  the high-contrast block and to `.stonetop-past-death`.
- **File order matters.** The dark section sits before the accessibility block; the
  high-contrast block is last in the file, and only `:root.stonetop-…` rules may follow it.
- **Anything a setting writes as an inline style on `<html>`** (font, scale, caps nudge, veil
  strength) cannot be re-pointed by a palette class.

---

## 11. Icons and glyphs

- Font Awesome, solid, written **`<i class="fas fa-name" aria-hidden="true"></i>`**. Use the
  current (v6) names: `fa-xmark`, `fa-trash`, `fa-circle-check`, `fa-circle-info`,
  `fa-triangle-exclamation`, `fa-rotate-left`, `fa-floppy-disk`.
- One glyph per meaning: **`fa-pencil`** edit · **`fa-xmark`** remove from a list or close ·
  **`fa-trash`** delete for good · **`fa-plus`** add · **`fa-check`** done ·
  **`fa-dice-d6`** roll (the game rolls d6s) · **`fa-rotate-left`** reset / undo.
- Decorative icons are `aria-hidden="true"`, in templates and in markup built in JS alike.
- A control that holds only an icon has an **`aria-label`** saying what it does (usually the same
  words as its tooltip). One that is not a control at all, like the fading "done" check, is
  `aria-hidden` itself.
- A button that *is* the icon element (`<button class="fas fa-xmark">`) must not be given our serif;
  the `:not([class*="fa-"])` guard on the base button rule exists for that.
- The book's own marks (spiral, diamond, circle, blood drop, playbook arrow, season glyphs, tab
  icons) are SVGs under `assets/icons/`, reached through `--stonetop-*-icon` tokens.

---

## 12. Naming and CSS authoring

### Class names

- **`stonetop-<area>-<part>`**, hyphenated all the way down: `stonetop-follower-section-heading`.
  The steading sheet uses `steading-<part>`.
- **Modifier**: `--variant` (`stonetop-follower-card--beast`, `stonetop-inline-btn--danger`).
- **State**: `is-<state>` (`is-active`, `is-selected`, `is-checked`, `is-collapsed`).
- No new short prefixes (`cm-`, `wd-`, `ct-`, `st-`) and no new `block__element` names. The ones
  that exist came with the threat cards and the monster and wound builders; leave them, don't
  extend the pattern.
- Per-window scope class: `stonetop-<name>-dialog`.

### Writing the rule

- **One stylesheet, unlayered.** Core's rules live in `@layer`, so ours win at any specificity.
  Don't add layers.
- **Scope to our own roots.** Global selectors (`body`, `.app`, `.dialog`) restyle other modules.
- **A default that should lose** goes in `:where()` (zero specificity). **A rule that must beat a
  shared one** carries the shared rule's scope; moving it later in the file does not help when the
  difference is specificity.
- **`!important` is a last resort with a comment** saying what it has to beat. The sanctioned uses
  are the master checkbox skin, the `.stonetop-field-btns` stretch, the primary fill on
  `.stonetop-cta`, and the No Italics / Reduce Motion blankets.
- **State a fill once.** If two classes wear the same skin, put them in one selector list rather
  than two rules that will drift.
- **Comment the why.** Lead with the reason the rule exists or the trap it avoids, name the test
  that guards it, and date a decision that was the user's call. A rule whose reason is obvious
  needs no comment.
- **Tabs, LF, final newline** (`.editorconfig`). One declaration per line.
- **Inline styles are for data only** — a position, a per-item custom property
  (`style="--threat-accent-raw: {{accent}}"`), a measured width. Never a colour, size or spacing
  decision. An inline colour is handed over as a raw custom property and the stylesheet derives the
  painted one from it, so the dark pages can still adjust it.
- **No colours in JS** except data palettes that a test ties to the stylesheet (timeline kinds,
  relationship-map inks, threat stones).

---

## 13. The tests that hold this

`npm test` (or `npx vitest run tests/styles`). The ones you are most likely to meet:

| Test | Holds |
|---|---|
| `font-floor` | No text under 0.95× body; exemptions by exact selector |
| `token-literals` | Washes on the ink and slate channels; rem sizes scaled; radii, slate edges and pop-over rungs on tokens; one disabled opacity; focus rings the dark pages can see |
| `templates/icon-conventions` | `fas`, current glyph names, the pencil for edit, `aria-hidden` on a bare icon (templates and JS), an `aria-label` on an icon-only control |
| `templates/tooltip-conventions` | No native `title` in a template, outside a shrinking list of those not yet converted |
| `dark-mode` | Lamplit and Slate contrast; no near-black ink or white well left for the dark page; lifts have fallbacks |
| `high-contrast` | 7:1 inks; block sits last; no bare `slategrey` ink or fill; core names on window roots |
| `past-death-inks` | Black-paper sheets re-declare the inks they need |
| `chip-centring`, `status-pills` | Chips trim to caps; no hand nudges; pills share one height |
| `checkbox-skin-coverage`, `radio-reset` | Every checkbox class is in the skin; radios lose core's 2px drop |
| `field-btns` | Buttons beside a field sit in a `.stonetop-field-btns` row |
| `dialog-button-specificity`, `dialog-danger-button` | Footer overrides carry the shared scope; the red confirm reads `--st-red-*` |
| `spiral-bullets` | No list draws the browser's disc; bullets seat on the first line |
| `caslon-metrics`, `glyph-baseline` | Font metric overrides; glyph boxes sit on the baseline |

When you add a guard, follow their pattern: derive the answer from the values in the file rather
than from a comment, exempt by exact selector, and include a check that the scan found something.

---

## 14. Known gaps

What is left from the audit of 2026-11-19 (system 1.8.5), after two passes of fixes. Each is a
place the system does not yet follow this guide, left because it is a refactor that wants checking
in a live world, or a choice between two looks that is a design call. Counts are approximate;
delete an entry when it is done.

**Colour**

1. **Selected has no single fill.** `.is-selected` is green in one window, a slate rim in another
   and gold in a third. Section 7 describes both green and slate as allowed; choosing one means
   repainting character creation or the foundry-style forms.
2. **Three hand-mixed reds** remain as borders (`rgba(140, 0, 0, 0.35–0.4)`) beside the
   `--st-red-*` family.
3. **`--st-slate-rule` and `--st-slate-rgb` are not re-pointed by any palette.** They render as
   they always did. On Lamplit and Slate the hover wash token goes to bone while these stay slate;
   whether they should follow is a look to judge on screen, not in a diff.
4. **Four washes are literal black on purpose**, on grounds that don't turn with the page. Listed
   in `token-literals.test.js`.

**Type**

5. **The classic tab strip sizes its labels from core's `--font-size-16`** inside a container-fit
   `clamp()`, so it does not follow the Sheet Text Size. Scaling it risks overflowing the strip.

**Controls**

6. **The primary fill is restated in roughly 45 per-window rules** instead of wearing
   `.stonetop-cta`, with small differences in padding and radius. Folding them in changes each
   button's box and needs every one looked at.
7. **The field "well" is written out three times** (`.stonetop-themed`, `.stonetop-cf-input`, the
   struggle window).
8. **No shared class for a quiet icon-only button**; five windows each draw their own.
9. **Focus-ring offsets vary** (2px, 1px, -2px). The colour is one token now; the offsets depend
   on each control's surroundings.

**Markup**

10. **Native `title` tooltips remain in 10 templates** (19 of them: the arcanum editor and
    nine dialogs), and in a handful of markup strings and `.title =` writes in JS (the attack
    flow's 19, the ledger window, the book reader). The character, NPC, monster and Steading
    sheets, every partial they draw, the bestiary and location journal pages, Death's Door, the
    people gallery and the welcome guide are done. The list is `PENDING` in
    `tests/templates/tooltip-conventions.test.js`; convert a window and the code that rewrites
    its tooltips in one change, then take it off the list. The draggable improvement and threat
    cards in journal prose carry a `title` too, and are a change of their own: the markup is
    baked into the lore and location packs (7 pages) as well as built in
    `steading-improvement-cards.js` and `threat-seed-cards.js`, and stored journal HTML goes
    through core's editor, so check there that a `data-tooltip` survives a save.
11. **About 195 `data-tooltip` attributes print a value from data**, which core draws as HTML.
    Most print strings the system builds. Any that can carry text a player typed should be
    `data-tooltip-text`; they have not been sorted one from the other.
12. **Icon-only controls built in JS** are not checked for an `aria-label`, and `fa-solid` remains
    where a class string is handed to a Foundry API (header controls, context menus), which is
    core's own spelling.

**Naming**

13. **Legacy prefixes** — `cm-`, `wd-`, `ct-`, `asm-`, `st-treasure-`, and BEM
    `threat-card__edge` style names in the threat, site, hazard, monster-builder and wound-builder
    blocks. Renaming them touches templates, JS and tests for no visible change.

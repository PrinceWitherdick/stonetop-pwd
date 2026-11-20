# Handoff: what is left of the tooltip conversion

A brief for whoever picks this up next. It is written to be read cold: nothing here assumes the
conversation that produced it. Delete this file in the change that finishes the work.

State as of commit `fe042f6e` on branch `claude/quirky-allen-md0rfb` (2026-11-20). Line numbers
below are from that commit and will drift; search for the quoted text.

## The job

Replace every native `title` tooltip with Foundry's own. A `title` is drawn by the operating
system, so it ignores the reader's palette and their Sheet Text Size, and it never shows on a touch
screen. This is gap 10 under "Known gaps" in [STYLEGUIDE.md](STYLEGUIDE.md); the rule itself is in
the guide's "Chat cards, journal pages, HUD" section ("Hover help is Foundry's tooltip").

Read `CLAUDE.md`, that section of the guide, and the comment at the top of
`tests/templates/tooltip-conventions.test.js` before changing anything.

Two spellings, and choosing between them is the only judgement in most of this work:

- `data-tooltip` for words we wrote, or a `{{localize}}` / `localize()` of a key we ship.
- `data-tooltip-text` for anything printed from data: a name a player typed, a homebrew item's
  title. Core draws a plain `data-tooltip` as HTML, so a typed name in one is an injection path.

A string we build that *contains* a typed name (`format(key, { name })`) counts as data.

## Done so far

Four slices, one commit each: the character sheet and its 50 partials, the NPC and monster sheets,
the Steading sheet with its Add Resident dialog, and the bestiary and location journal pages.
`git log --grep="Tooltips,"` shows the last three; read one for the shape of a slice.

## How a slice goes

1. Pick one window: its template(s) and the module that renders them.
2. In the template, rename each `title=` attribute. Do not touch `title=` inside a `{{> partial}}`
   call: that is a hash argument, not an attribute. `<iframe>` and `<abbr>` keep theirs.
3. Search the window's module for code that reads or writes those tooltips and move it in the same
   change. To clear one, `removeAttribute("data-tooltip")`; an empty string is still an attribute.
4. Take the template off `PENDING` in `tests/templates/tooltip-conventions.test.js` and add the
   window to the sentence in that file's header comment.
5. Update the counts and the list of what is left in gap 10 of `STYLEGUIDE.md`.
6. `npm run lint`, then `npx vitest run tests/templates tests/styles`, then `npm test` (about three
   minutes). If another test fails, read what it protects before changing either side.
7. Commit as "Tooltips, Nth slice: <the window> uses Foundry's tooltips", with a body that says how
   many titles moved, which spelling and why, what code moved, and the counts left.

To list what remains, with the tag and the raw value of each title:

```bash
node --input-type=module -e '
import { openingTags, templateSources } from "./tests/fakes/hbs.js";
for (const { rel, source } of templateSources()) {
	const tags = openingTags(source).filter(t => !["iframe", "abbr"].includes(t.name) && t.attrs.some(a => a.name === "title"));
	if (!tags.length) continue;
	console.log(`\n${rel} (${tags.length})`);
	for (const t of tags) console.log(`  <${t.name}> ${t.attrs.find(a => a.name === "title").raw}`);
}'
```

## Traps found so far

- **A `title` was also the control's spoken name of last resort.** A `data-tooltip` is not. Any
  `<input>`, `<select>` or icon-only button that has a `title` but no visible label and no
  `aria-label` needs an `aria-label` with the same words in the same change. Known cases: the
  ledger's `stonetop-ledger-noun` select, the arcanum editor's `stonetop-arc-req-max` and
  `stonetop-arc-req-slug` inputs. `tests/templates/icon-conventions.test.js` checks icon-only
  controls in templates but not inputs.
- **A test that asserts "no `data-tooltip`" on a block of markup** will fail once a button inside
  it gains one. `tests/actors/steading/steading-assets-taken.test.js` did; the fix was to assert on
  the element the test is about, not to weaken it.
- **Markup stored in a document is not ours to rewrite freely.** Anything baked into a pack page or
  saved into a journal or chat message keeps its old `title` until it is regenerated, and stored
  HTML passes through core's editor. See "Held back" below.
- **`module/journal/journal-image-titles.js` sets a `title` on purpose**, for the length of one
  synchronous read by core, then removes it. It is not a tooltip. Leave it, and allow-list it if
  you write a guard for JS.
- **A tooltip on an element that is swapped out or re-rendered hangs** until the pointer moves.
  `module/utils/tooltip-handoff.js` is the one place that deals with it; use it instead of writing
  another.
- **Tooltips on disabled buttons** are already used (`module/camp/CampWindow.js`), so a disabled
  control may carry one.
- The test counts *tags*, not attributes. One tag in `arcanum-sheet-edit.hbs` carries a `title` in
  each branch of an `{{#if}}`; both need converting.

## What is left in templates: 13 templates, 43 tagged elements

No module was found writing these titles from code (searched for `.title =`, `setAttribute("title"`
and `title=` in markup strings), but check each window's module again as you take it.

| Template (`templates/…`) | Titles | Rendered by (`module/…`) | Notes |
|---|---|---|---|
| `dialogs/deaths-door.hbs` | 8 | `actors/character/dialogs/DeathsDoorDialog.js` | Four `{{localize}}`: `data-tooltip`. Four print a value: `this.description` (debilities), `scalesOffer.title` (built with an arcanum's name, which can be homebrew), `this.title` on the plus-one buttons (built near "`title: tip`"), `outstandingLabel` (from `post-death-choices.js`). Trace each to its source; anything carrying a name is `data-tooltip-text`. |
| `dialogs/people-gallery.hbs` | 10 | `actors/steading/PeopleGalleryDialog.js` | Nine are our words. The portrait tile prints `{{this.name}}` and `{{this.usedBy}}` (people's names): `data-tooltip-text`. Two buttons are `disabled`. |
| `dialogs/welcome.hbs` | 6 | `dialogs/WelcomeDialog.js`, `SpringBurstDialog.js`, `FoundryBasicsDialog.js` | One template, three windows. All our words, including the `{{#if active}}Online{{else}}Offline{{/if}}` dot, which is a status with no text: give it a spoken name too. |
| `item/arcanum-sheet-edit.hbs` | 5 | `item/StonetopArcanumSheet.js` | `this.hint` comes from a constant list in the sheet (our words). Two inputs need `aria-label`s (see traps). |
| `dialogs/character-onboarding.hbs` | 3 | `actors/character/dialogs/CharacterOnboardingDialog.js` | Our words. |
| `dialogs/playbook-import-review.hbs` | 3 | `playbooks/PlaybookImportReview.js` | Our words (undo, redo, reset). |
| `dialogs/expedition.hbs` | 2 | `dialogs/ExpeditionDialog.js` | Our words. |
| `dialogs/companion-setup.hbs` | 1 | `actors/character/dialogs/CompanionSetupDialog.js` | Same words as one in character-onboarding. |
| `dialogs/background-neighbors.hbs` | 1 | `actors/character/dialogs/BackgroundNeighborsDialog.js` | Our words. |
| `dialogs/possession-choices.hbs` | 1 | `actors/character/dialogs/PossessionChoicesDialog.js` | A lock `<i>` whose title is its only meaning ("Already chosen"). Read the guide's icon rules: it needs `aria-hidden` plus the meaning carried some other way. |
| `dialogs/introductions.hbs` | 1 | `dialogs/IntroductionsDialog.js` | Our words. |
| `dialogs/arcana-inspire.hbs` | 1 | `item/StonetopArcanaInspireDialog.js` | Our words. |
| `dialogs/weather.hbs` | 1 | `dialogs/WeatherDialog.js` | Our words; contains `&rsquo;`, which is fine in a `data-tooltip` since core draws it as HTML. |

Suggested order: Death's Door; the people gallery; the welcome guide; the six character-creation
and small dialogs together; then expedition, weather, the import review and the arcanum editor.

## What is left in JS

Nothing guards these yet. When they are done, add a test beside `tooltip-conventions.test.js` that
fails on `.title =` on an element and on `title=` in a markup string under `module/`, with
`journal-image-titles.js` as its one stated exception.

| File (`module/…`) | What | Notes |
|---|---|---|
| `combat/attack-flow.js` | 19 `.title =` writes | The big one; give it a slice of its own. Several values are `gate.refused` or a `label` passed in: trace what they can contain. `otherConfirms` formats in a user's name: text. One write clears with `b.title = ""`: remove the attribute instead. Some of these controls are disabled when the tooltip is set. |
| `utils/ledger-dialog.js` | 4 `title=` in markup strings | The select and the two labels wrap controls: check each has a spoken name. |
| `books/reader-bookmarks-tab.js` | 4 `.title =` writes | All `localize()` of shipped keys. |
| `utils/journal-roll-tables.js` | 1 `.title =` write | Prints a dice formula read from a journal table: text. |
| `utils/roll-engine.js` | 1 `title=` in `DESC_TOGGLE_HTML` | Find out whether this markup is saved into the chat message. If it is, old messages keep the old attribute and that is acceptable; say so in the commit. |

## Held back: needs the owner and a live world

The draggable "Steading Improvement" and "Threat" cards in journal prose carry
`title="Drag onto …"`. Do **not** convert these as part of a routine slice. The markup exists in
three places that must agree: built at runtime in `module/journal/steading-improvement-cards.js`
and `module/threats/threat-seed-cards.js`, baked into seven pages under `packs/src/` by a generator
that is not in this repository, and refreshed by a migration (`tests/migration/improvement-refresh.test.js`).
Stored journal HTML also goes through core's editor, and nobody has checked that a `data-tooltip`
on a `<div>` survives a save there. Raise it with the owner; it wants a decision and a check in
Foundry.

## After the titles are gone

- Delete gap 10 from `STYLEGUIDE.md`, empty `PENDING` (keep the test: it then forbids any new
  `title`), and delete this file.
- **Gap 11** is the natural next job and is the same judgement at scale: about 195 existing
  `data-tooltip` attributes print a value from data and have not been sorted into text and HTML.
  One known case: the taken-asset name in `templates/actor/partials/steading-tab-overview.hbs`
  prints `{{this.takenTooltip}}`, which contains an expedition's title or a character's name, so it
  should be `data-tooltip-text` (and `steading-assets-taken.test.js` asserts the current spelling).
  For each, trace the value: built only from our own strings, leave it; can carry typed text,
  change the spelling; deliberately HTML, leave it and say why in a comment.
- **Gap 12**: icon-only controls built in JS are not checked for an `aria-label`.

Gaps 1 to 9 in the guide are not for delegation as they stand: each is a choice between two looks
or a refactor that changes every button's box, and needs to be judged on screen.

## What none of this has had

No slice so far has been looked at in a running Foundry world; the checks were lint and the test
suite. The conversion is mechanical and the risk is low, but a pass over the converted windows in
a live world (hover each control, in a dark palette and at a larger Sheet Text Size) is still owed.

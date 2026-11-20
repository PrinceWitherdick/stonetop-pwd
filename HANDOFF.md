# Handoff: after the tooltip conversion

A brief for whoever picks this up next, written to be read cold. Delete this file once the items
below are done or have moved into [STYLEGUIDE.md](STYLEGUIDE.md)'s Known gaps.

State as of the eleventh tooltip slice on branch `claude/quirky-allen-md0rfb` (2026-11-20).
`git log --grep="Tooltips,"` shows every slice; read one for the shape of the work.

## Done

Every native `title` tooltip in a template and in JS is now Foundry's own (`data-tooltip` for our
words, `data-tooltip-text` for anything carrying data). Two tests forbid new ones; read the comment
at the top of each before changing either side:

- `tests/templates/tooltip-conventions.test.js`: templates. `PENDING` is empty and stays empty.
- `tests/templates/js-tooltip-conventions.test.js`: modules. Deny-by-default on `.title =`, with
  four stated exceptions, each with its reason.

Two exceptions keep their `title` for good: `journal-image-titles.js` (not a tooltip) and
`books/reader-bookmarks-tab.js` (built inside pdf.js's iframe, where Foundry's tooltip manager is
not loaded, so a `data-tooltip` there would show nothing).

## Held back: needs the owner and a live world

The draggable "Steading Improvement" and "Threat" cards in journal prose carry
`title="Drag onto …"`. The markup exists in three places that must agree: built at runtime in
`module/journal/steading-improvement-cards.js` and `module/threats/threat-seed-cards.js`, baked
into seven pages under `packs/src/` by a generator that is not in this repository, and refreshed
by a migration (`tests/migration/improvement-refresh.test.js`). Stored journal HTML also goes
through core's editor, and nobody has checked that a `data-tooltip` on a `<div>` survives a save
there. It wants the owner's decision and a check in Foundry. When it lands, take both files off
`EXCEPTIONS` in the JS test and delete gap 10 from the guide.

## Owed: a look in a running world

No slice has been looked at in a running Foundry world; the checks were lint and the test suite.
The conversion is mechanical and the risk is low, but hover each converted control once, in a dark
palette and at a larger Sheet Text Size. The ones most worth a look:

- Death's Door's footer (the clipped "Still to choose" line, the +1 buttons).
- A fight card's disabled Apply / Confirm buttons, and the Which-attack buttons after a refused
  pick reopens them (`setTip(b, "")` removes the tooltip).
- The welcome guide's online dot and possession choices' lock, which are now `role="img"` with an
  `aria-label`: check a screen reader names them.
- Old chat roll cards keep the native `title` on their "?" (the markup is saved into the
  message); new cards carry Foundry's.

## Next jobs

- **Gap 11** is the same judgement at scale: about 195 existing `data-tooltip` attributes print a
  value from data and have not been sorted into text and HTML. The one known case, the
  taken-asset name in `templates/actor/partials/steading-tab-overview.hbs` (an expedition's title
  or a character's name), is done: it is `data-tooltip-text`, and `steading-assets-taken.test.js`
  renders a title carrying markup to hold it there. For each of the rest, trace the value: built only from our own strings, leave it; can carry typed text, change
  the spelling; deliberately HTML, leave it and say why in a comment.
- **Gap 12**: icon-only controls built in JS are not checked for an `aria-label`. The tooltip
  work found two (the journal roll-table die, the roll card's "?") and fixed them; there will be
  more.

Gaps 1 to 9 in the guide are not for delegation as they stand: each is a choice between two looks
or a refactor that changes every button's box, and needs to be judged on screen.

# Stonetop for Foundry VTT

A FoundryVTT game system. One stylesheet (`styles/stonetop.css`), Handlebars templates in
`templates/`, ES modules in `module/`, tests in `tests/` (vitest).

## Before changing how anything looks

Read [STYLEGUIDE.md](STYLEGUIDE.md). The short version:

- Every colour, text size and corner radius is a token from `:root` at the top of the stylesheet.
  A literal written for white paper is wrong on the dark pages, in high contrast, or at a larger
  Sheet Text Size.
- Reuse the shared classes (section 7 of the guide) before writing a new button, chip, check or
  field skin.
- A window gets the look from `.stonetop` on its root: `classes: ["dialog", "stonetop", …]` for a
  `Dialog`, `themedDialogClasses()` for a `DialogV2`.
- Dialog buttons name the outcome they commit, not "OK" / "Yes".
- Icons are `<i class="fas fa-name" aria-hidden="true"></i>`; edit is `fa-pencil`.
- New class names are `stonetop-<area>-<part>`, `--modifier`, `is-state`.
- If you add a rule the guide does not cover, or find the stylesheet disagreeing with it, update
  the guide (and its Known gaps list) in the same change.

## Commands

```bash
npm test                      # everything (about three minutes)
npx vitest run tests/styles   # the style guards (seconds)
npm run lint
```

The style tests fail on most of the mistakes the guide warns about. When one fails, read the
comment at the top of the test file before changing either side: it says what the rule protects.

## Conventions

- Tabs, LF, double quotes (`.editorconfig`).
- Comments say why a rule exists or what trap it avoids, and name the test that guards it.
- Releases go through the `/release` command.

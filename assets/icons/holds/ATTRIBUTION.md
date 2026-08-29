# Hold Tray Glyph Attribution

The row of glyphs beside the steading header's title: what Stonetop is still owed, and what it
still owes. Which glyph is which is `HOLD_DEFS` in
`module/actors/steading/steading-holds.js`; the file each one points at is in
`styles/stonetop.css`.

Only UNRESOLVED things earn a glyph, and a glyph goes away when its thing resolves, so this set
is small on purpose. Instant effects, held pools (Favor, Blessing, Sanction and the rest) and
permanent passives are all deliberately absent; the reasoning is in the header comment of
`steading-holds.js`.

Icons sourced from [game-icons.net](https://github.com/game-icons/icons),
licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

Our filenames are named for the HOLD rather than for the drawing, so the game-icons.net source
name is listed for every one.

| Icon | Hold | game-icons.net source | Artist | Artist page |
|------|------|-----------------------|--------|-------------|
| fortunes-advantage.svg | Advantage held over the next +Fortunes roll | clover | Lorc | https://lorcblog.blogspot.com |
| muster.svg | The muster holds | swords-emblem | Lorc | https://lorcblog.blogspot.com |
| tors-blessing.svg | Tor's blessing, for the season | sunbeams | Lorc | https://lorcblog.blogspot.com |
| herd-advance.svg | The herd's growth, unclaimed this summer | barn | Delapouite | https://delapouite.com |
| inn-gathering.svg | The inn's gathering, unspent this season | beer-stein | Lorc | https://lorcblog.blogspot.com |
| standing-watch.svg | The watch's upkeep, unpaid this season | medieval-gate | Delapouite | https://delapouite.com |
| weapons-upkeep.svg | Weapons of War maintenance, unpaid this spring | anvil | Lorc | https://lorcblog.blogspot.com |
| militia-drill.svg | The militia's summer drills, unpaid | archery-target | Lorc | https://lorcblog.blogspot.com |
| herd-feed.svg | The herd's winter feed, unpaid | horse-head | Lorc | https://lorcblog.blogspot.com |
| winter-debt.svg | Winter's second consumption, still owed | hourglass | Lorc | https://lorcblog.blogspot.com |

No artwork above is altered. Every glyph is worn as a CSS *mask* tinted by `background-color`,
the same way the weather glyph beside them and the tab rail's icons are, so one file takes the
header's ink in both themes and the warmer "due" tone. That means each file must carry alpha
ONLY where the glyph is.

All ten were taken from the game-icons.net repository, where the drawings are stored INVERTED:
an opaque black background square under a white glyph, which as a mask resolves to a solid slab.
Their background square (and only that square) was punched transparent to match the export form
the weather set already uses: `<path d="M0 0h512v512H0z"/>` became
`<path d="M0 0h512v512H0z" fill="#fff" fill-opacity="0"/>`. The glyph path in each is untouched,
and the fetch asserted that exactly one square was replaced per file.

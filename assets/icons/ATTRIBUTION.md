# Interface Icon Attribution

## game-icons.net

Icons sourced from [game-icons.net](https://github.com/game-icons/icons),
licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

Where our filename differs from the original, the game-icons.net source name is listed too.

| Icon | game-icons.net source | Artist | Artist page |
|------|-----------------------|--------|-------------|
| broken-heart.svg | broken-heart | Lorc | https://lorcblog.blogspot.com |
| candle-light.svg | candle-light | Lorc | https://lorcblog.blogspot.com |
| enrage.svg | enrage | Delapouite | https://delapouite.com |
| gm-toolkit.svg | read | Skoll | https://game-icons.net |
| hearts.svg | hearts | Skoll | https://game-icons.net |
| landmarks/place-exit.svg | direction-signs | Delapouite | https://delapouite.com |
| landmarks/place-marker.svg | position-marker | Delapouite | https://delapouite.com |
| landmarks/place-peak.svg | peaks | Lorc | https://lorcblog.blogspot.com |
| move.svg | move | Delapouite | https://delapouite.com |
| scales.svg | scales | Lorc | https://lorcblog.blogspot.com |
| triquetra.svg | triquetra | Delapouite | https://delapouite.com |

`move.svg` recolours the glyph and sets it on the system's dark octagon token; the artwork
itself is unchanged.

`landmarks/place-marker.svg` is the pin every named place on the Vicinity and the World's End
map wears, `landmarks/place-exit.svg` is the signpost their edge-of-page arrows wear instead,
since those name a way off the map rather than a place on it, and `landmarks/place-peak.svg` is
the terrain symbol the World's End map's mountains wear: the two ranges it letters names across,
and the two places on it that are themselves mountain. As with `move.svg`, only the colour is
ours in all three: the outlines are upstream's, filled in the same cream and ink the lettered
discs beside them are drawn in so the whole set reads as one table's pins. Each original's
full-canvas backing square is deleted rather than recoloured, since it would otherwise paint an
opaque black tile on the map behind the drawing.

`place-peak.svg` carries a lighter stroke than its two siblings (14 against their 20), which is
the one place the three differ and is not a lighter pen. The other two are single silhouettes
drawn barely half the width of their box; the peaks are drawn 473 units of 512 wide with five
inner folds packed into them, so the weight that reads as one clean line around a teardrop closes
those folds up at the size these ship at. The file's own comment has the reasoning.

`gm-toolkit.svg` is the GM Toolkit actor's portrait. As with `move.svg`, only the ground under
the drawing is ours: the glyph is recoloured cream and set on the same black field over a cream
disc that the Book I creature marks in `bestiary/` and `followers/new-shoot.svg` wear, so the
GM's own sheet reads as one set with them in the sidebar. The outline itself is unchanged; the
recipe and its numbers are in the file's own comment.

## The project's own drawings

Not listed above, because they are the project's own work rather than third-party
assets: `treasures/vase.svg`, `arcanum.svg` and `landmarks/place-region.svg`. The first two are
redrawn from category symbols the rulebooks use — the treasure vase, and the triple spiral
printed beside an arcanum (Book II p.545). They are marks, not illustrations: neither reproduces
any book artwork, and neither depicts any particular item. `arcanum.svg` is generated geometry
(three Archimedean spirals at 120 degrees); the recipe and its numbers are in the file's own
comment.

`landmarks/place-region.svg` is the emptiest file here and owes nothing to anyone: one fully
transparent square and no drawing at all. It is what a REGION or a ROAD caption wears on the
regional maps, where a pin would be a lie (the Great Wood is not at a point, it is half the
map). Foundry has no way to draw a map note without an icon, so this stands in for one and
leaves the name lying over the country it names. The file's own comment has the reasoning.

## Font Awesome Free

`followers/new-shoot.svg` carries the "seedling" icon from
[Font Awesome Free](https://github.com/FortAwesome/Font-Awesome) 6.7.2 (solid), licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Copyright 2024 Fonticons,
Inc. As with `move.svg` above, our copy recolours the glyph and sets it on a disc; the
outline itself is unchanged. The upstream notice is kept inside the file, which is what
that licence asks for.

| Icon | Font Awesome source | Style | Licence |
|------|---------------------|-------|---------|
| followers/new-shoot.svg | seedling | Free, solid | CC BY 4.0 |

Two things worth knowing about this one. It is the **Free** distribution, fetched from the
Font Awesome Free repository, and deliberately not the copy Foundry bundles: Foundry ships
Font Awesome **Pro** under its own commercial licence, and Pro outlines may not be
redistributed in this package. And it is the same drawing a follower card already shows,
since the card renders `fas fa-seedling` as a font glyph and an Actor's `img` has to be a
file. Only the initiate of Danu uses it. Our copy reads the same way round as the Book I
creature-type marks in `bestiary/`, a black field carrying the drawing in cream over a disc
that shows past it as a hairline rim, so a shelf of follower actors reads as one set with
the monsters; the recipe and its numbers are in the file's own comment.

`note-caret.svg` is the project's own work too, and owes nothing to any source: it is three
line coordinates and a round-capped stroke, drawn wide and shallow for the expand control
under a relationship card's note. Its geometry is in the file's own comment.

`people/default_profile.svg` is not a separate icon at all: it is a byte copy of
`bestiary/human-individual.svg`, the Book I p.392 "human, individual" creature-type mark,
artwork unchanged. It lives at its own path so an un-portraited person stays distinguishable
from a human-type monster wearing that same mark as its art; the file's own comment has the
reasoning.

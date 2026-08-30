# Tab Rail Icon Attribution

The glyphs worn by the vertical tab rail on the character, steading, NPC and GM Toolkit sheets.

Icons sourced from [game-icons.net](https://github.com/game-icons/icons),
licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

Where our filename differs from the original, the game-icons.net source name is listed too.

| Icon | Tab | game-icons.net source | Artist | Artist page |
|------|-----|-----------------------|--------|-------------|
| move.svg | Moves | move | Delapouite | https://delapouite.com |
| three-friends.svg | Followers, Residents | three-friends | Delapouite | https://delapouite.com |
| school-bag.svg | Inventory | school-bag | Delapouite | https://delapouite.com |
| info.svg | Details | info | Delapouite | https://delapouite.com |
| death-skull.svg | Post-Death | death-skull | sbed | http://opengameart.org/content/95-game-icons |
| round-star.svg | Special Moves | round-star | Delapouite | https://delapouite.com |
| notebook.svg | Notes | notebook | Delapouite | https://delapouite.com |
| village.svg | Overview (steading), Homefront (GM Toolkit) | village | Delapouite | https://delapouite.com |
| hammer-nails.svg | Improvements | hammer-nails | Lorc | https://lorcblog.blogspot.com |
| hazard-sign.svg | Threats & Dangers | hazard-sign | Lorc | https://lorcblog.blogspot.com |
| hearts.svg | Relationships | hearts | Skoll | https://game-icons.net |
| crossed-swords.svg | Stats (NPC), Overview (character) | crossed-swords | Lorc | https://lorcblog.blogspot.com |
| direction-signs.svg | Expeditions | direction-signs | Delapouite | https://delapouite.com |
| settings-knobs.svg | Preferences | settings-knobs | Delapouite | https://delapouite.com |

No artwork above is altered. Every rail icon is worn as a CSS *mask* (`-webkit-mask` /
`mask`, tinted by `background-color`) so one glyph can take the rail's rest, hover and
active colours, which means each file must carry alpha ONLY where the glyph is. The eight
icons exported from game-icons.net already ship that way — a 512x512 background square at
`fill-opacity="0"` behind an opaque glyph — and so does `hearts.svg`, which is a byte copy
of `assets/icons/hearts.svg`, already in the tree for the relationship hearts.

`village.svg`, `hammer-nails.svg`, `hazard-sign.svg`, `crossed-swords.svg`, `round-star.svg`,
`school-bag.svg`, `direction-signs.svg` and `settings-knobs.svg` were taken from the game-icons.net
repository instead
(`direction-signs.svg` by way of `assets/icons/macros/direction-signs.svg`, already in the tree
as a hotbar macro's icon), where the same
drawings are stored INVERTED — an opaque black background square under a white glyph, which
as a mask would resolve to a solid slab. Their background square (and only that square) was
punched transparent to match the export form: `<path d="M0 0h512v512H0z"/>` became
`<path d="M0 0h512v512H0z" fill="#ffffff" fill-opacity="0"/>`. The glyph path in each is
untouched.

Not listed above, because it comes from the Stonetop books rather than game-icons.net:
`lightbearer-sun.svg`, the Invocations tab's glyph. Invocations are the Lightbearer's own
move set, so the tab wears the Lightbearer's playbook mark. It is a trace of
`assets/icons/playbooks/the_lightbearer_icon.webp`, which is a lossy WEBP with no alpha at
all — black ink on an opaque white square, and so a solid slab if used as a mask directly.
`scripts/trace-icon-svg.js` vectorizes it (Chromium decodes, marching squares finds every
boundary loop, Douglas-Peucker simplifies, one `fill-rule="evenodd"` path carves the sun's
centre and the ring's interior as holes). Traced at source resolution, so the hand-inked
roughness and the ink flecks are the book's own; re-run the script if the source art is
ever replaced.

It carries TWO edits on top of the trace, and only two. Both are about the ring; nothing
inside it is reshaped.

The first is that the ring is drawn rather than traced. The printed mark's ring is an open
brush stroke, which gives the tracer's version of it two faults the rail cannot carry. Its
two ends leave a roughly 10 degree void at 9 o'clock, and the band tapers into them, running
from 43 units wide at 4 o'clock down to 16 at 9. Scaled to the rail's 20px that is a 1.7px
stroke thinning to 0.6px before it breaks, so the ring reads as a chipped, lopsided smear
rather than as a circle. Both of the loops the tracer emitted for it are replaced by circles
concentric on the viewBox centre, 254 outside and 220 inside, which are also the two nested
closed loops `evenodd` wants for an annulus. Neither radius is eyeballed: 254 is the traced
outer edge's mean radius, so the glyph keeps its footprint, and 220 gives the annulus the
same area as the traced band, so the ring keeps its ink weight. The five loops the tracer
found INSIDE the brush stroke go with it, being unfilled specks in the ink that two of the
new edges cut through.

The second is that the sun is centred in that ring. The trace puts it up and to the left,
near enough that the gap closes to 24 units at 10 o'clock while it opens to 49 at 4, and
once the ring itself is even it is that lopsided gap the eye reads as the ring being thin on
one side. The smallest circle enclosing the rays is centred at 247.5,246.6 with radius
183.8, so translating the traced interior by 8.5,9.4 lands that centre on the viewBox
centre, which is by definition the placement that opens the tightest gap as far as it will
go: 24 units becomes 36. It is a translation and only a translation. No ray is restyled or
relengthened, and the flecks travel with the ink they belong to.

Everything within the ring is otherwise the trace untouched, roughness and ink flecks alike:
the rays, the sun's centre hole, and the two flecks floating in the gap. A re-run of the
tracer undoes both edits, so redraw the ring and re-centre the sun if you re-run it.

Also not from game-icons.net, and the project's own drawing: `site-mound.svg`, the Sites
tab's glyph. A mound with an open way in, which is what most Stonetop sites look like from
outside (a barrow, a cave mouth, a Maker-ruin gone to grass). Plain geometry: a dome and a
semicircle-topped doorway in one `fill-rule="evenodd"` path, so the entrance is a hole and
not a lighter shape, plus a rounded ground bar. Nothing to re-derive if it is ever redrawn.

Also the project's own drawing: `flow-chart.svg`, the GM Toolkit's Core Loop tab glyph. Three
boxes wired into a cycle, which is the shape of both diagrams that tab holds. Plain geometry, and
the file's own comment states every coordinate rule, so there is nothing to re-derive if it is
redrawn. Each box is an outer rounded rect plus an inner one wound the other way, so nonzero fill
leaves a wall and an empty middle without `fill-rule`; the arrowhead that closes the loop is on
the RETURN leg, so the cycle reads bottom-back-to-top the way the printed diagram runs.

Also the project's own drawing: `question-mark.svg`, the GM Toolkit's "I wonder..." tab glyph.
A question mark, because the tab is a list of open questions and the playbook's own heading for
it is "I wonder...". Plain geometry, and the file's own comment states every coordinate rule, so
there is nothing to re-derive if it is redrawn: the hook is an annulus sector swept from 205
degrees round to -25, the stem leaves it at the band's own 72-unit width, and the outline runs
down the hook's OUTER edge into the stem and back up into its INNER edge, which is what curls the
tail out of the bowl rather than sticking it on. Both the band and the stem are sized so the
stroke is 2.8px at the rail's 20px, below which a curve stops reading as one.

Also the project's own drawing: `prep-stack.svg`, the GM Toolkit's Encounters tab glyph. A stack
of sheets, because the tab is the pile of things gathered for tonight rather than a fight: it holds
a scene, a journal page and a roll table as often as it holds monsters, and crossed swords (which
were free, being worn only by tabs no GM Toolkit rail ever shows) would have named the smaller half
of it. Plain geometry, and the file's own comment states every coordinate rule, so there is nothing
to re-derive if it is redrawn: three 288x288 sheets offset 48 down and right, of which only the
front one is drawn whole, the two behind it being the L of top and left edge left showing by the
sheet in front, inset by a 16 unit gap so the three read as separate sheets rather than as one
shape. The front sheet's three ruled lines are holes carved by `fill-rule="evenodd"` rather than
lighter shapes, and are 32 units deep so they still read at the rail's 20px. Only each shape's
outer corner is rounded; a rounded corner where one sheet passes behind another would read as that
sheet ending rather than continuing underneath.

Also not from game-icons.net, and the project's own drawing rather than either:
`arcanum.svg`, the Arcana tab's glyph. It is the triple spiral from
`assets/icons/arcanum.svg` — generated geometry, redrawn from the mark the rulebooks print
beside an arcanum (Book II p.545) — with the dark octagon token dropped, since an opaque
octagon cannot be masked. Its two deliberate differences from the octagon version are in
the file's own comment.

# Weather Glyph Attribution

The thirteen weathers a Book I weather table (p.325) can give, worn as a glyph beside the
steading header's season clock. Which row is which weather is decided by `sky` on each row in
`module/utils/weather.js`; the vocabulary and its labels are `WEATHER_SKIES` in
`module/seasons/current-weather.js`, and the file each one points at is in `styles/stonetop.css`.

Icons sourced from [game-icons.net](https://github.com/game-icons/icons),
licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

Our filenames are named for the WEATHER rather than for the drawing, so the game-icons.net
source name is listed for every one.

| Icon | Weather | game-icons.net source | Artist | Artist page |
|------|---------|-----------------------|--------|-------------|
| sun.svg | Clear | sun | Lorc | https://lorcblog.blogspot.com |
| fair.svg | Fine | sun-cloud | Delapouite | https://delapouite.com |
| cloud.svg | Overcast | fluffy-cloud | Lorc | https://lorcblog.blogspot.com |
| wind.svg | Windy | windy-stripes | Lorc | https://lorcblog.blogspot.com |
| rain.svg | Rain | raining | Lorc | https://lorcblog.blogspot.com |
| downpour.svg | Downpour | heavy-rain | Lorc | https://lorcblog.blogspot.com |
| storm.svg | Storm | lightning-storm | Lorc | https://lorcblog.blogspot.com |
| tornado.svg | Tornado | tornado | Lorc | https://lorcblog.blogspot.com |
| snow.svg | Snow | snowing | Lorc | https://lorcblog.blogspot.com |
| blizzard.svg | Blizzard | person-in-blizzard | Lorc | https://lorcblog.blogspot.com |
| cold.svg | Bitter cold | thermometer-cold | Delapouite | https://delapouite.com |
| heat.svg | Heat | thermometer-hot | Delapouite | https://delapouite.com |
| haze.svg | Muggy | heat-haze | Lorc | https://lorcblog.blogspot.com |

No artwork above is altered. Every glyph is worn as a CSS *mask* tinted by `background-color`,
the same way the tab rail wears its icons, so one file takes the header's ink in both themes and
its dimmer tone when nobody has set the weather yet. That means each file must carry alpha ONLY
where the glyph is.

All thirteen were taken from the game-icons.net repository, where the drawings are stored
INVERTED — an opaque black background square under a white glyph, which as a mask resolves to a
solid slab. Their background square (and only that square) was punched transparent to match the
export form the tab rail's icons already use: `<path d="M0 0h512v512H0z"/>` became
`<path d="M0 0h512v512H0z" fill="#fff" fill-opacity="0"/>`. The glyph path in each is untouched.

`fair.svg` is the same drawing as `assets/icons/macros/sun-cloud.svg`, which the Weather macro
wears on the hotbar — kept as its own file rather than shared, because the two need opposite
backgrounds. A hotbar macro is a picture and wants the opaque black tile; a mask wants nothing
behind the glyph at all.

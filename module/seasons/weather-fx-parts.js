// ── The switchable parts of the sky ──────────────────────────────────────────
// Which pieces of the canvas weather a world can turn off one at a time, as one ordered table.
//
// ONE table, read by three places that would otherwise each carry their own copy of this list:
// settings.js registers a checkbox per row (in this order, so the settings screen reads as a
// group under the main switch), weather-fx.js asks it which parts to leave out when it builds a
// sky, and the tests pin it against SKY_EFFECTS so a row here can never name an effect no
// weather draws, nor an effect go unswitchable because nobody remembered to add it.
//
// Its own module, small as it is, because both of its readers already sit on opposite sides of
// an import that cannot be turned around: weather-fx.js reads settings.js for `getSetting`, so
// settings.js cannot read weather-fx.js back. A leaf both can import is the way out that does
// not need a second spelling of the list.
//
// `type` is an FXMaster particle type, and `tint` marks the one row that is not a type at all:
// the storm's grey light is an OPTION on the cloud effect, so switching it off strips the option
// and leaves the cloud falling. Every row's `setting` is registered as a Boolean defaulting to
// true, and only an explicit `false` counts as off (see `weatherFxDisabled`), so a world that
// has never touched any of this gets the whole sky.

/**
 * The master switch, over all seven below it.
 *
 * Here rather than in weather-fx.js for the same reason the table is: settings.js registers it and
 * weather-fx.js reads it, and those two cannot import each other. Spelled once, so a rename cannot
 * register one key and read another — which fails in the worst direction there is, the setting
 * screen still showing a ticked box while `getSetting` answers undefined, `weatherFxPaused` reads
 * that as paused, and the canvas weather is simply dead.
 */
export const WEATHER_FX_SETTING = "weatherSceneFx";

// Each ROW frozen as well as the list. Freezing only the array stops a row being added or removed
// and lets `WEATHER_FX_PARTS[0].type = "fog"` through — one stray write reshaping the settings
// screen and the sky at once, with nothing to catch it. Every sibling table in this feature
// (TRAVEL_MAPS, TRAVEL_PLACES, TRAVEL_LEGS, TRAVEL_EXITS, MAP_FRAMES) freezes its entries too.
export const WEATHER_FX_PARTS = Object.freeze([
	Object.freeze({ setting: "weatherFxClouds",    type: "clouds"    }),
	Object.freeze({ setting: "weatherFxFog",       type: "fog"       }),
	Object.freeze({ setting: "weatherFxRain",      type: "rain"      }),
	Object.freeze({ setting: "weatherFxHail",      type: "hail"      }),
	Object.freeze({ setting: "weatherFxSnow",      type: "snow"      }),
	Object.freeze({ setting: "weatherFxSnowstorm", type: "snowstorm" }),
	Object.freeze({ setting: "weatherFxStormTint", tint: true        }),
]);

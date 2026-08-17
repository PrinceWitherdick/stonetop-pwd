import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { postWeather } from "../utils/weather.js";
import { getStonetopSteadingActor } from "../utils/world.js";

// ── The steading's weather ────────────────────────────────────────────────────
// What the sky over Stonetop is doing, shown as a glyph beside the season clock on the
// steading header. Its sibling in every way: one flag, one writer, one view function the
// template paints, and a display default for a world that has never set it (see
// current-season.js, which this file is deliberately shaped after).
//
// Written by the Weather picker when the GM posts a result (dialogs/WeatherDialog.js), which
// is the only place weather is decided — rolled or chosen, both land here. Nothing else reads
// it: this is a readout, not a rule. Stonetop has no mechanics that key off the weather, and
// the moment one exists it should take the season's `sky` off the row rather than parse this.
//
// The stored TEXT is the row's own line, not a re-derivation. The glyph says what kind of day
// it is and the hover says which day exactly, and the second half has to survive the tables
// being edited: a stored row index would silently point at a different weather the first time
// somebody reorders one, and there would be nothing on screen to say it had.

/** Flag key on the steading actor holding `{ sky, text }`. */
export const CURRENT_WEATHER_KEY = "weatherCurrent";

/**
 * The thirteen weathers a table row can be, each with the name it is announced by.
 *
 * THIRTEEN over thirty rows: enough that the glyph tells the GM which kind of day the table gave
 * without their having to hover it, and no more than the drawings can actually keep apart at
 * header size. Every one is reachable — a sky no row uses is a glyph nobody can ever see, which
 * the tests count — and the ones that exist to be told APART are the near neighbours: the
 * tornado row against the other storms, the blizzard against ordinary snow, the still bitter
 * winter day against the windy one, muggy against blazing.
 *
 * The GLYPH is not named here. Each sky's drawing is hung off its modifier class in
 * stonetop.css and worn as a CSS mask over `currentColor`, the way the tab rail wears its icons
 * — which is what lets one file take the header's ink in both themes and its dimmer tone before
 * anyone has set the weather. A file named here would be a second place deciding, and a colour
 * this file could not reach. `assets/icons/weather/ATTRIBUTION.md` lists which drawing is which;
 * the tests pin every sky to a rule in the stylesheet, since a sky with no rule paints a hole.
 */
export const WEATHER_SKIES = Object.freeze({
	sun:      { label: "Clear" },
	fair:     { label: "Fine" },
	cloud:    { label: "Overcast" },
	wind:     { label: "Windy" },
	rain:     { label: "Rain" },
	downpour: { label: "Downpour" },
	storm:    { label: "Storm" },
	tornado:  { label: "Tornado" },
	snow:     { label: "Snow" },
	blizzard: { label: "Blizzard" },
	cold:     { label: "Bitter cold" },
	heat:     { label: "Heat" },
	haze:     { label: "Muggy" },
});

/**
 * The sky the header shows before any weather has been set.
 *
 * Fine weather, for the same reason the season clock opens on Spring: a sheet that has never
 * been told otherwise should say the ordinary thing rather than nothing. It is a DISPLAY
 * default and stops here — `readCurrentWeather` still returns null for a world that has not
 * set one, so nothing downstream can mistake "sunny by default" for "the GM said sunny".
 */
export const DEFAULT_SKY = "sun";

/** Is this one of the thirteen? */
export function isSky(sky) {
	return Object.hasOwn(WEATHER_SKIES, String(sky));
}

/**
 * Read the weather off a steading actor.
 * @returns {{sky: string, text: string}|null} null when none has been set, or when the stored
 *   sky is not one we know (a flag left by a future version, or a hand-edited one).
 */
export function readCurrentWeather(actor) {
	const stored = actor?.getFlag?.(STONETOP_SCOPE, CURRENT_WEATHER_KEY);
	if (!isSky(stored?.sky)) return null;
	return { sky: stored.sky, text: String(stored.text ?? "") };
}

/**
 * Record the weather from a table row (the shape in WEATHER_SEASONS).
 *
 * A no-op for a row with no sky rather than a write of the default, because "the GM set fine
 * weather" and "we could not tell what this row was" must not end up looking the same on the
 * header. There is no unset path: weather is not a thing a steading stops having.
 *
 * @param {Actor}  actor
 * @param {{sky?: string, text?: string}} row
 */
export async function recordCurrentWeather(actor, row) {
	if (!actor || !isSky(row?.sky)) return;
	await actor.setFlag(STONETOP_SCOPE, CURRENT_WEATHER_KEY, {
		sky:  row.sky,
		text: String(row.text ?? ""),
	});
}

/**
 * Announce the weather: the chat card AND the steading's glyph, as one act.
 *
 * ONE exported call rather than two, because the two are not separable in a way that leaves the
 * table in a sensible state. A card in the log saying it is snowing over a header still showing
 * a sun is worse than either alone, and that invariant used to live in a comment beside the two
 * calls in `WeatherDialog._post` — where it held only for as long as that stayed the one caller.
 * It will not: an auto-roll on Seasons Change, an expedition step and a macro are all things
 * that want to announce weather, and every one of them reaching for the exported `postWeather`
 * would post a card and leave yesterday's sky on the header, silently.
 *
 * The steading is resolved HERE and NOW rather than passed in or read at the picker's open: the
 * window can sit on a rolled result for as long as the GM likes, and utils/world.js is where
 * "which actor is the steading" is answered once for everybody.
 *
 * @param   {string} seasonKey
 * @param   {{row?: object, roll?: Roll}} [picked]  As `rollWeatherResult` returns it.
 * @returns {Promise<object|null>}  The row announced, or null when there was nothing to post —
 *   in which case nothing is written either, so a refused post cannot move the glyph.
 */
export async function announceWeather(seasonKey, picked) {
	const row = await postWeather(seasonKey, picked);
	if (!row) return null;
	await recordCurrentWeather(getStonetopSteadingActor(), row);
	return row;
}

/**
 * The header readout: the glyph, and the line that names the day behind it.
 *
 * Pure, so the tests drive it directly. `stamped` is the un-set case, which the template uses
 * to soften the default glyph — a sun nobody chose should not be as loud as one they did.
 *
 * @param {{sky: string, text: string}|null} stored  From readCurrentWeather.
 */
export function currentWeatherView(stored) {
	const sky = isSky(stored?.sky) ? stored.sky : DEFAULT_SKY;
	return {
		sky,
		label:   WEATHER_SKIES[sky].label,
		// The row's own line when there is one, and the plain name of the sky when there is
		// not, so the hover always says something rather than going empty on a fresh world.
		text:    stored?.text?.trim() || WEATHER_SKIES[sky].label,
		stamped: Boolean(stored),
		// The wrapper's classes, RESOLVED here rather than composed in the template.
		//
		// The header draws this readout twice — a <button> for the GM, a <span> for everyone
		// else — and both wrappers need the same sky modifier and the same un-set softening.
		// Spelled out in the markup that was the one conditional in this file written twice,
		// which is the drift the season beside it avoids by putting its readout in a partial.
		// One string, built where `sky` and `stamped` are decided, and neither wrapper can
		// disagree with the other about what it is under.
		classes: `steading-header-weather steading-header-weather--${sky}${stored ? "" : " steading-header-weather--unset"}`,
	};
}

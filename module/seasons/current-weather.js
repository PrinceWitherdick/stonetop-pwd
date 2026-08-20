import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { postWeather } from "../utils/weather.js";
import { getStonetopSteadingActor } from "../utils/world.js";
import { applyWeatherFx, clearWeatherFx, weatherFxPaused, WEATHER_FX_SETTING } from "./weather-fx.js";
import { setWorldSetting } from "../settings.js";

// ── The steading's weather ────────────────────────────────────────────────────
// What the sky over Stonetop is doing, shown as a glyph beside the season clock on the
// steading header. Its sibling in every way: one flag, one writer, one view function the
// template paints, and a display default for a world that has never set it (see
// current-season.js, which this file is deliberately shaped after).
//
// Written by the Weather picker when the GM posts a result (dialogs/WeatherDialog.js), which
// is the only place weather is decided — rolled or chosen, both land here. Nothing keys off it:
// this is a readout, not a rule. Stonetop has no mechanics that turn on the weather, and the
// moment one exists it should take the season's `sky` off the row rather than parse this. One
// thing does read it back — `setWeatherFxPaused`, which has to know which sky to put on the
// canvas when a paused table resumes. Still a readout; just one with a picture behind it.
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
 * Announce the weather: the chat card, the steading's glyph AND the canvas, as one act.
 *
 * ONE exported call rather than three, because they are not separable in a way that leaves the
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
 * The scene goes LAST and is the only one of the three allowed to fail quietly: it is the
 * optional one — it needs FXMaster installed, a scene to put the weather on, and the setting
 * left switched on — and the card is already posted by the time it runs. See seasons/weather-fx.js.
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
	await applyWeatherFx(row.sky);
	return row;
}

/**
 * Pause or resume the weather on the canvas: the switch thrown, and the canvas brought into line
 * with it in the same act.
 *
 * The pause is the world setting `weatherSceneFx` going off, not a second flag beside it. One
 * switch is what keeps "why is it not raining on the map" a question with one answer — the config
 * checkbox and the picker's button are the same control seen from two rooms — and it is why a
 * pause SURVIVES the next posted weather instead of being quietly undone by it.
 *
 * Resuming re-derives the sky from the steading rather than from anything remembered at the
 * pause: the GM can pause on a Tuesday, post three more weathers, and resume into whatever the
 * world is actually under. A world that has never had weather posted has no sky to put back, and
 * that is a `false`, not a default sun — see `readCurrentWeather`.
 *
 * Lives HERE rather than in weather-fx.js, which is where the rest of the canvas work is, because
 * resuming needs the steading and weather-fx.js must not import this file: it is imported BY it,
 * and the pair would be a cycle.
 *
 * @param   {boolean} paused
 * @returns {Promise<boolean>} true when THIS call wrote the scene. False is an ordinary answer
 *   too: the setting's own onChange reconciles the canvas on the primary GM's client as well, and
 *   a pause that has already been carried out there leaves this one nothing to take off.
 */
export async function setWeatherFxPaused(paused) {
	// setWorldSetting, not setSetting: this is a world-scoped key, and core throws rather than
	// no-ops when a player writes one. The button that calls this is GM-only, so this is the
	// belt to that pair of braces — and the scene write below is refused for a player anyway.
	await setWorldSetting(WEATHER_FX_SETTING, !paused);
	return refreshWeatherFx();
}

/**
 * Make the canvas agree with the switches and with the sky the world is under. The one place
 * that decides what should be on the map right now.
 *
 * Every route into the canvas comes through here: the picker's Pause button, and the onChange on
 * each of the weather-effect settings (registerSettings reaches it as
 * `game.stonetop.refreshWeatherFx`, since settings.js cannot import this file back). That is what
 * lets unticking "Weather Effects: Fog" in the config screen take the fog off the map it is
 * already sitting on, rather than waiting for the next weather to be posted.
 *
 * Safe to run twice, and it does get run twice: the picker's button reconciles, and so does the
 * onChange that the same write sets off. Nothing accumulates, because the whole update is
 * re-derived from the scene as it stands and our keys are one per effect type. A second pause
 * finds nothing of ours left to take off and writes nothing at all; a second resume lays the same
 * sky over the same keys and leaves the canvas exactly where the first one did.
 *
 * The un-paused case with no weather recorded still CLEARS rather than standing down, because
 * there is one way for our effects to be on a scene under a world with no sky: they were laid
 * before the steading's flag was cleared out. Nothing of ours up and nothing to do reads the same
 * either way, since the clear computes an empty update.
 *
 * @returns {Promise<boolean>} true when the scene was written.
 */
export async function refreshWeatherFx() {
	if (weatherFxPaused()) return clearWeatherFx();

	const sky = readCurrentWeather(getStonetopSteadingActor())?.sky ?? null;
	return sky ? applyWeatherFx(sky) : clearWeatherFx();
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

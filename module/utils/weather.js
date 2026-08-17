import { stonetopCardShell, rollFormulaChip } from "./chat.js";

// Stonetop's seasonal weather tables (Book I, p.325). Each season is a 1d6 table;
// the GM picks the season (informed by the latest Seasons Change move, p.517) and
// rolls. A few results carry a "roll again later with disadvantage" rider, which
// we surface as `reroll` so the card can call it out.
//
// The pure data + resolver live here (and are unit-tested); the picker UI is
// WeatherDialog, and the hotbar macro opens it (see hooks/Ready.js).
//
// `sky` is ours, not the book's: which of thirteen weathers the row IS, so the steading header
// can show it as a glyph (seasons/current-weather.js, where the vocabulary and its labels live).
// Written onto each row by hand rather than read out of the prose, because the prose does not
// classify cleanly — "Snow / sleet / hail, an early thunderstorm, or a day of cold, soaking
// rains" names four weathers and is one row, and a keyword match on it would answer whichever
// word it happened to try first. A row's sky is the weather that row is FOR: the thing the GM
// would say out loud describing the day, which is usually the phrase the row LEADS with.
//
// Rows that share a sky are not a shortcoming — three tables have a thunderstorm row and they
// are the same weather in three seasons. What the vocabulary does have to do is keep apart the
// weathers a GM would describe differently, which is why summer's tornado row is not filed with
// the other storms and winter's blizzard is not filed with its ordinary snow.

const REROLL_NOTE = "Roll again later with disadvantage.";

export const WEATHER_SEASONS = [
	{
		key:   "late-winter-early-spring",
		label: "Late winter / early spring",
		rows:  [
			{ min: 1, max: 1, sky: "storm", text: "Snow / sleet / hail, an early thunderstorm, or a day of cold, soaking rains" },
			{ min: 2, max: 3, sky: "wind",  text: "Cold and windy, maybe some showers" },
			{ min: 4, max: 4, sky: "cloud", text: "Clouds on the horizon, steady wind", reroll: true },
			// `fair`, not `sun`: the row says sunny AND clouded AND gusting, which is the
			// sun-behind-a-cloud glyph rather than the bare sun the cloudless rows get.
			{ min: 5, max: 6, sky: "fair",  text: "A fine, sunny spring day; some clouds, some gusting winds" },
		],
	},
	{
		key:   "spring-early-summer",
		label: "Spring / early summer",
		rows:  [
			{ min: 1, max: 1, sky: "storm", text: "A heavy storm; high winds, hail, thunder, lightning" },
			{ min: 2, max: 2, sky: "rain",  text: "Steady, chilly rain" },
			{ min: 3, max: 4, sky: "wind",  text: "Warm and windy, maybe some brief showers" },
			{ min: 5, max: 6, sky: "sun",   text: "Warm, sunny, pleasant" },
		],
	},
	{
		key:   "summer",
		label: "Summer",
		rows:  [
			// The only row in the book that names tornadoes, so it gets the only tornado.
			{ min: 1, max: 1, sky: "tornado",  text: "A heavy storm; high winds, hail, thunder, lightning, tornadoes" },
			{ min: 2, max: 2, sky: "heat",     text: "Blazing heat, still air, not a cloud in sight" },
			{ min: 3, max: 3, sky: "downpour", text: "Hot and humid, with brief, drenching thunderstorms" },
			{ min: 4, max: 5, sky: "haze",     text: "Hot, muggy, some wind" },
			{ min: 6, max: 6, sky: "sun",      text: "Warm, sunny, breezy, perfect" },
		],
	},
	{
		key:   "late-summer-early-autumn",
		label: "Late summer / early autumn",
		rows:  [
			{ min: 1, max: 1, sky: "storm", text: "A powerful thunderstorm or cold, soaking rain" },
			{ min: 2, max: 2, sky: "wind",  text: "Windy with a few rain showers" },
			{ min: 3, max: 3, sky: "cloud", text: "Warm, clouds on the horizon, steady wind", reroll: true },
			{ min: 4, max: 5, sky: "heat",  text: "Hot and dry during the day; cooler and windy at night" },
			{ min: 6, max: 6, sky: "sun",   text: "Warm, sunny, breezy, perfect" },
		],
	},
	{
		key:   "autumn",
		label: "Autumn",
		rows:  [
			{ min: 1, max: 1, sky: "downpour", text: "Cold, drenching rain and/or sleet" },
			{ min: 2, max: 2, sky: "rain",     text: "Cold, windy, light rain or early snow" },
			{ min: 3, max: 3, sky: "cloud",    text: "Chilly, windy, clouds on the horizon", reroll: true },
			{ min: 4, max: 6, sky: "fair",     text: "Crisp, breezy" },
		],
	},
	{
		key:   "winter",
		label: "Winter",
		rows:  [
			// The blizzard has its own glyph rather than sharing the ordinary snow one: it is
			// the row that ends an expedition, and the table should be able to say so at a
			// glance. `storm` would be wrong for the opposite reason — that glyph carries
			// lightning, and a winter storm here is wind and snow ("all of it").
			{ min: 1, max: 1, sky: "blizzard", text: "Blizzard: wind, snow, all of it" },
			{ min: 2, max: 2, sky: "wind",     text: "Intense cold and wind" },
			// Cold, not clear: the still bitter day, told apart from the windy one above it by
			// the thing the two rows differ on.
			{ min: 3, max: 3, sky: "cold",     text: "Very cold, very clear, very still" },
			{ min: 4, max: 4, sky: "snow",     text: "Cold and snowy, or cold and windy" },
			{ min: 5, max: 5, sky: "cloud",    text: "Some snow, but mostly just dreary" },
			{ min: 6, max: 6, sky: "sun",      text: "Warm (for winter) and sunny" },
		],
	},
];

/** Look up a season table by its key. */
export function getWeatherSeason(key) {
	return WEATHER_SEASONS.find(s => s.key === key) ?? null;
}

// ── The steading's clock, as a weather table ─────────────────────────────────
// Six tables, four seasons. The campaign clock (the Seasons Change stamp, see
// seasons/current-season.js) names one of spring/summer/autumn/winter, so it can only ever
// point at the four tables that name a season outright. The two straddle tables ("late
// winter / early spring", "late summer / early autumn") describe the seam BETWEEN two
// stamped seasons, and nothing in the clock says how deep into a season the party is —
// so those stay the GM's own pick rather than something we guess at.
//
// Keys are the SEASON_IDS of seasons-change-reminders.js. Not imported: that module pulls
// in the chat card and the playbook-actor scan for a four-string list, and this file is the
// pure rules data the tests drive directly. The pairing is guarded in tests/utils/weather.test.js
// instead, which asserts these keys ARE SEASON_IDS.
export const CAMPAIGN_SEASON_TABLES = Object.freeze({
	spring: "spring-early-summer",
	summer: "summer",
	autumn: "autumn",
	winter: "winter",
});

/**
 * The weather table a stamped campaign season rolls on.
 * @param {string|null} season  A SEASON_IDS key.
 * @returns {string|null} null when there's no season stamped (or it isn't one we know).
 */
export function weatherSeasonForCampaignSeason(season) {
	return CAMPAIGN_SEASON_TABLES[season] ?? null;
}

/**
 * Which table the picker opens on.
 *
 * The clock wins, because the season the table is actually playing in is a fact and the
 * remembered pick is only where this client happened to leave the dialog — a GM who ran the
 * Seasons Change into autumn and then opened the weather should not be rolling summer.
 *
 * But the remembered pick is still worth keeping WITHIN a season: the GM who deliberately
 * switched to "late summer / early autumn" is telling us where in the season they are, which
 * is exactly the thing the clock can't say. So the pick is remembered together with the
 * campaign season it was made under, and it only survives while that season does. One value
 * holding both halves, for the same reason the clock itself is one flag: a key remembered
 * separately from the season it belongs to is a pick that outlives its meaning.
 *
 * @param {string|null} campaignSeason        The stamped season, or null if none.
 * @param {{key?: string, for?: string|null}|string|null} [remembered]  The stored pick. A bare
 *   string is a pick saved before it was paired with a season — honoured only in an unstamped
 *   world, which is where the clock has nothing to say anyway.
 * @returns {string} Always a real WEATHER_SEASONS key.
 */
export function defaultWeatherSeason(campaignSeason, remembered = null) {
	const pick = typeof remembered === "string" ? { key: remembered } : (remembered ?? {});
	const rememberedKey = getWeatherSeason(pick.key) ? pick.key : null;
	const sameSeason    = (pick.for ?? null) === (campaignSeason ?? null);
	if (rememberedKey && sameSeason) return rememberedKey;
	return weatherSeasonForCampaignSeason(campaignSeason) ?? rememberedKey ?? WEATHER_SEASONS[0].key;
}

/** The row a given 1d6 total lands on for a season (or null if the key is unknown). */
export function resolveWeatherRow(seasonKey, total) {
	const season = getWeatherSeason(seasonKey);
	return season?.rows.find(r => total >= r.min && total <= r.max) ?? null;
}

/** Human-readable range label for a row, e.g. "1" or "2–3". */
export function rowRange(row) {
	return row.min === row.max ? `${row.min}` : `${row.min}–${row.max}`;
}

/**
 * Roll 1d6 on a season's weather table. Posts NOTHING.
 *
 * The roll and the card are two calls rather than one because the picker now sits on its
 * answer: it lands a light on the row the die gave, and the GM re-rolls or chooses another
 * before anything goes to the table. A roll that posted as it landed would put every discarded
 * re-roll in the log. The evaluated Roll comes back with the result so the card that eventually
 * goes out is the one the GM watched land — and so its 3D dice, if any, fire once, on posting.
 *
 * The shape is exactly what `postWeather` takes, so a caller hands the result straight on
 * without unpacking it. No `total` beside the Roll: it is `roll.total`, and a second name for
 * one number is a second thing that can be passed along stale.
 *
 * @param   {string} seasonKey
 * @returns {Promise<{roll: Roll, row: object|null}|null>}  null for an unknown season.
 */
export async function rollWeatherResult(seasonKey) {
	if (!getWeatherSeason(seasonKey)) return null;
	const roll = await new Roll("1d6").evaluate();
	return { roll, row: resolveWeatherRow(seasonKey, roll.total) };
}

/**
 * Post a weather result to chat.
 *
 * @param   {string} seasonKey
 * @param   {object} [result]
 * @param   {object} [result.row]   The table row to announce.
 * @param   {Roll}   [result.roll]  The d6 behind it, or null when the GM chose the row by hand.
 * @returns {Promise<object|null>}  The row posted, or null when there was nothing to post —
 *   which is the half callers actually test.
 */
export async function postWeather(seasonKey, { row = null, roll = null } = {}) {
	const season = getWeatherSeason(seasonKey);
	if (!season || !row) return null;

	const speaker = { alias: `Weather: ${season.label}` };
	const card    = stonetopCardShell(_weatherCardBody(row, roll), "stonetop-weather-card");

	// A rolled result rides its own Roll message, so the dice are real ones the players can pick
	// up and inspect; a chosen one has no roll to carry and goes out as a plain card. The roll
	// mode reaches both — `toMessage` reads it for itself, and applyRollMode does the same job
	// for the card, so a weather the GM chose while whispering is not the one thing in this
	// window that goes out to the whole table anyway.
	if (roll) {
		await roll.toMessage({ speaker, flavor: card });
	} else {
		const data = { speaker, content: card };
		ChatMessage.applyRollMode?.(data, game?.settings?.get?.("core", "rollMode"));
		await ChatMessage.create(data);
	}

	return row;
}

// We render the result ourselves (number + table text + the d6 formula) and hide
// Foundry's auto-rendered dice block in CSS, so the rolled total isn't shown twice.
//
// A CHOSEN row prints neither chip nor number. There is no formula to show, and the row's own
// range in the number's place ("4–5") would read as a total that was never rolled — the card
// says what the weather is, and stays quiet about a die that never left the GM's hand.
function _weatherCardBody(row, roll) {
	const reroll = row?.reroll
		? `<p class="stonetop-weather-reroll"><i class="fas fa-rotate-right"></i> ${REROLL_NOTE}</p>`
		: "";
	return `<div class="card-content stonetop-weather">
		${roll ? rollFormulaChip(roll.formula) : ""}
		<div class="stonetop-weather-result">
			${roll ? `<span class="stonetop-weather-number">${roll.total}</span>` : ""}
			<span class="stonetop-weather-text">${row?.text ?? ""}</span>
		</div>
		${reroll}
	</div>`;
}

export { REROLL_NOTE };

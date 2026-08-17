import { describe, it, expect, vi, afterEach } from "vitest";
import {
	WEATHER_SKIES,
	DEFAULT_SKY,
	CURRENT_WEATHER_KEY,
	isSky,
	readCurrentWeather,
	recordCurrentWeather,
	currentWeatherView,
	announceWeather,
} from "../../module/seasons/current-weather.js";
import { WEATHER_SEASONS } from "../../module/utils/weather.js";
import { STONETOP_SCOPE } from "../../module/actors/character/StonetopFlags.js";

// The sky over Stonetop, shown as a glyph beside the steading header's season clock. Set by the
// Weather picker when the GM posts a result; fine weather until they do. Same shape as the clock
// beside it (tests/seasons/current-season.test.js), and guarded for the same reasons: the view is
// what the template paints, and the default is a DISPLAY default that must not look like a
// decision the GM made.

function steading(flag = undefined) {
	return {
		type: "stonetop",
		getFlag: (scope, key) => (scope === STONETOP_SCOPE && key === CURRENT_WEATHER_KEY ? flag : undefined),
		setFlag: vi.fn(),
	};
}

/**
 * A world with one steading and a chat log, for the announce path.
 *
 * `game` is MUTATED and restored rather than replaced: tests/setup.js puts the real `i18n` on it
 * for the whole run, and a suite that deletes the global takes that away from every suite after
 * it in this file.
 */
function world(actor) {
	const saved = { actors: globalThis.game.actors, settings: globalThis.game.settings };
	globalThis.game.actors   = [actor];
	globalThis.game.settings = { get: () => "publicroll" };
	globalThis.ChatMessage   = { create: vi.fn(), applyRollMode: vi.fn() };
	return () => {
		globalThis.game.actors   = saved.actors;
		globalThis.game.settings = saved.settings;
		delete globalThis.ChatMessage;
	};
}

describe("the thirteen skies", () => {
	it("gives every one a name, and names no glyph", () => {
		for (const [sky, entry] of Object.entries(WEATHER_SKIES)) {
			expect(entry.label, sky).toBeTruthy();
			// The drawing is hung off the sky's modifier class in the stylesheet and worn as a
			// mask over currentColor — naming a file here too would be a second place deciding,
			// and one that could not reach the header's ink. See steading-header-weather.test.js.
			expect(entry.icon, sky).toBeUndefined();
		}
	});

	// The vocabulary and the tables are in two files, so nothing but this pins them together: a
	// row tagged with a sky nobody defines would silently fall back to the default sun, and the
	// header would report fine weather through a blizzard.
	it("covers every weather row in the book's six tables", () => {
		for (const season of WEATHER_SEASONS) {
			for (const row of season.rows) {
				expect(isSky(row.sky), `${season.key} ${row.min}-${row.max}: ${row.sky}`).toBe(true);
			}
		}
	});

	// Every sky has to be reachable, or it is a glyph nobody can ever see.
	it("is spent in full — no sky the tables never use", () => {
		const used = new Set(WEATHER_SEASONS.flatMap(s => s.rows.map(r => r.sky)));
		expect([...used].sort()).toEqual(Object.keys(WEATHER_SKIES).sort());
	});

	it("knows what is and isn't a sky", () => {
		expect(isSky("storm")).toBe(true);
		expect(isSky("drizzle")).toBe(false);
		expect(isSky(undefined)).toBe(false);
		// Object.hasOwn, not `in` — an inherited member is not a sky.
		expect(isSky("toString")).toBe(false);
	});
});

describe("reading the steading's weather", () => {
	it("comes back null when none has been set", () => {
		expect(readCurrentWeather(steading())).toBeNull();
		expect(readCurrentWeather(null)).toBeNull();
	});

	it("comes back null for a sky we don't know", () => {
		expect(readCurrentWeather(steading({ sky: "drizzle", text: "spit" }))).toBeNull();
	});

	it("reads back what was stored", () => {
		expect(readCurrentWeather(steading({ sky: "snow", text: "Blizzard: wind, snow, all of it" })))
			.toEqual({ sky: "snow", text: "Blizzard: wind, snow, all of it" });
	});
});

describe("recording the steading's weather", () => {
	it("writes the row's sky and its own line", async () => {
		const actor = steading();
		await recordCurrentWeather(actor, WEATHER_SEASONS.at(-1).rows[0]);
		expect(actor.setFlag).toHaveBeenCalledWith(STONETOP_SCOPE, CURRENT_WEATHER_KEY, {
			sky:  "blizzard",
			text: "Blizzard: wind, snow, all of it",
		});
	});

	// "The GM set fine weather" and "we could not tell what this row was" must not end up
	// looking the same on the header, so an unclassifiable row writes nothing at all.
	it("writes nothing for a row with no sky, or no actor", async () => {
		const actor = steading();
		await recordCurrentWeather(actor, { text: "A fog of unknown provenance" });
		await recordCurrentWeather(actor, null);
		await recordCurrentWeather(null, WEATHER_SEASONS[0].rows[0]);
		expect(actor.setFlag).not.toHaveBeenCalled();
	});
});

describe("the header's weather readout", () => {
	it("falls back to fine weather, and says it wasn't asked for", () => {
		const view = currentWeatherView(null);
		expect(view.sky).toBe(DEFAULT_SKY);
		expect(view.sky).toBe("sun");
		expect(view.stamped).toBe(false);
		// The hover still says something on a world that has never set one.
		expect(view.text).toBe(WEATHER_SKIES.sun.label);
	});

	it("paints a set weather with its own sky and line", () => {
		const view = currentWeatherView({ sky: "storm", text: "A heavy storm; high winds, hail" });
		expect(view.sky).toBe("storm");
		expect(view.label).toBe("Storm");
		expect(view.text).toBe("A heavy storm; high winds, hail");
		expect(view.stamped).toBe(true);
	});

	it("keeps the sky even when the stored line has gone blank", () => {
		const view = currentWeatherView({ sky: "rain", text: "   " });
		expect(view.sky).toBe("rain");
		expect(view.text).toBe("Rain");
		expect(view.stamped).toBe(true);
	});

	it("falls back rather than painting a glyph it hasn't got", () => {
		expect(currentWeatherView({ sky: "drizzle", text: "spit" }).sky).toBe(DEFAULT_SKY);
	});

	// The header draws this readout twice — a <button> for the GM, a <span> for everyone else —
	// and the sky modifier plus the un-set softening used to be spelled out in both wrappers.
	// Resolved here instead, so the two cannot disagree about what the sky is; the template
	// test next door asserts that both wrappers wear this string and compose nothing of their own.
	it("resolves the wrapper's classes, so neither wrapper composes them", () => {
		for (const sky of Object.keys(WEATHER_SKIES)) {
			const set = currentWeatherView({ sky, text: "" });
			expect(set.classes, sky).toContain(`steading-header-weather--${sky}`);
			expect(set.classes, sky).toContain("steading-header-weather");
			// A sky the GM chose is not softened.
			expect(set.classes, sky).not.toContain("steading-header-weather--unset");
		}
		// A world that has never set one gets the default glyph, dimmed.
		const unset = currentWeatherView(null);
		expect(unset.classes).toContain(`steading-header-weather--${DEFAULT_SKY}`);
		expect(unset.classes).toContain("steading-header-weather--unset");
	});
});

// The card and the glyph are ONE act. This used to be two calls in a row inside
// `WeatherDialog._post` under a comment saying they must not be split, which held only while
// that was the one caller — an auto-roll on Seasons Change, an expedition step or a macro all
// want to announce weather, and each reaching for `postWeather` alone would put a card in the
// log and leave yesterday's sky on the header, with nothing to say so.
describe("announcing the weather", () => {
	let restore = () => {};
	afterEach(() => { restore(); vi.restoreAllMocks(); });

	it("posts the card and writes the header together", async () => {
		const actor = steading();
		restore = world(actor);
		const season = WEATHER_SEASONS[0];
		const row    = season.rows[0];

		const announced = await announceWeather(season.key, { row });

		expect(announced).toBe(row);
		expect(globalThis.ChatMessage.create).toHaveBeenCalled();
		expect(actor.setFlag).toHaveBeenCalledWith(
			STONETOP_SCOPE, CURRENT_WEATHER_KEY, expect.objectContaining({ sky: row.sky }),
		);
	});

	// A refused post must not move the glyph either, or the header ends up ahead of a card that
	// never went out — the same disagreement, pointing the other way.
	it("writes nothing when there was nothing to post", async () => {
		const actor = steading();
		restore = world(actor);

		expect(await announceWeather("nope", { row: WEATHER_SEASONS[0].rows[0] })).toBeNull();
		expect(await announceWeather(WEATHER_SEASONS[0].key, {})).toBeNull();

		expect(globalThis.ChatMessage.create).not.toHaveBeenCalled();
		expect(actor.setFlag).not.toHaveBeenCalled();
	});
});

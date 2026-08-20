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
	setWeatherFxPaused,
	refreshWeatherFx,
} from "../../module/seasons/current-weather.js";
import { WEATHER_SEASONS } from "../../module/utils/weather.js";
import { FXMASTER_ID, FX_KEY_PREFIX } from "../../module/seasons/weather-fx.js";
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

	// The canvas is the third part of the act, and the one most easily left behind: the optional
	// FXMaster integration was written against `WeatherDialog._post`, which is no longer where
	// announcing happens. Driven through a stood-up FXMaster world rather than a spy on
	// applyWeatherFx, so it fails if the call is dropped OR if the scene write stops working.
	// What lands in the flag is seasons/weather-fx.test.js's business; this is the wire.
	it("puts the weather on the scene too, when FXMaster is there", async () => {
		const actor     = steading();
		const undoWorld = world(actor);
		const saved     = { modules: globalThis.game.modules, scenes: globalThis.game.scenes, user: globalThis.game.user };
		const scene     = { update: vi.fn(), getFlag: () => ({}), canUserModify: () => true };

		globalThis.game.modules  = { get: id => (id === FXMASTER_ID ? { active: true } : undefined) };
		globalThis.game.scenes   = { active: scene };
		globalThis.game.user     = {};
		globalThis.game.settings = { get: (_sys, key) => (key === "weatherSceneFx" ? true : "publicroll") };
		restore = () => { Object.assign(globalThis.game, saved); undoWorld(); };

		// A sky that DRAWS something. The book's three clear days write nothing to a clean scene,
		// so one of those here would pass whether or not the call was ever made.
		const drawn  = sky => !["sun", "heat", "cold"].includes(sky);
		const season = WEATHER_SEASONS.find(s => s.rows.some(r => drawn(r.sky)));
		const row    = season.rows.find(r => drawn(r.sky));

		await announceWeather(season.key, { row });

		expect(scene.update).toHaveBeenCalledTimes(1);
		expect(Object.keys(scene.update.mock.calls[0][0]).join(" "))
			.toContain("flags." + FXMASTER_ID + ".effects." + FX_KEY_PREFIX);
	});
});

// ── Pausing the weather on the canvas ────────────────────────────────────────
// The picker's Pause button (WeatherDialog#_toggleFx). One switch, the world setting the config
// screen already shows, and the canvas brought into line with it in the same act: flipping it
// without clearing would leave a blizzard falling under a picker that said the weather was
// paused, which is the same disagreement `announceWeather` exists to prevent.
describe("pausing the weather on the canvas", () => {
	let restore = null;
	afterEach(() => { restore?.(); restore = null; });

	// A world with FXMaster, a scene to draw on, and a steading standing under `sky` (or under
	// nothing at all, for a world where no weather has ever been posted). `sceneFx` is where the
	// switch starts. The stored value is REAL rather than a constant: what these tests are
	// mostly checking is the order of the two writes, so a `get` that could not see the `set`
	// would pass whichever way round they went.
	function fxWorld(sky, { sceneFx = true, effects = {}, off = [] } = {}) {
		const actor     = steading(sky ? { sky, text: "a line from the table" } : undefined);
		const undoWorld = world(actor);
		const saved     = { modules: globalThis.game.modules, scenes: globalThis.game.scenes, user: globalThis.game.user };
		const scene     = { update: vi.fn(), getFlag: () => effects, canUserModify: () => true };
		let stored      = sceneFx;

		globalThis.game.modules  = { get: id => (id === FXMASTER_ID ? { active: true } : undefined) };
		globalThis.game.scenes   = { active: scene };
		globalThis.game.user     = { isGM: true };
		globalThis.game.settings = {
			// `off` names the per-effect switches this world has turned off; everything else falls
			// through to the roll mode postWeather asks for, which is not false, which is on.
			get: (_sys, key) => (key === "weatherSceneFx" ? stored : (off.includes(key) ? false : "publicroll")),
			set: vi.fn((_sys, key, value) => { if (key === "weatherSceneFx") stored = value; }),
			// setWorldSetting reads the scope off the registration before it writes.
			settings: new Map([["stonetop-pwd.weatherSceneFx", { scope: "world" }]]),
		};
		restore = () => { Object.assign(globalThis.game, saved); undoWorld(); };
		return { actor, scene, settings: globalThis.game.settings };
	}

	it("takes our weather off the map and leaves everything else alone", async () => {
		const { actor, scene, settings } = fxWorld("storm", {
			effects: { [`${FX_KEY_PREFIX}rain`]: {}, core_embers: {} },
		});

		expect(await setWeatherFxPaused(true)).toBe(true);
		expect(settings.set).toHaveBeenCalledWith("stonetop-pwd", "weatherSceneFx", false);
		expect(Object.keys(scene.update.mock.calls[0][0]))
			.toEqual([`flags.${FXMASTER_ID}.effects.-=${FX_KEY_PREFIX}rain`]);
		// The sky the world is under is not what was paused. The steading still says storm, and
		// the next card still says storm; only the map goes quiet.
		expect(actor.setFlag).not.toHaveBeenCalled();
	});

	// Resuming re-derives the sky from the steading rather than from anything remembered at the
	// pause, so a GM who posted three more weathers while paused comes back to the current one.
	// This also pins the ORDER of the two writes: applyWeatherFx stands down while the switch is
	// still off, so a scene written here proves the setting went first.
	it("puts back the sky the world is actually under", async () => {
		const { scene, settings } = fxWorld("blizzard", { sceneFx: false });

		expect(await setWeatherFxPaused(false)).toBe(true);
		expect(settings.set).toHaveBeenCalledWith("stonetop-pwd", "weatherSceneFx", true);
		expect(scene.update.mock.calls[0][0])
			.toHaveProperty(`flags.${FXMASTER_ID}.effects.${FX_KEY_PREFIX}snowstorm`);
	});

	// The reconciler is what the settings' onChange reaches (through game.stonetop, since
	// settings.js cannot import this file back), and it is the whole reason unticking a switch
	// takes effect on the weather already falling rather than on the next one posted.
	it("re-lays the current sky without its switched-off parts", async () => {
		const { scene } = fxWorld("storm", { off: ["weatherFxHail"] });

		expect(await refreshWeatherFx()).toBe(true);
		const update = scene.update.mock.calls[0][0];
		expect(update).not.toHaveProperty(`flags.${FXMASTER_ID}.effects.${FX_KEY_PREFIX}hail`);
		expect(update).toHaveProperty(`flags.${FXMASTER_ID}.effects.${FX_KEY_PREFIX}rain`);
	});

	// Twice over the same canvas is one canvas. It WILL run twice — the picker's button
	// reconciles and so does the onChange the same write sets off — and our keys are one per
	// effect type, so the second run re-lays the same snow over the same key rather than hanging
	// a second snowfall beside the first. Nothing accumulates, which is the property that matters;
	// a second write is not one.
	it("cannot double the weather up by running twice", async () => {
		const flags = {};
		const { scene } = fxWorld("snow");
		scene.getFlag = () => flags;
		scene.update  = vi.fn(update => {
			for (const [key, value] of Object.entries(update)) {
				const leaf = key.split(".").pop();
				if (leaf.startsWith("-=")) delete flags[leaf.slice(2)];
				else flags[leaf] = value;
			}
		});

		await refreshWeatherFx();
		const once = JSON.stringify(flags);
		await refreshWeatherFx();

		expect(Object.keys(flags)).toEqual([`${FX_KEY_PREFIX}snow`]);
		expect(JSON.stringify(flags)).toBe(once);
	});

	// The pause direction IS write-free the second time, since the effects it takes off are gone
	// by then. That is what lets the button and the onChange both fire without a second write.
	it("finds nothing to take off a canvas already paused", async () => {
		const { scene } = fxWorld("storm", { sceneFx: false, effects: {} });
		expect(await refreshWeatherFx()).toBe(false);
		expect(scene.update).not.toHaveBeenCalled();
	});

	// No weather has ever been posted here, so there is no sky to put back. A default sun would
	// draw nothing anyway; saying so honestly is what keeps "nobody has set the weather" from
	// looking like a decision downstream.
	it("has nothing to put back in a world that has never had weather", async () => {
		const { scene } = fxWorld(null, { sceneFx: false });
		expect(await setWeatherFxPaused(false)).toBe(false);
		expect(scene.update).not.toHaveBeenCalled();
	});
});

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	SKY_EFFECTS,
	FX_KEY_PREFIX,
	FXMASTER_ID,
	FXMASTER_PLUS_ID,
	WIND_DIRECTION,
	fxMasterActive,
	weatherFxPaused,
	weatherScene,
	weatherFxUpdate,
	weatherFxClearUpdate,
	weatherFxDisabled,
	applyWeatherFx,
	clearWeatherFx,
} from "../../module/seasons/weather-fx.js";
import { WEATHER_FX_PARTS } from "../../module/seasons/weather-fx-parts.js";
import { WEATHER_SKIES } from "../../module/seasons/current-weather.js";

// The module warns through `utils/logger.js`, which captures `console.warn` when it is first
// evaluated — so a later `vi.spyOn(console, "warn")` would never see the call. Mock the seam the
// code actually uses instead.
vi.mock("../../module/utils/logger.js", async importOriginal => ({
	...(await importOriginal()),
	warn: vi.fn(),
}));
import { warn as logWarn } from "../../module/utils/logger.js";

// The optional FXMaster integration: posting a weather puts the matching particles on the scene
// the table is on. Two things are worth guarding and neither shows up in play until it is too
// late — that the effect OPTIONS are the shape FXMaster actually reads, and that switching
// weather takes the last one OFF while leaving alone whatever the GM hung on the scene themselves.

// Every particle effect FXMaster 7.5.2 registers under `CONFIG.fxmaster.particleEffects`, read off
// the shipped bundle rather than copied from the table below. That is the whole point: a list of
// the six types SKY_EFFECTS happens to use can only ever say "the table uses what the table uses",
// so it would pass unchanged on the day somebody adds a `tornado` FXMaster has never heard of.
const FX_EFFECTS = [
	"autumnleaves", "bats", "birds", "bubbles", "clouds", "crows", "eagles", "embers",
	"fog", "hail", "rain", "rats", "snow", "snowstorm", "spiders", "stars",
];

// What each effect's own parameter descriptors allow, as `[min, max]`. NOT one table for all of
// them: several effects narrow the base range hard, and those are exactly the ones this weather
// uses. `clouds` runs 0.001-0.2 against a base of 0.1-5, so a cloud density that reads sane on the
// base scale is up to sixty-six times the module's own default. Nothing in FXMaster clamps.
const BASE_RANGES = {
	density: [0.1, 5], speed: [0.1, 5], scale: [0.1, 5], lifetime: [0.1, 5], alpha: [0, 1],
	direction: [0, 360],
};
const FX_RANGES = {
	clouds:    { ...BASE_RANGES, density: [0.001, 0.2] },
	fog:       { ...BASE_RANGES, density: [0.01, 0.15] },
	hail:      { ...BASE_RANGES, density: [0.05, 2], speed: [0.1, 10] },
	snowstorm: { ...BASE_RANGES, density: [0.05, 1], speed: [0.1, 10] },
	rain:      { ...BASE_RANGES, lifetime: [2, 5] },
	snow:      BASE_RANGES,
};

// MUTATED and restored, never deleted — the same rule current-weather.test.js sets out beside its
// own `world()` helper. tests/setup.js puts the real `i18n` on `game` once for the whole run, so a
// suite that deletes the global takes it away from every suite that runs after this file.
const savedGame = { modules: undefined, scenes: undefined, user: undefined, settings: undefined };
afterEach(() => {
	for (const key of Object.keys(savedGame)) {
		if (savedGame[key] === undefined) delete globalThis.game?.[key];
		else globalThis.game[key] = savedGame[key];
		savedGame[key] = undefined;
	}
	delete globalThis.canvas;
});

describe("the sky-to-particles table", () => {
	it("covers every sky, and invents none", () => {
		expect(Object.keys(SKY_EFFECTS).sort()).toEqual(Object.keys(WEATHER_SKIES).sort());
	});

	// FXMaster 7.5.2 registers sixteen particle effects; naming one it hasn't got draws nothing
	// at all, and the scene flag would sit there looking correct.
	it("names only particle effects FXMaster ships", () => {
		for (const [sky, effects] of Object.entries(SKY_EFFECTS)) {
			for (const fx of effects) expect(FX_EFFECTS, `${sky}`).toContain(fx.type);
		}
	});

	// The trap this whole file exists for, and it runs the OPPOSITE way round to how it reads.
	// FXMaster wraps every stored option itself on the way in — `drawParticleEffects` does
	// `Object.entries(options).map(([k, v]) => [k, { value: v }])` — and only then merges the
	// result over its parameter descriptors. So a `{ value }` written here arrives as
	// `{ value: { value: … } }`: `computeMaxParticlesFromView` reads `density.value`, gets an
	// object, `Number(obj) || 0` makes it zero particles, and the speed and alpha passes multiply
	// by an object and get NaN. Nothing draws, silently, under every sky.
	it("stores every option value bare, the way FXMaster reads it", () => {
		for (const [sky, effects] of Object.entries(SKY_EFFECTS)) {
			for (const fx of effects) {
				for (const [param, value] of Object.entries(fx.options ?? {})) {
					const where = `${sky}.${fx.type}.${param}`;
					// `tint` is the exception that proves the rule: its DESCRIPTOR's value is itself
					// `{ value, apply }` and the effect reads `tint.value.apply`, so the bare form of
					// a tint is that pair.
					if (param === "tint") {
						expect(value, where).toEqual({ value: expect.any(String), apply: expect.any(Boolean) });
						continue;
					}
					expect(value, where).toBeTypeOf("number");
				}
			}
		}
	});

	// Against the range for THAT effect, not one range for all of them — see FX_RANGES.
	it("keeps every number inside the range of the effect it is set on", () => {
		for (const [sky, effects] of Object.entries(SKY_EFFECTS)) {
			for (const fx of effects) {
				const ranges = FX_RANGES[fx.type];
				expect(ranges, `no recorded ranges for ${fx.type}`).toBeTruthy();
				for (const [param, value] of Object.entries(fx.options ?? {})) {
					if (!ranges[param]) continue;   // tint, and anything without a numeric range
					const [lo, hi] = ranges[param];
					expect(value, `${sky}.${fx.type}.${param}`).toBeGreaterThanOrEqual(lo);
					expect(value, `${sky}.${fx.type}.${param}`).toBeLessThanOrEqual(hi);
				}
			}
		}
	});

	// ── One wind ─────────────────────────────────────────────────────────────────────────────
	// FXMaster's per-effect defaults assume no wind: clouds default to 90 (straight DOWN the map,
	// which is what a reader noticed and said did not look like wind at all) and rain to 75, which
	// drifts the other way. Left alone that is two winds at right angles in one sky, so these pin
	// the whole table to WIND_DIRECTION rather than to the numbers that happen to be in it.

	it("blows every cloud the way the wind blows, not down the map", () => {
		const clouds = Object.entries(SKY_EFFECTS)
			.flatMap(([sky, effects]) => effects.filter(fx => fx.type === "clouds").map(fx => [sky, fx]));
		expect(clouds.length).toBeGreaterThan(0);
		for (const [sky, fx] of clouds) expect(fx.options.direction, sky).toBe(WIND_DIRECTION);
	});

	// Not a fixed list of headings, which would only restate the table. Every one of these has to
	// lie between straight down and the wind itself: lean the wrong way and the rain crosses the
	// cloud above it, lean past the wind and it is falling upwards into it.
	it("leans everything that falls downwind, and never past the wind", () => {
		const falling = Object.entries(SKY_EFFECTS).flatMap(([sky, effects]) =>
			effects.filter(fx => ["rain", "hail", "snow", "snowstorm"].includes(fx.type)).map(fx => [sky, fx]));
		expect(falling.length).toBeGreaterThan(0);
		for (const [sky, fx] of falling) {
			const where = `${sky}.${fx.type}`;
			const lean = fx.options.direction - 90;
			expect(fx.options.direction, where).toBeTypeOf("number");
			expect(Math.sign(lean), where).toBe(Math.sign(WIND_DIRECTION - 90));
			expect(Math.abs(lean), where).toBeLessThan(Math.abs(WIND_DIRECTION - 90));
		}
	});

	// Fog keeps no heading, and that is not an oversight: its rotation spread is the whole circle,
	// so setting one would re-centre a circle and change nothing on screen.
	it("gives the haze no heading at all", () => {
		for (const [sky, effects] of Object.entries(SKY_EFFECTS)) {
			for (const fx of effects) {
				if (fx.type === "fog") expect(fx.options, sky).not.toHaveProperty("direction");
			}
		}
	});

	// The book's three clear days. Posting one has to CLEAR the canvas, which only works if the
	// table says "nothing" rather than being missing (a missing sky returns null and does not
	// write at all, leaving yesterday's storm running).
	it("draws nothing for the clear skies, and something for every other", () => {
		for (const sky of ["sun", "heat", "cold"]) expect(SKY_EFFECTS[sky], sky).toEqual([]);
		for (const [sky, effects] of Object.entries(SKY_EFFECTS)) {
			if (["sun", "heat", "cold"].includes(sky)) continue;
			expect(effects.length, sky).toBeGreaterThan(0);
		}
	});
});

describe("the scene update", () => {
	it("writes one keyed effect per particle effect", () => {
		const update = weatherFxUpdate("snow", {});
		expect(update).toEqual({
			[`flags.fxmaster.effects.${FX_KEY_PREFIX}snow`]: {
				type: "snow",
				options: { density: 1, speed: 0.9, direction: 115 },
			},
		});
	});

	// setFlag MERGES, so without the deletions yesterday's rain keeps falling under today's
	// clear sky with nothing on screen to say where it came from.
	it("deletes the effects it laid down last time", () => {
		const current = {
			[`${FX_KEY_PREFIX}rain`]:   { type: "rain" },
			[`${FX_KEY_PREFIX}clouds`]: { type: "clouds" },
		};
		const update = weatherFxUpdate("snow", current);
		expect(update[`flags.fxmaster.effects.-=${FX_KEY_PREFIX}rain`]).toBeNull();
		expect(update[`flags.fxmaster.effects.-=${FX_KEY_PREFIX}clouds`]).toBeNull();
		expect(update[`flags.fxmaster.effects.${FX_KEY_PREFIX}snow`]).toBeTruthy();
	});

	// The GM's own effects are not ours to clear. A scene with fireflies on it keeps them
	// through a change of weather.
	it("never touches an effect it doesn't own", () => {
		const update = weatherFxUpdate("sun", { core_embers: { type: "embers" }, myFireflies: {} });
		expect(update).toBeNull();

		const mixed = weatherFxUpdate("sun", { core_embers: {}, [`${FX_KEY_PREFIX}rain`]: {} });
		expect(Object.keys(mixed)).toEqual([`flags.fxmaster.effects.-=${FX_KEY_PREFIX}rain`]);
	});

	it("re-lays an effect it already had, so a re-post refreshes rather than stacking", () => {
		const update = weatherFxUpdate("snow", { [`${FX_KEY_PREFIX}snow`]: { type: "snow", options: {} } });
		expect(Object.keys(update)).toEqual([`flags.fxmaster.effects.${FX_KEY_PREFIX}snow`]);
	});

	it("has nothing to say for a clear sky over a clean scene, or an unknown sky", () => {
		expect(weatherFxUpdate("sun", {})).toBeNull();
		expect(weatherFxUpdate("drizzle", {})).toBeNull();
		expect(weatherFxUpdate("sun")).toBeNull();
	});
});

// The pause: our effects come off, and nothing else does. Same promise the post makes, which is
// why they share `dropOurs` — a pause that swept the GM's own fireflies off the scene would be
// exactly as wrong as a change of weather doing it, and there is no undo for either.
// The per-effect switches under the main one: a table that cannot stand the fog puts the fog out
// and keeps the rain. What has to hold is that the table of switches and the table of skies stay
// spent against each other, since a switch for an effect nothing draws does nothing at all and an
// effect with no switch cannot be turned off however hard the GM looks for it.
describe("the switchable parts of the sky", () => {
	const drawn = new Set(Object.values(SKY_EFFECTS).flat().map(fx => fx.type));

	it("covers every effect the skies draw, and invents none", () => {
		const switched = WEATHER_FX_PARTS.filter(part => part.type).map(part => part.type);
		expect(switched.sort()).toEqual([...drawn].sort());
	});

	// The tint is not a type but an option ON one, and it gets a row of its own because it is the
	// half of a storm that is not particles. A row with nothing to strip would be a dead switch.
	it("gives the tint its own row, and something to switch off", () => {
		const tintRows = WEATHER_FX_PARTS.filter(part => part.tint);
		expect(tintRows).toHaveLength(1);
		expect(tintRows[0].type).toBeUndefined();
		expect(Object.values(SKY_EFFECTS).flat().some(fx => fx.options?.tint)).toBe(true);
	});

	it("names each switch once", () => {
		const keys = WEATHER_FX_PARTS.map(part => part.setting);
		expect(new Set(keys).size).toBe(keys.length);
	});

	// Only an explicit false is off, so a fresh world, an older build that never registered these
	// and a test's bare settings fake all read as the whole sky.
	it("reads a switch nobody has touched as on", () => {
		globalThis.game = { settings: { get: () => undefined } };
		const off = weatherFxDisabled();
		expect(off.types.size).toBe(0);
		expect(off.tint).toBe(false);

		globalThis.game = { settings: { get: (_sys, key) => key !== "weatherFxFog" } };
		expect([...weatherFxDisabled().types]).toEqual(["fog"]);
	});
});

// What a switched-off part does to the sky that would have drawn it. Driven through the pure
// update rather than a world, so what is read is the thing that lands in the flag.
describe("the scene update with parts switched off", () => {
	const off = (types = [], tint = false) => ({ types: new Set(types), tint });

	it("leaves out the effect that was switched off, and keeps the rest of the sky", () => {
		const update = weatherFxUpdate("storm", {}, off(["hail"]));
		expect(Object.keys(update).sort()).toEqual([
			`flags.fxmaster.effects.${FX_KEY_PREFIX}clouds`,
			`flags.fxmaster.effects.${FX_KEY_PREFIX}rain`,
		]);
	});

	// The whole point of filtering the sky rather than skipping the write: an effect missing from
	// what we are laying is an effect of ours on the scene that nothing claims, so the deletion
	// pass takes it off. That is what makes unticking Fog stop the fog already on the map.
	it("takes a switched-off effect off a scene that is already drawing it", () => {
		const current = { [`${FX_KEY_PREFIX}rain`]: {}, [`${FX_KEY_PREFIX}hail`]: {}, [`${FX_KEY_PREFIX}clouds`]: {} };
		const update = weatherFxUpdate("storm", current, off(["hail"]));
		expect(update[`flags.fxmaster.effects.-=${FX_KEY_PREFIX}hail`]).toBeNull();
	});

	// The tint switches without taking the cloud with it: the storm keeps its racing ceiling and
	// gives the map back its own colours.
	it("strips the tint and leaves the cloud in the sky", () => {
		const update = weatherFxUpdate("storm", {}, off([], true));
		const clouds = update[`flags.fxmaster.effects.${FX_KEY_PREFIX}clouds`];
		expect(clouds.options.tint).toBeUndefined();
		expect(clouds.options.density).toBe(SKY_EFFECTS.storm[0].options.density);
	});

	// A dotted update path does not REPLACE the object at its end: `flags` is an ObjectField, and
	// core merges into it recursively with `performDeletions`. So an option the new sky does not
	// mention survives from the old one unless it is named for deletion — which is not a tidiness
	// point but the difference between a shower and a storm on screen.
	describe("the options it does not set", () => {
		/** The scene flag as it stands after `sky` has been laid on it. */
		const asStored = sky => Object.fromEntries(SKY_EFFECTS[sky]
			.map(fx => [`${FX_KEY_PREFIX}${fx.type}`, { type: fx.type, options: { ...fx.options } }]));

		it("names last sky's tint for deletion, so a shower is not painted storm-slate", () => {
			const update = weatherFxUpdate("rain", asStored("storm"));
			const clouds = update[`flags.fxmaster.effects.${FX_KEY_PREFIX}clouds`];
			expect(clouds.options["-=tint"]).toBeNull();
			expect(clouds.options.tint).toBeUndefined();
		});

		it("names last sky's scale for deletion, so the drops go back to their own size", () => {
			const update = weatherFxUpdate("rain", asStored("downpour"));
			const rain = update[`flags.fxmaster.effects.${FX_KEY_PREFIX}rain`];
			expect(rain.options["-=scale"]).toBeNull();
			expect(rain.options.scale).toBeUndefined();
		});

		// The switch that had nothing to switch: `keptEffects` copies the options without the tint,
		// and the merge put it straight back, so unticking "Storm Light" mid-storm did nothing.
		it("takes the tint off a storm already on the map when the switch goes off", () => {
			const update = weatherFxUpdate("storm", asStored("storm"), off([], true));
			const clouds = update[`flags.fxmaster.effects.${FX_KEY_PREFIX}clouds`];
			expect(clouds.options["-=tint"]).toBeNull();
		});

		it("leaves nothing to delete where the sky sets every option its effects can carry", () => {
			const update = weatherFxUpdate("storm", {});
			const clouds = update[`flags.fxmaster.effects.${FX_KEY_PREFIX}clouds`];
			const rain = update[`flags.fxmaster.effects.${FX_KEY_PREFIX}rain`];
			expect(Object.keys(clouds.options).filter(k => k.startsWith("-="))).toEqual([]);
			expect(Object.keys(rain.options).filter(k => k.startsWith("-="))).toEqual([]);
		});

		// Every write is a scene update, a broadcast to every client, and a teardown and rebuild of
		// every emitter on every canvas. `refreshWeatherFx` is documented safe to run twice and IS
		// run twice, and each of the eight weather switches reconciles on change.
		it("is null for a sky the scene is already holding", () => {
			expect(weatherFxUpdate("storm", asStored("storm"))).toBeNull();
			expect(weatherFxUpdate("rain", asStored("rain"))).toBeNull();
		});

		it("still writes the one effect that differs", () => {
			const current = asStored("storm");
			current[`${FX_KEY_PREFIX}rain`].options.density = 0.1;
			const update = weatherFxUpdate("storm", current);
			expect(Object.keys(update)).toEqual([`flags.fxmaster.effects.${FX_KEY_PREFIX}rain`]);
		});

		// SKY_EFFECTS is frozen only one level deep, so handing `fx.options` straight to
		// `Scene#update` put the shared table's own object into the scene's stored flag — two
		// scenes aliasing one object, and anything that wrote into it editing every future storm.
		it("hands the scene a copy, never the table's own options object", () => {
			const update = weatherFxUpdate("storm", {});
			const clouds = update[`flags.fxmaster.effects.${FX_KEY_PREFIX}clouds`];
			expect(clouds.options).not.toBe(SKY_EFFECTS.storm[0].options);
		});
	});

	// SKY_EFFECTS is the shared table every weather is built from. A filter that edited it in
	// place would put the storm's light out for the rest of the session.
	it("does not edit the sky it filtered", () => {
		weatherFxUpdate("storm", {}, off([], true));
		expect(SKY_EFFECTS.storm[0].options.tint).toBeTruthy();
		expect(weatherFxUpdate("storm", {})[`flags.fxmaster.effects.${FX_KEY_PREFIX}clouds`].options.tint).toBeTruthy();
	});

	it("draws nothing at all when every part of a sky is switched off", () => {
		expect(weatherFxUpdate("snow", {}, off(["snow"]))).toBeNull();
		const swept = weatherFxUpdate("snow", { [`${FX_KEY_PREFIX}snow`]: {} }, off(["snow"]));
		expect(Object.keys(swept)).toEqual([`flags.fxmaster.effects.-=${FX_KEY_PREFIX}snow`]);
	});

	it("draws the whole sky when nothing is switched off", () => {
		expect(weatherFxUpdate("storm", {}, off())).toEqual(weatherFxUpdate("storm", {}));
	});
});

describe("the clearing update", () => {
	it("takes off everything of ours, and nothing of anybody else's", () => {
		const update = weatherFxClearUpdate({
			[`${FX_KEY_PREFIX}clouds`]: {}, [`${FX_KEY_PREFIX}rain`]: {},
			core_embers: {}, myFireflies: {},
		});
		expect(Object.keys(update).sort()).toEqual([
			`flags.fxmaster.effects.-=${FX_KEY_PREFIX}clouds`,
			`flags.fxmaster.effects.-=${FX_KEY_PREFIX}rain`,
		]);
	});

	it("has nothing to say about a scene we never drew on", () => {
		expect(weatherFxClearUpdate({ core_embers: {} })).toBeNull();
		expect(weatherFxClearUpdate({})).toBeNull();
		expect(weatherFxClearUpdate()).toBeNull();
	});
});

describe("putting it on the scene", () => {
	function world({ active = true, sceneFx = true, canModify = true, scene = "active", off = [] } = {}) {
		const target = { update: vi.fn(), getFlag: () => ({}), canUserModify: () => canModify };
		globalThis.game = {
			modules: { get: (id) => (id === FXMASTER_ID ? { active } : undefined) },
			// `off` names the per-effect switches this world has turned off. Everything else reads
			// undefined, which is on: only an explicit false counts.
			settings: { get: (_sys, key) => (key === "weatherSceneFx" ? sceneFx : (off.includes(key) ? false : undefined)) },
			scenes: { active: scene === "active" ? target : null },
			user: {},
		};
		globalThis.canvas = { scene: scene === "canvas" ? target : null };
		return target;
	}

	it("writes the scene when everything lines up", async () => {
		const scene = world();
		expect(await applyWeatherFx("blizzard")).toBe(true);
		expect(scene.update).toHaveBeenCalledTimes(1);
		expect(scene.update.mock.calls[0][0]).toHaveProperty(`flags.fxmaster.effects.${FX_KEY_PREFIX}snowstorm`);
	});

	// Every reason to stand down is a quiet one: the card the GM asked for has already gone out.
	it("stands down without FXMaster, with the setting off, or without permission", async () => {
		for (const opts of [{ active: false }, { sceneFx: false }, { canModify: false }]) {
			const scene = world(opts);
			expect(await applyWeatherFx("blizzard"), JSON.stringify(opts)).toBe(false);
			expect(scene.update).not.toHaveBeenCalled();
		}
	});

	// The switches are read at write time, so what lands in the flag is what the world asked for.
	// The filtering itself is pinned above; this is the wire between the two.
	it("leaves out a part the world has switched off", async () => {
		const scene = world({ off: ["weatherFxHail"] });

		expect(await applyWeatherFx("storm")).toBe(true);
		const update = scene.update.mock.calls[0][0];
		expect(update).not.toHaveProperty(`flags.fxmaster.effects.${FX_KEY_PREFIX}hail`);
		expect(update).toHaveProperty(`flags.fxmaster.effects.${FX_KEY_PREFIX}rain`);
	});

	it("stands down for an unknown sky", async () => {
		const scene = world();
		expect(await applyWeatherFx("drizzle")).toBe(false);
		expect(scene.update).not.toHaveBeenCalled();
	});

	// A refused write leaves the canvas as it was, which is smaller than the console needs to
	// shout about but not so small it should vanish.
	it("warns rather than throws when the scene refuses", async () => {
		const scene = world();
		scene.update.mockRejectedValue(new Error("nope"));
		logWarn.mockClear();
		expect(await applyWeatherFx("snow")).toBe(false);
		expect(logWarn).toHaveBeenCalled();
	});

	// The scene the TABLE is on, not the one this GM happens to be looking at — a blizzard must
	// not land on next week's dungeon, where the players would never see it anyway.
	it("targets the active scene, and falls back to the viewed one", () => {
		const active = world({ scene: "active" });
		expect(weatherScene()).toBe(active);
		const viewed = world({ scene: "canvas" });
		expect(weatherScene()).toBe(viewed);
	});

	it("knows whether FXMaster is there", () => {
		world({ active: true });
		expect(fxMasterActive()).toBe(true);
		world({ active: false });
		expect(fxMasterActive()).toBe(false);
		delete globalThis.game;
		expect(fxMasterActive()).toBe(false);
	});

	// FXMaster+ is Gambit's paid build of the same module, and it keeps its effects in the same
	// scene flag. A table that bought it must not find the picker's Pause button missing, with
	// nothing on screen to say why.
	it("takes FXMaster+ for FXMaster", () => {
		globalThis.game = { modules: { get: id => (id === FXMASTER_PLUS_ID ? { active: true } : undefined) } };
		expect(fxMasterActive()).toBe(true);
		globalThis.game = { modules: { get: () => ({ active: false }) } };
		expect(fxMasterActive()).toBe(false);
	});

	it("reads the pause off the same setting the config screen shows", () => {
		world({ sceneFx: true });
		expect(weatherFxPaused()).toBe(false);
		world({ sceneFx: false });
		expect(weatherFxPaused()).toBe(true);
	});

	// The one write that must go through with the setting OFF: it is called at the moment that
	// switch goes off, so a guard on it here would refuse the only write that matters.
	it("clears the scene whether or not the setting is on", async () => {
		for (const sceneFx of [true, false]) {
			const scene = world({ sceneFx });
			scene.getFlag = () => ({ [`${FX_KEY_PREFIX}rain`]: {}, core_embers: {} });
			expect(await clearWeatherFx(), String(sceneFx)).toBe(true);
			expect(Object.keys(scene.update.mock.calls[0][0]))
				.toEqual([`flags.fxmaster.effects.-=${FX_KEY_PREFIX}rain`]);
		}
	});

	it("stands down from clearing without FXMaster, without permission, or with nothing of ours up", async () => {
		for (const opts of [{ active: false }, { canModify: false }, {}]) {
			const scene = world(opts);
			expect(await clearWeatherFx(), JSON.stringify(opts)).toBe(false);
			expect(scene.update).not.toHaveBeenCalled();
		}
	});
});

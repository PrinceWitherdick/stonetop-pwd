import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WeatherDialog } from "../../module/dialogs/WeatherDialog.js";
import { postWeather, getWeatherSeason } from "../../module/utils/weather.js";
import { FXMASTER_ID, FXMASTER_PLUS_ID } from "../../module/seasons/weather-fx.js";

// The Weather picker sits on its answer instead of firing it at chat: a roll walks a light down
// the table and LEAVES it standing on the row it gave, the GM can click a different row instead,
// and only the footer's Post button puts anything in the log. What's guarded here is that state
// machine — which row is standing, whether a die stands behind it, and what the footer offers —
// plus the one visible consequence in the card: a chosen row prints no total.
//
// Built with Object.create so nothing renders; the dialog's own methods are driven directly, the
// way tests/dialogs/love-letter-result-style.test.js drives that one.

function picker(season = "winter") {
	const dlg = Object.create(WeatherDialog.prototype);
	dlg._season = season;
	dlg._clock  = null;
	dlg._picked = null;
	dlg._spin   = null;
	dlg.element = null;          // nothing rendered, so the walk has no rows and lands at once
	dlg.render  = vi.fn();
	dlg.close   = vi.fn();
	return dlg;
}

describe("the Weather picker's standing result", () => {
	it("offers one button until something is standing", () => {
		const dlg = picker();
		expect(dlg.getData().picked).toBe(false);
		expect(dlg.getData().rows.some(r => r.isPicked)).toBe(false);
	});

	it("stands a row up when the GM picks it, with no die behind it", () => {
		const dlg = picker("winter");
		dlg._pickRow(3);
		expect(dlg._picked.index).toBe(3);
		expect(dlg._picked.roll).toBeNull();
		expect(dlg._picked.row).toBe(getWeatherSeason("winter").rows[3]);
		expect(dlg.render).toHaveBeenCalled();
	});

	it("shows the second button, and marks the row, once one is standing", () => {
		const dlg = picker("winter");
		dlg._pickRow(0);
		const data = dlg.getData();
		expect(data.picked).toBe(true);
		expect(data.rows.map(r => r.isPicked)).toEqual([true, false, false, false, false, false]);
	});

	it("ignores a row that isn't on this season's table, and a re-click of the standing one", () => {
		const dlg = picker("autumn");                 // four rows
		dlg._pickRow(9);
		expect(dlg._picked).toBeNull();
		dlg._pickRow(2);
		dlg.render.mockClear();
		dlg._pickRow(2);
		expect(dlg.render).not.toHaveBeenCalled();    // already standing there — nothing to redraw
	});

	it("drops the standing result when the season changes", async () => {
		// _pickSeason remembers the pick in world settings on its way past.
		globalThis.game = { settings: { set: vi.fn() } };
		const dlg = picker("winter");
		dlg._pickRow(5);
		await dlg._pickSeason("summer");
		expect(dlg._season).toBe("summer");
		expect(dlg._picked).toBeNull();
		delete globalThis.game;
	});
});

// The picker opens on the table the steading's clock points at, and the GM may then choose a
// different one. That choice is legal — the book puts the weather in the GM's hands — but it has
// to LOOK different from the one the world handed them, so the selection goes red once it stops
// matching the clock. Guarded here because the flag is the only thing carrying it: the stylesheet
// paints whatever `isOffClock` says.
describe("the Weather picker's season selection against the clock", () => {
	function onClock(season, weatherKey) {
		const dlg = picker(weatherKey);
		dlg._clock = { season, year: 1 };
		return dlg;
	}

	it("leaves the selection alone when it is the table the clock points at", () => {
		const dlg = onClock("autumn", "autumn");
		expect(dlg.getData().seasons.some(s => s.isOffClock)).toBe(false);
	});

	it("marks the selection, and only the selection, when it is a different table", () => {
		const dlg  = onClock("autumn", "summer");
		const data = dlg.getData();
		expect(data.seasons.filter(s => s.isOffClock).map(s => s.key)).toEqual(["summer"]);
		expect(data.seasons.find(s => s.key === "summer").isActive).toBe(true);
	});

	it("marks nothing when the world has no season stamped at all", () => {
		// Nothing to be off: `_clockLine` returns null and the clock sentence isn't printed
		// either, so a red button would be warning about a fact the window never stated.
		const dlg = picker("summer");
		expect(dlg.getData().clock).toBeNull();
		expect(dlg.getData().seasons.some(s => s.isOffClock)).toBe(false);
	});
});

describe("the Weather picker's roll", () => {
	beforeEach(() => {
		globalThis.Roll = class {
			constructor(formula) { this.formula = formula; this.total = 0; }
			async evaluate() { this.total = globalThis.__weatherFace; return this; }
		};
	});
	afterEach(() => {
		delete globalThis.Roll;
		delete globalThis.__weatherFace;
	});

	it("stands the rolled row up rather than posting it", async () => {
		globalThis.__weatherFace = 1;
		const dlg = picker("winter");
		await dlg._roll();
		expect(dlg._picked.index).toBe(0);
		expect(dlg._picked.row.text).toMatch(/Blizzard/);
		expect(dlg._picked.roll.total).toBe(1);
	});

	it("lands a range row on the row that covers the face, not on the face's index", async () => {
		globalThis.__weatherFace = 5;               // autumn: 1, 2, 3, 4-6 → the fourth row
		const dlg = picker("autumn");
		await dlg._roll();
		expect(dlg._picked.index).toBe(3);
		expect(dlg._picked.row.text).toMatch(/Crisp, breezy/);
	});

	it("re-rolls over a standing result", async () => {
		globalThis.__weatherFace = 2;
		const dlg = picker("winter");
		dlg._pickRow(5);
		await dlg._roll();
		expect(dlg._picked.index).toBe(1);
		expect(dlg._picked.roll).not.toBeNull();
	});

	it("posts the standing result and closes, and posts nothing without one", async () => {
		const dlg = picker("winter");
		await dlg._post();
		expect(dlg.close).not.toHaveBeenCalled();

		globalThis.ChatMessage = { create: vi.fn(), applyRollMode: vi.fn() };
		globalThis.game = { settings: { get: () => "publicroll" } };
		dlg._pickRow(2);
		await dlg._post();
		expect(globalThis.ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(dlg.close).toHaveBeenCalled();
		delete globalThis.ChatMessage;
		delete globalThis.game;
	});
});

// The card is the only place the difference between a rolled and a chosen result is visible, and
// it has to stay visible: printing the row's own range where the total goes ("4–6") would read as
// a die result nobody threw.
describe("the Weather card", () => {
	beforeEach(() => {
		globalThis.ChatMessage = { create: vi.fn(), applyRollMode: vi.fn() };
		globalThis.game = { settings: { get: () => "publicroll" } };
	});
	afterEach(() => {
		delete globalThis.ChatMessage;
		delete globalThis.game;
	});

	it("prints the total and the formula for a rolled result", async () => {
		const row  = getWeatherSeason("winter").rows[0];
		const sent = [];
		const roll = { total: 1, formula: "1d6", toMessage: (d) => { sent.push(d); } };
		await postWeather("winter", { row, roll });
		expect(sent).toHaveLength(1);
		expect(sent[0].flavor).toContain("stonetop-weather-number");
		expect(sent[0].flavor).toContain(">1<");
		expect(sent[0].flavor).toContain("1d6");
		expect(globalThis.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("prints neither total nor formula for a chosen one", async () => {
		const row = getWeatherSeason("autumn").rows[3];   // the 4-6 row
		await postWeather("autumn", { row });
		const [data] = globalThis.ChatMessage.create.mock.calls[0];
		expect(data.content).toContain("Crisp, breezy");
		expect(data.content).not.toContain("stonetop-weather-number");
		expect(data.content).not.toContain("stonetop-roll-formula");
		expect(globalThis.ChatMessage.applyRollMode).toHaveBeenCalled();
	});

	it("still calls out the roll-again rider on a chosen row", async () => {
		const row = getWeatherSeason("autumn").rows[2];   // "clouds on the horizon", reroll
		await postWeather("autumn", { row });
		const [data] = globalThis.ChatMessage.create.mock.calls[0];
		expect(data.content).toContain("stonetop-weather-reroll");
	});

	it("posts nothing without a season or a row", async () => {
		expect(await postWeather("nope", { row: getWeatherSeason("winter").rows[0] })).toBeNull();
		expect(await postWeather("winter", {})).toBeNull();
		expect(globalThis.ChatMessage.create).not.toHaveBeenCalled();
	});
});

// ── The canvas control ───────────────────────────────────────────────────────
// The Pause / Resume button, which is only on the window at all for a GM whose world has a
// particle module in it. Guarded here because "hidden" is the whole design: a table without
// FXMaster should never read the word FXMaster, so the thing to keep working is the ABSENCE.
describe("the Weather picker's canvas control", () => {
	// The world is COPIED and put back, not built from scratch and deleted: tests/setup.js hangs
	// the real i18n off `game` once for the whole run, and an earlier test in this file deletes
	// the global outright, so neither "it is there" nor "it is not" can be assumed on the way in.
	let saved;
	let held = false;

	afterEach(() => {
		if (!held) return;
		if (saved === undefined) delete globalThis.game;
		else globalThis.game = saved;
		held = false;
	});

	function world({ module = FXMASTER_ID, isGM = true, sceneFx = true } = {}) {
		if (!held) { saved = globalThis.game; held = true; }
		globalThis.game = {
			...(saved ?? {}),
			modules:  { get: id => (id === module ? { active: true } : undefined) },
			user:     { isGM },
			settings: {
				get: (_sys, key) => (key === "weatherSceneFx" ? sceneFx : undefined),
				set: vi.fn(),
			},
		};
	}

	it("stays off the window for a table with no particle module", () => {
		world({ module: "some-other-module" });
		expect(picker().getData().fx).toBeNull();
	});

	// A player cannot write the world setting behind it, so the button would be a lie about who
	// is in charge of the map.
	it("stays off the window for a player who somehow opened it", () => {
		world({ isGM: false });
		expect(picker().getData().fx).toBeNull();
	});

	it("offers the pause while the weather is still reaching the map", () => {
		world({ sceneFx: true });
		const fx = picker().getData().fx;
		expect(fx.paused).toBe(false);
		expect(fx.label).toMatch(/^Pause/);
	});

	// And offers the way back once it is paused. Under FXMaster+ as well: a table that bought
	// the paid build must not find the control missing with nothing on screen to say why.
	it("offers the way back once it is paused, under FXMaster+ too", () => {
		world({ module: FXMASTER_PLUS_ID, sceneFx: false });
		const fx = picker().getData().fx;
		expect(fx.paused).toBe(true);
		expect(fx.label).toMatch(/^Resume/);
	});

	// Beside it, the way out to the permanent switch. Only the wiring is checked here: what
	// happens inside core's settings window is tests/utils/open-settings.test.js's business.
	it("offers a way out to the setting behind it", async () => {
		world();
		const render = vi.fn();
		globalThis.game.settings.sheet = { render };

		await picker()._openWeatherSettings();

		expect(render).toHaveBeenCalledWith(true);
	});

	// The button acts on the canvas, not on the window. A GM stopping a blizzard mid-session
	// must not lose the row they were three seconds from posting.
	it("leaves a standing result standing", async () => {
		world();
		const dlg = picker("winter");
		dlg._pickRow(2);
		dlg.render.mockClear();

		await dlg._toggleFx();

		expect(globalThis.game.settings.set).toHaveBeenCalledWith("stonetop-pwd", "weatherSceneFx", false);
		expect(dlg._picked.index).toBe(2);
		expect(dlg.render).toHaveBeenCalled();
	});
});

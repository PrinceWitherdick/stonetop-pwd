import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeForm, stubAsk } from "../fakes/confirm.js";
import { readRepo as read } from "../fakes/css.js";

// Follow-ups from the Expedition walkthrough review, each a small fix with its own failure:
//
//  • A trip minted from the GM Toolkit with the walkthrough CLOSED opened on whatever step the
//    last trip was left on. An open window already went to the top; a closed one now does too.
//  • The Die of Fate takes advantage or disadvantage, which Make Camp tells the GM to consider
//    (Book I p.335), per step.
//  • With two GMs, each window kept its own copy of the log and the next save put it back over
//    the other's. A write from another client is now merged into the copy.
//  • Deleting a trip can take its Chronicle page with it, when the GM ticks that.

vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

const chronicle = vi.hoisted(() => ({ page: null, deleted: [] }));
vi.mock("../../module/utils/chronicle.js", async importOriginal => ({
	...(await importOriginal()),
	findExpeditionChroniclePage: () => chronicle.page,
	deleteExpeditionChroniclePage: async id => { chronicle.deleted.push(id); return true; },
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { rollDieOfFate, fateDiceFormula } = await import("../../module/utils/die-of-fate.js");
const { FATE_TABLES } = await import("../../module/data/fate-tables.js");

let store;

function dialog(trips = [{ id: "trip-1", title: "The Long Walk", createdAt: 0 }], currentId = "trip-1") {
	store.expeditionAnswers = { currentId, list: trips };
	const d = Object.create(ExpeditionDialog.prototype);
	d._rolls = {};
	d.render = vi.fn();
	return d;
}

beforeEach(() => {
	store = { expeditionAnswers: {} };
	chronicle.page = null;
	chronicle.deleted = [];
	global.game = {
		i18n: global.game.i18n,
		user: { id: "gm-a", isGM: true },
		settings: {
			settings: new Map([["stonetop-pwd.expeditionAnswers", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
	global.ui = { windows: {}, notifications: { warn: () => {}, info: () => {} } };
});

afterEach(() => vi.restoreAllMocks());

describe("a new trip opened from the toolkit", () => {
	it("starts at the top when the window was closed", async () => {
		const open = vi.spyOn(ExpeditionDialog, "open").mockImplementation(() => null);
		await ExpeditionDialog.openOnTrip({ title: "To the Barrier Pass" });
		expect(open).toHaveBeenCalledWith({ atStart: true });
	});

	it("leaves a trip that already exists on the step it was left on", async () => {
		store.expeditionAnswers = { currentId: "trip-1", list: [{ id: "trip-1", title: "", createdAt: 0 }] };
		const open = vi.spyOn(ExpeditionDialog, "open").mockImplementation(() => null);
		await ExpeditionDialog.openOnTrip({ tripId: "trip-1" });
		expect(open).toHaveBeenCalledWith({ atStart: false });
	});
});

describe("the Die of Fate at advantage", () => {
	it("rolls two dice and keeps the better, or the worse", () => {
		expect(fateDiceFormula("adv")).toBe("2d6kh1");
		expect(fateDiceFormula("dis")).toBe("2d6kl1");
		expect(fateDiceFormula("normal")).toBe("1d6");
		expect(fateDiceFormula(undefined)).toBe("1d6");
	});

	it("rolls the formula for the mode it is handed", async () => {
		const formulas = [];
		globalThis.Roll = class {
			constructor(f) { formulas.push(f); this.formula = f; this.total = 5; }
			evaluate() { return Promise.resolve(this); }
			toMessage() { return Promise.resolve(); }
		};
		await rollDieOfFate(FATE_TABLES.camp, { rollMode: "adv" });
		await rollDieOfFate(FATE_TABLES.camp);
		expect(formulas).toEqual(["2d6kh1", "1d6"]);
		delete globalThis.Roll;
	});

	it("keeps each step's choice apart, and the walkthrough rolls with it", async () => {
		const calls = [];
		globalThis.game.stonetop = { rollDieOfFate: (table, opts) => { calls.push({ table, opts }); } };
		const d = dialog();
		const steps = d._steps;
		d._fateModes = { playermoves: "adv" };

		d._step = steps.findIndex(s => s.key === "playermoves");
		await d._rollFate();
		d._step = steps.findIndex(s => s.key === "running");
		await d._rollFate();

		expect(calls[0].opts.rollMode).toBe("adv");
		expect(calls[0].table).toBe(FATE_TABLES.camp);
		expect(calls[1].opts.rollMode).toBe("normal");
	});

	it("offers the strip on a step that rolls the die, with the die's own dice on its hovers", () => {
		const d = dialog();
		d._fateModes = { playermoves: "dis" };
		expect(d._fateMode("playermoves")).toBe("dis");
		expect(d._fateMode("running")).toBe("normal");
		const hbs = read("templates/dialogs/expedition.hbs");
		expect(hbs).toContain(`{{> "stonetop.roll-mode-strip" rollMode=fateMode labelKey="stonetop.rollMode.pickerLabel" tipKey="stonetop.expedition.fateMode"}}`);
		const en = JSON.parse(read("languages/en.json")).stonetop.expedition.fateMode;
		expect(en).toEqual({ advTooltip: "Roll 2d6 and keep the higher", normalTooltip: "Roll 1d6", disTooltip: "Roll 2d6 and keep the lower" });
	});
});

describe("another GM writing the log", () => {
	const TRIP = { id: "trip-1", title: "The Long Walk", createdAt: 0 };

	// `_saveField`, the fields' own change handler, writes by path.
	beforeEach(() => {
		foundry.utils.setProperty ??= (target, path, value) => {
			const keys = path.split(".");
			const last = keys.pop();
			let at = target;
			for (const key of keys) at = (at[key] ??= {});
			at[last] = value;
			return true;
		};
	});

	function openWindow(trips = [TRIP], currentId = "trip-1") {
		const d = dialog(trips, currentId);
		d.id = "stonetop-expedition";
		d.rendered = true;
		d._log();                      // the window's own copy
		global.ui.windows = { 1: d };
		return d;
	}

	/** What another GM writes: the trip as this window first read it, with their change. */
	const theirs = (changes = {}, currentId = "trip-1", more = []) => ({ currentId, list: [{ ...TRIP, ...changes }, ...more] });

	/** Hold this client's writes in flight until they are landed, as a world-setting write round-trips. */
	function holdWrites() {
		const waiting = [];
		game.settings.set = (_ns, key, value) => new Promise(resolve => waiting.push(() => { store[key] = value; resolve(value); }));
		return { land: () => waiting.splice(0).forEach(go => go()), count: () => waiting.length };
	}

	it("takes their change and redraws", () => {
		const d = openWindow();
		ExpeditionDialog.onLogChanged(theirs({ title: "Renamed by B" }), "gm-b");
		expect(d._log().list[0].title).toBe("Renamed by B");
		expect(d.render).toHaveBeenCalled();
	});

	it("only moves its base on for its own echo", () => {
		const d = openWindow();
		const draft = d._logDraft;
		ExpeditionDialog.onLogChanged(theirs(), "gm-a");
		expect(d._logDraft).toBe(draft);
		expect(d.render).not.toHaveBeenCalled();
	});

	// Their write reached this window before ours reached the world, and ours lands last carrying
	// the copy it was sent with. Theirs used to be lost; now the merge follows ours out.
	it("keeps a note of ours still on its way, and sends the two together once it lands", async () => {
		const d = openWindow();
		const wire = holdWrites();
		const saving = d._saveField("chart.route", "Over the pass");
		ExpeditionDialog.onLogChanged(theirs({ title: "Renamed by B" }), "gm-b");
		expect(d._log().list[0]).toMatchObject({ title: "Renamed by B", chart: { route: "Over the pass" } });

		wire.land();
		await vi.waitFor(() => expect(wire.count()).toBe(1));
		wire.land();
		await saving;
		expect(store.expeditionAnswers.list[0]).toMatchObject({ title: "Renamed by B", chart: { route: "Over the pass" } });
	});

	it("sends nothing more when their write already held ours", async () => {
		const d = openWindow();
		const wire = holdWrites();
		const saving = d._saveField("chart.route", "Over the pass");
		ExpeditionDialog.onLogChanged(theirs({ chart: { route: "Over the pass" } }), "gm-b");
		wire.land();
		await saving;
		expect(wire.count()).toBe(0);
	});

	it("stays on its own trip when another GM starts one", () => {
		const d = openWindow();
		d._step = 4;
		ExpeditionDialog.onLogChanged(theirs({}, "trip-2", [{ id: "trip-2", title: "B's trip", createdAt: 1 }]), "gm-b");
		expect(d._log().currentId).toBe("trip-1");
		expect(d._log().list.map(e => e.id)).toEqual(["trip-1", "trip-2"]);
		expect(d._step).toBe(4);
	});

	it("goes to the top of the trip it falls back to when another GM deletes this one", () => {
		const other = { id: "trip-0", title: "Earlier", createdAt: -1 };
		const d = openWindow([other, TRIP]);
		d._step = 4;
		const close = vi.spyOn(d, "_closeMapWindows");
		ExpeditionDialog.onLogChanged({ currentId: "trip-0", list: [other] }, "gm-b");
		expect(d._log().currentId).toBe("trip-0");
		expect(d._step).toBe(0);
		expect(close).toHaveBeenCalled();
	});

	// A redraw would take the box being typed in, and the words with it. The merge is in place at
	// once, so the save that box makes on blur starts from it, and the redraw after keeps it.
	function typingIn(d) {
		let onBlur = null;
		const field = { tagName: "TEXTAREA", addEventListener: (_t, fn) => { onBlur = fn; } };
		d.element = [{ contains: el => el === field }];
		global.document = { activeElement: field };
		return {
			blur: async () => {
				global.document = { activeElement: null };
				onBlur();
				await new Promise(resolve => setTimeout(resolve, 0));
			},
		};
	}

	it("waits for a field being typed in, and redraws with what that field saved", async () => {
		const d = openWindow();
		const typing = typingIn(d);
		ExpeditionDialog.onLogChanged(theirs({ title: "Renamed by B" }), "gm-b");
		expect(d.render).not.toHaveBeenCalled();

		// The field's own change handler, on the way out.
		await d._saveField("chart.route", "Over the pass");
		await typing.blur();
		expect(d.render).toHaveBeenCalledTimes(1);
		expect(d._log().list[0]).toMatchObject({ title: "Renamed by B", chart: { route: "Over the pass" } });
		delete global.document;
	});

	// A render takes the field away without a blur, and has drawn the merge already.
	it("lets a render in the meantime answer the wait", async () => {
		const d = openWindow();
		const typing = typingIn(d);
		ExpeditionDialog.onLogChanged(theirs({ title: "Renamed by B" }), "gm-b");
		d._redrawOnBlur = null;        // what activateListeners does on any render
		await typing.blur();
		expect(d.render).not.toHaveBeenCalled();

		// And the next change from them is not left waiting on a blur that will never come.
		global.document = { activeElement: null };
		ExpeditionDialog.onLogChanged(theirs({ title: "Renamed again" }), "gm-b");
		expect(d.render).toHaveBeenCalledTimes(1);
		delete global.document;
	});
});

describe("deleting a trip that has a Chronicle page", () => {
	beforeEach(() => {
		global.document = { createElement: () => ({}) };
	});
	afterEach(() => { delete global.document; });

	it("offers to remove the page, unticked, only when there is one", async () => {
		const asked = stubAsk(null);
		await dialog()._askDeleteExpedition("The Long Walk", { hasPage: true });
		expect(asked.mock.calls[0][0].content.innerHTML).toContain(`name="removePage"`);
		expect(asked.mock.calls[0][0].content.innerHTML).not.toContain("checked");
		await dialog()._askDeleteExpedition("The Long Walk", { hasPage: false });
		expect(asked.mock.calls[1][0].content.innerHTML).not.toContain("removePage");
	});

	it("reads the tick off the form when the delete is pressed", async () => {
		stubAsk("delete", fakeForm({ removePage: { checked: true } }));
		expect(await dialog()._askDeleteExpedition("x", { hasPage: true })).toEqual({ removePage: true });
		stubAsk("delete", fakeForm({ removePage: { checked: false } }));
		expect(await dialog()._askDeleteExpedition("x", { hasPage: true })).toEqual({ removePage: false });
		stubAsk("keep");
		expect(await dialog()._askDeleteExpedition("x", { hasPage: true })).toBeNull();
	});

	it("lands Enter on keeping the trip", async () => {
		const asked = stubAsk(null);
		await dialog()._askDeleteExpedition("x", { hasPage: true });
		expect(asked.mock.calls[0][0].buttons.find(b => b.default).action).toBe("keep");
	});

	it("removes the page only when ticked", async () => {
		chronicle.page = { id: "p" };
		const d = dialog();
		d._closeMapWindows = async () => {};
		d._syncHeldAssets = async () => {};
		d._askDeleteExpedition = async (_label, { hasPage }) => (hasPage ? { removePage: true } : null);
		await d._deleteCurrentExpedition();
		expect(chronicle.deleted).toEqual(["trip-1"]);
		expect(store.expeditionAnswers.list).toEqual([]);
	});

	it("keeps the page when not ticked", async () => {
		chronicle.page = { id: "p" };
		const d = dialog();
		d._closeMapWindows = async () => {};
		d._syncHeldAssets = async () => {};
		d._askDeleteExpedition = async () => ({ removePage: false });
		await d._deleteCurrentExpedition();
		expect(chronicle.deleted).toEqual([]);
		expect(store.expeditionAnswers.list).toEqual([]);
	});
});

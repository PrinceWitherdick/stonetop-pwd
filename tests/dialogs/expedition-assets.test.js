import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Requisition step of the Run an Expedition walkthrough: the steading's communal assets,
// listed live, with the ones this trip leaves with ticked off.
//
// TWO RECORDS, ON PURPOSE. The steading holds where a thing IS (it wears "out on <trip>" and
// reads struck through on its own sheet until it comes home); the trip holds what it BORROWED
// (so the Chronicle page can still name the wagon after it is back in the barn). What the panel
// SHOWS is read off the steading every render, so returning a horse by clicking it on the
// steading sheet needs no second write here to stay honest.

// The route step browses the art folder on render; nothing here renders a map, but the module
// is imported. Same fake as tests/dialogs/expedition-journey.test.js.
vi.mock("../../module/book2-art/travel-map-art.js", () => ({
	browseTravelMapArt: () => Promise.resolve({ has: () => false }),
	travelMapFile:      () => Promise.resolve(null),
	resolveTravelMap:   () => Promise.resolve(null),
}));

// Which actor is the steading is a world lookup; the panel's own share is everything after it.
const world = { steading: null };
vi.mock("../../module/utils/world.js", () => ({
	getStonetopSteadingActor:       () => world.steading,
	getStonetopSteadingActorOrWarn: () => world.steading,
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { StonetopSteading } = await import("../../module/actors/steading/StonetopSteading.js");

let store;
let warned;

/** A steading actor carrying just its asset list, as tests/actors/steading do it. */
function steadingActor(assets, name = "Stonetop") {
	const actor = {
		name,
		type: "stonetop",
		system: {},
		flags: { stonetop: { steading: { assets } } },
		getFlag: (_scope, key) => (key === "steading" ? actor.flags.stonetop.steading : null),
		setFlag: vi.fn((_scope, _key, value) => { actor.flags.stonetop.steading = value; }),
		update: vi.fn(),
	};
	return actor;
}

/** The steading's stored assets, as they now stand. */
const assetsNow = () => world.steading.flags.stonetop.steading.assets;

/** The names this trip is currently holding, as the panel reads them. */
const picked = d => d._buildAssetPicker().rows.filter(r => r.ours).map(r => r.name);

/** The trip in the log, as it now stands. */
const tripNow = (i = 0) => store.expeditionAnswers.list[i];

/**
 * A dialog instance without the Application constructor, the trick the sibling expedition
 * suites use: everything under test touches only the log draft and the steading.
 */
function dialog(trips = [{ id: "trip-1", title: "The Wandering Tower", createdAt: 0 }], currentId = "trip-1") {
	store.expeditionAnswers = { currentId, list: trips };
	const d = Object.create(ExpeditionDialog.prototype);
	d._rolls = {};
	d.render = () => {};
	return d;
}

beforeEach(() => {
	store = { expeditionAnswers: {} };
	warned = [];
	world.steading = steadingActor([
		{ name: "A pair of hardy draft horses", checked: true },
		{ name: "A wagon", checked: true },
		{ name: "", checked: false },
	]);
	global.game = {
		i18n: global.game.i18n,
		user: { isGM: true },
		settings: {
			settings: new Map([["stonetop-pwd.expeditionAnswers", { scope: "world" }]]),
			get: (_ns, key) => store[key],
			set: (_ns, key, value) => { store[key] = value; return Promise.resolve(value); },
		},
	};
	global.ui = { notifications: { warn: msg => warned.push(msg), info: () => {} } };
});

describe("the Requisition step lists the steading's assets", () => {
	it("shows every named asset, on hand and ready to take", () => {
		const picker = dialog()._buildAssetPicker();

		expect(picker.hasSteading).toBe(true);
		expect(picker.steadingName).toBe("Stonetop");
		expect(picker.rows.map(r => r.name)).toEqual(["A pair of hardy draft horses", "A wagon"]);
		expect(picker.rows.every(r => r.take && !r.ours && !r.elsewhere)).toBe(true);
		expect(picker.takenCount).toBe(0);
	});

	// The index is the position in the STORED list, so the blank slot between two assets must
	// not shift the index a click sends back.
	it("carries each asset's stored index, past the blank slots", () => {
		world.steading = steadingActor([
			{ name: "Horses", checked: true },
			{ name: "", checked: false },
			{ name: "A wagon", checked: true },
		]);
		expect(dialog()._buildAssetPicker().rows.map(r => r.index)).toEqual([0, 2]);
	});

	it("marks what THIS trip is holding, and offers to send it home", () => {
		assetsNow()[1] = { name: "A wagon", checked: false, takenBy: { expedition: { id: "trip-1", title: "The Wandering Tower" } } };

		const row = dialog()._buildAssetPicker().rows.find(r => r.name === "A wagon");

		expect(row).toMatchObject({ ours: true, elsewhere: false, take: false, stateClass: "is-ours" });
		expect(picked(dialog())).toEqual(["A wagon"]);
	});

	it("locks what someone else is holding, and says where it went", () => {
		assetsNow()[1] = { name: "A wagon", checked: false, takenBy: { expedition: { id: "trip-9", title: "The Long Walk" } } };
		assetsNow()[0] = { name: "A pair of hardy draft horses", checked: false, takenBy: { name: "Wren", id: "hero1" } };

		const rows = dialog()._buildAssetPicker().rows;

		expect(rows.find(r => r.name === "A wagon")).toMatchObject({
			ours: false, elsewhere: true, stateClass: "is-elsewhere", where: "Out on The Long Walk",
		});
		expect(rows.find(r => r.name.startsWith("A pair"))).toMatchObject({
			elsewhere: true, where: "Taken by Wren",
		});
	});

	it("says so rather than throwing when the world has no steading sheet", () => {
		world.steading = null;
		expect(dialog()._buildAssetPicker()).toMatchObject({ hasSteading: false, hasRows: false, rows: [] });
	});

	it("says so when the steading lists no assets at all", () => {
		world.steading = steadingActor([{ name: "", checked: false }]);
		expect(dialog()._buildAssetPicker()).toMatchObject({ hasSteading: true, hasRows: false });
	});
});

describe("taking an asset out on this trip", () => {
	it("marks it out on the steading, named to the trip, and records it on the trip", async () => {
		const d = dialog();

		await d._toggleRequisitionedAsset(1, true);

		expect(assetsNow()[1]).toEqual({
			name: "A wagon", checked: false,
			takenBy: { expedition: { id: "trip-1", title: "The Wandering Tower" } },
		});
		expect(tripNow().requisitioned).toEqual([{ index: 1, name: "A wagon" }]);
		expect(picked(d)).toEqual(["A wagon"]);
	});

	it("calls an unnamed trip what the switcher calls it", async () => {
		const d = dialog([{ id: "trip-1", title: "", createdAt: 0 }]);

		await d._toggleRequisitionedAsset(1, true);

		expect(assetsNow()[1].takenBy.expedition.title).toBe("Expedition 1");
	});

	it("sends it home again, off both records", async () => {
		const d = dialog();
		await d._toggleRequisitionedAsset(1, true);

		await d._toggleRequisitionedAsset(1, false);

		expect(assetsNow()[1]).toEqual({ name: "A wagon", checked: true });
		expect(tripNow().requisitioned).toEqual([]);
		expect(picked(d)).toEqual([]);
	});

	// An asset returned from the steading sheet leaves the trip's record behind, so taking it
	// again here would otherwise log the one wagon twice on the one trip.
	it("records a re-taken asset once", async () => {
		const d = dialog();
		await d._toggleRequisitionedAsset(1, true);
		await new StonetopSteading(world.steading).returnAsset(1);

		await d._toggleRequisitionedAsset(1, true);

		expect(tripNow().requisitioned).toEqual([{ index: 1, name: "A wagon" }]);
	});

	it("takes nothing on a nameless slot, and writes nothing down", async () => {
		const d = dialog();

		await d._toggleRequisitionedAsset(2, true);

		expect(tripNow().requisitioned ?? []).toEqual([]);
	});

	it("ignores a click that names no asset", async () => {
		const d = dialog();
		await d._toggleRequisitionedAsset(Number.NaN, true);
		expect(assetsNow().some(a => a.takenBy)).toBe(false);
	});

	// The two records live on two documents, so a refused write on one must not leave the other
	// claiming a wagon the village still has.
	it("leaves the trip's record alone when the steading refuses the write", async () => {
		world.steading.setFlag = vi.fn(() => { throw new Error("no permission"); });
		const d = dialog();

		await d._toggleRequisitionedAsset(1, true);

		expect(tripNow().requisitioned ?? []).toEqual([]);
		expect(warned.join(" ")).toMatch(/Stonetop/);
	});

	it("warns rather than throwing when there is no steading to requisition from", async () => {
		world.steading = null;

		await dialog()._toggleRequisitionedAsset(1, true);

		expect(warned.join(" ")).toMatch(/no steading sheet/i);
	});
});

describe("renaming a trip", () => {
	// The trip's name is COPIED onto the asset so the steading sheet can name it without reading
	// the walkthrough's world setting; renaming has to carry across or the tooltip goes on
	// naming a trip the switcher no longer calls that.
	it("re-labels whatever it is holding", async () => {
		const d = dialog([{ id: "trip-1", title: "", createdAt: 0 }]);
		await d._toggleRequisitionedAsset(1, true);
		expect(assetsNow()[1].takenBy.expedition.title).toBe("Expedition 1");

		await d._saveTitle("The Wandering Tower");

		expect(assetsNow()[1].takenBy.expedition.title).toBe("The Wandering Tower");
		expect(tripNow().title).toBe("The Wandering Tower");
	});

	it("leaves another trip's assets alone", async () => {
		assetsNow()[0] = {
			name: "A pair of hardy draft horses", checked: false,
			takenBy: { expedition: { id: "trip-9", title: "The Long Walk" } },
		};
		// A trip that is really in the log, which is what makes it another trip rather than a
		// leftover: absence from the log is how a DELETED trip is recognised (see below).
		const d = dialog([
			{ id: "trip-1", title: "The Wandering Tower", createdAt: 0 },
			{ id: "trip-9", title: "The Long Walk", createdAt: 0 },
		]);

		await d._saveTitle("A New Name");

		expect(assetsNow()[0].takenBy.expedition.title).toBe("The Long Walk");
	});
});

// A trip is the only record of itself, so a trip that is gone is holding nothing. Left tagged,
// the wagon reads struck through on the steading sheet against a trip the switcher cannot show,
// and the walkthrough offers no way to bring it back: its picker only ever offers to return what
// the CURRENT trip is holding.
describe("deleting a trip", () => {
	beforeEach(() => { global.Dialog = { confirm: () => Promise.resolve(true) }; });

	it("sends home whatever it was holding", async () => {
		const d = dialog([{ id: "trip-1", title: "The Wandering Tower", createdAt: 0 }]);
		await d._toggleRequisitionedAsset(1, true);
		expect(assetsNow()[1].takenBy.expedition.id).toBe("trip-1");

		d._closeMapWindows = async () => {};
		await d._deleteCurrentExpedition();

		expect(assetsNow()[1].takenBy).toBeUndefined();
		expect(assetsNow()[1].checked).toBe(true);
	});

	// An unnamed trip is "Expedition N" by its POSITION, so deleting one renames every unnamed
	// trip after it. The copy on the asset has to follow, or it names no trip at all.
	it("re-numbers what the trips after it are holding", async () => {
		const d = dialog([
			{ id: "trip-1", title: "", createdAt: 0 },
			{ id: "trip-2", title: "", createdAt: 1 },
		], "trip-2");
		await d._toggleRequisitionedAsset(1, true);
		expect(assetsNow()[1].takenBy.expedition.title).toBe("Expedition 2");

		// Switch to the EARLIER trip and delete that one, so the holder is the trip that shifts up.
		d._log().currentId = "trip-1";
		d._closeMapWindows = async () => {};
		await d._deleteCurrentExpedition();

		// trip-2 is the only trip left, so it is Expedition 1 now.
		expect(assetsNow()[1].takenBy.expedition.title).toBe("Expedition 1");
	});
});

describe("the panel is wired to the step, and to the handler", () => {
	const read = rel => fs.readFileSync(
		path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", rel), "utf8");
	const DIALOG_JS = read("module/dialogs/ExpeditionDialog.js");
	const HBS = read("templates/dialogs/expedition.hbs");
	const CSS = read("styles/stonetop.css");

	it("is built on the Requisition step, and only for a GM", () => {
		// Taking one writes to the steading sheet, and the panel reads a document a player has
		// no business editing, so it is built behind the same guard as the party-load readout.
		expect(DIALOG_JS).toContain('if (step.key === "requisition" && game.user?.isGM)');
		const step = Object.create(ExpeditionDialog.prototype)._steps.find(s => s.key === "requisition");
		expect(step).toBeTruthy();
	});

	// The row decides what its own click means (take, or send home) when it is built. The
	// template has to pass that decision back, or every click would mean the same thing.
	it("passes each row's index and meaning back to the handler", () => {
		expect(HBS).toContain('data-asset-index="{{index}}" data-take="{{take}}"');
		expect(HBS).toContain('class="stonetop-exp-asset-btn"');
		expect(DIALOG_JS).toContain('html.find(".stonetop-exp-asset-btn").on("click"');
		expect(DIALOG_JS).toContain('ev.currentTarget.dataset.take === "true"');
	});

	it("styles the three states the rows are built with", () => {
		for (const cls of [".stonetop-exp-assets", ".stonetop-exp-asset-btn", ".stonetop-exp-asset.is-ours", ".stonetop-exp-asset.is-elsewhere"])
			expect(CSS, cls).toContain(cls);
	});
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeForm, stubAsk } from "../fakes/confirm.js";
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
	isSteadingActor: a => a?.type === "stonetop" || a?.system?.customType === "stonetop",
}));

// The Requisition roll's chat card, caught rather than posted: what matters here is the formula
// the walkthrough hands it, which is where advantage shows.
const seasons = vi.hoisted(() => ({ calls: [] }));
vi.mock("../../module/utils/roll-engine.js", async importOriginal => ({
	...(await importOriginal()),
	rollSeasonsCard: async opts => {
		seasons.calls.push(opts);
		return { total: 8, tier: "partial", label: "7&ndash;9" };
	},
}));

const { ExpeditionDialog } = await import("../../module/dialogs/ExpeditionDialog.js");
const { StonetopSteading, HERD_ASSET_NAME } = await import("../../module/actors/steading/StonetopSteading.js");

let store;
let warned;

/** A steading actor carrying just its asset list, as tests/actors/steading do it. */
function steadingActor(assets, name = "Stonetop") {
	const actor = {
		name,
		type: "stonetop",
		system: {},
		// The walkthrough is the GM's, and the GM owns the steading.
		isOwner: true,
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

// The user's ruling, "Ask, take from herd": the Herd of Horses' row is not lent out whole. How
// many horses go is asked, they leave the herd's count, and the trip records that many.
describe("taking horses from the herd", () => {
	beforeEach(() => {
		world.steading = steadingActor([
			{ name: HERD_ASSET_NAME, checked: true, beast: { slug: "horse", herd: true } },
			{ name: "A wagon", checked: true },
		]);
		Object.assign(world.steading.flags.stonetop.steading, {
			improvements: { herdOfHorses: { completed: true } },
			herd: { grown: 8, yearlings: 0, foals: 0 },
		});
	});

	it("asks how many, takes them out of the herd, and records them, leaving the herd's row home", async () => {
		const asked = stubAsk("take", fakeForm({ horses: { value: "3" } }));
		const d = dialog();

		await d._toggleRequisitionedAsset(0, true);

		expect(asked).toHaveBeenCalledTimes(1);
		expect(asked.mock.calls[0][0].content).toContain(`max="8" value="2"`);
		expect(world.steading.update).toHaveBeenCalledWith(
			{ "flags.stonetop-pwd.steading.herd": { grown: 5, yearlings: 0, foals: 0 } }, { stonetopMove: "Requisition" });
		expect(assetsNow()[0].takenBy).toBeUndefined();
		expect(tripNow().requisitioned).toEqual([{ name: "3 horses from the herd", herd: 3 }]);
	});

	it("shows the herd's row ticked with the trip's horses, and a click then puts them back", async () => {
		stubAsk("take", fakeForm({ horses: { value: "3" } }));
		const d = dialog();
		await d._toggleRequisitionedAsset(0, true);

		const row = d._buildAssetPicker().rows[0];
		expect(row).toMatchObject({ ours: true, take: false, name: `${HERD_ASSET_NAME} (3 with this trip)` });

		world.steading.update.mockClear();
		await d._toggleRequisitionedAsset(0, false);
		// The fake herd still reads 8 grown (its update writes nothing back), so 8 + 3.
		expect(world.steading.update).toHaveBeenCalledWith(
			{ "flags.stonetop-pwd.steading.herd": { grown: 11, yearlings: 0, foals: 0 } }, { stonetopMove: "Requisition" });
		expect(tripNow().requisitioned).toEqual([]);
		expect(d._buildAssetPicker().rows[0]).toMatchObject({ ours: false, take: true, name: HERD_ASSET_NAME });
	});

	it("reads a herd line written before the count was kept, by its label", async () => {
		const d = dialog([{ id: "trip-1", title: "T", createdAt: 0, requisitioned: [{ name: "2 horses from the herd" }, { name: "A horse from the herd" }] }]);
		expect(d._buildAssetPicker().rows[0].name).toBe(`${HERD_ASSET_NAME} (3 with this trip)`);
	});

	it("writes nothing when none are taken", async () => {
		stubAsk("none");
		const d = dialog();
		await d._toggleRequisitionedAsset(0, true);
		expect(world.steading.update).not.toHaveBeenCalled();
		expect(tripNow().requisitioned ?? []).toEqual([]);
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
		expect(tripNow().requisitioned).toEqual([{ name: "A wagon" }]);
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

		expect(tripNow().requisitioned).toEqual([{ name: "A wagon" }]);
	});

	it("takes nothing on a nameless slot, and writes nothing down", async () => {
		const d = dialog();

		await d._toggleRequisitionedAsset(2, true);

		expect(tripNow().requisitioned ?? []).toEqual([]);
	});

	// AN ASSET'S INDEX IS ITS POSITION, AND POSITIONS MOVE. The steading sheet's delete splices
	// the array, so a trip's record — which lives in the expedition log, a different document —
	// came to name a different asset entirely. The record went stale in both directions at once:
	// sending the wagon home stopped clearing it, so the Chronicle kept claiming a wagon that was
	// back in the barn.
	it("still sends the right asset home after a row above it was deleted", async () => {
		const d = dialog();
		await d._toggleRequisitionedAsset(1, true);          // the wagon, at index 1
		expect(tripNow().requisitioned).toEqual([{ name: "A wagon" }]);

		// The GM deletes the horses off the steading sheet; the wagon slides to index 0.
		assetsNow().splice(0, 1);
		expect(assetsNow()[0].name).toBe("A wagon");

		await d._toggleRequisitionedAsset(0, false);

		expect(tripNow().requisitioned).toEqual([]);
		expect(assetsNow()[0]).toEqual({ name: "A wagon", checked: true });
	});

	// The other half of the same drift: the freed-up index was matched by the ORPHAN record, so
	// the dedupe swallowed the next asset to land there and the trip's list named neither.
	it("records a different asset that lands on the freed-up index", async () => {
		const d = dialog();
		await d._toggleRequisitionedAsset(1, true);          // the wagon, at index 1

		// Delete the horses; the wagon slides to 0 and a new asset takes index 1.
		assetsNow().splice(0, 1);
		assetsNow()[1] = { name: "A river boat", checked: true };

		await d._toggleRequisitionedAsset(1, true);

		expect(tripNow().requisitioned).toEqual([{ name: "A wagon" }, { name: "A river boat" }]);
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
	// Answer the "Delete this expedition?" window with the delete.
	const answerDelete = d => { d._askDeleteExpedition = async () => true; return d; };

	it("sends home whatever it was holding", async () => {
		const d = dialog([{ id: "trip-1", title: "The Wandering Tower", createdAt: 0 }]);
		await d._toggleRequisitionedAsset(1, true);
		expect(assetsNow()[1].takenBy.expedition.id).toBe("trip-1");

		answerDelete(d)._closeMapWindows = async () => {};
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
		answerDelete(d)._closeMapWindows = async () => {};
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
		expect(HBS).toContain('data-asset-index="{{this.index}}" data-take="{{this.take}}"');
		expect(HBS).toContain('class="stonetop-exp-asset-btn"');
		expect(DIALOG_JS).toContain('html.find(".stonetop-exp-asset-btn").on("click"');
		expect(DIALOG_JS).toContain('ev.currentTarget.dataset.take === "true"');
	});

	it("styles the three states the rows are built with", () => {
		for (const cls of [".stonetop-exp-assets", ".stonetop-exp-asset-btn", ".stonetop-exp-asset.is-ours", ".stonetop-exp-asset.is-elsewhere"])
			expect(CSS, cls).toContain(cls);
	});
});

// Each click reads the log and the steading's whole asset list, awaits the steading write, then
// writes both back whole. Two clicks inside one round trip used to start from the same snapshot,
// and the second put back a list without the first.
describe("two assets taken in quick succession", () => {
	it("keeps both, on the steading and on the trip", async () => {
		const actor = world.steading;
		actor.setFlag = vi.fn(async (_scope, _key, value) => {
			await new Promise(resolve => setTimeout(resolve, 5));
			actor.flags.stonetop.steading = value;
		});
		const d = dialog();

		await Promise.all([d._toggleRequisitionedAsset(0, true), d._toggleRequisitionedAsset(1, true)]);

		expect(assetsNow()[0].takenBy?.expedition?.id).toBe("trip-1");
		expect(assetsNow()[1].takenBy?.expedition?.id).toBe("trip-1");
		expect(tripNow().requisitioned.map(r => r.name)).toEqual(["A pair of hardy draft horses", "A wagon"]);
	});

	it("still runs the next click after one that failed", async () => {
		const d = dialog();
		const first = d._toggleRequisitionedAsset(0, true);
		world.steading.setFlag = vi.fn(() => { throw new Error("refused"); });
		await first;
		world.steading.setFlag = vi.fn((_scope, _key, value) => { world.steading.flags.stonetop.steading = value; });
		await d._toggleRequisitionedAsset(1, true);
		expect(assetsNow()[1].takenBy?.expedition?.id).toBe("trip-1");
	});
});

// Requisition is a +Fortunes roll like any other: the steading sheet nets the chosen mode against
// every rule's advantage and SPENDS a held one (Rites of the Land). Rolled from here it used to
// be a plain 2d6 that left the hold waiting for a roll it was never promised to.
describe("rolling Requisition", () => {
	beforeEach(() => {
		seasons.calls = [];
		global.Roll = class {};
	});

	const held = () => world.steading.flags.stonetop.steading.fortunesAdvantage ?? null;

	it("rolls 2d6 when nothing gives advantage", async () => {
		await dialog()._rollRequisition();
		expect(seasons.calls[0].formula).toMatch(/^2d6 /);
	});

	it("rolls at advantage when the GM picks it", async () => {
		const d = dialog();
		d._reqMode = "adv";
		await d._rollRequisition();
		expect(seasons.calls[0].formula).toMatch(/^3d6kh2 /);
	});

	// The Marshal's Logistics: "when you Requisition, you have advantage".
	it("asks the Logistics line only once a character has it learned, and names them", () => {
		const move = (name, learned = true) => ({ type: "move", name, flags: learned ? {} : { "stonetop-pwd": { learned: false } } });
		global.game.actors = [
			{ type: "character", name: "Wren", items: [move("Logistics")] },
			{ type: "character", name: "Ash", items: [move("Logistics", false)] },
			{ type: "npc", name: "Quartermaster", items: [move("Logistics")] },
		];
		expect(dialog()._requisitionQuestions().logistics).toMatch(/^Logistics \(Wren\): they are the one Requisitioning, advantage$/);
		global.game.actors = [{ type: "character", name: "Ash", items: [move("Logistics", false)] }];
		expect(dialog()._requisitionQuestions().logistics).toBe("");
	});

	it("rolls at advantage with the Logistics line ticked, and names it on the card", async () => {
		const d = dialog();
		d.element = [{ querySelector: sel => (sel === '[name="logistics"]' ? { checked: true } : null) }];
		await d._rollRequisition();
		expect(seasons.calls[0].formula).toMatch(/^3d6kh2 /);
		expect(seasons.calls[0].conditionNotes).toEqual(["Logistics: advantage"]);
	});

	it("rolls a plain 2d6 with the Logistics line unticked", async () => {
		const d = dialog();
		d.element = [{ querySelector: sel => (sel === '[name="logistics"]' ? { checked: false } : null) }];
		await d._rollRequisition();
		expect(seasons.calls[0].formula).toMatch(/^2d6 /);
	});

	it("applies the steading's held advantage, spends it, and names it on the card", async () => {
		world.steading.flags.stonetop.steading.fortunesAdvantage = { source: "Rites of the Land" };
		await dialog()._rollRequisition();
		expect(seasons.calls[0].formula).toMatch(/^3d6kh2 /);
		expect(seasons.calls[0].conditionNotes).toEqual(["Rites of the Land: advantage"]);
		expect(held()).toBeNull();
	});

	it("nets a chosen disadvantage against the held advantage, and still spends the hold", async () => {
		world.steading.flags.stonetop.steading.fortunesAdvantage = { source: "Rites of the Land" };
		const d = dialog();
		d._reqMode = "dis";
		await d._rollRequisition();
		expect(seasons.calls[0].formula).toMatch(/^2d6 /);
		expect(held()).toBeNull();
	});

	it("starts on the steading's own sticky roll modifier", () => {
		const getFlag = world.steading.getFlag;
		world.steading.getFlag = (scope, key) => (key === "rollMode" ? "dis" : getFlag(scope, key));
		expect(dialog()._requisitionMode()).toBe("dis");
	});

	// One trip's Requisition total is no answer to the next trip's.
	it("keeps the result with the trip it was rolled for", async () => {
		const d = dialog([
			{ id: "trip-1", title: "The Wandering Tower", createdAt: 0 },
			{ id: "trip-2", title: "The Long Walk", createdAt: 1 },
		]);
		await d._rollRequisition();
		expect(d._rolls[d._rollKey("requisition")]?.total).toBe(8);
		d._log().currentId = "trip-2";
		expect(d._rolls[d._rollKey("requisition")]).toBeUndefined();
		d._log().currentId = "trip-1";
		expect(d._rolls[d._rollKey("requisition")]?.total).toBe(8);
	});
});

// A bare Yes/No under "its notes can't be recovered" doesn't say what it agrees to.
describe("asking before a trip is deleted", () => {
	beforeEach(() => {
		global.document = { createElement: () => ({}) };
	});

	it("names both outcomes, the delete first", async () => {
		const wait = stubAsk("keep");
		await dialog()._askDeleteExpedition("The Wandering Tower");
		const asked = wait.mock.calls[0][0];
		expect(asked.buttons.map(b => b.label)).toEqual(["Delete the expedition", "Keep it"]);
		expect(asked.buttons.find(b => b.default).action).toBe("keep");
		expect(asked.classes).toContain("stonetop");
		expect(asked.content.innerHTML).toContain("<strong>The Wandering Tower</strong>");
	});

	// The delete button answers with what was ticked; Keep it and a closed window, null.
	it("deletes only on the delete", async () => {
		stubAsk("delete", fakeForm());
		expect(await dialog()._askDeleteExpedition("x")).toEqual({ removePage: false, removeRows: false, herdBack: false, stopSharing: false });
		stubAsk("keep");
		expect(await dialog()._askDeleteExpedition("x")).toBeNull();
		stubAsk(null);
		expect(await dialog()._askDeleteExpedition("x")).toBeNull();
	});

	it("keeps the trip when the answer is Keep it", async () => {
		const d = dialog();
		d._askDeleteExpedition = async () => null;
		await d._deleteCurrentExpedition();
		expect(store.expeditionAnswers.list.map(t => t.id)).toEqual(["trip-1"]);
	});
});

// ── The expedition audit's preparation fixes (2026-11-03) ──────────────────────────
/** Answer a run of askWithButtons windows in order, one key each (null closes it). */
function stubAsks(keys, form = null) {
	const queue = [...keys];
	const wait = vi.fn(async config => {
		const key = queue.shift() ?? null;
		const button = config.buttons?.find(b => b.action === key);
		if (!button) return null;
		return button.callback ? button.callback(null, { form }) : key;
	});
	globalThis.foundry.applications ??= {};
	globalThis.foundry.applications.api ??= {};
	globalThis.foundry.applications.api.DialogV2 = { wait };
	return wait;
}

const repoFile = rel => fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", rel), "utf8");

describe("PREP-2: a click names the asset its row was drawn for", () => {
	it("refuses, and redraws, a take whose row moved under it", async () => {
		const d = dialog();
		d.render = vi.fn();
		await d._toggleRequisitionedAsset(0, true, "A wagon");
		expect(assetsNow().some(a => a.takenBy)).toBe(false);
		expect(warned.join(" ")).toMatch(/isn't where this list had it/);
		expect(d.render).toHaveBeenCalled();
	});

	it("refuses a return whose row moved, rather than sending another asset home", async () => {
		assetsNow()[0] = { name: "A pair of hardy draft horses", checked: false, takenBy: { name: "Wren", id: "hero1" } };
		const d = dialog();
		await d._toggleRequisitionedAsset(0, false, "A wagon");
		expect(assetsNow()[0].takenBy).toEqual({ name: "Wren", id: "hero1" });
	});

	it("says so when the asset went out with someone else meanwhile", async () => {
		assetsNow()[1] = { name: "A wagon", checked: false, takenBy: { name: "Wren" } };
		const d = dialog();
		d.render = vi.fn();
		await d._toggleRequisitionedAsset(1, true, "A wagon");
		expect(warned.join(" ")).toMatch(/no longer on hand/);
		expect(tripNow().requisitioned ?? []).toEqual([]);
	});

	it("hands each row's own name back from the template", () => {
		expect(repoFile("templates/dialogs/expedition.hbs")).toContain(`data-asset-name="{{this.assetName}}"`);
		expect(dialog()._buildAssetPicker().rows[1].assetName).toBe("A wagon");
	});
});

describe("PREP-4: a walkthrough take after a 6- costs 1 Fortunes", () => {
	it("asks, takes, pays and latches the trip's own card", async () => {
		world.steading.system = { stats: { fortunes: { value: 1 } } };
		const flags = {};
		const card = {
			getFlag: (scope, key) => flags[key], setFlag: vi.fn(async (s, k, v) => { flags[k] = v; }), unsetFlag: vi.fn(),
		};
		global.game.messages = { get: id => (id === "m1" ? card : null) };
		const d = dialog();
		d._rolls[d._rollKey("requisition")] = { total: 4, tier: "failure", messageId: "m1", herdCount: 0 };
		stubAsks(["take"]);

		await d._toggleRequisitionedAsset(1, true, "A wagon");

		expect(assetsNow()[1].takenBy?.expedition?.id).toBe("trip-1");
		expect(world.steading.update.mock.calls.at(-1)[0]["system.stats.fortunes.value"]).toBe(0);
		expect(flags.requisitionMissCostApplied).toBe(true);
	});

	it("takes nothing when the GM leaves it", async () => {
		global.game.messages = { get: () => ({ getFlag: () => undefined }) };
		const d = dialog();
		d._rolls[d._rollKey("requisition")] = { total: 4, tier: "failure", messageId: "m1" };
		stubAsks(["leave"]);
		await d._toggleRequisitionedAsset(1, true, "A wagon");
		expect(assetsNow()[1].takenBy).toBeUndefined();
	});
});

describe("PREP-6: the herd take is capped at the count the roll was made for", () => {
	it("offers no more horses than this trip's roll asked about", async () => {
		world.steading = steadingActor([{ name: HERD_ASSET_NAME, checked: true, beast: { slug: "horse", herd: true } }]);
		Object.assign(world.steading.flags.stonetop.steading, { improvements: { herdOfHorses: { completed: true } }, herd: { grown: 10, yearlings: 0, foals: 0 } });
		const d = dialog();
		d._rolls[d._rollKey("requisition")] = { total: 9, tier: "partial", herdCount: 3 };
		const wait = stubAsks(["none"]);
		await d._toggleRequisitionedAsset(0, true);
		expect(wait.mock.calls[0][0].content).toContain(`max="3"`);
	});
});

describe("PREP-10 / E7: Surplus loaded for the trip", () => {
	beforeEach(() => {
		world.steading.flags.stonetop.steading.system = { attributes: { surplus: { value: 2 } } };
		world.steading.update = vi.fn(async data => {
			const v = data["flags.stonetop-pwd.steading.system.attributes.surplus.value"];
			if (v !== undefined) world.steading.flags.stonetop.steading.system.attributes.surplus.value = v;
		});
	});

	it("moves one Surplus from the steading onto the trip, and back", async () => {
		const d = dialog();
		await d._stepTripSurplus(1);
		expect(world.steading.update.mock.calls[0]).toEqual([
			{ "system.attributes.surplus.value": 1, "flags.stonetop-pwd.steading.system.attributes.surplus.value": 1 },
			{ stonetopMove: "Requisition" },
		]);
		expect(tripNow().surplusOut).toBe(1);
		expect(d._buildAssetPicker().surplus).toMatchObject({ out: 1, onHand: 1, canLoad: true, canUnload: true });

		await d._stepTripSurplus(-1);
		expect(tripNow().surplusOut).toBe(0);
		expect(world.steading.flags.stonetop.steading.system.attributes.surplus.value).toBe(2);
	});

	it("puts the Surplus back when the trip went before its load was written", async () => {
		const d = dialog();
		d._log();
		// Another GM deletes the trip while the steading write is on its way.
		world.steading.update.mockImplementationOnce(async data => {
			world.steading.flags.stonetop.steading.system.attributes.surplus.value = data["system.attributes.surplus.value"];
			d._logDraft = { currentId: null, list: [] };
		});
		await d._stepTripSurplus(1);
		expect(world.steading.update.mock.calls.map(c => c[0]["system.attributes.surplus.value"])).toEqual([1, 2]);
		expect(d._log().list).toEqual([]);
	});

	it("loads nothing when the steading has none left", async () => {
		world.steading.flags.stonetop.steading.system.attributes.surplus.value = 0;
		const d = dialog();
		await d._stepTripSurplus(1);
		expect(world.steading.update).not.toHaveBeenCalled();
		expect(warned.join(" ")).toMatch(/no Surplus left/);
	});

	it("starts Days on the Road with the pack-animal tick on once Surplus is loaded", () => {
		expect(repoFile("module/dialogs/RoadRationsDialog.js")).toContain("this._packAnimal = !!packAnimal;");
		expect(repoFile("module/dialogs/ExpeditionDialog.js")).toContain("const packAnimal = (Number(this._currentExpedition()?.surplusOut) || 0) > 0;");
	});
});

describe("WLK-4 / PREP-3 / E2: Going home lists what is still out", () => {
	const out = { expedition: { id: "trip-1", title: "The Wandering Tower" } };

	it("lists this trip's assets and its herd lines still out, and nothing of another trip's", () => {
		assetsNow()[1] = { name: "A wagon", checked: false, takenBy: { name: "Wren", id: "hero1", ...out } };
		assetsNow()[0] = { name: "A pair of hardy draft horses", checked: false, takenBy: { expedition: { id: "trip-9", title: "x" } } };
		const d = dialog([{ id: "trip-1", title: "T", createdAt: 0, requisitioned: [
			{ name: "A wagon" }, { name: "2 horses from the herd", herd: 2 }, { name: "A horse from the herd", herd: 1, home: true, back: 1 },
		] }]);
		const home = d._buildHomeAssets();
		expect(home.rows).toEqual([{ index: 1, name: "A wagon", with: "Wren" }]);
		expect(home.herd).toEqual([{ at: 1, name: "2 horses from the herd", count: 2 }]);
		expect(home.hasAny).toBe(true);
	});

	it("brings an asset home", async () => {
		assetsNow()[1] = { name: "A wagon", checked: false, takenBy: out };
		await dialog()._settleHomeAsset({ action: "home", index: "1", name: "A wagon" });
		expect(assetsNow()[1]).toEqual({ name: "A wagon", checked: true });
	});

	it("loses an asset: off the list, kept on the trip marked lost, and Meets with Disaster when asked to", async () => {
		world.steading.system = { stats: { fortunes: { value: 1 } } };
		assetsNow()[1] = { name: "A wagon", checked: false, takenBy: out };
		const d = dialog([{ id: "trip-1", title: "T", createdAt: 0, requisitioned: [{ name: "A wagon" }] }]);
		const wait = stubAsks(["disaster"]);
		await d._settleHomeAsset({ action: "lost", index: "1", name: "A wagon" });
		expect(wait.mock.calls[0][0].buttons.map(b => b.label)).toEqual(["Lost it: Meet with Disaster", "Lost it, but no disaster", "Keep it out for now"]);
		expect(assetsNow().map(a => a.name)).not.toContain("A wagon");
		expect(tripNow().requisitioned).toEqual([{ name: "A wagon", lost: true }]);
		expect(world.steading.update.mock.calls.at(-1)[0]["system.stats.fortunes.value"]).toBe(0);
	});

	it("keeps the asset out when the GM closes the ask", async () => {
		assetsNow()[1] = { name: "A wagon", checked: false, takenBy: out };
		stubAsks([null]);
		await dialog()._settleHomeAsset({ action: "lost", index: "1", name: "A wagon" });
		expect(assetsNow()[1].takenBy).toEqual(out);
	});

	it("counts herd horses home: those back go in the herd, and the line is settled", async () => {
		world.steading = steadingActor([{ name: HERD_ASSET_NAME, checked: true, beast: { slug: "horse", herd: true } }]);
		Object.assign(world.steading.flags.stonetop.steading, { improvements: { herdOfHorses: { completed: true } }, herd: { grown: 5, yearlings: 0, foals: 0 } });
		const d = dialog([{ id: "trip-1", title: "T", createdAt: 0, requisitioned: [{ name: "3 horses from the herd", herd: 3 }] }]);
		const wait = stubAsks(["back", "lost"], fakeForm({ horses: { value: "2" } }));
		await d._settleHomeAsset({ action: "herd", at: "0" });
		expect(world.steading.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.steading.herd": { grown: 7, yearlings: 0, foals: 0 } }, { stonetopMove: "Requisition" });
		expect(tripNow().requisitioned).toEqual([{ name: "3 horses from the herd", herd: 3, home: true, back: 2 }]);
		expect(d._buildHomeAssets().herd).toEqual([]);
		// One horse lost: asked whether it Meets with Disaster, and "No disaster" writes no Fortunes.
		expect(wait).toHaveBeenCalledTimes(2);
		expect(wait.mock.calls[1][0].content).toContain("A horse from the herd didn't come home");
	});

	it("counts a herd line home once on a double press", async () => {
		world.steading = steadingActor([{ name: HERD_ASSET_NAME, checked: true, beast: { slug: "horse", herd: true } }]);
		Object.assign(world.steading.flags.stonetop.steading, { improvements: { herdOfHorses: { completed: true } }, herd: { grown: 5, yearlings: 0, foals: 0 } });
		const d = dialog([{ id: "trip-1", title: "T", createdAt: 0, requisitioned: [{ name: "3 horses from the herd", herd: 3 }] }]);
		const wait = stubAsks(["back", "back"], fakeForm({ horses: { value: "3" } }));
		await Promise.all([d._settleHomeAsset({ action: "herd", at: "0" }), d._settleHomeAsset({ action: "herd", at: "0" })]);
		expect(wait).toHaveBeenCalledTimes(1);
		const herdWrites = world.steading.update.mock.calls.filter(c => c[0]["flags.stonetop-pwd.steading.herd"]);
		expect(herdWrites.map(c => c[0]["flags.stonetop-pwd.steading.herd"])).toEqual([{ grown: 8, yearlings: 0, foals: 0 }]);
		// Once the first press has landed the button works again, and the line is settled.
		await d._settleHomeAsset({ action: "herd", at: "0" });
		expect(wait).toHaveBeenCalledTimes(1);
	});

	it("renders the list with outcome buttons and the clear-your-marks line, from the home step", async () => {
		const html = await global.renderTemplate("systems/stonetop-pwd/templates/dialogs/partials/expedition-home-assets.hbs", {
			homeAssets: { hasSteading: true, hasAny: true, steadingName: "Stonetop", rows: [{ index: 1, name: "A wagon", with: "Wren" }], herd: [{ at: 0, name: "2 horses from the herd", count: 2 }] },
		});
		expect(html).toContain("Still out with this trip");
		expect(html).toContain(`data-action="home" data-index="1" data-name="A wagon"`);
		expect(html).toContain("Lost it (Meet with Disaster)");
		expect(html).toContain(`data-action="herd" data-at="0"`);
		expect(html).toContain("(with Wren)");
		expect(html).toContain("clears the marks from their Inventory insert (p.89)");
		expect(repoFile("templates/dialogs/expedition.hbs")).toContain(`{{> "stonetop.expedition-home-assets" homeAssets=homeAssets}}`);
	});
});

describe("PREP-12: the roll reads Fortunes as the steading does", () => {
	it("reads the mirrored copy first", () => {
		world.steading.system = { stats: { fortunes: { value: 0 } } };
		world.steading.flags.stonetop.steading.system = { stats: { fortunes: { value: 2 } } };
		expect(dialog()._steadingFortunes()).toBe(2);
	});
});

describe("PREP-2: the asset list is live from the steading", () => {
	it("redraws the Requisition step when the steading changes under it", () => {
		vi.useFakeTimers();
		const on = vi.fn(() => 7);
		const prevHooks = global.Hooks;
		global.Hooks = { ...prevHooks, on, off: vi.fn() };
		try {
			const d = dialog();
			d._stepNav = () => ({ step: { key: "requisition" } });
			d.rendered = true;
			d._redrawWhenFree = vi.fn();
			d._wireLoadWatch();
			expect(on).toHaveBeenCalledWith("updateActor", expect.any(Function));
			const watch = on.mock.calls[0][1];
			watch({ type: "character" }, {}, {});
			watch(world.steading, {}, {});
			vi.runAllTimers();
			expect(d._redrawWhenFree).toHaveBeenCalledTimes(1);
		} finally {
			global.Hooks = prevHooks;
			vi.useRealTimers();
		}
	});
});

describe("PREP-5: the Chronicle names a player's own take", () => {
	it("adds an asset the steading holds out with this trip to the trip's record", () => {
		const d = dialog([{ id: "trip-1", title: "The Wandering Tower", createdAt: 0, requisitioned: [{ name: "A wagon" }] }]);
		assetsNow()[0] = {
			name: "A pair of hardy draft horses", checked: false,
			takenBy: { name: "Wren", id: "hero1", expedition: { id: "trip-1", title: "The Wandering Tower" } },
		};
		assetsNow()[1] = { name: "A wagon", checked: false, takenBy: { expedition: { id: "trip-1", title: "The Wandering Tower" } } };

		expect(d._foldPlayerTakes()).toBe(true);
		expect(d._log().list[0].requisitioned).toEqual([{ name: "A wagon" }, { name: "A pair of hardy draft horses" }]);
		// A second save adds nothing more.
		expect(d._foldPlayerTakes()).toBe(false);
	});

	it("adds them onto a copy, leaving what another GM's write is merged against as it was", () => {
		const d = dialog([{ id: "trip-1", title: "The Wandering Tower", createdAt: 0, requisitioned: [{ name: "A wagon" }] }]);
		assetsNow()[0] = {
			name: "A pair of hardy draft horses", checked: false,
			takenBy: { name: "Wren", id: "hero1", expedition: { id: "trip-1", title: "The Wandering Tower" } },
		};
		const base = d._log();
		expect(d._logBase).toBe(base);
		expect(d._foldPlayerTakes()).toBe(true);
		expect(d._logBase.list[0].requisitioned).toEqual([{ name: "A wagon" }]);
		expect(d._log().list[0].requisitioned).toEqual([{ name: "A wagon" }, { name: "A pair of hardy draft horses" }]);
	});

	it("leaves the record alone when nothing is out with this trip", () => {
		const d = dialog();
		expect(d._foldPlayerTakes()).toBe(false);
		expect(d._log().list[0].requisitioned).toBeUndefined();
	});
});

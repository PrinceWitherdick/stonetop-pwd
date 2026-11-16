import { describe, it, expect, vi, afterEach } from "vitest";
import { CreateHazardDialog } from "../../module/hazards/create-hazard-dialog.js";
import { createHazard } from "../../module/hazards/hazard-store.js";
import { getStonetopSteadingActorOrWarn } from "../../module/utils/world.js";

// The page store and the steading, faked: finishing a restored new hazard files it through createHazard.
vi.mock("../../module/hazards/hazard-store.js", async importOriginal => ({ ...(await importOriginal()), createHazard: vi.fn() }));
vi.mock("../../module/utils/world.js", async importOriginal => ({ ...(await importOriginal()), getStonetopSteadingActorOrWarn: vi.fn() }));
import {
	CREATE_HAZARD_WINDOW_CLASS, CREATE_HAZARD_RESTORE_KIND, NEW_HAZARD_KEY, reopenCreateHazard,
} from "../../module/hazards/create-hazard-restore.js";

// Make a Hazard comes back after a reload as Create a Site does (hazards/create-hazard-restore.js):
// saved under its own key, with the step and every answer, put back before the first draw; and one
// that was making a hazard files it itself, since the tab that awaited its answer is gone.

const blankSel = () => ({
	name: "", description: "",
	damageDie: "", damageEffects: [], damageExtra: "", certainDeath: false,
	instinct: "", gmMoves: [""],
	advanceTrigger: "", grimPortents: [], impendingDoom: { text: "", done: false },
	playerMoves: [],
});

// Off the prototype: no element, so the live-field read is a no-op.
const on = (sel, extra = {}) => Object.assign(Object.create(CreateHazardDialog.prototype), { _sel: sel, _step: 0, _page: null, ...extra });

afterEach(() => {
	delete globalThis.fromUuid;
	delete game.user;
	vi.clearAllMocks();
});

describe("the Make a Hazard restore", () => {
	it("watches the class that actually draws the window", () => {
		expect(CreateHazardDialog.name).toBe(CREATE_HAZARD_WINDOW_CLASS);
	});

	it("is saved under its kind: one key for making a hazard, the page's uuid for an edit", () => {
		expect(on(blankSel()).restoreKey).toBe(`${CREATE_HAZARD_RESTORE_KIND}:${NEW_HAZARD_KEY}`);
		expect(on(blankSel(), { _page: { id: "p1", uuid: "JournalEntry.j1.JournalEntryPage.p1" } }).restoreKey)
			.toBe("createHazard:JournalEntry.j1.JournalEntryPage.p1");
	});

	it("keeps the step by key and every answer, rows included, and puts them back", () => {
		const sel = {
			...blankSel(), name: "Rotten Bridge", damageDie: "d8", damageEffects: ["forceful"], certainDeath: true,
			gmMoves: ["Creak ominously", "Drop a plank"], grimPortents: [{ text: "A rope frays", done: true }],
			impendingDoom: { text: "It falls", done: false }, playerMoves: [{ label: "Cross", text: "Roll +DEX" }],
		};
		const view = JSON.parse(JSON.stringify(on(sel, { _step: 3 }).restoreView));
		expect(view.step).toBe("doom");

		const back = on(blankSel());
		back._takeRestoredView(view);
		expect(back._sel).toEqual(sel);
		expect(back._step).toBe(3);
	});

	it("tells the close-guard what it would have opened with, not what came back", () => {
		const back = on(blankSel());
		back._takeRestoredView({ step: "concept", sel: { ...blankSel(), name: "Rotten Bridge" } });
		expect(JSON.parse(back._pristineWork).name).toBe("");
	});

	it("takes an answer only in the shape this version keeps it in", () => {
		const back = on(blankSel());
		back._takeRestoredView({ step: "gone", sel: {
			name: "Rotten Bridge", gmMoves: "not a list", grimPortents: [{ text: 3 }, { text: "Fray" }],
			playerMoves: [{ label: "Cross" }], certainDeath: "yes", impendingDoom: null, description: null,
		} });
		expect(back._sel).toEqual({ ...blankSel(), name: "Rotten Bridge", grimPortents: [{ text: "Fray", done: false }] });
		expect(back._step).toBe(0);
	});
});

describe("finishing a restored hazard", () => {
	it("files a new one onto the steading itself", async () => {
		const steading = { id: "s1" };
		const page = { id: "p9" };
		getStonetopSteadingActorOrWarn.mockReturnValue(steading);
		createHazard.mockResolvedValue(page);
		const back = on(blankSel(), { _resolveWith: vi.fn() });
		back._takeRestoredView({ step: "review", sel: { ...blankSel(), name: "Rotten Bridge" } });
		await back._finish();
		expect(createHazard).toHaveBeenCalledWith(steading, expect.objectContaining({ name: "Rotten Bridge" }));
		expect(back._resolveWith).toHaveBeenCalledWith(page);
	});

	it("stays open when there is no steading to file it on", async () => {
		getStonetopSteadingActorOrWarn.mockReturnValue(null);
		const back = on(blankSel(), { _resolveWith: vi.fn() });
		back._takeRestoredView({ step: "review", sel: { ...blankSel(), name: "Rotten Bridge" } });
		await back._finish();
		expect(createHazard).not.toHaveBeenCalled();
		expect(back._resolveWith).not.toHaveBeenCalled();
	});

	it("still hands the seed back to whoever awaited it, when there was no reload", async () => {
		const back = on({ ...blankSel(), name: "Rotten Bridge" }, { _resolveWith: vi.fn() });
		await back._finish();
		expect(createHazard).not.toHaveBeenCalled();
		expect(back._resolveWith.mock.calls[0][0]).toMatchObject({ name: "Rotten Bridge" });
	});
});

describe("reopenCreateHazard", () => {
	it("stays shut for a player: hazards are GM prep", async () => {
		game.user = { isGM: false };
		expect(await reopenCreateHazard("createHazard:new")).toBeNull();
	});

	it("stays shut for another kind's key", async () => {
		game.user = { isGM: true };
		expect(await reopenCreateHazard("createSite:new")).toBeNull();
	});

	it("stays shut for an edit whose hazard has gone, or can no longer be edited", async () => {
		game.user = { isGM: true };
		globalThis.fromUuid = async () => null;
		expect(await reopenCreateHazard("createHazard:JournalEntry.j1.JournalEntryPage.gone")).toBeNull();
		globalThis.fromUuid = async () => ({ id: "p1", canUserModify: () => false });
		expect(await reopenCreateHazard("createHazard:JournalEntry.j1.JournalEntryPage.p1")).toBeNull();
	});

	it("brings a new one back as a new walkthrough, and an edit back on its page", async () => {
		game.user = { isGM: true };
		const fresh = await reopenCreateHazard("createHazard:new");
		expect(fresh).toBeInstanceOf(CreateHazardDialog);
		expect(fresh._page).toBeNull();
		const page = { id: "p2", name: "Rotten Bridge", system: {}, canUserModify: () => true };
		globalThis.fromUuid = async () => page;
		const edit = await reopenCreateHazard("createHazard:JournalEntry.j1.JournalEntryPage.p2");
		expect(edit._page).toBe(page);
	});
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _reconcileSharedCharacterSheets } from "../../module/hooks/Ready.js";
import {
	SHARED_WITH_TABLE_FLAG, SHARED_SHEETS_UPDATE_OPTION, followerOwnershipFrom, sharedSheetAdoptions,
	sharedSheetCreateStamp, sharedSheetChanges, sharedSheetReleaseEntry,
} from "../../module/actors/character/shared-sheets.js";
import { STONETOP_SCOPE } from "../../module/actors/character/StonetopFlags.js";

// Every character is OBSERVER to the whole table while the GM's `characterSheetsShared` switch is on.
// The switch moves only the characters flagged as its own, and a level the GM sets by hand in core's
// Configure Ownership takes that character off it. See module/actors/character/shared-sheets.js.

const NONE = 0, LIMITED = 1, OBSERVER = 2;
const FLAG = `flags.${STONETOP_SCOPE}.${SHARED_WITH_TABLE_FLAG}`;

function character(id, level, flagged) {
	return {
		id, type: "character", name: id,
		ownership: level === undefined ? {} : { default: level },
		flags: flagged === undefined ? {} : { [STONETOP_SCOPE]: { [SHARED_WITH_TABLE_FLAG]: flagged } },
	};
}

describe("sharedSheetCreateStamp", () => {
	it("opens a new character to the table while the switch is on, as the switch's own", () => {
		expect(sharedSheetCreateStamp("character", { name: "Bram" }, true)).toEqual({
			"ownership.default": OBSERVER, [FLAG]: true,
		});
	});

	// Still the switch's, so turning it on later opens this one with the rest.
	it("makes a new character private while the switch is off, still as the switch's own", () => {
		expect(sharedSheetCreateStamp("character", { name: "Bram" }, false)).toEqual({
			"ownership.default": NONE, [FLAG]: true,
		});
	});

	// A duplicate or an import carries the level it was made with.
	it("never overrides a default level the creation data already gave", () => {
		expect(sharedSheetCreateStamp("character", { ownership: { default: NONE } }, true)).toEqual({});
	});

	// The create-character flow gives the assigned player OWNER and says nothing about the default.
	it("still stamps when the creation data names only a player's own level", () => {
		expect(sharedSheetCreateStamp("character", { ownership: { u1: 3 } }, true)["ownership.default"]).toBe(OBSERVER);
	});

	it("is for characters only", () => {
		for (const type of ["npc", "monster", "steading", "gmtoolkit"]) {
			expect(sharedSheetCreateStamp(type, {}, true)).toEqual({});
		}
	});
});

describe("sharedSheetChanges", () => {
	it("on: raises every flagged character not yet OBSERVER", () => {
		const closed = character("closed", NONE, true);
		const open = character("open", OBSERVER, true);
		expect(sharedSheetChanges([closed, open], true)).toEqual({ actors: [closed], level: OBSERVER });
	});

	it("off: lowers every flagged character not yet NONE", () => {
		const closed = character("closed", NONE, true);
		const open = character("open", OBSERVER, true);
		expect(sharedSheetChanges([closed, open], false)).toEqual({ actors: [open], level: NONE });
	});

	// Unflagged is the GM's: hidden or shared by hand, either way.
	it("leaves every unflagged character where it is, either way", () => {
		const hidden = character("hidden", NONE);
		const byHand = character("byHand", OBSERVER);
		const limited = character("limited", LIMITED);
		expect(sharedSheetChanges([hidden, byHand, limited], true).actors).toEqual([]);
		expect(sharedSheetChanges([hidden, byHand, limited], false).actors).toEqual([]);
	});

	it("passes over every actor that is not a character", () => {
		const npc = { ...character("npc", NONE, true), type: "npc" };
		expect(sharedSheetChanges([npc], true).actors).toEqual([]);
	});
});

// A world from before the switch: core's NONE is nobody's decision, anything else is the GM's.
describe("sharedSheetAdoptions", () => {
	it("takes every unflagged character still at NONE, and no other", () => {
		const fresh = character("fresh", NONE);
		const unset = character("unset", undefined);
		const byHand = character("byHand", OBSERVER);
		const limited = character("limited", LIMITED);
		const already = character("already", NONE, true);
		const npc = { ...character("npc", NONE), type: "npc" };
		expect(sharedSheetAdoptions([fresh, unset, byHand, limited, already, npc])).toEqual([fresh, unset]);
	});
});

describe("sharedSheetReleaseEntry", () => {
	const released = entry => !!entry && entry[0].includes(SHARED_WITH_TABLE_FLAG);

	it("lets go of a flagged character whose default level the GM moves by hand", () => {
		const pc = character("pc", OBSERVER, true);
		expect(released(sharedSheetReleaseEntry(pc, { "ownership.default": NONE }))).toBe(true);
		// Configure Ownership sends the whole ownership object.
		expect(released(sharedSheetReleaseEntry(pc, { ownership: { default: NONE, p1: 3 } }))).toBe(true);
	});

	// Raised back by hand after a lowering by hand: still the GM's, and the switch must not lower it.
	it("lets go whichever way the level moves", () => {
		expect(released(sharedSheetReleaseEntry(character("pc", NONE, true), { "ownership.default": OBSERVER }))).toBe(true);
	});

	// Saving Configure Ownership without touching the default sends the same level back.
	it("keeps hold when the level does not change", () => {
		expect(sharedSheetReleaseEntry(character("pc", OBSERVER, true), { ownership: { default: OBSERVER, p1: 3 } })).toBeNull();
		expect(sharedSheetReleaseEntry(character("pc", OBSERVER, true), { ownership: { p1: 3 } })).toBeNull();
		expect(sharedSheetReleaseEntry(character("pc", OBSERVER, true), { name: "Bram" })).toBeNull();
	});

	it("keeps hold for the switch's own writes", () => {
		const pc = character("pc", OBSERVER, true);
		expect(sharedSheetReleaseEntry(pc, { "ownership.default": NONE }, { [SHARED_SHEETS_UPDATE_OPTION]: true })).toBeNull();
	});

	it("has nothing to let go of on an unflagged character or another actor", () => {
		expect(sharedSheetReleaseEntry(character("pc", OBSERVER), { "ownership.default": NONE })).toBeNull();
		const npc = { ...character("npc", OBSERVER, true), type: "npc" };
		expect(sharedSheetReleaseEntry(npc, { "ownership.default": NONE })).toBeNull();
	});
});

// The switch moves characters only, so a default it gave would sit on a follower NPC for good.
describe("followerOwnershipFrom", () => {
	it("leaves out the default level the switch keeps on the character", () => {
		const pc = { ...character("pc", OBSERVER, true), ownership: { default: OBSERVER, p1: 3 } };
		expect(followerOwnershipFrom(pc)).toEqual({ p1: 3 });
	});

	it("carries over a default the GM set by hand", () => {
		const pc = { ...character("pc", OBSERVER), ownership: { default: OBSERVER, p1: 3 } };
		expect(followerOwnershipFrom(pc)).toEqual({ default: OBSERVER, p1: 3 });
	});

	it("is a copy, never the character's own object", () => {
		const pc = { ...character("pc", NONE), ownership: { default: NONE, p1: 3 } };
		const copy = followerOwnershipFrom(pc);
		copy.p2 = 3;
		expect(pc.ownership.p2).toBeUndefined();
	});
});

describe("_reconcileSharedCharacterSheets", () => {
	let priorGame, priorActor, priorConst;
	beforeEach(() => { priorGame = globalThis.game; priorActor = globalThis.Actor; priorConst = globalThis.CONST; });
	afterEach(() => { globalThis.game = priorGame; globalThis.Actor = priorActor; globalThis.CONST = priorConst; });

	const OPTIONS = { [SHARED_SHEETS_UPDATE_OPTION]: true };

	function install({ shared = true, isGM = true, actors = [], adopted = true } = {}) {
		const store = {
			characterSheetsShared: shared,
			repairSweepVersions: adopted ? { sharedCharacterSheetsAdopted: "1.0.0" } : {},
		};
		// Each write lands on its actor before the request resolves, as core's does.
		const land = (updates) => {
			for (const { _id, ...change } of updates) {
				const actor = actors.find(a => a.id === _id);
				for (const [path, value] of Object.entries(change)) {
					const keys = path.split(".");
					const last = keys.pop();
					keys.reduce((obj, key) => (obj[key] ??= {}), actor)[last] = value;
				}
			}
			return [];
		};
		const updateDocuments = vi.fn(async updates => land(updates));
		globalThis.game = {
			actors,
			system: { version: "2.0.0" },
			user: { id: "gm1", isGM },
			users: [{ id: "gm1", isGM: true, active: true }],
			settings: {
				get: (scope, key) => store[key],
				set: vi.fn(async (scope, key, value) => { store[key] = value; return value; }),
			},
		};
		globalThis.Actor = { updateDocuments };
		globalThis.CONST = { ...(priorConst ?? {}), DOCUMENT_OWNERSHIP_LEVELS: { NONE, LIMITED, OBSERVER, OWNER: 3 } };
		return { update: updateDocuments, store, land };
	}

	it("opens the switch's characters in ONE batched request, marked as its own write", async () => {
		const { update } = install({ actors: [character("a", NONE, true), character("b", NONE, true)] });
		expect(await _reconcileSharedCharacterSheets()).toBe(2);
		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith([
			{ _id: "a", "ownership.default": OBSERVER },
			{ _id: "b", "ownership.default": OBSERVER },
		], OPTIONS);
	});

	// Closed, still the switch's: turning it on again opens the same ones.
	it("closes them when the switch goes off, and keeps them as its own", async () => {
		const { update } = install({ shared: false, actors: [character("a", OBSERVER, true)] });
		expect(await _reconcileSharedCharacterSheets()).toBe(1);
		expect(update).toHaveBeenCalledWith([{ _id: "a", "ownership.default": NONE }], OPTIONS);
	});

	it("writes nothing in a world already settled", async () => {
		const { update } = install({ actors: [character("a", OBSERVER, true), character("hidden", NONE)] });
		expect(await _reconcileSharedCharacterSheets()).toBe(0);
		expect(update).not.toHaveBeenCalled();
	});

	it("takes over a world's characters from before the switch ONCE, and leaves them after", async () => {
		const fresh = character("fresh", NONE);
		const byHand = character("byHand", LIMITED);
		const { update, store } = install({ adopted: false, actors: [fresh, byHand] });
		expect(await _reconcileSharedCharacterSheets()).toBe(1);
		expect(update).toHaveBeenCalledWith([{ _id: "fresh", "ownership.default": OBSERVER, [FLAG]: true }], OPTIONS);
		expect(store.repairSweepVersions.sharedCharacterSheetsAdopted).toBe("2.0.0");

		// Hidden by hand since: the next run, under a later version too, leaves it be.
		game.actors.push(character("hidden", NONE));
		game.system.version = "3.0.0";
		update.mockClear();
		expect(await _reconcileSharedCharacterSheets()).toBe(0);
		expect(update).not.toHaveBeenCalled();
	});

	// On, then straight off while the first run's write is still in flight: the second run must read
	// what the first wrote, or it finds nothing to close and the first's write lands after it.
	it("runs one at a time, so a quick on-off ends off", async () => {
		const pc = character("a", NONE, true);
		const { update, store, land } = install({ actors: [pc] });
		let finish;
		update.mockImplementationOnce(updates => new Promise(resolve => { finish = () => resolve(land(updates)); }));
		const first = _reconcileSharedCharacterSheets();
		await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
		store.characterSheetsShared = false;
		const second = _reconcileSharedCharacterSheets();
		finish();
		await Promise.all([first, second]);
		expect(update).toHaveBeenCalledTimes(2);
		expect(pc.ownership.default).toBe(NONE);
	});

	// A player may not update characters they do not own; the rejection would tear down onReady.
	it("is the primary GM's alone", async () => {
		const { update } = install({ isGM: false, actors: [character("a", NONE, true)] });
		expect(await _reconcileSharedCharacterSheets()).toBe(0);
		expect(update).not.toHaveBeenCalled();
	});
});

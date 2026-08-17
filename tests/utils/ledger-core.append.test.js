import { describe, it, expect } from "vitest";
import {
	LEDGER_SCOPE, LEDGER_KEY, LEDGER_FLAG_PATH,
	appendLedgerEntries, deleteLedgerEntries, listMerge, numericMerge,
} from "../../module/utils/ledger-core.js";

// appendLedgerEntries is the seam between a caller's chronological list of what just happened
// and the newest-first array the flag stores (and that mergeRuns walks). These cover the flip,
// which is invisible until one update produces several entries at once.

function makeActor(stored = []) {
	const actor = {
		type: "character",
		written: null,
		getFlag: (scope, key) => (scope === LEDGER_SCOPE && key === LEDGER_KEY ? stored : undefined),
		update: async data => { actor.written = data[LEDGER_FLAG_PATH]; },
	};
	return actor;
}

const actions = actor => actor.written.map(e => e.action);

describe("appendLedgerEntries ordering", () => {
	it("accumulates a list run in the order the entries happened", async () => {
		// Picking all four appearance lines lands as ONE update, so all four entries arrive in
		// a single call. Walked backwards they read "ceremonial robes, curvy, imperious voice,
		// fresh-faced" — every line right, the sequence inverted.
		const actor = makeActor();
		const picks = ["fresh-faced", "imperious voice", "curvy", "ceremonial robes"];
		await appendLedgerEntries(actor, picks.map(value => ({
			action: `Appearance set to ${value}`,
			merge: listMerge("Appearance", "appearance", [value]),
		})));

		expect(actions(actor)).toEqual([
			"Appearance set to fresh-faced, imperious voice, curvy, ceremonial robes",
		]);
	});

	it("puts the last thing that happened at the head of the ledger", async () => {
		const actor = makeActor();
		await appendLedgerEntries(actor, [
			{ action: "Background set to Sheriff" },
			{ action: "Instinct set to Protective" },
		]);
		// Newest first: the instinct was chosen after the background.
		expect(actions(actor)).toEqual(["Instinct set to Protective", "Background set to Sheriff"]);
	});

	it("folds the newest entry into a stored run even when a sibling shares the update", async () => {
		// One update writing both XP and Level hands over two entries. Whichever order
		// flattenObject produced them in, the XP entry is the one adjacent to the stored XP
		// run once the list is newest-first — so it merges instead of being blocked.
		const actor = makeActor([{
			id: "old", timestamp: Date.now(), userId: null, userName: "GM", move: null,
			action: "XP changed from 0 to 1",
			merge: numericMerge("XP", "system.attributes.xp.value", 0, 1),
		}]);

		await appendLedgerEntries(actor, [
			{ action: "XP changed from 1 to 2", merge: numericMerge("XP", "system.attributes.xp.value", 1, 2) },
			{ action: "Level changed from 1 to 2", merge: numericMerge("Level", "system.attributes.level.value", 1, 2) },
		]);

		expect(actions(actor)).toEqual(["Level changed from 1 to 2", "XP changed from 0 to 2"]);
	});

	it("stamps a category and leaves an explicit one alone", async () => {
		const actor = makeActor();
		await appendLedgerEntries(
			actor,
			[{ action: "Surplus changed from 1 to 2" }, { action: "Notes edited", category: "notes" }],
			{ defaultCategory: "steading" },
		);
		expect(actor.written.map(e => e.category)).toEqual(["notes", "steading"]);
	});
});

/**
 * A fake whose `update` does NOT resolve in the same tick.
 *
 * That gap is the whole bug: a real Document#update is a server round trip, so two appends fired
 * in one tick both read the stored array before either wrote it back, and the second write
 * clobbered the first. `makeActor` above resolves immediately and therefore cannot show it.
 *
 * `id` matters too — the write chain is keyed on it, and an actor without one is deliberately
 * left unserialized. Each test uses a fresh id so the module-level chain can't leak between them.
 */
function makeLiveActor(id) {
	let stored = [];
	return {
		id,
		type: "character",
		getFlag: (scope, key) => (scope === LEDGER_SCOPE && key === LEDGER_KEY ? stored : undefined),
		update: async data => {
			await Promise.resolve();
			stored = data[LEDGER_FLAG_PATH];
		},
		get stored() { return stored; },
	};
}

describe("appendLedgerEntries serializes writes per actor", () => {
	it("keeps both entries when two appends race on one actor", async () => {
		// CharacterArcana.addLead and CharacterInventory.resetSelections both fire several
		// setFlags in a single Promise.all, and every one of them triggers an append through
		// StonetopActor#_onUpdate. Unserialized, all but the last entry vanished — and mergeRuns
		// folding the head made the loss read as intended behaviour.
		const actor = makeLiveActor("race-both-survive");
		await Promise.all([
			appendLedgerEntries(actor, [{ action: "Instinct set to Protective" }]),
			appendLedgerEntries(actor, [{ action: "Background set to Sheriff" }]),
		]);

		expect(actor.stored.map(e => e.action)).toEqual([
			"Background set to Sheriff",   // newest first: queued second, so it lands on top
			"Instinct set to Protective",
		]);
	});

	it("keeps every entry when four appends race, the resetSelections shape", async () => {
		const actor = makeLiveActor("race-four-survive");
		await Promise.all(
			["Armor", "Weapons", "Provisions", "Trinkets"]
				.map(name => appendLedgerEntries(actor, [{ action: `${name} deselected` }])),
		);

		expect(actor.stored).toHaveLength(4);
	});

	it("does not resurrect entries when a delete races an append", async () => {
		const actor = makeLiveActor("race-delete");
		await appendLedgerEntries(actor, [{ action: "Instinct set to Protective" }]);
		const [first] = actor.stored;

		await Promise.all([
			deleteLedgerEntries(actor, new Set([first.id])),
			appendLedgerEntries(actor, [{ action: "Background set to Sheriff" }]),
		]);

		// The delete read the array before the append wrote it, so an unserialized delete put
		// the deleted entry straight back.
		expect(actor.stored.map(e => e.action)).toEqual(["Background set to Sheriff"]);
	});

	it("lets the next write through after one fails", async () => {
		// The stored link is neutralized precisely so a rejected write can't reject everything
		// queued behind it.
		const actor = makeLiveActor("race-after-failure");
		let failNext = true;
		const realUpdate = actor.update;
		actor.update = async data => {
			if (failNext) { failNext = false; throw new Error("no connection"); }
			return realUpdate(data);
		};

		await expect(appendLedgerEntries(actor, [{ action: "Instinct set to Protective" }]))
			.rejects.toThrow("no connection");
		await appendLedgerEntries(actor, [{ action: "Background set to Sheriff" }]);

		expect(actor.stored.map(e => e.action)).toEqual(["Background set to Sheriff"]);
	});
});

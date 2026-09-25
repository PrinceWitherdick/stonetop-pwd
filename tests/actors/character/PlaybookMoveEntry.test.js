import { describe, it, expect } from "vitest";
import { PlaybookMoveEntry, repeatBoxLocked } from "../../../module/actors/character/PlaybookMoveEntry.js";
import { MoveDefinition } from "../../../module/model/MoveDefinition.js";

// Helper: build a repeatable, non-starting move definition (e.g. Improved Stat).
function repeatableEntry({ repeatMax = 3 } = {}) {
	return new MoveDefinition({
		_id: "imp-stat",
		name: "Improved Stat",
		system: { playbook: "The Heavy", description: "<p>+1 stat.</p>", repeatMax },
	});
}

const NO_BG = new Set();
const NO_OWNED_BY_NAME = new Set();

describe("PlaybookMoveEntry (repeatable moves)", () => {
	it("exposes repeatMax from the move definition", () => {
		const entry = new PlaybookMoveEntry(repeatableEntry({ repeatMax: 3 }), [], NO_BG, NO_OWNED_BY_NAME, 1, "The Heavy");
		expect(entry.repeatable).toBe(true);
		expect(entry.repeatMax).toBe(3);
	});

	it("maps each repeat checkbox to its own owned instance id (not the last)", () => {
		// Two instances owned; the third slot is still open.
		const owned = [{ _id: "inst-a" }, { _id: "inst-b" }];
		const entry = new PlaybookMoveEntry(repeatableEntry({ repeatMax: 3 }), owned, NO_BG, NO_OWNED_BY_NAME, 1, "The Heavy");

		expect(entry.repeatChecks).toHaveLength(3);
		// Each checked box deletes the instance it actually represents — regression test
		// for the bug where every checked box pointed at the most-recent instance id.
		expect(entry.repeatChecks[0]).toMatchObject({ checked: true, ownedId: "inst-a" });
		expect(entry.repeatChecks[1]).toMatchObject({ checked: true, ownedId: "inst-b" });
		expect(entry.repeatChecks[2]).toMatchObject({ checked: false, ownedId: null });
	});

	it("a locked repeatable move's next box is NOT disabled by the lock (learnable in edit mode)", () => {
		// Locked by an unmet level gate. The lock fades the row (.move-locked) but must
		// not disable the checkbox — a player may deliberately take it anyway. The
		// template's (not movesEdit) gate is what keeps it read-only outside edit mode.
		const def = new MoveDefinition({
			_id: "rep-locked", name: "Repeatable Locked",
			system: { playbook: "The Heavy", repeatMax: 3, requirement: { level: 6 } },
		});
		const entry = new PlaybookMoveEntry(def, [], NO_BG, NO_OWNED_BY_NAME, 1, "The Heavy");
		expect(entry.locked).toBe(true);
		expect(entry.repeatChecks[0].disabled).toBe(false);
		// Out-of-sequence later boxes stay disabled (must be taken in order).
		expect(entry.repeatChecks[1].disabled).toBe(true);
	});

	it("non-repeatable moves have no repeatChecks and repeatMax 1", () => {
		const def = new MoveDefinition({ _id: "well-versed", name: "Well-Versed", system: { playbook: "The Heavy" } });
		const entry = new PlaybookMoveEntry(def, [], NO_BG, NO_OWNED_BY_NAME, 1, "The Heavy");
		expect(entry.repeatable).toBe(false);
		expect(entry.repeatMax).toBe(1);
		expect(entry.repeatChecks).toBeNull();
	});
});

// A repeatable STARTING move (the Seeker's Well Versed) used to have every box disabled, so a second
// take could only be made in the level-up dialog. Only the take it started with is locked now.
describe("PlaybookMoveEntry (a repeatable starting move)", () => {
	const wellVersed = () => new MoveDefinition({
		_id: "wv", name: "Well Versed",
		system: { playbook: "The Seeker", isStartingMove: true, repeatMax: 3 },
	});
	const boxes = entry => entry.repeatChecks.map(b => b.disabled);

	it("locks only the first box, and opens the next one", () => {
		const entry = new PlaybookMoveEntry(wellVersed(), [{ _id: "a" }], NO_BG, NO_OWNED_BY_NAME, 3, "The Seeker");
		expect(entry.isStarting).toBe(true);
		expect(boxes(entry)).toEqual([true, false, true]);
	});

	it("leaves a later take free to untick, and the one after it free to tick", () => {
		const entry = new PlaybookMoveEntry(wellVersed(), [{ _id: "a" }, { _id: "b" }], NO_BG, NO_OWNED_BY_NAME, 3, "The Seeker");
		expect(boxes(entry)).toEqual([true, false, false]);
	});

	it("locks nothing on the either/or half the character did not start with", () => {
		const entry = new PlaybookMoveEntry(wellVersed(), [{ _id: "a" }], NO_BG, NO_OWNED_BY_NAME, 3, "The Seeker", {}, new Set(["Well Versed"]));
		expect(entry.isStarting).toBe(false);
		expect(boxes(entry)).toEqual([false, false, true]);
	});

	it("is the one rule the sheet's helper asks too", () => {
		expect(repeatBoxLocked(0, 1, true)).toBe(true);
		expect(repeatBoxLocked(1, 1, true)).toBe(false);
		expect(repeatBoxLocked(0, 1, false)).toBe(false);
		expect(repeatBoxLocked(2, 1, false)).toBe(true);
	});
});

describe("PlaybookMoveEntry (stat-increase cap)", () => {
	it("exposes the move's stat cap (drives the level-up stat picker); null when absent", () => {
		const imp = new MoveDefinition({ _id: "imp", name: "Improved Stat", system: { playbook: "The Heavy", cap: 2, repeatMax: 3 } });
		const plain = new MoveDefinition({ _id: "x", name: "Berserker", system: { playbook: "The Heavy" } });
		expect(new PlaybookMoveEntry(imp, [], NO_BG, NO_OWNED_BY_NAME, 6, "The Heavy").cap).toBe(2);
		expect(new PlaybookMoveEntry(plain, [], NO_BG, NO_OWNED_BY_NAME, 6, "The Heavy").cap).toBeNull();
	});
});

describe("PlaybookMoveEntry (a move that replaces another)", () => {
	// Book I p.529: a replacing move requires the move it replaces, and taking it gives the
	// original up. The data spells the prereq out for A Mighty Rampart only; Big Damn Hero
	// carries just `replaces`.
	const bigDamnHero = new MoveDefinition({
		_id: "bdh", name: "Big Damn Hero",
		system: { playbook: "The Would-Be Hero", requirement: { level: 6 }, replaces: "In Over Your Head" },
	});
	const rampart = new MoveDefinition({
		_id: "amr", name: "A Mighty Rampart",
		system: { playbook: "The Judge", requirement: { level: 6, moves: ["Bulwark"] }, replaces: "Bulwark" },
	});

	it("is locked until the move it replaces is owned", () => {
		expect(new PlaybookMoveEntry(bigDamnHero, [], NO_BG, NO_OWNED_BY_NAME, 6, "The Would-Be Hero").locked).toBe(true);
		expect(new PlaybookMoveEntry(bigDamnHero, [], NO_BG, new Set(["In Over Your Head"]), 6, "The Would-Be Hero").locked).toBe(false);
	});

	it("reads as the book prints it, naming the replaced move once", () => {
		expect(new PlaybookMoveEntry(bigDamnHero, [], NO_BG, NO_OWNED_BY_NAME, 6, "The Would-Be Hero").requiresLabel)
			.toBe("level 6+; replaces In Over Your Head");
		expect(new PlaybookMoveEntry(rampart, [], NO_BG, NO_OWNED_BY_NAME, 6, "The Judge").requiresLabel)
			.toBe("level 6+; replaces Bulwark");
	});

	it("once owned, the original's absence is not a broken prerequisite", () => {
		const entry = new PlaybookMoveEntry(rampart, [{ _id: "r1" }], NO_BG, new Set(["A Mighty Rampart"]), 6, "The Judge");
		expect(entry.locked).toBe(false);
		expect(entry.requirementsUnmet).toBe(false);
	});
});

describe("PlaybookMoveEntry (broken prerequisites on a learned move)", () => {
	// Move B requires Move A. The actor learned B, then edited their moves and
	// removed A — B should flag `requirementsUnmet` so the sheet can warn.
	const moveB = new MoveDefinition({
		_id: "move-b", name: "Move B",
		system: { playbook: "The Heavy", requirement: { moves: ["Move A"] } },
	});
	const OWNED = [{ _id: "b1" }];

	it("flags an OWNED move whose required move is no longer owned", () => {
		const entry = new PlaybookMoveEntry(moveB, OWNED, NO_BG, new Set(["Move B"]), 6, "The Heavy");
		expect(entry.owned).toBe(true);
		expect(entry.locked).toBe(true);
		expect(entry.requirementsUnmet).toBe(true);
	});

	it("does NOT flag when the required move is still owned", () => {
		const entry = new PlaybookMoveEntry(moveB, OWNED, NO_BG, new Set(["Move A", "Move B"]), 6, "The Heavy");
		expect(entry.locked).toBe(false);
		expect(entry.requirementsUnmet).toBe(false);
	});

	it("does NOT flag an un-owned move whose prereq is missing (just locked, not broken)", () => {
		const entry = new PlaybookMoveEntry(moveB, [], NO_BG, NO_OWNED_BY_NAME, 6, "The Heavy");
		expect(entry.locked).toBe(true);
		expect(entry.owned).toBe(false);
		expect(entry.requirementsUnmet).toBe(false);
	});

	it("does NOT flag an owned move that only has a display-only requirement note", () => {
		const def = new MoveDefinition({
			_id: "wv", name: "Superior Stat",
			system: { playbook: "The Would-Be Hero", requirement: { note: "All 6 marks in Potential for Greatness" } },
		});
		const entry = new PlaybookMoveEntry(def, [{ _id: "wv1" }], NO_BG, new Set(["Superior Stat"]), 6, "The Would-Be Hero");
		expect(entry.requirementsUnmet).toBe(false);
	});
});

describe("PlaybookMoveEntry (display-only requirement note)", () => {
	it("shows requirement.note in the label but never uses it to lock the move", () => {
		// "All 6 marks in Potential for Greatness" is a prose prereq the engine can't
		// check; with only a note (no real move/playbook/level/stat gate) it stays unlocked.
		const def = new MoveDefinition({
			_id: "wv", name: "Superior Stat",
			system: { playbook: "The Would-Be Hero", requirement: { note: "All 6 marks in Potential for Greatness" } },
		});
		const entry = new PlaybookMoveEntry(def, [], NO_BG, NO_OWNED_BY_NAME, 6, "The Would-Be Hero");
		expect(entry.locked).toBe(false);
		expect(entry.requiresLabel).toBe("All 6 marks in Potential for Greatness");
	});

	it("combines a note with a real level gate (WBH Superior Stat) without locking on the note", () => {
		const def = new MoveDefinition({
			_id: "wbh-sup", name: "Superior Stat",
			system: { playbook: "The Would-Be Hero", cap: 3, requirement: { level: 6, note: "All 6 marks in Potential for Greatness" } },
		});
		// At level 6 the level gate is met → unlocked, and the note rides along in the label.
		const unlocked = new PlaybookMoveEntry(def, [], NO_BG, NO_OWNED_BY_NAME, 6, "The Would-Be Hero");
		expect(unlocked.locked).toBe(false);
		expect(unlocked.requiresLabel).toContain("All 6 marks in Potential for Greatness");
		expect(unlocked.requiresLabel).toContain("level 6+");
		// Below level 6 it's locked by the level gate (not the note).
		expect(new PlaybookMoveEntry(def, [], NO_BG, NO_OWNED_BY_NAME, 5, "The Would-Be Hero").locked).toBe(true);
	});
});

describe("PlaybookMoveEntry (machine-checkable stat requirement)", () => {
	// Musclebound: "Requires Strength +2 or higher" → { str: 2 }, a stat gate the engine
	// CAN check (unlike a freeform note), so it actually locks the move.
	const def = new MoveDefinition({
		_id: "mb", name: "Musclebound",
		system: { playbook: "The Heavy", requirement: { stats: { str: 2 } } },
	});

	it("locks the move when the actor's stat is below the minimum, and shows the gate label", () => {
		const entry = new PlaybookMoveEntry(def, [], NO_BG, NO_OWNED_BY_NAME, 2, "The Heavy", { str: 1 });
		expect(entry.locked).toBe(true);
		expect(entry.requiresLabel).toBe("STR +2");
	});

	it("unlocks once the stat meets or exceeds the minimum", () => {
		expect(new PlaybookMoveEntry(def, [], NO_BG, NO_OWNED_BY_NAME, 2, "The Heavy", { str: 2 }).locked).toBe(false);
		expect(new PlaybookMoveEntry(def, [], NO_BG, NO_OWNED_BY_NAME, 2, "The Heavy", { str: 3 }).locked).toBe(false);
	});

	it("treats an absent/empty stat map as 0 (locked) and never throws", () => {
		expect(new PlaybookMoveEntry(def, [], NO_BG, NO_OWNED_BY_NAME, 2, "The Heavy").locked).toBe(true);
		expect(new PlaybookMoveEntry(def, [], NO_BG, NO_OWNED_BY_NAME, 2, "The Heavy", {}).locked).toBe(true);
	});

	it("flags an OWNED move whose stat fell below the gate (broken prerequisite)", () => {
		const entry = new PlaybookMoveEntry(def, [{ _id: "mb1" }], NO_BG, new Set(["Musclebound"]), 2, "The Heavy", { str: 1 });
		expect(entry.owned).toBe(true);
		expect(entry.requirementsUnmet).toBe(true);
	});

	it("does NOT flag an OWNED move whose stat still meets the gate", () => {
		const entry = new PlaybookMoveEntry(def, [{ _id: "mb1" }], NO_BG, new Set(["Musclebound"]), 2, "The Heavy", { str: 2 });
		expect(entry.requirementsUnmet).toBe(false);
	});
});

// Book I, the Ranger's Alpha: "(Requires level 6+, and Wild Speech or Spirit Tongue)". Any
// ONE of `requirement.anyMoves` is enough; `requirement.moves` still needs every one.
describe("PlaybookMoveEntry (an either-or required move)", () => {
	const alpha = new MoveDefinition({
		_id: "alpha", name: "Alpha",
		system: { playbook: "The Ranger", requirement: { level: 6, anyMoves: ["Wild Speech", "Spirit Tongue"] } },
	});
	const at6 = (owned, instances = []) => new PlaybookMoveEntry(alpha, instances, NO_BG, new Set(owned), 6, "The Ranger");

	it("is unlocked by either move alone", () => {
		expect(at6(["Wild Speech"]).locked).toBe(false);
		expect(at6(["Spirit Tongue"]).locked).toBe(false);
		expect(at6(["Wild Speech", "Spirit Tongue"]).locked).toBe(false);
	});

	it("is locked with neither, and prints them as the book does", () => {
		const entry = at6([]);
		expect(entry.locked).toBe(true);
		expect(entry.requiresLabel).toBe("Wild Speech or Spirit Tongue; level 6+");
	});

	it("flags an owned Alpha once neither move is left", () => {
		expect(at6([], [{ _id: "a1" }]).requirementsUnmet).toBe(true);
		expect(at6(["Spirit Tongue"], [{ _id: "a1" }]).requirementsUnmet).toBe(false);
	});

	it("sorts under its first option", () => {
		expect(at6([]).requires).toBe("Wild Speech");
	});
});

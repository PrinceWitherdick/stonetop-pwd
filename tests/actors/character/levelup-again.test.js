import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { LevelUpDialog } from "../../../module/actors/character/dialogs/LevelUpDialog.js";

// Book I p.528: "If a PC has enough XP to Level Up twice, then they Level Up twice right
// away." The sheet opens the next level-up as soon as one is applied, while XP remains.

function makeSheet({ canLevelUp }) {
	const character = {
		_actor: { id: "actorA" },
		canLevelUp,
		getLevelUpData: vi.fn(async () => ({ level: 3, newLevel: 4, availableMoves: [], lockedMoves: [], availableInvocations: [] })),
	};
	const actor = { id: "actorA", name: "Rhianna", typedActor: character };
	const Base = class {
		constructor() { this._actor = actor; }
		get actor() { return this._actor; }
		get isEditable() { return true; }
		async getData() { return {}; }
		activateListeners() {}
		render = vi.fn();
	};
	const sheet = new (createStonetopCharacterSheetClass(Base))();
	sheet._maybeOpenPossessionChoicesForMove = vi.fn();
	return { sheet, character };
}

let opened;
beforeEach(() => {
	opened = [];
	global.ui = { notifications: { info: vi.fn(), warn: vi.fn() }, windows: {} };
	vi.spyOn(LevelUpDialog.prototype, "render").mockImplementation(function () { opened.push(this); return this; });
});
afterEach(() => vi.restoreAllMocks());

describe("levelling up twice", () => {
	it("opens the next level-up straight after one is applied, while there's XP for it", async () => {
		const { sheet } = makeSheet({ canLevelUp: true });
		await sheet._onLevelUpOpen();
		expect(opened).toHaveLength(1);

		opened[0]._onDone("Berserker", { applied: true });
		await vi.waitFor(() => expect(opened).toHaveLength(2));
		expect(global.ui.notifications.info).toHaveBeenCalledWith(expect.stringContaining("level up again"));
	});

	it("stops when the XP runs out", async () => {
		const { sheet } = makeSheet({ canLevelUp: false });
		await sheet._onLevelUpOpen();
		opened[0]._onDone("Berserker", { applied: true });
		await Promise.resolve();
		expect(opened).toHaveLength(1);
	});

	it("does not reopen after a refused level-up", async () => {
		const { sheet } = makeSheet({ canLevelUp: true });
		await sheet._onLevelUpOpen();
		opened[0]._onDone(null, { applied: false });
		await Promise.resolve();
		expect(opened).toHaveLength(1);
	});

	it("checks the foreign move a cross-playbook pick learned for a freed possession choice", async () => {
		const { sheet } = makeSheet({ canLevelUp: false });
		await sheet._onLevelUpOpen();
		opened[0]._onDone("Initiate of the Secret Arts", { applied: true, foreignMoveName: "Big Magic" });
		expect(sheet._maybeOpenPossessionChoicesForMove).toHaveBeenCalledWith("Initiate of the Secret Arts");
		expect(sheet._maybeOpenPossessionChoicesForMove).toHaveBeenCalledWith("Big Magic");
	});

	it("raises the window already open for that character instead of opening another", async () => {
		const { sheet, character } = makeSheet({ canLevelUp: true });
		const open = { id: "stonetop-levelup-dialog-actorA", bringToTop: vi.fn() };
		global.ui.windows = { 3: open };
		await sheet._onLevelUpOpen();
		expect(open.bringToTop).toHaveBeenCalled();
		expect(character.getLevelUpData).not.toHaveBeenCalled();
		expect(opened).toHaveLength(0);
	});
});

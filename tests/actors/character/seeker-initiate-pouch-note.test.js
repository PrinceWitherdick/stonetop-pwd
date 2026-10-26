// Seeker audit B6 and C14.
// B6: "also grants a Sacred Pouch" is said only on the Initiate of the Secret Arts take that brings
// the pouch: the level-up card and the Moves tab's foreign-move picker both stay quiet on a second
// or third take, when the pouch is already held.
// C14: un-picking a possession forgets its spent uses and picks, so picking it again starts fresh.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLiveCharacter, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { LevelUpDialog } from "../../../module/actors/character/dialogs/LevelUpDialog.js";

// The level-up's agreed step asks a world setting whether this user may write a custom move
// (utils/authoring-gates.js); a world always has settings, so the tests give it some, all unset.
let priorSettings;
beforeEach(() => { priorSettings = game.settings; game.settings ??= { get: () => undefined }; });
afterEach(() => { game.settings = priorSettings; });

const POUCH = "sacred-pouch";
const INITIATE = "Initiate of the Secret Arts";
const seekerMove = name => sourceMovesFor("The Seeker").find(d => d.name === name);

describe("B6: the level-up card's pouch note", () => {
	async function levelUpNote(holdsPouch) {
		const character = {
			getForeignMovesForLevelUp: vi.fn(async () => [{ compendiumId: "f1", name: "Big Magic", playbook: "The Blessed" }]),
			holdsPossession: vi.fn(async slug => slug === POUCH && holdsPouch),
		};
		const dlg = new LevelUpDialog(character, {
			level: 5, newLevel: 6, cost: 16, xpRemaining: 0, playbookName: "The Seeker", needsInvocation: false,
			availableMoves: [{ compendiumId: "i1", name: INITIATE, cap: null, crossPlaybook: { playbooks: ["The Blessed"], grantsPossession: POUCH } }],
			lockedMoves: [], availableInvocations: [], stats: [],
		}, vi.fn());
		dlg._selectedMoveId = "i1";
		dlg._step = "foreignMove";
		await dlg._loadForeignMoves();
		return dlg.getData().foreignGrantsPouch;
	}

	it("shows on the first take", async () => {
		expect(await levelUpNote(false)).toBe(true);
	});

	it("is gone once the pouch is held (a second Initiate)", async () => {
		expect(await levelUpNote(true)).toBe(false);
	});
});

describe("B6: the Moves tab's foreign-move picker", () => {
	const priorDialog = global.Dialog;
	afterEach(() => { global.Dialog = priorDialog; });

	async function pickerContent(flags) {
		let config = null;
		global.Dialog = class { constructor(c) { config = c; } render() { return this; } };
		const { char, actor } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", level: 6, flags });
		actor.typedActor = char;
		const Base = class {
			constructor() { this._actor = actor; }
			get actor() { return this._actor; }
			get isEditable() { return true; }
			async getData() { return {}; }
			activateListeners() {}
			render = vi.fn();
		};
		const sheet = new (createStonetopCharacterSheetClass(Base))();
		sheet._stonetopCharacter = char;
		const initiate = await char.addMove(seekerMove(INITIATE)._id);
		await sheet._maybePromptForeignMove(initiate);
		return config?.content ?? "";
	}

	it("says the pouch comes with the first take", async () => {
		expect(await pickerContent({})).toContain("also grants a Sacred Pouch");
	});

	it("stays quiet when the pouch is already held", async () => {
		expect(await pickerContent({ "possessions.selected": [POUCH] })).not.toContain("also grants a Sacred Pouch");
	});
});

describe("C14: re-picking a possession starts it fresh", () => {
	it("Books & scrolls un-picked with 3 spent comes back full", async () => {
		const { char, actor } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker",
			flags: { "possessions.selected": ["books-and-scrolls"], "possessions.uses": { "books-and-scrolls": 3 } } });
		await char.deselectPossession("books-and-scrolls");
		await char.selectPossession("books-and-scrolls");
		expect(actor.getFlag("stonetop-pwd", "possessions.selected")).toContain("books-and-scrolls");
		expect(actor.getFlag("stonetop-pwd", "possessions.uses")?.["books-and-scrolls"]).toBeUndefined();
	});
});

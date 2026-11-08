// Level Up audit 2026-11-06, the shared-rules slice (XPB):
// L8: a 2nd or 3rd Initiate of the Secret Arts ticked on the Moves tab with no Blessed move to learn
//     un-ticks, as the Level Up window refuses it; only a take that brings the pouch is kept.
// L13: the "Requires" line on another playbook's move names its level gate, as the book prints it
//     ("(Requires level 6+ and Magnificent Specimen)", Book I p.131).
// L16: the Moves tab's stat and foreign-move pickers speak through en.json, and the foreign picker
//     carries the insert note the Level Up window shows.

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLiveCharacter, ownedMoveNames, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { createStonetopCharacterSheetClass } from "../../../module/actors/character/StonetopCharacterSheet.js";
import { insertZeroHpMoveName } from "../../../module/actors/character/insert-inert-note.js";
import { readRepo } from "../../fakes/css.js";

const POUCH = "sacred-pouch";
const INITIATE = "Initiate of the Secret Arts";
const move = (playbook, name) => sourceMovesFor(playbook).find(d => d.name === name);

const priorDialog = global.Dialog;
afterEach(() => { global.Dialog = priorDialog; vi.restoreAllMocks(); });

function sheetFor(char, actor) {
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
	return sheet;
}

function captureDialog() {
	const seen = { config: null };
	global.Dialog = class { constructor(c) { seen.config = c; } render() { return this; } };
	return seen;
}

describe("L8: an Initiate with nothing to learn on the Moves tab", () => {
	async function tickInitiate(flags) {
		const seen = captureDialog();
		const { char, actor } = buildLiveCharacter({ slug: "the-seeker", name: "The Seeker", level: 6, flags });
		const sheet = sheetFor(char, actor);
		vi.spyOn(char, "getForeignMovesForLevelUp").mockResolvedValue([]);
		const info = vi.spyOn(ui.notifications, "info");
		const warn = vi.spyOn(ui.notifications, "warn");
		const initiate = await char.addMove(move("The Seeker", INITIATE)._id);
		await sheet._maybePromptForeignMove(initiate);
		return { actor, seen, info, warn };
	}

	it("keeps the first take, which brings the Sacred Pouch, and says so", async () => {
		const { actor, seen, info, warn } = await tickInitiate({});
		expect(ownedMoveNames(actor)).toContain(INITIATE);
		expect(actor.getFlag("stonetop-pwd", "possessions.selected")).toContain(POUCH);
		expect(info.mock.calls[0][0]).toMatch(/but it grants a Sacred Pouch/);
		expect(warn).not.toHaveBeenCalled();
		expect(seen.config).toBeNull();
	});

	it("un-ticks a take that would give nothing because the pouch is already held, and says why", async () => {
		const { actor, info, warn } = await tickInitiate({ "possessions.selected": [POUCH] });
		expect(ownedMoveNames(actor)).not.toContain(INITIATE);
		expect(warn.mock.calls[0][0]).toMatch(/would give you nothing\. It has been unticked/);
		expect(info).not.toHaveBeenCalled();
	});
});

describe("L13: another playbook's move names its level gate", () => {
	it("Beast of Legend through Wild Soul reads its level 6+ as well as Magnificent Specimen", async () => {
		const { char } = buildLiveCharacter({ slug: "the-blessed", name: "The Blessed", level: 6 });
		await char.addMove(move("The Ranger", "Animal Companion")._id);
		await char.addMove(move("The Ranger", "Magnificent Specimen")._id);
		const wildSoul = move("The Blessed", "Wild Soul").system.crossPlaybook;
		const offered = await char.getForeignMovesForLevelUp(wildSoul, 6);
		const beast = offered.find(m => m.name === "Beast of Legend");
		expect(beast.requiresLabel).toBe("Magnificent Specimen; level 6+");
		// A move with no level gate says only what it needs.
		expect(offered.find(m => m.name === "Animal Companion")).toBeUndefined();
		expect(offered.find(m => m.name === "Big Game Hunter").requiresLabel).toBeNull();
	});

	it("a replacing move says its level and what it replaces (A Mighty Rampart, Book I p.119)", async () => {
		const { char } = buildLiveCharacter({ slug: "the-would-be-hero", name: "The Would-Be Hero", level: 6 });
		await char.addMove(move("The Judge", "Bulwark")._id);
		const offered = await char.getForeignMovesForLevelUp({ playbooks: "any" }, 6);
		expect(offered.find(m => m.name === "A Mighty Rampart").requiresLabel).toBe("level 6+; replaces Bulwark");
	});
});

describe("L16: the Moves tab's pickers", () => {
	it("the insert note is one helper, the Level Up window's included", () => {
		expect(readRepo("module/actors/character/dialogs/LevelUpDialog.js")).toContain("import { insertInertNote } from \"../insert-inert-note.js\"");
		expect(insertZeroHpMoveName({ postDeathSlug: null, zeroHpMove: { name: "Death's Door", dialog: true } })).toBeNull();
		expect(insertZeroHpMoveName({ postDeathSlug: "revenant", zeroHpMove: { name: "Undying" } })).toBe("Undying");
	});

	it("the foreign-move picker is translated and says Hard to Kill never fires for a Revenant", async () => {
		const seen = captureDialog();
		const { char, actor } = buildLiveCharacter({
			slug: "the-fox", name: "The Fox", level: 2, flags: { postDeathInsert: { slug: "revenant" } },
		});
		const sheet = sheetFor(char, actor);
		vi.spyOn(char, "getForeignMovesForLevelUp").mockResolvedValue([
			{ compendiumId: "h1", name: "Hard to Kill", playbook: "The Heavy", description: "<p>x</p>", requiresLabel: null, stockNote: null },
			{ compendiumId: "c1", name: "Call the Spirits", playbook: "The Blessed", description: "<p>y</p>", requiresLabel: "Spirit Tongue", stockNote: "Costs Stock; you have no sacred pouch." },
		]);
		const dabbler = await char.addMove(move("The Fox", "Dabbler")._id);
		await sheet._maybePromptForeignMove(dabbler);
		const { config } = seen;
		expect(config.title).toBe("Dabbler: Learn a Move");
		expect(config.buttons.learn.label).toBe("Learn");
		expect(config.buttons.cancel.label).toBe("Cancel");
		expect(config.content).toContain("Choose a move to learn from another playbook.");
		expect(config.content).toContain('aria-label="Move to learn"');
		expect(config.content).toContain('aria-live="polite"');
		expect(config.content).toContain("Call the Spirits (costs Stock)");
		// The first option's text, shown at once: Hard to Kill, with the insert note.
		expect(config.content).toMatch(/Never fires for you: at 0 HP you face Undying, not Death(&#x27;|')s Door\./);
	});

	it("the stat picker is translated", async () => {
		const seen = captureDialog();
		const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level: 2, stats: { str: 2, dex: 1, con: 1, int: 0, wis: 0, cha: -1 } });
		const sheet = sheetFor(char, actor);
		const improved = await char.addMove(move("The Heavy", "Improved Stat")._id);
		await sheet._maybePromptStatIncrease(improved);
		const { config } = seen;
		expect(config.title).toBe("Improved Stat: Increase a Stat");
		expect(config.content).toContain("Choose one stat to raise by +1 (max +2).");
		expect(config.content).toContain("Already at the max (+2): STR.");
		expect(config.buttons.dex.label).toBe("DEX (+1 to +2)");
		expect(config.buttons.str).toBeUndefined();
	});

	it("no English is left in either picker's code", () => {
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		const start = sheet.indexOf("async _maybePromptStatIncrease(addedItem");
		const end = sheet.indexOf("async _onMoveResourceChange(");
		const pickers = sheet.slice(start, end);
		for (const english of ["Increase a Stat", "Learn a Move", "Already at the max", "(costs Stock)", "Requires: ", "label: \"Learn\"", "label: \"Cancel\"", "no Blessed move qualifies"]) {
			expect(pickers, english).not.toContain(english);
		}
	});
});

// Coverage pass (2026-10-16): Iron Will ("you can take 1d4 damage (ignoring armor) to disregard its
// influence", Book I p.138) and Unfettered ("you may mark a debility to immediately break free of that
// restraint", p.115) were text only. Used from their posted card (StonetopCharacterSheet.js's
// MOVE_USE_EFFECTS).

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { Window } from "happy-dom";
import { ironWill, unfettered, IRON_WILL, UNFETTERED, IRON_WILL_DAMAGE } from "../../../module/actors/character/will-and-restraint.js";
import { readRepo } from "../../fakes/css.js";

const SCOPE = "stonetop-pwd";
const character = (moves, extra = {}) => ({
	type: "character", name: "Wren",
	items: moves.map(m => ({ type: "move", name: m.name ?? m, flags: m.learned === false ? { [SCOPE]: { learned: false } } : {} })),
	...extra,
});

describe("Iron Will", () => {
	let saved;
	beforeEach(() => { saved = globalThis.document; globalThis.document = new Window().document; });
	afterEach(() => { globalThis.document = saved; });

	it("asks, and on a yes rolls 1d4 at the hero, ignoring armor", async () => {
		const roll = vi.fn(async () => {});
		const hero = character([IRON_WILL]);
		expect(await ironWill(hero, { ask: async () => true, roll })).toBe(true);
		expect(roll).toHaveBeenCalledWith(hero, { move: IRON_WILL, damage: { formula: "1d4", self: true, ignoresArmor: true } });
		expect(IRON_WILL_DAMAGE).toEqual({ formula: "1d4", self: true, ignoresArmor: true });
	});

	it("rolls nothing when declined, or without the move learned", async () => {
		const roll = vi.fn();
		expect(await ironWill(character([IRON_WILL]), { ask: async () => false, roll })).toBe(false);
		const ask = vi.fn(async () => true);
		expect(await ironWill(character([{ name: IRON_WILL, learned: false }]), { ask, roll })).toBe(false);
		expect(ask).not.toHaveBeenCalled();
		expect(roll).not.toHaveBeenCalled();
	});
});

describe("Unfettered", () => {
	const heavy = (choices, moves = [UNFETTERED]) => {
		const markDebility = vi.fn(async () => true);
		return character(moves, { typedActor: { debilityMarkChoices: choices, markDebility } });
	};

	it("offers the debilities still unmarked, and marks the one picked, saying so", async () => {
		const actor = heavy([
			{ key: "weakened", name: "Weakened", description: "STR", marked: false },
			{ key: "dazed", name: "Dazed", description: "INT", marked: true },
		]);
		const pick = vi.fn();
		const note = vi.fn(async () => {});
		expect(unfettered(actor, { pick, note })).toBe(true);
		const spec = pick.mock.calls[0][0];
		expect(spec.marked.map(d => d.id)).toEqual(["weakened"]);
		await spec.onApply(spec.marked[0]);
		expect(actor.typedActor.markDebility).toHaveBeenCalledWith("weakened", { moveName: UNFETTERED });
		expect(note.mock.calls[0][2]).toContain("Wren marks Weakened");
	});

	it("opens nothing with every debility marked, or without the move learned", () => {
		const pick = vi.fn();
		expect(unfettered(heavy([{ key: "weakened", name: "Weakened", marked: true }]), { pick })).toBe(false);
		expect(unfettered(heavy([{ key: "weakened", name: "Weakened", marked: false }], [{ name: UNFETTERED, learned: false }]), { pick })).toBe(false);
		expect(pick).not.toHaveBeenCalled();
	});
});

describe("their use from the posted card", () => {
	it("are MOVE_USE_EFFECTS rows, gated on the sheet being editable", () => {
		const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
		expect(sheet).toContain("[IRON_WILL]:          sheet => sheet.isEditable && ironWill(sheet.actor),");
		expect(sheet).toContain("[UNFETTERED]:         sheet => sheet.isEditable && unfettered(sheet.actor),");
	});
});

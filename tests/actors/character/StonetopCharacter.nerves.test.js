import { describe, it, expect, beforeEach } from "vitest";
import { buildLiveCharacter, makeLiveItem, resetLiveIds } from "../../fakes/LiveCharacter.js";
import { WE_HAPPY_FEW } from "../../../module/actors/character/fight-states.js";

// We Happy Few's 6- through a real StonetopCharacter: "you have disadvantage on all rolls until you
// share your nerves with someone". The state's own switching is fight-states.test.js's; what is checked
// here is that it reaches the one place every roll's mode is settled, and folds there the way p.230 says.

function marshal({ shaken = false, weakened = false, raging = false } = {}) {
	const { char, actor } = buildLiveCharacter({
		slug: "the-marshal", name: "The Marshal", seedStartingMoves: false,
		items: [makeLiveItem({ name: WE_HAPPY_FEW, type: "move", system: { rollType: "cha" } })],
		flags: { ...(shaken ? { shakenNerves: true } : {}), ...(raging ? { battleJoy: true } : {}) },
	});
	if (weakened) actor.system.attributes.debilities.options.weakened.value = true;
	return { char, actor };
}

beforeEach(() => resetLiveIds());

describe("shaken nerves on a roll", () => {
	it("puts every roll at disadvantage, and names why on the card", () => {
		const { char } = marshal({ shaken: true });
		const opts = char.applyDebilityRollMode("int", { rollMode: "normal" });
		expect(opts.rollMode).toBe("dis");
		expect(opts.conditionNotes).toEqual(["Shaken nerves (We Happy Few)"]);
	});

	it("cancels an advantage into a straight roll", () => {
		const { char } = marshal({ shaken: true });
		expect(char.applyDebilityRollMode("int", { rollMode: "adv" }).rollMode).toBe("normal");
	});

	it("does not stack with a debility: an advantage still only cancels to straight", () => {
		const { char } = marshal({ shaken: true, weakened: true });
		expect(char.applyDebilityRollMode("str", { rollMode: "adv" }).rollMode).toBe("normal");
		expect(char.applyDebilityRollMode("str", { rollMode: "normal" }).rollMode).toBe("dis");
	});

	it("is not a debility, so a Battle Joy does not wave it away", () => {
		const { char } = marshal({ shaken: true, weakened: true, raging: true });
		expect(char.applyDebilityRollMode("str", { rollMode: "normal" }).rollMode).toBe("dis");
	});

	it("leaves a steady Marshal's rolls exactly as they were", () => {
		const { char } = marshal();
		expect(char.applyDebilityRollMode("int", { rollMode: "normal" })).toEqual({ rollMode: "normal" });
	});
});

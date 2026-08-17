import { describe, it, expect, beforeEach } from "vitest";
import { buildLiveCharacter, makeLiveItem, resetLiveIds } from "../../fakes/LiveCharacter.js";
import { BATTLE_JOY } from "../../../module/actors/character/battle-joy.js";

// Battle Joy's debility clause, driven through a real StonetopCharacter against a stateful actor.
// The pure predicates live in battle-joy.test.js; what is checked HERE is the wiring — that the
// state reaches the one place a debility touches a roll, and that rolling the move leaves it.

function heavy({ raging = false, weakened = false } = {}) {
	const { char, actor } = buildLiveCharacter({
		slug: "the-heavy", name: "The Heavy", seedStartingMoves: false,
		items: [makeLiveItem({ name: BATTLE_JOY, type: "move", system: { rollType: "con" } })],
		flags: raging ? { battleJoy: true } : {},
	});
	if (weakened) actor.system.attributes.debilities.options.weakened.value = true;
	return { char, actor };
}

beforeEach(() => resetLiveIds());

describe("a marked debility, ordinarily", () => {
	it("turns the roll it touches into disadvantage and names itself on the card", () => {
		const { char } = heavy({ weakened: true });
		expect(char.applyDebilityRollMode("str", { rollMode: "normal" })).toMatchObject({
			rollMode: "dis", stonetopDebility: "Weakened",
		});
	});

	it("cancels an advantage rather than compounding with it", () => {
		const { char } = heavy({ weakened: true });
		expect(char.applyDebilityRollMode("str", { rollMode: "adv" }).rollMode).toBe("normal");
	});

	it("leaves a stat it does not touch alone", () => {
		const { char } = heavy({ weakened: true });
		expect(char.applyDebilityRollMode("int", { rollMode: "normal" })).toEqual({ rollMode: "normal" });
	});
});

describe("the same debility while the Heavy is in their Battle Joy", () => {
	it("does nothing to the roll, and says so on the card", () => {
		const { char } = heavy({ weakened: true, raging: true });
		const opts = char.applyDebilityRollMode("str", { rollMode: "normal" });
		expect(opts.rollMode).toBe("normal");
		expect(opts.stonetopDebility).toBeUndefined();
		expect(opts).toMatchObject({ stonetopDebilityIgnored: BATTLE_JOY, stonetopDebilityIgnoredName: "Weakened" });
	});

	// The point of IGNORING it rather than merely offsetting it: an advantage the debility would
	// have cancelled survives intact.
	it("leaves an advantage standing", () => {
		const { char } = heavy({ weakened: true, raging: true });
		expect(char.applyDebilityRollMode("str", { rollMode: "adv" }).rollMode).toBe("adv");
	});

	// The box stays ticked — they are still weakened, and it bites again the moment it ends.
	it("does not clear the debility itself", async () => {
		const { char, actor } = heavy({ weakened: true, raging: true });
		expect(actor.system.attributes.debilities.options.weakened.value).toBe(true);
		await char.setBattleJoy(false);
		expect(char.applyDebilityRollMode("str", { rollMode: "normal" }).rollMode).toBe("dis");
	});
});

describe("entering and leaving", () => {
	it("reports only real changes, so a repeat write broadcasts nothing", async () => {
		const { char } = heavy();
		expect(await char.setBattleJoy(true)).toBe(true);
		expect(await char.setBattleJoy(true)).toBe(false);
		expect(char.battleJoy).toBe(true);
		expect(await char.setBattleJoy(false)).toBe(true);
		expect(await char.setBattleJoy(false)).toBe(false);
	});

	// "When the action stops, roll +CON" — so making that roll IS leaving the state, and it has to
	// be gone BEFORE the roll is built or the ending roll would itself ignore the debility.
	it("ends the rage when Battle Joy itself is rolled", async () => {
		const { char, actor } = heavy({ raging: true });
		const item = actor.items.find(i => i.name === BATTLE_JOY);
		expect(await char._endBattleJoyBeforeRoll(item)).toBe(true);
		expect(char.battleJoy).toBe(false);
	});

	it("leaves it alone for any other move", async () => {
		const { char } = heavy({ raging: true });
		expect(await char._endBattleJoyBeforeRoll({ name: "Clash" })).toBe(false);
		expect(await char._endBattleJoyBeforeRoll(null)).toBe(false);
		expect(char.battleJoy).toBe(true);
	});
});

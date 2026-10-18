import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";

// A move made "as if you rolled" a total: Death's Door's 6-, "Make one last move as if you rolled a 12+"
// (Book I p.245; deaths-door.js#makeLastMove). onRoll hands the total to the card's roll (roll-engine.js
// #rollStat's asIfTotal) with the reason named, claims none of the +forward a real roll is owed, and an
// "ask" move keeps its own name and whole text, since no stat was picked.
const flow = vi.hoisted(() => ({ begin: vi.fn(async () => null) }));
vi.mock("../../../module/combat/attack-flow.js", async (importOriginal) => ({
	...(await importOriginal()),
	maybeBeginAttack: flow.begin,
}));

function eventFor(itemId) {
	return {
		currentTarget: {
			closest: (sel) => (sel === ".item" ? { dataset: { itemId } } : null),
			getAttribute: () => null,
			classList: { contains: () => false },
			dataset: {},
		},
	};
}

function characterWith(item) {
	const actor = new FakeActorBuilder().build();
	const items = [item];
	items.get = (id) => items.find(i => i._id === id) ?? null;
	actor.items = items;
	return new TestCharacterBuilder(actor).build();
}

beforeEach(() => { flow.begin.mockClear(); });

describe("onRoll, as if rolled", () => {
	it("hands the total and its reason to the roll, and claims nothing it is owed", async () => {
		const item = { _id: "dd", name: "Defy Danger", type: "move", system: { rollType: "ask" }, roll: vi.fn(async () => ({ total: 12 })) };
		const character = characterWith(item);
		const claim = vi.spyOn(character, "_claimNextRollOwed");

		await character.onRoll(eventFor("dd"), { asIfTotal: 12, conditionNotes: ["Death's Door: one last move"] });

		const options = item.roll.mock.calls[0][0];
		expect(options.asIfTotal).toBe(12);
		expect(options.conditionNotes).toContain("Death's Door: one last move");
		expect(options.statOverride).toBeUndefined();
		expect(claim).not.toHaveBeenCalled();
	});

	// Its mode is forced normal, so the advantage a grudge is owed (Alpha, But I Get Up Again) was never used:
	// none is folded in to be named on the card, and none is spent.
	it("folds in and spends no aimed advantage", async () => {
		const item = { _id: "dd", name: "Defy Danger", type: "move", system: { rollType: "ask" }, roll: vi.fn(async () => ({ total: 12 })) };
		const character = characterWith(item);
		const spend = vi.fn(async () => {});
		const fold = vi.spyOn(character, "_foldAimedModes").mockImplementation((options, targets) => (
			targets.length ? { options: { ...options, rollMode: "adv" }, spend, oathbreaker: false } : { options, spend: async () => {}, oathbreaker: false }));
		vi.spyOn(character, "_rollTargets").mockReturnValue([{ id: "foe" }]);

		await character.onRoll(eventFor("dd"), { asIfTotal: 12 });

		expect(fold.mock.calls[0][1]).toEqual([]);
		expect(item.roll.mock.calls[0][0].rollMode).not.toBe("adv");
		expect(spend).not.toHaveBeenCalled();
	});

	it("leaves an ordinary roll as it was", async () => {
		const item = { _id: "dd", name: "Defy Danger", type: "move", system: { rollType: "ask" }, roll: vi.fn(async () => ({ total: 8 })) };
		await characterWith(item).onRoll(eventFor("dd"), { statOverride: "dex" });
		const options = item.roll.mock.calls[0][0];
		expect(options.asIfTotal).toBeUndefined();
		expect(options.statOverride).toBe("dex");
	});
});

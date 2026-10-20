import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";

// Prepare a Welcome spends 1 Surprise as it is rolled (combat/battle-holds.js#spendSurpriseForRoll), after
// every window the roll asks. A roll that then throws no dice (it fails, or comes to nothing) puts the
// Surprise back; one whose dice land keeps it spent, a 6- included, and tells the tier effects it was spent.
const holds = vi.hoisted(() => ({
	spend: vi.fn(async () => ({ note: "Spent 1 Surprise (1 left)", spent: true })),
	refund: vi.fn(async () => true),
}));
vi.mock("../../../module/combat/battle-holds.js", async (importOriginal) => ({
	...(await importOriginal()),
	spendSurpriseForRoll: holds.spend,
	refundSurpriseForRoll: holds.refund,
}));
vi.mock("../../../module/combat/attack-flow.js", async (importOriginal) => ({
	...(await importOriginal()),
	maybeBeginAttack: vi.fn(async () => null),
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

function welcomeRolling(roll) {
	const item = { _id: "pw", name: "Prepare a Welcome", type: "move", flags: {}, system: { rollType: "int" }, roll: vi.fn(roll) };
	const actor = new FakeActorBuilder().build();
	const items = [item];
	items.get = (id) => items.find(i => i._id === id) ?? null;
	actor.items = items;
	const character = new TestCharacterBuilder(actor).build();
	const settle = vi.spyOn(character, "_settleRolledTierEffects").mockResolvedValue(undefined);
	return { item, character, settle };
}

beforeEach(() => { holds.spend.mockClear(); holds.refund.mockClear(); });

describe("Prepare a Welcome's Surprise, when no dice are thrown", () => {
	it("is put back for a roll that came to nothing", async () => {
		const { character, settle } = welcomeRolling(async () => undefined);
		await character.onRoll(eventFor("pw"), {});
		expect(holds.spend).toHaveBeenCalledTimes(1);
		expect(holds.refund).toHaveBeenCalledTimes(1);
		expect(settle).not.toHaveBeenCalled();
	});

	it("is put back for a roll that failed, and the error still reaches the caller", async () => {
		const { character } = welcomeRolling(async () => { throw new Error("the card could not be posted"); });
		await expect(character.onRoll(eventFor("pw"), {})).rejects.toThrow("the card could not be posted");
		expect(holds.refund).toHaveBeenCalledTimes(1);
	});

	it("stays spent once the dice land, a 6- included, and the tier effects are told it was spent", async () => {
		const { character, settle } = welcomeRolling(async () => ({ total: 4 }));
		await character.onRoll(eventFor("pw"), {});
		expect(holds.refund).not.toHaveBeenCalled();
		expect(settle).toHaveBeenCalledTimes(1);
		expect(settle.mock.calls[0][4]).toEqual({ surpriseSpent: true });
	});

	it("is not put back when none was spent", async () => {
		holds.spend.mockResolvedValueOnce({ note: "No Surprise held to spend", spent: false });
		const { character } = welcomeRolling(async () => undefined);
		await character.onRoll(eventFor("pw"), {});
		expect(holds.refund).not.toHaveBeenCalled();
	});
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeActorBuilder } from "../../fakes/FakeActorBuilder.js";
import { TestCharacterBuilder } from "../../fakes/TestCharacterBuilder.js";

// What onRoll answers when the ATTACK PROMPT is backed out of, as opposed to when the dice land.
//
// Clash and Let Fly ask for a weapon and a target before they roll (module/combat/attack-flow.js),
// and closing either prompt means no roll happened. onRoll still has to stop its caller looking for
// another way to roll the same rollable — so the answer is truthy either way — but a caller with an
// after-the-roll effect to fire (MOVE_ROLL_EFFECTS: the Blessed's marking moves, the Judge's
// roster) has to be able to tell the two apart. While both answered `true`, the guards written for
// exactly that were doing nothing, and the comments above them were describing a check that wasn't
// there.
//
// Only `maybeBeginAttack` is replaced; StonetopCharacter also imports `attackMoveFor` from the same
// module and the real one is what decides whether the readiness shed applies.
const flow = vi.hoisted(() => ({ begin: vi.fn() }));
vi.mock("../../../module/combat/attack-flow.js", async (importOriginal) => ({
	...(await importOriginal()),
	maybeBeginAttack: flow.begin,
}));

const { normalizeRollType } = await import("../../../module/utils/roll-types.js");

/** A Clash the character owns, with a rollType so it reaches the attack branch at all. */
function clashItem() {
	return { _id: "clash-1", name: "Clash", type: "move", system: { rollType: "str", rollFormula: null }, roll: vi.fn() };
}

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
	const actor = new FakeActorBuilder().withRollMode("def").build();
	const items = [item];
	items.get = (id) => items.find(i => i._id === id) ?? null;
	actor.items = items;
	return new TestCharacterBuilder(actor).build();
}

beforeEach(() => { flow.begin.mockReset(); });

describe("StonetopCharacter.onRoll and a cancelled attack prompt", () => {
	it("guards that the fixture really is an attack move", () => {
		// If `rollType` ever stopped normalising, every assertion below would pass for the wrong
		// reason — onRoll would bail before it ever reached maybeBeginAttack.
		expect(normalizeRollType("str")).toBe("str");
	});

	it("answers \"cancel\", not true, when the weapon or target prompt is closed", async () => {
		flow.begin.mockResolvedValue("cancel");
		const item = clashItem();

		expect(await characterWith(item).onRoll(eventFor("clash-1"))).toBe("cancel");
		// The whole claim: no dice were thrown.
		expect(item.roll).not.toHaveBeenCalled();
	});

	it("is still truthy, so no caller falls through to a bare stat roll", async () => {
		// The fall-through the sheet's rollable handler runs on a falsy answer would roll +STR with
		// no card and no attack, which is worse than doing nothing.
		flow.begin.mockResolvedValue("cancel");
		expect(await characterWith(clashItem()).onRoll(eventFor("clash-1"))).toBeTruthy();
	});

	it("answers true when the attack was resolved without a roll", async () => {
		// Let Fly's "easy shot" — handled, and genuinely used, so an after-the-roll effect belongs.
		flow.begin.mockResolvedValue("handled");
		expect(await characterWith(clashItem()).onRoll(eventFor("clash-1"))).toBe(true);
	});

	it("answers true when the prompts were answered and the dice landed", async () => {
		flow.begin.mockResolvedValue(null);
		const item = clashItem();

		expect(await characterWith(item).onRoll(eventFor("clash-1"))).toBe(true);
		expect(item.roll).toHaveBeenCalledOnce();
	});
});

// Potential for Greatness is marked in play, "once per level, when you roll a stat and get
// a 10+." maybeRemindPotentialForGreatness posts a chat reminder when a Would-Be Hero who
// still has an unmarked box rolls a 10+ on an actual stat roll and hasn't marked it this level.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { maybeRemindPotentialForGreatness } from "../../../module/actors/character/WouldBeHeroAsterisk.js";

// `slug` is what the guard reads; `playbook` is the label, and they are separable on purpose.
function makeActor({ playbook = "The Would-Be Hero", slug = "the-would-be-hero", level = 3, ownsPfg = true, marks = {} } = {}) {
	const items = ownsPfg ? [{
		type: "move", name: "Potential for Greatness",
		system: { markOptions: [
			{ slug: "stat", marks: 4, choice: "stat" },
			{ slug: "hp", marks: 1 },
			{ slug: "damage", marks: 1 },
		] },
	}] : [];
	return {
		type: "character", name: "Wren", id: "a1",
		system: { playbook: { name: playbook, slug }, attributes: { level: { value: level } } },
		items,
		getFlag: (_scope, key) => key === "moves.moveMarks" ? { "Potential for Greatness": marks } : null,
	};
}

describe("maybeRemindPotentialForGreatness", () => {
	beforeEach(() => {
		global.ChatMessage = { create: vi.fn(), getSpeaker: vi.fn(() => ({})) };
	});

	it("reminds a Would-Be Hero on a 10+ stat roll with an unmarked box this level", async () => {
		await maybeRemindPotentialForGreatness(makeActor(), "str", 11);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("Potential for Greatness");
	});

	it("does not remind on a 7-9 (only a 10+ qualifies)", async () => {
		await maybeRemindPotentialForGreatness(makeActor(), "str", 9);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	// Same reason as the announcement's own retitle case: the reminder is a rule, and a rule
	// must not switch itself off because the label above it changed.
	it("still reminds a Would-Be Hero whose playbook has been retitled", async () => {
		await maybeRemindPotentialForGreatness(makeActor({ playbook: "The Hero" }), "wis", 12);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
	});

	it("does not remind a non-Would-Be-Hero", async () => {
		await maybeRemindPotentialForGreatness(makeActor({ playbook: "The Heavy", slug: "the-heavy" }), "str", 11);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("does not remind on a follower/crew roll (not 'rolling a stat')", async () => {
		await maybeRemindPotentialForGreatness(makeActor(), "follower", 11);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("does not remind when a box was already marked THIS level (once per level)", async () => {
		const actor = makeActor({ level: 3, marks: { hp: [{ stat: "", level: 3 }] } });
		await maybeRemindPotentialForGreatness(actor, "str", 11);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("reminds when the only existing mark is from a PREVIOUS level", async () => {
		const actor = makeActor({ level: 4, marks: { hp: [{ stat: "", level: 3 }] } });
		await maybeRemindPotentialForGreatness(actor, "wis", 12);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
	});

	it("does not remind when all six boxes are filled", async () => {
		const marks = {
			stat: [1, 2, 3, 4].map(() => ({ stat: "str", level: 2 })),
			hp: [{ stat: "", level: 2 }],
			damage: [{ stat: "", level: 2 }],
		};
		await maybeRemindPotentialForGreatness(makeActor({ marks }), "str", 11);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("does not remind a Would-Be Hero who doesn't own Potential for Greatness", async () => {
		await maybeRemindPotentialForGreatness(makeActor({ ownsPfg: false }), "str", 11);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});
});

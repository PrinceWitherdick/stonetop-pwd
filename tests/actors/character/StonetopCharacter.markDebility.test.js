// Marking a debility, and the HP that can ride along with it.
//
// The Heavy's Hard to Kill trades exactly that on a 7-9: "mark a debility of your choice to
// regain 1 HP", which is also what takes them out of being out of the action. One write, so it
// costs one ledger line and one re-render for what the player experienced as one decision.
//
// Driven against the stateful LiveCharacter harness, whose `update` actually writes, so these
// read the result back the way the sheet does.

import { describe, it, expect } from "vitest";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";

function build(hp = 20) {
	const { char, actor } = buildLiveCharacter({ slug: "the-heavy", name: "The Heavy" });
	actor.system.attributes.hp = { ...actor.system.attributes.hp, value: hp, max: 20 };
	return char;
}

describe("markDebility", () => {
	it("marks the debility", async () => {
		const char = build();
		expect(await char.markDebility("weakened")).toBe(true);
		expect(char.debilityChoices.find(d => d.key === "weakened").marked).toBe(true);
	});

	it("refuses one that is already marked, so a second click is not a second trade", async () => {
		const char = build();
		await char.markDebility("weakened");
		expect(await char.markDebility("weakened")).toBe(false);
	});

	it("refuses a key that is not a debility", async () => {
		expect(await build().markDebility("nonsense")).toBe(false);
	});

	it("brings the hit points up with it", async () => {
		const char = build(0);
		await char.markDebility("weakened", { hp: 1, moveName: "Hard to Kill" });
		expect(char.hp).toBe(1);
	});

	// The reason `hp` is a floor and not an assignment. Death's Door leaves the walkthrough open
	// while the rest of the table acts, so another PC can perfectly well heal the downed character
	// before they get round to clicking the trade — and "regain 1 HP" must not mean "go to 1 HP".
	it("never takes hit points DOWN to the number it was given", async () => {
		const char = build(6);
		await char.markDebility("weakened", { hp: 1, moveName: "Hard to Kill" });
		expect(char.hp).toBe(6);
	});

	// The debility is still the price of the trade even when the hit point it bought is moot.
	it("still marks the debility when the hit points do not move", async () => {
		const char = build(6);
		await char.markDebility("weakened", { hp: 1 });
		expect(char.debilityChoices.find(d => d.key === "weakened").marked).toBe(true);
	});

	it("leaves hit points alone when it is not asked about them", async () => {
		const char = build(4);
		await char.markDebility("weakened");
		expect(char.hp).toBe(4);
	});
});

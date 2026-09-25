// Forage: "In winter, you have disadvantage." Read off the steading's season clock
// (seasons/current-season.js#readCurrentSeason) and folded as a SOURCE at the same seam as Raised by
// Wolves' advantage (StonetopCharacter#seasonMoveDisadvantage), so the two cancel and a Disadvantage
// the player picked for the same winter does not count twice. Before this the player set it by hand.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildLiveCharacter } from "../../fakes/LiveCharacter.js";

// The steading as getStonetopSteadingActor finds it, with the clock stamped (or not).
function steadingIn(season) {
	return {
		id: "steading", type: "stonetop",
		getFlag: (scope, key) => (key === "seasonsCurrent" && season ? { season, year: 1 } : null),
	};
}
function worldWith(steading) {
	const actors = steading ? [steading] : [];
	global.game.actors = { find: fn => actors.find(fn) ?? null, get: id => actors.find(a => a.id === id) ?? null };
}

function forager({ slug = "the-ranger", name = "The Ranger", background = null, sticky = "normal" } = {}) {
	const forage = { _id: "forage-1", name: "Forage", type: "move", system: { rollType: "wis" }, roll: vi.fn(async () => ({ total: 8 })) };
	const made = buildLiveCharacter({
		slug, name, seedStartingMoves: false,
		flags: { rollMode: sticky, ...(background ? { background: { selected: background } } : {}) },
	});
	const items = [...made.actor.items, forage];
	items.get = id => items.find(i => i._id === id) ?? null;
	made.actor.items = items;
	return { ...made, forage };
}
const rollForage = async (char, prompted = {}) => char.onRoll({
	currentTarget: {
		closest: sel => (sel === ".item" ? { dataset: { itemId: "forage-1" } } : null),
		getAttribute: () => null,
	},
}, prompted);
const rolledWith = forage => forage.roll.mock.calls[0][0];

let savedActors;
beforeEach(() => { savedActors = global.game.actors; });
afterEach(() => { global.game.actors = savedActors; });

describe("winter on Forage", () => {
	it("imposes disadvantage and names Winter on the card", async () => {
		worldWith(steadingIn("winter"));
		const { char, forage } = forager();
		await rollForage(char);
		expect(rolledWith(forage).rollMode).toBe("dis");
		expect(rolledWith(forage).conditionNotes).toContain("Winter");
	});

	it("cancels Raised by Wolves' advantage: the roll goes straight, and both are named", async () => {
		worldWith(steadingIn("winter"));
		const { char, forage } = forager({ slug: "the-blessed", name: "The Blessed", background: "raised-by-wolves" });
		await rollForage(char);
		expect(rolledWith(forage).rollMode).toBe("normal");
		expect(rolledWith(forage).conditionNotes).toEqual(expect.arrayContaining(["Raised by Wolves", "Winter"]));
	});

	// The player who still picks Disadvantage for the winter out of habit rolls at plain disadvantage:
	// the same side speaking twice is still one disadvantage (utils/roll-mode.js#foldModes).
	it("does not count twice with a Disadvantage the player picked for the same winter", async () => {
		worldWith(steadingIn("winter"));
		const sticky = forager({ sticky: "dis" });
		await rollForage(sticky.char);
		expect(rolledWith(sticky.forage).rollMode).toBe("dis");

		const prompted = forager();
		await rollForage(prompted.char, { rollMode: "dis" });
		expect(rolledWith(prompted.forage).rollMode).toBe("dis");
	});

	it("cancels an Advantage the player picked", async () => {
		worldWith(steadingIn("winter"));
		const { char, forage } = forager();
		await rollForage(char, { rollMode: "adv" });
		expect(rolledWith(forage).rollMode).toBe("normal");
	});

	it("imposes nothing in any other season", async () => {
		for (const season of ["spring", "summer", "autumn"]) {
			worldWith(steadingIn(season));
			const { char, forage } = forager();
			await rollForage(char);
			expect(rolledWith(forage).rollMode).toBe("normal");
			expect(rolledWith(forage).conditionNotes ?? []).not.toContain("Winter");
		}
	});

	it("imposes nothing with no steading, or none whose season is recorded", async () => {
		worldWith(null);
		const bare = forager();
		expect(bare.char.seasonMoveDisadvantage("Forage")).toBeNull();
		await rollForage(bare.char);
		expect(rolledWith(bare.forage).rollMode).toBe("normal");

		worldWith(steadingIn(null));
		expect(forager().char.seasonMoveDisadvantage("Forage")).toBeNull();
	});

	it("is Forage's alone", () => {
		worldWith(steadingIn("winter"));
		const { char } = forager();
		expect(char.seasonMoveDisadvantage("Forage")).toBe("Winter");
		expect(char.seasonMoveDisadvantage("Defy Danger")).toBeNull();
		expect(char.seasonMoveDisadvantage(null)).toBeNull();
	});

	it("also rides a Forage rolled by name, with no owned item behind it", async () => {
		const rolled = [];
		vi.doMock("../../../module/utils/roll-engine.js", () => ({
			rollStat: vi.fn(async (stat, actor, options) => { rolled.push(options); return { total: 7 }; }),
		}));
		try {
			worldWith(steadingIn("winter"));
			const { char } = forager();
			await char.onDirectStatRoll("wis", { moveName: "Forage" });
			await char.onDirectStatRoll("wis", { moveName: "Know Things" });
			expect(rolled[0].rollMode).toBe("dis");
			expect(rolled[0].conditionNotes).toContain("Winter");
			expect(rolled[1].rollMode).toBe("normal");

			const wolf = forager({ slug: "the-blessed", name: "The Blessed", background: "raised-by-wolves" });
			await wolf.char.onDirectStatRoll("wis", { moveName: "Forage" });
			expect(rolled[2].rollMode).toBe("normal");
		} finally {
			vi.doUnmock("../../../module/utils/roll-engine.js");
		}
	});
});

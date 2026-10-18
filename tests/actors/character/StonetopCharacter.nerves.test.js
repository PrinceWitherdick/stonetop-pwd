import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

// Order Followers hands over the sides its window netted (Shield Wall's advantage, a hindering tag), so the
// nerves fold with each of them: one side each way is straight however many of each there are (p.230).
describe("shaken nerves on an Order Followers roll", () => {
	let rolled;
	beforeEach(() => {
		rolled = [];
		vi.doMock("../../../module/utils/roll-engine.js", () => ({
			rollStat: vi.fn(async (stat, actor, options) => { rolled.push(options); return { total: 7 }; }),
		}));
	});
	afterEach(() => vi.doUnmock("../../../module/utils/roll-engine.js"));

	it("keeps a cancelled advantage and disadvantage straight", async () => {
		const { char } = marshal({ shaken: true });
		await char.onOrderFollowersRoll({ bonus: 1, rollMode: "normal", modeSources: ["adv", "dis"], shieldWall: true });
		expect(rolled[0].rollMode).toBe("normal");
	});

	it("still cancels a lone advantage, and puts a straight roll at disadvantage", async () => {
		const { char } = marshal({ shaken: true });
		await char.onOrderFollowersRoll({ rollMode: "adv", modeSources: ["adv"] });
		await char.onOrderFollowersRoll({ rollMode: "normal", modeSources: [] });
		expect(rolled.map(o => o.rollMode)).toEqual(["normal", "dis"]);
	});
});

// Coverage pass (2026-10-16): Stentorian's "Spend 1 Command ... You have advantage to Order Followers" (Book I
// p.127). The window's box (OrderFollowersDialog) hands `command` over; the roll names it and pays 1 Command.
describe("Stentorian's Command on an Order Followers roll", () => {
	let rolled;
	beforeEach(() => {
		rolled = [];
		vi.doMock("../../../module/utils/roll-engine.js", () => ({
			rollStat: vi.fn(async (stat, actor, options) => { rolled.push(options); return { total: 7 }; }),
		}));
	});
	afterEach(() => vi.doUnmock("../../../module/utils/roll-engine.js"));

	function shouter(held) {
		const tracks = { Stentorian: held };
		const { char, actor } = buildLiveCharacter({
			slug: "the-marshal", name: "The Marshal", seedStartingMoves: false,
			items: [makeLiveItem({ name: "Stentorian", type: "move", system: { moveType: "playbook", resource: { max: 2, title: "Command" } } })],
		});
		const setUses = vi.fn(async (move, value) => { tracks[move] = value; });
		actor.typedActor = { moveResources: { getMoveResources: () => tracks, setUses } };
		return { char, tracks, setUses };
	}

	it("names Stentorian on the card and pays 1 Command once the dice land", async () => {
		const { char, tracks } = shouter(2);
		await char.onOrderFollowersRoll({ rollMode: "adv", modeSources: ["adv"], command: true });
		expect(rolled[0].conditionNotes).toContain("Stentorian");
		expect(tracks.Stentorian).toBe(1);
	});

	it("pays nothing and names nothing without the box, or with no Command held", async () => {
		const plain = shouter(2);
		await plain.char.onOrderFollowersRoll({ rollMode: "normal", modeSources: [] });
		expect(plain.setUses).not.toHaveBeenCalled();
		const empty = shouter(0);
		await empty.char.onOrderFollowersRoll({ rollMode: "adv", modeSources: ["adv"], command: true });
		expect(empty.setUses).not.toHaveBeenCalled();
		expect(rolled.every(o => !(o.conditionNotes ?? []).includes("Stentorian"))).toBe(true);
	});
});

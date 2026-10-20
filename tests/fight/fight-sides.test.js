import { describe, it, expect } from "vitest";
import { classifySide, otherSide, bodiesFor } from "../../module/fight/fight-sides.js";

const HOSTILE = -1;
const NEUTRAL = 0;
const FRIENDLY = 1;

describe("bodiesFor someone at 0 HP", () => {
	it("is out, unless they keep fighting (Unstoppable)", () => {
		expect(bodiesFor({ type: "character", hp: { value: 0, max: 20 } }).out).toBe(true);
		expect(bodiesFor({ type: "character", hp: { value: 0, max: 20 }, keepsFighting: true })).toMatchObject({ bodies: 1, out: false });
	});
});

describe("bodiesFor a group follower", () => {
	it("counts the members its character's roster has still standing, and routs it at none", () => {
		expect(bodiesFor({ type: "npc", roster: { standing: 4, size: 6 } })).toEqual({ bodies: 4, out: false, group: true, standing: 4, size: 6, routed: false });
	});

	it("reports a monster group's starting size once lone blows have dropped some, counting only those left", () => {
		const group = { type: "monster", fightAsGroup: true, organization: "horde", hp: { value: 3, max: 3 }, count: 5 };
		expect(bodiesFor({ ...group, startSize: 6 })).toMatchObject({ bodies: 5, standing: 5, size: 6 });
		// Never less than it is now: a group grown by a merge since.
		expect(bodiesFor({ ...group, startSize: 3 })).toMatchObject({ bodies: 5, size: 5 });
		expect(bodiesFor(group)).toMatchObject({ bodies: 5, size: 5 });
		expect(bodiesFor({ type: "npc", roster: { standing: 0, size: 6 } })).toMatchObject({ bodies: 0, out: true, routed: true });
	});

	it("reads the roster over any headcount the GM set", () => {
		expect(bodiesFor({ type: "npc", headcount: 9, roster: { standing: 5, size: 6 } }).bodies).toBe(5);
	});

	it("routs it when the pool on its token is empty", () => {
		expect(bodiesFor({ type: "npc", hp: { value: 0, max: 8 }, roster: { standing: 5, size: 6 } })).toMatchObject({ bodies: 0, out: true });
	});

	it("is one body for a follower who is one person", () => {
		expect(bodiesFor({ type: "npc", roster: null }).bodies).toBe(1);
	});
});

describe("classifySide", () => {
	it("puts characters and anything a player owns with the heroes", () => {
		expect(classifySide({ type: "character" })).toEqual({ side: "heroes", list: "heroes" });
		expect(classifySide({ type: "monster", hasPlayerOwner: true })).toEqual({ side: "heroes", list: "heroes" });
	});

	it("does not read the side off disposition: a character is a hero even when HOSTILE", () => {
		// Core creates characters and ordinary NPCs HOSTILE by default.
		expect(classifySide({ type: "character", disposition: HOSTILE }).side).toBe("heroes");
	});

	it("puts followers, and anything marked FRIENDLY, with the heroes", () => {
		expect(classifySide({ type: "npc", isFollower: true, disposition: HOSTILE })).toEqual({ side: "heroes", list: "heroes" });
		expect(classifySide({ type: "npc", disposition: FRIENDLY })).toEqual({ side: "heroes", list: "heroes" });
		expect(classifySide({ type: "monster", disposition: FRIENDLY })).toEqual({ side: "heroes", list: "heroes" });
	});

	it("puts monsters with the foes", () => {
		expect(classifySide({ type: "monster", disposition: HOSTILE })).toEqual({ side: "foes", list: "foes" });
	});

	it("puts any other NPC with the foes, but lists them apart as others", () => {
		expect(classifySide({ type: "npc", disposition: HOSTILE })).toEqual({ side: "foes", list: "others" });
		expect(classifySide({ type: "npc", disposition: NEUTRAL })).toEqual({ side: "foes", list: "others" });
	});

	it("never makes a combatant of the steading, a settlement or the GM Toolkit", () => {
		expect(classifySide({ type: "stonetop" })).toBeNull();
		expect(classifySide({ type: "settlement" })).toBeNull();
		expect(classifySide({ type: "gmToolkit", hasPlayerOwner: true })).toBeNull();
	});

	it("never makes a combatant of a type it does not know, such as one a module adds", () => {
		expect(classifySide({ type: "vehicle", disposition: HOSTILE })).toBeNull();
		expect(classifySide({ type: "vehicle", hasPlayerOwner: true })).toBeNull();
	});

	it("still places a body with no type at all, as an NPC would be", () => {
		expect(classifySide({ disposition: HOSTILE })).toEqual({ side: "foes", list: "others" });
		expect(classifySide({ type: "", hasPlayerOwner: true })).toEqual({ side: "heroes", list: "heroes" });
	});

	it("swaps sides", () => {
		expect(otherSide("heroes")).toBe("foes");
		expect(otherSide("foes")).toBe("heroes");
	});
});

describe("bodiesFor", () => {
	it("is one body by default", () => {
		expect(bodiesFor({ type: "character", hp: { value: 10, max: 18 } })).toMatchObject({ bodies: 1, out: false, group: false });
	});

	it("is out when marked defeated, or at 0 HP", () => {
		expect(bodiesFor({ defeated: true, hp: { value: 9, max: 9 } })).toMatchObject({ bodies: 0, out: true });
		expect(bodiesFor({ type: "monster", hp: { value: 0, max: 6 } })).toMatchObject({ bodies: 0, out: true });
		expect(bodiesFor({ type: "npc", hp: { value: -2, max: 6 } })).toMatchObject({ bodies: 0, out: true });
	});

	it("is not out for a token with no HP to lose", () => {
		expect(bodiesFor({ type: "npc", hp: { value: 0, max: 0 } })).toMatchObject({ bodies: 1, out: false });
		expect(bodiesFor({ type: "npc" })).toMatchObject({ bodies: 1, out: false });
	});

	it("takes a headcount the GM set on the combatant (a crew token)", () => {
		expect(bodiesFor({ type: "npc", headcount: 6, hp: { value: 8, max: 8 } })).toMatchObject({ bodies: 6, group: true, size: 6 });
		expect(bodiesFor({ type: "npc", headcount: 1 })).toMatchObject({ bodies: 1, group: false });
		expect(bodiesFor({ type: "npc", headcount: "junk" })).toMatchObject({ bodies: 1 });
	});

	it("counts a group monster fighting as a group by the members still standing (p.416 casualties)", () => {
		const full = bodiesFor({ type: "monster", organization: "horde", fightAsGroup: true, count: 6, hp: { value: 3, max: 3 } });
		expect(full).toMatchObject({ bodies: 6, out: false, group: true, standing: 6, size: 6 });
		const half = bodiesFor({ type: "monster", organization: "horde", fightAsGroup: true, count: 6, hp: { value: 2, max: 4 } });
		expect(half).toMatchObject({ bodies: 3, standing: 3 });
	});

	it("keeps a group that is almost gone at one body, and a routed one out", () => {
		const last = bodiesFor({ type: "monster", organization: "group", fightAsGroup: true, count: 6, hp: { value: 1, max: 12 } });
		// 1 of 12 HP left rounds every member out, but a group is only routed at 0 HP (p.416), and
		// both of the sheets' numbers rows floor a group still in the fight at one.
		expect(last).toMatchObject({ bodies: 1, out: false, standing: 0 });
		const routed = bodiesFor({ type: "monster", organization: "group", fightAsGroup: true, count: 6, hp: { value: 0, max: 12 } });
		expect(routed).toMatchObject({ bodies: 0, out: true, routed: true, group: true });
	});

	it("treats a group with no headcount recorded as one creature, as the monster sheet does", () => {
		expect(bodiesFor({ type: "monster", organization: "horde", fightAsGroup: true, count: 0, hp: { value: 3, max: 3 } })).toMatchObject({ bodies: 1 });
	});

	it("ignores a group size unless the monster is fighting as a group of a group organization", () => {
		expect(bodiesFor({ type: "monster", organization: "horde", fightAsGroup: false, count: 6, hp: { value: 3, max: 3 } })).toMatchObject({ bodies: 1 });
		expect(bodiesFor({ type: "monster", organization: "solitary", fightAsGroup: true, count: 6, hp: { value: 3, max: 3 } })).toMatchObject({ bodies: 1 });
	});

	it("reads a group whose HP is unset as whole", () => {
		expect(bodiesFor({ type: "monster", organization: "horde", fightAsGroup: true, count: 4, hp: { max: 3 } })).toMatchObject({ bodies: 4 });
	});
});

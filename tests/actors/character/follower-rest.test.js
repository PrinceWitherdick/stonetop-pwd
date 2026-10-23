// Followers who Recover or Convalesce (Book I p.240: "A PC or follower regains HP when ... they Recover;
// ... they have a few days of downtime and Convalesce"). A group heals member by member, each a use of
// supplies to Recover (p.473). The boxes on the leader's sheet land in one write; a follower with an NPC
// of their own heals on it, through follower-hp.js#setFollowerHp.

import { describe, it, expect, vi } from "vitest";
import { followerRestBodies, restFollowers, followerRestRow } from "../../../module/actors/character/follower-rest.js";

const flags = {
	customFollowers: {
		g1: { isGroup: true, size: 3, memberHp: [2, null, 0], memberDead: [false, false, true] },
	},
};
const roster = [
	{ ftype: "animal-companion", slug: "", name: "Bran", hpMax: 8, hpCurrent: 3 },
	{ ftype: "beast", slug: "goat", name: "Goat", hpMax: 4, hpCurrent: 4 },
	{ ftype: "custom", slug: "c1", name: "Lowri", hpMax: 6, hpCurrent: 0 },
	{ ftype: "custom", slug: "c2", name: "Gone", hpMax: 6, hpCurrent: 1, dead: true },
	{ ftype: "custom", slug: "g1", name: "Spears", hpMax: 4, groupMemberHp: 4, isGroup: true },
];

describe("which followers can rest", () => {
	it("offers each body below max, a group's members one by one, never the dead or the fallen", () => {
		const bodies = followerRestBodies(flags, roster);
		expect(bodies.map(b => [b.id, b.from, b.max])).toEqual([
			["animal-companion:", 3, 8],
			// Down at 0 HP, but not dead: someone tends them and they Recover (p.469).
			["custom:c1", 0, 6],
			["custom:g1:member:0", 2, 4],
		]);
		expect(bodies[2].row).toEqual({ follower: "custom-member", index: 0, slug: "g1" });
	});

	it("reads a follower's own NPC for their HP while there is one", () => {
		const npc = { system: { attributes: { hp: { value: 5, max: 10 } } } };
		const bodies = followerRestBodies(flags, [roster[0]], { npcFor: () => npc });
		expect(bodies).toEqual([expect.objectContaining({ from: 5, max: 10 })]);
	});

	// Code review 10-22 (HC-9): an NPC this client cannot write is healed by the GM's client; with no GM here a
	// Recover leaves that follower out before it spends a use on them.
	it("says which NPC-held bodies wait on a GM who is not here", () => {
		const theirs = { isOwner: false, system: { attributes: { hp: { value: 5, max: 10 } } } };
		const mine = { isOwner: true, system: { attributes: { hp: { value: 5, max: 10 } } } };
		const [bran] = followerRestBodies(flags, [roster[0]], { npcFor: () => theirs, gm: null });
		const [owned] = followerRestBodies(flags, [roster[0]], { npcFor: () => mine, gm: null });
		const [boxed] = followerRestBodies(flags, [roster[0]], { gm: null });
		const [withGm] = followerRestBodies(flags, [roster[0]], { npcFor: () => theirs, gm: { id: "gm" } });
		expect(bran).toMatchObject({ npcHeld: true, healable: false });
		expect(owned).toMatchObject({ npcHeld: true, healable: true });
		expect(boxed.healable).toBeUndefined();
		expect(withGm).toMatchObject({ npcHeld: true, healable: true });
	});
});

describe("resting them", () => {
	const leader = () => ({ name: "Rhianna", flags: { "stonetop-pwd": flags }, update: vi.fn(async () => {}) });
	const options = (set, link = () => null) => ({ roster: async () => roster, link, set });
	// Bran with an NPC of his own, whose HP is his while there is one.
	const npc = { system: { attributes: { hp: { value: 3, max: 8 } } } };
	const bransNpc = ({ actorUuid }) => (actorUuid === "Actor.bran" ? npc : null);
	const withBransNpc = { ...flags, animalCompanion: { details: { actorUuid: "Actor.bran" } } };

	it("heals Recover's 4+Prosperity, capped at their max, every box in one write", async () => {
		const character = leader();
		const set = vi.fn(async () => "npc");
		const healed = await restFollowers(character, ["animal-companion:", "custom:c1", "custom:g1:member:0"], { heal: 4, moveName: "Recover", ...options(set) });
		expect(character.update).toHaveBeenCalledTimes(1);
		expect(character.update).toHaveBeenCalledWith({
			"flags.stonetop-pwd.animalCompanion.hpCurrent": 7,
			"flags.stonetop-pwd.customFollowers.c1.hpCurrent": 4,
			// A group's members are one array, written whole with the healed slot changed.
			"flags.stonetop-pwd.customFollowers.g1.memberHp": [4, null, 0],
		}, { stonetopMove: "Recover" });
		expect(set).not.toHaveBeenCalled();
		expect(healed.map(h => [h.from, h.to])).toEqual([[3, 7], [0, 4], [2, 4]]);
		expect(healed[0].name).toBe("Bran");
		expect(healed[2].name).toMatch(/^Spears: /);
	});

	it("heals a follower who has an NPC on the NPC, through setFollowerHp, and the rest in the box write", async () => {
		const character = { ...leader(), flags: { "stonetop-pwd": withBransNpc } };
		const set = vi.fn(async () => "npc");
		const healed = await restFollowers(character, ["animal-companion:", "custom:c1"], { heal: 4, moveName: "Recover", ...options(set, bransNpc) });
		expect(set).toHaveBeenCalledWith(character, { follower: "animal-companion", slug: "" }, 7, expect.objectContaining({ moveName: "Recover", raiseOnly: true }));
		expect(character.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.customFollowers.c1.hpCurrent": 4 }, { stonetopMove: "Recover" });
		expect(healed.map(h => h.name)).toEqual(["Bran", "Lowri"]);
	});

	it("sets Convalesce's rested followers back to their max", async () => {
		const character = leader();
		await restFollowers(character, ["custom:c1"], { moveName: "Convalesce", ...options(vi.fn()) });
		expect(character.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.customFollowers.c1.hpCurrent": 6 }, { stonetopMove: "Convalesce" });
	});

	it("takes the bodies the caller already read, rather than reading them again", async () => {
		const character = leader();
		const read = vi.fn(async () => roster);
		const bodies = followerRestBodies(flags, roster).filter(b => b.id === "custom:c1");
		await restFollowers(character, ["custom:c1"], { heal: 4, bodies, roster: read, link: () => null, set: vi.fn() });
		expect(read).not.toHaveBeenCalled();
		expect(character.update).toHaveBeenCalledWith({ "flags.stonetop-pwd.customFollowers.c1.hpCurrent": 4 });
	});

	it("heals nobody not picked, and says nothing for a write that did not land", async () => {
		const character = { ...leader(), flags: { "stonetop-pwd": withBransNpc } };
		const set = vi.fn(async () => null);
		expect(await restFollowers(character, ["animal-companion:"], { heal: 4, ...options(set, bransNpc) })).toEqual([]);
		expect(await restFollowers(character, [], options(set))).toEqual([]);
		expect(character.update).not.toHaveBeenCalled();
		expect(followerRestRow([])).toBeNull();
	});
});

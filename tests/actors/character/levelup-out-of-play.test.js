import { describe, it, expect, beforeEach } from "vitest";
import { grantLevelUpClaim, resetLevelUpClaims } from "../../../module/actors/character/level-up-claim.js";
import { buildLiveCharacter, makeLiveItem, moveCount, resetLiveIds, sourceMovesFor } from "../../fakes/LiveCharacter.js";
import { DEATHS_DOOR_STATE } from "../../../module/actors/character/deaths-door.js";
import { LEFT_PLAY_FLAG, LEFT_PLAY_HOW } from "../../../module/campaign/left-play.js";

// Level Up is for PCs. One who has left play (through the Last Door, a monster or threat in the
// GM's hands, retired) no longer levels up (Book I p.584). Everyone else still does: the dying,
// one owing a fate, one out of the action, and a Ghost, Revenant or Thrall, who keeps their
// playbook and levels as normal.

const heavyMove = (name) => sourceMovesFor("The Heavy").find(d => d.name === name)._id;

function heavy({ flags = {}, items = [], level = 2, xp = 20 } = {}) {
	return buildLiveCharacter({ slug: "the-heavy", name: "The Heavy", level, xp, flags, items });
}

// The insert's own moves, as setPostDeathInsert makes them.
const ghostMoves = () => ["Unliving", "Disembodied", "Tethered"].map(name => makeLiveItem({
	name, type: "move", system: { moveType: "post-death", playbook: "ghost", description: "" },
}));

beforeEach(() => resetLiveIds());

describe("Level Up for a character who has left play", () => {
	const outOfPlay = {
		"dead (through the Last Door)":       { deathsDoor: DEATHS_DOOR_STATE.DEAD },
		"a Ghost lost to the GM":             { deathsDoor: DEATHS_DOOR_STATE.DEAD, "postDeathInsert.slug": "ghost" },
		"a Thrall become a threat":           { deathsDoor: DEATHS_DOOR_STATE.DEAD, "postDeathInsert.slug": "thrall" },
		"retired":                            { [LEFT_PLAY_FLAG]: { how: LEFT_PLAY_HOW.RETIRED } },
	};

	for (const [label, flags] of Object.entries(outOfPlay)) {
		it(`is not offered and writes nothing: ${label}`, async () => {
			const { char, actor } = heavy({ flags });
			const before = moveCount(actor);

			expect(char.levelUpBlockedOutOfPlay).toBe(true);
			expect(char.canLevelUp).toBe(false);
			const result = await char.applyLevelUp(heavyMove("Berserker"), null, null, { fromLevel: 2 });

			expect(result).toEqual({ applied: false, reason: "outOfPlay" });
			expect(actor.system.attributes.level.value).toBe(2);
			expect(actor.system.attributes.xp.value).toBe(20);
			expect(moveCount(actor)).toBe(before);
		});
	}

	it("comes back once they are raised (the dead state cleared)", async () => {
		const { char, actor } = heavy({ flags: { deathsDoor: DEATHS_DOOR_STATE.DEAD } });
		expect(char.canLevelUp).toBe(false);
		await actor.update({ "flags.stonetop-pwd.deathsDoor": null });
		expect(char.canLevelUp).toBe(true);
	});
});

describe("Level Up for a character still in play", () => {
	const inPlay = {
		"dying":          { deathsDoor: DEATHS_DOOR_STATE.DYING },
		"owing a fate":   { deathsDoor: DEATHS_DOOR_STATE.FATE_PENDING },
		"out of action":  { deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION },
		"a Ghost":        { "postDeathInsert.slug": "ghost" },
		"a Thrall":       { "postDeathInsert.slug": "thrall" },
	};

	for (const [label, flags] of Object.entries(inPlay)) {
		it(`still levels up: ${label}`, async () => {
			const { char, actor } = heavy({ flags });
			expect(char.canLevelUp).toBe(true);
			const result = await char.applyLevelUp(heavyMove("Berserker"), null, null, { fromLevel: 2 });
			expect(result).toEqual({ applied: true });
			expect(actor.system.attributes.level.value).toBe(3);
		});
	}

	it("never offers a Ghost's insert moves as a level-up pick, and keeps them through it", async () => {
		const { char, actor } = heavy({ flags: { "postDeathInsert.slug": "ghost" }, items: ghostMoves() });
		const data = await char.getLevelUpData();
		const offered = [...data.availableMoves, ...data.lockedMoves].map(m => m.name);
		for (const name of ["Unliving", "Disembodied", "Tethered"]) expect(offered).not.toContain(name);

		await char.applyLevelUp(heavyMove("Berserker"), null, null, { fromLevel: 2 });
		const insertMoves = actor.items.filter(i => i.system?.moveType === "post-death").map(i => i.name);
		expect(insertMoves.sort()).toEqual(["Disembodied", "Tethered", "Unliving"]);
	});
});

describe("a playbook change on a character wearing an insert", () => {
	it("keeps the insert, its moves and its Instinct, and takes only the old playbook's", async () => {
		const flags = {
			"postDeathInsert.slug": "ghost",
			"postDeathInstinct.selected": "Obsession: something",
			"postDeathLore.counts": { "consequences:carrion-stench": 1 },
		};
		const { char, actor } = heavy({ flags, items: ghostMoves() });
		expect(actor.items.some(i => i.system?.playbook === "The Heavy")).toBe(true);

		await char.clearPlaybookData("The Heavy");

		const scoped = actor.flags["stonetop-pwd"];
		expect(actor.items.some(i => i.system?.playbook === "The Heavy")).toBe(false);
		expect(actor.items.filter(i => i.system?.moveType === "post-death").map(i => i.name).sort())
			.toEqual(["Disembodied", "Tethered", "Unliving"]);
		expect(scoped.postDeathInsert.slug).toBe("ghost");
		expect(scoped.postDeathInstinct.selected).toBe("Obsession: something");
		expect(scoped.postDeathLore.counts).toEqual({ "consequences:carrion-stench": 1 });
		expect(actor.system.attributes.level.value).toBe(2);
		expect(actor.system.attributes.xp.value).toBe(20);
	});
});

describe("an insert taken or swapped leaves the level-up record alone", () => {
	it("keeps level, XP, stat picks, move marks and invocations through a Revenant becoming a Ghost", async () => {
		const flags = {
			"postDeathInsert.slug": "revenant",
			deathsDoor: DEATHS_DOOR_STATE.DYING,
			improvedStatChoices: { someMove: "str" },
			"moves.moveMarks": { "Potential for Greatness": { stat: [{ stat: "con", level: 2 }] } },
			"invocations.selected": ["sun-flare"],
		};
		const { char, actor } = heavy({ flags, level: 4, xp: 7 });
		await char.setPostDeathInsert("ghost");

		const scoped = actor.flags["stonetop-pwd"];
		expect(scoped.postDeathInsert.slug).toBe("ghost");
		expect(actor.system.attributes.level.value).toBe(4);
		expect(actor.system.attributes.xp.value).toBe(7);
		expect(scoped.improvedStatChoices).toEqual({ someMove: "str" });
		expect(scoped.moves.moveMarks).toEqual({ "Potential for Greatness": { stat: [{ stat: "con", level: 2 }] } });
		expect(scoped.invocations.selected).toEqual(["sun-flare"]);
	});
});

describe("a level-up refused before it is written", () => {
	// The claim (level-up-claim.js) is taken only for a level-up that could be applied: one refused for XP or
	// for having left play holds nothing, so the GM's or another window's Apply is not told the level was taken.
	it("holds no claim on the level when refused for XP or out of play", async () => {
		const prior = { user: globalThis.game.user, users: globalThis.game.users };
		resetLevelUpClaims();
		try {
			globalThis.game.user = { id: "p", isGM: false };
			globalThis.game.users = Object.create(prior.users ?? {}, { activeGM: { value: { id: "p" } } });
			const poor = heavy({ xp: 0 });
			expect(await poor.char.applyLevelUp(heavyMove("Berserker"), null, null, { fromLevel: 2 })).toEqual({ applied: false, reason: "xp" });
			expect(grantLevelUpClaim(poor.actor, 2, "gm")).toBe(true);
			resetLevelUpClaims();
			const gone = heavy({ flags: { deathsDoor: DEATHS_DOOR_STATE.DEAD } });
			expect(await gone.char.applyLevelUp(heavyMove("Berserker"), null, null, { fromLevel: 2 })).toEqual({ applied: false, reason: "outOfPlay" });
			expect(grantLevelUpClaim(gone.actor, 2, "gm")).toBe(true);
		} finally {
			globalThis.game.user = prior.user;
			globalThis.game.users = prior.users;
			resetLevelUpClaims();
		}
	});

	// A claim granted and then not written (the update failed) is given back at once, so the next Apply
	// is not told for 30s that the level was already taken.
	it("gives the claim back when the level's write fails", async () => {
		const prior = { user: globalThis.game.user, users: globalThis.game.users };
		resetLevelUpClaims();
		try {
			globalThis.game.user = { id: "p", isGM: false };
			globalThis.game.users = Object.create(prior.users ?? {}, { activeGM: { value: { id: "p" } } });
			const { char, actor } = heavy();
			const update = actor.update;
			actor.update = async () => { throw new Error("offline"); };
			await expect(char.applyLevelUp(heavyMove("Berserker"), null, null, { fromLevel: 2 })).rejects.toThrow("offline");
			actor.update = update;
			expect(actor.system.attributes.level.value).toBe(2);
			expect(grantLevelUpClaim(actor, 2, "gm")).toBe(true);
		} finally {
			globalThis.game.user = prior.user;
			globalThis.game.users = prior.users;
			resetLevelUpClaims();
		}
	});
});

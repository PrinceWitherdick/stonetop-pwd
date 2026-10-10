// ONE WRITE PATH FOR A FOLLOWER'S HP (follower-hp.js). While a one-body follower has an NPC, the NPC's HP
// is theirs and the card's box mirrors it (fight/roster-fate.js, wave 3 audit FOL-1), so every writer goes
// through setFollowerHp: the NPC when there is one, on the GM's client when this one cannot write it, and
// otherwise the card's box with the revive it makes.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_ID } from "../../../module/system-id.js";
import {
	FOLLOWER_NPC_HP_QUERY, followerNpcHpTarget, handleFollowerNpcHpQuery, setFollowerHp,
} from "../../../module/actors/character/follower-hp.js";
import { followerFateHpPath } from "../../../module/actors/character/follower-fate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(resolve(HERE, "../../..", rel), "utf8");
const S = SYSTEM_ID;

function leader(flags = {}) {
	return {
		uuid: "Actor.aeliana", type: "character", flags: { [S]: flags },
		update: vi.fn(async () => {}),
		testUserPermission: user => user?.id === "p1",
	};
}
const npcOf = (isOwner, hp = { value: 2, max: 10 }) => ({
	uuid: "Actor.wolf", name: "Wolf", isOwner, system: { attributes: { hp: { ...hp } } },
	update: vi.fn(async function (data) { this.system.attributes.hp.value = data["system.attributes.hp.value"]; }),
});
const companion = { animalCompanion: { hpCurrent: 2, details: { actorUuid: "Actor.wolf" } } };
const row = { follower: "animal-companion", slug: "" };

describe("setFollowerHp", () => {
	it("writes the linked NPC, capped at its max, and leaves the box to the mirror", async () => {
		const aeliana = leader(companion);
		const wolf = npcOf(true);
		expect(await setFollowerHp(aeliana, row, 14, { link: () => wolf })).toBe("npc");
		expect(wolf.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 10 });
		expect(aeliana.update).not.toHaveBeenCalled();
	});

	it("names the move on the write when given one", async () => {
		const wolf = npcOf(true);
		await setFollowerHp(leader(companion), row, 1, { link: () => wolf, moveName: "Death's Door" });
		expect(wolf.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 1 }, { stonetopMove: "Death's Door" });
	});

	it("writes the box when the NPC already holds the value, since no update would fire to mirror it", async () => {
		const aeliana = leader(companion);
		const wolf = npcOf(true, { value: 4, max: 10 });
		expect(await setFollowerHp(aeliana, row, 4, { link: () => wolf })).toBe("box");
		expect(wolf.update).not.toHaveBeenCalled();
		expect(aeliana.update).toHaveBeenCalledWith({ [`flags.${S}.animalCompanion.hpCurrent`]: 4 });
	});

	it("a heal never lowers the NPC, and one it already holds is done", async () => {
		const aeliana = leader(companion);
		const wolf = npcOf(true, { value: 8, max: 10 });
		expect(await setFollowerHp(aeliana, row, 6, { link: () => wolf, raiseOnly: true })).toBe("npc");
		expect(wolf.update).not.toHaveBeenCalled();
		expect(aeliana.update).not.toHaveBeenCalled();
	});

	it("writes the box with its revive for a follower with no NPC, a roster slot whole", async () => {
		const cadi = leader({ customFollowers: { abc: { dead: true, hpCurrent: 0 } }, crew: { memberHp: [null, 0] } });
		expect(await setFollowerHp(cadi, { follower: "custom", slug: "abc" }, 3, { link: () => null, moveName: "Make Camp" })).toBe("box");
		expect(cadi.update).toHaveBeenCalledWith({
			[`flags.${S}.customFollowers.abc.hpCurrent`]: 3, [`flags.${S}.customFollowers.abc.dead`]: false,
		}, { stonetopMove: "Make Camp" });
		await setFollowerHp(cadi, { follower: "crew-member", index: "1" }, 2, { link: () => null });
		expect(cadi.update).toHaveBeenLastCalledWith({ [`flags.${S}.crew.memberHp`]: [null, 2] });
	});

	it("writes a group's pooled box, which now has its path beside every other row", async () => {
		expect(followerFateHpPath("crew-group", "", null)).toBe("crew.groupHp");
		expect(followerFateHpPath("custom-group", "band", null)).toBe("customFollowers.band.groupHp");
		const cadi = leader({ customFollowers: { band: { isGroup: true } } });
		expect(await setFollowerHp(cadi, { follower: "custom-group", slug: "band" }, 7, { link: () => npcOf(true) })).toBe("box");
		expect(cadi.update).toHaveBeenCalledWith({ [`flags.${S}.customFollowers.band.groupHp`]: 7 });
	});

	it("asks the GM's client for an NPC this client cannot write, and warns when no GM is on", async () => {
		const aeliana = leader(companion);
		const wolf = npcOf(false);
		const gm = { query: vi.fn(async () => ({ to: 7 })) };
		expect(await setFollowerHp(aeliana, row, 7, { link: () => wolf, gm, user: { id: "p1" }, raiseOnly: true, moveName: "Make Camp" })).toBe("npc");
		expect(gm.query).toHaveBeenCalledWith(FOLLOWER_NPC_HP_QUERY, {
			characterUuid: "Actor.aeliana", npcUuid: "Actor.wolf", ftype: "animal-companion", slug: "",
			to: 7, raiseOnly: true, moveName: "Make Camp", userId: "p1",
		}, expect.anything());
		expect(wolf.update).not.toHaveBeenCalled();
		expect(aeliana.update).not.toHaveBeenCalled();
		const savedUi = globalThis.ui;
		globalThis.ui = { notifications: { warn: vi.fn() } };
		try {
			expect(await setFollowerHp(aeliana, row, 7, { link: () => wolf, gm: null, user: { id: "p1" } })).toBeNull();
			expect(globalThis.ui.notifications.warn).toHaveBeenCalledTimes(1);
			expect(aeliana.update).not.toHaveBeenCalled();
		} finally {
			globalThis.ui = savedUi;
		}
	});

	it("caps at the NPC's max, and a heal never lowers it", () => {
		expect(followerNpcHpTarget({ value: 3, max: 6 }, 9)).toBe(6);
		expect(followerNpcHpTarget({ value: 3, max: 0 }, 9)).toBe(9);
		expect(followerNpcHpTarget({ value: 5, max: 6 }, 2)).toBe(2);
		expect(followerNpcHpTarget({ value: 5, max: 6 }, 2, { raiseOnly: true })).toBe(5);
	});
});

describe("the GM's side of a follower's NPC HP", () => {
	it("sets it only for the leader's own player, only that follower's NPC, and never past its max", async () => {
		const savedGame = globalThis.game;
		globalThis.game = { ...savedGame, user: { id: "gm", isGM: true }, users: { activeGM: { id: "gm" }, get: id => ({ id, isGM: false }) } };
		try {
			const aeliana = leader();
			const npc = npcOf(true, { value: 2, max: 6 });
			const resolve = uuid => ({ "Actor.aeliana": aeliana, "Actor.wolf": npc })[uuid] ?? null;
			const ask = (userId, npcOf, extra = {}) => handleFollowerNpcHpQuery(
				{ characterUuid: "Actor.aeliana", npcUuid: "Actor.wolf", ftype: "animal-companion", slug: "", to: 9, userId, ...extra },
				{}, { resolve, npcOf });
			expect(await ask("p2", () => npc)).toBeNull();
			expect(await ask("p1", () => ({ uuid: "Actor.other" }))).toBeNull();
			expect(npc.update).not.toHaveBeenCalled();
			expect(await ask("p1", () => npc, { raiseOnly: true, moveName: "Make Camp" })).toEqual({ to: 6 });
			expect(npc.update).toHaveBeenCalledWith({ "system.attributes.hp.value": 6 }, { stonetopMove: "Make Camp" });
			// A heal asked twice, or late, never lowers it; a set does.
			expect(await ask("p1", () => npc, { to: 3, raiseOnly: true })).toEqual({ to: 6 });
			expect(npc.update).toHaveBeenCalledTimes(1);
			expect(await ask("p1", () => npc, { to: 0 })).toEqual({ to: 0 });
			expect(npc.update).toHaveBeenLastCalledWith({ "system.attributes.hp.value": 0 });
		} finally {
			globalThis.game = savedGame;
		}
	});

	it("is registered beside the mirror", () => {
		expect(read("module/fight/roster-fate.js"))
			.toContain("CONFIG.queries[FOLLOWER_NPC_HP_QUERY] = (data, context) => handleFollowerNpcHpQuery(data, context);");
	});
});

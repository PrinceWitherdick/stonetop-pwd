import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	formedInShieldWall, crewInShieldWall, shieldWallDefendBonus, crewReadinessCap, setShieldWall, settleShieldWallOnOrder,
	shieldWallEmptied, SHIELD_WALL_FLAG,
} from "../../module/fight/shield-wall.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { settleFollowerReadiness, reconcileTierEffects } from "../../module/actors/character/tier-effects.js";

// The Marshal's Shield Wall (Book I p.126), the re-audit's user ruling (2026-10-18): the crew forms the wall on a
// Shield Wall Defend, keeps its Readiness on the offense while formed, a shield-bearing crew's 7+ holds the +2 on
// its own, and the pip cap rises to 5 only while formed.

function marshal({ readiness = 0, formed = false, wall = true, owner = true } = {}) {
	const actor = {
		id: "maddoc", name: "Maddoc", type: "character", isOwner: owner,
		flags: { [SYSTEM_ID]: { crew: { readiness, ...(formed ? { shieldWall: true } : {}) } } },
		items: wall ? [{ type: "move", name: "Shield Wall", flags: {} }] : [],
		update: vi.fn(async data => {
			for (const [path, value] of Object.entries(data)) actor.flags[SYSTEM_ID].crew[path.split(".").at(-1)] = value;
		}),
	};
	return actor;
}
const formed = actor => actor.flags[SYSTEM_ID].crew.shieldWall;

let posted;
let savedChat;
beforeEach(() => {
	savedChat = globalThis.ChatMessage;
	posted = [];
	globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: ({ actor }) => ({ actor: actor.id }) };
});
afterEach(() => { globalThis.ChatMessage = savedChat; });

describe("formation", () => {
	it("counts only while formed AND holding Readiness", () => {
		expect(SHIELD_WALL_FLAG).toBe("crew.shieldWall");
		expect(formedInShieldWall({ crew: { shieldWall: true, readiness: 2 } })).toBe(true);
		expect(formedInShieldWall({ crew: { shieldWall: true, readiness: 0 } })).toBe(false);
		expect(formedInShieldWall({ crew: { readiness: 3 } })).toBe(false);
		expect(formedInShieldWall({})).toBe(false);
	});

	it("asks Shield Wall learned", () => {
		expect(crewInShieldWall(marshal({ readiness: 2, formed: true }))).toBe(true);
		expect(crewInShieldWall(marshal({ readiness: 2, formed: true, wall: false }))).toBe(false);
		const unlearned = marshal({ readiness: 2, formed: true });
		unlearned.items[0].flags = { [SYSTEM_ID]: { learned: false } };
		expect(crewInShieldWall(unlearned)).toBe(false);
	});
});

describe("the numbers", () => {
	it("+2 on its own only for a crew formed bearing shields", () => {
		expect(shieldWallDefendBonus({ shieldWall: true, hasShield: true })).toBe(2);
		expect(shieldWallDefendBonus({ shieldWall: true, hasShield: false })).toBe(0);
		expect(shieldWallDefendBonus({ shieldWall: false, hasShield: true })).toBe(0);
	});

	it("the crew's pips: 3, 4 with shields, 5 with shields only while formed", () => {
		expect(crewReadinessCap()).toBe(3);
		expect(crewReadinessCap({ hasShield: true })).toBe(4);
		expect(crewReadinessCap({ hasShield: true, formed: true })).toBe(5);
		expect(crewReadinessCap({ formed: true })).toBe(3);
	});
});

describe("orders form and break the wall", () => {
	it("a Shield Wall Defend forms it, silently", async () => {
		const maddoc = marshal();
		expect(await settleShieldWallOnOrder(maddoc, { moveKey: "defend", shieldWall: true })).toBe("formed");
		expect(formed(maddoc)).toBe(true);
		expect(maddoc.update).toHaveBeenCalledWith({ [`flags.${SYSTEM_ID}.crew.shieldWall`]: true }, { stonetopLedger: true });
		// Already formed: nothing more to write.
		expect(await settleShieldWallOnOrder(maddoc, { moveKey: "defend", shieldWall: true })).toBe(null);
		expect(maddoc.update).toHaveBeenCalledTimes(1);
		expect(posted).toEqual([]);
	});

	it("a Clash or Let Fly is made from the line", async () => {
		const maddoc = marshal({ readiness: 3, formed: true });
		expect(await settleShieldWallOnOrder(maddoc, { moveKey: "clash" })).toBe(null);
		expect(await settleShieldWallOnOrder(maddoc, { moveKey: "let-fly" })).toBe(null);
		expect(formed(maddoc)).toBe(true);
	});

	it("a Defend without the wall is made out of formation; its own card says so", async () => {
		const maddoc = marshal({ readiness: 3, formed: true });
		expect(await settleShieldWallOnOrder(maddoc, { moveKey: "defend", shieldWall: false })).toBe("broken");
		expect(formed(maddoc)).toBe(false);
		expect(posted).toEqual([]);
	});

	it("any other order breaks it, and chat says so", async () => {
		const maddoc = marshal({ readiness: 3, formed: true });
		expect(await settleShieldWallOnOrder(maddoc, { moveKey: "defy-danger", followerName: "The Wolves" })).toBe("broken");
		expect(formed(maddoc)).toBe(false);
		expect(posted[0].content).toContain("The Wolves break formation: the shield wall is gone.");
		// Not formed: nothing to break.
		expect(await settleShieldWallOnOrder(marshal(), { moveKey: "defy-danger" })).toBe(null);
	});

	it("never written by a client that cannot write the Marshal", async () => {
		const maddoc = marshal({ owner: false });
		expect(await setShieldWall(maddoc, true)).toBe(false);
		expect(maddoc.update).not.toHaveBeenCalled();
	});
});

describe("shieldWallEmptied", () => {
	it("a formed crew's Readiness just set to 0", () => {
		const touched = { flags: { [SYSTEM_ID]: { crew: { readiness: 0 } } } };
		expect(shieldWallEmptied(marshal({ readiness: 0, formed: true }), touched)).toBe(true);
		expect(shieldWallEmptied(marshal({ readiness: 0, formed: true }), { [`flags.${SYSTEM_ID}.crew.readiness`]: 0 })).toBe(true);
		expect(shieldWallEmptied(marshal({ readiness: 1, formed: true }), touched)).toBe(false);
		expect(shieldWallEmptied(marshal({ readiness: 0 }), touched)).toBe(false);
		expect(shieldWallEmptied(marshal({ readiness: 0, formed: true }), { name: "Maddoc" })).toBe(false);
	});
});

// The +2 rides the order card's record (tier-effects.js#settleFollowerReadiness), so a Shift or a +1 settles the
// same hold the roll did: the shield wall's 10+ is 5, its 7-9 is 3, and a 6- holds none.
describe("the shield wall's +2 on a moved Defend card", () => {
	const path = "crew.readiness";
	const card = record => {
		const flags = { tierEffects: { followerReadiness: record }, move: "The Wolves: Defend" };
		return { getFlag: (_s, key) => flags[key], setFlag: vi.fn(async (_s, key, value) => { flags[key] = value; }), flags };
	};

	it("holds base + 2 on a 7+, and follows the card up and down", async () => {
		const maddoc = marshal();
		const record = await settleFollowerReadiness(maddoc, "partial", { path, prior: 0, set: 0, name: "The Wolves", bonus: 2 });
		expect(maddoc.flags[SYSTEM_ID].crew.readiness).toBe(3);
		expect(record).toMatchObject({ prior: 0, set: 3, bonus: 2 });
		const message = card(record);
		await reconcileTierEffects(message, 10, { actor: maddoc });
		expect(maddoc.flags[SYSTEM_ID].crew.readiness).toBe(5);
		expect(message.flags.tierEffects.followerReadiness).toMatchObject({ set: 5, bonus: 2 });
		await reconcileTierEffects(message, 6, { actor: maddoc });
		expect(maddoc.flags[SYSTEM_ID].crew.readiness).toBe(0);
	});

	it("without the bonus a Defend holds the plain 1 / 3", async () => {
		const maddoc = marshal();
		await settleFollowerReadiness(maddoc, "success", { path, prior: 0, set: 0, name: "The Wolves" });
		expect(maddoc.flags[SYSTEM_ID].crew.readiness).toBe(3);
	});
});

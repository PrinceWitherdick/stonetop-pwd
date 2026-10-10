import { describe, it, expect } from "vitest";
import { creditsKills, felledBy, foeName, isFoe, newlyApplied } from "../../module/timeline/timeline-kills.js";
import { killsFromHit } from "../../module/fight/group-hits.js";
import { readRepo } from "../fakes/css.js";

// THE KILL TALLY. A player who lands the blow that drops a foe gets it on their timeline. What is
// pinned here is every way of crediting the wrong blow: a follower's swing, a hit the character
// took, a friend, a foe already down, and a group that loses several members to one blow.

describe("whose blows count", () => {
	it("credits a character's own blow", () => {
		expect(creditsKills({ attackerType: "character" })).toBe(true);
	});

	// User's ruling: the PC's own blows only.
	it("never credits a follower's blow, even one that names its character as the attacker", () => {
		expect(creditsKills({ attackerType: "npc" })).toBe(false);
		expect(creditsKills({ attackerType: "character", followerBlow: true })).toBe(false);
	});

	// A card a character TOOK names that character as its attacker.
	it("never credits the character on a blow they suffered", () => {
		expect(creditsKills({ attackerType: "character", selfHarm: true })).toBe(false);
	});

	it("never credits a monster's blow", () => {
		expect(creditsKills({ attackerType: "monster" })).toBe(false);
	});
});

describe("who is a foe", () => {
	it("counts a monster", () => {
		expect(isFoe({ type: "monster" })).toBe(true);
	});

	it("counts a hostile NPC", () => {
		expect(isFoe({ type: "npc", disposition: -1 })).toBe(true);
	});

	// The fight's own side rules, not disposition alone: characters default to HOSTILE.
	it("never counts a character, a follower, a friend or anything a player owns", () => {
		expect(isFoe({ type: "character", disposition: -1 })).toBe(false);
		expect(isFoe({ type: "npc", isFollower: true })).toBe(false);
		expect(isFoe({ type: "npc", disposition: 1 })).toBe(false);
		expect(isFoe({ type: "monster", hasPlayerOwner: true })).toBe(false);
	});
});

describe("how many fell to one blow", () => {
	it("is one when a single foe goes from standing to 0", () => {
		expect(killsFromHit({ oldHp: 3, newHp: 0 })).toBe(1);
	});

	it("is none when it is still standing", () => {
		expect(killsFromHit({ oldHp: 6, newHp: 2 })).toBe(0);
	});

	// A foe already down is not killed again by the next swing.
	it("is none for a blow on a foe already at 0", () => {
		expect(killsFromHit({ oldHp: 0, newHp: 0 })).toBe(0);
	});

	// p.416: a group's pool is casualties. Half the pool gone is half the members out.
	it("counts the members a blow on a group's pool put out", () => {
		expect(killsFromHit({ oldHp: 12, newHp: 6, group: { count: 6, hpMax: 12 } })).toBe(3);
		// 2 HP a body, rounded half up: 9 and 8 both read as two out, so a 1-point scratch drops nobody.
		expect(killsFromHit({ oldHp: 9, newHp: 8, group: { count: 6, hpMax: 12 } })).toBe(0);
	});

	it("counts every member still standing when a blow routs the group", () => {
		expect(killsFromHit({ oldHp: 4, newHp: 0, group: { count: 6, hpMax: 12 } })).toBe(2);
	});

	it("treats a group of one as one creature", () => {
		expect(killsFromHit({ oldHp: 3, newHp: 0, group: { count: 1, hpMax: 3 } })).toBe(1);
	});
});

describe("the name a foe fell under", () => {
	it("takes the number a token was given off", () => {
		expect(foeName("Crinwin (3)")).toBe("Crinwin");
		expect(foeName("Bandit Chief")).toBe("Bandit Chief");
	});

	it("leaves a name that only contains parentheses alone", () => {
		expect(foeName("Hag (the elder)")).toBe("Hag (the elder)");
	});
});

describe("what an applied row says fell", () => {
	it("is one member for a lone blow that dropped one, and none for one that did not", () => {
		expect(felledBy({ uuid: "t", member: true, down: true })).toBe(1);
		expect(felledBy({ uuid: "t", member: true, down: false })).toBe(0);
	});

	it("is what the damage path wrote for any other blow", () => {
		expect(felledBy({ uuid: "t", oldHp: 9, newHp: 0, felled: 3 })).toBe(3);
		expect(felledBy({ uuid: "t", oldHp: 9, newHp: 4 })).toBe(0);
	});

	// A follower's roster is the heroes' side; a Defend stand-in is a defender, never a foe.
	it("is nothing on a roster, a stand-in's row, or a blow ignored", () => {
		expect(felledBy({ uuid: "t", member: true, down: true, roster: { ftype: "crew" } })).toBe(0);
		expect(felledBy({ uuid: "t", felled: 1, by: "Actor.d" })).toBe(0);
		expect(felledBy({ uuid: "t", effective: 0, ignored: true })).toBe(0);
	});

	it("reads only the rows an update added", () => {
		const applied = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
		expect(newlyApplied(applied, ["a"]).map(row => row.uuid)).toEqual(["b", "c"]);
		expect(newlyApplied(null, [])).toEqual([]);
	});
});

describe("where the tally comes from", () => {
	const SRC = readRepo("module/combat/attack-flow.js");
	// applyOwedDamage latches what landed; applyOwedRows writes each row.
	const start = SRC.indexOf("async function applyOwedRows(");
	const body = SRC.slice(start, SRC.indexOf("\n}\n", start));

	// The damage path says what HAPPENED and nothing about whose timeline it goes on.
	it("is the felled count the damage path writes onto each applied row", () => {
		expect(body).toContain("killsFromHit({ oldHp: t.oldHp, newHp: t.newHp, group: pool })");
		expect(body).toMatch(/\.\.\.\(felled \? \{ felled \} : \{\}\)/);
		expect(SRC).not.toMatch(/from\s+"\.\.\/timeline\//);
		expect(SRC).not.toContain("recordKills");
	});
});

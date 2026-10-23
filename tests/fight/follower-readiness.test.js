import { describe, it, expect, vi } from "vitest";
import { followerReadinessRef, readinessHeldBy, spendHeldReadiness, clearFollowerReadiness } from "../../module/fight/follower-readiness.js";
import { holdersLeft, followerDroppedHoldingReadiness } from "../../module/combat/readiness-loss.js";
import { ringButtons } from "../../module/fight/fight-ring.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { collection } from "../fakes/fight.js";

// A follower ordered to Defend "holds Readiness but the player decides when and how they spend it" (Book I
// p.469), on Defend's own four spends (p.216). The pool is kept on their card on the character they follow,
// so the token that stands for them in a fight reads and spends it there.

function leader(flags = {}) {
	const actor = {
		id: "cadi", type: "character", name: "Cadi",
		flags: { [SYSTEM_ID]: flags },
		update: vi.fn(async (data) => {
			for (const [key, value] of Object.entries(data)) {
				const path = key.split(".").slice(2);
				let node = actor.flags[SYSTEM_ID];
				for (const part of path.slice(0, -1)) node = node[part] ??= {};
				node[path.at(-1)] = value;
			}
		}),
	};
	return actor;
}
const npc = (id, hp = 6) => ({ id, type: "npc", name: id, system: { attributes: { hp: { value: hp } } } });
const cardFor = (character, ftype, slug = "") => actor => (actor?.type === "npc" ? { character, ftype, slug } : null);

describe("a follower's Readiness, read off their card", () => {
	it("finds the companion's and an initiate's pools on the character they follow", () => {
		const cadi = leader({ animalCompanion: { readiness: 2 }, initiatesReadiness: { enfys: 1 } });
		expect(followerReadinessRef(npc("rill"), { cardFor: cardFor(cadi, "animal-companion") })).toEqual({ character: cadi, path: "animalCompanion.readiness" });
		expect(readinessHeldBy(npc("rill"), { cardFor: cardFor(cadi, "animal-companion") })).toBe(2);
		expect(readinessHeldBy(npc("enfys"), { cardFor: cardFor(cadi, "initiate", "enfys") })).toBe(1);
	});

	it("holds none for an NPC who follows nobody, or a monster", () => {
		expect(readinessHeldBy(npc("stranger"), { cardFor: () => null })).toBe(0);
		expect(readinessHeldBy({ type: "monster" })).toBe(0);
	});

	it("spends from the card, refuses more than is held, and clears it", async () => {
		const cadi = leader({ crew: { readiness: 2 } });
		const options = { cardFor: cardFor(cadi, "crew") };
		expect(await spendHeldReadiness(npc("crew"), 1, options)).toBe(true);
		expect(cadi.flags[SYSTEM_ID].crew.readiness).toBe(1);
		expect(await spendHeldReadiness(npc("crew"), 5, options)).toBeNull();
		expect(cadi.flags[SYSTEM_ID].crew.readiness).toBe(1);
		cadi.flags[SYSTEM_ID].crew.readiness = 3;
		expect(await clearFollowerReadiness(npc("crew"), options)).toBe(true);
		expect(cadi.flags[SYSTEM_ID].crew.readiness).toBe(0);
		expect(await clearFollowerReadiness(npc("crew"), options)).toBe(false);
	});
});

describe("letting a follower's Readiness go", () => {
	const FIGHT = { [SYSTEM_ID]: { fight: { v: 1 } } };
	it("names a group's one pool once, however many tokens stand for it, when the fight ends", () => {
		const cadi = leader({ crew: { readiness: 2 } });
		const a = npc("crew-1");
		const b = npc("crew-2");
		const ended = { id: "f1", flags: FIGHT, combatants: collection([{ id: "x", actor: a }, { id: "y", actor: b }]) };
		expect(holdersLeft(ended, [ended], { cardFor: cardFor(cadi, "crew") })).toEqual([a]);
	});

	// As a character on another map keeps theirs: the threat has not passed while any token over the pool still fights.
	it("keeps it while one of their tokens fights on in another fight", () => {
		const cadi = leader({ crew: { readiness: 3 } });
		const options = { cardFor: cardFor(cadi, "crew") };
		const ended = { id: "f1", flags: FIGHT, combatants: collection([{ id: "x", actor: npc("crew-1") }]) };
		const other = { id: "f2", flags: FIGHT, combatants: collection([{ id: "y", actor: npc("crew-2") }]) };
		expect(holdersLeft(ended, [ended, other], options)).toEqual([]);
		const otherPool = { ...leader({ crew: { readiness: 1 } }), id: "bram" };
		const elsewhere = { id: "f3", flags: FIGHT, combatants: collection([{ id: "z", actor: { ...npc("crew-9"), owner: otherPool } }]) };
		const byOwner = actor => (actor?.type === "npc" ? { character: actor.owner ?? cadi, ftype: "crew", slug: "" } : null);
		expect(holdersLeft(ended, [ended, elsewhere], { cardFor: byOwner })).toHaveLength(1);
	});

	it("goes when their token drops to 0 HP holding some", () => {
		const cadi = leader({ animalCompanion: { readiness: 1 } });
		const options = { cardFor: cardFor(cadi, "animal-companion") };
		expect(followerDroppedHoldingReadiness(npc("rill", 0), { system: { attributes: { hp: { value: 0 } } } }, options)).toBe(true);
		expect(followerDroppedHoldingReadiness(npc("rill", 3), { system: { attributes: { hp: { value: 3 } } } }, options)).toBe(false);
		cadi.flags[SYSTEM_ID].animalCompanion.readiness = 0;
		expect(followerDroppedHoldingReadiness(npc("rill", 0), { system: { attributes: { hp: { value: 0 } } } }, options)).toBe(false);
	});
});

describe("the ring's strike back for a follower", () => {
	const enfys = () => ({ id: "enfys", type: "npc", items: [], system: { attributes: { damage: { value: "staff d6 (close)", rollFormula: "d6" } } } });
	const order = { character: {}, ftype: "initiate", slug: "enfys", follower: {} };

	it("is offered while they hold Readiness and someone attacks them, with disadvantage", () => {
		const { damage, readiness } = ringButtons(enfys(), { order, readiness: 2, canStrikeBack: true });
		expect(readiness).toBe(2);
		expect(damage.find(b => b.run === "strikeBack")).toMatchObject({ formula: "d6", rollMode: "dis" });
	});

	it("is not offered holding none, or with no attacker", () => {
		expect(ringButtons(enfys(), { order, readiness: 0, canStrikeBack: true }).damage.some(b => b.run === "strikeBack")).toBe(false);
		expect(ringButtons(enfys(), { order, readiness: 2, canStrikeBack: false }).damage.some(b => b.run === "strikeBack")).toBe(false);
	});
});

import { describe, it, expect } from "vitest";
import { touching, engage, reachAround, HEROES, FOES } from "../../module/fight/engagements.js";

// Who is fighting whom, out of where the tokens stand (Book I p.414's "smaller engagements").

const SIZE = 100;
const grid = { size: SIZE, kind: "square" };

/** A fighter on grid square (col, row), `w` by `h` squares. */
const at = (id, side, col, row, extra = {}) => {
	const { w = 1, h = 1, ...rest } = extra;
	return { id, side, name: id, bodies: 1, rect: { x: col * SIZE, y: row * SIZE, w: w * SIZE, h: h * SIZE }, ...rest };
};
const hero = (id, col, row, extra) => at(id, HEROES, col, row, extra);
const foe = (id, col, row, extra) => at(id, FOES, col, row, extra);

describe("touching", () => {
	it("counts tokens side by side and corner to corner", () => {
		expect(touching(hero("a", 0, 0), foe("b", 1, 0), grid)).toBe(true);
		expect(touching(hero("a", 0, 0), foe("b", 0, 1), grid)).toBe(true);
		expect(touching(hero("a", 0, 0), foe("b", 1, 1), grid)).toBe(true);
	});

	it("does not count a square between them", () => {
		expect(touching(hero("a", 0, 0), foe("b", 2, 0), grid)).toBe(false);
		expect(touching(hero("a", 0, 0), foe("b", 2, 2), grid)).toBe(false);
		expect(touching(hero("a", 0, 0), foe("b", 1, 2), grid)).toBe(false);
	});

	it("measures from a big token's whole footprint", () => {
		const giant = foe("giant", 2, 2, { w: 2, h: 2 });
		expect(touching(hero("a", 4, 3), giant, grid)).toBe(true);
		expect(touching(hero("a", 1, 1), giant, grid)).toBe(true);
		expect(touching(hero("a", 5, 3), giant, grid)).toBe(false);
	});

	it("forgives a token a little off its grid lines, but not half a square", () => {
		const off = { ...foe("b", 1, 0), rect: { x: 140, y: 0, w: 100, h: 100 } };
		expect(touching(hero("a", 0, 0), off, grid)).toBe(true);
		const far = { ...foe("b", 1, 0), rect: { x: 150, y: 0, w: 100, h: 100 } };
		expect(touching(hero("a", 0, 0), far, grid)).toBe(false);
	});

	it("is inclusive at half a square on a gridless scene", () => {
		const half = { ...foe("b", 1, 0), rect: { x: 150, y: 0, w: 100, h: 100 } };
		expect(touching(hero("a", 0, 0), half, { size: SIZE, kind: "gridless" })).toBe(true);
		const more = { ...foe("b", 1, 0), rect: { x: 160, y: 0, w: 100, h: 100 } };
		expect(touching(hero("a", 0, 0), more, { size: SIZE, kind: "gridless" })).toBe(false);
	});

	it("tells a neighbouring hex from the next ring out", () => {
		const hex = { size: SIZE, kind: "hex" };
		const centre = { id: "a", side: HEROES, rect: { x: 0, y: 0, w: 100, h: 100 } };
		const neighbour = { id: "b", side: FOES, rect: { x: 87, y: 50, w: 100, h: 100 } };
		const secondRing = { id: "c", side: FOES, rect: { x: 173, y: 0, w: 100, h: 100 } };
		expect(touching(centre, neighbour, hex)).toBe(true);
		expect(touching(centre, secondRing, hex)).toBe(false);
	});

	it("never joins tokens on different levels", () => {
		expect(touching(hero("a", 0, 0, { level: "ground" }), foe("b", 1, 0, { level: "roof" }), grid)).toBe(false);
		expect(touching(hero("a", 0, 0, { level: "roof" }), foe("b", 1, 0, { level: "roof" }), grid)).toBe(true);
	});
});

describe("engage", () => {
	it("links a hero and a foe in contact, and nobody else", () => {
		const result = engage({ grid, fighters: [hero("bram", 0, 0), foe("crinwin", 1, 0), foe("wolf", 5, 5)] });
		expect(result.links).toEqual([{ hero: "bram", foe: "crinwin", kind: "melee" }]);
		expect(result.clusters).toHaveLength(1);
		expect(result.clusters[0]).toMatchObject({ id: "bram", heroIds: ["bram"], foeIds: ["crinwin"], groups: null });
		expect(result.unengaged).toEqual({ heroes: [], foes: ["wolf"] });
		expect(result.byFighter.bram).toMatchObject({ melee: ["crinwin"], ganged: false, pileOn: 0 });
	});

	it("never links two fighters on the same side", () => {
		const result = engage({ grid, fighters: [hero("a", 0, 0), hero("b", 1, 0)] });
		expect(result.links).toEqual([]);
		expect(result.unengaged.heroes).toEqual(["a", "b"]);
	});

	it("marks a foe fought by two attackers, with p.414's +1", () => {
		const result = engage({ grid, fighters: [hero("bram", 0, 0), hero("aeliana", 0, 2), foe("crinwin", 0, 1)] });
		expect(result.byFighter.crinwin).toMatchObject({ attackers: ["bram", "aeliana"], attackerBodies: 2, ganged: true, pileOn: 1 });
		expect(result.byFighter.bram.ganged).toBe(false);
		expect(result.clusters).toHaveLength(1);
		expect(result.clusters[0].heroIds).toEqual(["bram", "aeliana"]);
	});

	it("marks a hero facing several foes in melee", () => {
		const result = engage({ grid, fighters: [hero("cadi", 1, 1), foe("c1", 0, 1), foe("c2", 2, 1), foe("c3", 1, 0)] });
		expect(result.byFighter.cadi).toMatchObject({ attackerBodies: 3, ganged: true, pileOn: 2 });
	});

	it("counts a player's target as a ranged engagement", () => {
		const result = engage({
			grid,
			fighters: [hero("archer", 0, 0), foe("wolf", 6, 0)],
			ranged: [{ from: "archer", to: "wolf" }],
		});
		expect(result.links).toEqual([{ hero: "archer", foe: "wolf", kind: "ranged", from: "archer" }]);
		expect(result.byFighter.archer.shootingAt).toEqual(["wolf"]);
		expect(result.byFighter.wolf.shotBy).toEqual(["archer"]);
		expect(result.byFighter.wolf.attackerBodies).toBe(1);
	});

	it("counts ranged attackers on a foe", () => {
		const onFoe = engage({
			grid,
			fighters: [hero("bram", 0, 0), hero("archer", 5, 5), foe("crinwin", 1, 0)],
			ranged: [{ from: "archer", to: "crinwin" }],
		});
		expect(onFoe.byFighter.crinwin).toMatchObject({ melee: ["bram"], attackers: ["bram", "archer"], attackerBodies: 2, ganged: true, pileOn: 1 });
		expect(onFoe.clusters).toHaveLength(1);
		expect(onFoe.clusters[0].heroIds).toEqual(["bram", "archer"]);
	});

	it("counts foes shooting a hero among the hero's attackers (p.414 counts every attacker)", () => {
		const result = engage({
			grid,
			fighters: [hero("cadi", 0, 0), foe("wolf", 1, 0), foe("archer", 6, 0)],
			ranged: [{ from: "archer", to: "cadi", recorded: true }],
		});
		expect(result.byFighter.cadi).toMatchObject({ melee: ["wolf"], shotBy: ["archer"], attackers: ["wolf", "archer"], attackerBodies: 2, ganged: true, pileOn: 1 });
		expect(result.byFighter.archer.shootingAt).toEqual(["cadi"]);
	});

	it("lets a shot on record lapse while its shooter is in melee with anybody, but never a live target", () => {
		const fighters = [hero("bram", 0, 0), foe("wolf", 1, 0), foe("far", 8, 0)];
		const recorded = engage({ grid, fighters, ranged: [{ from: "bram", to: "far", recorded: true }] });
		expect(recorded.byFighter.bram.shootingAt).toEqual([]);
		const live = engage({ grid, fighters, ranged: [{ from: "bram", to: "far" }] });
		expect(live.byFighter.bram.shootingAt).toEqual(["far"]);
	});

	it("counts no more in contact with one fighter than fit round it, and says how many there were", () => {
		const result = engage({ grid, fighters: [hero("bram", 0, 0), foe("horde", 1, 0, { bodies: 12 })] });
		expect(result.byFighter.bram).toMatchObject({ reach: 8, attackerBodies: 8, attackerBodiesAll: 12, ganged: true, pileOn: 7 });
		const shot = engage({
			grid,
			fighters: [hero("bram", 0, 0), foe("horde", 1, 0, { bodies: 12 }), foe("archers", 9, 0, { bodies: 3 })],
			ranged: [{ from: "archers", to: "bram", recorded: true }],
		});
		// Shooters need no room beside the target.
		expect(shot.byFighter.bram).toMatchObject({ attackerBodies: 11, attackerBodiesAll: 15 });
	});

	it("gives a bigger token more room round it", () => {
		expect(reachAround(hero("a", 0, 0), grid)).toBe(8);
		expect(reachAround(foe("giant", 0, 0, { w: 2, h: 2 }), grid)).toBe(12);
		expect(reachAround(foe("huge", 0, 0, { w: 3, h: 3 }), grid)).toBe(16);
	});

	it("lets contact win over a target on the same pair", () => {
		const result = engage({
			grid,
			fighters: [hero("bram", 0, 0), foe("crinwin", 1, 0)],
			ranged: [{ from: "bram", to: "crinwin" }],
		});
		expect(result.links).toEqual([{ hero: "bram", foe: "crinwin", kind: "melee" }]);
		expect(result.byFighter.bram.shootingAt).toEqual([]);
	});

	it("ignores a target on the same side, on nobody, or twice over", () => {
		const result = engage({
			grid,
			fighters: [hero("a", 0, 0), hero("b", 5, 0), foe("f", 9, 9)],
			ranged: [{ from: "a", to: "b" }, { from: "a", to: "ghost" }, { from: "a", to: "f" }, { from: "a", to: "f" }],
		});
		expect(result.links).toEqual([{ hero: "a", foe: "f", kind: "ranged", from: "a" }]);
	});

	it("never links or counts a fighter who is out", () => {
		const result = engage({
			grid,
			fighters: [hero("bram", 0, 1), foe("down", 1, 1, { out: true }), foe("gone", 0, 0, { bodies: 0 }), foe("up", 0, 2)],
			ranged: [{ from: "bram", to: "down" }],
		});
		expect(result.links).toEqual([{ hero: "bram", foe: "up", kind: "melee" }]);
		expect(result.byFighter.bram.attackerBodies).toBe(1);
		expect(result.out).toEqual({ heroes: [], foes: ["down", "gone"] });
		expect(result.unengaged.foes).toEqual([]);
	});

	it("leaves out, entirely, a fighter this client may not see", () => {
		const result = engage({ grid, fighters: [hero("bram", 0, 0), foe("hidden", 1, 0, { visible: false }), foe("seen", 0, 1)] });
		expect(result.links).toEqual([{ hero: "bram", foe: "seen", kind: "melee" }]);
		expect(result.byFighter.hidden).toBeUndefined();
		expect(result.signature).not.toContain("hidden");
	});

	it("counts BODIES: a horde token is as many attackers as members standing", () => {
		const result = engage({ grid, fighters: [hero("bram", 0, 0), foe("horde", 1, 0, { bodies: 6 })] });
		expect(result.byFighter.bram).toMatchObject({ attackerBodies: 6, ganged: true, pileOn: 5 });
		expect(result.byFighter.horde).toMatchObject({ attackerBodies: 1, ganged: false });
	});

	it("never gangs up on a token that is several fighters: that is the group rules, not a pile-on", () => {
		const onHorde = engage({ grid, fighters: [hero("a", 0, 0), hero("b", 2, 0), foe("horde", 1, 0, { bodies: 6 })] });
		expect(onHorde.byFighter.horde).toMatchObject({ attackerBodies: 2, ganged: false, pileOn: 0 });
		const onCrew = engage({ grid, fighters: [hero("crew", 1, 0, { bodies: 6 }), foe("x", 0, 0), foe("y", 2, 0)] });
		expect(onCrew.byFighter.crew).toMatchObject({ attackerBodies: 2, ganged: false, pileOn: 0 });
	});

	it("joins fighters linked through each other into one engagement", () => {
		const result = engage({
			grid,
			fighters: [hero("a", 0, 0), foe("x", 1, 0), hero("b", 2, 0), foe("y", 3, 0), foe("far", 9, 9), hero("solo", 7, 0), foe("z", 8, 0)],
		});
		expect(result.clusters.map(c => [c.heroIds, c.foeIds])).toEqual([
			[["a", "b"], ["x", "y"]],
			[["solo"], ["z"]],
		]);
	});

	it("offers the group abstraction only when both sides bring a group", () => {
		const crewOnHorde = engage({ grid, fighters: [hero("crew", 0, 0, { bodies: 6 }), foe("horde", 1, 0, { bodies: 18 })] });
		expect(crewOnHorde.clusters[0].groups).toEqual({ heroGroupBodies: 6, foeGroupBodies: 18, bigger: FOES, bonus: 2, individuals: false, held: [] });

		const even = engage({ grid, fighters: [hero("crew", 0, 0, { bodies: 6 }), foe("pack", 1, 0, { bodies: 8 })] });
		expect(even.clusters[0].groups).toMatchObject({ bigger: null, bonus: 0 });

		const pcOnHorde = engage({ grid, fighters: [hero("bram", 0, 0), foe("horde", 1, 0, { bodies: 18 })] });
		expect(pcOnHorde.clusters[0].groups).toBeNull();
	});

	it("counts only the groups, and says when individuals are in the scrum too (p.416)", () => {
		// Bram stands against the horde, so he holds one of its twelve out of the exchange: 11 to 6, no bonus.
		const result = engage({
			grid,
			fighters: [hero("crew", 0, 0, { bodies: 6 }), hero("bram", 1, 1), foe("horde", 1, 0, { bodies: 12 })],
		});
		expect(result.clusters[0].groups).toEqual({
			heroGroupBodies: 6, foeGroupBodies: 11, bigger: null, bonus: 0, individuals: true, held: [{ group: "horde", by: "bram" }],
		});
	});

	// The user's ruling on p.416's "less 5 occupied by PCs": each hero in contact with a foe group holds ONE of
	// its members out of the group exchange. A token the GM gave a headcount is a group, and holds nobody.
	it("takes one member of a foe group out of the ratio for each hero in contact with it", () => {
		const twoOnHorde = engage({
			grid,
			fighters: [hero("crew", 0, 0, { bodies: 6 }), hero("bram", 2, 0), hero("cadi", 2, 1), foe("horde", 1, 0, { bodies: 20 })],
		});
		expect(twoOnHorde.clusters[0].groups).toMatchObject({
			heroGroupBodies: 6, foeGroupBodies: 18, bigger: FOES, bonus: 2,
			held: [{ group: "horde", by: "bram" }, { group: "horde", by: "cadi" }],
		});

		// A hero standing off it holds nobody, and a hero token that is a group of its own joins the ratio instead.
		const apart = engage({
			grid,
			fighters: [hero("crew", 0, 0, { bodies: 6 }), hero("warband", 2, 0, { bodies: 3 }), hero("far", 9, 9), foe("horde", 1, 0, { bodies: 20 })],
		});
		expect(apart.clusters[0].groups).toMatchObject({ heroGroupBodies: 9, foeGroupBodies: 20, held: [] });

		// Every member held: nobody is left to trade blows group to group.
		const allHeld = engage({
			grid,
			fighters: [hero("crew", 0, 0, { bodies: 6 }), hero("bram", 2, 0), hero("cadi", 2, 1), foe("pair", 1, 0, { bodies: 2 })],
		});
		expect(allHeld.clusters[0].groups).toBeNull();
	});

	it("counts a hero touching two foe groups as holding one body, not one of each", () => {
		const between = engage({
			grid,
			fighters: [hero("crew", 0, 0, { bodies: 6 }), foe("left", 1, 0, { bodies: 6 }), hero("bram", 2, 0), foe("right", 3, 0, { bodies: 6 })],
		});
		const groups = between.clusters[0].groups;
		expect(groups.foeGroupBodies).toBe(11);
		expect(groups.held).toHaveLength(1);
		expect(groups.held[0].by).toBe("bram");
	});

	it("ignores fighters with no side, no id, or an id seen already", () => {
		const result = engage({
			grid,
			fighters: [hero("a", 0, 0), { ...foe("b", 1, 0), side: "bystanders" }, { ...foe("", 1, 0), id: undefined }, foe("c", 0, 1), foe("c", 5, 5)],
		});
		expect(Object.keys(result.byFighter)).toEqual(["a", "c"]);
		expect(result.links).toEqual([{ hero: "a", foe: "c", kind: "melee" }]);
	});

	it("gives the same signature whatever order the fighters arrive in, and a new one when a token moves", () => {
		const fighters = [hero("a", 0, 0), foe("b", 1, 0), hero("c", 5, 5), foe("d", 6, 5)];
		const one = engage({ grid, fighters }).signature;
		const two = engage({ grid, fighters: [...fighters].reverse() }).signature;
		expect(two).toBe(one);
		const moved = engage({ grid, fighters: [hero("a", 0, 0), foe("b", 3, 0), hero("c", 5, 5), foe("d", 6, 5)] }).signature;
		expect(moved).not.toBe(one);
	});

	it("keeps an unmoved signature when a token moves but nobody's engagements change", () => {
		const one = engage({ grid, fighters: [hero("a", 0, 0), foe("b", 1, 0), hero("c", 9, 9)] }).signature;
		const two = engage({ grid, fighters: [hero("a", 0, 0), foe("b", 1, 0), hero("c", 12, 12)] }).signature;
		expect(two).toBe(one);
	});

	it("is empty for no fighters", () => {
		const result = engage({});
		expect(result.links).toEqual([]);
		expect(result.clusters).toEqual([]);
		expect(result.unengaged).toEqual({ heroes: [], foes: [] });
	});
});

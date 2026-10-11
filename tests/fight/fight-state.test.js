import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	isFight, combatTouchesScene, fightOnScene, combatantSide, combatantBodies, gridOf, tokenRect,
	fighterOf, userFighterId, rangedPairs, snapshotFight, engagementFor,
} from "../../module/fight/fight-state.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, fakeUsers, collection } from "../fakes/fight.js";

// A fight's documents, read for the engagement engine. The fakes are in tests/fakes/fight.js.

let saved;
beforeEach(() => {
	saved = { game: globalThis.game, ui: globalThis.ui, canvas: globalThis.canvas, CONST: globalThis.CONST };
	globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1, HEXODDR: 2 } };
});
afterEach(() => {
	globalThis.game = saved.game;
	globalThis.ui = saved.ui;
	globalThis.canvas = saved.canvas;
	globalThis.CONST = saved.CONST;
});

/** Bram (a PC) and a crinwin (unlinked monster) side by side, and a wolf further off. */
function table({ bramAnimating = null, crinwinHidden = false, crinwinCombatantHidden = false } = {}) {
	const bram = fakeActor({ id: "bram", type: "character", ownership: { player: 3 }, hasPlayerOwner: true });
	const crinwinActor = fakeActor({ id: "crinwin", type: "monster", system: { attributes: { hp: { value: 3, max: 3 } } } });
	const wolfActor = fakeActor({ id: "wolf", type: "monster" });
	const tBram = fakeToken({ id: "tBram", col: 0, row: 0, actor: bram, animating: bramAnimating });
	const tCrinwin = fakeToken({ id: "tCrin", col: 1, row: 0, actor: crinwinActor, hidden: crinwinHidden });
	const tWolf = fakeToken({ id: "tWolf", col: 5, row: 5, actor: wolfActor });
	const scene = fakeScene({ tokens: [tBram, tCrinwin, tWolf] });
	const cBram = fakeCombatant({ id: "cBram", token: tBram, scene });
	const cCrin = fakeCombatant({ id: "cCrin", token: tCrinwin, scene, hidden: crinwinCombatantHidden, visible: !crinwinCombatantHidden });
	const cWolf = fakeCombatant({ id: "cWolf", token: tWolf, scene });
	const combat = fakeCombat({ scene, combatants: [cCrin, cWolf, cBram] });
	return { bram, scene, combat, tBram, tCrinwin, cBram, cCrin, cWolf };
}

const world = ({ user, users = [user], combats = [], viewed = null, canvasScene = null }) => {
	globalThis.game = { ...saved.game, user, users: collection(users), combats: collection(combats) };
	globalThis.ui = { combat: { viewed } };
	globalThis.canvas = { scene: canvasScene };
};

describe("reading a fight", () => {
	it("knows a combat started as a fight", () => {
		expect(isFight({ flags: { [SYSTEM_ID]: { fight: { v: 1 } } } })).toBe(true);
		expect(isFight({ flags: {} })).toBe(false);
	});

	it("maps the scene's grid", () => {
		expect(gridOf({ grid: { type: 0, size: 140 } })).toEqual({ size: 140, kind: "gridless" });
		expect(gridOf({ grid: { type: 1, size: 100 } })).toEqual({ size: 100, kind: "square" });
		expect(gridOf({ grid: { type: 2, size: 100 } })).toEqual({ size: 100, kind: "hex" });
		expect(gridOf({})).toEqual({ size: 100, kind: "square" });
	});

	it("reads a token where its move SAVED it, not where its animation has got to", () => {
		const token = fakeToken({ id: "t", col: 3, row: 2, animating: { x: 40, y: 10 } });
		expect(tokenRect(token)).toEqual({ x: 300, y: 200, w: 100, h: 100 });
		const { scene, combat, cBram } = table({ bramAnimating: { x: 900, y: 900 } });
		world({ user: { id: "gm", isGM: true }, combats: [combat] });
		expect(snapshotFight(combat, { scene }).result.byFighter.cBram.melee).toEqual(["cCrin"]);
		expect(fighterOf(cBram, { scene, viewer: { isGM: true } }).rect).toEqual({ x: 0, y: 0, w: 100, h: 100 });
	});

	it("takes a stamped side, and otherwise works one out from the actor", () => {
		const { cBram, cCrin } = table();
		expect(combatantSide(cBram)).toBe("heroes");
		expect(combatantSide(cCrin)).toBe("foes");
		cCrin.flags[SYSTEM_ID].side = "heroes";
		expect(combatantSide(cCrin)).toBe("heroes");
	});

	it("puts a follower built from a character's card with the heroes", () => {
		const follower = fakeActor({ id: "f", type: "npc", flags: { [SYSTEM_ID]: { followerOrigin: { ftype: "crew" } } } });
		const scene = fakeScene();
		const token = fakeToken({ id: "t", actor: follower });
		expect(combatantSide(fakeCombatant({ id: "c", token, scene }))).toBe("heroes");
	});

	it("reads bodies off the token's own actor: a horde fighting as a group, or a crew's headcount", () => {
		const scene = fakeScene();
		const horde = fakeActor({ id: "h", type: "monster", system: { organization: "horde", fightAsGroup: true, count: 6, attributes: { hp: { value: 2, max: 4 } } } });
		expect(combatantBodies(fakeCombatant({ id: "c", token: fakeToken({ id: "t", actor: horde }), scene }))).toMatchObject({ bodies: 3, group: true, standing: 3, size: 6 });
		const crew = fakeActor({ id: "crew", type: "npc" });
		expect(combatantBodies(fakeCombatant({ id: "c2", token: fakeToken({ id: "t2", actor: crew }), scene, count: 6 }))).toMatchObject({ bodies: 6 });
	});

	it("counts a crew by the members its character's roster has standing, not by a headcount that does not fall", () => {
		const scene = fakeScene();
		const rhianna = { uuid: "Actor.rhianna", flags: { [SYSTEM_ID]: { crew: { size: 6, memberHp: [0, 0] } } } };
		const savedResolve = globalThis.fromUuidSync;
		globalThis.fromUuidSync = uuid => (uuid === rhianna.uuid ? rhianna : null);
		try {
			const crew = fakeActor({ id: "crew", type: "npc", flags: { [SYSTEM_ID]: { followerOrigin: { characterUuid: "Actor.rhianna", ftype: "crew" } } } });
			const bodies = combatantBodies(fakeCombatant({ id: "c", token: fakeToken({ id: "t", actor: crew }), scene, count: 6 }));
			expect(bodies).toMatchObject({ bodies: 4, group: true, standing: 4, size: 6 });
		} finally {
			globalThis.fromUuidSync = savedResolve;
		}
	});

	it("counts nobody who is out", () => {
		const scene = fakeScene();
		const actor = fakeActor({ id: "a", type: "monster", system: { attributes: { hp: { value: 0, max: 6 } } } });
		expect(combatantBodies(fakeCombatant({ id: "c", token: fakeToken({ id: "t", actor }), scene })).out).toBe(true);
		const fine = fakeActor({ id: "b", type: "monster", system: { attributes: { hp: { value: 6, max: 6 } } } });
		expect(combatantBodies(fakeCombatant({ id: "c2", token: fakeToken({ id: "t2", actor: fine }), scene, defeated: true })).out).toBe(true);
	});

	// Unstoppable: "When you are reduced to 0 HP in battle, you can keep fighting", until they roll
	// Death's Door. Only a Heavy who has the move learned and has not rolled yet.
	it("still counts a Heavy fighting on at 0 HP with Unstoppable", () => {
		const scene = fakeScene();
		const heavy = (flags, learned = true) => ({
			...fakeActor({ id: "h", type: "character", flags: { [SYSTEM_ID]: flags }, system: { attributes: { hp: { value: 0, max: 20 } } } }),
			items: [{ type: "move", name: "Unstoppable", flags: learned ? {} : { [SYSTEM_ID]: { learned: false } } }],
		});
		const bodies = actor => combatantBodies(fakeCombatant({ id: "c", token: fakeToken({ id: "t", actor }), scene }));
		// Reduced to 0 HP in battle: the drop stamped it (`unstoppableFighting`, hooks/DeathsDoorPrompt.js).
		expect(bodies(heavy({ deathsDoor: "dying", unstoppableFighting: true }))).toMatchObject({ bodies: 1, out: false });
		expect(bodies(heavy({ deathsDoor: "dying", unstoppableFighting: true }, false)).out).toBe(true);
		// Dropped outside battle and put in this fight since: down, not fighting on (Book I p.114).
		expect(bodies(heavy({ deathsDoor: "dying" })).out).toBe(true);
		expect(bodies(heavy({ deathsDoor: "out-of-action" })).out).toBe(true);
	});
});

describe("what each viewer counts", () => {
	it("lets a GM count everyone", () => {
		const { scene, combat } = table({ crinwinHidden: true });
		world({ user: { id: "gm", isGM: true }, combats: [combat] });
		const snap = snapshotFight(combat, { scene, viewer: { isGM: true } });
		expect(snap.result.byFighter.cBram.melee).toEqual(["cCrin"]);
	});

	it("never lets a player count a hidden token or a combatant hidden from them", () => {
		for (const hidden of [{ crinwinHidden: true }, { crinwinCombatantHidden: true }]) {
			const { scene, combat } = table(hidden);
			const player = { id: "player", isGM: false };
			world({ user: player, combats: [combat] });
			const snap = snapshotFight(combat, { scene, viewer: player });
			expect(snap.result.byFighter.cBram.melee).toEqual([]);
			expect(snap.result.byFighter.cCrin).toBeUndefined();
			expect(snap.elsewhere).toEqual([]);
		}
	});

	it("lists the heroes first, each side in the order they joined", () => {
		const { scene, combat } = table();
		world({ user: { id: "gm", isGM: true }, combats: [combat] });
		expect(snapshotFight(combat, { scene }).fighters.map(f => f.id)).toEqual(["cBram", "cCrin", "cWolf"]);
	});

	it("keeps a combatant whose token is on another map out of the engagements, and says so", () => {
		const { scene, combat } = table();
		const elsewhere = fakeCombatant({ id: "cAway", token: fakeToken({ id: "tAway", actor: fakeActor({ id: "away" }) }), scene: { id: "other" } });
		combat.combatants = collection([...combat.combatants, elsewhere]);
		world({ user: { id: "gm", isGM: true }, combats: [combat] });
		const snap = snapshotFight(combat, { scene });
		expect(snap.fighters.map(f => f.id)).not.toContain("cAway");
		expect(snap.elsewhere.map(c => c.id)).toEqual(["cAway"]);
	});

	// ⚠ THE SAME TWO-PART RULE fighterOf applies, for the same reason: core's tracker flag AND the
	// token's own hidden switch. Checking only the first showed a player a HUD-hidden ambusher waiting
	// on another map, which is the one thing hiding it was meant to prevent. A GM still counts it.
	it("keeps a hidden combatant on another map away from a player, but not from the GM", () => {
		const { scene, combat } = table();
		const token = fakeToken({ id: "tAway", actor: fakeActor({ id: "away" }) });
		token.hidden = true;
		const elsewhere = fakeCombatant({ id: "cAway", token, scene: { id: "other" } });
		combat.combatants = collection([...combat.combatants, elsewhere]);
		world({ user: { id: "gm", isGM: true }, combats: [combat] });

		expect(snapshotFight(combat, { scene }).elsewhere.map(c => c.id)).toEqual(["cAway"]);
		expect(snapshotFight(combat, { scene, viewer: { id: "p1", isGM: false } }).elsewhere).toEqual([]);
	});
});

describe("ranged engagements from players' targets", () => {
	it("shoots from the player's character, at a combatant they target", () => {
		const { bram, scene, combat } = table();
		const { gm, player, all } = fakeUsers({ bram, targets: [{ document: { id: "tWolf" } }] });
		gm.targets.add({ document: { id: "tBram" } });
		world({ user: gm, users: all, combats: [combat], canvasScene: scene });
		expect(rangedPairs(combat, scene)).toEqual([{ from: "cBram", to: "cWolf" }]);
		expect(userFighterId(player, combat, scene)).toBe("cBram");
		expect(userFighterId(gm, combat, scene)).toBeNull();
	});

	it("falls back to the one hero a player owns when they have no character assigned", () => {
		const { scene, combat } = table();
		const player = { id: "player", isGM: false, active: true, character: null, targets: new Set() };
		expect(userFighterId(player, combat, scene)).toBe("cBram");
	});

	it("gives up rather than guess between two heroes the player owns", () => {
		const { scene, combat } = table();
		const second = fakeActor({ id: "pim", type: "character", ownership: { player: 3 } });
		combat.combatants = collection([...combat.combatants, fakeCombatant({ id: "cPim", token: fakeToken({ id: "tPim", col: 9, row: 9, actor: second }), scene })]);
		const player = { id: "player", isGM: false, active: true, character: null, targets: new Set() };
		expect(userFighterId(player, combat, scene)).toBeNull();
	});

	it("has no targets to read on a scene nobody is looking at, or from a player who has left", () => {
		const { bram, scene, combat } = table();
		const { all, player } = fakeUsers({ bram, targets: [{ document: { id: "tWolf" } }] });
		expect(rangedPairs(combat, scene, { users: all, canvasScene: { id: "elsewhere" } })).toEqual([]);
		player.active = false;
		expect(rangedPairs(combat, scene, { users: all, canvasScene: scene })).toEqual([]);
	});

	it("reads a fighter's shots on record, on any scene, from anyone to anyone else in the fight", () => {
		const { scene, combat, cBram, cWolf, cCrin } = table();
		cWolf.flags[SYSTEM_ID].shots = ["cBram", "gone", "cWolf"];
		cBram.flags[SYSTEM_ID].shots = [];
		expect(rangedPairs(combat, scene, { users: [], canvasScene: { id: "elsewhere" } })).toEqual([{ from: "cWolf", to: "cBram", recorded: true }]);
		cCrin.flags[SYSTEM_ID].shots = "cBram";
		expect(rangedPairs(combat, scene, { users: [], canvasScene: scene })).toEqual([{ from: "cWolf", to: "cBram", recorded: true }]);
	});

	it("feeds the engagements", () => {
		const { bram, scene, combat } = table();
		const { gm, all } = fakeUsers({ bram, targets: [{ document: { id: "tWolf" } }] });
		world({ user: gm, users: all, combats: [combat], canvasScene: scene });
		const snap = snapshotFight(combat, { scene });
		expect(snap.result.byFighter.cBram.shootingAt).toEqual(["cWolf"]);
		expect(snap.result.byFighter.cWolf.shotBy).toEqual(["cBram"]);
	});
});

describe("finding the fight", () => {
	it("prefers the fight the tab is showing, when it is fought on this scene", () => {
		const { scene, combat } = table();
		const other = fakeCombat({ id: "other", scene, active: true, modified: 99 });
		world({ user: { id: "gm", isGM: true }, combats: [other, combat], viewed: combat });
		expect(fightOnScene(scene)).toBe(combat);
	});

	it("else takes the active fight on the scene, then the most recently changed", () => {
		const scene = fakeScene();
		const older = fakeCombat({ id: "older", scene, active: false, modified: 1 });
		const newer = fakeCombat({ id: "newer", scene, active: false, modified: 5 });
		const elsewhere = fakeCombat({ id: "elsewhere", scene: { id: "nope" }, active: true, modified: 9 });
		world({ user: { id: "gm", isGM: true }, combats: [older, newer, elsewhere] });
		expect(fightOnScene(scene)).toBe(newer);
		const active = fakeCombat({ id: "active", scene, active: true, modified: 0 });
		world({ user: { id: "gm", isGM: true }, combats: [older, newer, active] });
		expect(fightOnScene(scene)).toBe(active);
	});

	it("passes over a combat that was never a fight, like the old Introductions roster", () => {
		const { scene, combat } = table();
		const roster = fakeCombat({ id: "roster", scene, active: true, modified: 99, flags: {} });
		world({ user: { id: "gm", isGM: true }, combats: [roster, combat], viewed: roster });
		expect(fightOnScene(scene)).toBe(combat);
		world({ user: { id: "gm", isGM: true }, combats: [roster], viewed: roster });
		expect(fightOnScene(scene)).toBeNull();
	});

	it("passes over a fight the tab is still showing after the world deleted it", () => {
		const { scene, combat } = table();
		const next = fakeCombat({ id: "next", scene, active: false, modified: 1 });
		world({ user: { id: "gm", isGM: true }, combats: [next], viewed: combat });
		expect(fightOnScene(scene)).toBe(next);
		world({ user: { id: "gm", isGM: true }, combats: [], viewed: combat });
		expect(fightOnScene(scene)).toBeNull();
	});

	it("counts an unlinked combat as fought wherever its combatants stand", () => {
		const { scene, cBram } = table();
		const unlinked = fakeCombat({ id: "u", scene: null, combatants: [cBram] });
		expect(combatTouchesScene(unlinked, scene)).toBe(true);
		expect(combatTouchesScene(unlinked, { id: "other" })).toBe(false);
	});

	it("gives a token its place in the fight, or nothing when it is not in one", () => {
		const { scene, combat, tBram } = table();
		world({ user: { id: "gm", isGM: true }, combats: [combat] });
		const found = engagementFor(tBram);
		expect(found.combatant.id).toBe("cBram");
		expect(found.entry.melee).toEqual(["cCrin"]);
		expect(engagementFor(fakeToken({ id: "stranger" }))).toBeNull();
		const onScene = fakeToken({ id: "stranger" });
		onScene.parent = scene;
		expect(engagementFor(onScene)).toBeNull();
	});
});

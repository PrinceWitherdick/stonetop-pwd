import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { canSplit, groupChanges, mergeCandidates, mergeIntoGroup, splitGroup } from "../../module/fight/group-scale.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection, GRID } from "../fakes/fight.js";

// Moving a group of monsters between its two scales mid-fight (Book I p.416).

let saved;
beforeEach(() => { saved = { game: globalThis.game, canvas: globalThis.canvas, ui: globalThis.ui, CONST: globalThis.CONST }; });
afterEach(() => { Object.assign(globalThis, saved); });

/** A token actor that keeps what it is sent, as an unlinked token's synthetic actor does. */
function tokenActor(system) {
	const actor = fakeActor({ id: "crinwin", name: "Crinwin", type: "monster", system: structuredClone(system) });
	actor.update = vi.fn(async changes => {
		for (const [path, value] of Object.entries(changes)) {
			const keys = path.split(".").slice(1);
			let at = actor.system;
			for (const key of keys.slice(0, -1)) at = at[key] ??= {};
			at[keys.at(-1)] = value;
		}
	});
	return actor;
}

/**
 * Three crinwin tokens (one wounded, one out) and Bram, or with `group` one crinwin token fighting as a
 * horde of 6 with half its pool gone.
 */
function world({ group = false } = {}) {
	const base = { organization: "horde", count: 6, fightAsGroup: false, attributes: { hp: { value: 3, max: 3 } } };
	const crin = (id, col, system = {}) => {
		const t = fakeToken({ id, col, row: 5, actor: tokenActor({ ...base, ...system }), name: `Crinwin (${col})` });
		t.actorId = "crinwin";
		t.actorLink = false;
		t.update = vi.fn(async changes => Object.assign(t, changes));
		return t;
	};
	const tokens = group
		? [crin("t1", 5, { fightAsGroup: true, attributes: { hp: { value: 2, max: 3 } } })]
		: [crin("t1", 5), crin("t2", 7, { attributes: { hp: { value: 1, max: 3 } } }), crin("t3", 9, { attributes: { hp: { value: 0, max: 3 } } })];
	const bram = fakeToken({ id: "tBram", col: 0, row: 0, actor: fakeActor({ id: "bram", type: "character" }) });
	const scene = fakeScene({ tokens: [...tokens, bram] });
	scene.deleteEmbeddedDocuments = vi.fn(async () => []);
	scene.updateEmbeddedDocuments = vi.fn(async () => []);
	const combatants = [
		fakeCombatant({ id: "cBram", token: bram, scene, side: "heroes" }),
		...tokens.map((t, i) => fakeCombatant({ id: `c${i + 1}`, token: t, scene, side: "foes" })),
	];
	const combat = fakeCombat({ scene, combatants });
	combat.deleteEmbeddedDocuments = vi.fn(async () => []);
	combat.createEmbeddedDocuments = vi.fn(async () => []);
	const worldActor = fakeActor({ id: "crinwin", name: "Crinwin", type: "monster", system: base });
	worldActor.uuid = "Actor.crinwin";
	worldActor.prototypeToken = { name: "Crinwin" };
	const placed = [];
	globalThis.game = { ...saved.game, user: { id: "gm", isGM: true }, actors: collection([worldActor]), users: collection([]) };
	globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
	globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
	globalThis.canvas = {
		scene,
		dimensions: { size: GRID, sceneRect: { x: 0, y: 0, width: 4000, height: 3000 }, rect: { contains: () => true } },
		tokens: {
			controlled: [],
			_onDropActorData: vi.fn(async (event, data) => {
				const t = fakeToken({ id: `new${placed.length}`, actor: tokenActor(base) });
				t.documentName = "Token";
				t.actorId = "crinwin";
				placed.push({ data, token: t });
				return t;
			}),
		},
	};
	return { scene, combat, tokens, placed, get: id => combat.combatants.get(id) };
}

describe("groupChanges", () => {
	it("switches the token to a group of that size with its pool full", () => {
		expect(groupChanges({ system: { attributes: { hp: { value: 1, max: 3 } } } }, 6))
			.toEqual({ "system.fightAsGroup": true, "system.count": 6, "system.attributes.hp.value": 3, [`flags.${SYSTEM_ID}.groupWound`]: 0, [`flags.${SYSTEM_ID}.groupSize`]: 0 });
	});
});

describe("merging into one group", () => {
	it("takes in every capable crinwin in the fight, and leaves out one that is out and anyone else", () => {
		const { combat, get } = world();
		expect(mergeCandidates(combat, get("c1")).map(c => c.id)).toEqual(["c1", "c2"]);
		expect(mergeCandidates(combat, get("cBram"))).toEqual([]);
	});

	it("takes only the GM's selection when two or more of them are selected", () => {
		const { combat, get, scene } = world();
		const extra = fakeToken({ id: "t4", col: 11, row: 5, actor: tokenActor({ organization: "horde", attributes: { hp: { value: 3, max: 3 } } }) });
		extra.actorId = "crinwin";
		scene.tokens = collection([...scene.tokens, extra]);
		const c4 = fakeCombatant({ id: "c4", token: extra, scene, side: "foes" });
		combat.combatants = collection([...combat.combatants, c4]);
		expect(mergeCandidates(combat, get("c1"), { controlled: ["t2", "t4"] }).map(c => c.id)).toEqual(["c1", "c2", "c4"]);
		expect(mergeCandidates(combat, get("c1"), { controlled: ["t2"] }).map(c => c.id)).toEqual(["c1", "c2", "c4"]);
	});

	it("makes the clicked token the group, at the number still standing and a full pool, and removes the rest", async () => {
		const { combat, scene, tokens, get } = world();
		expect(await mergeIntoGroup(combat, get("c1"))).toBe(2);
		expect(tokens[0].actor.system).toMatchObject({ fightAsGroup: true, count: 2, attributes: { hp: { value: 3, max: 3 } } });
		expect(tokens[0].update).toHaveBeenCalledWith({ name: "Crinwin" });
		expect(combat.deleteEmbeddedDocuments).toHaveBeenCalledWith("Combatant", ["c2"]);
		expect(scene.deleteEmbeddedDocuments).toHaveBeenCalledWith("Token", ["t2"]);
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith("Crinwin: 2 now fight as one group.");
	});

	// FGT-2: only a monster that comes in numbers can fight as one group token. Two bears merged were one bear
	// counted once, the other deleted, and no Split to bring it back.
	it("offers nothing to merge for a monster that does not come in numbers", async () => {
		for (const organization of ["solitary", ""]) {
			const { combat, tokens, get } = world();
			for (const t of tokens) t.actor.system.organization = organization;
			expect(mergeCandidates(combat, get("c1"))).toEqual([]);
			expect(await mergeIntoGroup(combat, get("c1"))).toBe(0);
			expect(combat.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		}
	});

	it("does nothing for a player, or with nothing to merge", async () => {
		const { combat, get } = world({ group: true });
		expect(await mergeIntoGroup(combat, get("c1"))).toBe(0);
		globalThis.game.user = { id: "player", isGM: false };
		expect(await mergeIntoGroup(combat, get("c1"))).toBe(0);
		expect(combat.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("splitting a group", () => {
	it("is offered for a group token with two or more standing, not for a single creature", () => {
		expect(canSplit(world({ group: true }).get("c1"))).toBe(true);
		expect(canSplit(world().get("c1"))).toBe(false);
	});

	it("leaves one token per member still standing, gathered round, each at full HP and in the fight", async () => {
		const { combat, tokens, placed, get } = world({ group: true });
		// 2 of 3 HP left on a horde of 6: 4 standing.
		expect(await splitGroup(combat, get("c1"))).toBe(4);
		expect(tokens[0].actor.system).toMatchObject({ fightAsGroup: false, attributes: { hp: { value: 3 } } });
		expect(placed).toHaveLength(3);
		for (const { data } of placed) expect(Math.max(Math.abs(data.x - 550), Math.abs(data.y - 550))).toBe(GRID);
		const [[type, data]] = combat.createEmbeddedDocuments.mock.calls;
		expect(type).toBe("Combatant");
		expect(data.map(d => [d.tokenId, d.flags[SYSTEM_ID].side])).toEqual([["new0", "foes"], ["new1", "foes"], ["new2", "foes"]]);
		expect(globalThis.ui.notifications.info).toHaveBeenCalledWith("Crinwin: the group is now 4 separate tokens.");
	});

	// FGT-8: the new tokens are placed first, and whoever finds no room stays on the group token, still a group.
	it("keeps whoever finds no room together as a smaller group on the first token", async () => {
		const { combat, tokens, placed, get } = world({ group: true });
		// Room for two beside the group token (at 500,500) and no more.
		globalThis.canvas.dimensions.sceneRect = { x: 400, y: 500, width: 300, height: 100 };
		expect(await splitGroup(combat, get("c1"))).toBe(3);
		expect(placed).toHaveLength(2);
		// 4 standing, 2 placed: the group token is a group of the other 2, its pool full.
		expect(tokens[0].actor.system).toMatchObject({ fightAsGroup: true, count: 2, attributes: { hp: { value: 3 } } });
		expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith("Crinwin: only room for 2 more tokens; the other 2 stay together as a group on the first token.");
	});

	// A prototype linked to the world actor places tokens that share it. The group token, unlinked, only
	// inherits the switch from that world actor until its own delta says otherwise.
	it("keeps the leftover group a group when the new tokens are linked to a world actor fighting as a group", async () => {
		const { combat, tokens, get } = world({ group: true });
		const shared = tokenActor({ organization: "horde", count: 6, fightAsGroup: true, attributes: { hp: { value: 3, max: 3 } } });
		const group = tokens[0].actor;
		let own;
		delete group.system.fightAsGroup;
		Object.defineProperty(group.system, "fightAsGroup", {
			get: () => own ?? shared.system.fightAsGroup,
			set: value => { if (value !== shared.system.fightAsGroup) own = value; },
		});
		globalThis.canvas.dimensions.sceneRect = { x: 400, y: 500, width: 300, height: 100 };
		const drop = globalThis.canvas.tokens._onDropActorData;
		globalThis.canvas.tokens._onDropActorData = vi.fn(async (...args) => Object.assign(await drop(...args), { actor: shared }));
		expect(await splitGroup(combat, get("c1"))).toBe(3);
		expect(shared.system.fightAsGroup).toBe(false);
		expect(group.system).toMatchObject({ fightAsGroup: true, count: 2 });
	});

	it("does nothing for a player", async () => {
		const { combat, get } = world({ group: true });
		globalThis.game.user = { id: "player", isGM: false };
		expect(await splitGroup(combat, get("c1"))).toBe(0);
	});
});

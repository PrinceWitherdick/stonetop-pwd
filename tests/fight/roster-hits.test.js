import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	rosterGroupFor, rosterMemberHp, rosterHpUpdate, applyRosterHit, moveRosterHit, isLoneBlowOnGroup,
	ROSTER_FATE_OPTION, rosterFateArgs,
} from "../../module/fight/group-hits.js";
import { onUpdateActorRosterFate } from "../../module/fight/roster-fate.js";
import { handleApplyQuery, handleRosterMoveQuery, wireRosterHitMove, ROSTER_MOVE_QUERY } from "../../module/combat/attack-flow.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";
import { writeFlagPath } from "../fakes/combat-chat.js";

// A lone blow on a group FOLLOWER's token (the Marshal's crew) lands on ONE member of the roster on the
// Marshal's sheet, the first standing, and the card offers to give it to another. The token's HP is the
// group's pool, left to group-on-group exchanges.

/** Write an `actor.update` object onto a fake's flags, dotted paths and all. */
function applyUpdate(doc, changes) {
	for (const [path, value] of Object.entries(changes)) {
		const keys = path.split(".");
		let node = doc;
		for (const key of keys.slice(0, -1)) node = (node[key] ??= {});
		node[keys.at(-1)] = value;
	}
}

/** The Marshal, whose crew is Aled (named, down) and three anonymous members. */
function marshalWithCrew({ individualsHp = { 0: 0 }, memberHp = [] } = {}) {
	const marshal = fakeActor({
		id: "marshal", name: "Rhianna", type: "character",
		ownership: { pim: 3 },
		flags: { [SYSTEM_ID]: { crew: { name: "Rhianna's crew", size: 4, individuals: [{ name: "Aled" }], individualsHp, memberHp } } },
	});
	marshal.uuid = "Actor.marshal";
	marshal.update = vi.fn(async changes => applyUpdate(marshal, changes));
	return marshal;
}

function crewToken(marshal, { hp = 6 } = {}) {
	const crew = fakeActor({
		id: "crewActor", name: "Rhianna's crew", type: "npc",
		system: { attributes: { hp: { value: hp, max: 6 }, armor: { value: 0 } } },
		flags: { [SYSTEM_ID]: { followerOrigin: { characterUuid: marshal.uuid, ftype: "crew", slug: "" } } },
	});
	crew.update = vi.fn(async changes => applyUpdate(crew, changes));
	return crew;
}

let saved;
beforeEach(() => {
	saved = { game: globalThis.game, ui: globalThis.ui, canvas: globalThis.canvas, CONST: globalThis.CONST, fromUuidSync: globalThis.fromUuidSync, fromUuid: globalThis.fromUuid, ChatMessage: globalThis.ChatMessage };
	globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1, NEUTRAL: 0, HOSTILE: -1 } };
});
afterEach(() => { Object.assign(globalThis, saved); });

/** A fight: the crew's token, a lone crinwin, and a horde, the GM at the table. */
function world({ marshal = marshalWithCrew(), fightTab = true } = {}) {
	const crew = crewToken(marshal);
	const foe = fakeActor({ id: "foe", name: "Crinwin", type: "monster", system: { attributes: { hp: { value: 3, max: 3 } } } });
	foe.uuid = "Actor.foe";
	const horde = fakeActor({ id: "horde", name: "Horde", type: "monster", system: { organization: "horde", fightAsGroup: true, count: 6, attributes: { hp: { value: 3, max: 3 } } } });
	horde.uuid = "Actor.horde";
	const tokens = {
		crew: fakeToken({ id: "tC", col: 0, row: 0, actor: crew }),
		foe: fakeToken({ id: "tF", col: 1, row: 0, actor: foe }),
		horde: fakeToken({ id: "tH", col: 0, row: 1, actor: horde }),
	};
	const scene = fakeScene({ tokens: Object.values(tokens) });
	tokens.crew.uuid = "Scene.scene1.Token.tC";
	tokens.crew.documentName = "Token";
	const combat = fakeCombat({ scene, combatants: [
		fakeCombatant({ id: "cC", token: tokens.crew, scene, side: "heroes" }),
		fakeCombatant({ id: "cF", token: tokens.foe, scene }),
		fakeCombatant({ id: "cH", token: tokens.horde, scene }),
	] });
	const docs = { [marshal.uuid]: marshal, [tokens.crew.uuid]: tokens.crew, [foe.uuid]: foe, [horde.uuid]: horde };
	globalThis.fromUuidSync = uuid => docs[uuid] ?? null;
	globalThis.fromUuid = async uuid => docs[uuid] ?? null;
	const gm = { id: "gm", isGM: true, active: true };
	const users = [gm, { id: "pim", isGM: false, active: true }];
	users.get = id => users.find(u => u.id === id) ?? null;
	users.players = users.filter(u => !u.isGM);
	users.activeGM = gm;
	globalThis.game = {
		...saved.game, user: gm, users,
		actors: collection([marshal]),
		combats: collection([combat]),
		settings: { get: (_s, key) => (key === "fightTab" ? fightTab : undefined) },
	};
	globalThis.ui = { combat: { viewed: combat }, notifications: { warn: vi.fn() } };
	globalThis.canvas = { scene };
	return { marshal, crew, foe, horde, scene, token: tokens.crew };
}

describe("rosterGroupFor", () => {
	it("reads the crew's roster off the Marshal, standing members in roster order", () => {
		const { crew, marshal } = world();
		const group = rosterGroupFor(crew);
		expect(group).toMatchObject({ character: marshal, ftype: "crew", hpMax: 6, standing: 3, size: 4 });
		expect(group.members.map(m => m.key)).toEqual(["anon:0", "anon:1", "anon:2"]);
		expect(group.members[0].name).toBe("Crew member 2");
	});

	it("is nothing for a monster, a character, or a follower whose character is gone", () => {
		const { foe, marshal } = world();
		expect(rosterGroupFor(foe)).toBeNull();
		expect(rosterGroupFor(marshal)).toBeNull();
		globalThis.fromUuidSync = () => null;
		globalThis.game.actors = collection([]);
		expect(rosterGroupFor(crewToken(marshal))).toBeNull();
	});
});

describe("rosterMemberHp / rosterHpUpdate: the sheet's own HP stores", () => {
	const flags = { crew: { individualsHp: { 0: 2 }, memberHp: [null, 4] }, customFollowers: { band: { memberHp: [1] } } };

	it("reads a stored HP, and nothing stored as full", () => {
		expect(rosterMemberHp(flags, { ftype: "crew" }, "named:0", 6)).toBe(2);
		expect(rosterMemberHp(flags, { ftype: "crew" }, "anon:0", 6)).toBe(6);
		expect(rosterMemberHp(flags, { ftype: "crew" }, "anon:1", 6)).toBe(4);
		expect(rosterMemberHp(flags, { ftype: "custom", slug: "band" }, "member:0", 3)).toBe(1);
	});

	it("writes a named member by key and an anonymous one as the whole array", () => {
		expect(rosterHpUpdate(flags, { ftype: "crew" }, { "named:0": 0, "anon:2": 3 })).toEqual({
			[`flags.${SYSTEM_ID}.crew.individualsHp.0`]: 0,
			[`flags.${SYSTEM_ID}.crew.memberHp`]: [null, 4, 3],
		});
		expect(rosterHpUpdate(flags, { ftype: "custom", slug: "band" }, { "member:1": 0 })).toEqual({
			[`flags.${SYSTEM_ID}.customFollowers.band.memberHp`]: [1, 0],
		});
	});
});

describe("isLoneBlowOnGroup, on a crew's token", () => {
	it("is a lone foe's blow, and not a horde's", () => {
		const { crew, foe, horde, scene } = world();
		expect(isLoneBlowOnGroup(crew, foe, scene)).toBe(true);
		expect(isLoneBlowOnGroup(crew, horde, scene)).toBe(false);
	});

	it("leaves the pool to take it with the Fight tab off", () => {
		const { crew, foe, scene } = world({ fightTab: false });
		expect(isLoneBlowOnGroup(crew, foe, scene)).toBe(false);
	});
});

describe("applyRosterHit", () => {
	it("lands on the first member standing, on the Marshal's roster, and leaves the token's pool alone", async () => {
		const { crew, marshal } = world();
		const hit = await applyRosterHit(crew, 4);
		expect(hit).toMatchObject({ down: false, harmed: true, before: 3, after: 3 });
		expect(hit.roster).toMatchObject({ characterUuid: "Actor.marshal", ftype: "crew", key: "anon:0", name: "Crew member 2", oldHp: 6, newHp: 2 });
		expect(marshal.flags[SYSTEM_ID].crew.memberHp).toEqual([2]);
		expect(crew.update).not.toHaveBeenCalled();
		expect(crew.system.attributes.hp.value).toBe(6);
	});

	it("drops them for a blow that reaches their HP, and one fewer stands", async () => {
		const { crew, marshal } = world({ marshal: marshalWithCrew({ memberHp: [2] }) });
		const hit = await applyRosterHit(crew, 5);
		expect(hit).toMatchObject({ down: true, before: 3, after: 2 });
		expect(marshal.flags[SYSTEM_ID].crew.memberHp).toEqual([0]);
	});

	it("names the blow's move on the Marshal's ledger, and so does handing it to another member", async () => {
		const { crew, marshal } = world();
		const hit = await applyRosterHit(crew, 4, { stonetopMove: "Clash" });
		expect(marshal.update).toHaveBeenLastCalledWith(expect.anything(), { stonetopMove: "Clash" });
		await moveRosterHit(hit.roster, "anon:2", 4, { stonetopMove: "Clash" });
		expect(marshal.update).toHaveBeenLastCalledWith(expect.anything(), { stonetopMove: "Clash" });
	});
});

describe("moveRosterHit", () => {
	it("gives the first member back what it cost them and puts it on another", async () => {
		const { crew, marshal } = world({ marshal: marshalWithCrew({ memberHp: [2] }) });
		const hit = await applyRosterHit(crew, 5);
		const moved = await moveRosterHit(hit.roster, "anon:2", 5);
		expect(moved.roster).toMatchObject({ key: "anon:2", name: "Crew member 4", oldHp: 6, newHp: 1 });
		expect(moved).toMatchObject({ down: false, after: 3, from: { name: "Crew member 2", hp: 2 } });
		expect(marshal.flags[SYSTEM_ID].crew.memberHp).toEqual([2, null, 1]);
	});

	it("refuses a member who is not standing", async () => {
		const { crew } = world();
		const hit = await applyRosterHit(crew, 1);
		expect(await moveRosterHit(hit.roster, "named:0", 1)).toBeNull();
	});
});

// A crew member a lone blow drops is a follower at 0 HP (p.469): the roster write carries their fate,
// and the client that answers for the Marshal opens the sheet's fate dialog. The sheet's own HP box
// opens it itself and writes without the option, so it is never asked twice.
describe("a crew member dropped by a lone blow is asked their fate", () => {
	const fateOf = marshal => marshal.update.mock.calls.at(-1)?.[1]?.[ROSTER_FATE_OPTION];

	it("names the fate dialog's row for a crew or custom group roster key, and nobody else's", () => {
		expect(rosterFateArgs({ ftype: "crew", key: "anon:1", name: "Crew member 3" })).toEqual({ follower: "crew-member", slug: "", index: 1, name: "Crew member 3" });
		expect(rosterFateArgs({ ftype: "crew", key: "named:0", name: "Aled" })).toEqual({ follower: "crew-individual", slug: "", index: 0, name: "Aled" });
		expect(rosterFateArgs({ ftype: "custom", slug: "band", key: "member:1", name: "Member 2" })).toEqual({ follower: "custom-member", slug: "band", index: 1, name: "Member 2" });
		// A custom group's row with no group to name, or a key that is not a member's: nobody.
		expect(rosterFateArgs({ ftype: "custom", key: "member:0", name: "Member 1" })).toBeNull();
		expect(rosterFateArgs({ ftype: "custom", slug: "band", key: "anon:0" })).toBeNull();
		expect(rosterFateArgs({ ftype: "crew", key: "bogus" })).toBeNull();
	});

	it("a custom group's member dropped by a lone blow is asked their fate too, as their group's row", async () => {
		const marshal = marshalWithCrew();
		marshal.flags[SYSTEM_ID].customFollowers = { band: { name: "The Band", isGroup: true, size: 3, hpMax: 4, memberHp: [2] } };
		world({ marshal });
		const band = fakeActor({
			id: "bandActor", name: "The Band", type: "npc",
			system: { attributes: { hp: { value: 4, max: 4 }, armor: { value: 0 } } },
			flags: { [SYSTEM_ID]: { followerOrigin: { characterUuid: marshal.uuid, ftype: "custom", slug: "band" } } },
		});
		const hurt = await applyRosterHit(band, 1);
		expect(hurt).toMatchObject({ down: false });
		expect(marshal.update.mock.calls.at(-1)).toHaveLength(1);
		const hit = await applyRosterHit(band, 5);
		expect(hit).toMatchObject({ down: true });
		expect(marshal.flags[SYSTEM_ID].customFollowers.band.memberHp).toEqual([0]);
		expect(fateOf(marshal)).toEqual({ follower: "custom-member", slug: "band", index: 0, name: "Member 1" });
	});

	it("the write that drops them carries the fate; one that only hurts them carries nothing", async () => {
		const hurt = world();
		await applyRosterHit(hurt.crew, 4);
		expect(hurt.marshal.update.mock.calls.at(-1)).toHaveLength(1);

		const { crew, marshal } = world({ marshal: marshalWithCrew({ memberHp: [2] }) });
		await applyRosterHit(crew, 5);
		expect(fateOf(marshal)).toEqual({ follower: "crew-member", slug: "", index: 0, name: "Crew member 2" });
	});

	it("a named individual dropped is asked as their own row", async () => {
		const { crew, marshal } = world({ marshal: marshalWithCrew({ individualsHp: { 0: 3 } }) });
		const hit = await applyRosterHit(crew, 3);
		expect(hit.down).toBe(true);
		expect(fateOf(marshal)).toEqual({ follower: "crew-individual", slug: "", index: 0, name: "Aled" });
	});

	it("a moved blow that drops the member who takes it now asks their fate", async () => {
		const { crew, marshal } = world();
		const hit = await applyRosterHit(crew, 6);
		expect(fateOf(marshal)?.index).toBe(0);
		await moveRosterHit(hit.roster, "anon:2", 6);
		expect(fateOf(marshal)).toEqual({ follower: "crew-member", slug: "", index: 2, name: "Crew member 4" });
		// Moved onto someone it only hurts: nothing to ask.
		const again = world();
		const first = await applyRosterHit(again.crew, 6);
		await moveRosterHit(first.roster, "anon:1", 2);
		expect(again.marshal.update.mock.calls.at(-1)).toHaveLength(1);
	});

	it("the client that answers for the Marshal opens the sheet's fate dialog, and no other", () => {
		const open = vi.fn();
		const marshal = { type: "character", sheet: { _openFollowerFate: open } };
		const fate = { follower: "crew-member", slug: "", index: 2, name: "Crew member 4" };
		const options = { [ROSTER_FATE_OPTION]: fate };

		expect(onUpdateActorRosterFate(marshal, {}, options, "gm", { answers: () => false })).toBe(false);
		expect(open).not.toHaveBeenCalled();

		expect(onUpdateActorRosterFate(marshal, {}, options, "gm", { answers: () => true })).toBe(true);
		expect(open).toHaveBeenCalledWith(fate);

		// The sheet's own HP box writes without the option: nothing opens here for it.
		expect(onUpdateActorRosterFate(marshal, {}, {}, "pim", { answers: () => true })).toBe(false);
		expect(onUpdateActorRosterFate({ type: "npc", sheet: marshal.sheet }, {}, options, "gm", { answers: () => true })).toBe(false);
		expect(open).toHaveBeenCalledTimes(1);
	});

	it("through the whole press: the GM applies, the Marshal's player is the one asked", async () => {
		const { crew, marshal, token } = world({ marshal: marshalWithCrew({ memberHp: [2] }) });
		globalThis.ChatMessage = { create: vi.fn(async data => data) };
		crew.testUserPermission = user => user?.id === "pim" || !!user?.isGM;
		const flags = { [SYSTEM_ID]: { damage: { move: "Crinwin's bite", attackerUuid: "Actor.foe", results: [{ uuid: token.uuid, name: "Rhianna's crew", raw: 5 }], applied: [], weapon: null } } };
		const message = {
			id: "m1", isOwner: true, whisper: [],
			getFlag: (scope, key) => foundry.utils.getProperty(flags[scope], key),
			setFlag: vi.fn(async (scope, key, value) => { writeFlagPath(flags[scope], key, value); }),
		};
		await handleApplyQuery({ messageId: "m1" }, { user: globalThis.game.users.get("pim") }, { messages: { get: () => message }, users: globalThis.game.users });
		const [, options] = marshal.update.mock.calls.at(-1);

		// Every client's updateActor sees the option; the Marshal's player's opens it, the GM's does not.
		const open = vi.fn();
		marshal.sheet = { _openFollowerFate: open };
		// Pim is the Marshal's player (DeathsDoorPrompt.js#answersFor picks them), so only Pim's client answers.
		const onClient = clientId => ({ answers: () => clientId === "pim" });
		expect(onUpdateActorRosterFate(marshal, {}, options, "gm", onClient("gm"))).toBe(false);
		expect(onUpdateActorRosterFate(marshal, {}, options, "gm", onClient("pim"))).toBe(true);
		expect(open).toHaveBeenCalledWith({ follower: "crew-member", slug: "", index: 0, name: "Crew member 2" });
	});
});

// The whole press: a GM's card, a lone crinwin's blow on the crew's token, applied for the Marshal's
// player through the GM's client (APPLY_QUERY), as the live table does it.
describe("applying a lone blow on the crew's token", () => {
	function gmCard(results) {
		const flags = { [SYSTEM_ID]: { damage: { move: "Crinwin's bite", attackerUuid: "Actor.foe", results, applied: [], weapon: null } } };
		return {
			flags,
			message: {
				id: "m1", isOwner: true, whisper: [],
				getFlag: (scope, key) => foundry.utils.getProperty(flags[scope], key),
				setFlag: vi.fn(async (scope, key, value) => { writeFlagPath(flags[scope], key, value); }),
			},
		};
	}

	it("writes one member's HP on the Marshal's roster, names them, and leaves the pool", async () => {
		const { crew, marshal, token } = world();
		const PIM = globalThis.game.users.get("pim");
		const created = [];
		globalThis.ChatMessage = { create: vi.fn(async data => { created.push(data); return data; }) };
		// The token's actor is the Marshal's player's, as the crew's is.
		crew.testUserPermission = user => user?.id === "pim" || !!user?.isGM;
		const { message, flags } = gmCard([{ uuid: token.uuid, name: "Rhianna's crew", raw: 4 }]);
		expect(await handleApplyQuery({ messageId: "m1" }, { user: PIM }, { messages: { get: () => message }, users: globalThis.game.users })).toBe(true);

		expect(marshal.flags[SYSTEM_ID].crew.memberHp).toEqual([2]);
		expect(crew.system.attributes.hp.value).toBe(6);
		expect(flags[SYSTEM_ID].damage.applied[0]).toMatchObject({ member: true, roster: { key: "anon:0", oldHp: 6, newHp: 2 } });
		expect(created.at(-1).content).toContain("Crew member 2 takes it (6 → 2 HP), 3 still standing");
	});

	it("gives it to the member the table picks, through the GM's client for the Marshal's player", async () => {
		const { crew, marshal, token } = world();
		globalThis.ChatMessage = { create: vi.fn(async data => data) };
		crew.testUserPermission = user => user?.id === "pim" || !!user?.isGM;
		const { message, flags } = gmCard([{ uuid: token.uuid, name: "Rhianna's crew", raw: 4 }]);
		const deps = { messages: { get: () => message }, users: globalThis.game.users };
		await handleApplyQuery({ messageId: "m1" }, { user: globalThis.game.users.get("pim") }, deps);

		// Somebody who does not own the Marshal is refused.
		expect(await handleRosterMoveQuery({ messageId: "m1", rowUuid: token.uuid, toKey: "anon:1" }, { user: { id: "bob", isGM: false } }, deps)).toBe(false);
		expect(await handleRosterMoveQuery({ messageId: "m1", rowUuid: token.uuid, toKey: "anon:1" }, { user: globalThis.game.users.get("pim") }, deps)).toBe(true);
		expect(marshal.flags[SYSTEM_ID].crew.memberHp).toEqual([6, 2]);
		expect(flags[SYSTEM_ID].damage.applied[0].roster).toMatchObject({ key: "anon:1", name: "Crew member 3" });
	});

	it("draws the member picker on the card, relaying a player's pick to the GM", async () => {
		const { crew, token } = world();
		globalThis.ChatMessage = { create: vi.fn(async data => data) };
		crew.testUserPermission = user => user?.id === "pim" || !!user?.isGM;
		const { message } = gmCard([{ uuid: token.uuid, name: "Rhianna's crew", raw: 4 }]);
		await handleApplyQuery({ messageId: "m1" }, { user: globalThis.game.users.get("pim") }, { messages: { get: () => message }, users: globalThis.game.users });

		// The player's screen: the GM wrote the card, so the pick goes to the GM's client.
		const query = vi.fn(async () => true);
		globalThis.game.users.activeGM = { ...globalThis.game.users.activeGM, query };
		globalThis.game.user = globalThis.game.users.get("pim");
		crew.isOwner = true;
		message.isOwner = false;
		const made = [];
		const el = tag => {
			const node = { tagName: tag, children: [], listeners: {}, append: (...kids) => node.children.push(...kids), addEventListener: (type, fn) => { node.listeners[type] = fn; } };
			made.push(node);
			return node;
		};
		const savedDocument = globalThis.document;
		globalThis.document = { createElement: el };
		try {
			const actions = el("div");
			wireRosterHitMove(message, { querySelector: () => actions });
			const select = made.find(n => n.tagName === "select");
			expect(select.children.map(o => o.value)).toEqual(["anon:0", "anon:1", "anon:2"]);
			expect(select.children[0].selected).toBe(true);
			select.value = "anon:2";
			await select.listeners.change();
			expect(query).toHaveBeenCalledWith(ROSTER_MOVE_QUERY, { messageId: "m1", rowUuid: token.uuid, toKey: "anon:2", userId: "pim" }, { timeout: 10000 });
		} finally {
			globalThis.document = savedDocument;
		}
	});
});

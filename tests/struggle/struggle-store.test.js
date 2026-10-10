import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_ID } from "../../module/system-id.js";
import { applyUpdate, campParty, restoreCampWorld } from "../fakes/camp.js";

/**
 * The struggle's documents: calling it, each row's roll written to its own character by the one client
 * that drives it, the GM sharing the results, rescues, and the XP a 6- earns only when nobody got that
 * character out (Book I p.78).
 */

const toolkit = { id: "toolkit", type: "gmToolkit", flags: {} };
toolkit.getFlag = (scope, key) => foundry.utils.getProperty(toolkit.flags[scope] ?? {}, key);
toolkit.update = vi.fn(async update => { await Promise.resolve(); applyWithDeletions(toolkit, update); });

vi.mock("../../module/actors/gmtoolkit/gm-toolkit-actor.js", () => ({ theGmToolkit: () => toolkit }));
vi.mock("../../module/utils/move-refs.js", () => ({ fetchMoveRef: async () => "<p>Struggle as One</p>" }));

const dice = { next: [] };
vi.mock("../../module/utils/roll-engine.js", () => ({
	dieResultsText: roll => roll.faces,
	markMissXp: vi.fn(async () => {}),
	rollStat: vi.fn(async (stat, actor, options) => fakeRoll(actor, options)),
}));

const { markMissXp, rollStat } = await import("../../module/utils/roll-engine.js");
const store = await import("../../module/struggle/struggle-store.js");
const { MOVE, ROW_KIND, STRUGGLE_STATUS } = await import("../../module/struggle/struggle-rules.js");

/** Foundry's update, with the `-=key` deletion the v13 spelling of deletionEntry writes. */
function applyWithDeletions(doc, update) {
	const plain = {};
	for (const [path, value] of Object.entries(update)) {
		const leaf = path.split(".").pop();
		if (leaf.startsWith("-=") && value === null) {
			const parent = foundry.utils.getProperty(doc, path.split(".").slice(0, -1).join("."));
			if (parent) delete parent[leaf.slice(2)];
		} else plain[path] = value;
	}
	applyUpdate(doc, plain);
}

/** The roll a card would post: a message in the log, whispered as asked. */
async function fakeRoll(actor, options) {
	const total = dice.next.shift() ?? 8;
	const message = {
		id: `m${game.messages.contents.length + 1}`,
		whisper: [...(options.whisper ?? [])],
		blind: false,
		flags: options.messageFlags,
		rolls: [{ total }],
		getFlag: (scope, key) => foundry.utils.getProperty(message.flags?.[scope] ?? {}, key),
		update: vi.fn(async data => Object.assign(message, data)),
	};
	game.messages.contents.push(message);
	return { total, faces: "3, 4" };
}

/** Aeliana (player-1), Bram (player-2), a GM; each character able to roll through its model. */
function party({ me = "gm", bramOnline = true } = {}) {
	const world = campParty({ me, bramOnline });
	game.messages.get = id => game.messages.contents.find(m => m.id === id) ?? null;
	game.users.find = test => game.users.contents.find(test);
	game.release = { generation: 13 };
	for (const actor of [world.aeliana, world.bram]) {
		actor.update = vi.fn(async update => { await Promise.resolve(); applyWithDeletions(actor, update); });
		actor.typedActor.onDirectStatRoll = vi.fn(async (stat, options) => fakeRoll(actor, options));
		actor.items = [];
	}
	return world;
}

const rowsFor = (...ids) => ids.map(actorId => ({ kind: ROW_KIND.PC, actorId, name: actorId }));
const flagOf = (doc, key) => doc.flags[SYSTEM_ID]?.[key];

beforeEach(() => {
	toolkit.flags = {};
	toolkit.update.mockClear();
	dice.next = [];
	vi.mocked(markMissXp).mockClear();
	vi.mocked(rollStat).mockClear();
});
afterEach(restoreCampWorld);

describe("calling a struggle", () => {
	it("writes it onto the toolkit, gives each character a clean record, and tells the table", async () => {
		const { aeliana, act } = party();
		// Leftovers from an earlier struggle, which must not read as this one's rolls.
		applyUpdate(aeliana, { [`flags.${SYSTEM_ID}.struggleRoll`]: { id: "old", rolls: { pc_aeliana: { total: 12 } } } });
		act("gm");
		const result = await store.startStruggle({ danger: "The mire", rows: rowsFor("aeliana", "bram") });
		expect(result.ok).toBe(true);
		expect(store.currentStruggle()).toMatchObject({ status: STRUGGLE_STATUS.ROLLING, danger: "The mire" });
		expect(flagOf(aeliana, "struggleRoll")).toEqual({ id: result.struggle.id, bundleAlly: "" });
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
	});

	it("refuses a player, a second struggle, and a struggle with nobody in it", async () => {
		const { act } = party({ me: "player-1" });
		expect((await store.startStruggle({ rows: rowsFor("aeliana") })).reason).toBe("not-gm");
		act("gm");
		expect((await store.startStruggle({ rows: [] })).reason).toBe("empty");
		await store.startStruggle({ rows: rowsFor("aeliana") });
		expect((await store.startStruggle({ rows: rowsFor("bram") })).reason).toBe("live");
	});

	it("takes down the ask it answers, keeping the ask's id so its player hears no 'no'", async () => {
		const { aeliana, act } = party({ me: "player-1" });
		await store.askForStruggle(aeliana, { danger: "Wolves" });
		const ask = store.askOf(aeliana);
		act("gm");
		const result = await store.startStruggle({ rows: rowsFor("aeliana"), askId: ask.id, askActorId: "aeliana" });
		expect(result.struggle.id).toBe(ask.id);
		expect(store.askOf(aeliana)).toBeNull();
	});

	// A GM who calls one of their own while a player's ask waits has answered it too, when that player is
	// in it: left up, the ask opened a stale setup once the struggle ended, and its player heard a "no".
	it("takes down the ask of anybody it calls on, and that player hears no 'no'", async () => {
		const { bram, act } = party({ me: "player-2" });
		await store.askForStruggle(bram, { danger: "Wolves" });
		act("gm");
		await store.startStruggle({ rows: rowsFor("aeliana", "bram") });
		expect(store.askOf(bram)).toBeNull();
		act("player-2");
		expect(store.askTurnedDown(bram, { flags: { [SYSTEM_ID]: { "-=struggleAsk": null } } })).toBe(false);
	});
});

describe("rolling", () => {
	async function called(options = {}) {
		const world = party(options);
		world.act("gm");
		await store.startStruggle({ danger: "The mire", rows: [
			{ kind: ROW_KIND.PC, actorId: "aeliana", name: "Aeliana", stats: ["str", "con"] },
			{ kind: ROW_KIND.PC, actorId: "bram", name: "Bram" },
		] });
		return world;
	}

	it("rolls through the character, privately, holding back the miss XP, and writes the result on them", async () => {
		const { aeliana, act } = await called();
		act("player-1");
		dice.next = [5];
		expect(await store.rollRow("pc_aeliana", { stat: "con" })).toEqual({ ok: true });
		const [stat, options] = aeliana.typedActor.onDirectStatRoll.mock.calls[0];
		expect(stat).toBe("con");
		expect(options).toMatchObject({ moveName: "Struggle as One", noXpOnMiss: true, rollMode: "normal" });
		// Aimed at the struggle, so no grudge (Binding Arbitration, Tough Love) is read off the map's targets.
		expect(options.targets).toEqual([]);
		expect(options.whisper.sort()).toEqual(["gm", "player-1"]);
		expect(flagOf(aeliana, "struggleRoll").rolls.pc_aeliana).toMatchObject({ stat: "con", total: 5, dice: "3, 4", messageId: "m1" });
	});

	// Advantage and disadvantage cancel however many of each there are (p.230). The board's straight roll is
	// handed over as the two sides that spoke, so the character's debility or held promise is folded with them
	// instead of tipping a roll that was already straight.
	it("hands the roll the board's sides, not only the straight mode they cancel to", async () => {
		const world = party();
		world.act("gm");
		await store.startStruggle({ danger: "The mire", rows: [
			{ kind: ROW_KIND.PC, actorId: "aeliana", name: "Aeliana", mode: "dis", aid: { by: "Bram", advantage: true } },
		] });
		world.act("player-1");
		await store.rollRow("pc_aeliana", { stat: "str" });
		const [, options] = world.aeliana.typedActor.onDirectStatRoll.mock.calls[0];
		expect(options).toMatchObject({ rollMode: "normal", modeBase: "normal", modeSources: ["adv", "dis"] });
	});

	it("falls back to an allowed stat when handed one the GM did not allow", async () => {
		const { aeliana, act } = await called();
		act("player-1");
		await store.rollRow("pc_aeliana", { stat: "cha" });
		expect(aeliana.typedActor.onDirectStatRoll.mock.calls[0][0]).toBe("str");
	});

	it("lets only the row's driver roll it, and only once", async () => {
		const { act } = await called();
		act("player-2");
		expect((await store.rollRow("pc_aeliana")).reason).toBe("not-yours");
		act("player-1");
		await store.rollRow("pc_aeliana");
		expect((await store.rollRow("pc_aeliana")).reason).toBe("rolled");
	});

	it("hands the GM the rolls of a player who is away", async () => {
		const { bram, act } = await called({ bramOnline: false });
		act("gm");
		expect((await store.rollRow("pc_bram")).ok).toBe(true);
		expect(bram.typedActor.onDirectStatRoll).toHaveBeenCalledTimes(1);
	});

	it("rolls a follower +N through the character they follow", async () => {
		const world = party();
		world.act("gm");
		await store.startStruggle({ rows: [{ kind: ROW_KIND.FOLLOWER, actorId: "aeliana", ftype: "crew", slug: "", name: "Crew", bonus: 1, isGroup: true }] });
		world.act("player-1");
		await store.rollRow("fo_aeliana_crew_");
		const [stat, actor, options] = vi.mocked(rollStat).mock.calls[0];
		expect([stat, actor.id]).toEqual(["follower", "aeliana"]);
		expect(options).toMatchObject({ statValue: 1, noXpOnMiss: true, moveName: "Crew: Struggle as One" });
	});

	// We Happy Few's shaken nerves are "disadvantage on ALL rolls", a follower's included, as Order Followers
	// folds them; folded with the board's sides, so an Aid's advantage cancels them rather than being stepped over.
	it("lays the character's shaken nerves on a follower's roll", async () => {
		const world = party();
		applyUpdate(world.aeliana, { [`flags.${SYSTEM_ID}.shakenNerves`]: true });
		world.act("gm");
		await store.startStruggle({ rows: [{ kind: ROW_KIND.FOLLOWER, actorId: "aeliana", ftype: "crew", slug: "", name: "Crew", bonus: 1, isGroup: true, mode: "adv" }] });
		world.act("player-1");
		await store.rollRow("fo_aeliana_crew_");
		const [, , options] = vi.mocked(rollStat).mock.calls[0];
		expect(options).toMatchObject({ rollMode: "normal", modeSources: ["adv", "dis"] });
		expect(options.conditionNotes).toContain("Shaken nerves (We Happy Few)");
	});

	// A reload between the dice and the record left the row looking unrolled; its card in the log is its roll.
	it("takes a roll card already in the log as the row's roll instead of rolling again", async () => {
		const { aeliana, act } = await called();
		const struggleId = store.currentStruggle().id;
		const card = {
			id: "m-before", rolls: [{ total: 11 }],
			flags: { [SYSTEM_ID]: { struggleRoll: { id: struggleId, row: "pc_aeliana", nonce: "x" }, rolled: { stat: "con" } } },
		};
		card.getFlag = (scope, key) => card.flags[scope]?.[key];
		game.messages.contents.push(card);
		act("player-1");
		expect(await store.rollRow("pc_aeliana", { stat: "str" })).toEqual({ ok: true });
		expect(aeliana.typedActor.onDirectStatRoll).not.toHaveBeenCalled();
		expect(flagOf(aeliana, "struggleRoll").rolls.pc_aeliana).toMatchObject({ stat: "con", total: 11, messageId: "m-before" });
	});

	it("names Stone Cold on the card when the GM ticked it", async () => {
		const world = party();
		world.act("gm");
		await store.startStruggle({ rows: [{ kind: ROW_KIND.PC, actorId: "aeliana", name: "Aeliana", halfMisses: [MOVE.STONE_COLD] }] });
		world.act("player-1");
		await store.rollRow("pc_aeliana");
		expect(world.aeliana.typedActor.onDirectStatRoll.mock.calls[0][1].missCountsAsPartial).toBe(MOVE.STONE_COLD);
	});
});

describe("sharing, rescuing and ending", () => {
	/** Aeliana misses, Bram rolls a 10+, and the GM has shared both. */
	async function shared() {
		const world = party();
		world.act("gm");
		await store.startStruggle({ rows: rowsFor("aeliana", "bram") });
		dice.next = [4, 11];
		world.act("player-1");
		await store.rollRow("pc_aeliana");
		world.act("player-2");
		await store.rollRow("pc_bram");
		world.act("gm");
		await store.revealStruggle();
		return world;
	}

	it("makes every roll's card public when the GM shares them", async () => {
		await shared();
		expect(store.currentStruggle().status).toBe(STRUGGLE_STATUS.REVEALED);
		for (const message of game.messages.contents) expect(message.update).toHaveBeenCalledWith({ whisper: [], blind: false });
	});

	it("marks XP for a 6- nobody got out", async () => {
		const { aeliana } = await shared();
		expect(await store.endStruggle()).toBe(true);
		// Out loud, and written as Aeliana's player so the receipt's Undo is hers, not the GM's.
		expect(markMissXp).toHaveBeenCalledWith(aeliana, "Struggle as One", { rollMode: "publicroll", author: "player-1" });
		expect(store.currentStruggle()).toMatchObject({ status: STRUGGLE_STATUS.CLOSED, xpMarked: ["pc_aeliana"] });
	});

	it("marks no XP for a 6- a 10+ got out", async () => {
		const { act } = await shared();
		act("player-2");
		await store.rescue("pc_bram", ["pc_aeliana"]);
		act("gm");
		await store.endStruggle();
		expect(markMissXp).not.toHaveBeenCalled();
	});

	it("lets the GM take a rescue back", async () => {
		const { bram, act } = await shared();
		act("player-2");
		await store.rescue("pc_bram", ["pc_aeliana"]);
		act("gm");
		await store.undoRescue("pc_bram");
		expect(flagOf(bram, "struggleRoll").saves.pc_bram).toEqual([]);
		await store.endStruggle();
		expect(markMissXp).toHaveBeenCalledTimes(1);
	});

	it("refuses a rescue by a row that did not roll a 10+", async () => {
		const { aeliana, act } = await shared();
		act("player-1");
		await store.rescue("pc_aeliana", ["pc_bram"]);
		expect(flagOf(aeliana, "struggleRoll").saves).toBeUndefined();
	});

	it("ends once, however many times End is pressed", async () => {
		await shared();
		await Promise.all([store.endStruggle(), store.endStruggle()]);
		expect(markMissXp).toHaveBeenCalledTimes(1);
	});

	it("calls off a struggle still being rolled, marking nothing", async () => {
		const world = party();
		world.act("gm");
		await store.startStruggle({ rows: rowsFor("aeliana") });
		expect(await store.cancelStruggle()).toBe(true);
		expect(store.currentStruggle().status).toBe(STRUGGLE_STATUS.CANCELLED);
		expect(markMissXp).not.toHaveBeenCalled();
	});
});

describe("asking", () => {
	it("needs a GM connected to ask", async () => {
		const { aeliana } = party({ me: "player-1" });
		game.users.contents.find(u => u.isGM).active = false;
		expect((await store.askForStruggle(aeliana, {})).reason).toBe("no-gm");
		expect(store.askOf(aeliana)).toBeNull();
	});

	it("tells the asker when the GM took the ask down without calling it", async () => {
		const { aeliana, act } = party({ me: "player-1" });
		await store.askForStruggle(aeliana, { danger: "Wolves" });
		act("gm");
		await store.clearAsk(aeliana);
		act("player-1");
		expect(store.askTurnedDown(aeliana, { flags: { [SYSTEM_ID]: { "-=struggleAsk": null } } })).toBe(true);
	});
});

// At a table where every player owns every sheet, the receipt goes to the player who PLAYS the character
// (playbook-actors.js#playsCharacter), not whoever owns it first in the list.
describe("who a struggle's miss receipt is written as", () => {
	const pc = { id: "pim", testUserPermission: user => !user.isGM };
	const user = (id, over = {}) => ({ id, isGM: false, active: true, character: null, ...over });

	it("picks the player whose assigned character it is, over another owner", () => {
		const users = [user("bob", { character: { id: "cadi" } }), user("alice", { character: { id: "pim" } })];
		expect(store.struggleReceiptAuthor(pc, users)).toBe("alice");
	});

	it("keeps its fallbacks: a logged-in player first, then any, then nobody", () => {
		expect(store.struggleReceiptAuthor(pc, [user("bob", { active: false }), user("alice")])).toBe("alice");
		expect(store.struggleReceiptAuthor(pc, [user("bob", { active: false })])).toBe("bob");
		expect(store.struggleReceiptAuthor(pc, [user("gm", { isGM: true })])).toBeNull();
		expect(store.struggleReceiptAuthor(pc, [user("bob", { character: { id: "cadi" } })])).toBeNull();
	});
});

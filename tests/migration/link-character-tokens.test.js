import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	deltaChanges, hasDrifted, findUnlinkedCharacterTokens, driftSummary,
	linkToken, keepSheetCopy, adoptTokenCopy, linkCharacterPrototypes,
	repairCharacterTokenLinks, applyLinkChoices,
} from "../../module/migration/link-character-tokens.js";

// The repair for player tokens that carry their own private copy of their character.
//
// An unlinked token does not point at its Actor: it holds an ActorDelta that is merged over the
// world Actor to make a second, token-local one. A roll writes to the sheet's Actor while every
// chat-card button resolves its Actor out of the message speaker — which core rewrites to the
// TOKEN whenever one is on the canvas — so the two halves drift, and a miss can mark XP on one
// total while the Burn Brightly button on the same card spends it out of the other.
//
// The rule that makes this safe is the one most of these assert: relinking abandons the delta,
// so only a token with an EMPTY delta may be linked without asking, and every other one is the
// GM's decision.

/**
 * An ActorDelta as the schema actually materialises it.
 *
 * This shape is the whole reason deltaChanges exists, so the fake has to be faithful to it: the
 * schema is NOT sparse, and an untouched delta still arrives with every key present — `null` for
 * the nullable passthroughs, `{}` for the ObjectFields, `[]` for the collections. A fake that
 * omitted them would let a naive `Object.keys(delta).length` pass here and report every token in
 * the world as drifted in Foundry.
 */
const delta = (changes = {}) => ({
	_id: "deltaid0000000001", name: null, type: null, img: null,
	system: {}, items: [], effects: [], flags: {},
	...changes,
});

const actor = (id, name, system = {}, extra = {}) => ({
	id, name, type: "character", system,
	items: [], effects: [],
	prototypeToken: { actorLink: true },
	update: vi.fn(async () => {}),
	toObject: () => ({ _id: id, name, system, items: [], effects: [], flags: {} }),
	...extra,
});

const token = (over = {}) => ({
	uuid: `Scene.s1.Token.${over.id ?? "t1"}`,
	name: over.name ?? "Torwyn",
	actorLink: false,
	actorId: over.actorId ?? "a1",
	delta: delta(),
	update: vi.fn(async () => {}),
	...over,
});

const scene = (name, tokens) => ({ name, tokens });

beforeEach(() => {
	global.game = { actors: [], scenes: [] };
	global.Actor = { updateDocuments: vi.fn(async () => {}) };
});

afterEach(() => {
	delete global.game;
	delete global.Actor;
});

describe("deltaChanges", () => {
	it("reads an untouched delta as no change at all, despite every key being present", () => {
		expect(deltaChanges(delta())).toEqual({});
		expect(hasDrifted(delta())).toBe(false);
	});

	it("takes the source from an ActorDelta document rather than its live shape", () => {
		const doc = { toObject: () => delta({ system: { attributes: { xp: { value: 13 } } } }) };
		expect(hasDrifted(doc)).toBe(true);
	});

	it("ignores the delta's own identity keys", () => {
		// `_id` is the delta's identity and `type` a passthrough of the base Actor's type;
		// neither is ever something somebody changed.
		expect(deltaChanges(delta({ type: "character" }))).toEqual({});
	});

	it("counts a system value, a renamed token, gear and flags as drift", () => {
		expect(hasDrifted(delta({ system: { attributes: { xp: { value: 13 } } } }))).toBe(true);
		expect(hasDrifted(delta({ name: "Torwyn (wounded)" }))).toBe(true);
		expect(hasDrifted(delta({ items: [{ _id: "i1" }] }))).toBe(true);
		expect(hasDrifted(delta({ flags: { "stonetop-pwd": { leads: [] } } }))).toBe(true);
	});

	it("survives a token with no delta at all", () => {
		expect(hasDrifted(undefined)).toBe(false);
		expect(hasDrifted(null)).toBe(false);
	});
});

describe("findUnlinkedCharacterTokens", () => {
	it("finds an unlinked player token and says whether it has drifted", () => {
		const base = actor("a1", "Torwyn");
		const drifted = token({ id: "t1", baseActor: base, delta: delta({ system: { attributes: { xp: { value: 13 } } } }) });
		const clean   = token({ id: "t2", baseActor: base });
		const found = findUnlinkedCharacterTokens([scene("The Commons", [drifted, clean])]);
		expect(found.map(row => row.drifted)).toEqual([true, false]);
	});

	it("leaves a LINKED player token alone", () => {
		const base = actor("a1", "Torwyn");
		const found = findUnlinkedCharacterTokens([scene("s", [token({ baseActor: base, actorLink: true })])]);
		expect(found).toEqual([]);
	});

	// A scene's townsfolk and monsters are placed many times over and each copy is its own
	// creature: unlinked is CORRECT for them, and a sweep that "fixed" it would collapse six
	// goblins into one shared pool of hit points.
	it("leaves every other actor type unlinked", () => {
		for (const type of ["npc", "monster", "stonetop", "gmToolkit"]) {
			const base = actor("a1", "Somebody");
			base.type = type;
			expect(findUnlinkedCharacterTokens([scene("s", [token({ baseActor: base })])])).toEqual([]);
		}
	});

	it("skips a token whose Actor is gone, having nothing to link it to", () => {
		expect(findUnlinkedCharacterTokens([scene("s", [token({ baseActor: null, actorId: null })])])).toEqual([]);
	});

	it("falls back to the world Actor when the token cannot resolve its own base", () => {
		// A token document read off a Scene that is not the viewed one may have no `baseActor`
		// getter populated; the sweep still has to recognise it as a character's.
		const base = actor("a1", "Torwyn");
		global.game.actors = { get: (id) => (id === "a1" ? base : null) };
		const found = findUnlinkedCharacterTokens([scene("s", [token({ baseActor: undefined })])]);
		expect(found).toHaveLength(1);
		expect(found[0].base).toBe(base);
	});

	it("walks every Scene, not just the one being looked at", () => {
		const base = actor("a1", "Torwyn");
		const found = findUnlinkedCharacterTokens([
			scene("A", [token({ id: "t1", baseActor: base })]),
			scene("B", [token({ id: "t2", baseActor: base })]),
		]);
		expect(found.map(row => row.scene.name)).toEqual(["A", "B"]);
	});
});

describe("driftSummary", () => {
	const split = () => {
		const base = actor("a1", "Torwyn", { attributes: { xp: { value: 16 }, hp: { value: 18 } } });
		const tokenActor = actor("a1", "Torwyn", { attributes: { xp: { value: 11 }, hp: { value: 18 } } });
		return { base, tok: token({ actor: tokenActor, baseActor: base, delta: delta({ system: { attributes: { xp: { value: 11 } } } }) }) };
	};

	it("names the vitals that differ, token side first, and stays quiet about the ones that agree", () => {
		const { base, tok } = split();
		const { vitals } = driftSummary(tok, base);
		expect(vitals).toEqual([{ label: "XP", token: 11, sheet: 16 }]);
	});

	it("reports gear and flag drift as counts of DIFFERENCES, not of the character's gear", () => {
		const base = actor("a1", "Torwyn");
		const tok = token({
			actor: base, baseActor: base,
			delta: delta({ items: [{ _id: "i1" }, { _id: "i2" }], flags: { "stonetop-pwd": {} } }),
		});
		const { other } = driftSummary(tok, base);
		expect(other).toContain("2 item(s) differ");
		expect(other).toContain("marks, holds or other flags differ");
	});

	it("still reports a drift that none of the named vitals covers", () => {
		const base = actor("a1", "Torwyn");
		const tok = token({ actor: base, baseActor: base, delta: delta({ img: "worlds/x/other.webp" }) });
		const { vitals, other } = driftSummary(tok, base);
		expect(vitals).toEqual([]);
		expect(other).toContain("a different portrait on the token");
	});
});

describe("linkToken / keepSheetCopy", () => {
	it("points the token at its character and touches nothing else", async () => {
		const tok = token();
		await linkToken(tok);
		expect(tok.update).toHaveBeenCalledWith({ actorLink: true });
	});

	it("keeping the sheet's copy IS just the link: the delta is abandoned, not rewritten", async () => {
		const tok = token({ delta: delta({ system: { attributes: { xp: { value: 11 } } } }) });
		await keepSheetCopy(tok);
		expect(tok.update).toHaveBeenCalledWith({ actorLink: true });
		expect(tok.update).toHaveBeenCalledTimes(1);
	});
});

describe("adoptTokenCopy", () => {
	// An embedded collection yields DOCUMENTS, not the data they were made from — so the fake
	// wraps each entry the way Foundry does. A collection of bare data would let a reconcile
	// that forgot `toObject()` pass here and throw in the world.
	const embedded = (data) => {
		const docs = data.map(entry => ({ id: entry._id, toObject: () => entry }));
		return {
			get: (id) => docs.find(doc => doc.id === id),
			[Symbol.iterator]: () => docs[Symbol.iterator](),
		};
	};

	const withItems = (baseItems, tokenItems) => {
		const deleted = [], updated = [], created = [];
		const base = actor("a1", "Torwyn", { attributes: { xp: { value: 16 } } }, {
			items: embedded(baseItems),
			effects: embedded([]),
			deleteEmbeddedDocuments: vi.fn(async (_t, ids) => deleted.push(...ids)),
			updateEmbeddedDocuments: vi.fn(async (_t, data) => updated.push(...data)),
			createEmbeddedDocuments: vi.fn(async (_t, data, opts) => created.push({ data, opts })),
		});
		const tokenActor = actor("a1", "Torwyn", { attributes: { xp: { value: 11 } } }, {
			toObject: () => ({
				_id: "a1", name: "Torwyn", img: "a.webp",
				system: { attributes: { xp: { value: 11 } } }, flags: { f: 1 },
				items: tokenItems, effects: [],
			}),
		});
		return { base, tok: token({ actor: tokenActor, baseActor: base }), deleted, updated, created };
	};

	it("writes the token's system and flags over the character WHOLESALE, then links", async () => {
		const { base, tok } = withItems([], []);
		await adoptTokenCopy(tok);
		const [changes, options] = base.update.mock.calls[0];
		expect(changes.system).toEqual({ attributes: { xp: { value: 11 } } });
		expect(changes.flags).toEqual({ f: 1 });
		// Merging would keep values on the character that the token's copy had deliberately
		// cleared — which is neither half's version of events.
		expect(options).toEqual({ diff: false, recursive: false });
		expect(tok.update).toHaveBeenCalledWith({ actorLink: true });
	});

	it("does NOT carry ownership or folder across: those belong to the shared character", async () => {
		const { base, tok } = withItems([], []);
		await adoptTokenCopy(tok);
		const [changes] = base.update.mock.calls[0];
		expect(changes).not.toHaveProperty("ownership");
		expect(changes).not.toHaveProperty("folder");
	});

	// A level-up records which move instance raised which stat against the ITEM's id, so a
	// delete-and-recreate that minted fresh ids would leave those choices pointing at nothing.
	it("recreates items with keepId so a stat-increase choice still finds its move", async () => {
		const { tok, created } = withItems([], [{ _id: "i1", name: "Improved Stat" }]);
		await adoptTokenCopy(tok);
		expect(created[0].opts).toEqual({ keepId: true });
		expect(created[0].data).toEqual([{ _id: "i1", name: "Improved Stat" }]);
	});

	it("deletes what the token's copy dropped and updates what it changed", async () => {
		const { tok, deleted, updated, created } = withItems(
			[{ _id: "i1", name: "Spear" }, { _id: "i2", name: "Shield" }],
			[{ _id: "i1", name: "Spear (notched)" }],
		);
		await adoptTokenCopy(tok);
		expect(deleted).toEqual(["i2"]);
		expect(updated).toEqual([{ _id: "i1", name: "Spear (notched)" }]);
		expect(created).toEqual([]);
	});

	it("leaves an item both halves agree on completely alone", async () => {
		const same = { _id: "i1", name: "Spear" };
		const { base, tok } = withItems([same], [{ ...same }]);
		await adoptTokenCopy(tok);
		expect(base.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(base.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(base.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("linkCharacterPrototypes", () => {
	it("stamps a character whose prototype was never linked, so the NEXT drag is safe", async () => {
		const unlinked = actor("a1", "Torwyn");
		unlinked.prototypeToken = { actorLink: false };
		await linkCharacterPrototypes([unlinked, actor("a2", "Bryn")]);
		expect(global.Actor.updateDocuments).toHaveBeenCalledWith([
			{ _id: "a1", "prototypeToken.actorLink": true },
		]);
	});

	it("writes nothing when every character is already linked", async () => {
		await linkCharacterPrototypes([actor("a1", "Torwyn")]);
		expect(global.Actor.updateDocuments).not.toHaveBeenCalled();
	});

	it("leaves other actor types unlinked", async () => {
		const npc = actor("a1", "Villager");
		npc.type = "npc";
		npc.prototypeToken = { actorLink: false };
		await linkCharacterPrototypes([npc]);
		expect(global.Actor.updateDocuments).not.toHaveBeenCalled();
	});
});

describe("repairCharacterTokenLinks", () => {
	it("links the unchanged tokens silently and hands back only the drifted ones", async () => {
		const base = actor("a1", "Torwyn");
		const clean   = token({ id: "t1", baseActor: base });
		const drifted = token({ id: "t2", baseActor: base, delta: delta({ system: { attributes: { xp: { value: 11 } } } }) });
		global.game.scenes = [scene("The Commons", [clean, drifted])];
		global.game.actors = [];

		const left = await repairCharacterTokenLinks();

		expect(clean.update).toHaveBeenCalledWith({ actorLink: true });
		expect(drifted.update).not.toHaveBeenCalled();
		expect(left.map(row => row.token)).toEqual([drifted]);
	});

	it("does not let one token's failure abandon the rest of the sweep", async () => {
		const base = actor("a1", "Torwyn");
		const bad  = token({ id: "t1", baseActor: base, update: vi.fn(async () => { throw new Error("no"); }) });
		const good = token({ id: "t2", baseActor: base });
		global.game.scenes = [scene("s", [bad, good])];
		await expect(repairCharacterTokenLinks()).resolves.toEqual([]);
		expect(good.update).toHaveBeenCalledWith({ actorLink: true });
	});
});

describe("applyLinkChoices", () => {
	const rows = (...toks) => toks.map(t => ({ token: t, base: actor("a1", "Torwyn"), scene: { name: "s" } }));

	it("counts a deliberate 'leave' apart from a failure, because they mean opposite things", async () => {
		const leave = token({ id: "t1" });
		const boom  = token({ id: "t2", update: vi.fn(async () => { throw new Error("no"); }) });
		const list  = rows(leave, boom);
		const result = await applyLinkChoices(list, new Map([
			[leave.uuid, "leave"],
			[boom.uuid,  "sheet"],
		]));
		// `left` closes the sweep — the GM has ruled. `failed` reopens it.
		expect(result).toEqual({ linked: 0, left: 1, failed: 1 });
		expect(leave.update).not.toHaveBeenCalled();
	});

	it("treats an answer nobody gave as unfinished, never as 'do nothing forever'", async () => {
		const list = rows(token({ id: "t1" }));
		expect(await applyLinkChoices(list, new Map())).toEqual({ linked: 0, left: 0, failed: 1 });
	});

	it("links a row either way it was answered", async () => {
		const keepSheet = token({ id: "t1" });
		const list = rows(keepSheet);
		const result = await applyLinkChoices(list, new Map([[keepSheet.uuid, "sheet"]]));
		expect(result).toEqual({ linked: 1, left: 0, failed: 0 });
		expect(keepSheet.update).toHaveBeenCalledWith({ actorLink: true });
	});
});

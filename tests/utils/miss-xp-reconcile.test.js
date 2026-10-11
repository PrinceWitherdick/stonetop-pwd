import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reconcileMissXp, markMissXpByChoice } from "../../module/utils/roll-engine.js";
import { pressRollCard } from "../../module/utils/roll-card-writer.js";
import {
	XP_MARK_FLAG, XP_UNDONE_FLAG, XP_MARK_FOR_FLAG, MISS_XP_FLAG, MISS_XP_STATE_FLAG, MISS_XP_ACTOR_FLAG,
	MISS_XP_BY_CHOICE_FLAG, MISS_XP_CHOICE_FLAG, KNOW_THINGS_XP_FLAG, liveMissReceipt, missXpChoice,
} from "../../module/utils/undo-xp-mark.js";
import { deletionTarget } from "../../module/utils/foundry-compat.js";
import { ROLLED_FLAG } from "../../module/utils/counted-tier.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { readRepo } from "../fakes/css.js";

// "On a miss, mark XP" follows the total a roll card ends on (the user's ruling, 2026-09-30): a Burn
// Brightly or a Shift that lifts a 6- to a 7+ takes the miss's XP back, one that brings a 7+ down to
// a 6- marks it. Only on a card whose miss earns XP.

const flush = () => new Promise(resolve => setImmediate(resolve));

function fakeMessage(id, flags) {
	return {
		id,
		flags,
		getFlag: (scope, key) => (scope === SYSTEM_ID ? flags[key] : undefined),
		setFlag: vi.fn(async (scope, key, value) => { flags[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete flags[key]; }),
		// A batch of this system's flags, set or deleted (`flags.<scope>.<key>`, either deletion spelling).
		update: vi.fn(async data => {
			for (const [path, value] of Object.entries(data)) {
				const gone = deletionTarget(path, value);
				const key = (gone ?? path).slice(`flags.${SYSTEM_ID}.`.length);
				if (gone) delete flags[key];
				else flags[key] = value;
			}
		}),
	};
}

let messages, actor;
beforeEach(() => {
	messages = [];
	actor = {
		name: "Torwyn", uuid: "Actor.a1", type: "character", isOwner: true,
		system: { attributes: { xp: { value: 10 }, level: { value: 1 } } },
		update: vi.fn(async (data) => { await flush(); actor.system.attributes.xp.value = data["system.attributes.xp.value"]; }),
	};
	global.game = {
		user: { isGM: true }, actors: { get: () => actor },
		messages: { get contents() { return messages; } },
		settings: { get: () => "publicroll" },
	};
	global.ChatMessage = {
		getSpeaker: () => ({ actor: "a1" }),
		create: vi.fn(async (data) => { const m = fakeMessage(`r${messages.length}`, { ...data.flags[SYSTEM_ID] }); messages.push(m); return m; }),
	};
	global.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
});
afterEach(() => { delete global.game; delete global.ChatMessage; delete global.ui; });

const card = (extra = {}) => fakeMessage("c1", { [MISS_XP_FLAG]: true, [ROLLED_FLAG]: { move: "Defy Danger" }, ...extra });
const receiptFor = (cardId, extra = {}) => {
	const r = fakeMessage(`r${messages.length}`, { [XP_MARK_FLAG]: 1, [XP_MARK_FOR_FLAG]: cardId, ...extra });
	messages.push(r);
	return r;
};

describe("reconcileMissXp", () => {
	it("takes the miss's XP back when the card is lifted to a 7+", async () => {
		const c = card();
		const r = receiptFor("c1");
		await reconcileMissXp(c, 7, { actor });
		expect(actor.system.attributes.xp.value).toBe(9);
		expect(r.flags[XP_UNDONE_FLAG]).toBe(true);
		expect(liveMissReceipt(c)).toBeNull();
	});

	it("marks XP with a receipt of its own when the card is brought down to a 6-", async () => {
		const c = card();
		await reconcileMissXp(c, 6, { actor });
		expect(actor.system.attributes.xp.value).toBe(11);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(liveMissReceipt(c)?.flags[XP_MARK_FOR_FLAG]).toBe("c1");
	});

	it("does nothing when the card stays on the same side of the line", async () => {
		const c = card();
		receiptFor("c1");
		await reconcileMissXp(c, 5, { actor });
		const hit = fakeMessage("c3", { [MISS_XP_FLAG]: true, [ROLLED_FLAG]: { move: "Defy Danger" } });
		await reconcileMissXp(hit, 8, { actor });
		expect(actor.system.attributes.xp.value).toBe(10);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("follows the card back and forth, one receipt standing at a time", async () => {
		const c = card();
		receiptFor("c1");
		await reconcileMissXp(c, 7, { actor });   // up: taken back
		await reconcileMissXp(c, 6, { actor });   // down: marked again
		expect(actor.system.attributes.xp.value).toBe(10);
		expect(messages.filter(m => !m.flags[XP_UNDONE_FLAG])).toHaveLength(1);
	});

	it("leaves a card alone whose miss earns no XP, or a non-character's", async () => {
		const noXp = fakeMessage("c2", { [ROLLED_FLAG]: { move: "Death's Door" } });
		await reconcileMissXp(noXp, 6, { actor });
		await reconcileMissXp(card(), 6, { actor: { ...actor, type: "npc" } });
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("reads the tier the card COUNTS as: a 6- treated as a 7-9 is no miss", async () => {
		const c = card({ [ROLLED_FLAG]: { move: "Herd", missCountsAsPartial: true } });
		await reconcileMissXp(c, 6, { actor });
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("only counts a receipt marked for this card", async () => {
		receiptFor("other");
		expect(liveMissReceipt(card())).toBeNull();
	});

	// A receipt its player undid by hand is a waiver: a rewrite that leaves the card on a miss (a +1 from 5
	// to 6, a Shift Down) used to read "no live receipt" as "never marked" and mark the XP again.
	it("does not mark again a miss its player undid by hand", async () => {
		const c = card({ [MISS_XP_STATE_FLAG]: "waived" });
		receiptFor("c1", { [XP_UNDONE_FLAG]: true });
		await reconcileMissXp(c, 6, { actor });
		expect(actor.system.attributes.xp.value).toBe(10);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("reads an undone receipt on a card still recording the mark as undone by hand", async () => {
		const c = card({ [MISS_XP_STATE_FLAG]: "marked" });
		receiptFor("c1", { [XP_UNDONE_FLAG]: true });
		await reconcileMissXp(c, 5, { actor });
		await reconcileMissXp(c, 8, { actor });
		expect(actor.system.attributes.xp.value).toBe(10);
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	// A deleted receipt: the XP it marked is still held, as the card records.
	it("takes back a miss whose receipt was deleted, and does not mark it twice", async () => {
		const c = card({ [MISS_XP_STATE_FLAG]: "marked" });
		await reconcileMissXp(c, 5, { actor });
		expect(ChatMessage.create).not.toHaveBeenCalled();
		await reconcileMissXp(c, 7, { actor });
		expect(actor.system.attributes.xp.value).toBe(9);
		expect(c.flags[MISS_XP_STATE_FLAG]).toBe("none");
	});

	// A GM's turn landing after the roller's fallback has marked: the card already says so.
	it("records the mark on the card, so a second writer marks nothing", async () => {
		const c = card();
		await reconcileMissXp(c, 5, { actor });
		expect(c.flags[MISS_XP_STATE_FLAG]).toBe("marked");
		messages.length = 0;   // the receipt not yet arrived on the second client
		await reconcileMissXp(c, 5, { actor });
		expect(actor.system.attributes.xp.value).toBe(11);
	});

	// Never at a Loss's "Mark XP" (and a steading roll's button): taken back when lifted, never marked here.
	it("takes a chosen mark back when the card is lifted, and opens the choice again", async () => {
		const c = card({ [MISS_XP_BY_CHOICE_FLAG]: true, [MISS_XP_STATE_FLAG]: "marked", [MISS_XP_CHOICE_FLAG]: "mark" });
		receiptFor("c1");
		await reconcileMissXp(c, 10, { actor });
		expect(actor.system.attributes.xp.value).toBe(9);
		for (const key of [MISS_XP_FLAG, MISS_XP_BY_CHOICE_FLAG, MISS_XP_STATE_FLAG, MISS_XP_CHOICE_FLAG]) expect(c.flags[key]).toBeUndefined();
		expect(missXpChoice(c)).toBeNull();
		await reconcileMissXp(c, 5, { actor });
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	// A card latched under the old Know Things-only name still reads as chosen, and is opened again the same way.
	it("reads and clears an old card's Know Things latch", async () => {
		const c = card({ [MISS_XP_STATE_FLAG]: "marked", [KNOW_THINGS_XP_FLAG]: "mark" });
		expect(missXpChoice(c)).toBe("mark");
		await reconcileMissXp(c, 5, { actor });
		expect(ChatMessage.create).not.toHaveBeenCalled();
		receiptFor("c1");
		await reconcileMissXp(c, 10, { actor });
		expect(actor.system.attributes.xp.value).toBe(9);
		expect(c.flags[KNOW_THINGS_XP_FLAG]).toBeUndefined();
		expect(missXpChoice(c)).toBeNull();
	});

	// The engine names no move: a button row's latch is the generic choice flag, read in undo-xp-mark.js.
	it("leaves the Know Things latch to undo-xp-mark.js", () => {
		expect(readRepo("module/utils/roll-engine.js")).not.toMatch(/KNOW_THINGS|knowThingsXp/);
		expect(readRepo("stonetop.js")).not.toMatch(/KNOW_THINGS_XP_FLAG|"knowThingsXp"/);
	});

	it("reads the new latch before the old one, and nothing from a card without either", () => {
		expect(missXpChoice(card({ [MISS_XP_CHOICE_FLAG]: "decline", [KNOW_THINGS_XP_FLAG]: "mark" }))).toBe("decline");
		expect(missXpChoice(card())).toBeNull();
		expect(missXpChoice(null)).toBeNull();
	});

	it("never marks a by-choice card on its own when it is brought down to a miss", async () => {
		const c = card({ [MISS_XP_BY_CHOICE_FLAG]: true });
		await reconcileMissXp(c, 5, { actor });
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	// A steading roll is spoken by the steading: its XP is the character the button named.
	it("follows the character a button named, whoever speaks the card", async () => {
		const other = { ...actor, uuid: "Actor.b2", id: "b2", system: { attributes: { xp: { value: 4 }, level: { value: 1 } } } };
		other.update = vi.fn(async data => { other.system.attributes.xp.value = data["system.attributes.xp.value"]; });
		global.game.actors.get = id => (id === "b2" ? other : actor);
		const c = card({ [MISS_XP_BY_CHOICE_FLAG]: true, [MISS_XP_ACTOR_FLAG]: "b2", [MISS_XP_STATE_FLAG]: "marked" });
		receiptFor("c1");
		await reconcileMissXp(c, 8, { actor: { type: "steading" } });
		expect(other.system.attributes.xp.value).toBe(3);
		expect(actor.system.attributes.xp.value).toBe(10);
	});
});

describe("markMissXpByChoice", () => {
	it("stamps the card, then posts the receipt tied to it", async () => {
		const c = Object.assign(fakeMessage("c9", {}), { author: { id: "p1" } });
		await markMissXpByChoice(c, actor, "Know Things");
		expect(c.flags).toMatchObject({ [MISS_XP_FLAG]: true, [MISS_XP_BY_CHOICE_FLAG]: true, [MISS_XP_STATE_FLAG]: "marked" });
		expect(c.flags[MISS_XP_ACTOR_FLAG]).toBeUndefined();
		expect(ChatMessage.create.mock.calls[0][0]).toMatchObject({ author: "p1", flags: { [SYSTEM_ID]: { [XP_MARK_FOR_FLAG]: "c9" } } });
		expect(actor.system.attributes.xp.value).toBe(11);
	});

	it("names the character when asked to, and takes the stamps off if the mark fails", async () => {
		const c = fakeMessage("c9", {});
		await markMissXpByChoice(c, { ...actor, id: "a1" }, "Muster", { naming: true });
		expect(c.flags[MISS_XP_ACTOR_FLAG]).toBe("a1");
		const d = fakeMessage("d9", {});
		ChatMessage.create.mockRejectedValueOnce(new Error("nope"));
		await expect(markMissXpByChoice(d, actor, "Muster", { naming: true })).rejects.toThrow("nope");
		expect(d.flags).toEqual({});
	});
});

// The roll's own miss is marked on the card's writer, in the card's turn, where rewrites run too.
describe("the roll's miss mark, pressed on the card's writer", () => {
	const gmUser = { id: "gm", isGM: true };
	const rolled = (total) => Object.assign(card(), { rolls: [{ total }], speaker: { actor: "a1" } });
	beforeEach(() => {
		actor.testUserPermission = () => true;
		global.canvas = { tokens: { get: () => null } };
	});
	afterEach(() => { delete global.canvas; });

	// The roller's mode APPLIED to the receipt: as a create-data key core ignores it, and a Private GM
	// miss announced itself to the whole table on its receipt.
	it("marks the miss once, with the roller's roll mode applied", async () => {
		ChatMessage.applyRollMode = vi.fn((data, mode) => { if (mode === "gmroll") data.whisper = ["gm"]; });
		const c = rolled(5);
		await pressRollCard(c, "missXp", { rollMode: "gmroll" }, { user: gmUser, gm: null });
		await pressRollCard(c, "missXp", { rollMode: "gmroll" }, { user: gmUser, gm: null });
		expect(actor.system.attributes.xp.value).toBe(11);
		expect(ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(ChatMessage.create.mock.calls[0][0].whisper).toEqual(["gm"]);
	});

	it("whispers the receipt to whoever the roll card was whispered to, blind if it was", async () => {
		ChatMessage.applyRollMode = vi.fn();
		const c = Object.assign(rolled(5), { whisper: ["gm", "p1"], blind: true });
		global.game.messages.get = id => (id === c.id ? c : messages.find(m => m.id === id) ?? null);
		await pressRollCard(c, "missXp", { rollMode: "publicroll" }, { user: gmUser, gm: null });
		expect(ChatMessage.create.mock.calls[0][0]).toMatchObject({ whisper: ["gm", "p1"], blind: true });
		expect(ChatMessage.applyRollMode).not.toHaveBeenCalled();
	});

	it("marks nothing when a rewrite lifted the card off the miss first", async () => {
		await pressRollCard(rolled(7), "missXp", {}, { user: gmUser, gm: null });
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("refuses a user who does not play the character", async () => {
		actor.testUserPermission = () => false;
		expect(await pressRollCard(rolled(5), "missXp", {}, { user: gmUser, gm: null })).toBeNull();
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});
});

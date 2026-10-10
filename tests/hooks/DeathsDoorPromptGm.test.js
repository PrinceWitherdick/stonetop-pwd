import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	dyingCardGmOptions, markDyingByFiat, markNotLethal, postDyingPrompt, wireDyingPrompt,
} from "../../module/hooks/DeathsDoorPrompt.js";
import { DEATHS_DOOR_STATE } from "../../module/actors/character/deaths-door.js";

// Audit DD-4: the GM's two rulings on the dying card, which only hit points could make before. "If the source of
// damage isn't likely to kill anyone, then the PC is simply out of the action" (Book I p.240), and "they might also
// be dying because the fiction demands it" (p.245), which a character already at 0 HP could never reach: a lethal
// blow at 0 HP writes no new hit points. And audit DD-7: the card's own words come from the language file.

const SCOPE = "stonetop-pwd";

function pc({ hp = 0, flags = {} } = {}) {
	const actor = {
		id: "pc-1", uuid: "Actor.pc-1", name: "Blodwen", type: "character", isOwner: true,
		system: { attributes: { hp: { value: hp } } },
		flags: { [SCOPE]: { ...flags } },
		update: vi.fn(async () => {}),
	};
	return actor;
}

// The few DOM surfaces wireDyingPrompt touches: the card's own button, its button row, and buttons made for it.
function element(props = {}) {
	const listeners = {};
	return {
		dataset: {}, disabled: false, innerHTML: "", className: "", ...props, listeners,
		addEventListener: (type, fn) => { listeners[type] = fn; },
	};
}
function dyingCardDom(actor) {
	const open = element({ className: "stonetop-dying-btn stonetop-dying-open", dataset: { actor: actor.uuid } });
	const added = [];
	const row = {
		added,
		appendChild: el => added.push(el),
		querySelector: sel => (sel === ".stonetop-dying-gm" ? added.find(el => el.className.includes("stonetop-dying-gm")) ?? null : null),
	};
	const root = {
		ownerDocument: { createElement: () => element() },
		querySelector: sel => (sel.includes(".stonetop-dying-open") ? open : sel === ".stonetop-dying-actions" ? row : null),
	};
	return { root, open, row };
}

let saved;
beforeEach(() => {
	saved = { user: game.user };
	global.ChatMessage = { create: vi.fn(async d => d), getSpeaker: () => ({}) };
});
afterEach(() => {
	game.user = saved.user;
	delete global.ChatMessage;
	delete global.fromUuidSync;
});

describe("dyingCardGmOptions: what the GM may rule from the dying card", () => {
	it("calls off a dying character, and sends one at 0 HP with nothing owed to the Door", () => {
		expect(dyingCardGmOptions({ hp: 0, state: DEATHS_DOOR_STATE.DYING })).toEqual({ notLethal: true, markDying: false });
		expect(dyingCardGmOptions({ hp: 0, state: DEATHS_DOOR_STATE.OUT_OF_ACTION })).toEqual({ notLethal: false, markDying: true });
		expect(dyingCardGmOptions({ hp: 0, state: null })).toEqual({ notLethal: false, markDying: true });
	});

	// Re-check DS-1: Undying and Tethered trigger "When you are reduced to 0 HP" (p.150, p.148), lethal or not;
	// Dark Succor's "When you are dying or killed outright" (p.152) asks, as Death's Door does.
	it("calls off only a move whose trigger asks whether the blow could kill", () => {
		const dying = { hp: 0, state: DEATHS_DOOR_STATE.DYING };
		expect(dyingCardGmOptions({ ...dying, insertSlug: "thrall" }).notLethal).toBe(true);
		expect(dyingCardGmOptions({ ...dying, insertSlug: "revenant" }).notLethal).toBe(false);
		expect(dyingCardGmOptions({ ...dying, insertSlug: "ghost" }).notLethal).toBe(false);
		// A homebrew insert falls back to Death's Door (zeroHpMove), and so does the ruling.
		expect(dyingCardGmOptions({ ...dying, insertSlug: "homebrew" }).notLethal).toBe(true);
	});

	it("offers neither to someone standing, owing a fate, or dead", () => {
		expect(dyingCardGmOptions({ hp: 3, state: null })).toEqual({ notLethal: false, markDying: false });
		expect(dyingCardGmOptions({ hp: 0, state: DEATHS_DOOR_STATE.FATE_PENDING })).toEqual({ notLethal: false, markDying: false });
		expect(dyingCardGmOptions({ hp: 0, state: DEATHS_DOOR_STATE.DEAD })).toEqual({ notLethal: false, markDying: false });
	});
});

describe("markNotLethal: out of the action, with no Door to face", () => {
	it("writes out of the action and ends any roll under way, in one write naming the move, and tells the table", async () => {
		const actor = pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.DYING, deathsDoorRolling: { userId: "p1", nonce: "n" } } });

		expect(await markNotLethal(actor)).toBe(true);

		expect(actor.update).toHaveBeenCalledTimes(1);
		const [data, options] = actor.update.mock.calls[0];
		expect(data).toMatchObject({ [`flags.${SCOPE}.deathsDoor`]: DEATHS_DOOR_STATE.OUT_OF_ACTION, [`flags.${SCOPE}.-=deathsDoorRolling`]: null });
		expect(options).toEqual({ stonetopMove: "Death's Door" });
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("is out of the action, not dying");
	});

	it("writes nothing for a dying Revenant or Ghost, whose move triggers at 0 HP lethal or not", async () => {
		for (const slug of ["revenant", "ghost"]) {
			const actor = pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.DYING, postDeathInsert: { slug } } });
			expect(await markNotLethal(actor)).toBe(false);
			expect(actor.update).not.toHaveBeenCalled();
		}
		expect(ChatMessage.create).not.toHaveBeenCalled();
	});

	it("calls off a dying Thrall's Dark Succor", async () => {
		const actor = pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.DYING, postDeathInsert: { slug: "thrall" } } });
		expect(await markNotLethal(actor)).toBe(true);
		expect(actor.update.mock.calls[0][0]).toMatchObject({ [`flags.${SCOPE}.deathsDoor`]: DEATHS_DOOR_STATE.OUT_OF_ACTION });
	});

	it("writes nothing for someone who is not dying", async () => {
		const actor = pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION } });
		expect(await markNotLethal(actor)).toBe(false);
		expect(actor.update).not.toHaveBeenCalled();
	});
});

describe("markDyingByFiat: sent to the Door at 0 HP", () => {
	it("writes dying, naming the move, and drops a Hard to Kill trade the last brush left open", async () => {
		const actor = pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.OUT_OF_ACTION, hardToKillTrade: true } });

		expect(await markDyingByFiat(actor)).toBe(true);

		const [data, options] = actor.update.mock.calls[0];
		expect(data).toMatchObject({ [`flags.${SCOPE}.deathsDoor`]: DEATHS_DOOR_STATE.DYING, [`flags.${SCOPE}.-=hardToKillTrade`]: null });
		expect(options).toEqual({ stonetopMove: "Death's Door" });
	});

	it("writes nothing above 0 HP, or for someone already dying or dead", async () => {
		for (const actor of [
			pc({ hp: 4 }),
			pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.DYING } }),
			pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.DEAD } }),
		]) {
			expect(await markDyingByFiat(actor)).toBe(false);
			expect(actor.update).not.toHaveBeenCalled();
		}
	});
});

describe("the dying card", () => {
	it("draws the GM's two buttons on the GM's client, each live only while its ruling applies", async () => {
		const actor = pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.DYING } });
		global.fromUuidSync = () => actor;
		game.user = { id: "gm", isGM: true };
		const { root, row } = dyingCardDom(actor);

		wireDyingPrompt({}, root);

		expect(row.added.map(b => b.className)).toEqual([
			"stonetop-dying-btn stonetop-dying-gm stonetop-dying-not-lethal",
			"stonetop-dying-btn stonetop-dying-gm stonetop-dying-mark",
		]);
		const [notLethal, mark] = row.added;
		expect(notLethal.innerHTML).toContain("Not lethal: out of the action");
		expect(mark.innerHTML).toContain("Mark dying");
		expect([notLethal.disabled, mark.disabled]).toEqual([false, true]);

		await notLethal.listeners.click();
		expect(actor.update.mock.calls[0][0]).toMatchObject({ [`flags.${SCOPE}.deathsDoor`]: DEATHS_DOOR_STATE.OUT_OF_ACTION });
	});

	it("draws the not-lethal button disabled on a dying Revenant's card", () => {
		const actor = pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.DYING, postDeathInsert: { slug: "revenant" } } });
		global.fromUuidSync = () => actor;
		game.user = { id: "gm", isGM: true };
		const { root, row } = dyingCardDom(actor);

		wireDyingPrompt({}, root);

		expect(row.added[0].className).toContain("stonetop-dying-not-lethal");
		expect(row.added[0].disabled).toBe(true);
	});

	it("draws neither for a player", () => {
		const actor = pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.DYING } });
		global.fromUuidSync = () => actor;
		game.user = { id: "p1", isGM: false };
		const { root, row } = dyingCardDom(actor);

		wireDyingPrompt({}, root);

		expect(row.added).toEqual([]);
	});

	it("says what it says in the language file's words", async () => {
		const actor = pc({ flags: { deathsDoor: DEATHS_DOOR_STATE.DYING } });
		await postDyingPrompt(actor);
		const { content } = ChatMessage.create.mock.calls[0][0];
		expect(content).toContain(game.i18n.localize("stonetop.specialMoves.deathsDoor.button"));
		expect(content).toContain(game.i18n.format("stonetop.specialMoves.deathsDoor.dyingCard.lead", { name: "Blodwen" }));
	});
});

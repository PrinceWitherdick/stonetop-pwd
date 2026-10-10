import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import {
	inspirationForTier, inspirationHeld, heldAfterSpeech, holdInspiration, spendInspiration, inBattle, canKeepOneHp,
	speechRollOptions, inspirationChip, INSPIRATION_FLAG, WE_HAPPY_FEW,
} from "../../../module/actors/character/inspiration.js";
import {
	shareInspiration, handleInspirationQuery, inspireAllies, wireSpeechCard, damageCardKind, inspirationDamageOffer,
	addInspirationDie, inspirationDieNote, wireInspirationDamage, keepOneHp, offerKeepOneHp, onUpdateActorInspirationAtZero,
	actFearlessly, speechGiven, INSPIRATION_QUERY, SPEECH_FLAG, DIE_FLAG, FOLLOWER_BLOW_FLAG,
} from "../../../module/actors/character/inspiration-flow.js";
import { readRepo } from "../../fakes/css.js";
import { moveRollOptions } from "../../../module/actors/character/move-roll-options.js";

// We Happy Few (the Marshal): "on a 10+, each ally holds 2 Inspiration; on a 7-9, each ally holds 1
// Inspiration; on a 6-, each ally holds 1 ... Once battle is joined, your allies can spend their Inspiration
// at any time, 1-for-1 to: act fearlessly / keep 1 HP instead of being reduced to 0 HP / add 1d6 to a damage
// roll they just made." Built on Piety's Blessing (roll-boosts.test.js).

const SCOPE = "stonetop-pwd";

function pc({ id, name = id, held = 0, moves = [], unlearned = [], owner = true, hp = 5, dying = false, flags = {} } = {}) {
	const store = { ...flags };
	if (held) store[INSPIRATION_FLAG] = held;
	if (dying) store.deathsDoor = "dying";
	const actor = {
		id, uuid: `Actor.${id}`, name, type: "character", isOwner: owner,
		items: moves.map(move => ({ type: "move", name: move, flags: unlearned.includes(move) ? { [SCOPE]: { learned: false } } : {} })),
		system: { attributes: { hp: { value: hp } } },
		flags: { [SCOPE]: store },
		store,
		getFlag: (scope, key) => (scope === SCOPE ? store[key] : undefined),
		setFlag: vi.fn(async (scope, key, value) => { store[key] = value; }),
		unsetFlag: vi.fn(async (scope, key) => { delete store[key]; }),
		testUserPermission: vi.fn(user => !!user?.isGM || user?.id === `u-${id}`),
	};
	actor.typedActor = {
		restoreHp: vi.fn(async (value, _move, { alsoUpdate = {} } = {}) => {
			actor.system.attributes.hp.value = value;
			delete store.deathsDoor;
			for (const [path, v] of Object.entries(alsoUpdate)) store[path.split(".").at(-1)] = v;
			return true;
		}),
	};
	return actor;
}

const fighting = (...actors) => [{ combatants: actors.map(a => ({ actor: { id: a.id } })) }];
const player = id => ({ id: `u-${id}`, isGM: false });
const GM = { id: "u-gm", isGM: true };
const ownersOf = (online = true) => actor => [
	{ id: `u-${actor.id}`, isGM: false, active: online },
	{ id: "u-gm", isGM: true, active: true },
];

/** A shallow stand-in for ChatMessage#update's merge: nested objects merge, anything else replaces. */
function merge(into, from) {
	for (const [key, value] of Object.entries(from)) {
		if (value && typeof value === "object" && !Array.isArray(value) && into[key] && typeof into[key] === "object") merge(into[key], value);
		else into[key] = value;
	}
}

function message({ flags = {}, flavor = "", rolls = [], author = "u-wren", speaker = null } = {}) {
	const data = { [SCOPE]: { ...flags } };
	const msg = {
		id: "msg1", flavor, rolls, flags: data, speaker,
		getFlag: (scope, key) => data[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { (data[scope] ??= {})[key] = value; }),
		canUserModify: user => !!user?.isGM || user?.id === author,
		update: vi.fn(async update => {
			if (update.flavor !== undefined) msg.flavor = update.flavor;
			if (update.rolls) msg.rolls = update.rolls;
			if (update.flags) merge(data, update.flags);
		}),
	};
	return msg;
}

const PLAIN = `<section class="pbta-chat-card stonetop-roll-card stonetop-damage-roll-card"><div class="card-buttons stonetop-card-buttons"></div></section>`;
const plainCard = (over = {}) => message({ flavor: PLAIN, rolls: [{ total: 6, formula: "1d8+1", terms: [] }], ...over });
const resultsCard = (damage = {}, over = {}) => message({
	flags: { damage: { attackerUuid: "Actor.wren", results: [{ uuid: "T.a", raw: 5 }, { uuid: "T.b", raw: 3 }], applied: [], ...damage } },
	...over,
});

let saved;
beforeEach(() => {
	saved = { user: globalThis.game.user, users: globalThis.game.users, combats: globalThis.game.combats, ChatMessage: globalThis.ChatMessage };
	globalThis.ChatMessage = { create: vi.fn(async data => data), getSpeaker: ({ actor }) => ({ actor: actor?.id }) };
});
afterEach(() => {
	globalThis.game.user = saved.user;
	globalThis.game.users = saved.users;
	globalThis.game.combats = saved.combats;
	globalThis.ChatMessage = saved.ChatMessage;
});

describe("how much a speech gives, and holding it", () => {
	it("gives 2 on a 10+ and 1 on a 7-9 or a 6-", () => {
		expect(inspirationForTier("success")).toBe(2);
		expect(inspirationForTier("partial")).toBe(1);
		expect(inspirationForTier("failure")).toBe(1);
		expect(inspirationForTier("")).toBe(0);
	});

	it("never stacks: a fresh speech holds the new amount, or what is still held if that is more", async () => {
		expect(heldAfterSpeech(0, 2)).toBe(2);
		expect(heldAfterSpeech(2, 1)).toBe(2);
		expect(heldAfterSpeech(1, 2)).toBe(2);
		const wren = pc({ id: "wren" });
		expect(await holdInspiration(wren, 2)).toBe(true);
		expect(await holdInspiration(wren, 2)).toBe(false);
		expect(await holdInspiration(wren, 1)).toBe(false);
		expect(inspirationHeld(wren)).toBe(2);
	});

	it("spends 1-for-1, clearing the flag at 0", async () => {
		const wren = pc({ id: "wren", held: 2 });
		expect(await spendInspiration(wren)).toBe(true);
		expect(inspirationHeld(wren)).toBe(1);
		expect(await spendInspiration(wren)).toBe(true);
		expect(wren.store[INSPIRATION_FLAG]).toBeUndefined();
		expect(await spendInspiration(wren)).toBe(false);
	});

	it("reads an unreadable flag as none", () => {
		expect(inspirationHeld({ getFlag: () => ({}) })).toBe(0);
		expect(inspirationHeld(null)).toBe(0);
	});

	it("counts a character in any combat as having joined battle", () => {
		const wren = pc({ id: "wren" });
		expect(inBattle(wren, fighting(wren))).toBe(true);
		expect(inBattle(wren, fighting(pc({ id: "other" })))).toBe(false);
		expect(inBattle(wren, undefined)).toBe(false);
	});

	it("offers to keep 1 HP only to a holder just reduced to 0 in a fight", () => {
		const down = pc({ id: "wren", held: 1, hp: 0, dying: true });
		expect(canKeepOneHp(down, { combats: fighting(down) })).toBe(true);
		expect(canKeepOneHp(down, { combats: [] })).toBe(false);
		expect(canKeepOneHp(pc({ id: "wren", hp: 0, dying: true }), { combats: fighting(down) })).toBe(false);
		expect(canKeepOneHp(pc({ id: "wren", held: 1, hp: 3 }), { combats: fighting(down) })).toBe(false);
		// Through the Door already (a 7-9 left them at 0 and no longer dying): nothing to keep.
		expect(canKeepOneHp(pc({ id: "wren", held: 1, hp: 0 }), { combats: fighting(down) })).toBe(false);
	});
});

describe("the speech card", () => {
	it("puts a button on every tier for a Marshal with We Happy Few learned", () => {
		const opts = speechRollOptions(pc({ id: "m", moves: [WE_HAPPY_FEW] }));
		expect(Object.keys(opts.tierActions)).toEqual(["success", "partial", "failure"]);
		expect(opts.tierActions.success).toContain("(2 each)");
		expect(opts.tierActions.partial).toContain("(1 each)");
		expect(opts.tierActions.failure).toContain("(1 each)");
		expect(speechRollOptions(pc({ id: "m", moves: [WE_HAPPY_FEW], unlearned: [WE_HAPPY_FEW] }))).toBeNull();
		expect(speechRollOptions({ type: "npc" })).toBeNull();
	});

	it("writes an owned ally here, asks the GM for the rest, and never inspires the Marshal", async () => {
		const marshal = pc({ id: "m", moves: [WE_HAPPY_FEW] });
		const wren = pc({ id: "wren" });
		const bryn = pc({ id: "bryn", owner: false });
		const gm = { query: vi.fn(async () => ["Actor.bryn"]) };
		const { given, missed } = await shareInspiration(marshal, [marshal, wren, bryn], 2, { gm, userId: "u-m" });
		expect(inspirationHeld(wren)).toBe(2);
		expect(inspirationHeld(marshal)).toBe(0);
		expect(gm.query).toHaveBeenCalledWith(INSPIRATION_QUERY,
			{ action: "hold", marshalUuid: "Actor.m", targetUuids: ["Actor.bryn"], amount: 2, userId: "u-m" }, { timeout: 10000 });
		expect(given.map(a => a.name)).toEqual(["wren", "bryn"]);
		expect(missed).toEqual([]);
		const out = await shareInspiration(marshal, [bryn], 1, { gm: null });
		expect(out.missed.map(a => a.name)).toEqual(["bryn"]);
	});

	it("asks who heard it (never the Marshal), and writes what it gave on the card", async () => {
		const marshal = pc({ id: "m", moves: [WE_HAPPY_FEW] });
		const wren = pc({ id: "wren" });
		const aeron = pc({ id: "aeron" });
		const pick = vi.fn(async () => ["wren"]);
		const card = message();
		expect(await inspireAllies(card, marshal, 1, { pick, party: () => [marshal, wren, aeron], share: shareInspiration })).toBe(true);
		expect(pick.mock.calls[0][0].options.map(o => o.id)).toEqual(["wren", "aeron"]);
		expect(pick.mock.calls[0][0].multiple).toBe(true);
		expect(inspirationHeld(wren)).toBe(1);
		expect(inspirationHeld(aeron)).toBe(0);
		expect(card.getFlag(SCOPE, SPEECH_FLAG)).toEqual({ amount: 1, names: ["wren"], given: [{ name: "wren", amount: 1 }] });
	});

	it("keeps who the first press inspired when a Shift Up's second press adds more", async () => {
		const marshal = pc({ id: "m", moves: [WE_HAPPY_FEW] });
		const allies = [pc({ id: "aeron" }), pc({ id: "wren" }), pc({ id: "bryn" })];
		const card = message();
		const party = () => [marshal, ...allies];
		await inspireAllies(card, marshal, 1, { pick: async () => ["aeron", "wren"], party, share: shareInspiration });
		await inspireAllies(card, marshal, 2, { pick: async () => ["bryn", "wren"], party, share: shareInspiration });
		expect(card.getFlag(SCOPE, SPEECH_FLAG)).toEqual({
			amount: 2, names: ["aeron", "wren", "bryn"],
			given: [{ name: "aeron", amount: 1 }, { name: "wren", amount: 2 }, { name: "bryn", amount: 2 }],
		});
		expect(speechGiven({ amount: 1, names: ["Old"] })).toEqual([{ name: "Old", amount: 1 }]);
	});

	it("gives nobody anything when the picker is closed", async () => {
		const marshal = pc({ id: "m" });
		const wren = pc({ id: "wren" });
		const card = message();
		expect(await inspireAllies(card, marshal, 2, { pick: async () => null, party: () => [wren] })).toBe(false);
		expect(inspirationHeld(wren)).toBe(0);
		expect(card.setFlag).not.toHaveBeenCalled();
	});

	describe("its buttons", () => {
		const doc = () => new Window().document;
		function rendered(shared = null) {
			const d = doc();
			const root = d.createElement("div");
			const opts = speechRollOptions(pc({ id: "m", moves: [WE_HAPPY_FEW] }));
			root.innerHTML = `<div class="card-buttons stonetop-roll-tier-actions">${Object.entries(opts.tierActions)
				.map(([tier, html]) => `<div class="stonetop-roll-tier-action" data-tier="${tier}">${html}</div>`).join("")}</div>`;
			const card = message({ flags: shared ? { [SPEECH_FLAG]: shared } : {} });
			return { root, card, button: tier => root.querySelector(`[data-tier="${tier}"] button`) };
		}

		it("are live for whoever may write the card and the Marshal", () => {
			const { root, card, button } = rendered();
			wireSpeechCard(card, root, { marshal: pc({ id: "m" }), usable: true });
			expect(button("success").disabled).toBe(false);
			const other = rendered();
			wireSpeechCard(other.card, other.root, { marshal: pc({ id: "m" }), usable: false });
			expect(other.button("success").disabled).toBe(true);
		});

		it("go once pressed, and come back only for a tier worth more", () => {
			const { root, card, button } = rendered({ amount: 1, names: ["Wren", "Bryn"] });
			wireSpeechCard(card, root, { marshal: pc({ id: "m" }), usable: true });
			expect(button("partial").disabled).toBe(true);
			expect(button("partial").classList.contains("is-chosen")).toBe(true);
			expect(button("success").disabled).toBe(false);
			expect(root.querySelector(".stonetop-inspiration-readout").textContent).toContain("Wren & Bryn");
		});

		it("name each amount given when a second press added to the first", () => {
			const { root, card } = rendered({ amount: 2, names: ["Aeron", "Bryn"], given: [{ name: "Aeron", amount: 1 }, { name: "Bryn", amount: 2 }] });
			wireSpeechCard(card, root, { marshal: pc({ id: "m" }), usable: true });
			expect(root.querySelector(".stonetop-inspiration-readout").textContent)
				.toBe("Inspired: Bryn (2 Inspiration each). Inspired: Aeron (1 Inspiration each).");
		});
	});

	describe("the GM's side of a relayed speech", () => {
		beforeEach(() => {
			globalThis.game.user = GM;
			globalThis.game.users = { activeGM: GM, get: id => [player("m"), player("wren")].find(u => u.id === id) ?? null };
		});
		const ask = (marshal, targets, userId, amount = 2) => handleInspirationQuery(
			{ action: "hold", marshalUuid: marshal.uuid, targetUuids: targets.map(t => t.uuid), amount, userId }, {},
			{ resolve: uuid => [marshal, ...targets].find(a => a.uuid === uuid) ?? null },
		);

		it("inspires each named ally for the Marshal's player, and for nobody else", async () => {
			const marshal = pc({ id: "m", moves: [WE_HAPPY_FEW] });
			const bryn = pc({ id: "bryn", owner: false });
			expect(await ask(marshal, [bryn], "u-wren")).toEqual([]);
			expect(inspirationHeld(bryn)).toBe(0);
			expect(await ask(marshal, [bryn], "u-m")).toEqual(["Actor.bryn"]);
			expect(inspirationHeld(bryn)).toBe(2);
		});

		it("refuses a Marshal without the move learned, and an amount the move never gives", async () => {
			const bryn = pc({ id: "bryn", owner: false });
			expect(await ask(pc({ id: "m", moves: [WE_HAPPY_FEW], unlearned: [WE_HAPPY_FEW] }), [bryn], "u-m")).toEqual([]);
			expect(await ask(pc({ id: "m", moves: [WE_HAPPY_FEW] }), [bryn], "u-m", 5)).toEqual([]);
			expect(inspirationHeld(bryn)).toBe(0);
		});
	});
});

describe("+1d6 on a damage roll they just made", () => {
	const offer = (card, wren, { user = player("wren"), combats = fighting(wren), online = true } = {}) =>
		inspirationDamageOffer(card, { user, combats, holderOf: () => wren, ownersOf: ownersOf(online), scope: SCOPE });

	it("reads which kind of damage card it is", () => {
		expect(damageCardKind(plainCard())).toBe("plain");
		expect(damageCardKind(resultsCard())).toBe("results");
		expect(damageCardKind(message({ flavor: "<section class=\"stonetop-roll-card\"></section>", rolls: [{}] }))).toBeNull();
	});

	it("is offered on the holder's own damage card, in a fight, to their player", () => {
		const wren = pc({ id: "wren", held: 1 });
		expect(offer(plainCard(), wren)).toMatchObject({ holder: wren, held: 1, kind: "plain" });
		expect(offer(resultsCard(), wren)).toMatchObject({ kind: "results" });
		expect(offer(plainCard(), wren, { user: player("bryn") })).toBeNull();
		expect(offer(plainCard(), wren, { user: GM })).toBeNull();
		expect(offer(plainCard(), wren, { user: GM, online: false })).not.toBeNull();
	});

	it("is not offered with none held, out of a fight, or once taken", () => {
		expect(offer(plainCard(), pc({ id: "wren" }))).toBeNull();
		const wren = pc({ id: "wren", held: 1 });
		expect(offer(plainCard(), wren, { combats: [] })).toBeNull();
		expect(offer(plainCard({ flags: { [DIE_FLAG]: { amount: 3 } } }), wren)).toBeNull();
		expect(offer(plainCard(), { type: "npc" })).toBeNull();
	});

	it("is not offered on a follower's blow, a blow taken, someone else's blow, or once applied", () => {
		const wren = pc({ id: "wren", held: 1 });
		expect(offer(plainCard({ flags: { [FOLLOWER_BLOW_FLAG]: true } }), wren)).toBeNull();
		expect(offer(resultsCard({}, { flags: { damage: resultsCard().getFlag(SCOPE, "damage"), [FOLLOWER_BLOW_FLAG]: true } }), wren)).toBeNull();
		expect(offer(resultsCard({ groupBlow: true }), wren)).toBeNull();
		expect(offer(resultsCard({ selfHarm: true }), wren)).toBeNull();
		expect(offer(resultsCard({ attackerUuid: "Actor.other" }), wren)).toBeNull();
		expect(offer(resultsCard({ applied: [{ uuid: "T.a" }] }), wren)).toBeNull();
	});

	it("adds the die to a plain card's roll and total, spends 1, and only once", async () => {
		const wren = pc({ id: "wren", held: 2 });
		const card = plainCard();
		const before = card.rolls[0];
		const addDie = vi.fn(async (roll, n) => { roll.total += n; roll.formula += ` + ${n}`; });
		const cardFlavor = vi.fn((flavor, total) => `${flavor}<!--${total}-->`);
		expect(await addInspirationDie(card, wren, { rollDie: async () => 4, addDie, cardFlavor, scope: SCOPE })).toBe(true);
		expect(addDie.mock.calls[0][1]).toBe(4);
		expect(addDie.mock.calls[0][0]).not.toBe(before);
		expect(card.rolls[0].total).toBe(10);
		expect(card.flavor).toContain("<!--10-->");
		expect(card.getFlag(SCOPE, DIE_FLAG)).toEqual({ by: "Actor.wren", name: "wren", amount: 4 });
		expect(inspirationHeld(wren)).toBe(1);
		expect(inspirationDieNote(card.getFlag(SCOPE, DIE_FLAG))).toBe("+1d6 Inspiration (wren): 4");
		expect(await addInspirationDie(card, wren, { rollDie: async () => 4, addDie, cardFlavor, scope: SCOPE })).toBe(false);
		expect(inspirationHeld(wren)).toBe(1);
	});

	it("adds the die to every row of a results card, and never after Apply", async () => {
		const wren = pc({ id: "wren", held: 1 });
		const card = resultsCard();
		expect(await addInspirationDie(card, wren, { rollDie: async () => 2, scope: SCOPE })).toBe(true);
		expect(card.getFlag(SCOPE, "damage").results.map(r => r.raw)).toEqual([7, 5]);
		expect(card.getFlag(SCOPE, "damage").attackerUuid).toBe("Actor.wren");
		const applied = resultsCard({ applied: [{ uuid: "T.a" }] });
		const bryn = pc({ id: "wren", held: 1 });
		expect(await addInspirationDie(applied, bryn, { rollDie: async () => 2, scope: SCOPE })).toBe(false);
		expect(inspirationHeld(bryn)).toBe(1);
	});

	it("gives the Inspiration back when the card cannot take the die", async () => {
		const wren = pc({ id: "wren", held: 1 });
		const card = plainCard();
		card.update = vi.fn(async () => { throw new Error("gone"); });
		await expect(addInspirationDie(card, wren, { rollDie: async () => 4, addDie: async () => {}, scope: SCOPE }))
			.rejects.toThrow("gone");
		expect(inspirationHeld(wren)).toBe(1);
		const failing = plainCard();
		await expect(addInspirationDie(failing, wren, { rollDie: async () => { throw new Error("dice"); }, scope: SCOPE }))
			.rejects.toThrow("dice");
		expect(inspirationHeld(wren)).toBe(1);
	});

	// The die goes on a copy of the card's roll: a refused write leaves the card's own roll as it was, so
	// the press after the refund adds one die, not a second on top of a first nobody saw.
	it("leaves the card's roll untouched when the write is refused", async () => {
		const wren = pc({ id: "wren", held: 1 });
		const card = plainCard();
		const update = card.update;
		card.update = vi.fn(async () => { throw new Error("refused"); });
		const addDie = async (roll, n) => { roll.total += n; roll.terms.push(n); };
		await expect(addInspirationDie(card, wren, { rollDie: async () => 4, addDie, scope: SCOPE })).rejects.toThrow("refused");
		expect(card.rolls[0]).toEqual({ total: 6, formula: "1d8+1", terms: [] });

		card.update = update;
		expect(await addInspirationDie(card, wren, { rollDie: async () => 4, addDie, scope: SCOPE })).toBe(true);
		expect(card.rolls[0].total).toBe(10);
		expect(card.rolls[0].terms).toEqual([4]);
	});

	describe("on the card", () => {
		beforeEach(() => {
			globalThis.game.users = { contents: [player("wren"), GM], activeGM: GM };
			globalThis.game.combats = fighting({ id: "wren" });
		});

		it("draws the button in the card's row for the holder's player, and the die once taken", () => {
			const wren = pc({ id: "wren", held: 1 });
			wren.testUserPermission = user => !!user?.isGM || user?.id === "u-wren";
			const d = new Window().document;
			const root = d.createElement("div");
			root.innerHTML = PLAIN;
			wireInspirationDamage(plainCard(), root, { holderOf: () => wren }, { user: player("wren") });
			expect(root.querySelector(".stonetop-inspiration-die-btn").textContent).toBe("+1d6 (Inspiration)");

			const taken = d.createElement("div");
			taken.innerHTML = `<div class="card-content"><ul><li class="stonetop-damage-row" data-uuid="T.a"><span class="stonetop-roll-result-number">5</span></li></ul><div class="stonetop-attack-actions"></div></div>`;
			const card = message({ flags: {
				damage: { attackerUuid: "Actor.wren", results: [{ uuid: "T.a", raw: 9 }], applied: [] },
				[DIE_FLAG]: { name: "wren", amount: 4 },
			} });
			wireInspirationDamage(card, taken, { holderOf: () => wren }, { user: player("wren") });
			expect(taken.querySelector(".stonetop-roll-result-number").textContent).toBe("9");
			expect(taken.querySelector(".stonetop-inspiration-note").textContent).toBe("+1d6 Inspiration (wren): 4");
			expect(taken.querySelector(".stonetop-inspiration-die-btn")).toBeNull();
		});
	});

	describe("the GM's side of a relayed die", () => {
		beforeEach(() => {
			globalThis.game.user = GM;
			globalThis.game.users = { activeGM: GM, contents: [player("wren"), GM], get: id => [player("wren"), player("bryn")].find(u => u.id === id) ?? null };
		});

		it("adds it for the holder's player on a card the GM wrote, and for nobody else", async () => {
			const wren = pc({ id: "wren", held: 1 });
			const card = plainCard({ author: "u-gm" });
			const deps = {
				messages: { get: () => card }, resolve: () => wren, holderOf: () => wren, combats: fighting(wren),
				rollDie: async () => 3, addDie: async (roll, n) => { roll.total += n; }, cardFlavor: f => f,
			};
			const data = userId => ({ action: "damage", messageId: "msg1", holderUuid: "Actor.wren", userId });
			expect(await handleInspirationQuery(data("u-bryn"), {}, deps)).toBe(false);
			expect(await handleInspirationQuery(data("u-wren"), {}, deps)).toBe(true);
			expect(card.rolls[0].total).toBe(9);
			expect(inspirationHeld(wren)).toBe(0);
		});
	});
});

describe("keep 1 HP instead of being reduced to 0 HP", () => {
	it("spends 1 and puts them back on 1 HP in Death's Door's own write, and says so", async () => {
		const wren = pc({ id: "wren", held: 2, hp: 0, dying: true });
		expect(await keepOneHp(wren, { combats: fighting(wren) })).toBe(true);
		expect(wren.typedActor.restoreHp).toHaveBeenCalledWith(1, WE_HAPPY_FEW, { clearsDeathsDoor: true, alsoUpdate: {} });
		expect(inspirationHeld(wren)).toBe(1);
		expect(globalThis.ChatMessage.create).toHaveBeenCalled();
		// Up again: nothing left to keep.
		expect(await keepOneHp(wren, { combats: fighting(wren) })).toBe(false);
	});

	it("gives back a Battle Joy the drop ended, since they never dropped", async () => {
		const heavy = pc({ id: "heavy", held: 1, hp: 0, dying: true });
		expect(await keepOneHp(heavy, { battleJoy: true, combats: fighting(heavy) })).toBe(true);
		expect(heavy.store.battleJoy).toBe(true);
		// In the HP's own write, not one of its own.
		expect(heavy.setFlag).not.toHaveBeenCalled();
	});

	it("gives back the Defend Readiness the drop cost, since they never dropped", async () => {
		// The GM's client has already cleared it (combat/readiness-loss.js) by the time they answer.
		const wren = pc({ id: "wren", held: 1, hp: 0, dying: true, flags: { readiness: 0 } });
		expect(await keepOneHp(wren, { readiness: 2, combats: fighting(wren) })).toBe(true);
		expect(wren.store.readiness).toBe(2);
		expect(globalThis.ChatMessage.create.mock.calls.at(-1)[0].content).toMatch(/keptReadiness|2 Readiness/);
		// Never lowers what they hold now, and nothing written when there is nothing to give back.
		const ada = pc({ id: "ada", held: 1, hp: 0, dying: true, flags: { readiness: 3 } });
		expect(await keepOneHp(ada, { readiness: 2, combats: fighting(ada) })).toBe(true);
		expect(ada.store.readiness).toBe(3);
		expect(ada.typedActor.restoreHp.mock.calls[0][2].alsoUpdate).toEqual({});
	});

	it("reads the Readiness held before the drop off the dying write, and carries it into the keep", async () => {
		const wren = pc({ id: "wren", held: 1, hp: 0, dying: true, flags: { readiness: 2 } });
		const offerFn = vi.fn(async () => true);
		const dying = { flags: { [SCOPE]: { deathsDoor: "dying" } } };
		onUpdateActorInspirationAtZero(wren, dying, {}, null, { answers: () => true, offer: offerFn, combats: fighting(wren) });
		expect(offerFn).toHaveBeenCalledWith(wren, { battleJoy: false, readiness: 2 });
		const keep = vi.fn(async () => true);
		await offerKeepOneHp(wren, { readiness: 2, ask: async () => true, keep, open: async () => {}, autoOpens: () => false });
		expect(keep).toHaveBeenCalledWith(wren, { battleJoy: false, readiness: 2 });
	});

	it("keeps nothing out of a fight", async () => {
		const wren = pc({ id: "wren", held: 1, hp: 0, dying: true });
		expect(await keepOneHp(wren, { combats: [] })).toBe(false);
		expect(inspirationHeld(wren)).toBe(1);
	});

	it("opens the Death's Door walkthrough only when they go down after all", async () => {
		const wren = pc({ id: "wren", held: 1, hp: 0, dying: true });
		const open = vi.fn(async () => {});
		expect(await offerKeepOneHp(wren, { ask: async () => true, keep: async () => true, open, autoOpens: () => true })).toBe(true);
		expect(open).not.toHaveBeenCalled();
		expect(await offerKeepOneHp(wren, { ask: async () => false, keep: async () => true, open, autoOpens: () => true })).toBe(false);
		expect(open).toHaveBeenCalledWith(wren);
		open.mockClear();
		await offerKeepOneHp(wren, { ask: async () => false, open, autoOpens: () => false });
		expect(open).not.toHaveBeenCalled();
	});

	it("asks on the write that made them dying, on their own screen, carrying whether Battle Joy ended", () => {
		const wren = pc({ id: "wren", held: 1, hp: 0, dying: true });
		const offerFn = vi.fn(async () => true);
		const dying = { flags: { [SCOPE]: { deathsDoor: "dying" } } };
		onUpdateActorInspirationAtZero(wren, dying, { stonetopBattleJoyDropped: true }, null, { answers: () => true, offer: offerFn, combats: fighting(wren) });
		expect(offerFn).toHaveBeenCalledWith(wren, { battleJoy: true, readiness: 0 });
		offerFn.mockClear();
		onUpdateActorInspirationAtZero(wren, dying, {}, null, { answers: () => false, offer: offerFn, combats: fighting(wren) });
		onUpdateActorInspirationAtZero(wren, { system: {} }, {}, null, { answers: () => true, offer: offerFn, combats: fighting(wren) });
		expect(offerFn).not.toHaveBeenCalled();
	});
});

describe("act fearlessly", () => {
	it("spends 1 and says so", async () => {
		const wren = pc({ id: "wren", held: 1 });
		expect(await actFearlessly(wren)).toBe(true);
		expect(inspirationHeld(wren)).toBe(0);
		expect(globalThis.ChatMessage.create.mock.calls[0][0].content).toContain("act fearlessly");
		expect(await actFearlessly(wren)).toBe(false);
	});

	it("shows the count in words on the header, only while held", () => {
		expect(inspirationChip(pc({ id: "wren", held: 2 }), { editable: true })).toMatchObject({ show: true, count: 2, label: "Inspiration 2" });
		expect(inspirationChip(pc({ id: "wren", held: 2 })).tooltip).not.toContain("Click");
		expect(inspirationChip(pc({ id: "wren" })).show).toBe(false);
	});
});

// Where it is wired, which no unit above reaches.
describe("wiring", () => {
	const main = readRepo("stonetop.js");
	const item = readRepo("module/item/StonetopItem.js");
	const header = readRepo("templates/actor/partials/actor-header.hbs");
	const sheet = readRepo("module/actors/character/StonetopCharacterSheet.js");
	const deathsDoor = readRepo("module/hooks/DeathsDoorPrompt.js");

	it("registers the relay and the 0-HP hook, and wires all three cards", () => {
		expect(main).toMatch(/CONFIG\.queries\[INSPIRATION_QUERY\]\s*=/);
		expect(main).toMatch(/Hooks\.on\("updateActor", onUpdateActorInspirationAtZero\)/);
		for (const wire of ["wireSpeechCard(message, html)", "wireKeepOneHp(message, html)", "wireInspirationDamage(message, html, INSPIRATION_DEPS)"]) {
			expect(main).toContain(wire);
		}
		// After the seed pass, so both redraw a results card's totals from the same rows.
		expect(main.indexOf("wireInspirationDamage(message, html")).toBeGreaterThan(main.indexOf("wireDamageSeed(message, html"));
	});

	it("puts the speech buttons on a We Happy Few roll, after anything the roll already carries", () => {
		expect(item).toMatch(/moveRollOptions\(bookName, actor, options\.tierActions\)/);
		const marshal = pc({ id: "m", moves: [WE_HAPPY_FEW] });
		const opts = moveRollOptions(WE_HAPPY_FEW, marshal, { success: "<p>note</p>" });
		expect(opts.tierActions.success).toMatch(/^<p>note<\/p><button[^>]*stonetop-inspire-allies/);
		expect(opts.tierActions.failure).toContain("stonetop-inspire-allies");
		expect(moveRollOptions("Clash", marshal)).toBeNull();
	});

	it("draws the chip on the header, a button only where editable, and wires it", () => {
		expect(header).toMatch(/\{\{#if stonetop\.inspiration\.show\}\}[\s\S]*<button type="button" class="stonetop-inspiration-chip"[\s\S]*<span class="stonetop-inspiration-chip"/);
		expect(sheet).toMatch(/context\.stonetop\.inspiration = inspirationChip\(/);
		expect(sheet).toMatch(/button\.stonetop-inspiration-chip"\)\.on\("click", this\._onActFearlessly/);
	});

	it("holds the Death's Door walkthrough back while the Inspiration question is asked", () => {
		expect(deathsDoor).toMatch(/if \(canKeepOneHp\(actor\)\) return;/);
	});
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Window } from "happy-dom";
import { BOLSTER, PREPARATION_FOR_FLAG, preparationHeld } from "../../../module/actors/character/roll-boosts.js";
import { FOLLOWER_BLOW_FLAG } from "../../../module/actors/character/inspiration-flow.js";
import {
	preparationDamageOffer, addPreparationToDamage, preparationDamageNote, wirePreparationDamage,
	PREPARATION_DAMAGE_FLAG, PREPARATION_DAMAGE_QUERY,
} from "../../../module/actors/character/preparation-damage.js";

// Bolster's Preparation on a damage roll (Book I p.525): "they can spend it on any damage rolls ... as long as
// everyone agrees that the efforts involved with Bolstering would apply to the roll", +1 after it is made,
// maximum +1 per roll.

const SCOPE = "stonetop-pwd";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");

function pc({ id, name = id, held = 0, purpose = undefined }) {
	const tracks = held ? { [BOLSTER]: held } : {};
	const store = purpose === undefined ? {} : { [PREPARATION_FOR_FLAG]: purpose };
	return {
		id, uuid: `Actor.${id}`, name, type: "character", isOwner: true, tracks, store,
		getFlag: (scope, key) => (scope === SCOPE ? store[key] : undefined),
		testUserPermission: vi.fn(user => !!user?.isGM || user?.id === `u-${id}`),
		typedActor: { moveResources: {
			getMoveResources: () => tracks,
			setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
		} },
	};
}

const player = id => ({ id: `u-${id}`, isGM: false });
const GM = { id: "u-gm", isGM: true };
const ownersOf = (online = true) => actor => [
	{ id: `u-${actor.id}`, isGM: false, active: online },
	{ id: "u-gm", isGM: true, active: true },
];

function merge(into, from) {
	for (const [key, value] of Object.entries(from)) {
		if (value && typeof value === "object" && !Array.isArray(value) && into[key] && typeof into[key] === "object") merge(into[key], value);
		else into[key] = value;
	}
}

function message({ flags = {}, flavor = "", rolls = [], author = "u-wren" } = {}) {
	const data = { [SCOPE]: { ...flags } };
	const msg = {
		id: "msg1", flavor, rolls, flags: data,
		getFlag: (scope, key) => data[scope]?.[key],
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
beforeEach(() => { saved = { user: globalThis.game.user, users: globalThis.game.users }; });
afterEach(() => { globalThis.game.user = saved.user; globalThis.game.users = saved.users; });

const offer = (card, wren, { user = player("wren"), online = true } = {}) =>
	preparationDamageOffer(card, { user, holderOf: () => wren, ownersOf: ownersOf(online), scope: SCOPE });

describe("Preparation on a damage roll", () => {
	it("is offered on the holder's own damage card to their player, in a fight or out of one", () => {
		const wren = pc({ id: "wren", held: 2 });
		expect(offer(plainCard(), wren)).toMatchObject({ holder: wren, held: 2, kind: "plain" });
		expect(offer(resultsCard(), wren)).toMatchObject({ kind: "results" });
		expect(offer(plainCard(), wren, { user: player("bryn") })).toBeNull();
		expect(offer(plainCard(), wren, { user: GM })).toBeNull();
		expect(offer(plainCard(), wren, { user: GM, online: false })).not.toBeNull();
	});

	it("is not offered with none held, on a move card, or once taken (maximum +1 per roll)", () => {
		expect(offer(plainCard(), pc({ id: "wren" }))).toBeNull();
		const wren = pc({ id: "wren", held: 1 });
		expect(offer(message({ flavor: "<section class=\"stonetop-roll-card\"></section>", rolls: [{}] }), wren)).toBeNull();
		expect(offer(plainCard({ flags: { [PREPARATION_DAMAGE_FLAG]: { name: "wren" } } }), wren)).toBeNull();
		expect(offer(plainCard(), { type: "npc" })).toBeNull();
	});

	it("is not offered on a follower's blow, a blow taken, a group's blow, someone else's, or once applied", () => {
		const wren = pc({ id: "wren", held: 1 });
		expect(offer(plainCard({ flags: { [FOLLOWER_BLOW_FLAG]: true } }), wren)).toBeNull();
		expect(offer(resultsCard({ selfHarm: true }), wren)).toBeNull();
		expect(offer(resultsCard({ groupBlow: true }), wren)).toBeNull();
		expect(offer(resultsCard({ attackerUuid: "Actor.other" }), wren)).toBeNull();
		expect(offer(resultsCard({ applied: [{ uuid: "T.a" }] }), wren)).toBeNull();
	});

	it("adds +1 to a plain card's roll and total, spends 1, and only once", async () => {
		const wren = pc({ id: "wren", held: 2 });
		const card = plainCard();
		const addOne = vi.fn(async roll => { roll.total += 1; });
		const cardFlavor = vi.fn((flavor, total) => `${flavor}<!--${total}-->`);
		expect(await addPreparationToDamage(card, wren, { addOne, cardFlavor, scope: SCOPE })).toBe(true);
		expect(card.rolls[0].total).toBe(7);
		expect(card.flavor).toContain("<!--7-->");
		expect(card.getFlag(SCOPE, PREPARATION_DAMAGE_FLAG)).toEqual({ by: "Actor.wren", name: "wren" });
		expect(preparationHeld(wren)).toBe(1);
		expect(preparationDamageNote(card.getFlag(SCOPE, PREPARATION_DAMAGE_FLAG))).toBe("+1 Preparation (wren)");
		expect(await addPreparationToDamage(card, wren, { addOne, cardFlavor, scope: SCOPE })).toBe(false);
		expect(preparationHeld(wren)).toBe(1);
	});

	it("adds +1 to every row of a results card, and never after Apply", async () => {
		const wren = pc({ id: "wren", held: 1 });
		const card = resultsCard();
		expect(await addPreparationToDamage(card, wren, { scope: SCOPE })).toBe(true);
		expect(card.getFlag(SCOPE, "damage").results.map(r => r.raw)).toEqual([6, 4]);
		expect(preparationHeld(wren)).toBe(0);
		const bryn = pc({ id: "wren", held: 1 });
		expect(await addPreparationToDamage(resultsCard({ applied: [{ uuid: "T.a" }] }), bryn, { scope: SCOPE })).toBe(false);
		expect(preparationHeld(bryn)).toBe(1);
	});

	it("gives the Preparation back when the card cannot take the +1", async () => {
		const wren = pc({ id: "wren", held: 1 });
		const card = plainCard();
		card.update = vi.fn(async () => { throw new Error("gone"); });
		await expect(addPreparationToDamage(card, wren, { addOne: async () => {}, scope: SCOPE })).rejects.toThrow("gone");
		expect(preparationHeld(wren)).toBe(1);
	});

	it("pays a last Preparation once, though two cards ask for it at once", async () => {
		const wren = pc({ id: "wren", held: 1 });
		wren.typedActor.moveResources.setUses = vi.fn(async (move, value) => {
			await new Promise(r => setTimeout(r, 5));
			wren.tracks[move] = value;
		});
		const one = plainCard();
		const two = plainCard();
		two.id = "msg2";
		const addOne = async roll => { roll.total += 1; };
		const added = await Promise.all([
			addPreparationToDamage(one, wren, { addOne, scope: SCOPE }),
			addPreparationToDamage(two, wren, { addOne, scope: SCOPE }),
		]);
		expect(added.filter(Boolean)).toHaveLength(1);
		expect(preparationHeld(wren)).toBe(0);
	});

	describe("on the card", () => {
		beforeEach(() => { globalThis.game.users = { contents: [player("wren"), GM], activeGM: GM }; });

		it("draws the button for the holder's player, naming what it was for, and the +1 once taken", () => {
			const wren = pc({ id: "wren", held: 2, purpose: "sparring for the bear hunt" });
			const d = new Window().document;
			const root = d.createElement("div");
			root.innerHTML = PLAIN;
			const card = plainCard();
			wirePreparationDamage(card, root, { scope: SCOPE, holderOf: () => wren }, { user: player("wren") });
			const btn = root.querySelector(".stonetop-preparation-damage-btn");
			expect(btn?.textContent).toBe("Preparation: +1");
			expect(btn.dataset.tooltipText).toContain("sparring for the bear hunt");

			const taken = plainCard({ flags: { [PREPARATION_DAMAGE_FLAG]: { by: "Actor.wren", name: "wren" } } });
			const again = d.createElement("div");
			again.innerHTML = PLAIN;
			wirePreparationDamage(taken, again, { scope: SCOPE, holderOf: () => wren }, { user: player("wren") });
			expect(again.querySelector(".stonetop-preparation-damage-btn")).toBeNull();
			expect(again.querySelector(".stonetop-preparation-note")?.textContent).toBe("+1 Preparation (wren)");
		});
	});

	it("is wired on every damage card and answered by the GM's client", () => {
		const boot = read("stonetop.js");
		expect(boot).toContain("wirePreparationDamage(message, html, INSPIRATION_DEPS);");
		expect(boot).toContain("CONFIG.queries[PREPARATION_DAMAGE_QUERY]");
		expect(PREPARATION_DAMAGE_QUERY).toBe("stonetop.preparationDamage");
	});
});

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	giveItAllTarget, offersGiveItAll, giveItAll, askGiveItAllCost, wireImpetuousYouth,
	GAVE_IT_ALL_FLAG, GIVE_IT_ALL_COSTS, HURT_DAMAGE, IMPETUOUS_YOUTH,
} from "../../../module/actors/character/impetuous-youth.js";
import { ROLLED_FLAG, rolledRecord } from "../../../module/utils/counted-tier.js";
import { stubAsk } from "../../fakes/confirm.js";

// The Would-Be Hero's Impetuous Youth: "When you make a move and come up short, you can give it your all and
// turn a 6- into a 7-9, a 7-9 into a 10+, and (if it matters), a 10-11 into a 12+. But if you do, pick 1".

const SCOPE = "stonetop-pwd";
const MOVE_CARD = `<section class="pbta-chat-card stonetop-roll-card"><div class="stonetop-roll-result partial"><span class="stonetop-roll-result-label">Weak Hit</span></div><div class="stonetop-card-buttons"></div></section>`;
const DAMAGE_CARD = `<section class="pbta-chat-card stonetop-roll-card stonetop-damage-roll-card"><span class="stonetop-roll-result-label"></span><div class="stonetop-card-buttons"></div></section>`;

function hero({ background = "impetuous-youth", owner = true, playbook = "The Would-Be Hero" } = {}) {
	return {
		id: "wren", name: "Wren", type: "character", isOwner: owner,
		system: { playbook: { name: playbook } },
		flags: { [SCOPE]: { background: { selected: background } } },
	};
}

// A roll whose total the fake shiftRoll below moves by one per call.
function card({ total = 8, flavor = MOVE_CARD, record = rolledRecord("str", { moveName: "Defy Danger" }), flags = {}, whisper = [] } = {}) {
	const store = { ...(record ? { [ROLLED_FLAG]: record } : {}), ...flags };
	const message = {
		id: `m${Math.random()}`, flavor, whisper,
		rolls: [{ total, formula: "2d6+1" }],
		getFlag: (scope, key) => (scope === SCOPE ? store[key] : undefined),
		canUserModify: () => true,
		update: vi.fn(async data => {
			if (data.flavor !== undefined) message.flavor = data.flavor;
			if (data.rolls) message.rolls = data.rolls;
			Object.assign(store, data.flags?.[SCOPE] ?? {});
		}),
		store,
	};
	return message;
}

const deps = () => ({
	shiftRoll: vi.fn(async (roll, shift) => { roll.total += shift; }),
	cardFlavor: vi.fn((flavor, total) => `${flavor}<!--${total}-->`),
	afterShift: vi.fn(async () => {}),
	hurt: vi.fn(async () => {}),
});

beforeEach(() => {
	globalThis.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: vi.fn(() => ({ alias: "Wren" })) };
	globalThis.game = { ...(globalThis.game ?? {}), user: { id: "u-wren", isGM: false } };
});

describe("giveItAllTarget", () => {
	it("lifts to the next tier's floor: 6- to 7, 7-9 to 10, 10-11 to 12, and nothing past a 12+", () => {
		expect(giveItAllTarget(3)).toBe(7);
		expect(giveItAllTarget(6)).toBe(7);
		expect(giveItAllTarget(7)).toBe(10);
		expect(giveItAllTarget(9)).toBe(10);
		expect(giveItAllTarget(10)).toBe(12);
		expect(giveItAllTarget(11)).toBe(12);
		expect(giveItAllTarget(12)).toBeNull();
	});

	it("reads the tier the card COUNTS as: a 7-9 treated as a 10+ goes to a 12+", () => {
		expect(giveItAllTarget(8, rolledRecord("cha", { partialCountsAsSuccess: "Let's Make a Deal" }))).toBe(12);
		expect(giveItAllTarget(5, rolledRecord("", { missCountsAsPartial: "Herd of Horses" }))).toBe(10);
	});
});

describe("offersGiveItAll", () => {
	it("offers the hero who took Impetuous Youth their own move card below a 12+", () => {
		expect(offersGiveItAll(card(), hero())).toBe(true);
	});

	it("offers nothing to another background, another playbook, or someone who can't write the card", () => {
		expect(offersGiveItAll(card(), hero({ background: "driven" }))).toBe(false);
		expect(offersGiveItAll(card(), hero({ playbook: "The Heavy" }))).toBe(false);
		expect(offersGiveItAll(card(), hero({ owner: false }))).toBe(false);
	});

	it("offers nothing on a damage card, a 12+, a card already given, or Death's Door", () => {
		expect(offersGiveItAll(card({ flavor: DAMAGE_CARD }), hero())).toBe(false);
		expect(offersGiveItAll(card({ total: 12 }), hero())).toBe(false);
		expect(offersGiveItAll(card({ flags: { [GAVE_IT_ALL_FLAG]: { cost: "lost" } } }), hero())).toBe(false);
		expect(offersGiveItAll(card({ record: rolledRecord("", { moveName: "Death's Door" }) }), hero())).toBe(false);
	});

	// The Door's card takes +1s while its window waits on the tier (roll-boosts.js#isBoostableRoll), but its
	// give it your all stays the window's own (giveItAllAtDeathsDoor).
	it("offers nothing on a Death's Door card even while its window waits on the tier for +1s", () => {
		const door = card({ record: rolledRecord("", { moveName: "Death's Door" }) });
		door.speaker = { actor: "wren" };
		const dying = { ...hero(), flags: { [SCOPE]: { ...hero().flags[SCOPE], deathsDoorRolling: { userId: "u-wren", nonce: "n1", messageId: door.id, total: 8, tier: "partial" } } } };
		const saved = game.actors;
		game.actors = { get: id => (id === "wren" ? dying : null), contents: [dying] };
		try {
			expect(offersGiveItAll(door, dying)).toBe(false);
		} finally {
			game.actors = saved;
		}
	});
});

describe("giveItAll", () => {
	it("lifts a 7-9 to exactly 10, records the cost, and hands the new total on", async () => {
		const message = card({ total: 8 });
		const d = deps();
		expect(await giveItAll(message, hero(), "escalate", d)).toBe(true);
		expect(message.rolls[0].total).toBe(10);
		expect(d.shiftRoll).toHaveBeenCalledTimes(2);
		expect(message.store[GAVE_IT_ALL_FLAG]).toEqual({ cost: "escalate", from: 8, to: 10 });
		expect(d.afterShift).toHaveBeenCalledWith(message, 10);
		expect(d.hurt).not.toHaveBeenCalled();
		const posted = ChatMessage.create.mock.calls[0][0].content;
		expect(posted).toContain("a 7-9 becomes a 10+");
		expect(posted).toContain("escalate the situation");
	});

	it("rolls the 2d4 at the hero when the cost is getting hurt, and names the injury", async () => {
		const message = card({ total: 5 });
		const d = deps();
		const actor = hero();
		await giveItAll(message, actor, "hurt", d);
		expect(message.rolls[0].total).toBe(7);
		expect(d.hurt).toHaveBeenCalledWith(actor);
		expect(ChatMessage.create.mock.calls[0][0].content).toContain("an actual injury");
		expect(HURT_DAMAGE).toMatchObject({ formula: "2d4", self: true });
	});

	it("happens once per card", async () => {
		const message = card({ total: 10 });
		const d = deps();
		await giveItAll(message, hero(), "lost", d);
		expect(message.rolls[0].total).toBe(12);
		expect(await giveItAll(message, hero(), "lost", d)).toBe(false);
		expect(d.shiftRoll).toHaveBeenCalledTimes(2);
	});

	it("whispers its note when the roll card was whispered", async () => {
		await giveItAll(card({ whisper: ["gm"] }), hero(), "lost", deps());
		expect(ChatMessage.create.mock.calls[0][0].whisper).toEqual(["gm"]);
	});

	it("refuses an unknown cost", async () => {
		expect(await giveItAll(card(), hero(), "nothing", deps())).toBe(false);
	});
});

describe("asking the cost", () => {
	it("offers the three costs first and a way out last", async () => {
		const wait = stubAsk("hurt");
		expect(await askGiveItAllCost(hero())).toBe("hurt");
		const { buttons, window } = wait.mock.calls[0][0];
		expect(window.title).toBe(IMPETUOUS_YOUTH.label);
		expect(buttons.map(b => b.action)).toEqual([...GIVE_IT_ALL_COSTS.map(c => c.key), "cancel"]);
	});

	it("answers null when the hero backs out", async () => {
		stubAsk("cancel");
		expect(await askGiveItAllCost(hero())).toBeNull();
	});
});

describe("the card's button", () => {
	function rendered(message) {
		const root = document.createElement("div");
		root.innerHTML = message.flavor;
		return root;
	}
	const speaking = actor => { globalThis.game.actors = { get: () => actor }; };

	it("is drawn for the hero on their own move card", () => {
		const message = { ...card(), speaker: { actor: "wren" } };
		speaking(hero());
		const html = rendered(message);
		wireImpetuousYouth(message, html);
		const button = html.querySelector(".stonetop-give-it-all-btn");
		expect(button?.textContent).toBe("Give it your all");
		expect(button.disabled).toBe(false);
	});

	it("is spent, naming the cost, once given", () => {
		const message = { ...card({ flags: { [GAVE_IT_ALL_FLAG]: { cost: "hurt", from: 8, to: 10 } } }), speaker: { actor: "wren" } };
		speaking(hero());
		const html = rendered(message);
		wireImpetuousYouth(message, html);
		const button = html.querySelector(".stonetop-give-it-all-btn");
		expect(button.disabled).toBe(true);
		expect(button.textContent).toBe("Gave it their all: got hurt");
	});

	it("is not drawn for anyone else", () => {
		const message = { ...card(), speaker: { actor: "wren" } };
		speaking(hero({ background: "destined" }));
		const html = rendered(message);
		wireImpetuousYouth(message, html);
		expect(html.querySelector(".stonetop-give-it-all-btn")).toBeNull();
	});
});

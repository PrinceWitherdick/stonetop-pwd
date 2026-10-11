import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	ROLL_CARD_QUERY, handleRollCardQuery, pressRollCard, registerRollCardAction, rollCardRoute, writeCardRoll,
} from "../../module/utils/roll-card-writer.js";
import { inCardTurn } from "../../module/utils/card-queue.js";
import { burnBrightlyOnDoorCard } from "../../module/actors/character/deaths-door-relay.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// Every rewrite of a posted roll card's dice: written by one client per card (the primary GM's while one is
// connected), one at a time there, on a copy of the card's roll.

const player = id => ({ id: `u-${id}`, isGM: false });
const GM = { id: "u-gm", isGM: true };

function card({ author = "u-wren", total = 8 } = {}) {
	const flags = {};
	const message = {
		id: "msg1", flavor: "<p>8</p>", speaker: { alias: "Wren" },
		rolls: [{ total, formula: "2d6", terms: [] }],
		getFlag: (scope, key) => flags[scope]?.[key],
		canUserModify: user => !!user?.isGM || user?.id === author,
		update: vi.fn(async data => {
			if (data.flavor !== undefined) message.flavor = data.flavor;
			if (data.rolls) message.rolls = data.rolls;
			for (const [scope, values] of Object.entries(data.flags ?? {})) Object.assign(flags[scope] ??= {}, values);
		}),
	};
	return message;
}

const plusOne = async roll => { roll.total += 1; roll.terms.push(1); };
const hands = () => ({ cardFlavor: (_flavor, total) => `<p>${total}</p>`, afterShift: vi.fn(async () => {}) });

describe("whose client writes a card", () => {
	it("is the GM's for every player while a GM is connected, the author's with none", () => {
		expect(rollCardRoute(card({ author: "u-wren" }), player("wren"), GM)).toBe("relay");
		expect(rollCardRoute(card({ author: "u-wren" }), player("judge"), GM)).toBe("relay");
		expect(rollCardRoute(card({ author: "u-wren" }), GM, GM)).toBe("local");
		expect(rollCardRoute(card({ author: "u-wren" }), player("wren"), null)).toBe("local");
		expect(rollCardRoute(card({ author: "u-wren" }), player("judge"), null)).toBeNull();
	});
});

describe("the write", () => {
	it("lifts a copy and writes the dice, the flavor and the rest in ONE update, then says the new total", async () => {
		const message = card();
		const before = message.rolls[0];
		const rewrite = hands();
		const roll = await writeCardRoll(message, plusOne, rewrite, lifted => ({ flags: { [SYSTEM_ID]: { to: lifted.total } } }));
		expect(roll.total).toBe(9);
		expect(before.total).toBe(8);
		expect(message.update).toHaveBeenCalledTimes(1);
		expect(message.rolls[0]).toBe(roll);
		expect(message.flavor).toBe("<p>9</p>");
		expect(message.getFlag(SYSTEM_ID, "to")).toBe(9);
		expect(rewrite.afterShift).toHaveBeenCalledWith(message, 9);
	});

	it("leaves the card's roll as it was when the write is refused", async () => {
		const message = card();
		message.update = vi.fn(async () => { throw new Error("refused"); });
		await expect(writeCardRoll(message, plusOne, hands())).rejects.toThrow("refused");
		expect(message.rolls[0]).toEqual({ total: 8, formula: "2d6", terms: [] });
	});

	// The lost update: two rewrites each reading the card before the other wrote kept only the second +1.
	it("keeps both of two rewrites pressed at once, in the card's turn", async () => {
		const message = card();
		const rewrite = hands();
		await Promise.all([
			inCardTurn(message, () => writeCardRoll(message, plusOne, rewrite)),
			inCardTurn(message, () => writeCardRoll(message, plusOne, rewrite)),
		]);
		expect(message.rolls[0].total).toBe(10);
		expect(message.rolls[0].terms).toEqual([1, 1]);
	});
});

describe("a press, and the GM's side of a relayed one", () => {
	let saved;
	const run = vi.fn(async ({ user, data }) => ({ by: user.id, ...data }));
	beforeEach(() => {
		saved = { user: globalThis.game.user, users: globalThis.game.users, messages: globalThis.game.messages };
		registerRollCardAction("test", run);
		run.mockClear();
	});
	afterEach(() => {
		globalThis.game.user = saved.user;
		globalThis.game.users = saved.users;
		globalThis.game.messages = saved.messages;
	});

	it("runs here on the card's writer, and nowhere for a card nobody here can write", async () => {
		const message = card();
		expect(await pressRollCard(message, "test", { cost: "hurt" }, { user: player("wren"), gm: null }))
			.toEqual({ by: "u-wren", cost: "hurt" });
		expect(await pressRollCard(message, "test", {}, { user: player("judge"), gm: null })).toBeNull();
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("asks the GM's client for a player's press while a GM is connected", async () => {
		const gm = { ...GM, query: vi.fn(async () => ({ burned: true })) };
		expect(await pressRollCard(card(), "test", { cost: "hurt" }, { user: player("wren"), gm })).toEqual({ burned: true });
		expect(gm.query).toHaveBeenCalledWith(ROLL_CARD_QUERY,
			{ cost: "hurt", action: "test", messageId: "msg1", userId: "u-wren" }, expect.anything());
		expect(run).not.toHaveBeenCalled();
	});

	it("answers on the primary GM's client only, for a player it can place, with an action it knows", async () => {
		const message = card();
		const wren = player("wren");
		globalThis.game.messages = { get: id => (id === message.id ? message : null) };
		globalThis.game.users = { activeGM: GM, get: id => (id === wren.id ? wren : null) };
		const data = { action: "test", messageId: "msg1", userId: "u-wren", cost: "lost" };

		globalThis.game.user = wren;
		expect(await handleRollCardQuery(data)).toBeNull();

		globalThis.game.user = GM;
		expect(await handleRollCardQuery(data)).toMatchObject({ by: "u-wren", cost: "lost" });
		expect(await handleRollCardQuery({ ...data, action: "nothing" })).toBeNull();
		expect(await handleRollCardQuery({ ...data, userId: "u-nobody" })).toBeNull();
		expect(await handleRollCardQuery({ ...data, messageId: "gone" })).toBeNull();
	});
});

describe("Burn Brightly on a card", () => {
	beforeEach(() => {
		globalThis.ChatMessage = { create: vi.fn(async data => data), getSpeaker: () => ({}) };
	});
	afterEach(() => { delete globalThis.ChatMessage; });

	// Two owners of one character pressing at once: the card is read as unburned by one spend only.
	it("pays once for two presses at once", async () => {
		const actor = {
			id: "wren", name: "Wren", type: "character", flags: {},
			system: { attributes: { xp: { value: 20 }, level: { value: 1 } } },
			getFlag: () => undefined,
			update: vi.fn(async data => { actor.system.attributes.xp.value = data["system.attributes.xp.value"]; }),
		};
		const message = card({ total: 9 });
		const rewrite = { shiftRoll: plusOne, ...hands() };
		const [first, second] = await Promise.all([
			burnBrightlyOnDoorCard(message, actor, rewrite),
			burnBrightlyOnDoorCard(message, actor, rewrite),
		]);
		expect(first).toEqual({ from: 9, to: 10 });
		expect(second).toBeNull();
		expect(actor.system.attributes.xp.value).toBe(18);
		expect(message.rolls[0].total).toBe(10);
		expect(message.getFlag(SYSTEM_ID, "burnBrightly")).toBe(true);
	});

	// A miss's own +1 XP is taken back by the burn that lifts the card off the miss, so it cannot pay for it.
	describe("against the card's own miss XP", () => {
		let savedMessages;
		const burner = xp => {
			const actor = {
				id: "wren", name: "Wren", type: "character", flags: {},
				system: { attributes: { xp: { value: xp }, level: { value: 1 } } },
				getFlag: () => undefined,
				update: vi.fn(async data => { actor.system.attributes.xp.value = data["system.attributes.xp.value"]; }),
			};
			return actor;
		};
		const missCard = total => {
			const message = card({ total });
			message.update({ flags: { [SYSTEM_ID]: { missXp: true, missXpState: "marked" } } });
			const receipt = { id: "r1", getFlag: (scope, key) => (scope === SYSTEM_ID ? { xpMark: 1, xpMarkFor: "msg1" }[key] : undefined) };
			globalThis.game.messages = { contents: [message, receipt], get: id => [message, receipt].find(m => m.id === id) ?? null };
			return message;
		};
		beforeEach(() => { savedMessages = globalThis.game.messages; });
		afterEach(() => { globalThis.game.messages = savedMessages; });

		it("refuses a burn the miss's XP alone made affordable", async () => {
			// 7 XP before the roll, 8 with the miss: the threshold at level 1, but only thanks to the miss.
			const actor = burner(8);
			expect(await burnBrightlyOnDoorCard(missCard(6), actor, { shiftRoll: plusOne, ...hands() })).toBeNull();
			expect(actor.system.attributes.xp.value).toBe(8);
		});

		it("still counts it when the +1 leaves the card on a miss", async () => {
			const actor = burner(8);
			expect(await burnBrightlyOnDoorCard(missCard(5), actor, { shiftRoll: plusOne, ...hands() })).toEqual({ from: 5, to: 6 });
			expect(actor.system.attributes.xp.value).toBe(6);
		});
	});
});

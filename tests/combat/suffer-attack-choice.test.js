import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SCOPE, pc, makeMessage, installCombatChatFakes, uninstallCombatChatFakes, cardWithFlag } from "../fakes/combat-chat.js";

// The two GM-whispered cards an incoming attack can route through — "Which attack?" for a foe
// that prints several, and "Name the enemy's damage" for one that prints none — and the ordering
// that keeps either of them from landing the same blow twice.
//
// NEITHER WRITES HP, which is what changed. The GM's answer POSTS a damage card; the deliberate
// press on that card's own "Take this damage" is what reaches the character's hit points, and it
// carries the `applied` latch that makes a second press harmless (see wireApplyDamage). What
// these cards must not do is post TWO of them, because two cards are two blows.
const { resolveSufferChoice, dealSufferedAmount } = await import("../../module/combat/attack-flow.js");

let posted;
const damageCard = () => cardWithFlag(posted, "damage");

beforeEach(() => {
	posted = installCombatChatFakes({ game: { messages: { get: () => null } } });
	// Every uuid these cards carry is the character's own.
	globalThis.fromUuid = async () => pc;
});

afterEach(uninstallCombatChatFakes);

// -- "Which attack?" -----------------------------------------------------------

describe("the GM's pick rolls the attack they chose", () => {
	const choiceCard = (chosen = null) => makeMessage({
		sufferChoice: {
			pcUuid: pc.uuid, foeName: "Rime Lord", foeText: "", chosen,
			attacks: [
				{ label: "conjured ice", formula: "d12+3", tags: ["forceful"], piercing: 0, ignoresArmor: false, rollMode: "normal" },
				{ label: "heat-drain", formula: "d12+1", tags: [], piercing: 0, ignoresArmor: true, rollMode: "normal" },
			],
		},
	});

	it("carries the PICKED attack's clause onto the damage card, not the primary one's", async () => {
		// Picking "heat-drain" over "conjured ice" is picking the blow armor does not stop, and a
		// card that mitigated it anyway would make the choice meaningless.
		const message = choiceCard();
		expect(await resolveSufferChoice(message, 1)).toBe(true);

		const flag = damageCard().flags[SCOPE].damage;
		expect(flag.weapon).toMatchObject({ name: "heat-drain", ignoresArmor: true });
		expect(flag.move).toBe("Rime Lord's attack");
		expect(flag.selfHarm).toBe(true);
		expect(flag.results[0]).toMatchObject({ uuid: "Actor.pim", name: "Pim", raw: 9 });
	});

	it("leaves the HP to the card's own button, which is the one that latches", async () => {
		await resolveSufferChoice(choiceCard(), 0);
		// Nothing applied yet: the card arrives with an empty latch and a live button.
		expect(damageCard().flags[SCOPE].damage.applied).toEqual([]);
		expect(damageCard().content).toContain("Take this damage");
	});

	it("records which attack was taken, so the whisper still says", async () => {
		const message = choiceCard();
		await resolveSufferChoice(message, 0);
		expect(message.flags.sufferChoice.chosen).toBe(0);
		expect(damageCard().content).toContain("conjured ice");
	});

	it("refuses a second pick once one is recorded", async () => {
		const message = choiceCard(0);
		expect(await resolveSufferChoice(message, 1)).toBe(false);
		expect(damageCard()).toBeUndefined();
	});

	it("refuses an index the card does not offer", async () => {
		expect(await resolveSufferChoice(choiceCard(), 7)).toBe(false);
		expect(damageCard()).toBeUndefined();
	});

	it("records the pick BEFORE posting the blow, so a failed latch costs nothing", async () => {
		// Two cards are two blows. Latching afterwards meant a rejected latch left one already
		// posted and the whisper still askable.
		const order = [];
		const message = choiceCard();
		message.setFlag.mockImplementation(async (scope, key, value) => {
			order.push("latch"); message.flags[key] = value; return value;
		});
		globalThis.ChatMessage.create.mockImplementation(async (data) => {
			order.push("card"); posted.push(data); return { ...data, id: "posted" };
		});

		await resolveSufferChoice(message, 0);
		expect(order[0]).toBe("latch");
		expect(order).toContain("card");
	});

	it("posts nothing when the pick cannot be recorded", async () => {
		const message = choiceCard();
		message.setFlag.mockImplementation(async () => { throw new Error("no permission"); });

		expect(await resolveSufferChoice(message, 0)).toBe(false);
		expect(damageCard()).toBeUndefined();
		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
	});

	it("posts nothing when the character has gone away", async () => {
		globalThis.fromUuid = async () => null;
		const message = choiceCard();
		expect(await resolveSufferChoice(message, 0)).toBe(false);
		expect(message.flags.sufferChoice.chosen).toBe(null);
	});
});

// -- "Name the enemy's damage" --------------------------------------------------

describe("the GM's number for a foe that prints no damage die", () => {
	const amountCard = (dealt = null) => makeMessage({
		sufferAmount: { pcUuid: pc.uuid, foeName: "Spirit of the Glade", dealt },
	});

	it("posts what they typed as an ordinary damage card", async () => {
		const message = amountCard();
		expect(await dealSufferedAmount(message, "5")).toBe(true);

		const flag = damageCard().flags[SCOPE].damage;
		expect(flag.move).toBe("Spirit of the Glade's attack");
		expect(flag.selfHarm).toBe(true);
		expect(damageCard().content).toContain("Take this damage");
		expect(message.flags.sufferAmount.dealt).toBe(5);
	});

	it("leaves the armor to the card, so one rule meets every incoming blow", async () => {
		// A flat number is a formula Roll takes, which is what keeps this on the one damage path:
		// the weapon it rides carries no bypass, so wireApplyDamage subtracts armor as always.
		await dealSufferedAmount(amountCard(), "5");
		expect(damageCard().flags[SCOPE].damage.weapon).toMatchObject({ ignoresArmor: false, piercing: 0 });
	});

	it("takes a blow that turned out to cost nothing, and stays answered", async () => {
		// 0 is a real answer. Tested against null rather than falsiness, or the card would come
		// back askable after it had been answered.
		const message = amountCard();
		expect(await dealSufferedAmount(message, "0")).toBe(true);
		expect(message.flags.sufferAmount.dealt).toBe(0);
		expect(await dealSufferedAmount(message, "7")).toBe(false);
	});

	it("refuses a second answer once one is recorded", async () => {
		expect(await dealSufferedAmount(amountCard(4), "9")).toBe(false);
		expect(damageCard()).toBeUndefined();
	});

	it("floors a negative or unreadable entry at nothing rather than healing anybody", async () => {
		const message = amountCard();
		await dealSufferedAmount(message, "-4");
		expect(message.flags.sufferAmount.dealt).toBe(0);

		const blank = amountCard();
		await dealSufferedAmount(blank, "");
		expect(blank.flags.sufferAmount.dealt).toBe(0);
	});

	it("records the number BEFORE posting the blow, so a failed latch costs nothing", async () => {
		const message = amountCard();
		message.setFlag.mockImplementation(async () => { throw new Error("no permission"); });

		expect(await dealSufferedAmount(message, "5")).toBe(false);
		expect(damageCard()).toBeUndefined();
		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
	});

	it("posts nothing when the character has gone away", async () => {
		globalThis.fromUuid = async () => null;
		const message = amountCard();
		expect(await dealSufferedAmount(message, "5")).toBe(false);
		expect(message.flags.sufferAmount.dealt).toBe(null);
	});
});

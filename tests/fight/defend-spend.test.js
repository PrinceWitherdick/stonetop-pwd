import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { halveDamage, defendOffers, defendNotes, spendOnBlow, spentOn, handleSpendQuery, SPEND_QUERY, takeSpend, rowToken, pickOne, beingApplied } from "../../module/fight/defend-spend.js";
import { stubAsk } from "../fakes/confirm.js";
import { inCardTurn } from "../../module/utils/card-queue.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";
import { heldReadiness, READINESS_FLAG } from "../../module/combat/defend-readiness.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { writeFlagPath } from "../fakes/combat-chat.js";

// Spending Defend's Readiness on a blow from its damage card (Book I p.216).

const character = (name, readiness = 0, moves = []) => ({
	name, type: "character", uuid: `Actor.${name}`, isOwner: true,
	items: moves.map(move => ({ type: "move", name: move })),
	flags: { [SYSTEM_ID]: { [READINESS_FLAG]: readiness } },
	setFlag: vi.fn(async function (scope, key, value) { this.flags[scope][key] = value; }),
});

describe("heldReadiness and halveDamage", () => {
	it("reads a character's Readiness, and nobody else's", () => {
		expect(heldReadiness(character("bram", 2))).toBe(2);
		expect(heldReadiness({ type: "monster", flags: { [SYSTEM_ID]: { [READINESS_FLAG]: 3 } } })).toBe(0);
	});

	it("halves a blow rounding up, as the book's halvings do", () => {
		expect(halveDamage(7)).toBe(4);
		expect(halveDamage(6)).toBe(3);
		expect(halveDamage(0)).toBe(0);
	});
});

describe("defendOffers", () => {
	const bram = character("bram", 1);
	const aeliana = character("aeliana", 2);
	const damage = { results: [{ uuid: "Token.bram", name: "Bram" }] };

	it("offers the one hit a halving of their own blow, and a defender beside them both options", () => {
		const offers = defendOffers(damage, () => ({ self: bram, allies: [aeliana] }));
		expect(offers.halve.map(o => o.defender.name)).toEqual(["bram", "aeliana"]);
		expect(offers.standIn.map(o => o.defender.name)).toEqual(["aeliana"]);
	});

	it("offers each option once against a blow, and nothing on a blow already applied", () => {
		const taken = { ...damage, halvedBy: [{ uuid: "Token.bram", name: "bram", how: "halve" }], standIns:[{ uuid: "Token.bram", by: aeliana.uuid, name: "aeliana" }] };
		const none = { halve: [], parry: [], standIn: [], ignore: [], knockedDown: [], safetyFirst: [] };
		expect(defendOffers(taken, () => ({ self: bram, allies: [aeliana] }), () => aeliana)).toEqual(none);
		const applied = { ...damage, applied: [{ uuid: "Token.bram" }] };
		expect(defendOffers(applied, () => ({ self: bram, allies: [aeliana] }))).toEqual(none);
	});
});

describe("playbook moves on the card", () => {
	const damage = { results: [{ uuid: "Token.bram", name: "Bram" }] };

	it("offers a Fox's Parry & Riposte beside the plain halving", () => {
		const fox = character("fox", 1, ["Parry & Riposte"]);
		const offers = defendOffers(damage, () => ({ self: null, allies: [fox] }));
		expect(offers.parry.map(o => o.defender.name)).toEqual(["fox"]);
		expect(offers.halve.map(o => o.defender.name)).toEqual(["fox"]);
	});

	it("lets a Steadfast Guardian take a blow for free, while they hold any Readiness", () => {
		const heavy = character("heavy", 1, ["Steadfast Guardian"]);
		expect(defendOffers(damage, () => ({ self: null, allies: [heavy] })).standIn).toEqual([{ row: damage.results[0], defender: heavy, cost: 0 }]);
	});

	it("offers I Get Knocked Down to the one hit, whether or not they hold any Readiness", () => {
		const pim = character("pim", 0, ["I Get Knocked Down"]);
		const offers = defendOffers(damage, () => ({ self: null, allies: [] }), () => pim);
		expect(offers.knockedDown).toEqual([{ row: damage.results[0], defender: pim, cost: 0 }]);
		// Not to an ally, and not twice on the same blow.
		expect(defendOffers(damage, () => ({ self: null, allies: [] }), () => character("plain", 2)).knockedDown).toEqual([]);
		const taken = { ...damage, knockedDownBy: [{ uuid: "Token.bram", name: "pim", how: "knockedDown" }] };
		expect(defendOffers(taken, () => ({ self: null, allies: [] }), () => pim).knockedDown).toEqual([]);
		expect(defendNotes(taken)).toEqual(["pim got knocked down, halving the blow (I Get Knocked Down)."]);
	});

	// The user's ruling (WBH audit, 2026-09-27): "When you take damage", so a Would-Be Hero who stood in for
	// someone may use it, and the ward they stood in for, who no longer takes the blow, may not.
	it("offers I Get Knocked Down to a Would-Be Hero who stood in, and not to the ward they stood in for", () => {
		const pim = character("pim", 1, ["I Get Knocked Down"]);
		const ward = character("ward", 0, ["I Get Knocked Down"]);
		const stood = { ...damage, standIns: [{ uuid: "Token.bram", by: pim.uuid, name: "pim" }] };
		const byUuid = uuid => (uuid === pim.uuid ? pim : ward);
		expect(defendOffers(stood, () => ({ self: null, allies: [] }), byUuid).knockedDown).toEqual([{ row: damage.results[0], defender: pim, cost: 0 }]);
		// A stand-in without the move: nobody is offered it, the ward included.
		const plain = character("plain", 1);
		const byPlain = uuid => (uuid === plain.uuid ? plain : ward);
		const plainStood = { ...damage, standIns: [{ uuid: "Token.bram", by: plain.uuid, name: "plain" }] };
		expect(defendOffers(plainStood, () => ({ self: null, allies: [] }), byPlain).knockedDown).toEqual([]);
	});

	it("halves only for whoever takes the blow now: a ward's knock-down does not follow it onto a stand-in", async () => {
		const pim = character("pim", 1, ["I Get Knocked Down"]);
		const ward = character("ward", 0, ["I Get Knocked Down"]);
		const wardDown = [{ uuid: "Token.bram", name: "ward", how: "knockedDown", by: ward.uuid }];
		expect([...spentOn({ ...damage, knockedDownBy: wardDown }).knockedDown]).toEqual(["Token.bram"]);
		const stood = { ...damage, knockedDownBy: wardDown, standIns: [{ uuid: "Token.bram", by: pim.uuid, name: "pim" }] };
		expect([...spentOn(stood).knockedDown]).toEqual([]);
		// So the stand-in may take it on that blow for themselves, and it is recorded as theirs.
		const card = {
			flag: stood,
			getFlag() { return this.flag; },
			setFlag: vi.fn(async function (_scope, key, value) { const store = { damage: this.flag }; writeFlagPath(store, key, value); this.flag = store.damage; }),
		};
		const offer = defendOffers(stood, () => ({ self: null, allies: [] }), uuid => (uuid === pim.uuid ? pim : ward)).knockedDown[0];
		expect(offer.defender).toBe(pim);
		expect(await takeSpend(card, "knockedDown", offer)).toBe(true);
		expect(card.flag.knockedDownBy.at(-1)).toMatchObject({ uuid: "Token.bram", name: "pim", by: pim.uuid });
		expect([...spentOn(card.flag).knockedDown]).toEqual(["Token.bram"]);
		expect(await takeSpend(card, "knockedDown", offer)).toBe(false);
	});

	it("offers A Mighty Rampart's ignore to whoever will suffer the blow: the one hit, or the one who took it for them", () => {
		const judge = character("judge", 1, ["A Mighty Rampart"]);
		expect(defendOffers(damage, () => ({ self: judge, allies: [] })).ignore.map(o => o.defender.name)).toEqual(["judge"]);
		const stood = { ...damage, standIns: [{ uuid: "Token.bram", by: judge.uuid, name: "judge" }] };
		expect(defendOffers(stood, () => ({ self: null, allies: [] }), () => judge).ignore.map(o => o.defender.name)).toEqual(["judge"]);
		expect(defendOffers(damage, () => ({ self: character("plain", 1), allies: [] })).ignore).toEqual([]);
	});
});

// Seeker audit (2026-09-26), the user's ruling: Safety First's "spend 1 Protection ... to halve its
// damage/effects" is a "Halve it (Safety First, harmful magic)" offer on the damage card while Protection is
// held, paid in Protection (a hold pool: a ticked pip is held), never in Readiness.
describe("Safety First on the damage card", () => {
	const seeker = (name, protection, { learned = true } = {}) => {
		const tracks = { "Safety First": protection };
		return {
			...character(name, 0),
			items: [{ type: "move", name: "Safety First", system: { resource: { max: 2 } }, flags: learned ? {} : { [SYSTEM_ID]: { learned: false } } }],
			typedActor: { moveResources: {
				getMoveResources: () => tracks,
				setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
			} },
			tracks,
		};
	};
	const damage = { results: [{ uuid: "Token.maelis", name: "Maelis" }] };
	const nobody = () => ({ self: null, allies: [] });
	const message = flag => ({
		flag,
		getFlag() { return this.flag; },
		setFlag: vi.fn(async function (_scope, key, value) { const store = { damage: this.flag }; writeFlagPath(store, key, value); this.flag = store.damage; }),
	});

	it("is offered to the one hit while they hold Protection, and to nobody else", () => {
		const maelis = seeker("maelis", 1);
		expect(defendOffers(damage, nobody, () => maelis).safetyFirst).toEqual([{ row: damage.results[0], defender: maelis, cost: 0 }]);
		expect(defendOffers(damage, nobody, () => seeker("maelis", 0)).safetyFirst).toEqual([]);
		expect(defendOffers(damage, nobody, () => seeker("maelis", 2, { learned: false })).safetyFirst).toEqual([]);
		expect(defendOffers(damage, nobody, () => character("plain", 2)).safetyFirst).toEqual([]);
		const taken = { ...damage, safetyFirstBy: [{ uuid: "Token.maelis", name: "maelis", how: "safetyFirst" }] };
		expect(defendOffers(taken, nobody, () => maelis).safetyFirst).toEqual([]);
	});

	it("spends 1 Protection, not Readiness, halves the blow and says so", async () => {
		const maelis = seeker("maelis", 2);
		const card = message({ results: [{ uuid: "Token.maelis", name: "Maelis" }] });
		expect(await spendOnBlow(card, "safetyFirst", { row: card.flag.results[0], defender: maelis, cost: 0 })).toBe(true);
		expect(maelis.tracks["Safety First"]).toBe(1);
		expect(maelis.typedActor.moveResources.setUses).toHaveBeenCalledWith("Safety First", 1, { stonetopMove: "Safety First" });
		expect(maelis.flags[SYSTEM_ID][READINESS_FLAG]).toBe(0);
		expect([...spentOn(card.flag).safetyFirst]).toEqual(["Token.maelis"]);
		expect(defendNotes(card.flag)).toEqual(["maelis spent 1 Protection to halve the harmful magic's damage (Safety First)."]);
	});

	it("is refused with no Protection left", async () => {
		const maelis = seeker("maelis", 0);
		const card = message({ results: [{ uuid: "Token.maelis", name: "Maelis" }] });
		expect(await spendOnBlow(card, "safetyFirst", { row: card.flag.results[0], defender: maelis, cost: 0 })).toBe(false);
		expect(card.setFlag).not.toHaveBeenCalled();
	});
});

describe("spendOnBlow", () => {
	const message = flag => ({
		flag,
		getFlag() { return this.flag; },
		setFlag: vi.fn(async function (_scope, key, value) { const store = { damage: this.flag }; writeFlagPath(store, key, value); this.flag = store.damage; }),
	});

	it("takes a Readiness off the defender and records the halving", async () => {
		const bram = character("bram", 2);
		const card = message({ results: [{ uuid: "Token.bram", name: "Bram" }] });
		expect(await spendOnBlow(card, "halve", { row: card.flag.results[0], defender: bram })).toBe(true);
		expect(bram.flags[SYSTEM_ID][READINESS_FLAG]).toBe(1);
		expect([...spentOn(card.flag).halved]).toEqual(["Token.bram"]);
		expect(defendNotes(card.flag)).toEqual(["bram spent Readiness to halve the blow on Bram."]);
	});

	/** A strike back that settles its questions and pays (strikeBackAt), or one the player backs out of. */
	const striking = vi.fn(async (_defender, _attacker, _label, { commit }) => commit());
	const backedOut = vi.fn(async () => false);

	it("parries: one Readiness halves the blow and strikes back at whoever struck", async () => {
		const fox = character("fox", 2, ["Parry & Riposte"]);
		const card = message({ attackerUuid: "Scene.s.Token.t.Actor.wolf", results: [{ uuid: "Token.bram", name: "Bram" }] });
		expect(await spendOnBlow(card, "parry", { row: card.flag.results[0], defender: fox, cost: 1 }, { strikeBack: striking })).toBe(true);
		expect(fox.flags[SYSTEM_ID][READINESS_FLAG]).toBe(1);
		expect([...spentOn(card.flag).halved]).toEqual(["Token.bram"]);
		expect(striking).toHaveBeenCalledWith(fox, "Scene.s.Token.t.Actor.wolf", "Parry & riposte", expect.objectContaining({ commit: expect.any(Function) }));
		expect(defendNotes(card.flag)).toEqual(["fox spent Readiness to parry the blow on Bram and strike back."]);
	});

	it("parries a blow a character takes by striking back at the foe, never at the character", async () => {
		const fox = character("fox", 2, ["Parry & Riposte"]);
		const card = message({ attackerUuid: "Actor.bram", selfHarm: true, foeUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.bram", name: "Bram" }] });
		expect(await spendOnBlow(card, "parry", { row: card.flag.results[0], defender: fox, cost: 1 }, { strikeBack: striking })).toBe(true);
		expect(striking).toHaveBeenLastCalledWith(fox, "Scene.s.Token.wolf", "Parry & riposte", expect.anything());
	});

	it("costs nothing and halves nothing when the player backs out of the strike back's weapon or damage window", async () => {
		const fox = character("fox", 2, ["Parry & Riposte"]);
		const card = message({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.bram", name: "Bram" }] });
		expect(await spendOnBlow(card, "parry", { row: card.flag.results[0], defender: fox, cost: 1 }, { strikeBack: backedOut })).toBe(false);
		expect(fox.flags[SYSTEM_ID][READINESS_FLAG]).toBe(2);
		expect(fox.setFlag).not.toHaveBeenCalled();
		expect(card.setFlag).not.toHaveBeenCalled();
	});

	it("takes nothing for a parry on a blow applied while the strike back was being settled", async () => {
		const fox = character("fox", 2, ["Parry & Riposte"]);
		const card = message({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.bram", name: "Bram" }] });
		const applyFirst = vi.fn(async (_d, _a, _l, { commit }) => {
			card.flag = { ...card.flag, applied: [{ uuid: "Token.bram", effective: 4 }] };
			return commit();
		});
		expect(await spendOnBlow(card, "parry", { row: card.flag.results[0], defender: fox, cost: 1 }, { strikeBack: applyFirst })).toBe(false);
		expect(fox.flags[SYSTEM_ID][READINESS_FLAG]).toBe(2);
	});

	it("takes a blow for free for a Steadfast Guardian, and ignores one for A Mighty Rampart", async () => {
		const heavy = character("heavy", 1, ["Steadfast Guardian"]);
		const card = message({ results: [{ uuid: "Token.bram", name: "Bram" }] });
		expect(await spendOnBlow(card, "standIn", { row: card.flag.results[0], defender: heavy, cost: 0 })).toBe(true);
		expect(heavy.flags[SYSTEM_ID][READINESS_FLAG]).toBe(1);
		expect(heavy.setFlag).not.toHaveBeenCalled();
		const judge = character("judge", 1, ["A Mighty Rampart"]);
		expect(await spendOnBlow(card, "ignore", { row: card.flag.results[0], defender: judge, cost: 1 })).toBe(true);
		expect([...spentOn(card.flag).ignored]).toEqual(["Token.bram"]);
		expect(defendNotes(card.flag)).toEqual([
			"heavy took the blow for Bram (Steadfast Guardian, no Readiness spent).",
			"judge spent Readiness to ignore the blow (A Mighty Rampart).",
		]);
	});

	it("hands the blow to the defender, and refuses one with no Readiness left", async () => {
		const aeliana = character("aeliana", 1);
		const card = message({ results: [{ uuid: "Token.bram", name: "Bram" }] });
		expect(await spendOnBlow(card, "standIn", { row: card.flag.results[0], defender: aeliana })).toBe(true);
		expect(card.flag.standIns).toEqual([{ uuid: "Token.bram", by: "Actor.aeliana", name: "aeliana", how: "standIn", free: false }]);
		expect(await spendOnBlow(card, "halve", { row: card.flag.results[0], defender: aeliana })).toBe(false);
	});

	// I Get Knocked Down: the price is picked before anything is written.
	describe("knocked down", () => {
		let saved;
		let posted;
		beforeEach(() => {
			saved = { document: globalThis.document, applications: globalThis.foundry.applications, ChatMessage: globalThis.ChatMessage };
			posted = [];
			globalThis.document = { createElement: () => ({}) };
			globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: () => ({}) };
		});
		afterEach(() => {
			globalThis.document = saved.document;
			globalThis.foundry.applications = saved.applications;
			globalThis.ChatMessage = saved.ChatMessage;
		});
		const blow = () => message({ results: [{ uuid: "Token.pim", name: "Pim" }] });

		it("halves the blow at the price picked, and says which", async () => {
			const pim = character("pim", 0, ["I Get Knocked Down"]);
			const card = blow();
			stubAsk("o1");
			expect(await spendOnBlow(card, "knockedDown", { row: card.flag.results[0], defender: pim, cost: 0 })).toBe(true);
			expect([...spentOn(card.flag).knockedDown]).toEqual(["Token.pim"]);
			expect(posted[0].content).toContain("Something on their person breaks");
		});

		it("halves nothing when the window is closed without a price", async () => {
			const pim = character("pim", 0, ["I Get Knocked Down"]);
			const card = blow();
			stubAsk(null);
			expect(await spendOnBlow(card, "knockedDown", { row: card.flag.results[0], defender: pim, cost: 0 })).toBe(false);
			expect(card.setFlag).not.toHaveBeenCalled();
			expect(posted).toEqual([]);
		});
	});

	// Second Intent: "When you Defend and spend 1 Readiness to Parry & Riposte, also pick 1 option from the
	// Ambush list." Its "Deal +1d4 damage" is offered on the strike back's own window, and the card that
	// follows says whether it was taken there.
	describe("Second Intent", () => {
		let saved;
		let posted;
		beforeEach(() => {
			saved = globalThis.ChatMessage;
			posted = [];
			globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: () => ({}) };
		});
		afterEach(() => { globalThis.ChatMessage = saved; });

		const fox = () => {
			const actor = character("fox", 2, ["Parry & Riposte", "Second Intent"]);
			actor.items.push({ type: "move", name: "Ambush", system: { description: "<p>pick 1:</p><ul><li>Deal +1d4 damage</li><li>Slip away before they can react</li></ul>" } });
			return actor;
		};
		/** A strike back whose damage window came back with `keys` ticked. */
		const strikingWith = keys => vi.fn(async (_d, _a, _l, { commit }) => commit(keys));

		it("says the pick was the +1d4 when the strike back took it", async () => {
			const card = message({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.bram", name: "Bram" }] });
			expect(await spendOnBlow(card, "parry", { row: card.flag.results[0], defender: fox(), cost: 1 }, { strikeBack: strikingWith(["secondIntent"]) })).toBe(true);
			expect(posted[0].content).toContain("fox parried and took +1d4 damage on the strike back");
			// The pick is made: the list is not put in front of them again.
			expect(posted[0].content).not.toContain("Slip away");
		});

		it("puts the Ambush list in front of them, and says the d4 was not taken, when it was not", async () => {
			const card = message({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.bram", name: "Bram" }] });
			expect(await spendOnBlow(card, "parry", { row: card.flag.results[0], defender: fox(), cost: 1 }, { strikeBack: strikingWith([]) })).toBe(true);
			expect(posted[0].content).toContain("also pick 1 option from the Ambush list");
			expect(posted[0].content).toContain("without the +1d4 damage");
			expect(posted[0].content).toContain("Slip away before they can react");
		});
	});
});

// More than one spend on offer: a button each, and one to spend nothing.
describe("pickOne", () => {
	let saved;
	beforeEach(() => {
		saved = { document: globalThis.document, applications: globalThis.foundry.applications };
		globalThis.document = { createElement: () => ({}) };
	});
	afterEach(() => {
		globalThis.document = saved.document;
		globalThis.foundry.applications = saved.applications;
	});
	const bram = { name: "Bram" };
	const ilsa = { name: "Ilsa" };
	const ask = items => pickOne(items, { title: "Halve the blow", question: "Who spends it?", labelOf: item => `${item.name} halves it` });

	it("asks nothing of a list of one, or none", async () => {
		const asked = stubAsk("o0");
		expect(await ask([bram])).toBe(bram);
		expect(await ask([])).toBeNull();
		expect(asked).not.toHaveBeenCalled();
	});

	it("resolves to the one pressed, the first included", async () => {
		const asked = stubAsk("o1");
		expect(await ask([bram, ilsa])).toBe(ilsa);
		const { buttons, window } = asked.mock.calls[0][0];
		expect(window.title).toBe("Halve the blow");
		expect(buttons.map(b => b.label)).toEqual(["Bram halves it", "Ilsa halves it", "Don't spend"]);
		expect(buttons.find(b => b.default)?.action).toBe("o0");
		stubAsk("o0");
		expect(await ask([bram, ilsa])).toBe(bram);
	});

	it("resolves to null on the spend-nothing button or a closed window", async () => {
		stubAsk("cancel");
		expect(await ask([bram, ilsa])).toBeNull();
		stubAsk(null);
		expect(await ask([bram, ilsa])).toBeNull();
	});
});

// A card the GM wrote (a monster's blow): a player cannot write it, so their spend is recorded by the GM's
// client, and a parry's strike back is still theirs to roll.
describe("a player's spend on a card the GM wrote", () => {
	const GM = { id: "gm", isGM: true, active: true };
	const PIM = { id: "pim", isGM: false, active: true };
	const BOB = { id: "bob", isGM: false, active: true };
	let saved;
	beforeEach(() => { saved = globalThis.game; });
	afterEach(() => { globalThis.game = saved; });

	const card = flag => ({
		id: "m1", flag,
		getFlag() { return this.flag; },
		setFlag: vi.fn(async function (_scope, key, value) { const store = { damage: this.flag }; writeFlagPath(store, key, value); this.flag = store.damage; }),
	});
	const owned = (name, readiness, ownerId, moves = []) => ({
		...character(name, readiness, moves),
		testUserPermission: user => user.id === ownerId,
	});
	const users = list => ({ get: id => list.find(u => u.id === id) ?? null, activeGM: list.find(u => u.isGM) ?? null });

	it("asks the GM's client to record it, writing nothing itself", async () => {
		const query = vi.fn(async () => true);
		globalThis.game = { user: PIM, users: { activeGM: { ...GM, query } } };
		const bram = owned("bram", 2, "pim");
		const blow = card({ results: [{ uuid: "Token.bram", name: "Bram" }] });
		expect(await spendOnBlow(blow, "halve", { row: blow.flag.results[0], defender: bram }, { relay: true })).toBe(true);
		expect(query).toHaveBeenCalledWith(SPEND_QUERY, { messageId: "m1", kind: "halve", rowUuid: "Token.bram", defenderUuid: "Actor.bram", userId: "pim" }, { timeout: 10000 });
		expect(blow.setFlag).not.toHaveBeenCalled();
		expect(bram.setFlag).not.toHaveBeenCalled();
	});

	it("rolls a parry's strike back on the player's own screen, and has the GM take the Readiness once it is settled", async () => {
		const query = vi.fn(async () => true);
		globalThis.game = { user: PIM, users: { activeGM: { ...GM, query } } };
		const fox = owned("fox", 2, "pim", ["Parry & Riposte"]);
		const blow = card({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.fox", name: "Fox" }] });
		const strike = vi.fn(async (_d, _a, _l, { commit }) => commit());
		expect(await spendOnBlow(blow, "parry", { row: blow.flag.results[0], defender: fox, cost: 1 }, { relay: true, strikeBack: strike })).toBe(true);
		expect(strike).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledWith(SPEND_QUERY, expect.objectContaining({ kind: "parry", defenderUuid: "Actor.fox" }), { timeout: 10000 });
	});

	describe("handleSpendQuery", () => {
		function gmSide() {
			const bram = owned("bram", 2, "pim");
			const blow = card({ results: [{ uuid: "Token.bram", name: "Bram" }] });
			globalThis.game = { user: GM, users: users([GM, PIM, BOB]) };
			const deps = { messages: { get: id => (id === "m1" ? blow : null) }, users: users([GM, PIM, BOB]), offersOf: damage => defendOffers(damage, () => ({ self: bram, allies: [] })) };
			return { bram, blow, deps };
		}
		const ask = (user, extra = {}) => [{ messageId: "m1", kind: "halve", rowUuid: "Token.bram", defenderUuid: "Actor.bram", ...extra }, { user }];

		it("records the spend for the player who owns the defender, once however often it is asked", async () => {
			const { bram, blow, deps } = gmSide();
			const [first, second] = await Promise.all([handleSpendQuery(...ask(PIM), deps), handleSpendQuery(...ask(PIM), deps)]);
			expect([first, second]).toEqual([true, false]);
			expect(bram.flags[SYSTEM_ID][READINESS_FLAG]).toBe(1);
			expect([...spentOn(blow.flag).halved]).toEqual(["Token.bram"]);
		});

		it("refuses a player who does not own the defender, and a spend the card does not offer", async () => {
			const { bram, deps } = gmSide();
			expect(await handleSpendQuery(...ask(BOB), deps)).toBe(false);
			expect(await handleSpendQuery(...ask(PIM, { kind: "standIn" }), deps)).toBe(false);
			expect(await handleSpendQuery(...ask(PIM, { kind: "lunge" }), deps)).toBe(false);
			expect(bram.flags[SYSTEM_ID][READINESS_FLAG]).toBe(2);
		});

		it("reads the asker from the data on v13, but never takes it for a GM", async () => {
			const { bram, deps } = gmSide();
			const [data] = ask(null);
			expect(await handleSpendQuery({ ...data, userId: "gm" }, { timeout: 10000 }, deps)).toBe(false);
			expect(bram.flags[SYSTEM_ID][READINESS_FLAG]).toBe(2);
			expect(await handleSpendQuery({ ...data, userId: "pim" }, { timeout: 10000 }, deps)).toBe(true);
		});
	});
});

// A spend and an Apply pressed together on the GM's client wait in one line, and each writes only its own
// part of the card.
describe("a spend beside an Apply on the same card", () => {
	const card = flag => ({
		id: "m-race", flag,
		getFlag() { return this.flag; },
		setFlag: vi.fn(async function (_scope, key, value) { const store = { damage: this.flag }; writeFlagPath(store, key, value); this.flag = store.damage; }),
	});

	it("refuses a halving pressed while the blow is being applied, spending no Readiness", async () => {
		const bram = character("bram", 2);
		const blow = card({ results: [{ uuid: "Token.bram", name: "Bram" }], applied: [] });
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const applying = inCardTurn(blow, async () => {
			await gate;
			await blow.setFlag(SYSTEM_ID, "damage.applied", [{ uuid: "Token.bram", effective: 5 }]);
		});
		const spend = takeSpend(blow, "halve", { row: blow.flag.results[0], defender: bram, cost: 1 });
		release();
		await applying;
		expect(await spend).toBe(false);
		expect(bram.flags[SYSTEM_ID][READINESS_FLAG]).toBe(2);
		expect(blow.flag.halvedBy).toBeUndefined();
	});

	it("refuses a halving while ANOTHER client is applying the card, unless that client has gone", async () => {
		// The player is taking their own counter-attack on their client while the GM halves it on theirs:
		// the card queue cannot order the two, so the card's `applying` mark does.
		const prior = globalThis.game;
		const users = new Map([["player1", { id: "player1", active: true }], ["left1", { id: "left1", active: false }]]);
		globalThis.game = { ...prior, users };
		try {
			const bram = character("bram", 2);
			const blow = card({ results: [{ uuid: "Token.bram", name: "Bram" }], applied: [], applying: "player1" });
			expect(beingApplied(blow.flag, users)).toBe(true);
			expect(await takeSpend(blow, "halve", { row: blow.flag.results[0], defender: bram, cost: 1 })).toBe(false);
			expect(bram.flags[SYSTEM_ID][READINESS_FLAG]).toBe(2);
			expect(blow.flag.halvedBy).toBeUndefined();

			const stale = card({ results: [{ uuid: "Token.bram", name: "Bram" }], applied: [], applying: "left1" });
			expect(beingApplied(stale.flag, users)).toBe(false);
			expect(await takeSpend(stale, "halve", { row: stale.flag.results[0], defender: bram, cost: 1 })).toBe(true);
			expect(beingApplied({ applying: null }, users)).toBe(false);
		} finally {
			globalThis.game = prior;
		}
	});

	it("writes only its own list, so an applied row written from another client stays applied", async () => {
		const aeliana = character("aeliana", 2);
		const blow = card({ results: [{ uuid: "Token.bram", name: "Bram" }, { uuid: "Token.pim", name: "Pim" }], applied: [] });
		await takeSpend(blow, "halve", { row: blow.flag.results[0], defender: aeliana, cost: 1 });
		expect(blow.setFlag).toHaveBeenLastCalledWith(SYSTEM_ID, "damage.halvedBy", [expect.objectContaining({ uuid: "Token.bram" })]);
	});
});

describe("rowToken", () => {
	it("finds the token an actor fights as when the viewer is looking at another scene", () => {
		const bram = fakeActor({ id: "bram", name: "Bram" });
		const token = fakeToken({ id: "t-bram", actor: bram });
		const scene = fakeScene({ id: "fight-scene", tokens: [token] });
		const combat = fakeCombat({ scene, combatants: [fakeCombatant({ id: "c-bram", token, scene })] });
		const doc = { ...bram, id: "bram", getActiveTokens: () => [] };
		expect(rowToken(doc, { scene: { id: "elsewhere" }, combats: collection([combat]) })).toBe(token);
		expect(rowToken(doc, { scene: { id: "elsewhere" }, combats: collection([{ ...combat, flags: {} }]) })).toBeNull();
	});
});

import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest";
import { halveDamage, defendOffers, defendNotes, spendOnBlow, spentOn, handleSpendQuery, SPEND_QUERY, takeSpend, rowToken, pickOne, beingApplied, wireDefendSpends, combatAlliesOf, spendWriter, strikeBackAim, charmsOn, handleCharmQuery, CHARM_QUERY, handleCharmSettleQuery, CHARM_SETTLE_QUERY } from "../../module/fight/defend-spend.js";
import { stubAsk } from "../fakes/confirm.js";
import { inCardTurn } from "../../module/utils/card-queue.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";
import { heldReadiness, READINESS_FLAG } from "../../module/combat/defend-readiness.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { writeFlagPath } from "../fakes/combat-chat.js";
import { RELAY_GRACE_MS } from "../../module/utils/relay-landed.js";
import { useFakeHooks } from "../fakes/hooks.js";
import { forgetWorldMarkScans } from "../../module/actors/character/blessed-marks.js";

// The world's charm makers are kept between renders; each test starts from a fresh scan.
beforeEach(() => forgetWorldMarkScans());

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
		const none = { halve: [], parry: [], standIn: [], ignore: [], knockedDown: [], neverGonna: [], safetyFirst: [], redirect: [], charm: [] };
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

	it("offers no Parry & Riposte for a player's own move of that name, which acts as itself", () => {
		const fox = character("fox", 1);
		fox.items = [{ type: "move", name: "Parry & Riposte", flags: { [SYSTEM_ID]: { custom: true } } }];
		const offers = defendOffers(damage, () => ({ self: null, allies: [fox] }));
		expect(offers.parry).toEqual([]);
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

	// WBH re-audit (2026-10-18): "When you take damage DESPITE YOUR BEST EFFORTS TO AVOID IT". A move's own price
	// the character chose to pay (Iron Will's 1d4, rollOptionDamage marks it `ownPrice`) is not such a blow; a
	// counter-attack is selfHarm too, with its foe or without one found, and keeps the move.
	it("offers I Get Knocked Down on a counter-attack, and not on a move's own price the character chose to pay", () => {
		const pim = character("pim", 0, ["I Get Knocked Down"]);
		const self = { attackerUuid: "Actor.pim", selfHarm: true, results: [{ uuid: "Actor.pim", name: "Pim" }] };
		const nobody = () => ({ self: null, allies: [] });
		expect(defendOffers({ ...self, ownPrice: true }, nobody, () => pim).knockedDown).toEqual([]);
		expect(defendOffers({ ...self, foeUuid: "Scene.s.Token.wolf" }, nobody, () => pim).knockedDown).toEqual([{ row: self.results[0], defender: pim, cost: 0 }]);
		expect(defendOffers(self, nobody, () => pim).knockedDown).toEqual([{ row: self.results[0], defender: pim, cost: 0 }]);
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

// WBH re-audit (2026-10-18), the user's ruling: Never Gonna Keep Me Down's "When you have 5 or fewer current HP,
// you impose disadvantage on any damage you take" reaches a blow a Would-Be Hero stands in for after it was
// rolled: the card offers to roll the row again and keep the lower, once (straight, if it had advantage).
describe("Never Gonna Keep Me Down on a stand-in", () => {
	const hero = (hp, { learned = true, owner = true } = {}) => ({
		...character("pim", 1),
		isOwner: owner,
		system: { attributes: { hp: { value: hp } } },
		items: [{ type: "move", name: "Never Gonna Keep Me Down", flags: learned ? {} : { [SYSTEM_ID]: { learned: false } } }],
	});
	const ward = character("bram", 0);
	const row = (formula = "1d8+2", raw = 7) => ({ uuid: "Token.bram", name: "Bram", formula, raw });
	const stood = (pim, extra = {}) => ({ results: [row()], standIns: [{ uuid: "Token.bram", by: pim.uuid, name: "pim" }], ...extra });
	const nobody = () => ({ self: null, allies: [] });
	const byUuid = pim => uuid => (uuid === pim.uuid ? pim : ward);
	const offered = (damage, pim) => defendOffers(damage, nobody, byUuid(pim)).neverGonna;

	it("is offered to a Would-Be Hero who stood in, with the move learned, at 5 or fewer current HP", () => {
		const pim = hero(5);
		const damage = stood(pim);
		expect(offered(damage, pim)).toEqual([{ row: damage.results[0], defender: pim, cost: 0 }]);
		expect(offered(stood(hero(1)), hero(1)).length).toBe(1);
		const healthy = hero(6);
		expect(offered(stood(healthy), healthy)).toEqual([]);
		const unlearned = hero(3, { learned: false });
		expect(offered(stood(unlearned), unlearned)).toEqual([]);
	});

	it("is not offered without a stand-in: the one hit had their say when the blow was rolled", () => {
		const pim = hero(3);
		expect(defendOffers({ results: [row()] }, nobody, () => pim).neverGonna).toEqual([]);
	});

	it("is not offered on a row already rolled at disadvantage, or one with no die to roll", () => {
		const pim = hero(3);
		for (const formula of ["2d8kl1 + 2", "{2d4,2d4}kl", "5"]) {
			expect(offered(stood(pim, { results: [row(formula)] }), pim)).toEqual([]);
		}
		// Advantage is not disadvantage: the row may still be rolled again.
		expect(offered(stood(pim, { results: [row("2d8kh1 + 2")] }), pim).length).toBe(1);
	});

	it("is offered once per row", () => {
		const pim = hero(3);
		const used = stood(pim, { neverGonnaBy: [{ uuid: "Token.bram", name: "pim", how: "neverGonna", by: pim.uuid, was: 7, rolled: 3, kept: 3 }] });
		expect(offered(used, pim)).toEqual([]);
	});

	it("is offered only to the hero's owner or a GM", () => {
		const prior = globalThis.game;
		try {
			const pim = hero(3, { owner: false });
			globalThis.game = { ...prior, user: { id: "bob", isGM: false } };
			expect(offered(stood(pim), pim)).toEqual([]);
			globalThis.game = { ...prior, user: { id: "gm", isGM: true } };
			expect(offered(stood(pim), pim).length).toBe(1);
		} finally {
			globalThis.game = prior;
		}
	});

	describe("rolling again", () => {
		const card = (flag, extra = {}) => ({
			flag, extra,
			getFlag(_scope, key) { return key === "damage" ? this.flag : this.extra[key]; },
			setFlag: vi.fn(),
			update: vi.fn(async function (data) { this.flag = { ...this.flag, ...data.flags[SYSTEM_ID].damage }; }),
		});
		const rolling = total => vi.fn(async () => ({ total, terms: [], dice: [] }));

		it("keeps the lower of the two totals on the row, costs no Readiness, and says both", async () => {
			const pim = hero(3);
			const blow = card(stood(pim));
			const offer = offered(blow.flag, pim)[0];
			const reroll = rolling(3);
			expect(await takeSpend(blow, "neverGonna", offer, { reroll })).toBe(true);
			expect(reroll).toHaveBeenCalledWith("1d8+2");
			expect(blow.flag.results[0]).toMatchObject({ uuid: "Token.bram", raw: 3 });
			expect(blow.flag.neverGonnaBy).toEqual([{ uuid: "Token.bram", name: "pim", how: "neverGonna", by: pim.uuid, was: 7, rolled: 3, kept: 3 }]);
			expect(pim.flags[SYSTEM_ID][READINESS_FLAG]).toBe(1);
			expect(defendNotes(blow.flag)).toContain("pim rolled the blow they took for Bram again and kept the lower: 7 and 3, so 3 (Never Gonna Keep Me Down).");
			expect([...spentOn(blow.flag).neverGonna]).toEqual(["Token.bram"]);
			// Once: the second press rolls nothing.
			expect(await takeSpend(blow, "neverGonna", offer, { reroll })).toBe(false);
			expect(reroll).toHaveBeenCalledTimes(1);
		});

		it("keeps the first total when the second is higher, and still spends the use", async () => {
			const pim = hero(3);
			const blow = card(stood(pim));
			expect(await takeSpend(blow, "neverGonna", offered(blow.flag, pim)[0], { reroll: rolling(9) })).toBe(true);
			expect(blow.flag.results[0].raw).toBe(7);
			expect(blow.flag.neverGonnaBy[0]).toMatchObject({ was: 7, rolled: 9, kept: 7 });
			expect(offered(blow.flag, pim)).toEqual([]);
		});

		it("rolls an advantaged row again STRAIGHT and takes that total, higher or lower: the two cancel", async () => {
			const pim = hero(3);
			for (const [formula, straight] of [["2d8kh1 + 2", "1d8 + 2"], ["{2d4,2d4}kh + 1", "2d4 + 1"]]) {
				const blow = card(stood(pim, { results: [row(formula, 7)] }));
				const reroll = rolling(9);
				expect(await takeSpend(blow, "neverGonna", offered(blow.flag, pim)[0], { reroll })).toBe(true);
				expect(reroll).toHaveBeenCalledWith(straight);
				expect(blow.flag.results[0].raw).toBe(9);
				expect(blow.flag.neverGonnaBy[0]).toMatchObject({ was: 7, rolled: 9, kept: 9, straight: true });
				expect(defendNotes(blow.flag)).toContain("pim rolled the blow they took for Bram again: its advantage and their disadvantage cancel, so a straight roll of 9 replaces 7 (Never Gonna Keep Me Down).");
			}
		});

		it("keeps an Inspiration die added to the card on top of whichever total is kept", async () => {
			const pim = hero(3);
			// Rolled 7, then +2 from an Inspiration die (inspiration-flow.js#addInspirationDie).
			const blow = card(stood(pim, { results: [row("1d8+2", 9)] }), { inspirationDie: { amount: 2 } });
			expect(await takeSpend(blow, "neverGonna", offered(blow.flag, pim)[0], { reroll: rolling(4) })).toBe(true);
			expect(blow.flag.results[0].raw).toBe(6);
		});

		it("refuses a row already applied, rolling nothing", async () => {
			const pim = hero(3);
			const blow = card(stood(pim, { applied: [{ uuid: "Token.bram", effective: 7 }] }));
			const reroll = rolling(1);
			expect(await takeSpend(blow, "neverGonna", { row: blow.flag.results[0], defender: pim, cost: 0 }, { reroll })).toBe(false);
			expect(reroll).not.toHaveBeenCalled();
			expect(blow.update).not.toHaveBeenCalled();
		});

		it("rolls the row's own formula with a Roll when pressed on the card", async () => {
			const prior = globalThis.Roll;
			const formulas = [];
			globalThis.Roll = class { constructor(formula) { formulas.push(formula); } async evaluate() { return { total: 2, terms: [], dice: [] }; } };
			try {
				const pim = hero(3);
				const blow = card(stood(pim));
				expect(await spendOnBlow(blow, "neverGonna", offered(blow.flag, pim)[0])).toBe(true);
				expect(formulas).toEqual(["1d8+2"]);
				expect(blow.flag.results[0].raw).toBe(2);
			} finally {
				globalThis.Roll = prior;
			}
		});

		it("redraws the row's total from the card's flag", async () => {
			const priorDocument = globalThis.document;
			globalThis.document = { createElement: () => ({}) };
			try {
				const pim = hero(3);
				const blow = card(stood(pim));
				await takeSpend(blow, "neverGonna", offered(blow.flag, pim)[0], { reroll: rolling(3) });
				const number = { textContent: "7", dataset: {} };
				const rowEl = { dataset: { uuid: "Token.bram" }, querySelector: () => number };
				const root = { querySelector: () => null, querySelectorAll: () => [rowEl] };
				wireDefendSpends(blow, root);
				expect(number.textContent).toBe("3");
			} finally {
				globalThis.document = priorDocument;
			}
		});
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

// Coverage pass (2026-10-16): Mirrorshield ("When you Defend with a shield, you can spend 1 Readiness to
// intercept a magical force and redirect it to a different target (or none)", Book I p.119) and Lightning Rod
// ("When you Defend while touching the earth, you can spend 1 Readiness to intercept a nearby magical attack
// and redirect it harmlessly into the ground", p.106). A button: whether the blow is magical is the table's.
describe("Mirrorshield and Lightning Rod on the damage card", () => {
	const damage = { results: [{ uuid: "Token.bram", name: "Bram" }] };
	const message = flag => ({
		flag,
		getFlag() { return this.flag; },
		setFlag: vi.fn(async function (_scope, key, value) { const store = { damage: this.flag }; writeFlagPath(store, key, value); this.flag = store.damage; }),
	});
	const judge = (shield, readiness = 1) => Object.assign(character("judge", readiness, ["Mirrorshield"]), {
		typedActor: { bearsShield: vi.fn(async () => shield) },
	});

	it("is offered to whoever could spend Readiness on the blow, holding either move, once per blow", () => {
		const blessed = character("blessed", 1, ["Lightning Rod"]);
		const offers = defendOffers(damage, () => ({ self: character("bram", 1), allies: [blessed, judge(true)] }));
		expect(offers.redirect.map(o => [o.defender.name, o.move, o.cost])).toEqual([["blessed", "Lightning Rod", 1], ["judge", "Mirrorshield", 1]]);
		const taken = { ...damage, redirectedBy: [{ uuid: "Token.bram", name: "blessed", how: "redirect", move: "Lightning Rod" }] };
		expect(defendOffers(taken, () => ({ self: null, allies: [blessed] })).redirect).toEqual([]);
		expect(defendOffers(damage, () => ({ self: character("plain", 1), allies: [] })).redirect).toEqual([]);
	});

	it("spends 1 Readiness, takes the blow off the row, and says whose move it was", async () => {
		const blessed = character("blessed", 2, ["Lightning Rod"]);
		const card = message({ results: [{ uuid: "Token.bram", name: "Bram" }] });
		expect(await spendOnBlow(card, "redirect", { row: card.flag.results[0], defender: blessed, cost: 1, move: "Lightning Rod" })).toBe(true);
		expect(blessed.flags[SYSTEM_ID][READINESS_FLAG]).toBe(1);
		expect(spentOn(card.flag).voided.get("Token.bram")).toEqual({ lineKey: "stonetop.fight.defend.redirectedLine", move: "Lightning Rod" });
		expect(defendNotes(card.flag)).toEqual(["blessed spent Readiness to redirect the magic aimed at Bram (Lightning Rod)."]);
	});

	it("refuses Mirrorshield to a Judge carrying no shield, and spends nothing", async () => {
		const bare = judge(false, 2);
		const card = message({ results: [{ uuid: "Token.bram", name: "Bram" }] });
		expect(await spendOnBlow(card, "redirect", { row: card.flag.results[0], defender: bare, cost: 1, move: "Mirrorshield" })).toBe(false);
		expect(bare.flags[SYSTEM_ID][READINESS_FLAG]).toBe(2);
		expect(card.setFlag).not.toHaveBeenCalled();
		const shielded = judge(true, 2);
		expect(await spendOnBlow(card, "redirect", { row: card.flag.results[0], defender: shielded, cost: 1, move: "Mirrorshield" })).toBe(true);
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
		expect([...spentOn(card.flag).voided]).toEqual([["Token.bram", { lineKey: "stonetop.fight.defend.ignoredLine", move: "" }]]);
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

		// Coverage pass (2026-10-16): the list's "Create an opportunity; you or an ally gains advantage on the next
		// move to act on it" carries the same button an Ambush 7+ does.
		it("carries Ambush's give-advantage button for the opportunity pick, and none once the d4 was the pick", async () => {
			const card = message({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.bram", name: "Bram" }] });
			await spendOnBlow(card, "parry", { row: card.flag.results[0], defender: fox(), cost: 1 }, { strikeBack: strikingWith([]) });
			expect(posted[0].content).toContain('class="stonetop-give-advantage" data-move="Ambush"');
			expect(posted[0].content).toContain("Create an opportunity");
			const took = message({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.bram", name: "Bram" }] });
			await spendOnBlow(took, "parry", { row: took.flag.results[0], defender: fox(), cost: 1 }, { strikeBack: strikingWith(["secondIntent"]) });
			expect(posted[1].content).not.toContain("stonetop-give-advantage");
		});

		it("posts no Second Intent card for a player's own move of that name, which acts as itself", async () => {
			const actor = fox();
			actor.items = actor.items.map(i => (i.name === "Second Intent" ? { ...i, flags: { [SYSTEM_ID]: { custom: true } } } : i));
			const card = message({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.bram", name: "Bram" }] });
			expect(await spendOnBlow(card, "parry", { row: card.flag.results[0], defender: actor, cost: 1 }, { strikeBack: strikingWith([]) })).toBe(true);
			expect(posted).toEqual([]);
		});

		// Fox re-audit (2026-10-18): the list and the opportunity button are the BOOK's Ambush's, so a player's
		// own move named "Ambush" supplies neither; the card still says what Second Intent asks.
		it("reads neither the list nor the opportunity button off a player's own Ambush", async () => {
			const actor = fox();
			actor.items = actor.items.map(i => (i.name === "Ambush" ? { ...i, flags: { [SYSTEM_ID]: { custom: true } } } : i));
			const card = message({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.bram", name: "Bram" }] });
			expect(await spendOnBlow(card, "parry", { row: card.flag.results[0], defender: actor, cost: 1 }, { strikeBack: strikingWith([]) })).toBe(true);
			expect(posted[0].content).toContain("also pick 1 option from the Ambush list");
			expect(posted[0].content).not.toContain("Slip away");
			expect(posted[0].content).not.toContain("stonetop-give-advantage");
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

	// QY-6: the GM's client recorded the spend, but its answer came after the asker stopped waiting.
	it("counts a spend the card shows as taken, though no answer came in time", async () => {
		const fox = owned("fox", 2, "pim", ["Parry & Riposte"]);
		const blow = card({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.fox", name: "Fox" }] });
		const query = vi.fn(async () => {
			blow.flag = { ...blow.flag, halvedBy: [{ uuid: "Token.fox", name: "fox", how: "parry" }] };
			throw new Error("timed out");
		});
		globalThis.game = { user: PIM, users: { activeGM: { ...GM, query } } };
		const strike = vi.fn(async (_d, _a, _l, { commit }) => commit());
		expect(await spendOnBlow(blow, "parry", { row: blow.flag.results[0], defender: fox, cost: 1 }, { relay: true, strikeBack: strike })).toBe(true);
		// And one that never lands is still a no, once the wait for it is over.
		vi.useFakeTimers();
		try {
			const other = card({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.fox", name: "Fox" }] });
			globalThis.game = { user: PIM, users: { activeGM: { ...GM, query: vi.fn(async () => { throw new Error("timed out"); }) } } };
			const out = spendOnBlow(other, "parry", { row: other.flag.results[0], defender: fox, cost: 1 }, { relay: true, strikeBack: strike });
			await vi.advanceTimersByTimeAsync(RELAY_GRACE_MS);
			expect(await out).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	// The GM's write was queued behind others on the card, so it lands after the asker stopped waiting.
	it("counts a spend the GM's client records a moment after no answer came", async () => {
		const hooks = useFakeHooks();
		try {
			const fox = owned("fox", 2, "pim", ["Parry & Riposte"]);
			const blow = card({ attackerUuid: "Scene.s.Token.wolf", results: [{ uuid: "Token.fox", name: "Fox" }] });
			globalThis.game = { user: PIM, users: { activeGM: { ...GM, query: vi.fn(async () => { throw new Error("timed out"); }) } } };
			const strike = vi.fn(async (_d, _a, _l, { commit }) => commit());
			const out = spendOnBlow(blow, "parry", { row: blow.flag.results[0], defender: fox, cost: 1 }, { relay: true, strikeBack: strike });
			await vi.waitFor(() => expect(hooks.handlers.size).toBe(1));
			blow.flag = { ...blow.flag, halvedBy: [{ uuid: "Token.fox", name: "fox", how: "parry" }] };
			hooks.fire("updateChatMessage", blow);
			expect(await out).toBe(true);
		} finally {
			hooks.restore();
		}
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

	// QY-4: two cards are two lines, and both read the defender's last Readiness before either paid it.
	it("pays one last Readiness once, though two cards ask for it at once", async () => {
		const bram = character("bram", 1);
		bram.setFlag = vi.fn(async function (scope, key, value) {
			await new Promise(r => setTimeout(r, 5));
			this.flags[scope][key] = value;
		});
		const one = card({ results: [{ uuid: "Token.bram", name: "Bram" }], applied: [] });
		const two = { ...card({ results: [{ uuid: "Token.bram", name: "Bram" }], applied: [] }), id: "m-race-2" };
		const results = await Promise.all([
			takeSpend(one, "halve", { row: one.flag.results[0], defender: bram, cost: 1 }),
			takeSpend(two, "halve", { row: two.flag.results[0], defender: bram, cost: 1 }),
		]);
		expect(results.filter(Boolean)).toHaveLength(1);
		expect(bram.flags[SYSTEM_ID][READINESS_FLAG]).toBe(0);
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
		// The setting is read live (fight-state.js#countsAsFight).
		const settings = globalThis.game.settings;
		onTestFinished(() => { globalThis.game.settings = settings; });
		let fightTab = true;
		globalThis.game.settings = { get: (_scope, key) => (key === "fightTab" ? fightTab : undefined) };
		expect(rowToken(doc, { scene: { id: "elsewhere" }, combats: collection([{ ...combat, flags: {} }]) })).toBeNull();
		// With the Fight tab off nothing is stamped, and a core Combat is the fight.
		fightTab = false;
		expect(rowToken(doc, { scene: { id: "elsewhere" }, combats: collection([{ ...combat, flags: {} }]) })).toBe(token);
	});
});

// Marshal re-audit (2026-10-18): FRONT LINE LEADER's "Spend Presence ... as Readiness (as if you Defended
// them)". A blow on the Marshal's crew is offered to the Marshal to halve or to take for them, paid in Presence.
describe("Front Line Leader's Presence on a blow at the crew", () => {
	const FLL = "Front Line Leader";
	const marshal = (presence = 2, readiness = 0) => {
		const tracks = { [FLL]: presence };
		return {
			...character("rhianna", readiness),
			items: [{ type: "move", name: FLL, system: { resource: { max: 2, title: "Presence" } }, flags: {} }],
			typedActor: { moveResources: {
				getMoveResources: () => tracks,
				setUses: vi.fn(async (move, value) => { tracks[move] = value; }),
			} },
			tracks,
		};
	};
	const crew = { name: "The Wolves", type: "npc", uuid: "Actor.wolves", isOwner: true };
	const damage = { results: [{ uuid: "Token.wolves", name: "The Wolves" }] };
	const nobody = () => ({ self: null, allies: [] });
	const message = flag => ({
		flag,
		getFlag() { return this.flag; },
		setFlag: vi.fn(async function (_scope, key, value) { const store = { damage: this.flag }; writeFlagPath(store, key, value); this.flag = store.damage; }),
	});

	it("offers the Marshal a halving and a stand-in, priced in Presence, while they hold any", () => {
		const rhianna = marshal(1);
		const offers = defendOffers(damage, nobody, () => crew, hit => (hit === crew ? rhianna : null));
		expect(offers.halve).toEqual([{ row: damage.results[0], defender: rhianna, cost: 1, purse: "presence" }]);
		expect(offers.standIn).toEqual([{ row: damage.results[0], defender: rhianna, cost: 1, purse: "presence" }]);
		// Nobody's Presence guards anyone else.
		const elsewhere = defendOffers(damage, nobody, () => character("bram", 0), () => null);
		expect(elsewhere.halve).toEqual([]);
		expect(elsewhere.standIn).toEqual([]);
	});

	it("offers each once against the blow, and nothing once someone has taken it for them", () => {
		const rhianna = marshal(2);
		const halved = { ...damage, halvedBy: [{ uuid: "Token.wolves", name: "rhianna", how: "halve", purse: "presence" }] };
		const offers = defendOffers(halved, nobody, () => crew, () => rhianna);
		expect(offers.halve).toEqual([]);
		expect(offers.standIn).toHaveLength(1);
		const stoodIn = { ...damage, standIns: [{ uuid: "Token.wolves", by: "Actor.bram", name: "bram" }] };
		const after = defendOffers(stoodIn, nobody, uuid => (uuid === "Token.wolves" ? crew : character("bram", 0)), () => rhianna);
		expect(after.halve).toEqual([]);
		expect(after.standIn).toEqual([]);
	});

	it("spends 1 Presence, not Readiness, and the card says so", async () => {
		const rhianna = marshal(2, 3);
		const card = message({ results: [{ uuid: "Token.wolves", name: "The Wolves" }] });
		expect(await spendOnBlow(card, "standIn", { row: card.flag.results[0], defender: rhianna, cost: 1, purse: "presence" })).toBe(true);
		expect(rhianna.tracks[FLL]).toBe(1);
		expect(rhianna.typedActor.moveResources.setUses).toHaveBeenCalledWith(FLL, 1, { stonetopMove: FLL });
		expect(rhianna.flags[SYSTEM_ID][READINESS_FLAG]).toBe(3);
		expect(spentOn(card.flag).standIns.get("Token.wolves")).toMatchObject({ by: "Actor.rhianna", purse: "presence" });
		expect(defendNotes(card.flag)).toEqual(["rhianna spent 1 Presence as Readiness to take the blow for The Wolves (Front Line Leader)."]);
	});

	it("is refused with no Presence left, whatever Readiness they hold", async () => {
		const rhianna = marshal(0, 3);
		const card = message({ results: [{ uuid: "Token.wolves", name: "The Wolves" }] });
		expect(await spendOnBlow(card, "halve", { row: card.flag.results[0], defender: rhianna, cost: 1, purse: "presence" })).toBe(false);
		expect(card.setFlag).not.toHaveBeenCalled();
		expect(rhianna.flags[SYSTEM_ID][READINESS_FLAG]).toBe(3);
	});
});

// Combat audit 2026-10-23 (MOV-1, MOV-2, MOV-5, MOV-7): the user's rulings.
describe("combat audit fixes on the damage card", () => {
	const GM = { id: "gm", isGM: true, active: true };
	const PIM = { id: "pim", isGM: false, active: true };
	let saved;
	beforeEach(() => { saved = globalThis.game; });
	afterEach(() => { globalThis.game = saved; });

	const card = flag => ({
		id: "m1", flag,
		getFlag() { return this.flag; },
		setFlag: vi.fn(async function (_scope, key, value) { const store = { damage: this.flag }; writeFlagPath(store, key, value); this.flag = store.damage; }),
	});

	// MOV-1: with the Fight tab off, the people standing by are the heroes' side of the same Combat.
	describe("combatAlliesOf (the Fight tab off)", () => {
		const hero = (id, extra = {}) => ({ id, name: id, type: "character", hasPlayerOwner: true, ...extra });
		const c = (id, actor, extra = {}) => ({ id, actor, actorId: actor?.id, tokenId: `t-${id}`, ...extra });
		it("lists everyone else on the heroes' side of the Combat the one hit stands in, never the one hit or the down", () => {
			const bram = hero("bram");
			const ana = hero("ana");
			const cadi = hero("cadi");
			const wolf = { id: "wolf", name: "Wolf", type: "monster", hasPlayerOwner: false };
			const combat = { combatants: [c("b", bram), c("a", ana), c("w", wolf), c("c", cadi, { isDefeated: true })] };
			expect(combatAlliesOf(bram, null, { combats: [combat] })).toEqual([ana]);
			// Not in any Combat, or no hero there: nobody.
			expect(combatAlliesOf(hero("pim"), null, { combats: [combat] })).toEqual([]);
			expect(combatAlliesOf(wolf, null, { combats: [combat] })).toEqual([]);
		});

		// The old Introductions left a tokenless roster Combat holding every PC: it is no fight, so it makes
		// nobody an ally of anybody, and a PC dropped into a fight tokenless stands by nobody either.
		it("never counts a tokenless roster Combat, nor a tokenless combatant", () => {
			const bram = hero("bram");
			const ana = hero("ana");
			const roster = { combatants: [c("rb", bram, { tokenId: null }), c("ra", ana, { tokenId: null })] };
			expect(combatAlliesOf(bram, null, { combats: [roster] })).toEqual([]);
			const wolf = { id: "wolf", name: "Wolf", type: "monster", hasPlayerOwner: false };
			const fight = { combatants: [c("b", bram), c("w", wolf), c("a", ana, { tokenId: null })] };
			expect(combatAlliesOf(bram, null, { combats: [roster, fight] })).toEqual([]);
		});
	});

	// MOV-7: a player who wrote the card asks the GM's client too, while one is on.
	describe("spendWriter", () => {
		const own = { isOwner: true };
		const theirs = { isOwner: false };
		it("has the card's author relay through the GM while one is on, and write it alone otherwise", () => {
			expect(spendWriter(own, PIM, { gm: GM })).toBe("relay");
			expect(spendWriter(own, PIM, { gm: null })).toBe("direct");
			expect(spendWriter(theirs, PIM, { gm: GM })).toBe("relay");
			expect(spendWriter(theirs, PIM, { gm: null })).toBeNull();
		});
		it("has the primary GM write it, and any other GM offer nothing", () => {
			expect(spendWriter(own, GM, { gm: GM, primary: () => true })).toBe("direct");
			expect(spendWriter(own, GM, { gm: GM, primary: () => false })).toBeNull();
		});
	});

	// MOV-2: a strike back with nobody targeted is at an attacker, the archer shooting at them included.
	describe("strikeBackAim", () => {
		const combatant = (id, name) => ({ id, name, actorId: id, actor: { id }, token: { uuid: `Scene.s.Token.${id}`, name, disposition: -1 } });
		const engagement = attackers => ({
			entry: { attackers },
			combatants: new Map([["wolf", combatant("wolf", "Wolf")], ["archer", combatant("archer", "Archer")]]),
		});
		it("aims at the one attacker outright, asks between several, and finds nobody with no fight to read", async () => {
			const ask = vi.fn(async ({ candidates }) => [candidates[1]]);
			expect(await strikeBackAim({ name: "Bram" }, { engagement: engagement(["archer"]), ask })).toEqual([
				{ uuid: "Scene.s.Token.archer", name: "Archer", actorId: "archer", disposition: -1, hasActor: true },
			]);
			expect(ask).not.toHaveBeenCalled();
			const two = await strikeBackAim({ name: "Bram" }, { engagement: engagement(["wolf", "archer"]), ask });
			expect(two.map(t => t.name)).toEqual(["Archer"]);
			expect(ask).toHaveBeenCalledWith(expect.objectContaining({ roller: "Bram" }));
			expect(await strikeBackAim({ name: "Bram" }, { engagement: null, ask })).toEqual([]);
		});
	});

	// MOV-5: Amulets & Talismans from the damage card.
	describe("a charm (Amulets & Talismans)", () => {
		const blessedWith = (marks, { total = 10, owner = "pim" } = {}) => {
			const actor = {
				id: "eira", name: "Eira", type: "character", uuid: "Actor.eira", isOwner: true,
				items: [{ type: "move", name: "Amulets & Talismans" }],
				flags: { [SYSTEM_ID]: { blessedMarks: marks } },
				getFlag(scope, key) { return this.flags[scope]?.[key]; },
				testUserPermission: user => user.id === owner || user.isGM,
				typedActor: {
					onDirectStatRoll: vi.fn(async () => ({ total })),
					liftBlessedMark: vi.fn(async () => true),
				},
			};
			return actor;
		};
		const bram = { id: "bram", name: "Bram", type: "character", uuid: "Actor.bram", isOwner: true, flags: {}, items: [] };
		const charm = (extra = {}) => ({ id: "mark1", kind: "charm", uuid: "Actor.bram", name: "Bram", note: "fire", ...extra });
		const damage = () => ({ results: [{ uuid: "Token.bram", name: "Bram", raw: 8 }] });
		const nobody = () => ({ self: null, allies: [] });

		it("finds the charms a bearer wears, by document or by name, from a Blessed who has the move learned", () => {
			const eira = blessedWith([charm(), { id: "m2", kind: "barkskin", uuid: "Actor.bram", name: "Bram" }]);
			expect(charmsOn(bram, [eira])).toEqual([{ blessed: eira, mark: charm() }]);
			const byName = blessedWith([{ id: "m3", kind: "charm", name: "bram " }]);
			expect(charmsOn(bram, [byName]).map(c => c.mark.id)).toEqual(["m3"]);
			const unlearned = blessedWith([charm()]);
			unlearned.items = [{ type: "move", name: "Amulets & Talismans", flags: { [SYSTEM_ID]: { learned: false } } }];
			expect(charmsOn(bram, [unlearned])).toEqual([]);
		});

		it("offers the Charm spend on the bearer's row, naming the harm, once per blow", () => {
			const eira = blessedWith([charm({ extraHarm: "frost" })]);
			const offers = defendOffers(damage(), nobody, () => bram, () => null, who => charmsOn(who, [eira]));
			expect(offers.charm).toEqual([expect.objectContaining({ defender: eira, bearer: bram, harm: "fire or frost", cost: 0 })]);
			const tested = { ...damage(), charmedBy: [{ uuid: "Token.bram", how: "charm", tier: "failure" }] };
			expect(defendOffers(tested, nobody, () => bram, () => null, who => charmsOn(who, [eira])).charm).toEqual([]);
		});

		// The kept scan is dropped by stonetop.js's actor and item hooks (forgetWorldMarkScans).
		it("keeps the world's charm makers between renders until an actor or item changes", () => {
			const priorGame = globalThis.game;
			forgetWorldMarkScans();
			try {
				const eira = blessedWith([charm()]);
				globalThis.game = { user: null, actors: [eira] };
				const offered = () => defendOffers(damage(), nobody, () => bram, () => null).charm.length;
				expect(offered()).toBe(1);
				// Read from the kept list: the flags are not walked again on the next render.
				eira.flags[SYSTEM_ID].blessedMarks = [];
				expect(offered()).toBe(1);
				forgetWorldMarkScans();
				expect(offered()).toBe(0);
				// A swapped actors collection is read anew.
				globalThis.game = { user: null, actors: [blessedWith([charm()])] };
				expect(offered()).toBe(1);
			} finally {
				globalThis.game = priorGame;
				forgetWorldMarkScans();
			}
		});

		it("reads a 10+ as the blow ignored, a 7-9 as halved, and a 6- as nothing", () => {
			const at = tier => spentOn({ ...damage(), charmedBy: [{ uuid: "Token.bram", how: "charm", tier, move: "Amulets & Talismans" }] });
			expect(at("success").voided.get("Token.bram")).toEqual({ lineKey: "stonetop.fight.defend.charmIgnoredLine", move: "Amulets & Talismans" });
			expect([...at("partial").charmHalved]).toEqual(["Token.bram"]);
			expect(at("partial").voided.size).toBe(0);
			expect(at("failure").voided.size + at("failure").charmHalved.size).toBe(0);
			expect(defendNotes({ ...damage(), charmedBy: [{ uuid: "Token.bram", name: "Eira", how: "charm", tier: "partial" }] }))
				.toEqual([expect.stringContaining("only half the damage")]);
		});

		it("rolls the Blessed's +INT when their own player presses it, records the tier, and lifts the spent charm", async () => {
			const me = { ...PIM, character: { id: "eira" } };
			globalThis.game = { user: me, users: Object.assign([me], { get: id => (id === me.id ? me : null), activeGM: null }) };
			const eira = blessedWith([charm()], { total: 8 });
			const blow = card(damage());
			const [offer] = defendOffers(blow.flag, nobody, () => bram, () => null, who => charmsOn(who, [eira])).charm;
			expect(await spendOnBlow(blow, "charm", offer)).toBe(true);
			expect(eira.typedActor.onDirectStatRoll).toHaveBeenCalledWith("int", { moveName: "Amulets & Talismans", targets: [] });
			expect(blow.flag.charmedBy).toEqual([expect.objectContaining({ uuid: "Token.bram", how: "charm", tier: "partial", by: "Actor.eira" })]);
			expect(eira.typedActor.liftBlessedMark).toHaveBeenCalledWith("mark1");
			// Potent Workings' "retains its potency" keeps it on a 10+.
			const kept = blessedWith([charm({ retains: true })], { total: 11 });
			const other = card(damage());
			const [again] = defendOffers(other.flag, nobody, () => bram, () => null, who => charmsOn(who, [kept])).charm;
			expect(await spendOnBlow(other, "charm", again)).toBe(true);
			expect(spentOn(other.flag).voided.has("Token.bram")).toBe(true);
			expect(kept.typedActor.liftBlessedMark).not.toHaveBeenCalled();
		});

		it("asks the Blessed's player to roll it when someone else presses, and rolls nothing on a no", async () => {
			const eiraPlayer = { id: "pim", isGM: false, active: true, character: { id: "eira" }, query: vi.fn(async () => ({ tier: "partial" })) };
			const bramPlayer = { id: "bob", isGM: false, active: true, character: { id: "bram" } };
			const list = [GM, eiraPlayer, bramPlayer];
			globalThis.game = { user: bramPlayer, users: Object.assign([...list], { get: id => list.find(u => u.id === id) ?? null, activeGM: null }) };
			const eira = blessedWith([charm()]);
			const blow = card(damage());
			const [offer] = defendOffers(blow.flag, nobody, () => bram, () => null, who => charmsOn(who, [eira])).charm;
			expect(await spendOnBlow(blow, "charm", offer)).toBe(true);
			expect(eiraPlayer.query).toHaveBeenCalledWith(CHARM_QUERY, expect.objectContaining({ blessedId: "eira", markId: "mark1", ward: "Bram" }), expect.anything());
			// Rolled over there, not here.
			expect(eira.typedActor.onDirectStatRoll).not.toHaveBeenCalled();
			expect(spentOn(blow.flag).charmHalved.has("Token.bram")).toBe(true);
			eiraPlayer.query.mockResolvedValueOnce({ declined: true });
			const other = card(damage());
			expect(await spendOnBlow(other, "charm", offer)).toBe(false);
			expect(other.setFlag).not.toHaveBeenCalled();
		});

		it("answers the ask on the Blessed's player's client: rolls there, and lifts nothing until the card records it", async () => {
			const me = { id: "pim", isGM: false, active: true };
			const asker = { id: "bob", isGM: false, active: true };
			globalThis.game = { user: me, users: Object.assign([me, asker], { get: id => [me, asker].find(u => u.id === id) ?? null, activeGM: null }) };
			const eira = blessedWith([charm()], { total: 12 });
			const actors = { get: id => (id === "eira" ? eira : null) };
			const answer = await handleCharmQuery({ blessedId: "eira", markId: "mark1", ward: "Bram" }, { user: asker }, { actors, users: globalThis.game.users, confirm: async () => true });
			expect(answer).toEqual({ tier: "success" });
			expect(eira.typedActor.liftBlessedMark).not.toHaveBeenCalled();
			expect(await handleCharmQuery({ blessedId: "eira", markId: "gone", ward: "Bram" }, { user: asker }, { actors, users: globalThis.game.users, confirm: async () => true })).toBeNull();
		});

		it("uses up no charm when the card refuses the spend after the roll", async () => {
			const me = { ...PIM, character: { id: "eira" } };
			globalThis.game = { user: me, users: Object.assign([me], { get: id => (id === me.id ? me : null), activeGM: null }) };
			const eira = blessedWith([charm()], { total: 8 });
			const blow = card(damage());
			const [offer] = defendOffers(blow.flag, nobody, () => bram, () => null, who => charmsOn(who, [eira])).charm;
			// Someone else's charm roll landed on this blow first.
			blow.flag.charmedBy = [{ uuid: "Token.bram", how: "charm", tier: "failure" }];
			expect(await spendOnBlow(blow, "charm", offer)).toBe(false);
			expect(eira.typedActor.onDirectStatRoll).toHaveBeenCalled();
			expect(eira.typedActor.liftBlessedMark).not.toHaveBeenCalled();
		});

		it("asks whoever decides for the Blessed to use the charm up once the card records it, and they check the card", async () => {
			const eiraPlayer = { id: "pim", isGM: false, active: true, character: { id: "eira" }, query: vi.fn(async q => (q === CHARM_QUERY ? { tier: "partial" } : true)) };
			const bramPlayer = { id: "bob", isGM: false, active: true, character: { id: "bram" } };
			const list = [GM, eiraPlayer, bramPlayer];
			globalThis.game = { user: bramPlayer, users: Object.assign([...list], { get: id => list.find(u => u.id === id) ?? null, activeGM: null }) };
			const eira = blessedWith([charm()]);
			eira.isOwner = false;
			const blow = card(damage());
			const [offer] = defendOffers(blow.flag, nobody, () => bram, () => null, who => charmsOn(who, [eira])).charm;
			expect(await spendOnBlow(blow, "charm", offer)).toBe(true);
			expect(eiraPlayer.query).toHaveBeenLastCalledWith(CHARM_SETTLE_QUERY, expect.objectContaining({ blessedId: "eira", markId: "mark1", rowUuid: "Token.bram", tier: "partial" }), expect.anything());
			expect(eira.typedActor.liftBlessedMark).not.toHaveBeenCalled();
			// On the Blessed's player's client: settled only for a roll the card records.
			eira.isOwner = true;
			const deps = { actors: { get: id => (id === "eira" ? eira : null) }, messages: { get: () => blow } };
			expect(await handleCharmSettleQuery({ messageId: "m1", rowUuid: "Token.bram", blessedId: "eira", markId: "mark1", tier: "success" }, {}, deps)).toBe(false);
			expect(eira.typedActor.liftBlessedMark).not.toHaveBeenCalled();
			expect(await handleCharmSettleQuery({ messageId: "m1", rowUuid: "Token.bram", blessedId: "eira", markId: "mark1", tier: "partial" }, {}, deps)).toBe(true);
			expect(eira.typedActor.liftBlessedMark).toHaveBeenCalledWith("mark1");
		});

		it("records a relayed charm on the GM's client with the tier the asker rolled, and nothing without one", async () => {
			const eira = blessedWith([charm()]);
			const blow = card(damage());
			globalThis.game = { user: GM, users: { get: id => [GM, PIM].find(u => u.id === id) ?? null, activeGM: GM } };
			const deps = {
				messages: { get: () => blow }, users: { get: id => [GM, PIM].find(u => u.id === id) ?? null },
				offersOf: d => defendOffers(d, nobody, () => bram, () => null, who => charmsOn(who, [eira])),
			};
			const data = { messageId: "m1", kind: "charm", rowUuid: "Token.bram", defenderUuid: "Actor.eira", markId: "mark1" };
			expect(await handleSpendQuery(data, { user: PIM }, deps)).toBe(false);
			expect(eira.typedActor.liftBlessedMark).not.toHaveBeenCalled();
			expect(await handleSpendQuery({ ...data, tier: "success" }, { user: PIM }, deps)).toBe(true);
			expect(spentOn(blow.flag).voided.has("Token.bram")).toBe(true);
			// The GM can write the Blessed, so the charm is used up there and then.
			expect(eira.typedActor.liftBlessedMark).toHaveBeenCalledWith("mark1");
		});

		it("relays which charm was rolled, so the GM's client records and lifts that one when a Blessed laid two", async () => {
			const eira = blessedWith([charm({ id: "fire", note: "fire" }), charm({ id: "poison", note: "poison" })]);
			const blow = card(damage());
			globalThis.game = { user: GM, users: { get: id => [GM, PIM].find(u => u.id === id) ?? null, activeGM: GM } };
			const deps = {
				messages: { get: () => blow }, users: { get: id => [GM, PIM].find(u => u.id === id) ?? null },
				offersOf: d => defendOffers(d, nobody, () => bram, () => null, who => charmsOn(who, [eira])),
			};
			const data = { messageId: "m1", kind: "charm", rowUuid: "Token.bram", defenderUuid: "Actor.eira", tier: "partial" };
			expect(await handleSpendQuery({ ...data, markId: "gone" }, { user: PIM }, deps)).toBe(false);
			expect(await handleSpendQuery({ ...data, markId: "poison" }, { user: PIM }, deps)).toBe(true);
			expect(blow.flag.charmedBy).toEqual([expect.objectContaining({ markId: "poison", bearerUuid: "Actor.bram" })]);
			expect(eira.typedActor.liftBlessedMark).toHaveBeenCalledWith("poison");
			expect(eira.typedActor.liftBlessedMark).not.toHaveBeenCalledWith("fire");
		});

		it("sends the charm's id when a player's charm spend is relayed to the GM", async () => {
			const gm = { ...GM, query: vi.fn(async () => true) };
			const me = { ...PIM, character: { id: "eira" } };
			globalThis.game = { user: me, users: Object.assign([gm, me], { get: id => [gm, me].find(u => u.id === id) ?? null, activeGM: gm }) };
			const eira = blessedWith([charm({ id: "fire" }), charm({ id: "poison" })], { total: 8 });
			const blow = card(damage());
			const offers = defendOffers(blow.flag, nobody, () => bram, () => null, who => charmsOn(who, [eira])).charm;
			const poison = offers.find(o => o.mark.id === "poison");
			await spendOnBlow(blow, "charm", poison, { relay: true });
			expect(gm.query).toHaveBeenCalledWith(SPEND_QUERY, expect.objectContaining({ kind: "charm", markId: "poison", tier: "partial" }), expect.anything());
		});

		it("does not let a ward's charm halve a blow a stand-in now takes, and offers the stand-in's own charm", () => {
			const wren = { id: "wren", name: "Wren", type: "character", uuid: "Actor.wren", isOwner: true, flags: {}, items: [] };
			const eira = blessedWith([charm(), charm({ id: "mark2", uuid: "Actor.wren", name: "Wren" })]);
			const wardCharm = { uuid: "Token.bram", how: "charm", tier: "partial", by: "Actor.eira", bearerUuid: "Actor.bram", markId: "mark1" };
			const standIn = { uuid: "Token.bram", how: "standIn", by: "Actor.wren", name: "Wren" };
			// The ward's 7-9 halves while the ward takes it.
			expect(spentOn({ ...damage(), charmedBy: [wardCharm] }).charmHalved.has("Token.bram")).toBe(true);
			// Once Wren stands in, it no longer does, and Wren's own charm is offered.
			const stood = { ...damage(), charmedBy: [wardCharm], standIns: [standIn] };
			expect(spentOn(stood).charmHalved.has("Token.bram")).toBe(false);
			const resolve = uuid => (uuid === "Actor.wren" ? wren : bram);
			const offers = defendOffers(stood, nobody, resolve, () => null, who => charmsOn(who, [eira])).charm;
			expect(offers.map(o => [o.bearer.id, o.mark.id])).toEqual([["wren", "mark2"]]);
			// Wren's own 7-9 halves it.
			const wrenCharm = { uuid: "Token.bram", how: "charm", tier: "partial", by: "Actor.eira", bearerUuid: "Actor.wren", markId: "mark2" };
			expect(spentOn({ ...stood, charmedBy: [wardCharm, wrenCharm] }).charmHalved.has("Token.bram")).toBe(true);
			// A spend written before the bearer was kept counts as it always did.
			expect(spentOn({ ...stood, charmedBy: [{ uuid: "Token.bram", how: "charm", tier: "partial" }] }).charmHalved.has("Token.bram")).toBe(true);
		});

		it("records a stand-in's own charm on a blow whose ward already rolled one", async () => {
			const wren = { id: "wren", name: "Wren", type: "character", uuid: "Actor.wren", isOwner: true, flags: {}, items: [] };
			const me = { ...PIM, character: { id: "eira" } };
			globalThis.game = { user: me, users: Object.assign([me], { get: id => (id === me.id ? me : null), activeGM: null }) };
			const eira = blessedWith([charm({ id: "mark2", uuid: "Actor.wren", name: "Wren" })], { total: 8 });
			const blow = card({ ...damage(),
				charmedBy: [{ uuid: "Token.bram", how: "charm", tier: "partial", by: "Actor.eira", bearerUuid: "Actor.bram", markId: "mark1" }],
				standIns: [{ uuid: "Token.bram", how: "standIn", by: "Actor.wren", name: "Wren" }] });
			const resolve = uuid => (uuid === "Actor.wren" ? wren : bram);
			const [offer] = defendOffers(blow.flag, nobody, resolve, () => null, who => charmsOn(who, [eira])).charm;
			expect(await spendOnBlow(blow, "charm", offer)).toBe(true);
			expect(blow.flag.charmedBy).toHaveLength(2);
		});
	});
});

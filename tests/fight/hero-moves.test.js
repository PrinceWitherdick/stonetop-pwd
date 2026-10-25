import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { undauntedNow, undauntedOffer, undauntedUnread, eyesLockedAgainst, lockEyes, lockEyesCandidates, dangerousMode, leapIn, leapInOpen, blowOffers, HERO_MOVES, LOCKED_EYES_FLAG, LEAPT_IN_FLAG } from "../../module/fight/hero-moves.js";
import { asteriskMoveUsed } from "../../module/actors/character/WouldBeHeroAsterisk.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

// Playbook moves the fight turns on: Undaunted and Big Damn Hero (the Would-Be Hero).

let saved;
beforeEach(() => {
	saved = { game: globalThis.game, ui: globalThis.ui, canvas: globalThis.canvas, CONST: globalThis.CONST };
	globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
});
afterEach(() => { Object.assign(globalThis, saved); });

const withMoves = (actor, moves) => Object.assign(actor, { items: moves.map(name => ({ type: "move", name })) });

/** Pim (a Would-Be Hero) at (1,1); whoever else stands where the caller puts them. */
function world(others = []) {
	const pim = withMoves(fakeActor({ id: "pim", name: "Pim", type: "character" }), ["Undaunted", "Big Damn Hero"]);
	const token = (id, col, row, actor) => Object.assign(fakeToken({ id, col, row, actor }), { uuid: `Scene.scene1.Token.${id}` });
	const tokens = { pim: token("tPim", 1, 1, pim) };
	for (const [key, col, row, actor] of others) tokens[key] = token(`t${key}`, col, row, actor);
	const scene = fakeScene({ tokens: Object.values(tokens) });
	const combatants = Object.fromEntries(Object.entries(tokens).map(([key, t]) => [key, Object.assign(fakeCombatant({ id: `c${key}`, token: t, scene }), {
		update: vi.fn(async function (changes) {
			for (const [path, value] of Object.entries(changes)) this.flags[SYSTEM_ID][path.replace(`flags.${SYSTEM_ID}.`, "")] = value;
		}),
	})]));
	const combat = fakeCombat({ scene, combatants: Object.values(combatants) });
	globalThis.game = { ...saved.game, user: { id: "gm", isGM: true }, users: collection([]), combats: collection([combat]), settings: { get: (_s, key) => (key === "fightTab" ? true : undefined) } };
	globalThis.ui = { combat: { viewed: combat } };
	globalThis.canvas = { scene };
	return { pim, tokens, combatants };
}

const wolf = (id = "wolf") => fakeActor({ id, name: "Wolf", type: "monster" });

describe("Undaunted", () => {
	// The user's ruling (2026-09-27): where the fight does not show it holding, the +1d6 is the table's to
	// call, an UNTICKED line; the ticked line stays for where it does.
	it("is not imposed against one foe their size, and is offered unticked for the table to call", () => {
		const { pim } = world([["w", 2, 1, wolf()]]);
		expect(undauntedNow(pim)).toBeNull();
		expect(undauntedUnread(pim)).toBe(true);
		expect(undauntedOffer(pim)).toMatchObject({
			key: "undaunted", dice: "1d6", applied: false,
			label: "Undaunted: +1d6 damage, if you are outnumbered or facing a foe bigger than you",
		});
	});

	it("is offered unticked with no fight to read (the Fight tab off), and never without the move", () => {
		const { pim } = world([["w1", 2, 1, wolf("w1")], ["w2", 0, 1, wolf("w2")]]);
		globalThis.game.settings = { get: () => false };
		expect(undauntedNow(pim)).toBeNull();
		expect(undauntedOffer(pim)).toMatchObject({ key: "undaunted", applied: false });
		pim.items = [];
		expect(undauntedUnread(pim)).toBe(false);
		expect(undauntedOffer(pim)).toBeNull();
		pim.items = [{ type: "move", name: "Undaunted", flags: { [SYSTEM_ID]: { learned: false } } }];
		expect(undauntedOffer(pim)).toBeNull();
	});

	it("is on when they are outnumbered", () => {
		const { pim } = world([["w1", 2, 1, wolf("w1")], ["w2", 0, 1, wolf("w2")]]);
		expect(undauntedNow(pim)).toBe("outnumbered");
		expect(undauntedUnread(pim)).toBe(false);
		expect(undauntedOffer(pim)).toMatchObject({ key: "undaunted", dice: "1d6", label: "Undaunted: +1d6 damage, while you are outnumbered", pill: "Undaunted +1d6", applied: true });
	});

	it("is on facing a foe bigger than them", () => {
		const drake = fakeActor({ id: "drake", name: "Drake", type: "monster", system: { size: "large" } });
		const { pim } = world([["d", 2, 1, drake]]);
		expect(undauntedNow(pim)).toBe("bigger");
	});

	it("is off for a character without the move", () => {
		const { pim } = world([["w1", 2, 1, wolf("w1")], ["w2", 0, 1, wolf("w2")]]);
		pim.items = [];
		expect(undauntedNow(pim)).toBeNull();
	});
});

describe("Big Damn Hero", () => {
	it("locks eyes with a foe they are fighting, once", async () => {
		const { pim, combatants } = world([["w", 2, 1, wolf()]]);
		expect(lockEyesCandidates(pim).map(c => c.id)).toEqual(["cw"]);
		expect(await lockEyes(pim, "cw")).toBe(true);
		expect(combatants.pim.flags[SYSTEM_ID][LOCKED_EYES_FLAG]).toEqual(["cw"]);
		expect(await lockEyes(pim, "cw")).toBe(false);
		expect(lockEyesCandidates(pim)).toEqual([]);
	});

	it("puts that foe's damage against the hero and whoever stands beside them at disadvantage, and nobody else", () => {
		const cadi = fakeActor({ id: "cadi", name: "Cadi", type: "character" });
		const far = fakeActor({ id: "far", name: "Far", type: "character" });
		const { tokens, combatants } = world([["w", 2, 1, wolf()], ["cadi", 1, 2, cadi], ["far", 8, 8, far]]);
		combatants.pim.flags[SYSTEM_ID][LOCKED_EYES_FLAG] = ["cw"];
		const foe = { ...tokens.w.actor, token: tokens.w };
		expect(eyesLockedAgainst(foe, [{ uuid: tokens.pim.uuid }])).toEqual(["Pim"]);
		expect(eyesLockedAgainst(foe, [{ uuid: tokens.cadi.uuid }])).toEqual(["Pim"]);
		expect(eyesLockedAgainst(foe, [{ uuid: tokens.far.uuid }])).toEqual([]);
		combatants.pim.flags[SYSTEM_ID][LOCKED_EYES_FLAG] = [];
		expect(eyesLockedAgainst(foe, [{ uuid: tokens.pim.uuid }])).toEqual([]);
	});

	// A19: one roll per card, so a blow at the hero AND at someone the hero is not guarding is not at
	// disadvantage, as incomingMode asks of every other mode ("EVERY TARGET MUST CARRY IT").
	it("puts a blow at several at disadvantage only when every one of them is guarded", () => {
		const cadi = fakeActor({ id: "cadi", name: "Cadi", type: "character" });
		const far = fakeActor({ id: "far", name: "Far", type: "character" });
		const { tokens, combatants } = world([["w", 2, 1, wolf()], ["cadi", 1, 2, cadi], ["far", 8, 8, far]]);
		combatants.pim.flags[SYSTEM_ID][LOCKED_EYES_FLAG] = ["cw"];
		const foe = { ...tokens.w.actor, token: tokens.w };
		expect(eyesLockedAgainst(foe, [{ uuid: tokens.pim.uuid }, { uuid: tokens.cadi.uuid }])).toEqual(["Pim"]);
		expect(eyesLockedAgainst(foe, [{ uuid: tokens.pim.uuid }, { uuid: tokens.far.uuid }])).toEqual([]);
		expect(eyesLockedAgainst(foe, [{ uuid: tokens.far.uuid }, { uuid: tokens.pim.uuid }])).toEqual([]);
	});

	// "When you first leap into danger to protect someone, don't roll to Defend. Instead, treat it as
	// though you rolled a 10+." Once per fight, on the combatant.
	it("leaps in once per fight: Defend's 10+ with no roll, a card naming the move", async () => {
		const { pim, combatants } = world([["w", 2, 1, wolf()]]);
		const posted = [];
		globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: () => ({}) };
		const character = { settleDefendReadinessTier: vi.fn(async () => ({ prior: 0, set: 3 })) };
		expect(leapInOpen(pim)).toBe(true);
		expect(await leapIn(pim, { character })).toBe(true);
		expect(character.settleDefendReadinessTier).toHaveBeenCalledWith("success");
		expect(combatants.pim.flags[SYSTEM_ID][LEAPT_IN_FLAG]).toBe(true);
		expect(posted[0].content).toContain("Big Damn Hero");
		expect(posted[0].content).toContain("Pim leaps into danger to protect someone");
		// Spent for this fight: neither offered nor made again.
		expect(leapInOpen(pim)).toBe(false);
		expect(await leapIn(pim, { character })).toBe(false);
		expect(character.settleDefendReadinessTier).toHaveBeenCalledTimes(1);
		delete globalThis.ChatMessage;
	});

	it("offers the leap every time with no fight to keep count on, saying so, and never unlearned", async () => {
		const { pim } = world([["w", 2, 1, wolf()]]);
		globalThis.game.settings = { get: () => false };
		const posted = [];
		globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: () => ({}) };
		const character = { settleDefendReadinessTier: vi.fn(async () => null) };
		expect(await leapIn(pim, { character })).toBe(true);
		expect(leapInOpen(pim)).toBe(true);
		expect(posted[0].content).toContain("No fight on the map to keep count");
		pim.items = [{ type: "move", name: "Big Damn Hero", flags: { [SYSTEM_ID]: { learned: false } } }];
		expect(leapInOpen(pim)).toBe(false);
		expect(await leapIn(pim, { character })).toBe(false);
		delete globalThis.ChatMessage;
	});
});

// The asterisk (the user's ruling, 2026-09-27): the first USE of a starred move crosses off "Would-be". The
// fight's use points: Undaunted's +1d6 taken (its `spend`, ticked by the fight or by the table), Big Damn
// Hero's locked eyes and its leap. Learned copies only, and a Would-Be Hero's only.
describe("the Would-Be Hero's asterisk, in a fight", () => {
	/** Pim made a Would-Be Hero (by slug) with a flag store. */
	const asWouldBe = (pim, slug = "the-would-be-hero") => {
		const flags = {};
		return Object.assign(pim, {
			system: { ...pim.system, playbook: { name: "The Would-Be Hero", slug } },
			getFlag: (_s, key) => flags[key],
			setFlag: vi.fn(async (_s, key, value) => { flags[key] = value; }),
		});
	};
	let posted;
	beforeEach(() => {
		posted = [];
		globalThis.ChatMessage = { create: vi.fn(async data => posted.push(data)), getSpeaker: () => ({}) };
	});
	afterEach(() => { delete globalThis.ChatMessage; });
	const crossed = () => posted.filter(p => p.content.includes("A Would-Be Hero No Longer"));

	it("locking eyes crosses off \"Would-be\", once", async () => {
		const { pim } = world([["w", 2, 1, wolf()], ["w2", 3, 1, wolf("w2")]]);
		asWouldBe(pim);
		expect(await lockEyes(pim, "cw")).toBe(true);
		expect(pim.setFlag).toHaveBeenCalledWith(SYSTEM_ID, "wbhBecameHero", true);
		expect(crossed()).toHaveLength(1);
		expect(crossed()[0].content).toContain("Big Damn Hero");
		expect(await lockEyes(pim, "cw2")).toBe(true);
		expect(crossed()).toHaveLength(1);
	});

	it("the leap crosses off \"Would-be\"", async () => {
		const { pim } = world([["w", 2, 1, wolf()]]);
		asWouldBe(pim);
		expect(await leapIn(pim, { character: { settleDefendReadinessTier: vi.fn(async () => null) } })).toBe(true);
		expect(crossed()).toHaveLength(1);
	});

	it("Undaunted's +1d6 taken crosses it off, the unticked line (the table's call) as much as the ticked", async () => {
		const { pim } = world([["w", 2, 1, wolf()]]);
		asWouldBe(pim);
		const offer = undauntedOffer(pim);
		expect(offer.applied).toBe(false);
		await offer.spend(pim);
		expect(crossed()).toHaveLength(1);
		await offer.spend(pim);
		expect(crossed()).toHaveLength(1);
	});

	it("an un-learned copy, or a hero of another playbook, crosses nothing off", async () => {
		const { pim } = world([["w", 2, 1, wolf()]]);
		asWouldBe(pim, "the-heavy");
		await undauntedOffer(pim).spend(pim);
		await leapIn(pim, { character: {} });
		expect(pim.setFlag).not.toHaveBeenCalled();
		expect(crossed()).toHaveLength(0);

		const other = world([["w", 2, 1, wolf()]]).pim;
		asWouldBe(other);
		other.items = [{ type: "move", name: "Big Damn Hero", flags: { [SYSTEM_ID]: { learned: false } } }];
		expect(await asteriskMoveUsed(other, HERO_MOVES.BIG_DAMN_HERO)).toBe(false);
		expect(other.setFlag).not.toHaveBeenCalled();
	});
});

describe("Dangerous", () => {
	const heavy = () => withMoves(fakeActor({ id: "bram", name: "Bram", type: "character" }), ["Dangerous", "Hard to Kill"]);

	it("gives the Heavy's own damage advantage, whatever the roll opened on", () => {
		expect(dangerousMode(heavy(), "")).toBe("adv");
		expect(dangerousMode(heavy(), null)).toBe("adv");
		expect(dangerousMode(heavy(), "normal")).toBe("adv");
		expect(dangerousMode(heavy(), "adv")).toBe("adv");
	});

	it("cancels a strike back's disadvantage into a straight roll", () => {
		expect(dangerousMode(heavy(), "dis")).toBe("normal");
	});

	it("leaves everyone without the move alone, and never reaches a monster", () => {
		const pim = withMoves(fakeActor({ id: "pim", name: "Pim", type: "character" }), ["Undaunted"]);
		expect(dangerousMode(pim, "")).toBe("");
		expect(dangerousMode(pim, "dis")).toBe("dis");
		const brute = withMoves(fakeActor({ id: "m", name: "Brute", type: "monster" }), ["Dangerous"]);
		expect(dangerousMode(brute, "")).toBe("");
	});
});

/** A Would-Be Hero with `moves`, a flag store, and a Resolve track that `setUses` really writes. */
function wouldBe(moves, { resolve = 0, readiness = 0 } = {}) {
	const flags = { [SYSTEM_ID]: { readiness } };
	const held = { [HERO_MOVES.ANGER]: resolve };
	const actor = Object.assign(fakeActor({ id: "pim", name: "Pim", type: "character", flags }), {
		items: moves.map(move => (typeof move === "string" ? { type: "move", name: move } : move)),
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { flags[scope][key] = value; }),
	});
	const setUses = vi.fn(async (name, value) => { held[name] = value; });
	actor.typedActor = { moveResources: { getMoveResources: () => held, setUses } };
	return { actor, held, flags, setUses };
}

const anger = (max = 2, extra = {}) => ({ type: "move", name: HERO_MOVES.ANGER, system: { resource: { max, title: "Resolve" } }, ...extra });

describe("Anger is a Gift's strike hard", () => {
	it("takes its Resolve off the count held when it is TAKEN, not the count the window opened on", async () => {
		const { actor, held, setUses } = wouldBe([anger()], { resolve: 1 });
		const offer = blowOffers(actor, {}).find(o => o.key === "anger");
		expect(offer).toMatchObject({ dice: "1d4", applied: false, tags: ["forceful"] });
		// Speak Truth's +1 lands while the damage window is open.
		held[HERO_MOVES.ANGER] = 2;
		await offer.spend(actor);
		expect(setUses).toHaveBeenCalledWith(HERO_MOVES.ANGER, 1, { stonetopMove: HERO_MOVES.ANGER });
		expect(held[HERO_MOVES.ANGER]).toBe(1);
	});

	it("writes nothing when the Resolve was spent by hand while the window was open", async () => {
		const { actor, held, setUses } = wouldBe([anger()], { resolve: 1 });
		const offer = blowOffers(actor, {}).find(o => o.key === "anger");
		held[HERO_MOVES.ANGER] = 0;
		await offer.spend(actor);
		expect(setUses).not.toHaveBeenCalled();
		expect(held[HERO_MOVES.ANGER]).toBe(0);
	});

	it("reads the track's max off the LEARNED copy, not a switched-off one listed first", async () => {
		const off = anger(1, { flags: { [SYSTEM_ID]: { learned: false } } });
		const { actor, held } = wouldBe([off, anger(2)], { resolve: 2 });
		const offer = blowOffers(actor, {}).find(o => o.key === "anger");
		await offer.spend(actor);
		expect(held[HERO_MOVES.ANGER]).toBe(1);
	});
});

// "When you spend Readiness (from Defend) to strike back at an attacker, you deal +1d4 damage and scar,
// mark, or diminish them." The user's ruling (2026-10-18): with no fight ring to say a blow is a strike
// back, a hero holding Readiness is offered it unticked, and ticking it spends the Readiness.
describe("Something to Remember Me By, off the fight ring", () => {
	const keys = (actor, options) => blowOffers(actor, options).map(o => o.key);

	it("is offered unticked only to a hero with the move learned, holding Readiness, on a blow not rolled as a strike back", () => {
		const { actor } = wouldBe([HERO_MOVES.REMEMBER_ME], { readiness: 2 });
		// Ticked, it makes the blow a strike back: "deal your damage, with disadvantage" (p.216).
		expect(blowOffers(actor, {}).find(o => o.key === "rememberMeSpend")).toMatchObject({
			dice: "1d4", applied: false, mode: "dis", strikeBack: true,
			label: "Something to Remember Me By, struck back with disadvantage (spend 1 Readiness): +1d4 damage, and you scar, mark or diminish them",
			pill: "Something to Remember Me By +1d4",
		});
		expect(keys(wouldBe([HERO_MOVES.REMEMBER_ME], { readiness: 0 }).actor, {})).not.toContain("rememberMeSpend");
		expect(keys(wouldBe([], { readiness: 2 }).actor, {})).not.toContain("rememberMeSpend");
		const unlearned = { type: "move", name: HERO_MOVES.REMEMBER_ME, flags: { [SYSTEM_ID]: { learned: false } } };
		expect(keys(wouldBe([unlearned], { readiness: 2 }).actor, {})).not.toContain("rememberMeSpend");
	});

	it("spends exactly 1 Readiness when it is taken, re-read then and never below none", async () => {
		const { actor, flags } = wouldBe([HERO_MOVES.REMEMBER_ME], { readiness: 2 });
		const offer = blowOffers(actor, {}).find(o => o.key === "rememberMeSpend");
		expect(actor.setFlag).not.toHaveBeenCalled();
		// A Defend's hold lands while the window is open: the spend comes off what is held now.
		flags[SYSTEM_ID].readiness = 3;
		await offer.spend(actor);
		expect(actor.setFlag).toHaveBeenCalledTimes(1);
		expect(actor.setFlag).toHaveBeenCalledWith(SYSTEM_ID, "readiness", 2);
		// Spent elsewhere in the meantime: nothing is written.
		flags[SYSTEM_ID].readiness = 0;
		await offer.spend(actor);
		expect(actor.setFlag).toHaveBeenCalledTimes(1);
		expect(flags[SYSTEM_ID].readiness).toBe(0);
	});

	// Combat audit MOV-8 (2026-10-23): an attack move's own damage is the attack, never a strike back.
	it("is not offered on an attack move's damage window", () => {
		const { actor } = wouldBe([HERO_MOVES.REMEMBER_ME], { readiness: 2 });
		for (const moveKey of ["clash", "let-fly", "ambush"]) expect(keys(actor, { moveKey })).not.toContain("rememberMeSpend");
		expect(keys(actor, {})).toContain("rememberMeSpend");
	});

	it("leaves the ring's strike back as it was: ticked, costing nothing more, and no second line", () => {
		const { actor } = wouldBe([HERO_MOVES.REMEMBER_ME], { readiness: 2 });
		const offers = blowOffers(actor, { strikeBack: true });
		expect(offers.map(o => o.key)).not.toContain("rememberMeSpend");
		const line = offers.find(o => o.key === "rememberMe");
		expect(line).toMatchObject({ dice: "1d4", applied: true });
		expect(line.spend).toBeUndefined();
	});
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	HERO_MOVES, CLASHED_FLAG, HARMED_BY_FLAG, KNOCKED_DOWN_FLAG,
	foeKey, recordClash, clashedBefore, relentlessAgainst, foeAdvantage,
	recordHarmedBy, clearHarmedBy, paybackEarned, recordKnockedDownBy, clearKnockedDownBy,
	muscleboundWeapon, berserkNow, blowOffers, defenderDisadvantage, dangerousMode,
} from "../../module/fight/hero-moves.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

// The playbook moves that change a blow's number: what they add, what they remember, and what they
// leave alone. The fight facts they read are the Fight tab's own (engagements.js).

let saved;
beforeEach(() => {
	saved = { game: globalThis.game, ui: globalThis.ui, canvas: globalThis.canvas, CONST: globalThis.CONST, fromUuidSync: globalThis.fromUuidSync };
	globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
});
afterEach(() => { Object.assign(globalThis, saved); });

/** A character with `moves`, a flag store, and whatever else the caller needs. */
function hero(name, moves, extra = {}) {
	const flags = { [SYSTEM_ID]: {} };
	return {
		...fakeActor({ id: name, name, type: "character" }),
		items: moves.map(move => (typeof move === "string" ? { type: "move", name: move } : move)),
		flags,
		getFlag: (scope, key) => flags[scope]?.[key],
		setFlag: vi.fn(async (scope, key, value) => { flags[scope][key] = value; }),
		system: { attributes: { hp: { value: 20, max: 20 } } },
		...extra,
	};
}

/** An unlinked monster token and the world actor behind it, with `fromUuidSync` wired to both. */
function mapWith(rows) {
	const byUuid = new Map();
	const tokens = {};
	for (const [key, actor, linked] of rows) {
		const token = Object.assign(fakeToken({ id: `t${key}`, col: 1, row: 1, actor }), {
			uuid: `Scene.scene1.Token.t${key}`, documentName: "Token", name: actor.name, actorLink: !!linked,
			// `documentName` is how the key tells a token from the actor behind it, as core's documents do.
			actor: Object.assign(actor, {
				documentName: "Actor",
				token: linked ? null : { uuid: `Scene.scene1.Token.t${key}` },
				uuid: linked ? `Actor.${actor.id}` : `Scene.scene1.Token.t${key}.Actor.${actor.id}`,
			}),
		});
		tokens[key] = token;
		byUuid.set(token.uuid, token);
		byUuid.set(token.actor.uuid, token.actor);
	}
	globalThis.fromUuidSync = uuid => byUuid.get(uuid) ?? null;
	return tokens;
}

const target = token => ({ uuid: token.uuid, name: token.name, actorId: token.actor?.id ?? null });

describe("remembering a foe", () => {
	it("keys an unlinked token by the token and a linked one by its actor, from either end", () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })], ["chief", fakeActor({ id: "chief", name: "Chief", type: "monster" }), true]]);
		// A row aimed at it, and the actor that struck you, have to key the same.
		expect(foeKey(target(t.crin))).toBe(t.crin.uuid);
		expect(foeKey(t.crin.actor)).toBe(t.crin.uuid);
		expect(foeKey(target(t.chief))).toBe("Actor.chief");
		expect(foeKey(t.chief.actor)).toBe("Actor.chief");
	});

	it("writes down the foes a Clash was aimed at, once each, for Nemesis and Relentless", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })]]);
		const bram = hero("Bram", [HERO_MOVES.NEMESIS, HERO_MOVES.RELENTLESS]);
		expect(await recordClash(bram, [target(t.crin)], { now: 100 })).toBe(true);
		expect(await recordClash(bram, [target(t.crin)], { now: 200 })).toBe(false);
		expect(bram.getFlag(SYSTEM_ID, CLASHED_FLAG)).toEqual([{ key: t.crin.uuid, name: "Crinwin", since: 100 }]);
	});

	it("writes nothing for a character with neither move", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })]]);
		const pim = hero("Pim", ["Undaunted"]);
		expect(await recordClash(pim, [target(t.crin)])).toBe(false);
		expect(pim.setFlag).not.toHaveBeenCalled();
	});

	it("gives Relentless advantage on the NEXT Clash with a foe who survived, and not the first", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })]]);
		const bram = hero("Bram", [HERO_MOVES.RELENTLESS]);
		const rows = [target(t.crin)];
		expect(relentlessAgainst(bram, rows)).toBeNull();
		await recordClash(bram, rows);
		expect(clashedBefore(bram, rows)).toBe(true);
		expect(relentlessAgainst(bram, rows)).toBe(HERO_MOVES.RELENTLESS);
		// Only on a Clash: the move says "the next time you Clash with them".
		expect(foeAdvantage(bram, rows, { clash: false })).toBeNull();
		expect(foeAdvantage(bram, rows, { clash: true })).toBe(HERO_MOVES.RELENTLESS);
	});
});

describe("what a blow adds", () => {
	const crinRows = () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })]]);
		return { t, rows: [target(t.crin)] };
	};

	it("rides Nemesis on the attacks AFTER the Clash that earned it, never that Clash's own damage", async () => {
		const { rows } = crinRows();
		const bram = hero("Bram", [HERO_MOVES.NEMESIS]);
		await recordClash(bram, rows, { now: 1000 });
		const keys = at => blowOffers(bram, { targets: rows, attackAt: at }).map(o => o.key);
		expect(keys(900)).not.toContain("nemesis");
		expect(keys(2000)).toContain("nemesis");
	});

	it("earns Payback from a foe that harmed the character, and forgets it when the fight ends", async () => {
		const { t, rows } = crinRows();
		const bram = hero("Bram", [HERO_MOVES.PAYBACK]);
		globalThis.game = { ...saved.game, combats: collection([]), settings: { get: () => true } };
		globalThis.ui = { combat: {} };
		globalThis.canvas = { scene: null };
		expect(paybackEarned(bram, rows)).toBe(false);
		await recordHarmedBy(bram, t.crin.actor);
		expect(bram.getFlag(SYSTEM_ID, HARMED_BY_FLAG)).toEqual([t.crin.uuid]);
		expect(paybackEarned(bram, rows)).toBe(true);
		const offer = blowOffers(bram, { targets: rows }).find(o => o.key === "payback");
		expect(offer).toMatchObject({ dice: "1d4", applied: true });
		await clearHarmedBy(bram);
		expect(paybackEarned(bram, rows)).toBe(false);
	});

	it("offers the Ranger's weak spot UNTICKED, and only against something large or huge", () => {
		const big = fakeActor({ id: "drake", name: "Drake", type: "monster", system: { size: "large" } });
		const t = mapWith([["drake", big], ["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster", system: { size: "small" } })]]);
		const wren = hero("Wren", [HERO_MOVES.BIG_GAME]);
		expect(blowOffers(wren, { targets: [target(t.crin)] }).map(o => o.key)).not.toContain("bigGame");
		const offer = blowOffers(wren, { targets: [target(t.drake)] }).find(o => o.key === "bigGame");
		expect(offer).toMatchObject({ dice: "2", applied: false });
		// Giant Slayer is "another +2 (+4 total)", not a second line.
		const giant = hero("Wren", [HERO_MOVES.BIG_GAME, HERO_MOVES.GIANT_SLAYER]);
		expect(blowOffers(giant, { targets: [target(t.drake)] }).filter(o => o.key === "bigGame")).toEqual([expect.objectContaining({ dice: "4" })]);
	});

	it("offers Anger is a Gift's strike hard untucked, and marks the Resolve off only when it is taken", async () => {
		const setUses = vi.fn(async () => {});
		const heldSoFar = { "Anger is a Gift": 2 };
		const pim = hero("Pim", [{ type: "move", name: HERO_MOVES.ANGER, system: { resource: { max: 2, title: "Resolve" } } }], {
			typedActor: { moveResources: { getMoveResources: () => heldSoFar, setUses } },
		});
		const offer = blowOffers(pim, {}).find(o => o.key === "anger");
		expect(offer).toMatchObject({ dice: "1d4", applied: false, tags: ["forceful"] });
		await offer.spend(pim);
		// The track counts Resolve HELD: two held, one spent, one left.
		expect(setUses).toHaveBeenCalledWith(HERO_MOVES.ANGER, 1, { stonetopMove: HERO_MOVES.ANGER });
		// Nothing left to spend, nothing offered.
		heldSoFar["Anger is a Gift"] = 0;
		expect(blowOffers(pim, {}).map(o => o.key)).not.toContain("anger");
	});

	it("draws the fiction-gated lines only against the kind of foe they name", () => {
		const t = mapWith([
			["shade", fakeActor({ id: "shade", name: "Shade", type: "monster", system: { tags: "solitary, undead, terrifying" } })],
			["bandit", fakeActor({ id: "bandit", name: "Bandit", type: "monster", system: { tags: "group, organized" } })],
			["thing", fakeActor({ id: "thing", name: "Thing", type: "monster", system: { tags: "solitary, corrupted" } })],
		]);
		const judge = hero("Hafgan", [HERO_MOVES.DOG_WITH_BONE]);
		expect(blowOffers(judge, { targets: [target(t.thing)] }).find(o => o.key === "dogWithBone")).toMatchObject({ dice: "1d6", applied: true });
		expect(blowOffers(judge, { targets: [target(t.bandit)] }).map(o => o.key)).not.toContain("dogWithBone");

		const seeker = hero("Maelis", [HERO_MOVES.EVERYTHING_BLEEDS]);
		// Unticked: the stat block says it is unnatural; whether this blow exploited a weakness is theirs.
		expect(blowOffers(seeker, { targets: [target(t.shade)] }).find(o => o.key === "everythingBleeds")).toMatchObject({ applied: false });
		expect(blowOffers(seeker, { targets: [target(t.bandit)] }).map(o => o.key)).not.toContain("everythingBleeds");

		// Predator has no readable condition at all, so it is a standing unticked reminder.
		const wren = hero("Wren", [HERO_MOVES.PREDATOR]);
		expect(blowOffers(wren, { targets: [target(t.bandit)] }).find(o => o.key === "predator")).toMatchObject({ dice: "1d4", applied: false });
	});

	it("adds Something to Remember Me By to a strike back, and to nothing else", () => {
		const pim = hero("Pim", [HERO_MOVES.REMEMBER_ME]);
		expect(blowOffers(pim, { strikeBack: true }).map(o => o.key)).toContain("rememberMe");
		expect(blowOffers(pim, { strikeBack: false }).map(o => o.key)).not.toContain("rememberMe");
	});

	it("adds Hungry Flames to a blow dealt with a holy light", () => {
		const sael = hero("Sael", [HERO_MOVES.HUNGRY_FLAMES]);
		const light = { slug: "purifying-flames-holy-light", name: "Holy light", range: ["hand", "close"] };
		expect(blowOffers(sael, { weapon: light }).map(o => o.key)).toContain("hungryFlames");
		expect(blowOffers(sael, { weapon: { slug: "sword", name: "Sword", range: ["close"] } }).map(o => o.key)).not.toContain("hungryFlames");
	});

	it("gives +1d4 against whoever knocked them down, until it is spent", async () => {
		const { t, rows } = crinRows();
		const pim = hero("Pim", [HERO_MOVES.KNOCKED_DOWN, HERO_MOVES.UP_AGAIN]);
		await recordKnockedDownBy(pim, t.crin.actor);
		expect(pim.getFlag(SYSTEM_ID, KNOCKED_DOWN_FLAG)).toEqual({ key: t.crin.uuid, name: "Crinwin" });
		expect(foeAdvantage(pim, rows)).toBe(HERO_MOVES.UP_AGAIN);
		const offer = blowOffers(pim, { targets: rows }).find(o => o.key === "upAgain");
		expect(offer).toMatchObject({ dice: "1d4", applied: true });
		await offer.spend(pim);
		expect(foeAdvantage(pim, rows)).toBeNull();
		expect(blowOffers(pim, { targets: rows }).map(o => o.key)).not.toContain("upAgain");
	});

	it("keeps a move a player switched off out of all of it", async () => {
		const { rows } = crinRows();
		const off = name => ({ type: "move", name, flags: { [SYSTEM_ID]: { learned: false } } });
		const bram = hero("Bram", [off(HERO_MOVES.NEMESIS), off(HERO_MOVES.DANGEROUS), off(HERO_MOVES.MUSCLEBOUND)]);
		await recordClash(bram, rows, { now: 10 });
		expect(bram.setFlag).not.toHaveBeenCalled();
		expect(blowOffers(bram, { targets: rows, attackAt: 99 }).map(o => o.key)).toEqual([]);
		expect(dangerousMode(bram, "")).toBe("");
		expect(muscleboundWeapon(bram, { name: "Sword", range: ["close"] }).tags).toBeUndefined();
		await clearKnockedDownBy(bram);
	});
});

describe("Musclebound", () => {
	const bram = () => hero("Bram", [HERO_MOVES.MUSCLEBOUND]);

	it("makes a hand-to-hand or thrown attack forceful and messy", () => {
		expect(muscleboundWeapon(bram(), { name: "Sword", range: ["close"] }).tags).toEqual(["forceful", "messy"]);
		expect(muscleboundWeapon(bram(), { name: "Spear", range: ["close", "thrown"] }).tags).toEqual(["forceful", "messy"]);
		// Nothing in hand is hand-to-hand by definition.
		expect(muscleboundWeapon(bram(), null).tags).toEqual(["forceful", "messy"]);
	});

	it("keeps the weapon's own tags, and leaves a bow alone", () => {
		expect(muscleboundWeapon(bram(), { name: "Axe", range: ["close"], tags: ["messy"] }).tags).toEqual(["messy", "forceful"]);
		const bow = { name: "Bow & arrows", range: ["near"] };
		expect(muscleboundWeapon(bram(), bow)).toBe(bow);
	});
});

describe("the damage a character takes", () => {
	it("IMPOSES Never Gonna Keep Me Down at 5 HP or less: the HP box is the whole condition", async () => {
		const pim = hero("Pim", [HERO_MOVES.NEVER_GONNA]);
		pim.system.attributes.hp.value = 6;
		expect(await defenderDisadvantage(pim)).toEqual({ imposed: [], offered: [] });
		pim.system.attributes.hp.value = 5;
		expect(await defenderDisadvantage(pim)).toEqual({ imposed: [HERO_MOVES.NEVER_GONNA], offered: [] });
	});

	it("OFFERS Uncanny Reflexes while unarmored under a light load: the clause is about the blow", async () => {
		const snapshot = { vitals: { wornArmor: 0 }, inventory: { outfit: { load: { selected: "light" } } } };
		const bram = hero("Bram", [HERO_MOVES.UNCANNY], { typedActor: { buildSnapshot: async () => snapshot } });
		expect(await defenderDisadvantage(bram)).toEqual({ imposed: [], offered: [HERO_MOVES.UNCANNY] });
		snapshot.vitals.wornArmor = 2;
		expect((await defenderDisadvantage(bram)).offered).toEqual([]);
		snapshot.vitals.wornArmor = 0;
		snapshot.inventory.outfit.load.selected = "heavy";
		expect((await defenderDisadvantage(bram)).offered).toEqual([]);
	});

	it("says nothing for a character with none of the moves", async () => {
		expect(await defenderDisadvantage(hero("Pim", ["Undaunted"]))).toEqual({ imposed: [], offered: [] });
	});
});

describe("Berserker", () => {
	it("is on only in the Battle Joy, and only with the move", () => {
		const raging = hero("Bram", [HERO_MOVES.BERSERKER]);
		expect(berserkNow(raging)).toBe(false);
		raging.flags[SYSTEM_ID].battleJoy = true;
		expect(berserkNow(raging)).toBe(true);
		const plain = hero("Duvin", ["Battle Joy"]);
		plain.flags[SYSTEM_ID].battleJoy = true;
		expect(berserkNow(plain)).toBe(false);
	});
});

// The fight fakes are shared with the other hero-move tests; these two keep the imports honest.
describe("fakes", () => {
	it("builds a scene and a combat the engine can read", () => {
		const scene = fakeScene({ tokens: [] });
		expect(fakeCombat({ scene, combatants: [] }).combatants).toBeDefined();
		expect(fakeCombatant({ id: "c1", token: fakeToken({ id: "t1", col: 0, row: 0, actor: fakeActor({ id: "a", name: "A", type: "monster" }) }), scene })).toBeDefined();
	});
});

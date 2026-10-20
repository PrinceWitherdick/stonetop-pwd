import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	HERO_MOVES, CLASHED_FLAG, HARMED_BY_FLAG, KNOCKED_DOWN_FLAG,
	foeKey, recordClash, clashedBefore, relentlessAgainst, foeAdvantage,
	recordHarmedBy, clearHarmedBy, paybackEarned, recordKnockedDownBy, spendUpAgainBlow, spendUpAgainRoll, upAgainAgainst,
	TOUGH_LOVE_FLAG, toughLoveAgainst, toughLoveHeld, callOut, workedItOut,
	muscleboundWeapon, berserkNow, blowOffers, defenderDisadvantage, dangerousMode, holyLightOffers,
	ALPHA_FLAG, alphaAgainst, recordAlphaOver, forgetAlphaOver, spendAlphaOver,
	FOCUS_FIRE_FLAG, FOCUS_FIRE_USED_FLAG, orderFocusFire, focusFireAgainst, spendFocusFire, ownDamageMode,
	terrorOnTheFieldWords,
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

	// Heavy re-audit, the user's ruling (2026-10-18): grudges against NAMED foes outlast the fight.
	it("keeps a Payback grudge against a linked foe when the fight ends, and lets a mook's token go", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })], ["chief", fakeActor({ id: "chief", name: "Chief", type: "monster" }), true]]);
		const bram = hero("Bram", [HERO_MOVES.PAYBACK]);
		globalThis.game = { ...saved.game, combats: collection([]), combat: null, settings: { get: () => true } };
		globalThis.ui = { combat: {} };
		globalThis.canvas = { scene: null };
		await recordHarmedBy(bram, t.crin.actor);
		await recordHarmedBy(bram, t.chief.actor);
		expect(bram.getFlag(SYSTEM_ID, HARMED_BY_FLAG)).toEqual([t.crin.uuid, "Actor.chief"]);
		expect(await clearHarmedBy(bram)).toBe(true);
		expect(bram.getFlag(SYSTEM_ID, HARMED_BY_FLAG)).toEqual(["Actor.chief"]);
		expect(paybackEarned(bram, [target(t.chief)])).toBe(true);
		expect(paybackEarned(bram, [target(t.crin)])).toBe(false);
		// Only named foes left: nothing to let go, and nothing written.
		bram.setFlag.mockClear();
		expect(await clearHarmedBy(bram)).toBe(false);
		expect(bram.setFlag).not.toHaveBeenCalled();
	});

	it("reads an ally's grudges off the active Combat when the Fight tab is off", () => {
		const crin = fakeActor({ id: "crin", name: "Crinwin", type: "monster" });
		const bram = hero("Bram", [HERO_MOVES.PAYBACK]);
		const cadi = hero("Cadi", []);
		const hound = fakeActor({ id: "hound", name: "Hound", type: "npc" });
		const ulf = hero("Ulf", []);
		const t = mapWith([["crin", crin]]);
		const rows = [target(t.crin)];
		const token = (id, actor) => fakeToken({ id, actor });
		const scene = fakeScene({ tokens: [] });
		// Cadi is not in the fight; her hound is. Ulf is a character the GM moved onto the foes' side.
		const combat = fakeCombat({ scene, flags: {}, combatants: [
			fakeCombatant({ id: "cBram", token: token("tBram", bram), scene }),
			fakeCombatant({ id: "cHound", token: token("tHound", hound), scene, side: "heroes" }),
			fakeCombatant({ id: "cUlf", token: token("tUlf", ulf), scene, side: "foes" }),
			fakeCombatant({ id: "cCrin", token: t.crin, scene }),
		] });
		globalThis.game = { ...saved.game, combats: collection([combat]), combat, settings: { get: (_s, key) => (key === "fightTab" ? false : undefined) } };
		globalThis.ui = { combat: { viewed: combat } };
		globalThis.canvas = { scene };
		const cardFor = actor => (actor === hound ? { character: cadi, ftype: "animal-companion", slug: "" } : null);

		cadi.flags[SYSTEM_ID][HARMED_BY_FLAG] = [t.crin.uuid];
		expect(paybackEarned(bram, rows, { cardFor })).toBe(true);
		cadi.flags[SYSTEM_ID][HARMED_BY_FLAG] = [];
		// A foe-side combatant's grudges are not an ally's.
		ulf.flags[SYSTEM_ID][HARMED_BY_FLAG] = [t.crin.uuid];
		expect(paybackEarned(bram, rows, { cardFor })).toBe(false);
		// Nor is a tokenless roster Combat's (the old Introductions'): nobody there is on a map.
		cadi.flags[SYSTEM_ID][HARMED_BY_FLAG] = [t.crin.uuid];
		const roster = fakeCombat({ flags: {}, combatants: [{ ...fakeCombatant({ id: "rCadi" }), actor: cadi }] });
		globalThis.game.combat = roster;
		expect(paybackEarned(bram, rows, { cardFor })).toBe(false);
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

	it("draws the weak spot UNTICKED with no target, and keeps it when a volley also catches something small", () => {
		const t = mapWith([
			["drake", fakeActor({ id: "drake", name: "Drake", type: "monster", system: { size: "large" } })],
			["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster", system: { size: "small" } })],
			["imp", fakeActor({ id: "imp", name: "Imp", type: "monster", system: { size: "small" } })],
		]);
		const wren = hero("Wren", [HERO_MOVES.BIG_GAME]);
		// No stat block to read: the quarry may still be huge, so the player says.
		expect(blowOffers(wren, { targets: [] }).find(o => o.key === "bigGame")).toMatchObject({ dice: "2", applied: false });
		expect(blowOffers(wren, {}).find(o => o.key === "bigGame")).toMatchObject({ dice: "2", applied: false });
		// A Blot Out the Sun volley over the drake and a Crinwin bystander.
		expect(blowOffers(wren, { targets: [target(t.drake), target(t.crin)] }).find(o => o.key === "bigGame")).toMatchObject({ dice: "2", applied: false });
		// Nothing big in the volley: no line.
		expect(blowOffers(wren, { targets: [target(t.crin), target(t.imp)] }).map(o => o.key)).not.toContain("bigGame");
		// Giant Slayer still folds into the one +4 line, targeted or not.
		const giant = hero("Wren", [HERO_MOVES.BIG_GAME, HERO_MOVES.GIANT_SLAYER]);
		expect(blowOffers(giant, {}).filter(o => o.key === "bigGame")).toEqual([expect.objectContaining({ dice: "4", applied: false })]);
		expect(blowOffers(giant, { targets: [target(t.crin), target(t.drake)] }).filter(o => o.key === "bigGame")).toEqual([expect.objectContaining({ dice: "4", applied: false })]);
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
		// The user's ruling (2026-10-18): "something you KNOW to be tainted by chaos" is the Judge's knowledge, so a
		// stat block without the tag draws the line UNTICKED rather than leaving it off.
		expect(blowOffers(judge, { targets: [target(t.bandit)] }).find(o => o.key === "dogWithBone")).toMatchObject({ dice: "1d6", applied: false });
		expect(blowOffers(judge, { targets: [target(t.thing), target(t.bandit)] }).find(o => o.key === "dogWithBone")).toMatchObject({ applied: false });

		const seeker = hero("Maelis", [HERO_MOVES.EVERYTHING_BLEEDS]);
		// Unticked: the stat block says it is unnatural; whether this blow exploited a weakness is theirs.
		expect(blowOffers(seeker, { targets: [target(t.shade)] }).find(o => o.key === "everythingBleeds")).toMatchObject({ applied: false });
		expect(blowOffers(seeker, { targets: [target(t.bandit)] }).map(o => o.key)).not.toContain("everythingBleeds");

		// Predator has no readable condition at all, so it is a standing unticked reminder.
		const wren = hero("Wren", [HERO_MOVES.PREDATOR]);
		expect(blowOffers(wren, { targets: [target(t.bandit)] }).find(o => o.key === "predator")).toMatchObject({ dice: "1d4", applied: false });
	});

	// Seeker audit (2026-09-26), the user's ruling: an "unnatural foe" is any creature type but a person or a
	// beast (the Makers and the unknown included), besides the tags; and a Corrupted type is Like a Dog with a
	// Bone's quarry however it is tagged.
	it("reads the stat block's creature type for Everything Bleeds and Like a Dog with a Bone", () => {
		const typed = (id, creatureType, tags = "") => fakeActor({ id, name: id, type: "monster", system: { tags, creatureType } });
		const t = mapWith(["maker", "unknown-origin", "emanation", "corrupted", "human-individual", "human-group", "natural-beast", "untyped"]
			.map(type => [type, typed(type, type === "untyped" ? "" : type)])
			.concat([["glow", typed("glow", "", "solitary, emanation")]]));
		const seeker = hero("Maelis", [HERO_MOVES.EVERYTHING_BLEEDS]);
		const bleeds = key => blowOffers(seeker, { targets: [target(t[key])] }).some(o => o.key === "everythingBleeds");
		for (const key of ["maker", "unknown-origin", "emanation", "corrupted", "glow"]) expect(bleeds(key), key).toBe(true);
		for (const key of ["human-individual", "human-group", "natural-beast", "untyped"]) expect(bleeds(key), key).toBe(false);

		const judge = hero("Hafgan", [HERO_MOVES.DOG_WITH_BONE]);
		const bone = key => blowOffers(judge, { targets: [target(t[key])] }).find(o => o.key === "dogWithBone")?.applied;
		expect(bone("corrupted")).toBe(true);
		expect(bone("maker")).toBe(false);
	});

	// Seeker re-audit (2026-10-18): with nothing targeted there is no stat block to read, and both bonuses
	// used to vanish. The foe may still be corrupted or unnatural, so both are drawn UNTICKED for the player.
	it("offers Everything Bleeds and Like a Dog with a Bone UNTICKED when nothing is targeted", () => {
		const judge = hero("Hafgan", [HERO_MOVES.DOG_WITH_BONE]);
		expect(blowOffers(judge, { targets: [] }).find(o => o.key === "dogWithBone")).toMatchObject({ dice: "1d6", applied: false });
		expect(blowOffers(judge, {}).find(o => o.key === "dogWithBone")).toMatchObject({ applied: false });

		const seeker = hero("Maelis", [HERO_MOVES.EVERYTHING_BLEEDS]);
		expect(blowOffers(seeker, { targets: [] }).find(o => o.key === "everythingBleeds")).toMatchObject({ dice: "1d6", applied: false });

		// Not learned, not offered, targets or no.
		const wren = hero("Wren", [HERO_MOVES.PREDATOR]);
		expect(blowOffers(wren, {}).map(o => o.key)).not.toContain("dogWithBone");
		expect(blowOffers(wren, {}).map(o => o.key)).not.toContain("everythingBleeds");
	});

	it("keeps Predator a standing reminder whatever the foe", () => {
		const t = mapWith([["bandit", fakeActor({ id: "bandit", name: "Bandit", type: "monster", system: { tags: "group, organized" } })]]);
		const wren = hero("Wren", [HERO_MOVES.PREDATOR]);
		expect(blowOffers(wren, { targets: [target(t.bandit)] }).find(o => o.key === "predator")).toMatchObject({ dice: "1d4", applied: false });
	});

	// Heavy audit (2026-09-25): Blood-Soaked Past's "When you fight to kill without mercy or hesitation, you
	// deal +1d4 damage" was left to be typed by hand in the damage window.
	it("offers Blood-Soaked Past's +1d4 UNTICKED to a Heavy who took it, and to no one else", () => {
		const heavy = (background, playbook = "The Heavy") => {
			const actor = hero("Bram", [], { system: { playbook: { name: playbook }, attributes: { hp: { value: 20, max: 20 } } } });
			actor.flags[SYSTEM_ID].background = { selected: background };
			return actor;
		};
		expect(blowOffers(heavy("blood-soaked-past"), {}).find(o => o.key === "withoutMercy"))
			.toMatchObject({ dice: "1d4", applied: false, label: "Blood-Soaked Past: +1d4 damage, fighting to kill without mercy or hesitation", pill: "Blood-Soaked Past +1d4" });
		expect(blowOffers(heavy("sheriff"), {}).map(o => o.key)).not.toContain("withoutMercy");
		// A slug is the playbook's own name for its background.
		expect(blowOffers(heavy("blood-soaked-past", "The Fox"), {}).map(o => o.key)).not.toContain("withoutMercy");
	});

	// Heavy audit (2026-09-25), with the user's ruling that followers are allies: Payback read the grudges of
	// characters only, and a blow on a follower was never written down at all.
	it("earns Payback from a foe that harmed the Heavy's follower, written on the Heavy", async () => {
		const { t, rows } = crinRows();
		const bram = hero("Bram", [HERO_MOVES.PAYBACK]);
		globalThis.game = { ...saved.game, combats: collection([]), settings: { get: () => true } };
		globalThis.ui = { combat: {} };
		globalThis.canvas = { scene: null };
		const dog = fakeActor({ id: "dog", name: "Dog", type: "npc" });
		const cardFor = actor => (actor === dog ? { character: bram, ftype: "animal-companion", slug: "" } : null);
		expect(await recordHarmedBy(dog, t.crin.actor, { cardFor })).toBe(true);
		expect(bram.getFlag(SYSTEM_ID, HARMED_BY_FLAG)).toEqual([t.crin.uuid]);
		expect(paybackEarned(bram, rows)).toBe(true);
		// An NPC who follows nobody is not an ally's follower, and writes nothing.
		const stranger = fakeActor({ id: "stranger", name: "Stranger", type: "npc" });
		expect(await recordHarmedBy(stranger, t.crin.actor, { cardFor: () => null })).toBe(false);
	});

	it("earns Payback from a foe that harmed an ally's follower fighting beside the Heavy", async () => {
		const crin = fakeActor({ id: "crin", name: "Crinwin", type: "monster" });
		const bram = hero("Bram", [HERO_MOVES.PAYBACK]);
		// Cadi is not in the fight; her hound is.
		const cadi = hero("Cadi", []);
		const hound = fakeActor({ id: "hound", name: "Hound", type: "npc" });
		const token = (id, col, actor) => Object.assign(fakeToken({ id, col, row: 1, actor }), { uuid: `Scene.scene1.Token.${id}`, documentName: "Token", actorLink: false });
		const tokens = { bram: token("tBram", 1, bram), hound: token("tHound", 2, hound), crin: token("tCrin", 3, crin) };
		Object.assign(crin, { documentName: "Actor", token: { uuid: tokens.crin.uuid }, uuid: `${tokens.crin.uuid}.Actor.crin` });
		const byUuid = new Map([[tokens.crin.uuid, tokens.crin], [crin.uuid, crin]]);
		globalThis.fromUuidSync = uuid => byUuid.get(uuid) ?? null;
		const scene = fakeScene({ tokens: Object.values(tokens) });
		const combatants = [
			fakeCombatant({ id: "cBram", token: tokens.bram, scene, side: "heroes" }),
			fakeCombatant({ id: "cHound", token: tokens.hound, scene, side: "heroes" }),
			fakeCombatant({ id: "cCrin", token: tokens.crin, scene, side: "foes" }),
		];
		const combat = fakeCombat({ scene, combatants });
		globalThis.game = { ...saved.game, user: { id: "gm", isGM: true }, users: collection([]), combats: collection([combat]), settings: { get: (_s, key) => (key === "fightTab" ? true : undefined) } };
		globalThis.ui = { combat: { viewed: combat } };
		globalThis.canvas = { scene };
		const cardFor = actor => (actor === hound ? { character: cadi, ftype: "animal-companion", slug: "" } : null);

		const rows = [{ uuid: tokens.crin.uuid, name: "Crinwin" }];
		expect(paybackEarned(bram, rows, { cardFor })).toBe(false);
		await recordHarmedBy(hound, crin, { cardFor });
		expect(cadi.getFlag(SYSTEM_ID, HARMED_BY_FLAG)).toEqual([tokens.crin.uuid]);
		expect(paybackEarned(bram, rows, { cardFor })).toBe(true);
	});

	it("adds Something to Remember Me By to a strike back, and to nothing else", () => {
		const pim = hero("Pim", [HERO_MOVES.REMEMBER_ME]);
		expect(blowOffers(pim, { strikeBack: true }).map(o => o.key)).toContain("rememberMe");
		expect(blowOffers(pim, { strikeBack: false }).map(o => o.key)).not.toContain("rememberMe");
	});

	it("offers Second Intent's +1d4 unticked on a parry's strike back, and nowhere else", () => {
		// "When you Defend and spend 1 Readiness to Parry & Riposte, also pick 1 option from the Ambush list":
		// "Deal +1d4 damage" is one option of four, so the line opens unticked.
		const fox = hero("Fox", [HERO_MOVES.SECOND_INTENT]);
		expect(blowOffers(fox, { strikeBack: true, parry: true }).find(o => o.key === "secondIntent"))
			.toMatchObject({ dice: "1d4", applied: false, label: "Second Intent: +1d4 damage (your Ambush pick)" });
		// The fight ring's plain Defend strike back is not a Parry & Riposte.
		expect(blowOffers(fox, { strikeBack: true }).map(o => o.key)).not.toContain("secondIntent");
		expect(blowOffers(fox, {}).map(o => o.key)).not.toContain("secondIntent");
		// Un-learned, it offers nothing.
		const off = hero("Fox", [{ type: "move", name: HERO_MOVES.SECOND_INTENT, flags: { [SYSTEM_ID]: { learned: false } } }]);
		expect(blowOffers(off, { strikeBack: true, parry: true }).map(o => o.key)).not.toContain("secondIntent");
		// A player's own move of the name acts as itself (owns-move.js#bookMoveName).
		const homebrew = hero("Fox", [{ type: "move", name: HERO_MOVES.SECOND_INTENT, flags: { [SYSTEM_ID]: { custom: true } } }]);
		expect(blowOffers(homebrew, { strikeBack: true, parry: true }).map(o => o.key)).not.toContain("secondIntent");
	});

	it("adds Hungry Flames to a blow dealt with a holy light", () => {
		const sael = hero("Sael", [HERO_MOVES.HUNGRY_FLAMES]);
		const light = { slug: "purifying-flames-holy-light", name: "Holy light", range: ["hand", "close"] };
		expect(blowOffers(sael, { weapon: light }).map(o => o.key)).toContain("hungryFlames");
		expect(blowOffers(sael, { weapon: { slug: "sword", name: "Sword", range: ["close"] } }).map(o => o.key)).not.toContain("hungryFlames");
	});

	// R7: an Invocation's own damage (Go Back to the Shadow) is dealt with a holy light too, and asks
	// for the same ticked line without a weapon to read it off.
	it("offers Hungry Flames on damage dealt with a holy light, ticked, only when learned", () => {
		const sael = hero("Sael", [HERO_MOVES.HUNGRY_FLAMES]);
		expect(holyLightOffers(sael)).toEqual([expect.objectContaining({
			key: "hungryFlames", dice: "1d6", applied: true,
			label: "Hungry Flames: +1d6 damage, and they are engulfed in holy light and flames",
		})]);
		expect(holyLightOffers(hero("Pim", []))).toEqual([]);
		const off = hero("Sael", [{ type: "move", name: HERO_MOVES.HUNGRY_FLAMES, flags: { [SYSTEM_ID]: { learned: false } } }]);
		expect(holyLightOffers(off)).toEqual([]);
	});

	it("gives +1d4 against whoever knocked them down, until it is spent", async () => {
		const { t, rows } = crinRows();
		const pim = hero("Pim", [HERO_MOVES.KNOCKED_DOWN, HERO_MOVES.UP_AGAIN]);
		await recordKnockedDownBy(pim, t.crin.actor);
		expect(pim.getFlag(SYSTEM_ID, KNOCKED_DOWN_FLAG)).toEqual({ key: t.crin.uuid, name: "Crinwin", roll: true, blow: true });
		expect(foeAdvantage(pim, rows)).toBe(HERO_MOVES.UP_AGAIN);
		const offer = blowOffers(pim, { targets: rows }).find(o => o.key === "upAgain");
		expect(offer).toMatchObject({ dice: "1d4", applied: true });
		await offer.spend(pim);
		expect(blowOffers(pim, { targets: rows }).map(o => o.key)).not.toContain("upAgain");
		// The blow's half only: the advantage on the next ROLL against them is still owed.
		expect(foeAdvantage(pim, rows)).toBe(HERO_MOVES.UP_AGAIN);
		await spendUpAgainRoll(pim, rows);
		expect(foeAdvantage(pim, rows)).toBeNull();
		expect(pim.getFlag(SYSTEM_ID, KNOCKED_DOWN_FLAG)).toBeNull();
	});

	// WBH audit: the record was one flag cleared only by the +1d4 blow, so a Clash that missed kept its
	// advantage for ever. Two halves now, each spent by its own: the roll after its dice, the blow when taken.
	it("spends the roll's advantage and the blow's +1d4 apart, in either order", async () => {
		const { t, rows } = crinRows();
		const pim = hero("Pim", [HERO_MOVES.KNOCKED_DOWN, HERO_MOVES.UP_AGAIN]);
		await recordKnockedDownBy(pim, t.crin.actor);
		expect(upAgainAgainst(pim, rows)).toBe(HERO_MOVES.UP_AGAIN);
		expect(await spendUpAgainRoll(pim, rows)).toBe(true);
		expect(upAgainAgainst(pim, rows)).toBeNull();
		expect(await spendUpAgainRoll(pim, rows)).toBe(false);
		// The +1d4 still rides the next blow against them.
		expect(blowOffers(pim, { targets: rows }).map(o => o.key)).toContain("upAgain");
		expect(await spendUpAgainBlow(pim)).toBe(true);
		expect(pim.getFlag(SYSTEM_ID, KNOCKED_DOWN_FLAG)).toBeNull();
		// A roll at someone else spends nothing.
		await recordKnockedDownBy(pim, t.crin.actor);
		expect(await spendUpAgainRoll(pim, [{ uuid: "Scene.scene1.Token.tother", name: "Other" }])).toBe(false);
		expect(upAgainAgainst(pim, rows)).toBe(HERO_MOVES.UP_AGAIN);
	});

	it("reads a record written before the split as owing both halves", async () => {
		const { t, rows } = crinRows();
		const pim = hero("Pim", [HERO_MOVES.UP_AGAIN]);
		pim.flags[SYSTEM_ID][KNOCKED_DOWN_FLAG] = { key: t.crin.uuid, name: "Crinwin" };
		expect(upAgainAgainst(pim, rows)).toBe(HERO_MOVES.UP_AGAIN);
		expect(blowOffers(pim, { targets: rows }).map(o => o.key)).toContain("upAgain");
		await spendUpAgainBlow(pim);
		expect(pim.getFlag(SYSTEM_ID, KNOCKED_DOWN_FLAG)).toEqual({ key: t.crin.uuid, name: "Crinwin", roll: true, blow: false });
		expect(upAgainAgainst(pim, rows)).toBe(HERO_MOVES.UP_AGAIN);
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
		expect(await spendUpAgainBlow(bram)).toBe(false);
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

	// Heavy re-audit (2026-10-18), the user's ruling: "If it would already be forceful and/or messy, it's even
	// more so" said nothing; the weapon is marked with the tags it already had, for the card to say.
	it("marks a weapon that was already forceful and/or messy as even more so", () => {
		expect(muscleboundWeapon(bram(), { name: "Battleaxe", range: ["close"], tags: ["messy"] }).muscleboundMore).toEqual(["messy"]);
		expect(muscleboundWeapon(bram(), { name: "Maul", range: ["close"], tags: ["forceful", "awkward"] }).muscleboundMore).toEqual(["forceful"]);
		const both = muscleboundWeapon(bram(), { name: "Club", range: ["close"], tags: ["messy", "forceful"] });
		expect(both.muscleboundMore).toEqual(["forceful", "messy"]);
		expect(both.tags).toEqual(["messy", "forceful"]);
		// Neither tag of its own: nothing more to say.
		expect(muscleboundWeapon(bram(), { name: "Sword", range: ["close"] })).not.toHaveProperty("muscleboundMore");
		// Without the move, or at range, the weapon is untouched.
		const axe = { name: "Battleaxe", range: ["close"], tags: ["messy"] };
		expect(muscleboundWeapon(hero("Pim", []), axe)).toBe(axe);
		const sling = { name: "Sling", range: ["near"], tags: ["forceful"] };
		expect(muscleboundWeapon(bram(), sling)).toBe(sling);
	});
});

// Heavy re-audit (2026-10-18): "When you reduce a foe to 0 HP, describe how you take them out. If you fell
// them in a particularly brutal or impressive manner, their allies are impressed, dismayed, or frightened and
// respond accordingly." Nothing said it.
describe("Terror on the Field", () => {
	const crinwin = () => mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })]]).crin.actor;

	beforeEach(() => {
		globalThis.game = { ...saved.game, combats: collection([]), settings: { get: () => true } };
		globalThis.ui = { combat: {} };
		globalThis.canvas = { scene: null };
	});

	it("names the move and its prompt when a Heavy who learned it fells a foe", () => {
		const said = terrorOnTheFieldWords(hero("Bram", [HERO_MOVES.TERROR]), crinwin(), { foe: "Crinwin (2)", disposition: -1 });
		expect(said).toContain("Bram felled Crinwin (2).");
		expect(said).toContain("Terror on the Field: describe how you take them out.");
		expect(said).toContain("impressed, dismayed, or frightened");
	});

	it("says nothing without the move learned", () => {
		const off = { type: "move", name: HERO_MOVES.TERROR, flags: { [SYSTEM_ID]: { learned: false } } };
		expect(terrorOnTheFieldWords(hero("Bram", [off]), crinwin(), { disposition: -1 })).toBe("");
		expect(terrorOnTheFieldWords(hero("Bram", []), crinwin(), { disposition: -1 })).toBe("");
		// A stat block is no Heavy, whatever its moves.
		expect(terrorOnTheFieldWords({ ...fakeActor({ id: "m", type: "monster" }), items: [{ type: "move", name: HERO_MOVES.TERROR }] }, crinwin())).toBe("");
	});

	it("says nothing when the one felled was on the Heavy's own side (a Berserker's area blow)", () => {
		const bram = hero("Bram", [HERO_MOVES.TERROR]);
		expect(terrorOnTheFieldWords(bram, hero("Pim", []), { disposition: 1 })).toBe("");
		const follower = fakeActor({ id: "hound", name: "Hound", type: "npc", flags: { [SYSTEM_ID]: { followerOrigin: { slug: "hound" } } } });
		expect(terrorOnTheFieldWords(bram, follower, { disposition: 1 })).toBe("");
	});
});

describe("the damage a character takes", () => {
	it("IMPOSES Never Gonna Keep Me Down at 5 HP or less: the HP box is the whole condition", async () => {
		const pim = hero("Pim", [HERO_MOVES.NEVER_GONNA]);
		pim.system.attributes.hp.value = 6;
		expect(await defenderDisadvantage(pim)).toEqual({ imposed: [], offered: [], unread: [] });
		pim.system.attributes.hp.value = 5;
		expect(await defenderDisadvantage(pim)).toEqual({ imposed: [HERO_MOVES.NEVER_GONNA], offered: [], unread: [] });
	});

	it("OFFERS Uncanny Reflexes while unarmored under a light load: the clause is about the blow", async () => {
		const snapshot = { vitals: { wornArmor: 0 }, inventory: { outfit: { load: { selected: "light" } } } };
		const bram = hero("Bram", [HERO_MOVES.UNCANNY], { typedActor: { buildSnapshot: async () => snapshot } });
		expect(await defenderDisadvantage(bram)).toEqual({ imposed: [], offered: [HERO_MOVES.UNCANNY], unread: [] });
		snapshot.vitals.wornArmor = 2;
		expect((await defenderDisadvantage(bram)).offered).toEqual([]);
		snapshot.vitals.wornArmor = 0;
		snapshot.inventory.outfit.load.selected = "heavy";
		expect((await defenderDisadvantage(bram)).offered).toEqual([]);
	});

	it("says nothing for a character with none of the moves", async () => {
		expect(await defenderDisadvantage(hero("Pim", ["Undaunted"]))).toEqual({ imposed: [], offered: [], unread: [] });
	});
});

describe("Berserker", () => {
	it("is on only in the Battle Joy, and only with the move", () => {
		const raging = hero("Bram", [HERO_MOVES.BERSERKER, "Battle Joy"]);
		expect(berserkNow(raging)).toBe(false);
		raging.flags[SYSTEM_ID].battleJoy = true;
		expect(berserkNow(raging)).toBe(true);
		const plain = hero("Duvin", ["Battle Joy"]);
		plain.flags[SYSTEM_ID].battleJoy = true;
		expect(berserkNow(plain)).toBe(false);
	});

	it("is off for a rage left on the sheet after Battle Joy was un-learned", () => {
		const stranded = hero("Bram", [HERO_MOVES.BERSERKER]);
		stranded.flags[SYSTEM_ID].battleJoy = true;
		expect(berserkNow(stranded)).toBe(false);
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

// Ranger audit M10: Alpha's "on a 10+, you also have advantage on your next roll against them". One
// entry per foe (the 10+ lays it, actors/character/tier-effects.js), read by foeAdvantage for an attack
// and spent by the next roll against them.
describe("Alpha's advantage against the foes it cowed", () => {
	it("gives the next roll against a remembered foe advantage, once, for a LEARNED move only", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })], ["chief", fakeActor({ id: "chief", name: "Chief", type: "monster" }), true]]);
		const rook = hero("Rook", [HERO_MOVES.ALPHA]);
		const crin = [target(t.crin)];
		expect(foeAdvantage(rook, crin)).toBeNull();
		expect(await recordAlphaOver(rook, [{ key: foeKey(target(t.crin)), name: "Crinwin" }])).toBe(true);
		expect(rook.getFlag(SYSTEM_ID, ALPHA_FLAG)).toEqual([{ key: t.crin.uuid, name: "Crinwin" }]);
		expect(alphaAgainst(rook, crin)).toBe(HERO_MOVES.ALPHA);
		expect(foeAdvantage(rook, crin)).toBe(HERO_MOVES.ALPHA);
		// Every target has to be one of them, and nobody targeted is nobody to have it against.
		expect(alphaAgainst(rook, [target(t.crin), target(t.chief)])).toBeNull();
		expect(alphaAgainst(rook, [])).toBeNull();
		// Spent by the roll against them.
		expect(await spendAlphaOver(rook, crin)).toBe(true);
		expect(foeAdvantage(rook, crin)).toBeNull();
		expect(await spendAlphaOver(rook, crin)).toBe(false);

		const off = hero("Rook", [{ type: "move", name: HERO_MOVES.ALPHA, flags: { [SYSTEM_ID]: { learned: false } } }]);
		expect(await recordAlphaOver(off, [{ key: t.crin.uuid, name: "Crinwin" }])).toBe(false);
		off.flags[SYSTEM_ID][ALPHA_FLAG] = [{ key: t.crin.uuid, name: "Crinwin" }];
		expect(alphaAgainst(off, crin)).toBeNull();
	});

	it("writes a foe cowed twice once, and forgets only the foes named", async () => {
		const rook = hero("Rook", [HERO_MOVES.ALPHA]);
		await recordAlphaOver(rook, [{ key: "a", name: "A" }, { key: "b", name: "B" }]);
		await recordAlphaOver(rook, [{ key: "a", name: "A" }]);
		expect(rook.getFlag(SYSTEM_ID, ALPHA_FLAG).map(e => e.key).sort()).toEqual(["a", "b"]);
		expect(await forgetAlphaOver(rook, ["a"])).toBe(true);
		expect(rook.getFlag(SYSTEM_ID, ALPHA_FLAG)).toEqual([{ key: "b", name: "B" }]);
	});
});

// Tough Love (WBH audit, the user's ruling 2026-09-27): "When you honestly think another PC is in the wrong
// and call them on it, they have disadvantage on any rolls against you until you two work it out." The hero
// names the PC; that PC's rolls aimed at the hero read it, the reverse of Binding Arbitration's oathbreaker.
describe("Tough Love", () => {
	const pcs = () => {
		const pim = Object.assign(hero("pim", [HERO_MOVES.TOUGH_LOVE]), { documentName: "Actor" });
		const bram = Object.assign(hero("bram", []), { documentName: "Actor" });
		const cadi = Object.assign(hero("cadi", []), { documentName: "Actor" });
		const byUuid = new Map([
			["Actor.pim", pim],
			["Scene.scene1.Token.tpim", { documentName: "Token", uuid: "Scene.scene1.Token.tpim", actor: pim }],
			["Actor.cadi", cadi],
		]);
		globalThis.fromUuidSync = uuid => byUuid.get(uuid) ?? null;
		globalThis.ChatMessage = { create: vi.fn(async () => ({})), getSpeaker: () => ({}) };
		return { pim, bram, cadi };
	};
	afterEach(() => { delete globalThis.ChatMessage; });

	it("names the PC called on it, several at once, and says so on a card", async () => {
		const { pim, bram, cadi } = pcs();
		expect(await callOut(pim, bram)).toBe(true);
		expect(await callOut(pim, bram)).toBe(false);
		expect(await callOut(pim, cadi)).toBe(true);
		expect(await callOut(pim, pim)).toBe(false);
		expect(toughLoveHeld(pim)).toEqual([{ id: "bram", name: "bram" }, { id: "cadi", name: "cadi" }]);
		expect(globalThis.ChatMessage.create.mock.calls[0][0].content).toContain("pim calls bram on it");
	});

	it("puts that PC's rolls at the hero at disadvantage, token or aimed ask, until they work it out", async () => {
		const { pim, bram, cadi } = pcs();
		await callOut(pim, bram);
		const token = [{ uuid: "Scene.scene1.Token.tpim", name: "Pim" }];
		const asked = [{ uuid: "Actor.pim", name: "Pim", actorId: "pim" }];
		expect(toughLoveAgainst(bram, token)).toBe(HERO_MOVES.TOUGH_LOVE);
		expect(toughLoveAgainst(bram, asked)).toBe(HERO_MOVES.TOUGH_LOVE);
		// Not someone the hero never called on it, not a roll at somebody else, and not half a roll.
		expect(toughLoveAgainst(cadi, token)).toBeNull();
		expect(toughLoveAgainst(bram, [{ uuid: "Actor.cadi", name: "Cadi" }])).toBeNull();
		expect(toughLoveAgainst(bram, [...token, { uuid: "Actor.cadi", name: "Cadi" }])).toBeNull();
		expect(toughLoveAgainst(bram, [])).toBeNull();
		expect(await workedItOut(pim, "bram")).toBe(true);
		expect(await workedItOut(pim, "bram")).toBe(false);
		expect(pim.getFlag(SYSTEM_ID, TOUGH_LOVE_FLAG)).toEqual([]);
		expect(toughLoveAgainst(bram, token)).toBeNull();
	});

	it("does nothing while the move is not learned", async () => {
		const { pim, bram } = pcs();
		pim.items = [{ type: "move", name: HERO_MOVES.TOUGH_LOVE, flags: { [SYSTEM_ID]: { learned: false } } }];
		expect(await callOut(pim, bram)).toBe(false);
		pim.flags[SYSTEM_ID][TOUGH_LOVE_FLAG] = [{ id: "bram", name: "bram" }];
		expect(toughLoveAgainst(bram, [{ uuid: "Actor.pim", actorId: "pim" }])).toBeNull();
	});
});

// Coverage pass (2026-10-16): the Marshal's Focus Fire, "You can spend 1 Command to order your allies to bring
// down a foe. If you do, each ally has advantage on their next damage roll against that foe" (Book I p.127),
// and Set-Up Strike, "When you Clash and get a 7+, you can choose to deal damage with disadvantage" (p.126).
describe("Focus Fire", () => {
	function marshal(held) {
		const tracks = { Stentorian: held };
		const m = hero("bryn", [
			{ type: "move", name: "Focus Fire" },
			{ type: "move", name: "Stentorian", system: { resource: { max: 2 } } },
		]);
		const uses = `flags.${SYSTEM_ID}.backgroundChoices.`;
		m.typedActor = { moveResources: {
			getMoveResources: () => tracks,
			usesUpdate: (move, value) => ({ [`${uses}${move}`]: value }),
		} };
		// One write carries the track and the flag, as actor.update does.
		m.update = vi.fn(async data => {
			for (const [key, value] of Object.entries(data)) {
				if (key.startsWith(uses)) tracks[key.slice(uses.length)] = value;
				else if (key.startsWith(`flags.${SYSTEM_ID}.`)) m.flags[SYSTEM_ID][key.slice(`flags.${SYSTEM_ID}.`.length)] = value;
			}
		});
		return Object.assign(m, { tracks });
	}

	it("spends 1 Command and names the foe in ONE write; nothing without Command held", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })]]);
		const bryn = marshal(2);
		const entry = await orderFocusFire(bryn, target(t.crin), { now: 5, combat: null });
		expect(entry).toMatchObject({ key: t.crin.uuid, name: "Crinwin", combat: null });
		expect(bryn.tracks.Stentorian).toBe(1);
		expect(bryn.getFlag(SYSTEM_ID, FOCUS_FIRE_FLAG)).toHaveLength(1);
		expect(bryn.update).toHaveBeenCalledTimes(1);
		expect(bryn.update.mock.calls[0][1]).toEqual({ stonetopMove: "Stentorian" });
		expect(bryn.setFlag).not.toHaveBeenCalled();
		const empty = marshal(0);
		expect(await orderFocusFire(empty, target(t.crin))).toBeNull();
		expect(empty.update).not.toHaveBeenCalled();
	});

	it("lets go of orders given in a fight since deleted, when the next order is given", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })]]);
		const bryn = marshal(2);
		await orderFocusFire(bryn, target(t.crin), { now: 5, combat: { id: "gone" } });
		await orderFocusFire(bryn, target(t.crin), { now: 6, combat: { id: "fight2" }, combats: collection([{ id: "fight2" }]) });
		expect(bryn.getFlag(SYSTEM_ID, FOCUS_FIRE_FLAG).map(order => order.id)).toEqual(["bryn.6"]);
	});

	it("lets go of an ally's answered ids no Marshal still holds live, as the next one is answered", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })]]);
		const bryn = marshal(2);
		const ash = hero("ash", []);
		ash.flags[SYSTEM_ID][FOCUS_FIRE_USED_FLAG] = ["bryn.1", "bryn.2"];
		await orderFocusFire(bryn, target(t.crin), { now: 2, combat: null });
		const order = await orderFocusFire(bryn, target(t.crin), { now: 3, combat: null });
		await spendFocusFire(ash, order, { actors: [bryn, ash], combats: collection([]) });
		// bryn.1 is held by nobody now; bryn.2 still is.
		expect(ash.getFlag(SYSTEM_ID, FOCUS_FIRE_USED_FLAG)).toEqual(["bryn.2", "bryn.3"]);
	});

	it("gives each ally's next damage roll against that foe advantage, once each, and never the Marshal's own", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })], ["wolf", fakeActor({ id: "wolf", name: "Wolf", type: "monster" })]]);
		const bryn = marshal(2);
		await orderFocusFire(bryn, target(t.crin), { now: 5, combat: null });
		const ash = hero("ash", []);
		const bea = hero("bea", []);
		const actors = [bryn, ash, bea];
		const order = focusFireAgainst(ash, [target(t.crin)], { actors });
		expect(order).toMatchObject({ key: t.crin.uuid });
		expect(focusFireAgainst(ash, [target(t.wolf)], { actors })).toBeNull();
		expect(focusFireAgainst(bryn, [target(t.crin)], { actors })).toBeNull();
		await spendFocusFire(ash, order);
		expect(focusFireAgainst(ash, [target(t.crin)], { actors })).toBeNull();
		expect(focusFireAgainst(bea, [target(t.crin)], { actors })).not.toBeNull();
	});

	it("lapses with the fight it was given in", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })]]);
		const bryn = marshal(2);
		await orderFocusFire(bryn, target(t.crin), { now: 5, combat: { id: "fight1" } });
		const ash = hero("ash", []);
		expect(focusFireAgainst(ash, [target(t.crin)], { actors: [bryn, ash], combats: collection([{ id: "fight1" }]) })).not.toBeNull();
		expect(focusFireAgainst(ash, [target(t.crin)], { actors: [bryn, ash], combats: collection([]) })).toBeNull();
	});

	it("is a TICKED advantage line on the ally's damage window, and taking it marks the order answered", async () => {
		const t = mapWith([["crin", fakeActor({ id: "crin", name: "Crinwin", type: "monster" })]]);
		const bryn = marshal(2);
		await orderFocusFire(bryn, target(t.crin), { now: 5, combat: null });
		const ash = hero("ash", []);
		globalThis.game = { ...saved.game, actors: [bryn, ash], combats: undefined };
		const line = blowOffers(ash, { targets: [target(t.crin)] }).find(offer => offer.key === "focusFire");
		expect(line).toMatchObject({ mode: "adv", applied: true });
		expect(blowOffers(bryn, { targets: [target(t.crin)] }).some(offer => offer.key === "focusFire")).toBe(false);
		await line.spend(ash);
		expect(blowOffers(ash, { targets: [target(t.crin)] }).some(offer => offer.key === "focusFire")).toBe(false);
		// The roller's own mode is no longer where it rides.
		expect(ownDamageMode(ash, "")).toBe("");
	});
});

describe("Set-Up Strike", () => {
	it("offers an unticked disadvantage line on a Clash's damage alone", () => {
		const bryn = hero("bryn", ["Set-Up Strike"]);
		const line = blowOffers(bryn, { moveKey: "clash" }).find(offer => offer.key === "setUpStrike");
		expect(line).toMatchObject({ mode: "dis", applied: false, ask: true });
		expect(blowOffers(bryn, { moveKey: "let-fly" }).some(offer => offer.key === "setUpStrike")).toBe(false);
		expect(blowOffers(bryn, { moveKey: "clash", strikeBack: true }).some(offer => offer.key === "setUpStrike")).toBe(false);
		expect(blowOffers(hero("ash", []), { moveKey: "clash" }).some(offer => offer.key === "setUpStrike")).toBe(false);
	});
});

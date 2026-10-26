import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeSeed, incomingSeed, seedWithoutStriker, sheetSeed, engagedFoeTargets, seedForRoll, rollerCombatant } from "../../module/fight/damage-seed.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

// The fight's +N for several attackers (Book I p.414), offered to damage rolls.

let saved;
let fightTabOn;
beforeEach(() => {
	saved = { game: globalThis.game, ui: globalThis.ui, canvas: globalThis.canvas, fromUuidSync: globalThis.fromUuidSync, CONST: globalThis.CONST };
	fightTabOn = true;
	globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
});
afterEach(() => { Object.assign(globalThis, saved); });

/**
 * Bram and Aeliana on one crinwin; Cadi between two wolves; a horde of six beside Bram's other flank.
 */
function fight() {
	const actor = (id, type, extra = {}) => fakeActor({ id, name: id[0].toUpperCase() + id.slice(1), type, ...extra });
	const bramActor = actor("bram", "character");
	const cadiActor = actor("cadi", "character");
	const wolfActor = actor("wolf", "monster");
	const token = (id, col, row, a) => Object.assign(fakeToken({ id, col, row, actor: a }), { uuid: `Scene.scene1.Token.${id}`, documentName: "Token" });
	const tokens = {
		bram: token("tBram", 0, 1, bramActor),
		aeliana: token("tAel", 0, 3, actor("aeliana", "character")),
		crinwin: token("tCrin", 0, 2, actor("crinwin", "monster")),
		cadi: token("tCadi", 6, 1, cadiActor),
		wolf1: token("tW1", 5, 1, wolfActor),
		wolf2: token("tW2", 7, 1, wolfActor),
	};
	const scene = fakeScene({ tokens: Object.values(tokens) });
	const c = (id, t) => fakeCombatant({ id, token: t, scene });
	const combat = fakeCombat({ scene, combatants: [
		c("cBram", tokens.bram), c("cAel", tokens.aeliana), c("cCrin", tokens.crinwin),
		c("cCadi", tokens.cadi), c("cW1", tokens.wolf1), c("cW2", tokens.wolf2),
	] });
	globalThis.game = {
		...saved.game,
		user: { id: "gm", isGM: true },
		users: collection([]),
		combats: collection([combat]),
		settings: { get: (scope, key) => (key === "fightTab" ? fightTabOn : undefined) },
	};
	globalThis.ui = { combat: { viewed: combat } };
	globalThis.canvas = { scene };
	const byUuid = new Map(Object.values(tokens).map(t => [t.uuid, t]));
	globalThis.fromUuidSync = uuid => byUuid.get(uuid) ?? null;
	return { scene, combat, tokens, bramActor, cadiActor, wolfActor };
}

describe("makeSeed", () => {
	it("words a party's pile-on, with two named as both and more as all", () => {
		expect(makeSeed({ count: 2, direction: "onFoe", target: "Crinwin", names: ["Bram", "Aeliana"] })).toMatchObject({
			bonus: 1, count: 2, applied: true,
			label: "+1: Bram & Aeliana are both fighting Crinwin",
			pill: "+1 for 2 attackers",
			pillLeftOff: "+1 for 2 attackers, left off",
			cite: "Book I, page 414",
		});
		expect(makeSeed({ count: 3, direction: "onFoe", target: "Crinwin", names: ["A", "B", "C"] }).label)
			.toBe("+2: A, B & C are all fighting Crinwin");
	});

	it("words foes piling onto a character", () => {
		expect(makeSeed({ count: 2, direction: "onHero", target: "Cadi", names: ["Wolf", "Wolf"] })).toMatchObject({
			bonus: 1, label: "+1: Cadi is fighting Wolf & Wolf", pill: "+1 for 2 foes",
		});
	});

	it("is nothing for a single attacker", () => {
		expect(makeSeed({ count: 1, direction: "onFoe", target: "Crinwin", names: ["Bram"] })).toBeNull();
	});
});

describe("seedForRoll: a hero's pile-on on one foe", () => {
	it("counts everyone on the targeted foe, the roller included", () => {
		const { bramActor, tokens } = fight();
		expect(seedForRoll({ attacker: bramActor, targets: [{ uuid: tokens.crinwin.uuid }] }))
			.toMatchObject({ bonus: 1, count: 2, direction: "onFoe", target: "Crinwin", names: ["Bram", "Aeliana"] });
	});

	it("counts a roller who is not in contact, once", () => {
		const { tokens } = fight();
		const archer = fakeActor({ id: "archer", name: "Archer", type: "character" });
		expect(seedForRoll({ attacker: archer, targets: [{ uuid: tokens.crinwin.uuid }] }))
			.toMatchObject({ bonus: 2, count: 3, names: ["Archer", "Bram", "Aeliana"] });
	});

	it("offers nothing on a foe nobody else is fighting", () => {
		const { cadiActor, tokens } = fight();
		expect(seedForRoll({ attacker: cadiActor, targets: [{ uuid: tokens.wolf1.uuid }] })).toBeNull();
	});

	it("offers nothing with the Fight tab off, or for a target that is not a token in the fight", () => {
		const { bramActor, tokens } = fight();
		expect(seedForRoll({ attacker: bramActor, targets: [{ uuid: "Actor.somebody" }] })).toBeNull();
		fightTabOn = false;
		expect(seedForRoll({ attacker: bramActor, targets: [{ uuid: tokens.crinwin.uuid }] })).toBeNull();
	});

	it("offers nothing against a token standing for several foes", () => {
		const { bramActor, tokens, combat } = fight();
		combat.combatants.get("cCrin").flags["stonetop-pwd"].count = 6;
		expect(seedForRoll({ attacker: bramActor, targets: [{ uuid: tokens.crinwin.uuid }] })).toBeNull();
	});
});

describe("incomingSeed and the foes in contact", () => {
	it("counts the foes in contact with a character", () => {
		const { cadiActor } = fight();
		expect(incomingSeed({ pc: cadiActor })).toMatchObject({ bonus: 1, direction: "onHero", target: "Cadi", names: ["Wolf", "Wolf"] });
	});

	it("offers nothing to a character facing one foe", () => {
		const { bramActor } = fight();
		expect(incomingSeed({ pc: bramActor })).toBeNull();
	});

	it("names the foes in contact as the character's enemy, token by token", () => {
		const { cadiActor, bramActor } = fight();
		expect(engagedFoeTargets(cadiActor).map(t => t.uuid)).toEqual(["Scene.scene1.Token.tW1", "Scene.scene1.Token.tW2"]);
		expect(engagedFoeTargets(bramActor)).toEqual([expect.objectContaining({ uuid: "Scene.scene1.Token.tCrin", actorId: "crinwin" })]);
		fightTabOn = false;
		expect(engagedFoeTargets(cadiActor)).toEqual([]);
	});
});

describe("sheetSeed", () => {
	it("counts the wolves on Cadi when the GM rolls a wolf's damage from its token", () => {
		const { tokens } = fight();
		const tokenActor = { ...tokens.wolf1.actor, token: tokens.wolf1 };
		expect(sheetSeed({ actor: tokenActor })).toMatchObject({ bonus: 1, direction: "onHero", target: "Cadi" });
	});

	it("offers nothing to a token fighting more than one opponent, or to a lone attacker", () => {
		const { tokens } = fight();
		expect(sheetSeed({ actor: { ...tokens.crinwin.actor, token: tokens.crinwin } })).toBeNull();
		expect(sheetSeed({ actor: { ...tokens.aeliana.actor, token: tokens.aeliana } })).toMatchObject({ bonus: 1, direction: "onFoe", target: "Crinwin" });
	});

	describe("group against group (p.416)", () => {
		/** The Marshal's crew of `crew` against a horde of `horde` crinwin fighting as one token, in contact. */
		function groups({ crew = 5, horde = 12, hp = 3 } = {}) {
			const hordeActor = fakeActor({ id: "horde", name: "Crinwin", type: "monster", system: { organization: "horde", fightAsGroup: true, count: horde, attributes: { hp: { value: hp, max: 3 } } } });
			const crewActor = fakeActor({ id: "crew", name: "Crew", type: "npc" });
			const token = (id, col, a) => Object.assign(fakeToken({ id, col, row: 0, actor: a }), { uuid: `Scene.scene1.Token.${id}`, documentName: "Token" });
			const tHorde = token("tHorde", 1, hordeActor);
			const tCrew = token("tCrew", 0, crewActor);
			const scene = fakeScene({ tokens: [tHorde, tCrew] });
			const combat = fakeCombat({ scene, combatants: [
				fakeCombatant({ id: "cCrew", token: tCrew, scene, side: "heroes", count: crew }),
				fakeCombatant({ id: "cHorde", token: tHorde, scene }),
			] });
			globalThis.game = { ...saved.game, user: { id: "gm", isGM: true }, users: collection([]), combats: collection([combat]),
				settings: { get: (scope, key) => (key === "fightTab" ? fightTabOn : undefined) } };
			globalThis.ui = { combat: { viewed: combat } };
			globalThis.canvas = { scene };
			return { hordeActor: { ...hordeActor, token: tHorde }, crewActor: { ...crewActor, token: tCrew } };
		}

		it("gives the bigger group +1 damage for each multiple past the first", () => {
			const { hordeActor } = groups();
			expect(sheetSeed({ actor: hordeActor })).toMatchObject({
				bonus: 1, direction: "groupAhead", applied: true,
				label: "+1: group against group, 12 outnumber 5",
				pill: "+1 for 12 against 5",
				cite: "Book I, page 416",
			});
		});

		it("takes the bigger group's +1 armor off the smaller group's roll", () => {
			const { crewActor } = groups();
			expect(sheetSeed({ actor: crewActor })).toMatchObject({
				bonus: -1, direction: "groupBehind",
				label: "-1: group against group, 12 outnumber 5, so their armor is +1",
				pill: "-1 for their armor, 12 against 5",
			});
		});

		it("gives a group token its group seed for a blow at the other side's group, and never a pile-on", () => {
			const { hordeActor } = groups();
			const crew = { uuid: "Scene.scene1.Token.tCrew" };
			expect(seedForRoll({ attacker: hordeActor, targets: [crew] })).toMatchObject({ bonus: 1, direction: "groupAhead" });
			// Aimed at somebody who is not one of the groups too: not a blow in the exchange (FGT-1), and two
			// targets carry no pile-on either.
			expect(seedForRoll({ attacker: hordeActor, targets: [crew, { uuid: "Scene.scene1.Token.other" }] })).toBeNull();
		});

		it("counts a group's casualties, and offers nothing when neither side outnumbers the other", () => {
			// Half the horde's pool gone: 6 of 12 standing, against 5.
			expect(sheetSeed({ actor: groups({ hp: 1.5 }).hordeActor })).toBeNull();
			expect(sheetSeed({ actor: groups({ crew: 6, horde: 6 }).hordeActor })).toBeNull();
		});
	});

	it("finds a linked actor's one token on the canvas scene, and gives up on several", () => {
		const { tokens, wolfActor } = fight();
		const linked = { ...tokens.aeliana.actor, getActiveTokens: () => [tokens.aeliana] };
		expect(sheetSeed({ actor: linked })).toMatchObject({ bonus: 1, target: "Crinwin" });
		const many = { ...wolfActor, getActiveTokens: () => [tokens.wolf1, tokens.wolf2] };
		expect(sheetSeed({ actor: many })).toBeNull();
	});
});

describe("a group with no group to fight", () => {
	/** Put a fight on the map: every token a combatant, on the side it would take unless `sides` says. */
	function stage(tokens, { sides = {}, counts = {} } = {}) {
		const scene = fakeScene({ tokens: Object.values(tokens) });
		const combat = fakeCombat({ scene, combatants: Object.entries(tokens).map(([key, t]) =>
			fakeCombatant({ id: `c${t.id}`, token: t, scene, side: sides[key], count: counts[key] })) });
		globalThis.game = { ...saved.game, user: { id: "gm", isGM: true }, users: collection([]), combats: collection([combat]),
			settings: { get: (scope, key) => (key === "fightTab" ? fightTabOn : undefined) } };
		globalThis.ui = { combat: { viewed: combat } };
		globalThis.canvas = { scene };
		const byUuid = new Map(Object.values(tokens).map(t => [t.uuid, t]));
		globalThis.fromUuidSync = uuid => byUuid.get(uuid) ?? null;
	}
	const token = (id, col, row, a) => Object.assign(fakeToken({ id, col, row, actor: a }), { uuid: `Scene.scene1.Token.${id}`, documentName: "Token" });

	/** A horde of crinwin fighting as ONE token beside Cadi, who has nobody with her. `apart` stands it off while a wolf fights her. */
	function hordeOnCadi({ horde = 6, hp = 3, apart = false } = {}) {
		const hordeActor = fakeActor({ id: "horde", name: "Crinwin", type: "monster", system: { organization: "horde", fightAsGroup: true, count: horde, attributes: { hp: { value: hp, max: 3 } } } });
		const tokens = {
			cadi: token("tCadi", 0, 0, fakeActor({ id: "cadi", name: "Cadi", type: "character" })),
			horde: token("tHorde", apart ? 5 : 1, 0, hordeActor),
			...(apart ? { wolf: token("tWolf", 0, 1, fakeActor({ id: "wolf", name: "Wolf", type: "monster" })) } : {}),
		};
		stage(tokens);
		return { tokens, hordeActor: { ...hordeActor, token: tokens.horde } };
	}

	// p.414 counts attackers, not tokens: six crinwin on a lone hero are six attackers, whichever scale
	// they are fought at. The tab's badge and Cadi's own counter-blow always said so; now her attacker's
	// Damage line does too, with the stat block's swarm row gone while the Fight tab is on.
	it("piles a monster group on a lone hero with every body it stands for", () => {
		const { hordeActor, tokens } = hordeOnCadi();
		expect(sheetSeed({ actor: hordeActor })).toMatchObject({
			bonus: 5, count: 6, direction: "onHero", target: "Cadi", names: ["Crinwin"],
			label: "+5: Cadi is fighting Crinwin", pill: "+5 for 6 foes", cite: "Book I, page 414",
		});
		expect(seedForRoll({ attacker: hordeActor, targets: [{ uuid: tokens.cadi.uuid }] })).toMatchObject({ bonus: 5, count: 6, target: "Cadi" });
		expect(incomingSeed({ pc: tokens.cadi.actor })).toMatchObject({ bonus: 5, count: 6 });
	});

	it("counts only the members still standing", () => {
		// 2 of the pool's 3 HP left: 4 of the 6 on their feet.
		expect(sheetSeed({ actor: hordeOnCadi({ hp: 2 }).hordeActor })).toMatchObject({ bonus: 3, count: 4 });
	});

	it("counts every body of a horde rolled at a hero it is not touching", () => {
		const { hordeActor, tokens } = hordeOnCadi({ apart: true });
		expect(seedForRoll({ attacker: hordeActor, targets: [{ uuid: tokens.cadi.uuid }] }))
			.toMatchObject({ bonus: 6, count: 7, names: ["Crinwin", "Wolf"] });
	});

	// A follower group's Swarm die (fight/follower-fight.js) carries its pile-on, beside a plain die that is
	// one member's. The fight ring rolls both seeded, so a pile-on here would count the crew twice.
	it("leaves any other group to its own Swarm die", () => {
		const tokens = {
			crew: token("tCrew", 0, 0, fakeActor({ id: "crew", name: "Crew", type: "npc" })),
			wolf: token("tWolf", 1, 0, fakeActor({ id: "wolf", name: "Wolf", type: "monster" })),
		};
		stage(tokens, { sides: { crew: "heroes" }, counts: { crew: 5 } });
		const crewActor = { ...tokens.crew.actor, token: tokens.crew };
		expect(sheetSeed({ actor: crewActor })).toBeNull();
		expect(seedForRoll({ attacker: crewActor, targets: [{ uuid: tokens.wolf.uuid }] })).toBeNull();
	});
});

describe("seedForRoll", () => {
	it("counts the wolves on Cadi when one of them rolls its damage at her", () => {
		const { tokens } = fight();
		const wolf = { ...tokens.wolf1.actor, token: tokens.wolf1 };
		expect(seedForRoll({ attacker: wolf, targets: [{ uuid: tokens.cadi.uuid }] }))
			.toMatchObject({ bonus: 1, count: 2, direction: "onHero", target: "Cadi", names: ["Wolf", "Wolf"] });
	});

	it("counts everyone on a foe a character rolls at, as the attack flow always did", () => {
		const { bramActor, tokens } = fight();
		expect(seedForRoll({ attacker: bramActor, targets: [{ uuid: tokens.crinwin.uuid }] }))
			.toMatchObject({ bonus: 1, direction: "onFoe", target: "Crinwin", names: ["Bram", "Aeliana"] });
	});

	it("counts a character outside the fight as one more on the foe", () => {
		const { tokens } = fight();
		const archer = fakeActor({ id: "archer", name: "Archer", type: "character" });
		expect(seedForRoll({ attacker: archer, targets: [{ uuid: tokens.crinwin.uuid }] })).toMatchObject({ bonus: 2, count: 3 });
	});

	it("offers nothing against several targets, one the roller's own side, or nobody", () => {
		const { bramActor, tokens } = fight();
		expect(seedForRoll({ attacker: bramActor, targets: [{ uuid: tokens.crinwin.uuid }, { uuid: tokens.wolf1.uuid }] })).toBeNull();
		expect(seedForRoll({ attacker: bramActor, targets: [{ uuid: tokens.aeliana.uuid }] })).toBeNull();
		expect(seedForRoll({ attacker: bramActor, targets: [] })).toBeNull();
		fightTabOn = false;
		expect(seedForRoll({ attacker: bramActor, targets: [{ uuid: tokens.crinwin.uuid }] })).toBeNull();
	});
});

describe("what the other attackers bring (p.414: the best die, and every attacker's tags)", () => {
	it("opens as an offer, unticked, when another character is on the foe and rolls their own damage", () => {
		const { bramActor, tokens } = fight();
		const seed = seedForRoll({ attacker: bramActor, targets: [{ uuid: tokens.crinwin.uuid }] });
		expect(seed.applied).toBe(false);
		expect(seed.label).toBe("+1: Bram & Aeliana are both fighting Crinwin, if you strike together");
	});

	it("opens ticked when the others are foes or followers, who do not roll beside the roller", () => {
		const { tokens } = fight();
		const wolf = { ...tokens.wolf1.actor, token: tokens.wolf1 };
		expect(seedForRoll({ attacker: wolf, targets: [{ uuid: tokens.cadi.uuid }] }).applied).toBe(true);
	});

	it("carries the other attackers' dice, and a character's die off their sheet", () => {
		const { tokens } = fight();
		tokens.aeliana.actor.system = { attributes: { damage: { value: "d10" } } };
		const seed = seedForRoll({ attacker: tokens.bram.actor, targets: [{ uuid: tokens.crinwin.uuid }] });
		expect(seed.dice).toEqual([{ name: "Aeliana", formula: "d10" }]);
	});

	it("carries the other foes' tags and piercing onto a counter-blow on one character", () => {
		const { cadiActor, wolfActor } = fight();
		wolfActor.system = { attributes: { damage: { value: "bite d6 (1 piercing, messy)", rollFormula: "d6" } } };
		const seed = incomingSeed({ pc: cadiActor });
		expect(seed).toMatchObject({ piercing: 1, tags: ["messy"] });
	});

	it("takes the striking foe's own tags and piercing back out of its blow, keeping the others'", () => {
		const seed = {
			bonus: 1, tags: ["messy", "grabby"], piercing: 2,
			sources: [{ uuid: "Scene.s.Token.a", tags: ["messy"], piercing: 2 }, { uuid: "Scene.s.Token.b", tags: ["grabby"], piercing: 0 }],
		};
		expect(seedWithoutStriker(seed, "Scene.s.Token.a")).toMatchObject({ bonus: 1, tags: ["grabby"], piercing: 0 });
		expect(seedWithoutStriker(seed, "Scene.s.Token.elsewhere")).toBe(seed);
		expect(seedWithoutStriker(null, "Scene.s.Token.a")).toBeNull();
	});
});

describe("rollerCombatant", () => {
	it("finds a token's own combatant, and a linked actor's only one", () => {
		const { combat, scene, tokens, bramActor } = fight();
		expect(rollerCombatant(combat, scene, { ...tokens.wolf2.actor, token: tokens.wolf2 })?.id).toBe("cW2");
		expect(rollerCombatant(combat, scene, bramActor)?.id).toBe("cBram");
	});

	it("gives up on an actor with several tokens in the fight, or none", () => {
		const { combat, scene, wolfActor } = fight();
		expect(rollerCombatant(combat, scene, wolfActor)).toBeNull();
		expect(rollerCombatant(combat, scene, fakeActor({ id: "nobody" }))).toBeNull();
		expect(rollerCombatant(null, scene, wolfActor)).toBeNull();
	});
});

// FGT-1: "Foes that are engaged by individual PCs aren't really part of a group" (p.416). A group in an
// exchange takes the group seed only for a blow AT the other side's groups; at a lone hero it is a crowd on
// an individual (a monster's pile-on), and a follower group's blow at a lone foe carries nothing.
describe("a group's blow at an individual in its group exchange", () => {
	const token = (id, col, row, a) => Object.assign(fakeToken({ id, col, row, actor: a }), { uuid: `Scene.scene1.Token.${id}`, documentName: "Token" });

	/** The crew of 5 and a horde of 12 crinwin trading blows; Cadi in the horde's face; an ogre on the crew. */
	function scrum() {
		const hordeActor = fakeActor({ id: "horde", name: "Crinwin", type: "monster", system: { organization: "horde", fightAsGroup: true, count: 12, attributes: { hp: { value: 3, max: 3 } } } });
		const tokens = {
			crew: token("tCrew", 0, 0, fakeActor({ id: "crew", name: "Crew", type: "npc" })),
			horde: token("tHorde", 1, 0, hordeActor),
			cadi: token("tCadi", 2, 0, fakeActor({ id: "cadi", name: "Cadi", type: "character" })),
			ogre: token("tOgre", 0, 1, fakeActor({ id: "ogre", name: "Ogre", type: "monster" })),
		};
		const scene = fakeScene({ tokens: Object.values(tokens) });
		const combat = fakeCombat({ scene, combatants: [
			fakeCombatant({ id: "cCrew", token: tokens.crew, scene, side: "heroes", count: 5 }),
			fakeCombatant({ id: "cHorde", token: tokens.horde, scene }),
			fakeCombatant({ id: "cCadi", token: tokens.cadi, scene }),
			fakeCombatant({ id: "cOgre", token: tokens.ogre, scene }),
		] });
		globalThis.game = { ...saved.game, user: { id: "gm", isGM: true }, users: collection([]), combats: collection([combat]),
			settings: { get: (scope, key) => (key === "fightTab" ? fightTabOn : undefined) } };
		globalThis.ui = { combat: { viewed: combat } };
		globalThis.canvas = { scene };
		const byUuid = new Map(Object.values(tokens).map(t => [t.uuid, t]));
		globalThis.fromUuidSync = uuid => byUuid.get(uuid) ?? null;
		const own = key => ({ ...tokens[key].actor, token: tokens[key] });
		return { tokens, horde: own("horde"), crew: own("crew"), cadi: tokens.cadi.actor };
	}

	it("piles the horde onto the lone hero it swings at, as her badge and counter-blow say", () => {
		const { tokens, horde, cadi } = scrum();
		// Twelve crinwin, eight of them able to reach her: +7, not the groups' +1.
		expect(seedForRoll({ attacker: horde, targets: [{ uuid: tokens.cadi.uuid }] }))
			.toMatchObject({ bonus: 7, count: 8, direction: "onHero", target: "Cadi" });
		expect(incomingSeed({ pc: cadi })).toMatchObject({ bonus: 7, count: 8 });
	});

	it("keeps the group seed for the blows the groups trade, counted without the member Cadi holds", () => {
		const { tokens, horde, crew } = scrum();
		// 11 crinwin to 5 (Cadi holds one): the horde +1, the crew -1 for the horde's armor.
		expect(seedForRoll({ attacker: horde, targets: [{ uuid: tokens.crew.uuid }] })).toMatchObject({ bonus: 1, direction: "groupAhead" });
		expect(seedForRoll({ attacker: crew, targets: [{ uuid: tokens.horde.uuid }] })).toMatchObject({ bonus: -1, direction: "groupBehind" });
	});

	it("puts no group armor on a lone foe the crew strikes, and no seed on a horde's roll at a mixed crowd", () => {
		const { tokens, horde, crew } = scrum();
		expect(seedForRoll({ attacker: crew, targets: [{ uuid: tokens.ogre.uuid }] })).toBeNull();
		// From its sheet, with nothing aimed: the crew and Cadi both, so neither the exchange nor a pile-on on one.
		expect(sheetSeed({ actor: horde })).toBeNull();
	});
});

// FGT-9: a linked actor with several tokens in the fight rolls from the one this reader has selected, which
// is the token the fight ring was opened on.
describe("an actor with several tokens, one of them selected", () => {
	it("settles on the selected token's combatant, and gives up with none or both selected", () => {
		const { combat, scene, tokens, wolfActor } = fight();
		expect(rollerCombatant(combat, scene, wolfActor, { controlled: [{ document: { id: "tW1" } }] })?.id).toBe("cW1");
		expect(rollerCombatant(combat, scene, wolfActor, { controlled: [] })).toBeNull();
		expect(rollerCombatant(combat, scene, wolfActor, { controlled: [{ id: "tW1" }, { id: "tW2" }] })).toBeNull();
		globalThis.canvas.tokens = { controlled: [{ document: tokens.wolf2 }] };
		expect(rollerCombatant(combat, scene, wolfActor)?.id).toBe("cW2");
	});

	it("aims the stat block's roll from the selected token", () => {
		const { tokens, wolfActor } = fight();
		const many = { ...wolfActor, getActiveTokens: () => [tokens.wolf1, tokens.wolf2] };
		globalThis.canvas.tokens = { controlled: [{ document: tokens.wolf1 }] };
		expect(sheetSeed({ actor: many })).toMatchObject({ bonus: 1, direction: "onHero", target: "Cadi" });
	});
});

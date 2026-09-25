import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { followerOrderInfo, openFollowerOrder, followerTakesOrders, followerTags, followerSwarm, followerRingInfo, followerInFight } from "../../module/fight/follower-fight.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { followerCardFor } from "../../module/actors/character/follower-masters.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection } from "../fakes/fight.js";

// Ordering a follower from their token: whose follower it is, what the Order dialog is handed, and
// who is refused a button.

const move = (id, name) => ({ id, type: "npcMove", name, system: {} });

/**
 * The card a token stands for. The two readers below are handed one rather than looking it up, which
 * is how the ring calls them (followerRingInfo does the one search), so the tests do that search.
 */
const cardOf = (actor, characters = [], resolve = undefined) =>
	followerCardFor(actor, { characters, ...(resolve === undefined ? {} : { resolve }) });

/** The Initiate background with Enfys picked: without it an initiate is nobody's follower (initiates.js). */
const INITIATE_BG = { selected: "initiate", choices: { enfys: true } };

/** A character with follower flags, and a sheet that records what it was asked to order. */
function character(id, flags = {}) {
	const actor = fakeActor({ id, type: "character", name: id, flags: { [SYSTEM_ID]: flags } });
	actor.uuid = `Actor.${id}`;
	actor.sheet = { orderFollower: vi.fn(async () => {}) };
	return actor;
}

/** A follower NPC as createFollowerActor makes one: the card's name, tags and moves, and its stamp. */
function follower({ id = "enfys", name = "Enfys", tags = "", moves = [], origin = undefined } = {}) {
	const actor = fakeActor({
		id, type: "npc", name,
		system: { tags, attributes: { damage: { value: "d6 (close)", rollFormula: "d6" } } },
		flags: origin === undefined ? {} : { [SYSTEM_ID]: { followerOrigin: origin } },
	});
	actor.uuid = `Actor.${id}`;
	actor.items = collection(moves.map((m, i) => move(`m${i}`, m)));
	return actor;
}

let saved;
beforeEach(() => {
	saved = { actors: globalThis.game.actors, fromUuidSync: globalThis.fromUuidSync };
});
afterEach(() => {
	globalThis.game.actors = saved.actors;
	globalThis.fromUuidSync = saved.fromUuidSync;
});

describe("followerTags", () => {
	it("reads the one comma-separated line the NPC keeps its tags on", () => {
		expect(followerTags("brave, sharp-eyed , rookie")).toEqual(["brave", "sharp-eyed", "rookie"]);
		expect(followerTags("")).toEqual([]);
		expect(followerTags(undefined)).toEqual([]);
	});
});

describe("followerTakesOrders", () => {
	it("takes orders from every follower type", () => {
		for (const ftype of ["crew", "animal-companion", "initiate", "custom"]) {
			expect(followerTakesOrders({ ftype, slug: "" })).toBe(true);
		}
	});

	it("orders a beast that is a follower, never livestock", () => {
		expect(followerTakesOrders({ ftype: "beast", slug: "dog-follower" })).toBe(true);
		expect(followerTakesOrders({ ftype: "beast", slug: "horse" })).toBe(true);
		expect(followerTakesOrders({ ftype: "beast", slug: "goat" })).toBe(false);
		expect(followerTakesOrders({ ftype: "beast", slug: "pig" })).toBe(false);
	});

	it("orders nothing at all without a card", () => {
		expect(followerTakesOrders({})).toBe(false);
		expect(followerTakesOrders()).toBe(false);
	});
});

describe("followerOrderInfo", () => {
	it("hands the dialog the follower standing on the map: their name, tags and their own moves", () => {
		const cadi = character("cadi", { background: INITIATE_BG });
		const enfys = follower({
			name: "Enfys", tags: "brave, healer", moves: ["Tend the wounded", "Sing the old songs"],
			origin: { characterUuid: "Actor.cadi", ftype: "initiate", slug: "enfys" },
		});
		expect(followerOrderInfo(enfys, cardOf(enfys, [cadi]))).toEqual({
			character: cadi, ftype: "initiate", slug: "enfys",
			follower: { name: "Enfys", tags: ["brave", "healer"], moves: ["Tend the wounded", "Sing the old songs"], exceptional: false },
		});
	});

	it("reads exceptional off the character, which is the one thing the NPC does not carry", () => {
		const rhianna = character("rhianna", { crew: { details: { exceptional: true } } });
		const crew = follower({ id: "crew", name: "The Crew", tags: "warrior", origin: { characterUuid: "Actor.rhianna", ftype: "crew", slug: "" } });
		expect(followerOrderInfo(crew, cardOf(crew, [rhianna])).follower.exceptional).toBe(true);
	});

	// Book I p.462 gates the crew and the animal companion behind a playbook move, but lets the GM
	// call ANY outstanding follower exceptional — so the sheet shows the chip for an initiate, a custom
	// follower and a beast follower too (see withExceptional). The token reads whatever the card stored,
	// at the card's own detail path, or the two doors into one dialog would roll differently.
	it("reads exceptional off a slug-keyed card too, so the map agrees with the card", () => {
		const cadi = character("cadi", { initiateDetails: { enfys: { exceptional: true } }, background: INITIATE_BG });
		const enfys = follower({ origin: { characterUuid: "Actor.cadi", ftype: "initiate", slug: "enfys" } });
		expect(followerOrderInfo(enfys, cardOf(enfys, [cadi])).follower.exceptional).toBe(true);
		// and stays false for a card that never set it
		const bram = character("bram", { initiateDetails: { enfys: {} }, background: INITIATE_BG });
		const plain = follower({ origin: { characterUuid: "Actor.bram", ftype: "initiate", slug: "enfys" } });
		expect(followerOrderInfo(plain, cardOf(plain, [bram])).follower.exceptional).toBe(false);
	});

	it("finds a recruited NPC by the link on the character's side, and which card holds it", () => {
		const cadi = character("cadi", { customFollowers: { abc123: { sourceUuid: "Actor.maeve", name: "Maeve" } } });
		const maeve = follower({ id: "maeve", name: "Maeve", tags: "stubborn" });
		expect(followerOrderInfo(maeve, cardOf(maeve, [cadi]))).toMatchObject({ character: cadi, ftype: "custom", slug: "abc123" });
	});

	it("offers nothing for a plain NPC, for livestock, or when the character cannot be found", () => {
		const cadi = character("cadi");
		const stranger = follower({ id: "stranger" });
		expect(followerOrderInfo(stranger, cardOf(stranger, [cadi]))).toBe(null);
		const goat = follower({ id: "goat", origin: { characterUuid: "Actor.cadi", ftype: "beast", slug: "goat" } });
		expect(followerOrderInfo(goat, cardOf(goat, [cadi]))).toBe(null);
		const orphan = follower({ origin: { characterUuid: "Actor.gone", ftype: "initiate", slug: "enfys" } });
		expect(followerOrderInfo(orphan, cardOf(orphan, [cadi], () => null))).toBe(null);
	});

	it("offers nothing for a monster or a character", () => {
		// Neither has a card to be handed, which is the whole of the answer.
		expect(followerOrderInfo(fakeActor({ id: "g", type: "monster" }), null)).toBe(null);
		expect(followerOrderInfo(fakeActor({ id: "b", type: "character" }), null)).toBe(null);
		expect(followerOrderInfo(null, null)).toBe(null);
	});
});

describe("openFollowerOrder", () => {
	it("goes through the character sheet's own door, on the move the button named", async () => {
		const cadi = character("cadi");
		const info = { character: cadi, ftype: "initiate", slug: "enfys", follower: { name: "Enfys", tags: ["brave"], moves: [], exceptional: false } };
		await openFollowerOrder(info, "clash");
		expect(cadi.sheet.orderFollower).toHaveBeenCalledWith(
			{ name: "Enfys", tags: ["brave"], moves: [], exceptional: false, moveKey: "clash" },
			{ ftype: "initiate", slug: "enfys" },
		);
	});

	it("leaves the dialog on its own default move when no move was named", async () => {
		const cadi = character("cadi");
		await openFollowerOrder({ character: cadi, ftype: "crew", slug: "", follower: { name: "The Crew" } }, null);
		expect(cadi.sheet.orderFollower.mock.calls[0][0].moveKey).toBe(null);
	});

	it("does nothing rather than throw when the sheet cannot order", async () => {
		await expect(openFollowerOrder(null, "clash")).resolves.toBe(null);
		await expect(openFollowerOrder({ character: { sheet: {} } }, "clash")).resolves.toBe(null);
	});
});

describe("followerSwarm", () => {
	/** Rhianna, whose crew is six with `down` of them at 0 HP. */
	function withCrew({ size = 6, down = 0, individuals = [] } = {}) {
		const memberHp = {};
		for (let i = 0; i < down; i += 1) memberHp[i] = 0;
		return character("rhianna", { crew: { size, individuals, memberHp: Object.assign([], memberHp) } });
	}
	const crewToken = (die = "d6") => {
		const actor = follower({ id: "crew", name: "The Crew", origin: { characterUuid: "Actor.rhianna", ftype: "crew", slug: "" } });
		actor.system.attributes.damage.rollFormula = die;
		return actor;
	};

	it("gives one member's die +1 for each of the others still standing", () => {
		expect(followerSwarm(crewToken(), cardOf(crewToken(), [withCrew()]))).toEqual({ formula: "d6+5", standing: 6, bonus: 5 });
	});

	it("counts only who is still up, so a bloodied crew swarms for less", () => {
		expect(followerSwarm(crewToken(), cardOf(crewToken(), [withCrew({ down: 4 })]))).toMatchObject({ formula: "d6+1", standing: 2 });
	});

	it("folds its bonus into a die that already carries one", () => {
		expect(followerSwarm(crewToken("d8+1"), cardOf(crewToken("d8+1"), [withCrew({ size: 3 })])).formula).toBe("d8+3");
	});

	it("is no swarm at all when one of them is left, or when the follower is one person", () => {
		expect(followerSwarm(crewToken(), cardOf(crewToken(), [withCrew({ down: 5 })]))).toBe(null);
		const cadi = character("cadi");
		const enfys = follower({ origin: { characterUuid: "Actor.cadi", ftype: "initiate", slug: "enfys" } });
		expect(followerSwarm(enfys, cardOf(enfys, [cadi]))).toBe(null);
	});

	it("is no swarm for a custom follower who is not a group, and is one for a custom group", () => {
		const alone = character("bram", { customFollowers: { abc: { sourceUuid: "Actor.maeve" } } });
		const band = character("bram", { customFollowers: { abc: { sourceUuid: "Actor.maeve", isGroup: true, size: 4 } } });
		const maeve = follower({ id: "maeve", name: "Maeve" });
		maeve.system.attributes.damage.rollFormula = "d8";
		expect(followerSwarm(maeve, cardOf(maeve, [alone]))).toBe(null);
		expect(followerSwarm(maeve, cardOf(maeve, [band]))).toMatchObject({ formula: "d8+3", standing: 4 });
	});

	it("has nothing to add to a follower with no die, or to anyone who is not a follower", () => {
		const dieless = crewToken("");
		expect(followerSwarm(dieless, cardOf(dieless, [withCrew()]))).toBe(null);
		expect(followerSwarm(fakeActor({ id: "g", type: "monster" }), null)).toBe(null);
		expect(followerSwarm(null, null)).toBe(null);
	});

});

describe("followerRingInfo", () => {
	function withCrew() {
		return character("rhianna", { crew: { size: 6, individuals: [], memberHp: [] } });
	}
	const crewToken = () => {
		const actor = follower({ id: "crew", name: "The Crew", tags: "warrior", origin: { characterUuid: "Actor.rhianna", ftype: "crew", slug: "" } });
		actor.system.attributes.damage.rollFormula = "d6";
		return actor;
	};

	it("answers both questions off one search for the character", () => {
		const rhianna = withCrew();
		const info = followerRingInfo(crewToken(), { characters: [rhianna] });
		expect(info.order).toMatchObject({ character: rhianna, ftype: "crew", follower: { name: "The Crew" } });
		expect(info.swarm).toMatchObject({ formula: "d6+5", standing: 6 });
	});

	it("hands the card it found to both readers, so neither goes looking again", () => {
		const rhianna = withCrew();
		// A card built by hand, for a character no search could reach: an answer can only have come
		// from the card the reader was handed, which is all either of them is given.
		const card = { character: rhianna, ftype: "crew", slug: "" };
		expect(followerOrderInfo(crewToken(), card)).toMatchObject({ character: rhianna });
		expect(followerSwarm(crewToken(), card)).toMatchObject({ standing: 6 });
	});

	it("answers nothing for anyone who is not a follower", () => {
		expect(followerRingInfo(follower({ id: "stranger" }), { characters: [] })).toEqual({ order: null, swarm: null });
		expect(followerRingInfo(fakeActor({ id: "b", type: "character" }))).toEqual({ order: null, swarm: null });
	});
});

describe("followerInFight", () => {
	let held;
	beforeEach(() => {
		held = { combats: globalThis.game.combats, settings: globalThis.game.settings, combat: globalThis.ui?.combat };
	});
	afterEach(() => {
		globalThis.game.combats = held.combats;
		globalThis.game.settings = held.settings;
		if (globalThis.ui) globalThis.ui.combat = held.combat;
	});

	/** A fight on one scene with a token for each actor, far enough apart that nobody touches. */
	function fightWith(actors, { fightTab = true } = {}) {
		const tokens = actors.map((actor, i) => fakeToken({ id: `t${i}`, col: i * 3, actor }));
		const scene = fakeScene({ tokens });
		const combat = fakeCombat({ scene, combatants: tokens.map((token, i) => fakeCombatant({ id: `c${i}`, token, scene })) });
		globalThis.game.combats = collection([combat]);
		globalThis.game.settings = { get: (scope, key) => (key === "fightTab" ? fightTab : undefined) };
		globalThis.ui ??= {};
		globalThis.ui.combat = { viewed: combat };
		return scene;
	}
	const rhianna = () => character("rhianna", { crew: { size: 6 }, customFollowers: { hari: { name: "Hari", sourceUuid: "Actor.hari" } } });
	const crewOf = (id = "crew") => follower({ id, name: "The Crew", origin: { characterUuid: "Actor.rhianna", ftype: "crew", slug: "" } });

	it("finds the token a card stands for, made for the card or recruited", () => {
		const owner = rhianna();
		const crew = crewOf();
		const hari = follower({ id: "hari", name: "Hari" });
		const scene = fightWith([owner, crew, hari]);
		expect(followerInFight(owner, { ftype: "crew", slug: "" }, { scene })).toBe(crew);
		expect(followerInFight(owner, { ftype: "custom", slug: "hari" }, { scene })).toBe(hari);
	});

	it("finds nobody for another card, or another character's follower", () => {
		const owner = rhianna();
		const scene = fightWith([owner, crewOf()]);
		expect(followerInFight(owner, { ftype: "custom", slug: "hari" }, { scene })).toBe(null);
		expect(followerInFight(character("bram"), { ftype: "crew", slug: "" }, { scene })).toBe(null);
	});

	it("finds nobody when the group is split into several tokens: which of them swung is anybody's guess", () => {
		const owner = rhianna();
		const scene = fightWith([owner, crewOf("crew"), crewOf("crew")]);
		expect(followerInFight(owner, { ftype: "crew", slug: "" }, { scene })).toBe(null);
	});

	it("finds nobody with the Fight tab off, or with the follower out of the fight", () => {
		const owner = rhianna();
		let scene = fightWith([owner, crewOf()], { fightTab: false });
		expect(followerInFight(owner, { ftype: "crew", slug: "" }, { scene })).toBe(null);
		scene = fightWith([owner]);
		expect(followerInFight(owner, { ftype: "crew", slug: "" }, { scene })).toBe(null);
	});
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	startWindowModel, startFight, lineUpFight, viewRectWorld, withGroupSizes, monsterNote, heroesBringAGroup,
} from "../../module/fight/start-fight.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, collection, GRID } from "../fakes/fight.js";

// Starting a fight, adding to one, and lining everyone up.

const format = (key, data) => globalThis.game.i18n.format(key, data);

describe("startWindowModel", () => {
	const token = (id, actorType, extra = {}) => ({
		id, name: id, img: "", type: actorType, hasPlayerOwner: actorType === "character",
		isFollower: false, disposition: -1, hidden: false, inFight: false, ...extra,
	});
	const scene = [
		token("aeliana", "character"),
		token("crinwin", "monster"),
		token("lurker", "monster", { hidden: true }),
		token("miller", "npc"),
		token("hound", "npc", { isFollower: true }),
		token("steading", "stonetop"),
	];

	it("files the map's tokens as heroes, foes and others, and never the steading", () => {
		const { groups, sides } = startWindowModel({ sceneTokens: scene, format });
		const byKey = Object.fromEntries(groups.map(g => [g.key, g.people.map(p => p.id)]));
		expect(byKey).toEqual({
			heroesHere: ["token:aeliana", "token:hound"],
			foesHere: ["token:crinwin", "token:lurker"],
			othersHere: ["token:miller"],
		});
		expect(sides.get("token:miller")).toBe("foes");
		expect(sides.has("token:steading")).toBe(false);
	});

	it("says which tokens are hidden from players", () => {
		const { groups } = startWindowModel({ sceneTokens: scene, format });
		const lurker = groups.find(g => g.key === "foesHere").people.find(p => p.id === "token:lurker");
		expect(lurker.hint).toBe("Hidden from players");
	});

	it("ticks the party and the monsters players can see, when nothing is selected", () => {
		expect(startWindowModel({ sceneTokens: scene, format }).selected.sort())
			.toEqual(["token:aeliana", "token:crinwin"]);
	});

	it("ticks the GM's selection instead, when there is one", () => {
		expect(startWindowModel({ sceneTokens: scene, controlled: ["miller", "lurker", "ghost"], format }).selected.sort())
			.toEqual(["token:lurker", "token:miller"]);
	});

	it("ticks exactly what it was handed, plus the party when asked (Deploy and fight)", () => {
		const model = startWindowModel({ sceneTokens: scene, controlled: ["miller"], preselect: ["crinwin"], preselectPcs: true, format });
		expect(model.selected.sort()).toEqual(["token:aeliana", "token:crinwin"]);
	});

	it("files a token handed in as a foe with the foes, whatever it is", () => {
		const model = startWindowModel({ sceneTokens: scene, forceFoes: ["hound"], format });
		expect(model.sides.get("token:hound")).toBe("foes");
		expect(model.groups.find(g => g.key === "foesHere").people.map(p => p.id)).toContain("token:hound");
	});

	it("leaves out, when adding, whoever is already in the fight, and ticks nobody by default", () => {
		const model = startWindowModel({ sceneTokens: [...scene, token("bram", "character", { inFight: true })], mode: "add", format });
		const ids = model.groups.flatMap(g => g.people.map(p => p.id));
		expect(ids).not.toContain("token:bram");
		expect(model.selected).toEqual([]);
	});

	describe("followers", () => {
		const bram = { id: "bram", name: "Bram", img: "" };
		const followerToken = (id, extra = {}) => token(id, "npc", { actorId: id, master: bram, disposition: -1, ...extra });

		it("puts a follower on the map under their character there, a hero with a tick of their own, and ticks them with the party", () => {
			const model = startWindowModel({
				sceneTokens: [token("bram", "character", { actorId: "bram" }), token("cadi", "character", { actorId: "cadi" }), followerToken("hound")],
				format,
			});
			const heroes = model.groups.find(g => g.key === "heroesHere").people;
			expect(heroes.map(r => [r.id, r.parent ?? null])).toEqual([["token:bram", null], ["token:hound", "token:bram"], ["token:cadi", null]]);
			expect(heroes[1].hint).toBe("Bram's follower");
			expect(model.sides.get("token:hound")).toBe("heroes");
			expect(model.groups.map(g => g.key)).toEqual(["heroesHere"]);
			expect(model.selected.sort()).toEqual(["token:bram", "token:cadi", "token:hound"]);
		});

		it("takes followers off the People list and puts them under their character, wherever the character is listed", () => {
			const model = startWindowModel({
				sceneTokens: [],
				pcsElsewhere: [{ uuid: "Actor.bram", actorId: "bram", name: "Bram" }],
				people: [{ uuid: "Actor.hound", name: "Hound", master: bram }, { uuid: "Actor.tovia", name: "Tovia", disposition: 0 }],
				format,
			});
			const elsewhere = model.groups.find(g => g.key === "pcsElsewhere").people;
			expect(elsewhere.map(r => [r.id, r.parent ?? null, r.hint])).toEqual([
				["actor:Actor.bram", null, ""],
				["actor:Actor.hound", "actor:Actor.bram", "Bram's follower · Not on this map"],
			]);
			expect(model.groups.find(g => g.key === "people").people.map(r => r.id)).toEqual(["actor:Actor.tovia"]);
			expect(model.sides.get("actor:Actor.hound")).toBe("heroes");
		});

		it("heads followers with their character, untickable, when the character is already in the fight", () => {
			const model = startWindowModel({
				sceneTokens: [token("bram", "character", { actorId: "bram", inFight: true })],
				people: [{ uuid: "Actor.hound", name: "Hound", master: bram }],
				mode: "add",
				format,
			});
			expect(model.groups.find(g => g.key === "heroesHere").people).toEqual([
				{ id: "master:bram", name: "Bram", img: "", hint: "Already in the fight", header: true },
				{ id: "actor:Actor.hound", name: "Hound", img: "", hint: "Bram's follower · Not on this map", parent: "master:bram" },
			]);
			expect(model.selected).toEqual([]);
		});

		it("leaves a follower handed in as a foe with the foes", () => {
			const model = startWindowModel({
				sceneTokens: [token("bram", "character", { actorId: "bram" }), followerToken("hound")],
				forceFoes: ["hound"],
				format,
			});
			expect(model.groups.find(g => g.key === "foesHere").people.map(r => r.id)).toEqual(["token:hound"]);
			expect(model.sides.get("token:hound")).toBe("foes");
		});
	});

	it("offers who is not on the map yet, on their own lists and sides", () => {
		const model = startWindowModel({
			sceneTokens: [],
			pcsElsewhere: [{ uuid: "Actor.pim", name: "Pim" }],
			people: [{ uuid: "Actor.maeve", name: "Maeve", disposition: 1 }, { uuid: "Actor.tovia", name: "Tovia", disposition: 0 }],
			monsters: [{ uuid: "Compendium.stonetop-pwd.stonetop-bestiary.Actor.x", name: "Rime Lord", fromPack: true }],
			format,
		});
		expect(model.groups.map(g => g.key)).toEqual(["pcsElsewhere", "people", "monsters"]);
		expect(model.sides.get("actor:Actor.pim")).toBe("heroes");
		expect(model.sides.get("actor:Actor.maeve")).toBe("heroes");
		expect(model.sides.get("actor:Actor.tovia")).toBe("foes");
		expect(model.sides.get("actor:Compendium.stonetop-pwd.stonetop-bestiary.Actor.x")).toBe("foes");
		expect(model.groups[2].people[0].hint).toBe("From the bestiary");
		expect(model.selected).toEqual([]);
	});

	it("says who each person is under their name, ahead of anything else it says", () => {
		const model = startWindowModel({
			sceneTokens: [token("gwilm", "npc", { note: "Miller", hidden: true })],
			pcsElsewhere: [{ uuid: "Actor.pim", name: "Pim", note: "The Fox" }],
			people: [
				{ uuid: "Actor.brogan", name: "Brogan", note: "Smith, Marshedge", disposition: 1 },
				{ uuid: "Actor.ennis", name: "Ennis", disposition: 1 },
			],
			format,
		});
		const hints = Object.fromEntries(model.groups.flatMap(g => g.people).map(p => [p.id, p.hint]));
		expect(hints).toEqual({
			"token:gwilm": "Miller · Hidden from players",
			"actor:Actor.pim": "The Fox",
			"actor:Actor.brogan": "Smith, Marshedge",
			"actor:Actor.ennis": "",
		});
	});

	it("says what a monster is, ahead of where it comes from", () => {
		const note = monsterNote({ creatureType: "natural-beast", organization: "horde", attributes: { hp: { max: 3 } } });
		expect(note).toBe("Natural / Beast · Horde · 3 HP");
		expect(monsterNote({})).toBe("");
		const model = startWindowModel({
			monsters: [{ uuid: "Compendium.x.Actor.rat", name: "Rat", note, fromPack: true }],
			format,
		});
		expect(model.groups[0].people[0].hint).toBe("Natural / Beast · Horde · 3 HP · From the bestiary");
	});
});

// ── The flows, over a stand-in world ──────────────────────────────────────────

let saved;
beforeEach(() => {
	saved = { game: globalThis.game, canvas: globalThis.canvas, ui: globalThis.ui, getDocumentClass: globalThis.getDocumentClass, fromUuid: globalThis.fromUuid, Actor: globalThis.Actor, CONST: globalThis.CONST };
});
afterEach(() => { Object.assign(globalThis, saved); });

function world({ isGM = true } = {}) {
	const bram = fakeActor({ id: "bram", type: "character" });
	const crinwin = fakeActor({ id: "crinwin", type: "monster" });
	const tBram = fakeToken({ id: "tBram", col: 30, row: 12, actor: bram });
	const tCrin = fakeToken({ id: "tCrin", col: 2, row: 3, actor: crinwin, hidden: true });
	const scene = fakeScene({ tokens: [tBram, tCrin] });
	scene.moveTokens = vi.fn(async () => ({}));
	for (const t of [tBram, tCrin]) {
		t.getSnappedPosition = ({ x, y }) => ({ x, y });
		t.actorId = t.actor.id;
	}
	const created = [];
	const combatants = [];
	const combat = fakeCombat({ scene, combatants });
	combat.createEmbeddedDocuments = vi.fn(async (type, data) => { created.push(...data); return data; });
	combat.update = vi.fn(async () => {});
	const CombatClass = { create: vi.fn(async data => Object.assign(combat, { created: data })) };
	globalThis.getDocumentClass = name => (name === "Combat" ? CombatClass : null);
	globalThis.CONST = { GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
	globalThis.game = {
		...saved.game,
		user: { id: "gm", isGM },
		users: collection([]),
		combats: collection([]),
		actors: collection([bram, crinwin]),
		release: { generation: 14 },
	};
	globalThis.ui = { combat: { viewed: null }, sidebar: { changeTab: vi.fn() }, notifications: { info: vi.fn(), warn: vi.fn() } };
	const placed = [];
	globalThis.canvas = {
		ready: true,
		scene,
		dimensions: { size: GRID, sceneRect: { x: 0, y: 0, width: 4000, height: 3000 }, rect: { contains: () => true } },
		grid: { size: GRID },
		stage: { worldTransform: { applyInverse: ({ x, y }) => ({ x: x + 1000, y: y + 500 }) } },
		tokens: {
			_onDropActorData: vi.fn(async (event, data) => {
				const t = fakeToken({ id: `new${placed.length}`, actor: fakeActor({ id: data.uuid }) });
				t.documentName = "Token";
				t.actorId = data.uuid;
				placed.push({ data, token: t });
				return t;
			}),
		},
	};
	return { scene, combat, CombatClass, created, placed, tBram, tCrin };
}

describe("startFight", () => {
	it("starts a fight on the scene and puts the picks in it, sides and hiding kept", async () => {
		const { scene, CombatClass, created } = world();
		const result = await startFight({ scene, picks: [{ id: "token:tBram", side: "heroes" }, { id: "token:tCrin", side: "foes" }] });
		expect(CombatClass.create).toHaveBeenCalledWith({ scene: "scene1", active: true });
		expect(created).toEqual([
			{ tokenId: "tBram", sceneId: "scene1", actorId: "bram", hidden: false, flags: { [SYSTEM_ID]: { side: "heroes" } } },
			{ tokenId: "tCrin", sceneId: "scene1", actorId: "crinwin", hidden: true, flags: { [SYSTEM_ID]: { side: "foes" } } },
		]);
		expect(result.added).toBe(2);
		// The Fight window opens for a fight this GM just started, so their sidebar stays on Chat.
		expect(globalThis.ui.sidebar.changeTab).not.toHaveBeenCalled();
	});

	it("shows the fight in the sidebar's Fight tab when this GM keeps the window from opening by itself", async () => {
		const { scene } = world();
		globalThis.game.settings = { get: (scope, key) => (key === "fightWindowAuto" ? false : undefined) };
		await startFight({ scene, picks: [{ id: "token:tBram", side: "heroes" }] });
		expect(globalThis.ui.sidebar.changeTab).toHaveBeenCalledWith("combat", "primary");
	});

	it("leaves the sidebar alone when the Fight window is already showing the fight added to", async () => {
		const { scene, combat } = world();
		globalThis.game.combats = collection([combat]);
		globalThis.ui.combat.popout = { rendered: true };
		await startFight({ scene, picks: [{ id: "token:tCrin", side: "foes" }] });
		expect(globalThis.ui.sidebar.changeTab).not.toHaveBeenCalled();
	});

	it("shows a fight added to in the Fight tab when its window was closed", async () => {
		const { scene, combat } = world();
		globalThis.game.combats = collection([combat]);
		await startFight({ scene, picks: [{ id: "token:tCrin", side: "foes" }] });
		expect(globalThis.ui.sidebar.changeTab).toHaveBeenCalledWith("combat", "primary");
	});

	it("adds to the fight already on the map, skipping whoever is in it", async () => {
		const { scene, combat, CombatClass, created, tBram } = world();
		combat.combatants = collection([fakeCombatant({ id: "cBram", token: tBram, scene })]);
		globalThis.game.combats = collection([combat]);
		await startFight({ scene, picks: [{ id: "token:tBram", side: "heroes" }, { id: "token:tCrin", side: "foes" }] });
		expect(CombatClass.create).not.toHaveBeenCalled();
		expect(created.map(c => c.tokenId)).toEqual(["tCrin"]);
	});

	it("puts arrivals on the map one at a time, heroes left of the view's middle and foes right", async () => {
		const { scene, created, placed } = world();
		globalThis.fromUuid = vi.fn(async uuid => ({ documentName: "Actor", uuid, name: uuid, prototypeToken: { width: 1, height: 1 } }));
		await startFight({ scene, picks: [{ id: "actor:Actor.pim", side: "heroes", name: "Pim" }, { id: "actor:Actor.wolf", side: "foes", name: "Wolf" }] });
		expect(placed.map(p => p.data.uuid)).toEqual(["Actor.pim", "Actor.wolf"]);
		const [pim, wolf] = placed.map(p => p.data);
		expect(pim.x).toBeLessThan(wolf.x);
		expect(created.map(c => c.flags[SYSTEM_ID].side)).toEqual(["heroes", "foes"]);
	});

	it("imports a bestiary monster once, however many times it is picked", async () => {
		const { scene } = world();
		const packDoc = { documentName: "Actor", uuid: "Compendium.stonetop-pwd.stonetop-bestiary.Actor.rime", pack: "stonetop-pwd.stonetop-bestiary", name: "Rime Lord" };
		globalThis.fromUuid = vi.fn(async () => packDoc);
		let made = 0;
		globalThis.Actor = {
			canUserCreate: () => true,
			create: vi.fn(async () => ({ documentName: "Actor", uuid: `Actor.rime${++made}`, name: "Rime Lord", prototypeToken: {} })),
		};
		globalThis.game.actors.fromCompendium = doc => ({ name: doc.name });
		const result = await startFight({ scene, picks: [
			{ id: `actor:${packDoc.uuid}`, side: "foes", name: "Rime Lord" },
			{ id: `actor:${packDoc.uuid}`, side: "foes", name: "Rime Lord" },
		] });
		expect(globalThis.Actor.create).toHaveBeenCalledTimes(1);
		expect(result.imported).toBe(1);
		expect(result.placed).toBe(2);
	});

	it("puts every one of a group asked for among the arrivals, numbered, each in the fight", async () => {
		const { scene, created, placed } = world();
		scene.updateEmbeddedDocuments = vi.fn(async () => []);
		globalThis.fromUuid = vi.fn(async uuid => ({ documentName: "Actor", id: "crinwin2", uuid, name: "Crinwin", prototypeToken: { name: "Crinwin", width: 1, height: 1 } }));
		const result = await startFight({ scene, picks: [{ id: "actor:Actor.crinwin2", side: "foes", name: "Crinwin", size: 3 }] });
		expect(placed).toHaveLength(3);
		expect(result.placed).toBe(3);
		expect(created).toHaveLength(3);
		expect(new Set(placed.map(p => `${p.data.x},${p.data.y}`)).size).toBe(3);
		expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Token", [
			{ _id: "new0", name: "Crinwin (1)" }, { _id: "new1", name: "Crinwin (2)" }, { _id: "new2", name: "Crinwin (3)" },
		]);
	});

	it("makes one arrival fight as the whole group, when that is the scale asked for", async () => {
		const { scene, created, placed } = world();
		const update = vi.fn(async () => ({}));
		globalThis.canvas.tokens._onDropActorData = vi.fn(async (event, data) => {
			const t = fakeToken({ id: `new${placed.length}`, actor: { type: "monster", system: { attributes: { hp: { value: 3, max: 3 } } }, update } });
			t.documentName = "Token";
			placed.push({ data, token: t });
			return t;
		});
		globalThis.fromUuid = vi.fn(async uuid => ({ documentName: "Actor", id: "crinwin2", uuid, name: "Crinwin", prototypeToken: { name: "Crinwin" } }));
		const result = await startFight({ scene, picks: [{ id: "actor:Actor.crinwin2", side: "foes", name: "Crinwin", size: 6, asGroup: true }] });
		expect(placed).toHaveLength(1);
		expect(result.placed).toBe(1);
		expect(created).toHaveLength(1);
		expect(update).toHaveBeenCalledWith({ "system.fightAsGroup": true, "system.count": 6, "system.attributes.hp.value": 3, [`flags.${SYSTEM_ID}.groupWound`]: 0, [`flags.${SYSTEM_ID}.groupSize`]: 0 });
	});

	it("brings a linked monster asked for as a group in as that many tokens, and says so", async () => {
		const { scene, placed } = world();
		scene.updateEmbeddedDocuments = vi.fn(async () => []);
		const update = vi.fn(async () => ({}));
		globalThis.fromUuid = vi.fn(async uuid => ({ documentName: "Actor", id: "crinwin2", uuid, name: "Crinwin", update, prototypeToken: { name: "Crinwin", width: 1, height: 1, actorLink: true } }));
		const result = await startFight({ scene, picks: [{ id: "actor:Actor.crinwin2", side: "foes", name: "Crinwin", size: 3, asGroup: true }] });
		expect(placed).toHaveLength(3);
		expect(result.placed).toBe(3);
		expect(update).not.toHaveBeenCalled();
		expect(globalThis.ui.notifications.warn).toHaveBeenCalledWith(expect.stringContaining("Crinwin"));
	});

	it("gathers the rest of a group around a token already on the map, hidden when it is", async () => {
		const { scene, created, placed, tCrin } = world();
		scene.updateEmbeddedDocuments = vi.fn(async () => []);
		const crinwin = globalThis.game.actors.get("crinwin");
		crinwin.uuid = "Actor.crinwin";
		crinwin.prototypeToken = { name: "Crinwin" };
		tCrin.name = "Crinwin";
		const result = await startFight({ scene, picks: [{ id: "token:tCrin", side: "foes", name: "Crinwin", size: 4 }] });
		expect(result.placed).toBe(3);
		expect(placed.map(p => p.data.uuid)).toEqual(["Actor.crinwin", "Actor.crinwin", "Actor.crinwin"]);
		// Centres one square from the crinwin already there (its centre is 250, 350).
		for (const { data } of placed) expect(Math.max(Math.abs(data.x - 250), Math.abs(data.y - 350))).toBe(GRID);
		expect(created.map(c => c.tokenId)).toEqual(["tCrin", "new0", "new1", "new2"]);
		expect(created.every(c => c.flags[SYSTEM_ID].side === "foes")).toBe(true);
		expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Token", [
			{ _id: "new0", name: "Crinwin (2)", hidden: true },
			{ _id: "new1", name: "Crinwin (3)", hidden: true },
			{ _id: "new2", name: "Crinwin (4)", hidden: true },
		]);
	});

	it("starts a new fight rather than add to a combat that was never one", async () => {
		const { scene, CombatClass, created } = world();
		const roster = { id: "roster", flags: {}, active: true, createEmbeddedDocuments: vi.fn() };
		const result = await startFight({ scene, combat: roster, picks: [{ id: "token:tBram", side: "heroes" }] });
		expect(CombatClass.create).toHaveBeenCalledWith({ scene: "scene1", active: true });
		expect(roster.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(result.combat).not.toBe(roster);
		expect(created).toHaveLength(1);
	});

	it("says who it could not place, and does nothing at all for a player", async () => {
		const { scene } = world();
		globalThis.fromUuid = vi.fn(async () => null);
		const result = await startFight({ scene, picks: [{ id: "actor:Actor.gone", side: "foes", name: "Gone" }] });
		expect(result.missed).toEqual(["Gone"]);
		expect(globalThis.ui.notifications.warn).toHaveBeenCalled();
		world({ isGM: false });
		expect((await startFight({ scene, picks: [{ id: "token:tBram", side: "heroes" }] })).added).toBe(0);
	});
});

describe("withGroupSizes", () => {
	const infoFor = pick => ({
		"token:tCrin": { kind: "Actor.crinwin", organization: "horde", count: 6 },
		"actor:Actor.bandit": { kind: "Actor.bandit", organization: "group", count: 3 },
		"actor:Actor.chief": { kind: "Actor.chief", organization: "group", count: 1 },
	})[pick.id] ?? null;

	it("asks about each monster that comes in numbers, one at a time, and writes the size on its pick", async () => {
		const asked = [];
		const answers = { Crinwin: { size: 8, asGroup: false }, Bandit: { size: 1, asGroup: false } };
		const picks = await withGroupSizes([
			{ id: "token:tBram", name: "Bram", side: "heroes" },
			{ id: "token:tCrin", name: "Crinwin", side: "foes" },
			{ id: "actor:Actor.bandit", name: "Bandit", side: "foes" },
			{ id: "actor:Actor.chief", name: "Bandit Chief", side: "foes" },
		], infoFor, async question => { asked.push(question.name); return answers[question.name]; });
		expect(asked).toEqual(["Crinwin", "Bandit"]);
		expect(picks.map(p => p.size ?? null)).toEqual([null, 8, null, null]);
		expect(picks[1].asGroup).toBe(false);
	});

	it("carries the choice to fight as one group token", async () => {
		const picks = await withGroupSizes([{ id: "token:tCrin", name: "Crinwin", side: "foes" }], infoFor, async () => ({ size: 6, asGroup: true }));
		expect(picks[0]).toMatchObject({ size: 6, asGroup: true });
	});

	it("leaves a pick as it was when its question is closed unanswered", async () => {
		const picks = [{ id: "token:tCrin", name: "Crinwin", side: "foes" }];
		expect(await withGroupSizes(picks, infoFor, async () => null)).toEqual(picks);
	});

	it("tells each question whether to offer the group scale", async () => {
		const seen = [];
		const ask = async question => { seen.push(question.offerGroup); return null; };
		const picks = [{ id: "token:tCrin", name: "Crinwin", side: "foes" }];
		await withGroupSizes(picks, infoFor, ask);
		await withGroupSizes(picks, infoFor, ask, { offerGroup: true });
		expect(seen).toEqual([false, true]);
	});
});

describe("heroesBringAGroup", () => {
	// Book I p.416: "If the PCs have a group of followers... If the group deals damage to another group".
	const cadi = fakeActor({ id: "cadi", type: "character", name: "Cadi", flags: { [SYSTEM_ID]: { crew: { size: 6 } } } });
	const crewOf = id => fakeActor({ id, type: "npc", name: "Crew", flags: { [SYSTEM_ID]: { followerOrigin: { characterUuid: "Actor.cadi", ftype: "crew", slug: "" } } } });
	const resolve = uuid => ({ "Actor.cadi": cadi, "Actor.crew": crewOf("crew") })[uuid] ?? null;
	const bram = fakeActor({ id: "bram", type: "character", name: "Bram" });
	const tBram = fakeToken({ id: "tBram", actor: bram });
	const tCrew = fakeToken({ id: "tCrew", actor: crewOf("crewToken") });
	const scene = fakeScene({ tokens: [tBram, tCrew] });
	const withResolve = fn => {
		const was = globalThis.fromUuidSync;
		globalThis.fromUuidSync = resolve;
		try { return fn(); } finally { globalThis.fromUuidSync = was; }
	};

	it("is false for the PCs alone: foes they engage aren't really part of a group", () => {
		expect(withResolve(() => heroesBringAGroup([{ id: "token:tBram", side: "heroes" }], null, scene, { resolve }))).toBe(false);
	});

	it("is true for a crew ticked on the heroes' side, on the map or not", () => {
		expect(withResolve(() => heroesBringAGroup([{ id: "token:tCrew", side: "heroes" }], null, scene, { resolve }))).toBe(true);
		expect(withResolve(() => heroesBringAGroup([{ id: "actor:Actor.crew", side: "heroes" }], null, scene, { resolve }))).toBe(true);
	});

	it("is false for a group on the foes' side only", () => {
		expect(withResolve(() => heroesBringAGroup([{ id: "token:tCrew", side: "foes" }], null, scene, { resolve }))).toBe(false);
	});

	it("is true for a group already fighting on the heroes' side, a GM's headcount included", () => {
		const combat = fakeCombat({ scene, combatants: [fakeCombatant({ id: "cBram", token: tBram, scene, side: "heroes", count: 4 })] });
		expect(withResolve(() => heroesBringAGroup([], combat, scene, { resolve }))).toBe(true);
		const alone = fakeCombat({ scene, combatants: [fakeCombatant({ id: "cBram", token: tBram, scene, side: "heroes" })] });
		expect(withResolve(() => heroesBringAGroup([], alone, scene, { resolve }))).toBe(false);
	});
});

describe("lining up", () => {
	function fightWith(extra = {}) {
		const w = world(extra);
		w.combat.combatants = collection([
			fakeCombatant({ id: "cBram", token: w.tBram, scene: w.scene, side: "heroes" }),
			fakeCombatant({ id: "cCrin", token: w.tCrin, scene: w.scene, side: "foes" }),
		]);
		return w;
	}

	it("moves everyone in one write, heroes left of the foes", async () => {
		const { scene, combat } = fightWith();
		expect(await lineUpFight(combat, { scene })).toBe(true);
		expect(scene.moveTokens).toHaveBeenCalledTimes(1);
		const instructions = scene.moveTokens.mock.calls[0][0];
		expect(instructions.tBram.waypoints[0].x).toBeLessThan(instructions.tCrin.waypoints[0].x);
		expect(instructions.tBram.waypoints[0].action).toBe("displace");
	});

	it("leaves the map alone for a player, or for a fight on a scene nobody is looking at", async () => {
		const player = fightWith({ isGM: false });
		expect(await lineUpFight(player.combat, { scene: player.scene })).toBe(false);
		const elsewhere = fightWith();
		globalThis.canvas.scene = { id: "other" };
		expect(await lineUpFight(elsewhere.combat, { scene: elsewhere.scene })).toBe(false);
		expect(elsewhere.scene.moveTokens).not.toHaveBeenCalled();
	});

	it("keeps a fight already going on: the two in it stay up against each other, right where they are", async () => {
		const { scene, combat, tBram, tCrin } = fightWith();
		// Crinwin steps up against Bram, so the two of them are fighting.
		tCrin._source.x = tBram._source.x + GRID;
		tCrin._source.y = tBram._source.y;
		// Nobody else is in the fight, so it is already lined up around itself.
		expect(await lineUpFight(combat, { scene })).toBe(false);
		const moved = scene.moveTokens.mock.calls[0]?.[0] ?? {};
		const at = (id, token) => moved[id]?.waypoints[0] ?? { x: token._source.x, y: token._source.y };
		const bram = at("tBram", tBram);
		const crin = at("tCrin", tCrin);
		expect({ x: crin.x - bram.x, y: crin.y - bram.y }).toEqual({ x: GRID, y: 0 });
	});

	it("snaps a fight already going on once, so the grid cannot pull it apart", async () => {
		const { scene, combat, tBram, tCrin } = fightWith();
		for (const t of [tBram, tCrin]) {
			t.getSnappedPosition = ({ x, y }) => ({ x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID });
		}
		// Standing against each other, but not squarely: snapping each on its own would open a gap.
		tBram._source.x = 1250;
		tBram._source.y = 1250;
		tCrin._source.x = 1330;
		tCrin._source.y = 1250;
		expect(await lineUpFight(combat, { scene })).toBe(true);
		const moved = scene.moveTokens.mock.calls[0][0];
		expect(moved.tCrin.waypoints[0].x - moved.tBram.waypoints[0].x).toBe(80);
		expect(moved.tCrin.waypoints[0].y - moved.tBram.waypoints[0].y).toBe(0);
	});
});

describe("viewRectWorld", () => {
	it("is the window between the scene controls and the sidebar, in scene pixels", () => {
		const savedDoc = globalThis.document;
		const savedW = globalThis.innerWidth;
		const savedH = globalThis.innerHeight;
		globalThis.document = {
			getElementById: id => ({
				"ui-left": { getBoundingClientRect: () => ({ width: 60, right: 60 }) },
				sidebar: { getBoundingClientRect: () => ({ width: 300, left: 1620 }) },
			})[id] ?? null,
		};
		globalThis.innerWidth = 1920;
		globalThis.innerHeight = 1080;
		try {
			const canvas = { stage: { worldTransform: { applyInverse: ({ x, y }) => ({ x: x * 2, y: y * 2 }) } } };
			expect(viewRectWorld(canvas)).toEqual({ x: 120, y: 0, w: 3120, h: 2160 });
		} finally {
			globalThis.document = savedDoc;
			globalThis.innerWidth = savedW;
			globalThis.innerHeight = savedH;
		}
	});

	describe("with the Fight window open", () => {
		let savedGlobals;
		const canvas = { stage: { worldTransform: { applyInverse: ({ x, y }) => ({ x, y }) } } };
		beforeEach(() => {
			savedGlobals = { document: globalThis.document, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight, ui: globalThis.ui };
			globalThis.document = {
				getElementById: id => ({
					"ui-left": { getBoundingClientRect: () => ({ width: 60, right: 60 }) },
					sidebar: { getBoundingClientRect: () => ({ width: 300, left: 1620 }) },
				})[id] ?? null,
			};
			globalThis.innerWidth = 1920;
			globalThis.innerHeight = 1080;
		});
		afterEach(() => { Object.assign(globalThis, savedGlobals); });
		const withWindow = (box, extra = {}) => {
			globalThis.ui = { combat: { popout: { rendered: true, minimized: false, element: { getBoundingClientRect: () => box }, ...extra } } };
		};

		it("keeps the view left of a window standing on the right", () => {
			withWindow({ left: 1224, right: 1604, width: 380 });
			expect(viewRectWorld(canvas)).toEqual({ x: 60, y: 0, w: 1164, h: 1080 });
		});

		it("keeps the view right of a window moved to the left", () => {
			withWindow({ left: 80, right: 460, width: 380 });
			expect(viewRectWorld(canvas)).toEqual({ x: 460, y: 0, w: 1160, h: 1080 });
		});

		it("ignores a window dragged so wide that leaving it out would leave less than half the view", () => {
			withWindow({ left: 500, right: 1500, width: 1000 });
			expect(viewRectWorld(canvas)).toEqual({ x: 60, y: 0, w: 1560, h: 1080 });
		});

		it("ignores a minimized window, and one that has closed", () => {
			withWindow({ left: 1224, right: 1604, width: 380 }, { minimized: true });
			expect(viewRectWorld(canvas).w).toBe(1560);
			withWindow({ left: 1224, right: 1604, width: 380 }, { rendered: false });
			expect(viewRectWorld(canvas).w).toBe(1560);
		});

		it("keeps clear of where a window about to open for a new fight will stand", () => {
			globalThis.ui = { combat: { popout: null } };
			const coming = { left: 1224, right: 1604, width: 380 };
			expect(viewRectWorld(canvas, { coming })).toEqual({ x: 60, y: 0, w: 1164, h: 1080 });
		});

		it("measures the open window rather than where one was about to open", () => {
			withWindow({ left: 80, right: 460, width: 380 });
			expect(viewRectWorld(canvas, { coming: { left: 1224, right: 1604, width: 380 } })).toEqual({ x: 460, y: 0, w: 1160, h: 1080 });
			withWindow({ left: 80, right: 460, width: 380 }, { minimized: true });
			expect(viewRectWorld(canvas, { coming: { left: 1224, right: 1604, width: 380 } }).w).toBe(1560);
		});
	});
});

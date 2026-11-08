import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spotBeside, sendAgainst, handleSendQuery, sendAtChoices, SEND_QUERY } from "../../module/fight/send-against.js";
import { SYSTEM_ID } from "../../module/system-id.js";
import { touching } from "../../module/fight/engagements.js";
import { fakeActor, fakeToken, fakeScene, fakeCombatant, fakeCombat, GRID } from "../fakes/fight.js";

// Dragging a foe onto a hero in the Fight tab: where the foe's token goes, and the move itself.

const sq = (col, row, w = 1, h = 1) => ({ x: col * GRID, y: row * GRID, w: w * GRID, h: h * GRID });
const grid = { size: GRID, kind: "square" };

describe("spotBeside", () => {
	it("puts the foe on the side of the hero it is coming from", () => {
		expect(spotBeside({ mover: sq(10, 5), target: sq(5, 5), grid })).toEqual({ x: 600, y: 500 });
		expect(spotBeside({ mover: sq(0, 5), target: sq(5, 5), grid })).toEqual({ x: 400, y: 500 });
		expect(spotBeside({ mover: sq(5, 0), target: sq(5, 5), grid })).toEqual({ x: 500, y: 400 });
	});

	it("never stands on another token, taking the next nearest spot", () => {
		const spot = spotBeside({ mover: sq(10, 5), target: sq(5, 5), others: [sq(6, 5)], grid });
		expect([{ x: 600, y: 400 }, { x: 600, y: 600 }]).toContainEqual(spot);
	});

	it("keeps inside the scene", () => {
		const spot = spotBeside({ mover: sq(3, -4), target: sq(0, 0), grid, sceneRect: { x: 0, y: 0, w: 2000, h: 2000 } });
		expect(spot.x).toBeGreaterThanOrEqual(0);
		expect(spot.y).toBeGreaterThanOrEqual(0);
	});

	it("gives up when the hero is surrounded", () => {
		const ring = [];
		for (let dc = -1; dc <= 1; dc += 1) for (let dr = -1; dr <= 1; dr += 1) if (dc || dr) ring.push(sq(5 + dc, 5 + dr));
		expect(spotBeside({ mover: sq(10, 5), target: sq(5, 5), others: ring, grid })).toBeNull();
	});

	it("takes a spot touching only the one dropped on over a nearer one beside their allies", () => {
		// The hero comes from the west at a wolf with two packmates at its west corners.
		const rivals = [sq(4, 4), sq(4, 6)];
		const spot = spotBeside({ mover: sq(0, 5), target: sq(5, 5), others: rivals, rivals, grid });
		expect(spot).toEqual({ x: 600, y: 500 });
	});

	it("falls back to the spot touching the fewest allies", () => {
		const rivals = [sq(4, 4), sq(4, 6), sq(6, 5)];
		const spot = spotBeside({ mover: sq(0, 5), target: sq(5, 5), others: rivals, rivals, grid });
		expect([{ x: 600, y: 400 }, { x: 600, y: 600 }]).toContainEqual(spot);
	});

	it("fits a large foe against the hero without covering them", () => {
		const spot = spotBeside({ mover: sq(12, 5, 2, 2), target: sq(5, 5), grid });
		expect(spot).toEqual({ x: 600, y: 500 });
	});
});

describe("sendAgainst", () => {
	let saved;
	beforeEach(() => { saved = { game: globalThis.game, canvas: globalThis.canvas }; });
	afterEach(() => { globalThis.game = saved.game; globalThis.canvas = saved.canvas; });

	function setup({ isGM = true } = {}) {
		const tBram = fakeToken({ id: "tBram", col: 5, row: 5, actor: fakeActor({ id: "bram", type: "character", hasPlayerOwner: true }) });
		const tWolf = fakeToken({ id: "tWolf", col: 12, row: 5, actor: fakeActor({ id: "wolf", type: "monster" }) });
		const tRock = fakeToken({ id: "tRock", col: 6, row: 5, actor: fakeActor({ id: "rock", type: "npc" }) });
		const scene = fakeScene({ tokens: [tBram, tWolf, tRock] });
		scene.moveTokens = vi.fn(async () => ({}));
		// The player plays Bram and owns nothing else; the GM owns everyone.
		const combat = fakeCombat({
			scene,
			combatants: [
				fakeCombatant({ id: "cBram", token: tBram, scene, side: "heroes", isOwner: true }),
				fakeCombatant({ id: "cWolf", token: tWolf, scene, side: "foes", isOwner: isGM }),
			],
		});
		globalThis.game = { ...saved.game, user: { id: "gm", isGM } };
		globalThis.canvas = { scene, dimensions: { sceneRect: { x: 0, y: 0, width: 4000, height: 4000 } } };
		return { scene, combat, tWolf };
	}

	it("moves the foe's token into a free square touching the hero, in one displace", async () => {
		const { scene, combat } = setup();
		expect(await sendAgainst(combat, "cWolf", "cBram", { scene })).toBe("moved");
		const move = scene.moveTokens.mock.calls[0][0].tWolf.waypoints[0];
		expect(move.action).toBe("displace");
		// East of Bram is taken by the rock, so the wolf takes a corner on that side.
		expect([{ x: 600, y: 400 }, { x: 600, y: 600 }]).toContainEqual({ x: move.x, y: move.y });
	});

	it("moves the hero instead when it is the hero who was sent", async () => {
		const { scene, combat } = setup();
		expect(await sendAgainst(combat, "cBram", "cWolf", { scene })).toBe("moved");
		const moved = scene.moveTokens.mock.calls[0][0];
		expect(Object.keys(moved)).toEqual(["tBram"]);
		// Bram comes from the west, so he arrives on the wolf's west side.
		expect(moved.tBram.waypoints[0]).toMatchObject({ action: "displace", x: 1100, y: 500 });
	});

	it("leaves a foe already in contact where it is", async () => {
		const { scene, combat, tWolf } = setup();
		tWolf._source.x = 400;
		expect(await sendAgainst(combat, "cWolf", "cBram", { scene })).toBe("already");
		expect(scene.moveTokens).not.toHaveBeenCalled();
	});

	it("lets a player throw their own character at a foe", async () => {
		const { scene, combat } = setup({ isGM: false });
		expect(await sendAgainst(combat, "cBram", "cWolf", { scene })).toBe("moved");
		expect(Object.keys(scene.moveTokens.mock.calls[0][0])).toEqual(["tBram"]);
	});

	it("lets a player send a monster, through the GM's client", async () => {
		const { scene, combat } = setup({ isGM: false });
		const query = vi.fn(async () => 1);
		expect(await sendAgainst(combat, "cWolf", "cBram", { scene, users: { activeGM: { query } } })).toBe("moved");
		expect(scene.moveTokens).not.toHaveBeenCalled();
		expect(query).toHaveBeenCalledTimes(1);
		const [name, data] = query.mock.calls[0];
		expect(name).toBe(SEND_QUERY);
		expect(data.sceneId).toBe(scene.id);
		expect(data.moves.map(m => m.id)).toEqual(["tWolf"]);
	});

	it("says so when a player sends a monster and no GM is connected", async () => {
		const { scene, combat } = setup({ isGM: false });
		const warn = vi.fn();
		expect(await sendAgainst(combat, "cWolf", "cBram", { scene, users: { activeGM: null }, notify: { warn } })).toBe(false);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(scene.moveTokens).not.toHaveBeenCalled();
	});

	it("moves no other player's character, and nobody at their own side", async () => {
		const player = setup({ isGM: false });
		player.combat.combatants.get("cBram").isOwner = false;
		expect(await sendAgainst(player.combat, "cBram", "cWolf", { scene: player.scene })).toBe(false);
		expect(player.scene.moveTokens).not.toHaveBeenCalled();
		const gm = setup();
		gm.combat.combatants.get("cWolf").flags[SYSTEM_ID].side = "heroes";
		expect(await sendAgainst(gm.combat, "cWolf", "cBram", { scene: gm.scene })).toBe(false);
		expect(gm.scene.moveTokens).not.toHaveBeenCalled();
	});

	function pack({ isGM = true } = {}) {
		// A wolf with a pup north and south of it: every square beside the wolf touches a pup.
		const tBram = fakeToken({ id: "tBram", col: 0, row: 5, actor: fakeActor({ id: "bram", type: "character", hasPlayerOwner: true }) });
		const tWolf = fakeToken({ id: "tWolf", col: 5, row: 5, actor: fakeActor({ id: "wolf", type: "monster" }) });
		const tPupN = fakeToken({ id: "tPupN", col: 5, row: 4, actor: fakeActor({ id: "pupN", type: "monster" }) });
		const tPupS = fakeToken({ id: "tPupS", col: 5, row: 6, actor: fakeActor({ id: "pupS", type: "monster" }) });
		const scene = fakeScene({ tokens: [tBram, tWolf, tPupN, tPupS] });
		scene.moveTokens = vi.fn(async () => ({}));
		const combat = fakeCombat({
			scene,
			combatants: [
				fakeCombatant({ id: "cBram", token: tBram, scene, side: "heroes", isOwner: true }),
				fakeCombatant({ id: "cWolf", token: tWolf, scene, side: "foes", isOwner: isGM }),
				fakeCombatant({ id: "cPupN", token: tPupN, scene, side: "foes", isOwner: isGM }),
				fakeCombatant({ id: "cPupS", token: tPupS, scene, side: "foes", isOwner: isGM }),
			],
		});
		globalThis.game = { ...saved.game, user: { id: "gm", isGM } };
		globalThis.canvas = { scene, dimensions: { sceneRect: { x: 0, y: 0, width: 4000, height: 4000 } } };
		return { scene, combat };
	}

	it("closes with the one dropped on and steps its packmates out of reach, all in one displace", async () => {
		const { scene, combat } = pack();
		expect(await sendAgainst(combat, "cBram", "cWolf", { scene })).toBe("moved");
		const moved = scene.moveTokens.mock.calls[0][0];
		expect(scene.moveTokens).toHaveBeenCalledTimes(1);
		const at = id => {
			const w = moved[id]?.waypoints[0];
			const src = scene.tokens.find(t => t.id === id)._source;
			return { rect: w ? sq(w.x / GRID, w.y / GRID) : sq(src.x / GRID, src.y / GRID) };
		};
		expect(touching(at("tBram"), at("tWolf"), grid)).toBe(true);
		expect(touching(at("tBram"), at("tPupN"), grid)).toBe(false);
		expect(touching(at("tBram"), at("tPupS"), grid)).toBe(false);
		expect(Object.keys(moved)).toHaveLength(2);
	});

	it("has the GM's client step a player's foes aside, in the same request as the player's hero", async () => {
		const { scene, combat } = pack({ isGM: false });
		const query = vi.fn(async () => 2);
		expect(await sendAgainst(combat, "cBram", "cWolf", { scene, users: { activeGM: { query } } })).toBe("moved");
		expect(scene.moveTokens).not.toHaveBeenCalled();
		const ids = query.mock.calls[0][1].moves.map(m => m.id);
		expect(ids[0]).toBe("tBram");
		expect(ids).toHaveLength(2);
	});

	it("names the asker in the query, and warns when the GM's client moved nothing", async () => {
		const { scene, combat } = pack({ isGM: false });
		const warn = vi.fn();
		const query = vi.fn(async () => 0);
		expect(await sendAgainst(combat, "cBram", "cWolf", { scene, notify: { warn }, users: { activeGM: { query } } })).toBe(false);
		expect(query.mock.calls[0][1].userId).toBe("gm");
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("never has a player's send move a hidden packmate, which would show them where it lies", async () => {
		const { scene, combat } = pack({ isGM: false });
		scene.tokens.find(t => t.id === "tPupN").hidden = true;
		const query = vi.fn(async () => 2);
		expect(await sendAgainst(combat, "cBram", "cWolf", { scene, users: { activeGM: { query } } })).toBe("moved");
		// Whichever client moves them: the player's own, or the GM's through the query.
		const moved = [...Object.keys(scene.moveTokens.mock.calls[0]?.[0] ?? {}), ...(query.mock.calls[0]?.[1].moves ?? []).map(m => m.id)];
		expect(moved).toContain("tBram");
		expect(moved).not.toContain("tPupN");
	});

	it("leaves another player's character where it stands when a hero would touch it", async () => {
		const { scene, combat } = pack();
		// The GM sends the wolf at Bram; the pups are heroes some player owns and the GM does not move.
		for (const id of ["cPupN", "cPupS"]) {
			const c = combat.combatants.get(id);
			c.flags[SYSTEM_ID].side = "heroes";
			c.actor.hasPlayerOwner = true;
			c.isOwner = false;
		}
		expect(await sendAgainst(combat, "cBram", "cWolf", { scene })).toBe("moved");
		expect(Object.keys(scene.moveTokens.mock.calls[0][0])).toEqual(["tBram"]);
	});

	it("tells the GM when there is no room", async () => {
		const { scene, combat } = setup();
		const warn = vi.fn();
		const tokens = [...scene.tokens];
		for (let dc = -1; dc <= 1; dc += 1) for (let dr = -1; dr <= 1; dr += 1) {
			if (dc || dr) tokens.push(fakeToken({ id: `t${dc}${dr}`, col: 5 + dc, row: 5 + dr }));
		}
		const crowded = fakeScene({ tokens });
		crowded.moveTokens = vi.fn();
		globalThis.canvas.scene = crowded;
		for (const c of combat.combatants) c.sceneId = crowded.id;
		expect(await sendAgainst(combat, "cWolf", "cBram", { scene: crowded, notify: { warn } })).toBe("noRoom");
		expect(warn).toHaveBeenCalledWith("There is no free space next to bram.");
		expect(crowded.moveTokens).not.toHaveBeenCalled();
	});
});

describe("handleSendQuery", () => {
	// The fight on the scene, as core would hand it: one combatant per token id given, hidden ones marked.
	const fightOf = (scene, ids, hidden = []) => () => ({ combatants: ids.map(id => ({ id: `c${id}`, tokenId: id, sceneId: scene.id, hidden: hidden.includes(id) })) });

	it("moves anyone in the fight for a player, another player's character too, and nothing outside it", async () => {
		const mine = fakeActor({ id: "bram", type: "character", hasPlayerOwner: true, ownership: { alice: 3 } });
		const theirs = fakeActor({ id: "vess", type: "character", hasPlayerOwner: true, ownership: { bob: 3 } });
		const tBram = fakeToken({ id: "tBram", col: 0, row: 0, actor: mine });
		const tVess = fakeToken({ id: "tVess", col: 1, row: 0, actor: theirs });
		const tWolf = fakeToken({ id: "tWolf", col: 2, row: 0, actor: fakeActor({ id: "wolf", type: "monster" }) });
		const tCart = fakeToken({ id: "tCart", col: 3, row: 0, actor: fakeActor({ id: "cart", type: "npc" }) });
		const scene = fakeScene({ tokens: [tBram, tVess, tWolf, tCart] });
		scene.moveTokens = vi.fn(async () => ({}));
		const moves = [{ id: "tBram", x: 500, y: 500 }, { id: "tVess", x: 600, y: 500 }, { id: "tWolf", x: 700, y: 500 }, { id: "tCart", x: 800, y: 500 }, { id: "tGone", x: 0, y: 0 }];
		const deps = { scenes: { get: () => scene }, fightOn: fightOf(scene, ["tBram", "tVess", "tWolf"]) };
		const count = await handleSendQuery({ sceneId: scene.id, moves }, { user: { id: "alice", isGM: false } }, deps);
		expect(count).toBe(3);
		expect(Object.keys(scene.moveTokens.mock.calls[0][0])).toEqual(["tBram", "tVess", "tWolf"]);
	});

	it("moves nothing when the scene has no fight", async () => {
		const tWolf = fakeToken({ id: "tWolf", col: 2, row: 0, actor: fakeActor({ id: "wolf", type: "monster" }) });
		const scene = fakeScene({ tokens: [tWolf] });
		scene.moveTokens = vi.fn(async () => ({}));
		const moves = [{ id: "tWolf", x: 700, y: 500 }];
		expect(await handleSendQuery({ sceneId: scene.id, moves }, { user: { id: "alice", isGM: false } }, { scenes: { get: () => scene }, fightOn: () => null })).toBe(0);
		expect(scene.moveTokens).not.toHaveBeenCalled();
	});

	it("moves no hidden token for a player, whether the token or its row is hidden", async () => {
		const tWolf = fakeToken({ id: "tWolf", col: 2, row: 0, actor: fakeActor({ id: "wolf", type: "monster" }) });
		tWolf.hidden = true;
		const tPup = fakeToken({ id: "tPup", col: 3, row: 0, actor: fakeActor({ id: "pup", type: "monster" }) });
		const scene = fakeScene({ tokens: [tWolf, tPup] });
		scene.moveTokens = vi.fn(async () => ({}));
		const moves = [{ id: "tWolf", x: 700, y: 500 }, { id: "tPup", x: 800, y: 500 }];
		const deps = { scenes: { get: () => scene }, fightOn: fightOf(scene, ["tWolf", "tPup"], ["tPup"]) };
		expect(await handleSendQuery({ sceneId: scene.id, moves }, { user: { id: "alice", isGM: false } }, deps)).toBe(0);
	});

	it("reads the asker from the data on v13, whose query context names nobody, but never takes it for a GM", async () => {
		const tWolf = fakeToken({ id: "tWolf", col: 2, row: 0, actor: fakeActor({ id: "wolf", type: "monster" }) });
		const tLurker = fakeToken({ id: "tLurker", col: 3, row: 0, actor: fakeActor({ id: "lurker", type: "monster" }) });
		tLurker.hidden = true;
		const scene = fakeScene({ tokens: [tWolf, tLurker] });
		scene.moveTokens = vi.fn(async () => ({}));
		const alice = { id: "alice", isGM: false };
		const gm = { id: "gm", isGM: true };
		const users = { get: id => ({ alice, gm })[id] ?? null };
		const moves = [{ id: "tWolf", x: 500, y: 500 }, { id: "tLurker", x: 600, y: 500 }];
		const deps = { scenes: { get: () => scene }, users, fightOn: fightOf(scene, ["tWolf", "tLurker"]) };
		expect(await handleSendQuery({ sceneId: scene.id, moves, userId: "alice" }, { timeout: 10000 }, deps)).toBe(1);
		expect(Object.keys(scene.moveTokens.mock.calls[0][0])).toEqual(["tWolf"]);
		// Claiming to be the GM would move the hidden one: the claim is refused outright.
		expect(await handleSendQuery({ sceneId: scene.id, moves, userId: "gm" }, { timeout: 10000 }, deps)).toBe(0);
		expect(await handleSendQuery({ sceneId: scene.id, moves }, { timeout: 10000 }, deps)).toBe(0);
	});
});

// FGT-8: the drag's send, for a reader who cannot drag (a magnifier user, a keyboard): who could be picked.
describe("sendAtChoices", () => {
	function fight() {
		const tBram = fakeToken({ id: "tBram", col: 0, row: 0, actor: fakeActor({ id: "bram", type: "character", hasPlayerOwner: true }) });
		const tWolf = fakeToken({ id: "tWolf", col: 5, row: 0, actor: fakeActor({ id: "wolf", type: "monster" }) });
		const tHidden = fakeToken({ id: "tHid", col: 8, row: 0, hidden: true, actor: fakeActor({ id: "lurker", type: "monster" }) });
		const tDead = fakeToken({ id: "tDead", col: 9, row: 0, actor: fakeActor({ id: "dead", type: "monster" }) });
		const scene = fakeScene({ tokens: [tBram, tWolf, tHidden, tDead] });
		const cBram = fakeCombatant({ id: "cBram", token: tBram, scene, side: "heroes", isOwner: true });
		const cWolf = fakeCombatant({ id: "cWolf", token: tWolf, scene, side: "foes" });
		const cHid = fakeCombatant({ id: "cHid", token: tHidden, scene, side: "foes" });
		const cDead = fakeCombatant({ id: "cDead", token: tDead, scene, side: "foes", defeated: true });
		return { scene, combat: fakeCombat({ scene, combatants: [cBram, cWolf, cHid, cDead] }), cBram, cWolf, cHid };
	}

	it("lists the other side still in the fight that this reader may see, and nobody for one they may not move", () => {
		const { scene, combat, cBram, cWolf, cHid } = fight();
		const player = { id: "player", isGM: false };
		expect(sendAtChoices(combat, cBram, { scene, viewer: player })).toEqual([{ id: "cWolf", name: "wolf" }]);
		expect(sendAtChoices(combat, cBram, { scene, viewer: { id: "gm", isGM: true } }).map(c => c.id)).toEqual(["cWolf", "cHid"]);
		expect(sendAtChoices(combat, cWolf, { scene, viewer: player })).toEqual([{ id: "cBram", name: "bram" }]);
		// A hidden fighter stays put for a player (mayMove), and a fight on another map sends nobody.
		expect(sendAtChoices(combat, cHid, { scene, viewer: player })).toEqual([]);
		expect(sendAtChoices(combat, cBram, { scene: fakeScene({ id: "elsewhere" }), viewer: player })).toEqual([]);
	});
});

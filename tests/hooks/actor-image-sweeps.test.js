import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	_migrateTokenNameplates, _migrateNpcPlaceholderPortraits, _migrateTokenImagesToPortraits, _migrateShootMarker,
} from "../../module/hooks/Ready.js";
import { PERSON_DEFAULT_IMG } from "../../module/utils/person-portrait.js";
import { NEW_SHOOT_MARKER, LEGACY_SHOOT_MARKERS } from "../../module/data/follower-actor.js";

// The four actor-image sweeps of onReady write in one batch, through _updateActorsBatched. A batch
// is all-or-nothing, so one actor it cannot write (locked, or refused by a module) used to reject
// the whole request and leave every clean actor behind it stale. Now the batch falls back to one
// write per actor, and only the actor that cannot be written is left for the next load.

const MYSTERY = "icons/svg/mystery-man.svg";

/** A world actor whose `update` writes its dotted keys in place, or refuses when `locked`. */
function actor(id, data, { locked = false } = {}) {
	const doc = { id, name: id, ...data };
	doc.update = vi.fn(async patch => {
		if (locked) throw new Error("locked");
		for (const [path, value] of Object.entries(patch)) foundry.utils.setProperty(doc, path, value);
	});
	return doc;
}

let priorGame, priorActor, priorConst, warn;
beforeEach(() => {
	priorGame = global.game;
	priorActor = global.Actor;
	priorConst = global.CONST;
	global.CONST = { ...priorConst, TOKEN_DISPLAY_MODES: { NONE: 0, HOVER: 30 } };
	warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	global.game = priorGame;
	global.Actor = priorActor;
	global.CONST = priorConst;
	warn.mockRestore();
});

/** Install a world whose batched write always refuses, as it does with one unwritable actor in it. */
function world(actors) {
	global.game = { ...priorGame, actors, scenes: [] };
	global.Actor = { updateDocuments: vi.fn(async () => { throw new Error("batch refused"); }) };
}

describe("the actor-image sweeps, with one actor that cannot be written", () => {
	it("still give the rest their nameplate", async () => {
		const locked = actor("locked", { prototypeToken: { displayName: 0 } }, { locked: true });
		const clean = actor("clean", { prototypeToken: { displayName: 0 } });
		world([locked, clean]);
		await _migrateTokenNameplates();
		expect(global.Actor.updateDocuments).toHaveBeenCalledTimes(1);
		expect(clean.prototypeToken.displayName).toBe(30);
		expect(locked.prototypeToken.displayName).toBe(0);
	});

	it("still give the rest of the NPCs the people placeholder", async () => {
		const locked = actor("locked", { type: "npc", img: MYSTERY }, { locked: true });
		const clean = actor("clean", { type: "npc", img: MYSTERY });
		world([locked, clean]);
		await _migrateNpcPlaceholderPortraits();
		expect(clean.img).toBe(PERSON_DEFAULT_IMG);
		expect(locked.img).toBe(MYSTERY);
	});

	it("still point the rest of the stock tokens at their portraits", async () => {
		const locked = actor("locked", { type: "npc", img: "a.webp", prototypeToken: { texture: { src: MYSTERY } } }, { locked: true });
		const clean = actor("clean", { type: "npc", img: "b.webp", prototypeToken: { texture: { src: MYSTERY } } });
		world([locked, clean]);
		await _migrateTokenImagesToPortraits();
		expect(clean.prototypeToken.texture.src).toBe("b.webp");
		expect(locked.prototypeToken.texture.src).toBe(MYSTERY);
	});

	it("still lift the rest of the initiates off the old shoot marker, portrait and token each as needed", async () => {
		const old = LEGACY_SHOOT_MARKERS[0];
		const locked = actor("locked", { img: old, prototypeToken: { texture: { src: old } } }, { locked: true });
		const both = actor("both", { img: old, prototypeToken: { texture: { src: old } } });
		const tokenOnly = actor("tokenOnly", { img: "mine.webp", prototypeToken: { texture: { src: old } } });
		const untouched = actor("untouched", { img: "mine.webp", prototypeToken: { texture: { src: "mine.webp" } } });
		world([locked, both, tokenOnly, untouched]);
		await _migrateShootMarker();
		expect(both.img).toBe(NEW_SHOOT_MARKER);
		expect(both.prototypeToken.texture.src).toBe(NEW_SHOOT_MARKER);
		expect(tokenOnly.img).toBe("mine.webp");
		expect(tokenOnly.update).toHaveBeenCalledWith({ "prototypeToken.texture.src": NEW_SHOOT_MARKER });
		expect(untouched.update).not.toHaveBeenCalled();
		expect(locked.img).toBe(old);
	});
});

describe("the actor-image sweeps, in a world with nothing stale", () => {
	it("send no request at all", async () => {
		world([actor("named", { type: "npc", img: "x.webp", prototypeToken: { displayName: 30, texture: { src: "x.webp" } } })]);
		await _migrateTokenNameplates();
		await _migrateNpcPlaceholderPortraits();
		await _migrateTokenImagesToPortraits();
		await _migrateShootMarker();
		expect(global.Actor.updateDocuments).not.toHaveBeenCalled();
	});
});

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
	flipPeoplePortraitsToWhole, planPeoplePortraitFlips, peopleArtResolver,
} from "../../module/book2-art/repoint-portraits.js";

// Putting a person's portrait on the WHOLE illustration, with the hand-chosen square as a frame
// over it and as the token's own file. The pure planning half; the update half needs Foundry.

const ROOT = "stonetop-book-art";
const full = `${ROOT}/assets/people/b1-p135-x526.webp`;
const square = `${ROOT}/assets/people/b1-p135-x526-q000-000-1000-720.webp`;
const rect = [0, 0, 1, 0.72];
const other = `${ROOT}/assets/people/b1-p156-x594.webp`;
const otherSquare = `${ROOT}/assets/people/b1-p156-x594-q100-000-900-500.webp`;
const otherRect = [0.1, 0, 0.9, 0.5];

// Stands in for the manifest+on-disk join: only these two people have a square, and either end of
// the pair resolves to the same triple — which is what makes the pass converge from both
// directions.
const ART = {
	[full]: { whole: full, square, rect },
	[square]: { whole: full, square, rect },
	[other]: { whole: other, square: otherSquare, rect: otherRect },
	[otherSquare]: { whole: other, square: otherSquare, rect: otherRect },
};
const resolve = (src) => ART[src] ?? null;

const frameFor = (whole, r) => ({ src: whole, rect: r });

// Type matters: only an NPC's own portrait is moved. Default to that so each test says only what
// it is about, and name the type explicitly where the point IS the type.
const actor = (props) => ({ name: "someone", type: "npc", ...props });

describe("planning the portrait flip", () => {
	it("moves a portrait onto the whole illustration and frames it with the chosen square", () => {
		const plan = planPeoplePortraitFlips([actor({ img: square })], resolve);
		expect(plan).toHaveLength(1);
		expect(plan[0].updates).toEqual({
			img: full,
			"flags.stonetop-pwd.portraitFrame": frameFor(full, rect),
		});
	});

	it("frames a portrait that is already the whole illustration, without moving it", () => {
		// The other direction into the same target state: a world that never ran the old re-point
		// has the illustration on `img` and only needs the frame and the token.
		const plan = planPeoplePortraitFlips([actor({ img: full })], resolve);
		expect(plan[0].updates).toEqual({ "flags.stonetop-pwd.portraitFrame": frameFor(full, rect) });
	});

	it("puts a following token on the square file", () => {
		// A rect cannot reach the canvas — Foundry's token texture has no crop — so the square that
		// has to be seen on the map stays a real file. See monster-tokens.js.
		const following = actor({ img: full, prototypeToken: { texture: { src: full } } });
		expect(planPeoplePortraitFlips([following], resolve)[0].updates["prototypeToken.texture.src"])
			.toBe(square);
	});

	it("re-states a token already on the square whenever the same update moves the portrait", () => {
		// A world the old re-point already ran on: img and token were both the square, and only the
		// portrait has anywhere left to go. The token still has to be NAMED, at the value it
		// already holds — StonetopActor#_syncPrototypeTokenImage fills an unnamed token key in
		// from the new `img`, and it reads this token as following, because the square IS what
		// `actor.img` says right now. Leave the key out and every villager's token becomes the
		// tall book illustration: the one outcome this pass exists to prevent.
		const done = actor({ img: square, prototypeToken: { texture: { src: square } } });
		expect(planPeoplePortraitFlips([done], resolve)[0].updates).toEqual({
			img: full,
			"flags.stonetop-pwd.portraitFrame": frameFor(full, rect),
			"prototypeToken.texture.src": square,
		});
	});

	it("re-states a BAKED token too, so a portrait move cannot drag a GM's crop onto the whole", () => {
		// Same trap, worse loss: a baked crop is one of the states _syncPrototypeTokenImage treats
		// as following, so an unnamed key would replace a square somebody framed by hand with the
		// uncropped illustration. Naming it stands the sync down; the crop is left exactly as is.
		const bake = "worlds/mine/stonetop-portrait-frames/npc-abc.webp?1699999999";
		const framed = actor({ img: square, prototypeToken: { texture: { src: bake } } });
		expect(planPeoplePortraitFlips([framed], resolve)[0].updates["prototypeToken.texture.src"])
			.toBe(bake);
	});

	it("does not name the token at all once there is nothing left to move", () => {
		// The idempotence that lets this run on every load with no version flag: a world already in
		// the target layout plans no update, so the no-op re-statement above cannot become a write
		// that happens forever.
		const settled = actor({ img: full, prototypeToken: { texture: { src: square } },
			flags: { "stonetop-pwd": { portraitFrame: frameFor(full, rect) } } });
		expect(planPeoplePortraitFlips([settled], resolve)).toEqual([]);
	});

	it("puts a stock placeholder token on the square rather than leaving it to be filled in", () => {
		// A mystery-man token has nothing to lose, and left unnamed it is not left alone: the sync
		// would point it at the whole illustration. The square is the answer this pass has.
		const placeholder = actor({ img: square, prototypeToken: { texture: { src: "icons/svg/mystery-man.svg" } } });
		expect(planPeoplePortraitFlips([placeholder], resolve)[0].updates["prototypeToken.texture.src"])
			.toBe(square);
	});

	it("leaves token art somebody chose alone", () => {
		const custom = actor({ img: full, prototypeToken: { texture: { src: "worlds/mine/token.webp" } } });
		expect(planPeoplePortraitFlips([custom], resolve)[0].updates)
			.not.toHaveProperty("prototypeToken.texture.src");
	});

	it("never replaces a frame somebody chose", () => {
		// A hand-cropped face IS the answer to "which square do the small surfaces show"; the
		// pipeline's default must not silently overrule it.
		const chosen = { src: full, rect: [0.2, 0.05, 0.6, 0.35] };
		const npc = actor({ img: square, flags: { "stonetop-pwd": { portraitFrame: chosen } } });
		expect(planPeoplePortraitFlips([npc], resolve)[0].updates).toEqual({ img: full });
	});

	it("re-stamps a chosen frame whose src is a stale SPELLING of the picture it crops", () => {
		// The Forge repair peopleArtResolver exists for: `img` moves to the path this host actually
		// serves, and a frame left stamped with the old spelling no longer matches the picture being
		// shown — so every small round surface silently drops back to a blind top slice. Same
		// picture, so the rect is still right; only the stamp is stale.
		const host = "https://assets.forge-vtt.com/xyz/";
		const served = () => ({ whole: host + full, square: host + square, rect });
		const chosen = { src: full, rect: [0.2, 0.05, 0.6, 0.35] };
		const npc = actor({ img: full, flags: { "stonetop-pwd": { portraitFrame: chosen } } });
		expect(planPeoplePortraitFlips([npc], served)[0].updates).toEqual({
			img: host + full,
			"flags.stonetop-pwd.portraitFrame": { src: host + full, rect: chosen.rect },
		});
	});

	it("leaves a frame stamped with the SQUARE exactly where it is", () => {
		// Its rect is measured in the square's own coordinates, so moving the stamp to the whole
		// illustration would not repair it — it would re-aim it at a different part of a different
		// picture. Nothing honest to do, so nothing is done.
		const onSquare = { src: square, rect: [0.1, 0.1, 0.9, 0.9] };
		const npc = actor({ img: square, flags: { "stonetop-pwd": { portraitFrame: onSquare } } });
		expect(planPeoplePortraitFlips([npc], resolve)[0].updates).toEqual({ img: full });
	});

	it("seeds over an unusable frame, which is a vacancy rather than a choice", () => {
		const npc = actor({ img: full, flags: { "stonetop-pwd": { portraitFrame: { src: full, rect: [2, 2, 1, 1] } } } });
		expect(planPeoplePortraitFlips([npc], resolve)[0].updates)
			.toEqual({ "flags.stonetop-pwd.portraitFrame": frameFor(full, rect) });
	});

	it("finds follower portraits nested in flags and frames them beside their img", () => {
		// A card's art lives at flags.stonetop-pwd.<shape>.img, and the shape differs per follower
		// type — walking for the key is what covers a type added later. On a PLAYER CHARACTER, which
		// is where follower cards live: the flag walk is deliberately not gated by type even though
		// the actor's own portrait is.
		const pc = actor({
			type: "character",
			img: "systems/stonetop-pwd/assets/playbooks/blessed.webp",
			flags: { "stonetop-pwd": { followers: { "npc:enfys": { img: square, name: "Enfys" } } } },
		});
		expect(planPeoplePortraitFlips([pc], resolve)[0].updates).toEqual({
			"flags.stonetop-pwd.followers.npc:enfys.img": full,
			"flags.stonetop-pwd.followers.npc:enfys.portraitFrame": frameFor(full, rect),
		});
	});

	it("leaves a follower card that already carries a frame", () => {
		const pc = actor({
			type: "character",
			flags: {
				"stonetop-pwd": {
					customFollowers: { enfys: { img: square, portraitFrame: { src: full, rect: [0.1, 0.1, 0.4, 0.4] } } },
				},
			},
		});
		expect(planPeoplePortraitFlips([pc], resolve)[0].updates)
			.toEqual({ "flags.stonetop-pwd.customFollowers.enfys.img": full });
	});

	it("leaves a player character's own portrait alone", () => {
		// The character sheet gives the portrait a whole panel and a GM who browsed a People file
		// for one chose a picture rather than accepted a default. The follower card on the same
		// actor is still moved — that IS a small round surface.
		const pc = actor({
			type: "character",
			img: full,
			prototypeToken: { texture: { src: full } },
			flags: { "stonetop-pwd": { customFollowers: { enfys: { img: other } } } },
		});
		expect(planPeoplePortraitFlips([pc], resolve)[0].updates).toEqual({
			"flags.stonetop-pwd.customFollowers.enfys.portraitFrame": frameFor(other, otherRect),
		});
	});

	it("leaves a monster and the steading actor alone", () => {
		// A creature is already in this layout, cut by its own half of the pipeline.
		const pool = [actor({ type: "monster", img: full }), actor({ type: "stonetop", img: full })];
		expect(planPeoplePortraitFlips(pool, resolve)).toHaveLength(0);
	});

	it("moves several holdings on one actor at once", () => {
		const npc = actor({
			img: square,
			flags: { "stonetop-pwd": { crew: { a: { img: other } }, hirelings: { b: { img: square } } } },
		});
		const plan = planPeoplePortraitFlips([npc], resolve);
		expect(plan[0].updates).toEqual({
			img: full,
			"flags.stonetop-pwd.portraitFrame": frameFor(full, rect),
			"flags.stonetop-pwd.crew.a.portraitFrame": frameFor(other, otherRect),
			"flags.stonetop-pwd.hirelings.b.img": full,
			"flags.stonetop-pwd.hirelings.b.portraitFrame": frameFor(full, rect),
		});
		expect(plan[0].changes).toHaveLength(5);
	});

	it("is idempotent: an actor already in the target layout is not planned again", () => {
		// The whole reason this needs no version flag, and why it may run on every world load.
		const done = actor({
			img: full,
			prototypeToken: { texture: { src: square } },
			flags: { "stonetop-pwd": { portraitFrame: frameFor(full, rect) } },
		});
		expect(planPeoplePortraitFlips([done], resolve)).toHaveLength(0);
	});

	it("leaves alone anything that is not People art", () => {
		const pool = [
			actor({ img: "icons/svg/mystery-man.svg" }),
			actor({ img: "worlds/mine/art/my-own-villager.webp" }),
			actor({ img: `${ROOT}/assets/bestiary/kleztigr.webp` }),
			actor({}),
			actor({ img: "" }),
		];
		expect(planPeoplePortraitFlips(pool, resolve)).toHaveLength(0);
	});

	it("leaves a portrait whose square is not on disk yet", () => {
		// `resolve` is the manifest joined against what was actually extracted, so a world that has
		// not run the rebuild plans nothing rather than framing with a guess.
		const notCut = `${ROOT}/assets/people/b1-p166-x630.webp`;
		expect(planPeoplePortraitFlips([actor({ img: notCut })], resolve)).toHaveLength(0);
	});

	it("ignores other modules' flags", () => {
		const pc = actor({ flags: { "some-module": { thing: { img: full } } } });
		expect(planPeoplePortraitFlips([pc], resolve)).toHaveLength(0);
	});

	it("survives hostile flag data", () => {
		// Flags are arbitrary: other modules write here, and a cycle or a silly depth must not be
		// able to hang the pass.
		const cyclic = { img: square };
		cyclic.self = cyclic;
		const deep = { a: { b: { c: { d: { e: { f: { g: { img: square } } } } } } } };
		const pool = [
			actor({ flags: { "stonetop-pwd": cyclic } }),
			actor({ flags: { "stonetop-pwd": deep } }),
			actor({ flags: { "stonetop-pwd": { list: [{ img: square }] } } }),
			actor({ flags: { "stonetop-pwd": { thing: { img: 42 } } } }),
			actor({ flags: null }),
		];
		expect(() => planPeoplePortraitFlips(pool, resolve)).not.toThrow();
		// The cyclic one still finds its own img; the over-deep one is cut off by the limit.
		const plan = planPeoplePortraitFlips(pool, resolve);
		expect(plan).toHaveLength(1);
		expect(plan[0].updates).toEqual({
			"flags.stonetop-pwd.img": full,
			"flags.stonetop-pwd.portraitFrame": frameFor(full, rect),
		});
	});

	it("handles an empty pool", () => {
		expect(planPeoplePortraitFlips([], resolve)).toEqual([]);
		expect(planPeoplePortraitFlips(null, resolve)).toEqual([]);
	});
});

// The resolver the real pass uses, which answers from the published indexes rather than from the
// path it was handed. That is what lets it do several repairs at once: either end of the pair
// resolves to the same triple, and a path that names the right file in a spelling this host no
// longer serves (a world wired before it knew where its art lived — on The Forge those are the
// bare `stonetop-book-art/…` paths, and nothing else would ever move them) comes back served.
describe("peopleArtResolver", () => {
	const FORGE = "https://assets.forge-vtt.com/abc123/";
	const outFull = "assets/people/b1-p135-x526.webp";
	const outSquare = "assets/people/b1-p135-x526-q000-000-1000-720.webp";
	// A second, always-usable pair, for the tests about ONE row being skipped: without it the
	// index would be empty and the resolver would decline wholesale, which is a different case.
	const outOther = "assets/people/b1-p156-x594.webp";
	const outOtherSquare = "assets/people/b1-p156-x594-q100-000-900-500.webp";

	function withWorld({ prefix = "", index = { [outFull]: outSquare } } = {}) {
		const store = { book2ArtRoot: ROOT, book2ArtPrefix: prefix, peoplePortraitArt: index };
		global.game = { settings: { get: (_ns, key) => store[key] } };
	}

	it("answers the same triple from either end of the pair", () => {
		withWorld();
		const want = { whole: `${ROOT}/${outFull}`, square: `${ROOT}/${outSquare}`, rect };
		expect(peopleArtResolver()(`${ROOT}/${outFull}`)).toEqual(want);
		expect(peopleArtResolver()(`${ROOT}/${outSquare}`)).toEqual(want);
	});

	it("reads the rect straight out of the square's filename", () => {
		// It is the only place that number survives: the hand-chosen square of every shipped person
		// was written into its name and nowhere else.
		withWorld({ index: { [outFull]: "assets/people/b1-p135-x526-q292-024-720-328.webp" } });
		expect(peopleArtResolver()(`${ROOT}/${outFull}`).rect).toEqual([0.292, 0.024, 0.72, 0.328]);
	});

	it("ignores a row whose square name carries no rect to read", () => {
		withWorld({ index: {
			[outFull]:  "assets/people/b1-p135-x526-face.webp",
			[outOther]: outOtherSquare,
		} });
		expect(peopleArtResolver()(`${ROOT}/${outFull}`)).toBeNull();
		// The usable row beside it still answers, so it is that one row being dropped.
		expect(peopleArtResolver()(`${ROOT}/${outOther}`)).not.toBeNull();
	});

	it("ignores a portrait that is not gallery art at all", () => {
		withWorld();
		expect(peopleArtResolver()("worlds/mine/our-own-drawing.webp")).toBeNull();
	});

	it("ignores a person whose square the GM has not extracted", () => {
		withWorld({ index: { [outOther]: outOtherSquare } });
		expect(peopleArtResolver()(`${ROOT}/${outFull}`)).toBeNull();
	});

	it("declines to exist at all when this world has nothing extracted", () => {
		// Not a resolver that can only ever miss. This pass runs on EVERY startup, and null is
		// what lets the planner skip walking every actor and the whole of each one's flag graph
		// to learn the same thing one guaranteed-miss lookup at a time. Both ways of being empty
		// — no rows, and rows carrying no readable rect — answer alike.
		withWorld({ index: {} });
		expect(peopleArtResolver()).toBeNull();
		withWorld({ index: { [outFull]: "assets/people/b1-p135-x526-face.webp" } });
		expect(peopleArtResolver()).toBeNull();
	});

	it("has the planner walk nothing when it declines", () => {
		withWorld({ index: {} });
		const npc = { name: "someone", type: "npc", img: `${ROOT}/${outFull}` };
		expect(planPeoplePortraitFlips([npc])).toEqual([]);
	});

	it("hands out both files at the paths THIS host serves them from", () => {
		withWorld({ prefix: FORGE });
		expect(peopleArtResolver()(`${FORGE}${ROOT}/${outFull}`)).toEqual({
			whole: `${FORGE}${ROOT}/${outFull}`, square: `${FORGE}${ROOT}/${outSquare}`, rect,
		});
	});

	it("repairs a path left on a spelling the host no longer resolves", () => {
		withWorld({ prefix: FORGE });
		expect(peopleArtResolver()(`${ROOT}/${outSquare}`).whole).toBe(`${FORGE}${ROOT}/${outFull}`);
	});

	it("leaves the GM's own art alone when it merely shares a filename", () => {
		// The whole pass is a bulk write with no undo, so answering on the filename alone was how a
		// GM's own picture got silently replaced by a different one from the art folder.
		withWorld();
		expect(peopleArtResolver()("worlds/mine/art/b1-p135-x526.webp")).toBeNull();
		expect(peopleArtResolver()("worlds/mine/art/b1-p135-x526-q000-000-1000-720.webp")).toBeNull();
	});

	it("still answers for the art folder under a root the GM renamed", () => {
		// The confirmation is a TAIL match, so it stays root-agnostic: any root, and any host
		// prefix, sits in front of the part the manifest actually names.
		const store = { book2ArtRoot: "my-art", book2ArtPrefix: "", peoplePortraitArt: { [outFull]: outSquare } };
		global.game = { settings: { get: (_ns, key) => store[key] } };
		expect(peopleArtResolver()(`my-art/${outFull}`).whole).toBe(`my-art/${outFull}`);
	});
});

// The update half. Not just the prototype: a TokenDocument copies `texture.src` out of it when it
// is placed and never looks again, so a pass that stops there leaves a village already laid out on
// a map drawing the tall book illustration inside every square token, forever.
describe("carrying the flip onto the scenes", () => {
	let priorGame, priorActor;
	beforeEach(() => { priorGame = globalThis.game; priorActor = globalThis.Actor; });
	afterEach(() => { globalThis.game = priorGame; globalThis.Actor = priorActor; });

	/** A scene holding one of our villager's tokens, one they re-pointed by hand, one somebody else's. */
	const mapOf = (src, { actorId = "npc1" } = {}) => ({
		name: "Stonetop",
		tokens: [
			{ id: "t0", actorId, texture: { src } },
			{ id: "chosen", actorId, texture: { src: "worlds/mine/tokens/hand-drawn.webp" } },
			{ id: "elsewhere", actorId: "npc2", texture: { src } },
		],
		updateEmbeddedDocuments: vi.fn(async () => {}),
	});

	const villager = (props) => actor({ id: "npc1", update: vi.fn(async () => {}), ...props });

	function install(scenes) {
		globalThis.game = { scenes };
		globalThis.Actor = { updateDocuments: vi.fn(async () => []) };
	}

	it("follows the villagers already standing on a map", async () => {
		const map = mapOf(full);
		install([map]);
		const npc = villager({ img: full, prototypeToken: { texture: { src: full } } });

		const result = await flipPeoplePortraitsToWhole({ actors: [npc], resolve });

		expect(result.placed).toBe(1);
		// Only the token that was showing what the prototype was showing. The hand-pointed one is a
		// per-token choice, and the other actor's is not ours at all.
		expect(map.updateEmbeddedDocuments).toHaveBeenCalledWith("Token", [{ _id: "t0", "texture.src": square }]);
	});

	it("asks no scene anything when no prototype token moved", async () => {
		// The idempotent case, which is every load after the first: no request per scene, so this
		// stays free to run on startup.
		const map = mapOf(square);
		install([map]);
		const npc = villager({ img: square, prototypeToken: { texture: { src: square } } });

		expect((await flipPeoplePortraitsToWhole({ actors: [npc], resolve })).placed).toBe(0);
		expect(map.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("does not follow scenes for an actor whose own write failed", async () => {
		// The prototype never moved, so a placed token repointed here would be showing a square the
		// actor does not claim. Both writes have to fail: the bulk one, then the per-actor retry.
		const map = mapOf(full);
		install([map]);
		globalThis.Actor.updateDocuments = vi.fn(async () => { throw new Error("locked"); });
		const npc = villager({ img: full, prototypeToken: { texture: { src: full } } });
		npc.update = vi.fn(async () => { throw new Error("locked"); });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		try {
			const result = await flipPeoplePortraitsToWhole({ actors: [npc], resolve });
			expect(result.failed).toBe(1);
			expect(result.placed).toBe(0);
			expect(map.updateEmbeddedDocuments).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it("still saves the actors it can when one of them is unwritable", async () => {
		// The bulk call is all-or-nothing, so one locked actor must not hold every clean one stale.
		install([]);
		globalThis.Actor.updateDocuments = vi.fn(async () => { throw new Error("locked"); });
		const ok = villager({ id: "npc1", img: full, prototypeToken: { texture: { src: full } } });
		const locked = villager({ id: "npc2", img: other, prototypeToken: { texture: { src: other } } });
		locked.update = vi.fn(async () => { throw new Error("locked"); });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		try {
			const result = await flipPeoplePortraitsToWhole({ actors: [ok, locked], resolve });
			expect(result.updated).toBe(1);
			expect(result.failed).toBe(1);
			expect(ok.update).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	canBakePortraitFrame, revertPrototypeTokenFrame, syncPrototypeTokenToFrame, tokenFollowsPortrait,
} from "../../module/utils/portrait-token-frame.js";
import { PORTRAIT_FRAME_BAKE_DIR, isPortraitFrameBake } from "../../module/utils/portrait-frame.js";
import { PERSON_DEFAULT_IMG } from "../../module/utils/person-portrait.js";
import { SYSTEM_ID } from "../../module/system-id.js";

const ART = "worlds/mine/art/bryn.webp";
const BAKE = `worlds/mine/${PORTRAIT_FRAME_BAKE_DIR}/bryn-abc-frame.webp`;
const FRAME = { src: ART, rect: [0.2, 0.05, 0.7, 0.55] };

// A bestiary creature: `img` is the whole book illustration and the token is the hand-framed
// square the art pipeline cut from it. Both halves of the pair matter — a `-t` square of some
// OTHER picture is a choice, not a default (see monster-tokens.js).
const CREATURE = "stonetop-book-art/assets/bestiary/crinwin.webp";
const SQUARE = "stonetop-book-art/assets/bestiary/crinwin-t397-163-718-600.webp";
const CREATURE_FRAME = { src: CREATURE, rect: [0.387, 0.078, 0.78, 0.613] };

// A person's face square, which is resolved through the SHIPPED manifest rather than by stripping
// the suffix — so this pair has to be a real row, not an invented one.
const PERSON = "stonetop-book-art/assets/people/b1-p135-x526.webp";
const PERSON_SQUARE = "stonetop-book-art/assets/people/b1-p135-x526-q425-000-765-245.webp";

/** The bake is a canvas + upload round trip, stubbed at the module boundary. */
const baker = vi.hoisted(() => ({ bake: vi.fn() }));
vi.mock("../../module/utils/portrait-tokenizer.js", () => ({ bakeFrameToFile: baker.bake }));

// `noToken` rather than `token: undefined`, which the default below would swallow.
function makeActor({ img = ART, token = PERSON_DEFAULT_IMG, noToken = false, isOwner = true, frame, flags } = {}) {
	return {
		id: "abc", name: "Bryn", img, isOwner,
		prototypeToken: noToken ? undefined : { texture: { src: token } },
		flags: { [SYSTEM_ID]: { ...(frame ? { portraitFrame: frame } : {}), ...(flags ?? {}) } },
		update: vi.fn(async function (data) {
			if ("prototypeToken.texture.src" in data) this.prototypeToken.texture.src = data["prototypeToken.texture.src"];
		}),
	};
}

/** A scene holding `n` tokens of our actor, all showing `src`, plus one nobody may touch. */
function makeScene(src, n = 1, { name = "The Barrow", actorId = "abc" } = {}) {
	const tokens = Array.from({ length: n }, (_, i) => ({ id: `t${i}`, actorId, texture: { src } }));
	tokens.push({ id: "chosen", actorId, texture: { src: "worlds/mine/tokens/hand-drawn.webp" } });
	tokens.push({ id: "someone-else", actorId: "zzz", texture: { src } });
	return { name, tokens, updateEmbeddedDocuments: vi.fn(async () => {}) };
}

const tokenSrc = (actor) => actor.prototypeToken?.texture?.src;
const tokenUpdates = (scene) => scene.updateEmbeddedDocuments.mock.calls[0]?.[1] ?? [];

beforeEach(() => {
	baker.bake.mockReset().mockResolvedValue(BAKE);
	globalThis.game = { ...(globalThis.game ?? {}), user: { can: () => true }, scenes: [] };
});
afterEach(() => { delete globalThis.game.user; delete globalThis.game.scenes; });

describe("isPortraitFrameBake", () => {
	it("recognises our own bakes, cache-buster and all", () => {
		expect(isPortraitFrameBake(BAKE)).toBe(true);
		expect(isPortraitFrameBake(`${BAKE}?1699999999`)).toBe(true);
	});

	it("does not claim a portrait, a token somebody chose, or nothing", () => {
		expect(isPortraitFrameBake(ART)).toBe(false);
		expect(isPortraitFrameBake("worlds/mine/tokens/bryn.webp")).toBe(false);
		expect(isPortraitFrameBake(PERSON_DEFAULT_IMG)).toBe(false);
		expect(isPortraitFrameBake("")).toBe(false);
		expect(isPortraitFrameBake(undefined)).toBe(false);
	});
});

describe("tokenFollowsPortrait", () => {
	it("claims a placeholder, the portrait itself, and one of our bakes", () => {
		expect(tokenFollowsPortrait(makeActor({ token: PERSON_DEFAULT_IMG }))).toBe(true);
		expect(tokenFollowsPortrait(makeActor({ token: "icons/svg/mystery-man.svg" }))).toBe(true);
		expect(tokenFollowsPortrait(makeActor({ token: ART }))).toBe(true);
		expect(tokenFollowsPortrait(makeActor({ token: `${BAKE}?123` }))).toBe(true);
	});

	it("claims the bestiary's own square of this creature's illustration", () => {
		// The art pipeline cut it from the very picture `img` shows, so it is a default this
		// system chose. Without this the crop tool stops at the sheet and never reaches the map.
		expect(tokenFollowsPortrait(makeActor({ img: CREATURE, token: SQUARE }))).toBe(true);
		expect(tokenFollowsPortrait(makeActor({ img: CREATURE, token: `${SQUARE}?9` }))).toBe(true);
	});

	it("leaves a square cut from a different picture alone", () => {
		// Same shape, another creature: somebody pointed this token there on purpose.
		const other = "stonetop-book-art/assets/bestiary/hagr-t250-0-750-500.webp";
		expect(tokenFollowsPortrait(makeActor({ img: CREATURE, token: other }))).toBe(false);
	});

	it("claims a person's -q face square, which the manifest has to vouch for", () => {
		// The people half of the same rule. Unlike a creature's `-t`, a `-q` is resolved through the
		// manifest rather than by stripping the suffix, so a GM's own lookalike file is not claimed.
		expect(tokenFollowsPortrait(makeActor({ img: PERSON, token: PERSON_SQUARE }))).toBe(true);
		expect(tokenFollowsPortrait(makeActor({
			img: "worlds/mine/art/villager.webp", token: "worlds/mine/art/villager-q120-000-880-260.webp",
		}))).toBe(false);
	});

	it("leaves a token somebody chose alone", () => {
		expect(tokenFollowsPortrait(makeActor({ token: "worlds/mine/tokens/bryn-pog.webp" }))).toBe(false);
	});

	it("has nothing to say about an actor with no prototype token", () => {
		expect(tokenFollowsPortrait(makeActor({ noToken: true }))).toBe(false);
		expect(tokenFollowsPortrait(null)).toBe(false);
	});

	it("drops the pipeline-square state for a caller that asks without it", () => {
		// The fourth state belongs to FRAMING, which puts another square in a square's place and
		// remembers the one it displaced. A portrait SWAP (_syncPrototypeTokenImage) offers neither:
		// asking with it on would hand a bestiary creature's hand-framed `-t` square to the
		// uncropped illustration on any write that so much as touches `img`, remembering nothing.
		const creature = makeActor({ img: CREATURE, token: SQUARE });
		expect(tokenFollowsPortrait(creature)).toBe(true);
		expect(tokenFollowsPortrait(creature, { pipelineSquare: false })).toBe(false);

		const person = makeActor({ img: PERSON, token: PERSON_SQUARE });
		expect(tokenFollowsPortrait(person, { pipelineSquare: false })).toBe(false);
	});

	it("keeps the other three states whichever way it is asked", () => {
		// Only the fourth is optional: a placeholder, the portrait itself and one of our bakes are
		// ours to move on either side, and a token somebody chose is nobody's.
		for (const opts of [undefined, { pipelineSquare: false }]) {
			expect(tokenFollowsPortrait(makeActor({ token: PERSON_DEFAULT_IMG }), opts)).toBe(true);
			expect(tokenFollowsPortrait(makeActor({ token: ART }), opts)).toBe(true);
			expect(tokenFollowsPortrait(makeActor({ token: `${BAKE}?123` }), opts)).toBe(true);
			expect(tokenFollowsPortrait(makeActor({ token: "worlds/mine/tokens/bryn-pog.webp" }), opts)).toBe(false);
		}
	});
});

describe("syncPrototypeTokenToFrame", () => {
	it("bakes the square and points the token at it", async () => {
		const actor = makeActor();
		const written = await syncPrototypeTokenToFrame(actor, FRAME);
		expect(baker.bake).toHaveBeenCalledWith(ART, FRAME.rect, { name: "Bryn", id: "abc" });
		expect(written.split("?")[0]).toBe(BAKE);
		expect(tokenSrc(actor).split("?")[0]).toBe(BAKE);
	});

	it("cache-busts, because the file is overwritten under one name", async () => {
		// Without the stamp a re-frame paints the PREVIOUS crop out of the browser's cache: same
		// URL, new bytes.
		const actor = makeActor();
		const written = await syncPrototypeTokenToFrame(actor, FRAME);
		expect(written).toMatch(/\?\d+$/);
	});

	it("re-points a token that is already showing an older bake", async () => {
		const actor = makeActor({ token: `${BAKE}?111` });
		await syncPrototypeTokenToFrame(actor, FRAME);
		expect(actor.update).toHaveBeenCalled();
	});

	it("never touches a token somebody chose", async () => {
		const chosen = "worlds/mine/tokens/bryn-pog.webp";
		const actor = makeActor({ token: chosen });
		expect(await syncPrototypeTokenToFrame(actor, FRAME)).toBeNull();
		expect(baker.bake).not.toHaveBeenCalled();
		expect(tokenSrc(actor)).toBe(chosen);
	});

	it("does nothing without upload rights, rather than failing the frame that was just saved", async () => {
		globalThis.game.user = { can: () => false };
		const actor = makeActor();
		expect(await syncPrototypeTokenToFrame(actor, FRAME)).toBeNull();
		expect(baker.bake).not.toHaveBeenCalled();
		expect(canBakePortraitFrame()).toBe(false);
	});

	it("swallows a bake that fails, leaving the token where it was", async () => {
		// An external URL with no CORS headers taints the canvas and throws at toBlob — after all
		// the work. The frame is already saved by then and every other surface is correct.
		baker.bake.mockRejectedValue(new Error("tainted canvas"));
		const actor = makeActor();
		await expect(syncPrototypeTokenToFrame(actor, FRAME)).resolves.toBeNull();
		expect(tokenSrc(actor)).toBe(PERSON_DEFAULT_IMG);

		baker.bake.mockReset().mockResolvedValue(null);
		expect(await syncPrototypeTokenToFrame(makeActor(), FRAME)).toBeNull();
	});

	it("reads the actor's own frame when handed none", async () => {
		const actor = makeActor({ frame: FRAME });
		await syncPrototypeTokenToFrame(actor);
		expect(baker.bake).toHaveBeenCalledWith(ART, FRAME.rect, { name: "Bryn", id: "abc" });
	});

	it("crops a bestiary creature off its shipped square, remembering the square", async () => {
		const actor = makeActor({ img: CREATURE, token: SQUARE });
		await syncPrototypeTokenToFrame(actor, CREATURE_FRAME);
		expect(baker.bake).toHaveBeenCalledWith(CREATURE, CREATURE_FRAME.rect, { name: "Bryn", id: "abc" });
		expect(tokenSrc(actor).split("?")[0]).toBe(BAKE);
		expect(actor.update.mock.calls[0][0][`flags.${SYSTEM_ID}.portraitFrameTokenWas`]).toBe(SQUARE);
	});

	it("does not record a previous bake as the thing to revert to", async () => {
		// A re-frame displaces the LAST crop, which is not a picture anybody wants back.
		const actor = makeActor({ img: CREATURE, token: `${BAKE}?111` });
		await syncPrototypeTokenToFrame(actor, CREATURE_FRAME);
		expect(actor.update.mock.calls[0][0]).not.toHaveProperty(`flags.${SYSTEM_ID}.portraitFrameTokenWas`);
	});

	it("moves the tokens already standing on scenes, not just the prototype", async () => {
		// A TokenDocument copies the prototype's src when it is placed and never looks back, so a
		// crop that stops at the prototype leaves the creature in play showing the old picture.
		const scene = makeScene(SQUARE, 2);
		globalThis.game.scenes = [scene];
		const actor = makeActor({ img: CREATURE, token: SQUARE });
		const written = await syncPrototypeTokenToFrame(actor, CREATURE_FRAME);
		expect(tokenUpdates(scene)).toEqual([
			{ _id: "t0", "texture.src": written },
			{ _id: "t1", "texture.src": written },
		]);
	});

	it("re-stamps placed tokens on a re-frame, cache-buster and all", async () => {
		// One file under one name: without a fresh stamp the placed token paints the PREVIOUS crop
		// out of the browser's cache, which is the bug that looks most like nothing happening.
		const scene = makeScene(`${BAKE}?111`);
		globalThis.game.scenes = [scene];
		const actor = makeActor({ token: `${BAKE}?111` });
		const written = await syncPrototypeTokenToFrame(actor, FRAME);
		expect(tokenUpdates(scene)).toEqual([{ _id: "t0", "texture.src": written }]);
		expect(written).not.toBe(`${BAKE}?111`);
	});

	it("keeps a scene it may not write to from failing the frame that was just saved", async () => {
		const scene = makeScene(SQUARE);
		scene.updateEmbeddedDocuments = vi.fn(async () => { throw new Error("User lacks permission"); });
		globalThis.game.scenes = [scene];
		const actor = makeActor({ img: CREATURE, token: SQUARE });
		const written = await syncPrototypeTokenToFrame(actor, CREATURE_FRAME);
		expect(written.split("?")[0]).toBe(BAKE);
		expect(tokenSrc(actor)).toBe(written);
	});

	it("refuses an unusable frame and a document this user does not own", async () => {
		expect(await syncPrototypeTokenToFrame(makeActor(), { src: "", rect: FRAME.rect })).toBeNull();
		expect(await syncPrototypeTokenToFrame(makeActor(), null)).toBeNull();
		expect(await syncPrototypeTokenToFrame(makeActor({ isOwner: false }), FRAME)).toBeNull();
		expect(await syncPrototypeTokenToFrame(null, FRAME)).toBeNull();
		expect(baker.bake).not.toHaveBeenCalled();
	});
});

describe("revertPrototypeTokenFrame", () => {
	it("puts a baked token back on the whole portrait", async () => {
		const actor = makeActor({ token: `${BAKE}?111` });
		expect(await revertPrototypeTokenFrame(actor)).toBe(ART);
		expect(tokenSrc(actor)).toBe(ART);
	});

	it("undoes what framing did and nothing else", async () => {
		// A token already showing the portrait, a placeholder, or a chosen image was not put
		// there by framing, so clearing a frame has no business moving it.
		for (const token of [ART, PERSON_DEFAULT_IMG, "worlds/mine/tokens/bryn-pog.webp"]) {
			const actor = makeActor({ token });
			expect(await revertPrototypeTokenFrame(actor)).toBeNull();
			expect(tokenSrc(actor)).toBe(token);
		}
	});

	it("puts a bestiary creature back on its shipped square, not the whole illustration", async () => {
		const actor = makeActor({
			img: CREATURE, token: `${BAKE}?111`, flags: { portraitFrameTokenWas: SQUARE },
		});
		expect(await revertPrototypeTokenFrame(actor)).toBe(SQUARE);
		expect(tokenSrc(actor)).toBe(SQUARE);
	});

	it("ignores a remembered square that no longer belongs to this portrait", async () => {
		// The picture was swapped while the crop was on, so that square is a cut of a creature this
		// actor no longer shows. The portrait is the honest fallback.
		const actor = makeActor({ token: `${BAKE}?111`, flags: { portraitFrameTokenWas: SQUARE } });
		expect(await revertPrototypeTokenFrame(actor)).toBe(ART);
	});

	it("moves the placed tokens back too", async () => {
		const scene = makeScene(`${BAKE}?111`);
		globalThis.game.scenes = [scene];
		const actor = makeActor({ img: CREATURE, token: `${BAKE}?111`, flags: { portraitFrameTokenWas: SQUARE } });
		await revertPrototypeTokenFrame(actor);
		expect(tokenUpdates(scene)).toEqual([{ _id: "t0", "texture.src": SQUARE }]);
	});

	it("drops the memo even when there is no bake left to undo", async () => {
		// Framed (memo stored, token became a bake), then pointed somewhere by hand, then cleared.
		// Nothing is put back — that token is somebody's choice now — but the memo has to go, or it
		// outlives the displacement it records and the NEXT frame-then-clear resurrects a square
		// cut from a picture two portraits ago.
		const actor = makeActor({
			img: CREATURE, token: "worlds/mine/tokens/hand-drawn.webp", flags: { portraitFrameTokenWas: SQUARE },
		});
		expect(await revertPrototypeTokenFrame(actor)).toBeNull();
		expect(actor.update).toHaveBeenCalledTimes(1);
		const [update] = actor.update.mock.calls[0];
		// The memo, and ONLY the memo: the token itself is not named at all.
		expect(Object.keys(update)).toEqual([`flags.${SYSTEM_ID}.-=portraitFrameTokenWas`]);
	});

	it("writes nothing at all when there is no bake AND no memo", async () => {
		// The common case — clearing a frame on an actor framing never moved. It must stay a
		// genuine no-op rather than becoming a write per clear.
		const actor = makeActor({ token: "worlds/mine/tokens/hand-drawn.webp" });
		expect(await revertPrototypeTokenFrame(actor)).toBeNull();
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("does nothing on a document this user does not own", async () => {
		const actor = makeActor({ token: BAKE, isOwner: false });
		expect(await revertPrototypeTokenFrame(actor)).toBeNull();
		expect(actor.update).not.toHaveBeenCalled();
	});
});

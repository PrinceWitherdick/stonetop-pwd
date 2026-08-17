import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
	actorPortraitPickUpdate, followerPortraitClearUpdate, followerPortraitPickUpdate,
} from "../../module/utils/portrait-frame-handles.js";
import { PORTRAIT_FRAME_BAKE_DIR } from "../../module/utils/portrait-frame.js";
import { PERSON_DEFAULT_IMG } from "../../module/utils/person-portrait.js";
import { SYSTEM_ID } from "../../module/system-id.js";

// What a gallery pick writes onto an Actor: the whole illustration, the square as a frame over it,
// and the square as the token's own file. All three move together — see actorPortraitPickUpdate.

const FRAME_KEY = `flags.${SYSTEM_ID}.portraitFrame`;
const TOKEN_KEY = "prototypeToken.texture.src";

// A real manifest pair, because a `-q` square is only recognised as ours when the manifest vouches
// for it (people-portraits.js); an invented filename would resolve to nothing.
const WHOLE = "stonetop-book-art/assets/people/b1-p135-x526.webp";
const SQUARE = "stonetop-book-art/assets/people/b1-p135-x526-q425-000-765-245.webp";
const OLD_WHOLE = "stonetop-book-art/assets/people/b1-p156-x594.webp";
const OLD_SQUARE = "stonetop-book-art/assets/people/b1-p156-x594-q100-005-503-298.webp";
const PICK = { frame: { src: WHOLE, rect: [0.425, 0, 0.765, 0.245] }, square: SQUARE };

const actor = ({ img = OLD_WHOLE, token = OLD_SQUARE, noToken = false } = {}) => ({
	img, prototypeToken: noToken ? undefined : { texture: { src: token } },
});

// v14 deletes a key by ForcedDeletion instance, v13 and below by the `-=` leaf prefix. The tests
// care that the frame is DROPPED, not which spelling this core wants, so ask the same helper.
beforeEach(() => { globalThis.game = { ...(globalThis.game ?? {}), release: { generation: 13 } }; });
afterEach(() => { delete globalThis.game.release; });
const DROPPED = `flags.${SYSTEM_ID}.-=portraitFrame`;

describe("actorPortraitPickUpdate", () => {
	it("writes picture, frame and token in one update", () => {
		expect(actorPortraitPickUpdate(actor(), WHOLE, PICK)).toEqual({
			img: WHOLE,
			[FRAME_KEY]: PICK.frame,
			[TOKEN_KEY]: SQUARE,
		});
	});

	it("sets the token explicitly rather than letting the portrait sync drag it", () => {
		// _syncPrototypeTokenImage would otherwise put the WHOLE illustration on the token, which
		// on a standing figure is the blind centre slice the square exists to avoid. It stands
		// down as soon as an update names the key itself.
		expect(actorPortraitPickUpdate(actor(), WHOLE, PICK)[TOKEN_KEY]).toBe(SQUARE);
	});

	it("moves a token that was on a placeholder, the old portrait, or the old square", () => {
		for (const token of [PERSON_DEFAULT_IMG, "icons/svg/mystery-man.svg", OLD_WHOLE, OLD_SQUARE]) {
			expect(actorPortraitPickUpdate(actor({ token }), WHOLE, PICK)[TOKEN_KEY]).toBe(SQUARE);
		}
	});

	it("moves a token showing one of our own crop bakes", () => {
		const bake = `worlds/mine/${PORTRAIT_FRAME_BAKE_DIR}/x-abc-frame.webp?123`;
		expect(actorPortraitPickUpdate(actor({ token: bake }), WHOLE, PICK)[TOKEN_KEY]).toBe(SQUARE);
	});

	it("leaves token art somebody chose, and an actor with no prototype token", () => {
		const chosen = "worlds/mine/tokens/hand-drawn.webp";
		expect(actorPortraitPickUpdate(actor({ token: chosen }), WHOLE, PICK)).not.toHaveProperty(TOKEN_KEY);
		expect(actorPortraitPickUpdate(actor({ noToken: true }), WHOLE, PICK)).not.toHaveProperty(TOKEN_KEY);
	});

	it("drops the frame when the new picture brings none, rather than carrying the old one", () => {
		// A browsed file has no hand-cut square behind it. The stale rect was measured on the
		// portrait being replaced, so keeping it would leave an orphan nothing ever clears.
		const browsed = "worlds/mine/art/my-own-villager.webp";
		expect(actorPortraitPickUpdate(actor(), browsed)).toEqual({ img: browsed, [DROPPED]: null });
	});

	it("leaves the token alone when there is no square to put on it", () => {
		// The portrait sync then moves a following token onto the browsed file, which is right:
		// that IS the whole picture the user chose.
		expect(actorPortraitPickUpdate(actor(), "worlds/mine/art/x.webp")).not.toHaveProperty(TOKEN_KEY);
	});

	it("refuses an unusable rect the same way it refuses an absent one", () => {
		const bad = { frame: { src: WHOLE, rect: [2, 2, 1, 1] }, square: SQUARE };
		const update = actorPortraitPickUpdate(actor(), WHOLE, bad);
		expect(update[DROPPED]).toBeNull();
		expect(update).not.toHaveProperty(FRAME_KEY);
		// No frame means no square to trust either — the two came off the same tile.
		expect(update[TOKEN_KEY]).toBe(SQUARE);
	});

	it("stores an empty picture as an empty string rather than undefined", () => {
		expect(actorPortraitPickUpdate(actor(), null).img).toBe("");
	});
});

// The follower-card counterpart. A card is a flag rather than a document, so there is no token
// half — but the picture and the rect that crops it are still one choice, and there is still only
// one way this key is allowed to be emptied.
describe("followerPortraitPickUpdate", () => {
	const BASE = "customFollowers.abc";
	const IMG_KEY = `flags.${SYSTEM_ID}.${BASE}.img`;
	const FRAME = `flags.${SYSTEM_ID}.${BASE}.portraitFrame`;
	const GONE = `flags.${SYSTEM_ID}.${BASE}.-=portraitFrame`;

	it("writes the picture and its frame together", () => {
		expect(followerPortraitPickUpdate(BASE, WHOLE, { frame: PICK.frame }))
			.toEqual({ [IMG_KEY]: WHOLE, [FRAME]: PICK.frame });
	});

	it("DELETES the frame when the new picture brings none, rather than nulling it", () => {
		// A null would sit in the flag bag with nothing left to ever clear it — the very thing the
		// clear below uses deletionEntry to avoid. One key, one clearing convention.
		const browsed = "worlds/mine/art/my-own-villager.webp";
		expect(followerPortraitPickUpdate(BASE, browsed)).toEqual({ [IMG_KEY]: browsed, [GONE]: null });
	});

	it("treats an unusable rect as no frame at all", () => {
		const update = followerPortraitPickUpdate(BASE, WHOLE, { frame: { src: WHOLE, rect: [2, 2, 1, 1] } });
		expect(update[GONE]).toBeNull();
		expect(update).not.toHaveProperty(FRAME);
	});

	it("clears to art-less with the frame dropped the same way", () => {
		expect(followerPortraitClearUpdate(BASE)).toEqual({ [IMG_KEY]: "", [GONE]: null });
	});
});

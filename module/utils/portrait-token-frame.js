// Make a chosen portrait frame visible on the MAP.
//
// The frame is stored as a rect and painted by an inline style, which is what lets a player crop
// their own portrait without the upload rights baking a file would need (see portrait-frame.js).
// The cost of that choice is that only surfaces which KNOW about the rect apply it — and the
// canvas is not one of them. A token is drawn straight from `prototypeToken.texture.src`, and
// Foundry's token texture carries scale, offset and fit but no crop rect, so there is no
// arrangement of those fields that means "show this square of the picture". The only way a token
// can show the face somebody framed is for that square to exist as a file.
//
// So: on save, cut it. The rect stays the source of truth — this is a one-way export, taken at
// the moment the frame is written, and re-framing overwrites the same file rather than piling up
// one per crop.
//
// WHOSE TOKEN IS TOUCHED. `tokenFollowsPortrait` below is where that rule is written down, for
// this side and for the portrait side (StonetopActor#_syncPrototypeTokenImage, which calls it):
//   • the token is still a stock placeholder — nothing to lose;
//   • the token is showing the portrait — it was following, so it goes on following;
//   • the token is one of our own bakes — it is following the FRAME, and this is the re-frame; or
//   • the token is the art pipeline's own hand-framed square of THIS portrait — cut from the same
//     illustration, so it is a default this system chose, not a GM's choice.
// A token anyone chose, or Tokenizer cut, is never touched.
//
// THE FOURTH STATE BELONGS TO FRAMING ONLY, which is what `pipelineSquare` is for. Replacing a
// pipeline square with a crop of the very same illustration keeps a square on the map and
// remembers what it displaced (DISPLACED_KEY), so it is undoable and loses nothing. A PORTRAIT
// SWAP offers neither: it would drop a hand-framed `-t<rect>` square — the whole point of a
// bestiary creature's token, whose `actor.img` is deliberately the tall illustration the square
// was cut from — onto that uncropped illustration, remember nothing, and do it on any write that
// merely touches `img`. So the portrait side asks without the fourth state and leaves such a
// token alone.

import { documentPortraitFrame, isPortraitFrameBake, isValidFrame, sameSrc } from "./portrait-frame.js";
import { tokenSourceFor } from "../book2-art/monster-tokens.js";
import { fullPortraitSrc } from "../book2-art/people-portraits.js";
import { deletionEntry } from "./foundry-compat.js";
import { SYSTEM_ID } from "../system-id.js";
import { isDefaultImg } from "./strings.js";
import { updatePlacedTokens } from "./placed-tokens.js";

/**
 * Where the token picture a bake DISPLACED is remembered, so clearing the frame can put it back.
 *
 * Only ever holds a pipeline square. Every other state this module claims is reconstructible from
 * the actor at revert time — a placeholder is a placeholder, and the portrait is `actor.img` — but
 * a square's filename carries the hand-chosen rect that made it, and once the token has been
 * pointed at a bake there is nowhere left to read that rect from. Without this, clearing a crop on
 * a creature or a person drops its token back onto the whole illustration, which is the blind
 * centre slice of a printed page that the square exists to avoid.
 */
const DISPLACED_KEY = "portraitFrameTokenWas";

/**
 * May this user bake at all? Cutting a square writes a file, which needs FILES_UPLOAD — a right
 * most worlds keep to the GM. Everything else about framing works without it, so this is a
 * capability to check rather than an error to raise.
 */
export function canBakePortraitFrame() {
	return !!game.user?.can?.("FILES_UPLOAD");
}

/**
 * Is `tokenSrc` the art pipeline's own square of the picture at `img`?
 *
 * TWO KINDS OF SQUARE answer here, because the pipeline cuts two and a token wears either:
 *  - a creature's `-t` token square, derived by stripping the suffix (monster-tokens.js); and
 *  - a person's `-q` face square, resolved through the manifest (people-portraits.js), which is
 *    stricter on purpose — a GM's own file that merely LOOKS like a square resolves to nothing.
 *
 * Both halves of the test are load-bearing. The suffix alone says "somebody's square", and
 * pointing a token at ANOTHER character's square is a deliberate act nobody should undo; it is the
 * square resolving back to this actor's own portrait that makes it a default rather than a choice.
 */
function isOwnPipelineSquare(tokenSrc, img) {
	if (!tokenSrc || !img) return false;
	const whole = tokenSourceFor(tokenSrc) ?? fullPortraitSrc(tokenSrc);
	return whole !== null && sameSrc(whole, img);
}

/**
 * Is this token image ours to move, under the four-state rule above?
 *
 * `pipelineSquare` is the fourth state, and only a caller that REPLACES a square with another
 * square may ask with it on — see the note above. The portrait-sync side passes false.
 */
export function tokenFollowsPortrait(actor, { pipelineSquare = true } = {}) {
	const current = actor?.prototypeToken?.texture?.src;
	if (current === undefined) return false;
	return isDefaultImg(current)
		|| isPortraitFrameBake(current)
		|| sameSrc(current, actor.img)
		|| (pipelineSquare && isOwnPipelineSquare(current, actor.img));
}

/**
 * Move the tokens ALREADY STANDING ON SCENES, not just the prototype.
 *
 * A TokenDocument copies `texture.src` out of the prototype at the moment it is placed and never
 * looks at it again, so a re-frame that stops at `prototypeToken` changes the NEXT token dragged
 * out and leaves the creature in play showing the old picture — which reads exactly like the crop
 * not working, because the map is where the user is looking.
 *
 * Only tokens showing precisely what the prototype was showing are moved. Anything else standing
 * on that scene is a per-token choice, and the whole point of the four-state rule is that we do
 * not overwrite those.
 *
 * Compared through `sameSrc`, so a token placed under an older cache-buster still matches the bake
 * it was placed from. The `previous === next` guard is EXACT for the same reason it cannot be
 * `sameSrc`: a re-frame overwrites one file under one name, so the only thing distinguishing the
 * new crop from the old is the stamp, and skipping on a stripped-query match would leave every
 * placed token painting the previous crop out of the browser's cache.
 *
 * Best-effort per scene, like the bake itself: the frame is already saved and the prototype is
 * already right, so a scene we may not write to must not fail the save. That, and the per-scene
 * batching, are utils/placed-tokens.js — shared with the two startup sweeps that need the same.
 */
async function repointPlacedTokens(actor, previous, next) {
	if (!previous || !next || previous === next) return 0;
	return updatePlacedTokens(
		(t) => t.actorId === actor.id && sameSrc(t.texture?.src, previous),
		() => ({ "texture.src": next }),
		{ what: "move" },
	);
}

/**
 * Point the prototype token at a freshly baked square of `frame`.
 *
 * Best-effort by design: the frame itself is already saved by the time this runs, and a world
 * without upload rights (or a portrait the canvas cannot read, e.g. an external URL with no CORS
 * headers) must still keep the crop everywhere else. Failures are logged, never thrown.
 *
 * Returns the stored token path, or null when nothing was written.
 */
export async function syncPrototypeTokenToFrame(actor, frame = undefined) {
	if (!actor?.isOwner) return null;
	const rect = (frame === undefined ? documentPortraitFrame(actor) : frame);
	if (!isValidFrame(rect)) return null;
	if (!canBakePortraitFrame() || !tokenFollowsPortrait(actor)) return null;
	try {
		const { bakeFrameToFile } = await import("./portrait-tokenizer.js");
		const path = await bakeFrameToFile(rect.src, rect.rect, { name: actor.name, id: actor.id });
		if (!path) return null;
		// One file per person, overwritten on every re-frame — so the URL is unchanged and the
		// browser (and PIXI's texture cache) would happily paint the PREVIOUS crop. The stamp is
		// what makes a re-frame visible. Every comparison this module makes strips it.
		const busted = `${path}?${Date.now()}`;
		const previous = actor.prototypeToken?.texture?.src;
		const update = { "prototypeToken.texture.src": busted };
		// Remember a pipeline square before it goes under, and ONLY then: a re-frame displaces the
		// last bake, which must not be recorded as the thing to revert to, and every other state is
		// reconstructible without help. See DISPLACED_KEY.
		if (isOwnPipelineSquare(previous, actor.img)) {
			update[`flags.${SYSTEM_ID}.${DISPLACED_KEY}`] = previous;
		}
		await actor.update(update);
		await repointPlacedTokens(actor, previous, busted);
		return busted;
	} catch (err) {
		console.warn("stonetop | could not bake the portrait frame for this token", err);
		return null;
	}
}

/**
 * Put the token back where framing found it when a frame is cleared: the bestiary square it
 * displaced if there was one, else the whole portrait.
 *
 * Only when the token is currently one of our bakes: clearing a frame should undo what framing
 * did and nothing else, so a token that was already showing the portrait (or a placeholder, or a
 * chosen image) is left exactly where it is. The baked file is left on disk — Foundry exposes no
 * delete — but nothing points at it, and the next frame overwrites it.
 *
 * THE MEMO IS DROPPED EVEN THEN, which is the one thing that early return must not skip. It
 * records what a bake displaced, so once the token is no longer that bake it describes a
 * displacement nobody is holding — and left behind it is live again the next time this actor is
 * framed and cleared, handing that clear a square cut from a picture two portraits ago. Framing
 * an NPC (memo stored), pointing its token somewhere by hand, then clearing is the whole path.
 *
 * The remembered square is RE-VALIDATED against the portrait rather than trusted, which is what
 * keeps it from going stale: if the portrait was swapped while the crop was on, that square is a
 * cut of a picture this creature no longer shows, and the honest fallback is the portrait itself.
 * The memo is dropped either way — it describes a displacement that has just been undone.
 */
export async function revertPrototypeTokenFrame(actor) {
	if (!actor?.isOwner) return null;
	const current = actor.prototypeToken?.texture?.src;
	const displaced = actor.flags?.[SYSTEM_ID]?.[DISPLACED_KEY];
	const forgetMemo = displaced === undefined ? null : deletionEntry(`flags.${SYSTEM_ID}.${DISPLACED_KEY}`);
	if (!isPortraitFrameBake(current)) {
		if (forgetMemo) await actor.update(Object.fromEntries([forgetMemo]));
		return null;
	}
	const square = (typeof displaced === "string" && isOwnPipelineSquare(displaced, actor.img)) ? displaced : null;
	// Nothing to fall back TO is not a reason to blank the token: an empty texture draws nothing
	// at all, which is worse than the crop we were undoing.
	const portrait = square ?? actor.img ?? "";
	if (!portrait) return null;
	const update = { "prototypeToken.texture.src": portrait };
	if (forgetMemo) update[forgetMemo[0]] = forgetMemo[1];
	await actor.update(update);
	await repointPlacedTokens(actor, current, portrait);
	return portrait;
}

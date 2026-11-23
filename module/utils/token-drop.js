// Putting a resolved Actor on the canvas as a token.
//
// This is one function, and it lives here rather than inside its first caller because it now has
// two: a follower dragged from a character's Followers tab (hooks/FollowerDrop.js), and every
// Actor in an encounter deployed at once from the GM Toolkit (actors/gmtoolkit/gm-encounters-tab.js).
//
// The work is handed STRAIGHT TO CORE (`TokenLayer#_onDropActorData`), so grid snapping,
// alt-to-hide, sort order and the permission checks are core's own, exactly as if the actor had
// been dragged in from the sidebar. Two things about that method are worth knowing before calling
// it, because neither is obvious and both have already cost time:
//
//   IT READS `getMaxSort()` PER CALL, to stack each new token above the last. So a batch fired
//   with `Promise.all` reads the same value for every token in it and they land with identical
//   sort. Callers placing more than one must await them in sequence.
//
//   IT RETURNS FALSE, SILENTLY, for a point outside `canvas.dimensions.rect`, having created
//   nothing. A caller that counts what it placed has to test the point itself rather than trust
//   the call (FollowerDrop does exactly that, and for a sharper reason: its resolve step CREATES
//   an actor, so a drop in the padding around a scene would otherwise leave a new NPC in the
//   sidebar and no token anywhere).
//
// The fallback covers the day that `@internal` method changes shape: an unsnapped token at the
// cursor still beats nothing.
//
// NOTE the coordinate mismatch between the two branches, which is core's and not ours: the
// primary path treats `x`/`y` as the token's CENTRE (core offsets by half the token's size before
// snapping), while `getTokenDocument` takes them as its TOP-LEFT. On the fallback a large token
// therefore lands up and left of where it was aimed. Left as it is because the fallback only runs
// on a core that has moved the method out from under us, where guessing at the new contract is
// worth less than placing the token at all.

import { error } from "./logger.js";

/**
 * Place `actor` on the canvas at a point.
 * @param {Canvas} canvas        The canvas to place on; its `scene` is the token's parent.
 * @param {Actor}  actor         A WORLD actor. A compendium actor works, but core imports it
 *                               unconditionally rather than looking for a copy already in the
 *                               world, so callers that may hand it a pack document should resolve
 *                               that themselves first.
 * @param {{x: number, y: number}} point  The token's centre, before snapping.
 * @param {DragEvent|object} [event]  Read by core for `altKey` / `shiftKey` only, so a plain
 *                               `{altKey: false, shiftKey: false}` is a valid argument.
 * @returns {Promise<*>}
 */
export async function dropActorOnCanvas(canvas, actor, point, event) {
	const layer = canvas?.tokens;
	const payload = { type: "Actor", uuid: actor.uuid, x: point.x, y: point.y };
	if (typeof layer?._onDropActorData === "function") return layer._onDropActorData(event, payload);
	const token = await actor.getTokenDocument({ x: point.x, y: point.y }, { parent: canvas.scene });
	return token.constructor.create(token, { parent: canvas.scene });
}

/**
 * Put several actors on the canvas, one at a time (see the note at the top about `getMaxSort()`).
 * Shared by the GM Toolkit's Deploy and the Fight tab's "Start a fight", which differ only in where
 * each one goes.
 *
 * A point that is missing or outside the scene rect is MISSED before core is asked, since core
 * would decline it silently; so is a drop that throws.
 *
 * @param {Canvas} canvas
 * @param {Actor[]} actors                 world actors
 * @param {(i: number) => ({x: number, y: number}|null)} pointFor  the i-th actor's centre point
 * @returns {Promise<{dropped: Array<{i: number, actor: Actor, token: *}>, missed: string[]}>}
 *   `token` is whatever the drop answered: a TokenDocument, normally
 */
export async function placeActors(canvas, actors, pointFor) {
	const dropped = [];
	const missed = [];
	for (const [i, actor] of actors.entries()) {
		const point = pointFor(i);
		if (!point || canvas?.dimensions?.rect?.contains?.(point.x, point.y) === false) {
			missed.push(actor.name);
			continue;
		}
		try {
			dropped.push({ i, actor, token: await dropActorOnCanvas(canvas, actor, point, { altKey: false, shiftKey: false }) });
		} catch (err) {
			error("couldn't put an actor on the map", err);
			missed.push(actor.name);
		}
	}
	return { dropped, missed };
}

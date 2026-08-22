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
 * The nth of `total` deploy positions, for putting a whole group down at once.
 *
 * HERE rather than on the sheet that first wanted it: this is canvas arithmetic that knows
 * nothing about what is being deployed, and it encodes the same core gotcha the note at the top
 * of this file does — a point outside `dimensions.rect` is dropped SILENTLY — so the two belong
 * where they can be read together.
 *
 * A block one grid square apart, centred on the middle of the VIEW rather than of the scene: a
 * deploy is something you do to the bit of map in front of you, and a scene-centred cluster on a
 * large map lands the whole group off screen with nothing to say where it went.
 *
 * A block rather than a ring: one line of arithmetic, never overlapping, and it reads as a group
 * at any count. Each point is the token's CENTRE before snapping, which is what
 * `dropActorOnCanvas` takes; core snaps and clamps from there.
 *
 * Null for a square outside the scene rect, so a caller that reports what it placed knows before
 * it asks rather than after core has quietly declined.
 */
export function clusterPoint(canvas, i, total) {
	const grid = canvas?.grid?.size || 100;
	const view = canvas?.stage?.pivot ?? { x: 0, y: 0 };
	const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
	const rows = Math.max(1, Math.ceil(total / cols));
	const x = Math.round((view.x ?? 0) + ((i % cols) - (cols - 1) / 2) * grid);
	const y = Math.round((view.y ?? 0) + (Math.floor(i / cols) - (rows - 1) / 2) * grid);
	if (canvas?.dimensions?.rect?.contains?.(x, y) === false) return null;
	return { x, y };
}

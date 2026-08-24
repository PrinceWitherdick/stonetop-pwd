// Drag-a-follower-onto-a-scene support.
//
// Every card on a character's Followers tab is draggable (the character sheet writes the
// payload — see `_followerDragSnapshot`). Dropping one on the canvas puts that follower on
// the map as a token, because the follower BECOMES an actor:
//
//   1. an actor already made for this card (remembered on it as `actorUuid`), else
//   2. the NPC the follower was recruited from — "a follower is first an NPC" (Book I,
//      p.475), and that person already exists at the table, so we never clone them, else
//   3. a fresh `npc` Actor built from the card's own stats, remembered on the card so the
//      next drop places the same creature rather than another copy of them.
//
// Token creation itself is handed straight to core (`TokenLayer#_onDropActorData`), so
// grid snapping, alt-to-hide, sort order and the permission checks are core's, exactly as
// if the actor had been dragged in from the sidebar.
//
// dropCanvasData must answer synchronously, so — like the place-of-interest note hook —
// the work is fired-and-forgotten and we return false to tell core we've claimed the drop.

import { FOLLOWER_DRAG_TYPE } from "../data/follower-actor.js";
import { SYSTEM_ID } from "../system-id.js";
// The folder and what making a follower's actor MEANS (its provenance stamp and its ownership)
// are shared with the sweep that now makes them at the moment a follower is added, so a follower
// placed by a drop and one made on the sheet cannot come out as two different kinds of NPC.
import { createFollowerActor, ensureFollowerFolder } from "../actors/character/follower-actors.js";
import { dropActorOnCanvas } from "../utils/token-drop.js";

export { ensureFollowerFolder };

// dropCanvasData hook: claim only our follower payload and leave every other drop
// (tokens, tiles, journal pins, other systems') to core by returning nothing.
export function onDropFollower(canvas, data, event) {
	if (data?.type !== FOLLOWER_DRAG_TYPE) return;
	placeFollowerToken(canvas, data, event);
	return false;
}

/** The Actor a uuid points at, or null for a blank/stale/non-Actor uuid. */
async function _actorFromUuid(uuid) {
	if (!uuid) return null;
	try {
		const doc = await fromUuid(String(uuid));
		return doc?.documentName === "Actor" ? doc : null;
	} catch (_) {
		return null;
	}
}

/**
 * Remember the actor we just made on the follower card, so a second drop places the same
 * creature instead of a second copy of them. Best-effort: the drop may have been made by
 * someone who can't write to that character (an observer looking at another player's
 * sheet), and an un-remembered actor is a far smaller problem than a failed drop.
 */
async function _rememberFollowerActor(data, actor) {
	const base = String(data?.detailBase ?? "").trim();
	if (!base) return;
	try {
		const character = await fromUuid(String(data.characterUuid ?? ""));
		if (!character?.isOwner) return;
		await character.update({ [`flags.${SYSTEM_ID}.${base}.actorUuid`]: actor.uuid });
	} catch (err) {
		console.warn("Stonetop | Couldn't link the new follower actor back to its card", err);
	}
}

/**
 * The Actor for a dropped follower — found or made (see the header). Returns null when the
 * follower has no actor yet and this user isn't allowed to create one, having warned them.
 */
async function _resolveFollowerActor(data) {
	const follower = data.follower ?? {};

	const linked = await _actorFromUuid(follower.actorUuid);
	if (linked) return linked;

	// The NPC they were recruited from IS them. Other sources — a bestiary monster a
	// follower was converted from, the compendium item behind a possession-follower — are
	// provenance, not identity: that monster entry is a template for its kind, while this
	// follower is one individual with their own name, tags and hit points. Those build
	// their own actor below.
	const source = await _actorFromUuid(follower.sourceUuid);
	if (source?.type === "npc") return source;

	if (!Actor.canUserCreate(game.user)) {
		ui.notifications.warn(`You don't have permission to create actors, so ${follower.name || "this follower"} can't be placed on the map. Ask your GM to place them.`);
		return null;
	}
	// Reaching this at all is now the exception rather than the rule: a follower normally gained
	// their actor the moment they were added to the sheet. What still lands here is a card whose
	// actor was deliberately deleted (the sweep leaves those alone — see answeredFor), and one
	// belonging to a character nobody could write to when it was added.
	//
	// The character document, not just its uuid, because the new actor takes ITS ownership: a
	// follower placed by the GM must still open for the player whose follower it is.
	const character = await _actorFromUuid(data.characterUuid);
	const created = await createFollowerActor(
		{ ftype: data.ftype, slug: data.slug, follower },
		character ?? { uuid: data.characterUuid ?? null, ownership: {} },
	);
	if (created) {
		await _rememberFollowerActor(data, created);
		ui.notifications.info(`Created the NPC “${created.name}” from ${data.characterName || "this character"}'s follower.`);
	}
	return created ?? null;
}

/**
 * Resolve the follower's actor and put its token down. Core sets data.x/data.y to scene
 * coordinates at the cursor before firing the hook. Exported (and awaitable) so the drop
 * can be tested without racing the hook's fire-and-forget call.
 */
export async function placeFollowerToken(canvas, data, event) {
	if (!canvas?.scene) return;
	if (!game.user.can("TOKEN_CREATE")) {
		ui.notifications.warn("You don't have permission to create tokens on this scene.");
		return;
	}
	// Refuse a drop outside the scene rect HERE, not just at the far end. Core's own
	// path checks the same thing (TokenLayer#_onDropActorData bails on it before it so
	// much as looks at the actor), but by then _resolveFollowerActor has already run —
	// and it CREATES. A drop in the padding around a scene would otherwise leave a new
	// NPC in the sidebar, an actorUuid written back onto the card claiming they are
	// placed, and no token anywhere. Guarded so a canvas without dimensions (the tests'
	// fake, an uninitialised scene) is left to core as before.
	if (canvas.dimensions?.rect && !canvas.dimensions.rect.contains(data.x, data.y)) return;
	try {
		const actor = await _resolveFollowerActor(data);
		if (!actor) return;
		await dropActorOnCanvas(canvas, actor, data, event);
	} catch (err) {
		console.error("Stonetop | Failed to place a follower on the canvas", err);
		ui.notifications.error("Couldn't place that follower on the map (see the console for details).");
	}
}

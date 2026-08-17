import { SYSTEM_ID } from "../system-id.js";
import { deletionEntry } from "./foundry-compat.js";
import { resolvedFlags } from "../actors/character/StonetopFlags.js";
import { isActorRow, personRowActor } from "../actors/steading/steading-people.js";
import { STEADING_DEFAULTS } from "../actors/steading/StonetopSteading.js";
import { readRosterPortrait, rosterPortraitListPath, writeRosterPortrait } from "../actors/character/roster-portraits.js";
import { normalizeFrame, documentPortraitFrame } from "./portrait-frame.js";
import { tokenFollowsPortrait } from "./portrait-token-frame.js";

/**
 * Where a chosen portrait frame is stored, per kind of "person".
 *
 * The editor knows no flag paths. It is handed one of these handles and can only ask four things
 * of it: may I write, what image am I framing, what is stored, and store this. That is what lets
 * one dialog serve an NPC document, a follower card living in a flag, a legacy steading text row
 * living in a flag ARRAY, and a PC, without any of them leaking into the editor.
 *
 * ⚠ Every property read uses BRACKETS: `flags?.["stonetop-pwd"]?.x`. The package id is hyphenated,
 * so a dotted `flags.stonetop-pwd.x` parses as a subtraction and fails at runtime with
 * "pwd is not defined". Nothing lints it. Dotted paths are fine inside string literals, which is
 * why every one of those is built from SYSTEM_ID rather than written out.
 *
 * ⚠ The stored key is `portraitFrame` and its path key is `src`, never `img` — see the warning in
 * module/utils/portrait-frame.js.
 *
 * CLEARING IS ASYMMETRIC BETWEEN THE THREE, and the asymmetry is not cosmetic:
 *  - an object flag MERGES, so writing a smaller object never drops a key. Clearing needs
 *    `unsetFlag` (or an explicit `-=` in an update);
 *  - a flag ARRAY is replaced wholesale, because mergeObject treats arrays as atomic values, so
 *    a plain `delete` on a row object is both correct and the only thing that works.
 * Do not "unify" them.
 */

/**
 * The one update a GALLERY PICK makes on an Actor: the picture, the square that frames it, and the
 * square as the token's own file.
 *
 * All three land together because they are one choice. The gallery commits the WHOLE illustration
 * (PeopleGalleryDialog#_choose explains why), and on its own that would be a regression in two
 * places at once — the small round surfaces would fall back to a blind top slice of a standing
 * figure, and `_syncPrototypeTokenImage` would drag a following token onto that same tall picture.
 * The frame fixes the first and the square file fixes the second, which the canvas needs as a file
 * because a token texture carries no crop rect (see portrait-token-frame.js).
 *
 * THE FRAME IS REPLACED, NEVER MERGED, and cleared when the new picture brings none: a rect
 * measured on the portrait being replaced describes a picture this actor no longer wears. It would
 * not misapply — the frame's own `src` stamp neutralises it — but the dead data would sit there
 * with nothing left to ever clear it.
 *
 * THE TOKEN MOVES ONLY IF IT WAS FOLLOWING, under the same four-state rule everything else uses.
 * Set explicitly rather than left to `_syncPrototypeTokenImage`, which would otherwise put the
 * whole illustration there; that sync stands down as soon as an update names the key itself.
 *
 * @param {Actor}  actor
 * @param {string} src            the picture to wear
 * @param {object} [pick]         what the gallery tile carried: `{frame, square}`, both null for
 *                                a browsed file with no hand-cut square behind it
 */
export function actorPortraitPickUpdate(actor, src, { frame = null, square = "" } = {}) {
	const update = { img: src ?? "" };
	const normalized = normalizeFrame(frame);
	if (normalized) {
		update[`flags.${SYSTEM_ID}.portraitFrame`] = normalized;
	} else {
		// deletionEntry, not a hard-coded `-=`: v14 still honours the legacy prefix but logs a
		// deprecation for every key it sees.
		const [key, value] = deletionEntry(`flags.${SYSTEM_ID}.portraitFrame`);
		update[key] = value;
	}
	if (square && actor?.prototypeToken?.texture?.src !== undefined && tokenFollowsPortrait(actor)) {
		update["prototypeToken.texture.src"] = square;
	}
	return update;
}

/**
 * The one update a GALLERY PICK makes on a follower CARD — the flag counterpart to
 * actorPortraitPickUpdate above, and here for the same reason: the picture and the rect it crops
 * to are one choice, so they move together or the 75px card falls back to a blind top slice of a
 * standing figure.
 *
 * NO TOKEN HALF. A card is a flag, not a document, so there is no prototype token to move; the
 * token a follower gets when it is dropped on a scene is minted from these two.
 *
 * `base` is `_followerDetailBase(ftype, slug)` — see followerFrameHandle, which owns the same two
 * paths for the framing side. Stated here rather than at the sheet's call site so the follower
 * store has ONE place that knows where a card keeps its face.
 */
export function followerPortraitPickUpdate(base, src, { frame = null } = {}) {
	const normalized = normalizeFrame(frame);
	// A pick with no frame behind it — a browsed file, or a gallery tile with no hand-cut square
	// — DELETES the old rect rather than nulling it, for the reason the clear below states and
	// under the same rule actorPortraitPickUpdate follows: one key, one clearing convention.
	return Object.fromEntries([
		[`flags.${SYSTEM_ID}.${base}.img`, src ?? ""],
		normalized
			? [`flags.${SYSTEM_ID}.${base}.portraitFrame`, normalized]
			: deletionEntry(`flags.${SYSTEM_ID}.${base}.portraitFrame`),
	]);
}

/**
 * And the clear: back to art-less, with the frame DELETED rather than nulled.
 *
 * Deleted because a rect measured on the picture being dropped describes one this card no longer
 * wears. It would not misapply — the frame's own `src` stamp neutralises it against a different
 * picture — but the dead data would sit there with nothing left to ever clear it. Via
 * deletionEntry so v14 gets a ForcedDeletion rather than a deprecated `-=` key.
 *
 * Which is precisely a pick of nothing: the pick above already takes the delete branch whenever no
 * frame comes with the picture, so this is that call rather than a second spelling of it — one key,
 * one clearing convention, and now one piece of code holding it.
 */
export function followerPortraitClearUpdate(base) {
	return followerPortraitPickUpdate(base, "");
}

/**
 * An Actor's own portrait: NPCs, PCs, monsters, and every actor-backed steading roster row.
 *
 * Stored at `flags["stonetop-pwd"].portraitFrame`. A flag rather than a data-model field, so
 * there is nothing to migrate and every actor type gets it for free.
 */
export function actorFrameHandle(actor, { editable = null } = {}) {
	if (!actor) return null;
	return {
		canWrite: editable ?? !!actor.isOwner,
		// The document itself, for the one consumer that needs more than a rect: the Tokenizer
		// bridge, which tokenizes an ACTOR. A follower card has no document, which is exactly
		// why this is a property of the actor handle rather than of every handle.
		actor,
		get img() { return actor.img ?? ""; },
		read: () => documentPortraitFrame(actor),
		// A fresh object fully replaces the old one despite the merge, because the shape is
		// exactly { src: primitive, rect: Array } and mergeObject treats an Array as an atomic
		// value. IF A THIRD KEY IS EVER ADDED, that stops being true and this needs an unset first.
		//
		// The bake afterwards is what carries the crop onto the MAP, which a rect on a flag can
		// never reach — see portrait-token-frame.js. Deliberately AFTER the flag, and deliberately
		// unable to fail the write: the frame is the source of truth and every other surface is
		// already correct once it lands, so a world with no upload rights simply gets an
		// uncropped token rather than an unsaved frame.
		write: async (frame) => {
			const normalized = normalizeFrame(frame);
			await actor.setFlag(SYSTEM_ID, "portraitFrame", normalized);
			const { syncPrototypeTokenToFrame } = await import("./portrait-token-frame.js");
			await syncPrototypeTokenToFrame(actor, normalized);
		},
		// Guarded, because unsetFlag on a missing parent inserts an empty object rather than
		// doing nothing. The token reverts only if it was showing one of our bakes, so clearing
		// a frame undoes what framing did and nothing else.
		clear: async () => {
			if (actor.flags?.[SYSTEM_ID]?.portraitFrame !== undefined) {
				await actor.unsetFlag(SYSTEM_ID, "portraitFrame");
			}
			const { revertPrototypeTokenFrame } = await import("./portrait-token-frame.js");
			await revertPrototypeTokenFrame(actor);
		}
	};
}

/**
 * A follower card: animal companion, crew, initiate, beast or custom.
 *
 * Stored at `flags["stonetop-pwd"].<detailBase>.portraitFrame`, beside the `img` the card already
 * keeps there. A follower is not a document, which is exactly why the frame had to be storable
 * against a flag as well as an actor.
 *
 * `base` is `_followerDetailBase(ftype, slug)`: `animalCompanion.details`, `crew.details`,
 * `initiateDetails.{slug}`, `beastDetails.{slug}` or `customFollowers.{slug}`. Slugs are pack
 * slugs or a randomID, never containing a dot, so the dotted flag path is safe.
 */
export function followerFrameHandle(actor, base, { editable = false } = {}) {
	if (!actor || !base) return null;
	// resolvedFlags rather than actor.flags[SYSTEM_ID], so a world that has not been cut over
	// from a legacy flag scope still resolves its followers.
	const detail = () => foundry.utils.getProperty(resolvedFlags(actor), base) ?? {};
	return {
		canWrite: !!editable,
		get img() { return String(detail().img ?? "").trim(); },
		read: () => detail().portraitFrame ?? null,
		write: (frame) => actor.setFlag(SYSTEM_ID, `${base}.portraitFrame`, normalizeFrame(frame)),
		// An explicit deletion through update() rather than unsetFlag: it touches the parent
		// anyway, so no phantom `initiateDetails.acolyte: {}` can be inserted for a follower that
		// never had a frame. Guarded so clearing an unframed follower is a genuine no-op.
		// Via deletionEntry so v14 gets a ForcedDeletion instead of a deprecated `-=` key.
		clear: () => (detail().portraitFrame === undefined
			? Promise.resolve()
			: actor.update(Object.fromEntries([deletionEntry(`flags.${SYSTEM_ID}.${base}.portraitFrame`)])))
	};
}

/**
 * One member of a group follower's ROSTER: a named crew individual, an anonymous crew member, or
 * a member of a custom group follower.
 *
 * Like a legacy steading row and unlike a follower card, these live in flag ARRAYS, so the whole
 * array is rewritten per change — see the warning at the top of actors/character/roster-portraits.js,
 * which owns that rule and the three stores behind it. This handle only translates it into the
 * four questions the framer asks.
 *
 * `ref` is `{kind, slug, index}`, straight off the avatar's dataset.
 */
export function rosterMemberFrameHandle(actor, { kind, slug = "", index = 0 } = {}, { editable = false } = {}) {
	if (!actor || !rosterPortraitListPath(kind, slug)) return null;
	const stored = () => readRosterPortrait(actor, kind, slug, index);
	return {
		canWrite: !!editable,
		get img() { return stored().img; },
		read: () => stored().portraitFrame,
		write: (frame) => writeRosterPortrait(actor, kind, slug, index, { portraitFrame: frame }),
		// `undefined` is the delete signal there, and a plain delete is what an array row needs —
		// the same asymmetry the legacy row handle below relies on. Guarded so clearing an
		// unframed member is a genuine no-op rather than a pointless whole-array rewrite.
		clear: () => (stored().portraitFrame == null
			? Promise.resolve()
			: writeRosterPortrait(actor, kind, slug, index, { portraitFrame: undefined })),
	};
}

/**
 * The `residents`/`neighbors` rows as they should be READ.
 *
 * Falls back to STEADING_DEFAULTS exactly as the sheet's own photo editor does. Reading only the
 * flag looks right and is wrong: a world that has never written this list still SHOWS the default
 * rows, so a caller working from `[]` would decide there was no row here and quietly offer nothing.
 */
function legacyPersonRows(steading, list) {
	const stored = steading?._flags?.[list];
	const source = Array.isArray(stored) ? stored : STEADING_DEFAULTS[list];
	return Array.isArray(source) ? source : [];
}

/**
 * Change one legacy steading person row in place and store the list back.
 *
 * THE WHOLE ARRAY IS REWRITTEN, and that is the point rather than a cost: setFlags merges, but
 * mergeObject and diffObject treat an ARRAY as an atomic value, so the list is replaced wholesale
 * — which is what makes a plain `delete` on a row key actually disappear. (An object flag is the
 * exact opposite: there a smaller object never drops a key and clearing needs `-=`. Do not
 * "unify" them — see the header.)
 *
 * An actor-backed row renders from the NPC's own img, so anything written onto the array row would
 * be an invisible no-op; those are refused here so no caller has to remember to branch first.
 *
 * Shared with the steading sheet's own photo editor, which writes `img` and `portraitFrame`
 * together in one pass: it is one gesture, and one write, so the rule about how this list is
 * stored is stated once for both.
 */
export async function saveLegacyPersonRow(steading, list, index, mutate) {
	const arr = foundry.utils.deepClone(legacyPersonRows(steading, list));
	if (!arr[index] || isActorRow(arr[index])) return false;
	mutate(arr[index]);
	await steading.setFlags({ [list]: arr });
	return true;
}

/**
 * A legacy steading person row: plain text in the `residents`/`neighbors` flag arrays, from
 * before those rows became NPC actors.
 *
 * Stored as a `portraitFrame` key on the row object itself.
 */
export function legacyRowFrameHandle(steading, list, index, { editable = false } = {}) {
	const row = () => legacyPersonRows(steading, list)[index] ?? null;
	const save = (mutate) => saveLegacyPersonRow(steading, list, index, mutate);
	return {
		canWrite: !!editable,
		get img() { return String(row()?.img ?? "").trim(); },
		read: () => row()?.portraitFrame ?? null,
		write: (frame) => save((r) => { r.portraitFrame = normalizeFrame(frame); }),
		// A PLAIN delete, and `-=` would be WRONG here — the exact opposite of the object-flag
		// rule above. saveLegacyPersonRow owns why that works.
		clear: () => save((r) => { delete r.portraitFrame; })
	};
}

/**
 * The steading roster's one handle: an actor row writes to its NPC, a legacy row to the array.
 *
 * Deliberately synchronous, so it can be called from a click handler that also builds UI. The
 * actor comes from `personRowActor` — literally the function the roster's own resolve uses — so
 * the two cannot disagree about which document backs a row.
 */
export function personFrameHandle(steading, list, index, { editable = false } = {}) {
	const stored = steading?._flags?.[list];
	const rows = Array.isArray(stored) ? stored : (STEADING_DEFAULTS[list] ?? []);
	const row = rows[index];
	if (!row) return null;
	if (!isActorRow(row)) return legacyRowFrameHandle(steading, list, index, { editable });
	const npc = personRowActor(row);
	// actorFrameHandle gates on the NPC's own ownership, which is stricter than the steading's
	// editability on purpose: roster NPCs are seeded at OBSERVER, so a player who may edit the
	// steading would otherwise be offered a control whose save the server refuses.
	return npc ? actorFrameHandle(npc) : null;
}

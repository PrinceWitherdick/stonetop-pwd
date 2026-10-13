// EVERY PLAYER MAY READ EVERY CHARACTER SHEET.
//
// Stonetop is played at one table: the playbooks are no secret, and a good share of the moves reach
// across to another PC's sheet (Aid, the Healer's Arts, a follower handed over). So a character is
// OBSERVER to the whole table by default, and its owner and the GM are still the only ones who can
// change it. The GM's world switch `characterSheetsShared` (module/settings.js) takes that away again
// for a table that would rather keep them private.
//
// The switch moves `ownership.default`, which is core's own field and which the GM may also set by
// hand in core's Configure Ownership window. A hand-set level is the GM's decision and outranks the
// switch, so the `sharedWithTable` flag marks the characters whose default level is the SWITCH'S to
// move, and only those are ever touched:
//   - A new character is flagged as it is made, at OBSERVER or NONE as the switch stands
//     (StonetopActor#_preCreate), unless the creation data already gave it a default level.
//   - The characters a world had before this existed are flagged once, by the first sweep that runs
//     (`sharedSheetAdoptions`): those still at NONE, which is core's default and so no decision
//     anyone can be shown to have made. One already at another level is the GM's.
//   - On every load, and whenever the switch flips, the primary GM moves every flagged character to
//     where the switch says (_reconcileSharedCharacterSheets in hooks/Ready.js).
//   - Any change to the default level that the switch did not make is the GM's own, and drops the
//     flag in the same write (`sharedSheetReleaseEntry`, from StonetopActor#_preUpdate). From then
//     on the switch leaves that character alone, whichever way the GM moved it.
//
// Hiding what is the owner's alone on a sheet (a love letter not yet read, say) is the sheet's job,
// asked of `actor.isOwner`. This only decides who may open it.

import { STONETOP_SCOPE } from "./StonetopFlags.js";
import { deletionEntry, ownershipLevels } from "../../utils/foundry-compat.js";

/** The flag on a character whose default level the switch moves. */
export const SHARED_WITH_TABLE_FLAG = "sharedWithTable";

/** Fired on every client by the switch's `onChange`; the primary GM's handler does the writing. */
export const CHARACTER_SHEETS_SHARED_HOOK = "stonetopCharacterSheetsShared";

/** The update option the switch's own writes carry, so they are not taken for the GM's hand. */
export const SHARED_SHEETS_UPDATE_OPTION = "stonetopSharedSheets";

/** The once-only sweep that flags the characters a world had before the switch existed. */
export const SHARED_SHEETS_ADOPTION_SWEEP = "sharedCharacterSheetsAdopted";

const FLAG_PATH = `flags.${STONETOP_SCOPE}.${SHARED_WITH_TABLE_FLAG}`;

function isFlagged(actor) {
	return actor?.flags?.[STONETOP_SCOPE]?.[SHARED_WITH_TABLE_FLAG] !== undefined;
}

/** The default level the switch wants a flagged character at. */
export function sharedSheetLevel(shared) {
	const { NONE, OBSERVER } = ownershipLevels();
	return shared ? OBSERVER : NONE;
}

/** A value with any v14 data-field operator (Configure Ownership sends a ForcedReplacement) unwrapped. */
function unwrapOperator(value) {
	const operator = globalThis.foundry?.data?.operators?.DataFieldOperator;
	return operator?.get ? operator.get(value) : value;
}

/**
 * The `updateSource` entries that hand a character being made to the switch, or none.
 *
 * Only for a character, and only when the creation data said nothing about the default level: a
 * duplicate or an import carries the level (and the flag) it was made with.
 *
 * @param {string} type      The new actor's type.
 * @param {object} data      The creation data, as `_preCreate` receives it.
 * @param {boolean} shared   Whether the GM's switch is on.
 * @returns {object}         Dotted-key entries for `updateSource`; empty when nothing applies.
 */
export function sharedSheetCreateStamp(type, data, shared) {
	if (type !== "character") return {};
	if (foundry.utils.getProperty(data, "ownership.default") !== undefined) return {};
	return { "ownership.default": sharedSheetLevel(shared), [FLAG_PATH]: true };
}

/**
 * The deletion entry that takes a character away from the switch, when this update moves its
 * default level and is not the switch's own write. Null when the update leaves it to the switch.
 *
 * Read from both shapes an update arrives in: a dotted `ownership.default`, and the whole
 * `ownership` object Configure Ownership sends. Saving that window without touching the default
 * sends the same level back, and that is no decision, so only a CHANGE counts.
 *
 * @param {Actor} actor       The character about to be updated.
 * @param {object} changed    The update, as `_preUpdate` receives it.
 * @param {object} [options]  The update's options.
 * @returns {[string, *]|null}  A dotted `[key, value]` entry to add to the update, or null.
 */
export function sharedSheetReleaseEntry(actor, changed, options) {
	if (actor?.type !== "character" || !isFlagged(actor)) return null;
	if (options?.[SHARED_SHEETS_UPDATE_OPTION]) return null;
	const dotted = changed?.["ownership.default"];
	const level = unwrapOperator(dotted !== undefined ? dotted : unwrapOperator(changed?.ownership)?.default);
	if (level === undefined) return null;
	const before = actor.ownership?.default ?? ownershipLevels().NONE;
	return level === before ? null : deletionEntry(FLAG_PATH);
}

/**
 * The ownership a character's follower NPC takes from it: the character's, less the default level
 * the switch keeps on it. A follower is the NPC's own document and the switch only ever moves
 * characters, so a default it gave would sit on the follower for good, still there after the GM
 * switched sheets private. A default the GM set on the character by hand carries over.
 *
 * @param {Actor|object} character
 * @returns {object}  A fresh ownership object to give the NPC.
 */
export function followerOwnershipFrom(character) {
	const ownership = foundry.utils.deepClone(character?.ownership ?? {});
	if (isFlagged(character)) delete ownership.default;
	return ownership;
}

/**
 * The characters a world had before the switch existed that are now the switch's: every unflagged
 * one still at NONE. Run ONCE per world (SHARED_SHEETS_ADOPTION_SWEEP): after that an unflagged
 * character at NONE is one the GM hid by hand, and stays hidden.
 *
 * @param {Iterable<Actor>} actors   The world's actors.
 * @returns {Actor[]}
 */
export function sharedSheetAdoptions(actors) {
	const { NONE } = ownershipLevels();
	const adopt = [];
	for (const actor of actors ?? []) {
		if (actor?.type !== "character" || isFlagged(actor)) continue;
		if ((actor.ownership?.default ?? NONE) === NONE) adopt.push(actor);
	}
	return adopt;
}

/**
 * The flagged characters not at the level the switch wants, which is the level to give each.
 *
 * @param {Iterable<Actor>} actors   The world's actors.
 * @param {boolean} shared           Whether the GM's switch is on.
 * @returns {{actors: Actor[], level: number}}
 */
export function sharedSheetChanges(actors, shared) {
	const { NONE } = ownershipLevels();
	const level = sharedSheetLevel(shared);
	const move = [];
	for (const actor of actors ?? []) {
		if (actor?.type !== "character" || !isFlagged(actor)) continue;
		if ((actor.ownership?.default ?? NONE) !== level) move.push(actor);
	}
	return { actors: move, level };
}

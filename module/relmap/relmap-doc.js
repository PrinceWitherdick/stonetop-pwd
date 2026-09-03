// Where a relationship map LIVES: one JournalEntry per map, in a folder of its own.
//
// WHY A JOURNAL ENTRY AND NOT A WORLD SETTING. The expedition log is a world setting and this map
// cannot be, because the table decided every player edits these. `Setting.canUserCreate` requires
// SETTINGS_MODIFY, which is an assistant-GM right, so a player writing a world setting is refused
// by the server no matter what the window lets them click. A document they OWN is different:
// JournalEntry inherits `update: "OWNER"` from the base document, so an entry whose default
// ownership is OWNER can be written by anybody at the table — and the server broadcasts the change
// to every other client for free, which is the whole live-repaint story with no socket of ours.
//
// THE ONE ASYMMETRY, and it is a real one: CREATING a JournalEntry needs JOURNAL_CREATE, which is
// TRUSTED by default. So a plain player can edit every map in the world and cannot make a new one.
// That is gated honestly (`canCreateRelationshipMap`) rather than papered over by quietly widening
// the permission — journal creation reaches far beyond this feature, and a system that grants it
// behind the GM's back to ship a mind map has overstepped.

import { SYSTEM_ID } from "../system-id.js";
import { RELMAP_FLAG, emptyGraph, normalizeGraph } from "./relmap-store.js";

/** The folder every map is filed under. Its own colour: not the Chronicle's, and not one of the
 * seeded gazetteer tints, whose signature-checked scheme is a different lane entirely. */
export const RELMAP_FOLDER_NAME = "Relationship Maps";
export const RELMAP_FOLDER_COLOR = "#7E6BA8";

/** The registered sheet id stamped onto every map so the sidebar opens the board and not a blank
 * prose entry. Kept beside the creator that writes it; the registration reads the same constant. */
export const RELMAP_SHEET_CLASS = `${SYSTEM_ID}.StonetopRelationshipMapSheet`;

/**
 * The maps folder if this world has one, or null.
 *
 * READ-ONLY, and separate from `ensure` for the reason chronicle-journals.js gives: a player
 * opening a map must never conjure a folder just by asking. `Folder.canUserCreate` is role-gated
 * on its own, so for most of the table the create would fail anyway, noisily, in the middle of
 * something else.
 */
export function findRelationshipMapFolder() {
	return (game.folders?.contents ?? [])
		.find(f => f.type === "JournalEntry" && f.name === RELMAP_FOLDER_NAME) ?? null;
}

/**
 * Find or create the maps folder.
 *
 * Returns null rather than throwing when this user may not create folders, so the caller can file
 * the map at the root instead. A map in the wrong place is a tidiness problem; a thrown error in
 * the middle of "add a map" is a broken button.
 */
export async function ensureRelationshipMapFolder() {
	const existing = findRelationshipMapFolder();
	if (existing) return existing;
	if (!globalThis.Folder?.canUserCreate?.(game.user)) return null;
	return await Folder.create({
		name: RELMAP_FOLDER_NAME, type: "JournalEntry", color: RELMAP_FOLDER_COLOR,
	}) ?? null;
}

/**
 * Every relationship map in this world.
 *
 * Found by the FLAG, not by folder membership. A GM who drags a map into another folder, or renames
 * the folder, or files it beside the front it belongs to, has not stopped it being a map — and a
 * lookup that went by folder would quietly lose it. The folder is filing, the flag is identity.
 */
export function listRelationshipMaps() {
	return (game.journal?.contents ?? [])
		.filter(entry => !!entry.getFlag?.(SYSTEM_ID, RELMAP_FLAG))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** One map by id, or null when it is not one of ours. */
export function getRelationshipMap(id) {
	const entry = game.journal?.get?.(id) ?? null;
	return entry?.getFlag?.(SYSTEM_ID, RELMAP_FLAG) ? entry : null;
}

/**
 * How many people are on a map.
 *
 * Off the RAW flag rather than through `readGraph`, which builds a fresh object and sanitizes
 * every node and every edge to get there. A count needs none of that, and this is asked for
 * every map in the world on every render of the GM Toolkit tab that lists them.
 */
export function relationshipMapSize(entry) {
	return Object.keys(entry?.getFlag?.(SYSTEM_ID, RELMAP_FLAG)?.nodes ?? {}).length;
}

/** May this user make a new map? Editing needs only OWNER; creating needs TRUSTED. */
export function canCreateRelationshipMap() {
	// Through globalThis, because these document classes are globals that may simply not be there:
	// this is read while a sheet builds its context, which happens on clients and in suites where
	// the world is only half up, and a bare reference throws a ReferenceError rather than answering
	// no. Nobody can create a map before JournalEntry exists, so absent means false.
	return !!globalThis.JournalEntry?.canUserCreate?.(game.user);
}

/** May this user change THIS map? The question every control on the board is gated on. */
export function canEditRelationshipMap(entry) {
	return !!entry?.isOwner;
}

/**
 * Make a new map, owned by everybody.
 *
 * ONE create call carrying all four things: the graph, the ownership that lets the table edit it,
 * the sheet class that makes the sidebar row open the board, and the folder. Written together
 * because a map that arrives without any one of them is subtly broken in a way nobody notices until
 * a player tries to move a portrait.
 */
export async function createRelationshipMap(name) {
	if (!canCreateRelationshipMap()) return null;
	const folder = await ensureRelationshipMapFolder();
	return await globalThis.JournalEntry.create({
		name: name || RELMAP_FOLDER_NAME,
		folder: folder?.id ?? null,
		ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
		flags: {
			core: { sheetClass: RELMAP_SHEET_CLASS },
			[SYSTEM_ID]: { [RELMAP_FLAG]: emptyGraph() },
		},
	}) ?? null;
}

/** A map's graph, normalized. Never trusts what it reads: see `normalizeGraph`. */
export function readGraph(entry) {
	return normalizeGraph(entry?.getFlag?.(SYSTEM_ID, RELMAP_FLAG));
}

/**
 * Apply one patch built by relmap-store.js.
 *
 * Everything funnels through here so the failure has one voice. A write can fail for a reason the
 * reader can act on (their ownership was lowered while the window was open) and for reasons they
 * cannot, and either way the board they are looking at is now out of step with the world — so the
 * caller is told, rather than left believing the drag landed.
 */
export async function applyPatch(entry, patch) {
	if (!entry || !patch || !Object.keys(patch).length) return false;
	await entry.update(patch);
	return true;
}

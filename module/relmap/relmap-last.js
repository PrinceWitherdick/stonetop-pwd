// Which board comes up when the reader did not say which.
//
// THE MACRO ASKS NOBODY. Slot 8 used to count the world's maps and, finding more than one, put a
// picker in front of the reader: "Relationship maps: which?" That is a question the button already
// answered by being pressed. A table has one map it lives on, opens it forty times a session, and
// picks the same row out of that list every time. So the macro opens the board this client was last
// looking at, and the picker is gone (the sidebar and the map's own page strip are still there for
// going somewhere else).
//
// PER CLIENT, NEVER PER WORLD. Which board somebody is reading is theirs, exactly like the page
// they are on inside it and the corner they have zoomed into: a GM opening the Millers must not
// move where a player's macro lands. So this is a client-scoped setting, and no document is
// written for it.
//
// ⚠ NESTED UNDER THE WORLD ID, which every client setting here has to do for itself: they live in
// browser localStorage under `namespace.key` alone, with no world in the path. A flat record would
// hand this world an entry id belonging to a different one. Nothing would misread it (the id simply
// resolves to no map, and the fallbacks take over), but "the map I had open" would then mean the
// last map opened in ANY world in this browser, which is not what it says. Same `worldKey()` as
// `walkthroughResume` and `mapPinNamesLocal`.
//
// THE TWO FALLBACKS, for a client that has not opened one yet:
//  • The party's own board, wherever it is. It is the board seeded with the player characters
//    (relmap/relmap-party.js), so on a young world it is the one with anybody on it.
//  • Failing that, the first map, on its first page.

import { getObjectSetting, setSetting, worldKey } from "../settings.js";
import { getMapPage, getPartyPage, listRelationshipMaps } from "./relmap-doc.js";

export const RELMAP_LAST_SETTING = "lastRelationshipBoard";

/** What this client last had open in THIS world, as `{ entryId, pageId }`, or null. */
export function getLastBoard() {
	const record = getObjectSetting(RELMAP_LAST_SETTING)[worldKey()];
	const entryId = typeof record?.entryId === "string" ? record.entryId : "";
	if (!entryId) return null;
	const pageId = typeof record?.pageId === "string" && record.pageId ? record.pageId : null;
	return { entryId, pageId };
}

/**
 * Record the board this reader is on. Called from every render of the window, so it covers opening
 * a map, switching page inside it, and a window restored across a reload.
 *
 * THE WRITE IS SKIPPED WHEN NOTHING MOVED, which is most calls: a board re-renders for reasons that
 * have nothing to do with the reader going anywhere (a page added at the far end of the table, a
 * portrait dropped, a name rewritten). The same bargain `patchWalkthroughResume` strikes, and for
 * the same reason: a setting write is a localStorage write plus an onChange, per repaint.
 *
 * Silent by design. Failing to remember where somebody was is not worth a notification on top of a
 * board that has opened perfectly well.
 */
export function rememberBoard(entryId, pageId = null) {
	const id = typeof entryId === "string" ? entryId : "";
	if (!id) return null;
	const page = typeof pageId === "string" && pageId ? pageId : null;
	const was = getLastBoard();
	if (was?.entryId === id && was.pageId === page) return null;
	const all = { ...getObjectSetting(RELMAP_LAST_SETTING) };
	all[worldKey()] = { entryId: id, pageId: page };
	try {
		return Promise.resolve(setSetting(RELMAP_LAST_SETTING, all))
			.catch(err => console.error("Stonetop | remembering the open relationship board failed", err));
	} catch (err) {
		console.error("Stonetop | remembering the open relationship board failed", err);
		return null;
	}
}

/**
 * Which map, and which of its boards, an unasked open lands on: `{ entry, pageId }`, or null when
 * the world has no maps at all (the caller offers to make the first one).
 *
 * A REMEMBERED PAGE IS CHECKED BEFORE IT IS USED, and a stale one falls back to that map's first
 * board rather than throwing the whole record away. Pages are deleted under an open window by
 * anyone at the table, so "the map I was on, at a page that is no longer there" is an ordinary
 * thing to be holding.
 */
export function defaultBoard(maps = listRelationshipMaps()) {
	if (!maps?.length) return null;
	const last = getLastBoard();
	if (last) {
		const entry = maps.find(map => map.id === last.entryId);
		if (entry) {
			const pageId = last.pageId && getMapPage(entry, last.pageId) ? last.pageId : null;
			return { entry, pageId };
		}
	}
	for (const entry of maps) {
		const party = getPartyPage(entry);
		if (party) return { entry, pageId: party.id };
	}
	return { entry: maps[0], pageId: null };
}

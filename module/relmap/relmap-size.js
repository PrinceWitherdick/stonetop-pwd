// How big the writing on a line is set, remembered for the next line this reader draws.
//
// WHY A LINE CARRIES ITS OWN SIZE AT ALL. Everything else the tie bar asks about a line is what
// the line MEANS: what it says, what colour it is, which way it is read, whether the reader broke
// the stroke. This one is about how loud it says it. A board of forty people is read zoomed in, a
// caption is twelve pixels of type on a sheet that grows with its cast, and the two lines on that
// board a table actually cares about (the betrayal, the debt) sit in the same whisper as the
// thirty-eight that only say who lives next door. So the size is a mark the reader makes, the same
// as the colour, and it is stored on the line where everybody at the table sees it.
//
// ⚠ THE NUMBER LIVES ON THE LINE AND THIS IS ONLY WHAT COMES NEXT. Nothing here is read while a
// board is painted: the size a line is drawn at is the size stored on it (`readSize`), and a line
// with none is drawn in whatever the sheet sets. What this file remembers is the answer to a
// different question, asked only when a line is BORN: how big did this reader last want a caption?
//
// PER CLIENT, NEVER PER WORLD, and never on the map. A reader on a screen magnifier who has settled
// on eighteen-pixel captions wants that on the next line they draw and on every board they open;
// the GM two seats away, reading at 1:1 on a big monitor, wants nothing of the kind. Stored on the
// map it would be one table arguing over one number. So it is a client setting, no document is
// written for it, and it says nothing about the map at all.
//
// ⚠ AND IT IS NOT NESTED UNDER THE WORLD ID, which every other client setting in this feature has
// to do for itself (see relmap/relmap-last.js). The reason those nest is that they hold an ID:
// "the map I had open" means nothing in a world that has no such entry, so a flat record would
// hand this world a stranger's id. This holds a NUMBER, and how big a reader likes their type is
// the same fact in every world they open. Flat on purpose.
//
// A SIZE IS NEVER PUT ON A LINE THAT ALREADY EXISTS BY THIS. Choosing eighteen changes the line the
// bar is open over, and stamps the ones drawn after it. It does not walk the board rewriting what
// the table has already set, which would be one reader silently editing everybody else's map.

import { getSetting, setSetting } from "../settings.js";
import { RELMAP_SIZE_NONE, readSize } from "./relmap-store.js";

export const RELMAP_SIZE_SETTING = "lastCaptionSize";

/**
 * How big this reader last asked a caption to be, or `RELMAP_SIZE_NONE` for "they never said".
 *
 * ⚠ THROUGH THE SAME GATE THE DOCUMENT GOES THROUGH. This is browser storage any script in the
 * page could have written, and what it feeds is a field on a shared map, so a nonsense number here
 * would be a nonsense number on everybody's board. `readSize` is the one sanitiser and this is not
 * allowed to be a second one.
 *
 * Tolerant of an absent setting rather than throwing, for the reason `getObjectSetting` is: a key
 * that is not registered is an older build or a unit test, and neither is a reason to take the
 * board down.
 */
export function getLastSize() {
	try {
		return readSize(getSetting(RELMAP_SIZE_SETTING));
	} catch (_) {
		return RELMAP_SIZE_NONE;
	}
}

/**
 * Remember a size this reader chose, so the next line they draw is set in it.
 *
 * THE WRITE IS SKIPPED WHEN NOTHING MOVED, which is most calls: the size chooser paints its answer
 * on every open of the bar and a reader picking the size a line already has has changed nothing.
 * The same bargain `rememberBoard` strikes, for the same reason: a setting write is a localStorage
 * write plus an onChange.
 *
 * ⚠ AN UNREADABLE SIZE CLEARS IT rather than being ignored, because there is one way to reach here
 * with one: the reader emptying the custom field. That is them saying "no size of my own", and the
 * honest record of it is no record.
 *
 * Silent by design. Failing to remember a number is not worth a notification on top of a line that
 * has been drawn perfectly well.
 */
export function rememberSize(px) {
	const size = readSize(px);
	if (size === getLastSize()) return null;
	try {
		return Promise.resolve(setSetting(RELMAP_SIZE_SETTING, size))
			.catch(err => console.error("Stonetop | remembering the caption size failed", err));
	} catch (err) {
		console.error("Stonetop | remembering the caption size failed", err);
		return null;
	}
}

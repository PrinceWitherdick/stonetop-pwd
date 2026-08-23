// When a scene Note is created linked to a `threat`, `hazard` or `site` page (via the
// native JournalEntryPage canvas drop from the steading tab or an open card), stamp
// it with its kind's icon, the page's name as its label, and global visibility so
// a revealed pin ignores fog-of-war. This is the ONE seam over core's page-drop
// behaviour; everything else (linking pageId, placement, click-to-open) is core.
//
// WHICH PICTURE EACH KIND WEARS is not decided here: it is two more columns of the one GM-prep
// kind table, beside everything else that varies by kind. This module is the WRITER, and the
// refit below is the reader that brings old pins up to whatever that table now says.
import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { systemAssetVariants } from "../migration/compat.js";
import {
	GM_PREP_PIN_ICON_SUFFIXES, GM_PREP_PIN_TEXT_COLOR, gmPrepPageById, gmPrepPinTexture,
} from "../journal/gm-prep-page.js";
import { sameColor } from "../utils/map-pins.js";
import { sweepSceneNotes } from "./PlaceOfInterestDrop.js";

// Re-offered from their home in the kind table, because StonetopNoteLabels and this module's
// tests already knew to ask this one for them, and a pin's writer is a fair place to ask.
export {
	SITE_PIN_ICON_SUFFIX, THREAT_PIN_ICON_SUFFIX, gmPrepPinTexture,
} from "../journal/gm-prep-page.js";

/** Resolve the threat, hazard or site page a pending Note links to, or null. */
function _linkedGmPrepPage(data, noteDoc) {
	const entryId = data?.entryId ?? noteDoc?.entryId;
	const pageId = data?.pageId ?? noteDoc?.pageId;
	return gmPrepPageById(entryId, pageId);
}

/**
 * Every spelling of every kind's pin glyph, so a pin placed before a system-id rename is still
 * ours. Derived from the kind table, so a fourth kind's picture is claimed the moment it declares
 * one rather than the moment somebody remembers this list.
 */
const _OUR_PIN_ICONS = GM_PREP_PIN_ICON_SUFFIXES.flatMap(suffix => systemAssetVariants(suffix));

/** Is this note wearing one of our prep glyphs? */
const _isOurPin = (note) => {
	const src = String(note?.texture?.src ?? "");
	return !!src && _OUR_PIN_ICONS.some(path => src.includes(path));
};

/**
 * Bring the GM-prep pins already down on this world's scenes up to the current drawing.
 *
 * WHY IT HAD TO EXIST. A pin is textured once, in the preCreate hook below, and nothing has ever
 * gone back to one. That was survivable while all three kinds wore the same torn note; it stopped
 * being survivable the day a site started wearing its own mound, because every site a GM had
 * already dropped would sit there as a threat's note forever, and the tab and the map would be
 * showing two different pictures of the same prep.
 *
 * WHAT IT CLAIMS. Only a pin that resolves to a GM-prep page AND is still wearing one of OUR
 * glyphs. A GM who has pointed a prep pin at art of their own has made a decision, and this pass
 * runs on every load, so stomping it would mean stomping it forever. Silent once they agree.
 *
 * @param {object} [io] Injected world accessors, for tests.
 * @returns {Promise<number>} How many pins were re-drawn.
 */
export async function refitGmPrepPins({
	scenes = globalThis.game?.scenes ?? [],
	isGM = !!globalThis.game?.user?.isGM,
} = {}) {
	if (!isGM) return 0;
	return sweepSceneNotes(scenes, _isOurPin, note => {
		const page = gmPrepPageById(note.entryId, note.pageId);
		if (!page) return null;
		const want = gmPrepPinTexture(page.type);
		// Through `sameColor` rather than `===`, because a live Note's tint is a `Color` and not the
		// string this table declares. See map-pins.js: compared directly, "silent once they agree"
		// becomes "rewrites every prep pin on every load".
		const agrees = String(note.texture?.src ?? "") === want.src
			&& sameColor(note.texture?.tint, want.tint);
		return agrees ? null : { texture: want };
	});
}

/** preCreateNote hook: give GM-prep-linked pins the book-note look + global visibility. */
export function onPreCreateThreatNote(noteDoc, data, _options, _userId) {
	const page = _linkedGmPrepPage(data, noteDoc);
	if (!page) return;
	noteDoc.updateSource({
		texture: gmPrepPinTexture(page.type),
		iconSize: 80,
		text: page.name,
		fontSize: 44,
		textAnchor: CONST.TEXT_ANCHOR_POINTS?.BOTTOM ?? 1,
		textColor: GM_PREP_PIN_TEXT_COLOR,
		global: true,
		// The type-specific flag lets the overlay board and any pin cleanup find its kind.
		flags: { [STONETOP_SCOPE]: { [page.type]: true } },
	});
}

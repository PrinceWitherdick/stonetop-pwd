// When a scene Note is created linked to a `threat`, `hazard` or `site` page (via the
// native JournalEntryPage canvas drop from the steading tab or an open card), stamp
// it with the torn-note icon, the page's name as its label, and global visibility so
// a revealed pin ignores fog-of-war. This is the ONE seam over core's page-drop
// behaviour; everything else (linking pageId, placement, click-to-open) is core.
import { STONETOP_SCOPE } from "../actors/character/StonetopFlags.js";
import { SYSTEM_ID } from "../system-id.js";
import { gmPrepPageById } from "../journal/gm-prep-page.js";

// Authored once: StonetopNoteLabels recognises OUR notes by this path, so the writer and
// the reader must not be able to drift apart.
export const THREAT_PIN_ICON_SUFFIX = "assets/icons/threat-note.svg";
const THREAT_PIN_ICON = `systems/${SYSTEM_ID}/${THREAT_PIN_ICON_SUFFIX}`;
const PIN_TEXT_COLOR = "#1b1009";

/** Resolve the threat, hazard or site page a pending Note links to, or null. */
function _linkedGmPrepPage(data, noteDoc) {
	const entryId = data?.entryId ?? noteDoc?.entryId;
	const pageId = data?.pageId ?? noteDoc?.pageId;
	return gmPrepPageById(entryId, pageId);
}

/** preCreateNote hook: give GM-prep-linked pins the book-note look + global visibility. */
export function onPreCreateThreatNote(noteDoc, data, _options, _userId) {
	const page = _linkedGmPrepPage(data, noteDoc);
	if (!page) return;
	noteDoc.updateSource({
		texture: { src: THREAT_PIN_ICON, anchorX: 0.5, anchorY: 0.5, fit: "contain", tint: "#ffffff" },
		iconSize: 80,
		text: page.name,
		fontSize: 44,
		textAnchor: CONST.TEXT_ANCHOR_POINTS?.BOTTOM ?? 1,
		textColor: PIN_TEXT_COLOR,
		global: true,
		// The type-specific flag lets the overlay board and any pin cleanup find its kind.
		flags: { [STONETOP_SCOPE]: { [page.type]: true } },
	});
}

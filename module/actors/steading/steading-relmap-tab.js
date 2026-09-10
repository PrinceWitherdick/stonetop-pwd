// THE RELATIONSHIP MAP AS A TAB ON THE STEADING SHEET.
//
// The board that used to be reachable only from a hotbar macro now sits between Improvements and
// Notes, because everything else the table reads about Stonetop is already on this sheet, and the
// map's own village board is seeded from this sheet's resident roster.
//
// What renders there is a real RelationshipMapPanel (dialogs/RelationshipMapPanel.js), which is the
// window's own class mounted frameless. So the strip of boards, the pan and zoom, the tie bar, the
// live sync and the undo history are all the same code as the window, and there is nothing here to
// keep in step with it.
//
// PLAIN FUNCTIONS RATHER THAN A MIXIN, unlike the GM Toolkit's tabs. This sheet's idiom is a
// `wireX(root, ...)` per concern called from `activateListeners` (there are a dozen already), and
// three lifecycle calls is not enough machinery to be worth a class in the chain.

import { RelationshipMapPanel } from "../../dialogs/RelationshipMapPanel.js";
import { mountedPanelSlot } from "../../utils/mounted-panel-slot.js";
import { canCreateRelationshipMap, hasRelationshipMap } from "../../relmap/relmap-doc.js";
import { promptForNewRelationshipMap } from "../../relmap/relmap-make.js";
import { defaultBoard } from "../../relmap/relmap-last.js";
import { localize } from "../../utils/i18n.js";

/** The tab's `data-tab` key, and the class its panel wears. */
export const STEADING_RELMAP_TAB = "relmap";

/** Where the board is mounted inside that tab. */
const MOUNT_SEL = "[data-steading-relmap]";

/**
 * What the tab needs to know before there is a board to show: whether the world has a map at all,
 * and if not, whether this reader is allowed to make one.
 *
 * ⚠ MAKING A MAP AND EDITING ONE ARE DIFFERENT RIGHTS, and the asymmetry is deliberate (see
 * relmap-doc.js). Every map is created owned by everybody, so a plain PLAYER can move portraits and
 * write captions on every map in the world; creating a JournalEntry needs TRUSTED. So the button is
 * hidden rather than disabled, and the line under it says who can, which is the same bargain the
 * hotbar macro strikes when it finds no maps.
 *
 * The line itself is localized in the template alongside its two siblings, not handed through
 * here: this runs on every render of the sheet, whichever tab is showing.
 */
export function relmapTabContext() {
	return {
		hasMap: hasRelationshipMap(),
		canCreate: canCreateRelationshipMap(),
	};
}

// THE MOUNT/MOVE/DETACH/CLOSE LIFECYCLE IS SHARED with the timeline's tab; the AppV1 traps it steps
// around -- moving the element rather than re-rendering it, an element-less panel still being a
// panel, building nothing for a reader who never opens the tab -- are stated once in
// utils/mounted-panel-slot.js. Two of them bite HARDER here than there, and are worth naming:
//
//   • re-rendering rather than moving would rebuild the pan/zoom surface and re-fit it, throwing
//     away the corner the reader had zoomed into, which is the one thing this whole feature is
//     written around (see `sync()` and `_repaintBoard` on the window); and
//   • `RelationshipMapPanel._render` awaits `_ensurePage()` -- document creates, for the map's
//     first page and for the party and village boards it seeds -- before `super._render` sets
//     `_element`. So the window in which a second board could be built over the first is a wide
//     one, and `_pagesReady` being per instance, a second run of that seeding can leave the map
//     wearing two boards called "The Party".
const slot = mountedPanelSlot({
	field:    "_relmapPanel",
	tab:      STEADING_RELMAP_TAB,
	mountSel: MOUNT_SEL,
	/**
	 * Build the board, on the map this reader was last looking at.
	 *
	 * `defaultBoard()` is the hotbar macro's own answer (relmap/relmap-last.js): the board this
	 * client last had open, falling back to The Party and then to the first map. Shared on purpose,
	 * so that the tab and the macro can never land somewhere different from each other. It returns
	 * null only when the world has no maps at all, and then the invitation already rendered in the
	 * tab is what the reader sees.
	 */
	build: (sheet, mount) => {
		const landing = defaultBoard();
		if (!landing?.entry) return null;
		const options = {
			// PER SHEET, not per map. The window's id is per DOCUMENT, because AppV1 resolves an
			// element by id and two windows sharing one would paint into each other; a panel is
			// resolved by the host that holds it, and two steading sheets open at once each want
			// their own board even when it is the same map.
			id: `stonetop-relmap-panel-${sheet.actor?.id ?? "steading"}`,
			title: localize("stonetop.relmap.windowTitle"),
			...(landing.pageId ? { pageId: landing.pageId } : {}),
		};
		return new RelationshipMapPanel(landing.entry, options, mount, closed => {
			// The map was deleted at the far end of the table and the board closed itself. Put the
			// sheet back the way the world now is: another map if there is one, the invitation if
			// there is not. Identity-checked, so the teardown (which clears the field first) does
			// not bounce back through here on the sheet's way out.
			if (sheet._relmapPanel !== closed) return;
			sheet._relmapPanel = null;
			if (sheet.rendered) sheet.render(false);
		});
	},
});

export const syncRelmapTab = slot.sync;
export const detachRelmapTab = slot.detach;
export const closeRelmapTab = slot.close;

/**
 * The invitation's button, on a world that has no relationship map ANY MORE.
 *
 * ⚠ THIS IS NO LONGER THE FIRST MAP, WHICH IS WHY IT ASKS. Every world is given one called
 * "Stonetop" during setup (relmap/relmap-make.js), so this tab stands empty only where the GM has
 * deleted that map -- and handing them back a fresh map of the same name, without asking, is
 * quietly undoing the decision they just made. So the name comes from whoever presses the button,
 * through the same question the hotbar macro asks in the same situation.
 */
export async function makeFirstRelationshipMap(sheet) {
	const made = await promptForNewRelationshipMap();
	// Dismissed, or pressed by somebody who may not make one. Either way nothing was written, and
	// there is nothing for the sheet to re-render for.
	if (!made) return null;
	// The re-render lands back in `syncRelmapTab` with this tab still active, which is what mounts
	// the board. Nothing here needs to know how that happens.
	if (sheet.rendered) sheet.render(false);
	return made;
}

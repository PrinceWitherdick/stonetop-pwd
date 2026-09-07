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

/** Which tab this sheet is showing, as core's Tabs controller knows it. */
function activeTab(sheet) {
	return sheet?._tabs?.[0]?.active ?? null;
}

/**
 * Put the board where it belongs, whatever has just happened to the sheet.
 *
 * Two callers, and both are late on purpose: the FOOT of the sheet's `_render` (after the render
 * hook, which is where utils/window-restore.js puts a reloaded reader back on the tab they left
 * from, and therefore after `activateListeners`), and `_onChangeTab` (the reader arriving on the
 * tab for the first time). It is one function rather than three because the cases are told apart
 * only by what is already there, and asking that question in one place is what stops the fourth
 * one being forgotten.
 */
export function syncRelmapTab(sheet, root) {
	const mount = root?.querySelector?.(MOUNT_SEL);
	// No mount at all is the classic layout, which does not carry this tab: see the guard in
	// steading.hbs, and `classic-layout-must-stay-the-old-layout`.
	if (!mount) return;

	const panel = sheet._relmapPanel;
	const board = panel?.element?.[0];
	if (board) {
		// ⚠ THE BOARD IS MOVED, NEVER RE-RENDERED. A render rebuilds the pan/zoom surface and
		// re-fits it, which throws away the corner the reader had zoomed into -- the one thing this
		// whole feature is written around (see `sync()` and `_repaintBoard` on the window). The
		// steading sheet re-renders for reasons that have nothing to do with the map: a season
		// turning, somebody editing a resident, any write at all to this actor. So the previous
		// render's board element, detached a moment ago by `detachRelmapTab`, is simply carried
		// into the fresh tab with its listeners, its surface and its scroll position intact.
		panel.setHost(mount);
		mount.replaceChildren(board);
		return;
	}

	// ⚠ A PANEL WITH NO ELEMENT YET IS STILL A PANEL, and `element` is the wrong thing to ask.
	// `RelationshipMapPanel._render` awaits `_ensurePage()` -- document creates, for the map's first
	// page and for the party and village boards it seeds -- before `super._render` sets `_element`,
	// and AppV1's `element` falls back to `$('#id')` in the meantime, which matches nothing because
	// a frameless body carries no id. So a reader who clicks this tab and then clicks away and back
	// before that first render lands would build a SECOND board over the top of the first: five
	// global journal hooks that only `closeRelmapTab` can take off, on an instance the sheet no
	// longer holds and therefore never closes, repainting a detached tree for the rest of the
	// session -- and `_pagesReady` being per instance, a second run of the seeding that can leave
	// the map wearing two boards called "The Party".
	//
	// The host is still pointed at the fresh mount, because `_injectHTML` reads it when the render
	// finally lands and the mount it was given is by then the one the last render threw away.
	if (panel) {
		panel.setHost(mount);
		return;
	}

	// NOTHING IS BUILT FOR A READER WHO NEVER OPENS THE TAB. Rendering the board costs a walk of
	// every node and edge on the map plus five global hooks, and the first render seeds the party
	// and village boards (`_ensurePage`), which is a document write. None of that should happen
	// because somebody opened the sheet to look at the harvest.
	if (activeTab(sheet) !== STEADING_RELMAP_TAB) return;
	openRelmapPanel(sheet, mount);
}

/**
 * Build the board, on the map this reader was last looking at.
 *
 * `defaultBoard()` is the hotbar macro's own answer (relmap/relmap-last.js): the board this client
 * last had open, falling back to The Party and then to the first map. Shared on purpose, so that
 * the tab and the macro can never land somewhere different from each other. It returns null only
 * when the world has no maps at all, and then the invitation already rendered in the tab is what
 * the reader sees.
 */
function openRelmapPanel(sheet, mount) {
	const landing = defaultBoard();
	if (!landing?.entry) return null;
	const options = {
		// PER SHEET, not per map. The window's id is per DOCUMENT, because AppV1 resolves an
		// element by id and two windows sharing one would paint into each other; a panel is
		// resolved by the host that holds it, and two steading sheets open at once each want their
		// own board even when it is the same map.
		id: `stonetop-relmap-panel-${sheet.actor?.id ?? "steading"}`,
		title: localize("stonetop.relmap.windowTitle"),
		...(landing.pageId ? { pageId: landing.pageId } : {}),
	};
	const panel = new RelationshipMapPanel(landing.entry, options, mount, closed => {
		// The map was deleted at the far end of the table and the board closed itself. Put the
		// sheet back the way the world now is: another map if there is one, the invitation if there
		// is not. Identity-checked, so the teardown below (which clears the field first) does not
		// bounce back through here on the sheet's way out.
		if (sheet._relmapPanel !== closed) return;
		sheet._relmapPanel = null;
		if (sheet.rendered) sheet.render(false);
	});
	sheet._relmapPanel = panel;
	panel.render(true);
	return panel;
}

/**
 * Lift the board out of the sheet before the sheet re-renders.
 *
 * ⚠ BEFORE `super._render`, and that is the whole point of it. AppV1 repaints a sheet with
 * jQuery's `.html()`, which runs `cleanData` over every descendant on its way past. Nothing in the
 * board is bound through jQuery so nothing would actually be lost today, but the node is about to
 * be orphaned either way and taking it out first is what makes "the same element, moved" a fact
 * rather than a hope. `Element.remove()` detaches; the node itself survives on `panel._element`.
 */
export function detachRelmapTab(sheet) {
	sheet?._relmapPanel?.element?.[0]?.remove();
}

/**
 * ⚠ THE BOARD REGISTERS FIVE GLOBAL JOURNAL HOOKS AND `close()` IS THE ONLY THING THAT TAKES THEM
 * OFF (see `_wireSync`). A sheet closed without this leaves them firing on every journal write at
 * the table for the rest of the session, holding the whole board and its portraits alive with it,
 * once per steading sheet anybody ever opened.
 */
export function closeRelmapTab(sheet) {
	const panel = sheet?._relmapPanel;
	if (!panel) return;
	// Cleared FIRST, so the panel's own `onClosed` sees a sheet that is no longer holding it and
	// does not try to re-render a sheet that is closing.
	sheet._relmapPanel = null;
	panel.close();
}

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

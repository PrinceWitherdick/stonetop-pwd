// A FRAMELESS PANEL LIVING IN A SHEET TAB, AND THE THREE MOMENTS THAT KEEP IT THERE.
//
// Two features mount a whole window inside a tab -- the relationship map and the timeline -- and
// each needs the same three calls from its host sheet: DETACH before the sheet repaints, SYNC after
// it has, and CLOSE when it goes away. The logic between them was written out twice, comment for
// comment, and the parts worth having are exactly the parts that are easy to get wrong:
//
//   • THE PANEL IS MOVED, NEVER RE-RENDERED. A sheet re-renders for reasons that have nothing to do
//     with the panel -- a season turning, an HP tick, any write to the actor. Re-rendering the panel
//     would throw away where the reader had scrolled or zoomed to, which is the whole of what they
//     were looking at. So the previous render's element is carried into the fresh mount.
//   • A PANEL WITH NO ELEMENT YET IS STILL A PANEL. AppV1's `element` falls back to `$('#id')`
//     before `_element` is set, which matches nothing for a frameless body. Asking `element` and
//     building on a falsy answer lets a reader who clicks the tab, clicks away and clicks back
//     before the first render lands build a SECOND panel over the first -- global hooks the sheet
//     can no longer take off, repainting a detached tree for the rest of the session.
//   • NOTHING IS BUILT FOR A READER WHO NEVER OPENS THE TAB. These panels cost real work to render,
//     and none of it should happen because somebody opened the sheet to look at their HP.
//   • THE FIELD IS CLEARED BEFORE `close()`, so nothing reached from the close path finds a sheet
//     still holding the panel it is closing.
//
// Plain functions returned in a bundle rather than a mixin, matching the idiom both sheets already
// use: a `wireX(root, ...)` per concern, called from the sheet's own lifecycle.

/** Which tab this sheet is showing, as core's Tabs controller knows it. */
function activeTab(sheet) {
	return sheet?._tabs?.[0]?.active ?? null;
}

/**
 * Wire one panel slot on a sheet.
 *
 * @param {object} options
 * @param {string} options.field     The sheet property holding the panel (e.g. `_timelinePanel`).
 * @param {string} options.tab       The `data-tab` key the panel lives on.
 * @param {string} options.mountSel  Selector for the element inside that tab to paint into.
 * @param {(sheet: object, mount: HTMLElement) => object|null} options.build
 *        Construct the panel, UNRENDERED. The slot assigns it to the sheet and then renders, in
 *        that order, so anything the panel calls back into finds the sheet already holding it.
 * @returns {{sync: Function, detach: Function, close: Function}}
 */
export function mountedPanelSlot({ field, tab, mountSel, build }) {
	/**
	 * Put the panel where it belongs, whatever has just happened to the sheet.
	 *
	 * Two callers, and both are late on purpose: the FOOT of the sheet's `_render` (after the
	 * render hook, and therefore after `activateListeners`), and `_onChangeTab` (the reader
	 * arriving on the tab for the first time). One function rather than three because the cases are
	 * told apart only by what is already there, and asking that question in one place is what stops
	 * the fourth one being forgotten.
	 */
	function sync(sheet, root) {
		const mount = root?.querySelector?.(mountSel);
		// No mount at all is the classic layout, which does not carry these tabs. See the guards in
		// character.hbs and steading.hbs, and `classic-layout-must-stay-the-old-layout`.
		if (!mount) return;

		const panel = sheet?.[field];
		const body = panel?.element?.[0];
		if (body) {
			panel.setHost(mount);
			mount.replaceChildren(body);
			return;
		}

		// Still pointed at the fresh mount: `_injectHTML` reads the host when the render finally
		// lands, and the mount it was given is by then the one the last render threw away.
		if (panel) {
			panel.setHost(mount);
			return;
		}

		if (activeTab(sheet) !== tab) return;
		const made = build(sheet, mount);
		if (!made) return;
		sheet[field] = made;
		made.render(true);
	}

	/**
	 * Lift the panel out of the sheet before the sheet re-renders.
	 *
	 * ⚠ BEFORE `super._render`, and that is the whole point of it. AppV1 repaints a sheet with
	 * jQuery's `.html()`, which runs `cleanData` over every descendant on its way past. The node is
	 * about to be orphaned either way, and taking it out first is what makes "the same element,
	 * moved" a fact rather than a hope. `Element.remove()` detaches; the node survives on
	 * `panel._element`.
	 */
	function detach(sheet) {
		sheet?.[field]?.element?.[0]?.remove();
	}

	/**
	 * ⚠ THE PANEL REGISTERS GLOBAL JOURNAL HOOKS AND `close()` IS THE ONLY THING THAT TAKES THEM
	 * OFF. A sheet closed without this leaves them firing on every journal write at the table for
	 * the rest of the session, holding the panel and everything it draws alive with it, once per
	 * sheet anybody ever opened.
	 */
	function close(sheet) {
		const panel = sheet?.[field];
		if (!panel) return;
		// Cleared FIRST, so nothing reached from the close path finds a sheet still holding it.
		sheet[field] = null;
		panel.close();
	}

	return { sync, detach, close };
}

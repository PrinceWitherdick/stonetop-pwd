// THE RELATIONSHIP MAP, MOUNTED INSIDE SOMEBODY ELSE'S SHEET.
//
// The board is a window (RelationshipMapWindow) and it is also a tab on the steading sheet, and
// this is the whole of the difference between the two. Not a second implementation: the same class,
// the same template, the same `getData`, the same `activateListeners`, the same five journal hooks
// and the same tie bar. The other way round -- splitting relationship-map.hbs into a partial and
// lifting the 180 lines of wiring into a shared module, the way `journey-controls.js` serves the
// two hosts of the journey map -- was considered and refused: that pattern exists because the
// journey map has two DIFFERENT markups to keep in step, and here there is only one.
//
// ⚠ ALL OF THIS IS APPV1 BEHAVIOUR WE ARE ASKING FOR, NOT DEFEATING. An Application with
// `popOut: false` already knows how to be a body without a frame (client/appv1/api/application-v1.mjs):
//
//   • `_render` skips `_renderOuter` entirely and hands the inner HTML straight to `_injectHTML`,
//     so no window frame, no title bar and no header buttons are built;
//   • `_replaceHTML` does `element.replaceWith(html)` rather than painting into `.window-content`,
//     so a re-render (switching board, an ownership change) repaints in place inside the tab;
//   • `setPosition` returns at its first line for an app that is neither popOut nor resizable;
//   • the app is never entered in `ui.windows`, and `minimize`/`maximize` are no-ops.
//
// ⚠ WHICH IS WHY `resizable` MUST BE SET FALSE AND NOT MERELY LEFT OUT. The window sets it true,
// and a non-popOut app with `resizable` true gets a `Draggable` bound to it by core
// (`if (!this.popOut && this.options.resizable)`) -- a drag handle on a tab body, moving nothing.
// It is also half of what makes `setPosition` return early.
//
// THE BOARD ITSELF NEEDED NOTHING. It reads no window geometry anywhere: `ZoomPanSurface` measures
// `.stonetop-relmap-view` with a ResizeObserver and never asks the application where it is, the tie
// bar places itself off the surface's own numbers, and there is no jQuery in any of it. The
// stylesheet is the same: `.stonetop-relmap-app` has no rule at all, and the only thing the board
// asks of whatever holds it is a definite height (`.stonetop-relmap { height: 100% }`).

import { RelationshipMapWindow } from "./RelationshipMapWindow.js";
import { localize } from "../utils/i18n.js";

export class RelationshipMapPanel extends RelationshipMapWindow {
	/**
	 * @param {JournalEntry} entry  the map
	 * @param {object} options      as the window's, minus anything about geometry
	 * @param {HTMLElement} host    the element this board is to live inside
	 * @param {Function} [onClosed] told when the board closes itself (the map was deleted)
	 */
	constructor(entry, options = {}, host = null, onClosed = null) {
		super(entry, options);
		// ⚠ AN INSTANCE FIELD AND NOT AN OPTION. AppV1 merges render options into `this.options`
		// with `insertKeys: false`, so a key that is not already in `defaultOptions` is dropped on
		// the way through -- silently, and only on the SECOND render, which is the worst shape a
		// bug of this kind can take.
		this._host = host;
		this._onClosed = onClosed;
	}

	static get defaultOptions() {
		const base = super.defaultOptions;
		return foundry.utils.mergeObject(base, {
			// Both halves are load-bearing; see the head of this file.
			popOut: false,
			resizable: false,
			// `mergeObject` REPLACES an array rather than concatenating it, so the window's own
			// classes are spread back in by hand.
			classes: [...(base.classes ?? []), "stonetop-relmap-panel"],
		});
	}

	/**
	 * The window's context, plus the one control that exists only here.
	 *
	 * ⚠ THE BUTTON IS DECLARED IN THE SHARED TEMPLATE AND TURNED ON FROM THIS SIDE, rather than
	 * being markup the tab adds around the board. It sits in the corner of the board itself, where
	 * the expedition map's own way out sits, and `_injectHTML` replaces the mount's children with
	 * the board -- so a button the tab drew around it could not be in that corner at all without
	 * floating over a diagram it is not part of.
	 *
	 * Being inside the viewport, it is only clickable because `BOARD_CONTROLS` names
	 * `[data-relmap-action]`: a press the pan surface does not recognise takes a pointer capture
	 * and the control is dead. That is why it keeps that attribute rather than one of its own.
	 *
	 * Not gated on `canEdit`, and deliberately: see the button's own note in the template.
	 */
	async getData() {
		return {
			...await super.getData(),
			canPopOut: true,
			// ONE STRING, for the tooltip and the accessible name alike. The control is a glyph in
			// the board's corner with no words on it, so what it says is what a reader hears or
			// hovers to find out -- the same shape the undo pair in the footer takes.
			popOutLabel: localize("stonetop.relmap.popOut"),
		};
	}

	/**
	 * Point the board at the element it is to be painted into.
	 *
	 * Called on every render of the host sheet, because the sheet's own re-render throws its whole
	 * body away and builds a fresh mount. A board painted into the host it was given three renders
	 * ago is painted into a node nothing is looking at.
	 */
	setHost(host) {
		this._host = host ?? null;
	}

	/**
	 * ⚠ THE ONE METHOD THAT HAS TO BE REPLACED. Core's version appends the body to `document.body`
	 * and fades it in, which for a frameless application is the only sensible default and is not
	 * what a tab wants.
	 *
	 * `replaceChildren` rather than `append`: the mount carries the "no map yet" invitation while
	 * the world has none, and a board arriving beside that invitation would say two things at once.
	 */
	_injectHTML(html) {
		const node = html?.[0];
		if (!node) return;
		this._host?.replaceChildren(node);
		this._element = html;
	}

	/**
	 * ⚠ NEVER RAISED, AND THIS IS NOT COSMETIC. `StonetopDialog._render` runs `FrontOnOpen.apply()`
	 * on every open, whose whole job is `bringToTop()`; core's implementation stamps a `z-index` on
	 * `this.element[0]` and sets `ui.activeWindow = this`. On a window that is exactly right. On a
	 * board sitting inside a sheet it puts a stacking context on a grid child and tells the rest of
	 * Foundry that the active window is something with no frame, which is how the real window under
	 * the pointer stops being brought forward.
	 */
	bringToTop() {}

	/**
	 * Closing is what happens when the map is deleted out from under this board (see `_wireSync`),
	 * as well as what the host sheet asks for on its own way out.
	 *
	 * ⚠ NEVER ANIMATED. Core closes a frameless application by `slideUp`-ing the element and then
	 * removing it, which on a tab body is a diagram folding itself up over half a second and
	 * leaving a hole. There is nothing here to watch leave: the tab either shows another board or
	 * shows the invitation, and the host is told so it can decide which.
	 */
	async close(options = {}) {
		await super.close({ ...options, animate: false });
		const told = this._onClosed;
		this._onClosed = null;
		told?.(this);
	}
}

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
// BEING FRAMELESS IS `FramelessPanel` (utils/frameless-panel.js), which the timeline's panel wears
// too: the `popOut: false` behaviour AppV1 gives for free, why `resizable` must be set false rather
// than left out, why `_injectHTML` has to be replaced, and why `bringToTop` must do nothing. Every
// line of it is a bug somebody already had, and it is stated there once.
//
// THE BOARD ITSELF NEEDED NOTHING. It reads no window geometry anywhere: `ZoomPanSurface` measures
// `.stonetop-relmap-view` with a ResizeObserver and never asks the application where it is, the tie
// bar places itself off the surface's own numbers, and there is no jQuery in any of it. The
// stylesheet is the same: `.stonetop-relmap-app` has no rule at all, and the only thing the board
// asks of whatever holds it is a definite height (`.stonetop-relmap { height: 100% }`).

import { RelationshipMapWindow } from "./RelationshipMapWindow.js";
import { FramelessPanel } from "../utils/frameless-panel.js";
import { localize } from "../utils/i18n.js";

export class RelationshipMapPanel
	extends FramelessPanel(RelationshipMapWindow, { panelClass: "stonetop-relmap-panel" }) {
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
	 * Closing is what happens when the map is deleted out from under this board (see `_wireSync`),
	 * as well as what the host sheet asks for on its own way out.
	 *
	 * The un-animated close is the mixin's; what is this board's own is TELLING THE HOST, so the tab
	 * can decide whether to show another board or the invitation.
	 */
	async close(options = {}) {
		await super.close(options);
		const told = this._onClosed;
		this._onClosed = null;
		told?.(this);
	}
}

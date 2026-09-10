// THE TIMELINE, MOUNTED INSIDE SOMEBODY ELSE'S SHEET.
//
// The timeline is a window (TimelineWindow) and it is also a tab on the steading sheet and on every
// character sheet, and this is the whole of the difference between the three. Not a second
// implementation: the same class, the same template, the same getData, the same listeners, the same
// three journal hooks and the same single write path.
//
// Everything about being frameless lives in `FramelessPanel` (utils/frameless-panel.js), which the
// relationship map's panel wears too -- that is where the AppV1 lore and the reasons behind it are.
// What is left here is only what is the TIMELINE'S own: which track it shows, and its id.

import { TimelineWindow } from "./TimelineWindow.js";
import { FramelessPanel } from "../utils/frameless-panel.js";

export class TimelinePanel extends FramelessPanel(TimelineWindow, { panelClass: "stonetop-timeline-panel" }) {
	/**
	 * @param {object} trackOpts    as the window's: which track this panel is showing
	 * @param {object} options      as the window's, minus anything about geometry
	 * @param {HTMLElement} host    the element this timeline is to live inside
	 */
	constructor(trackOpts = {}, options = {}, host = null) {
		super(trackOpts, options);
		// ⚠ AN INSTANCE FIELD AND NOT AN OPTION. AppV1 merges render options into `this.options`
		// with `insertKeys: false`, so a key that is not already in `defaultOptions` is dropped on
		// the way through -- silently, and only on the SECOND render.
		this._host = host;
	}

	/**
	 * ⚠ THE ID MUST NOT BE THE WINDOW'S. `TimelineWindow` declares a fixed id so a second open
	 * focuses the first, and AppV1 resolves an element by id: a panel sharing it would be found by
	 * `openOrFocus` and "brought to top", and the aggregate would refuse to open at all while any
	 * sheet with this tab was on screen. Per HOST, not per track, because two sheets open at once
	 * each want their own panel even when it is somehow the same track.
	 */
	static panelId(hostKey) {
		return `stonetop-timeline-panel-${hostKey}`;
	}
}

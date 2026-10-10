// THE TOOLBAR'S DROPDOWNS FIT THE TIMELINE THEY HANG IN.
//
// The Filter and Colours menus hang from the toolbar over the column. In the pop-out a short window
// is the reader's to drag taller; in a sheet's tab it is not, and the tab clips whatever runs past
// its foot. The Colours menu, a row per kind and Save and Cancel under them, ran off the bottom of a
// character sheet's tab with both buttons out of reach (user, 2026-10-05: "all the fixes we made to
// the popout timeline need to be applied to the one inside another sheet").
//
// So an open menu is told how much room it has, from its own top to the timeline's foot, as
// `--timeline-menu-room`; the stylesheet caps it there and scrolls what does not fit (the Colours
// menu scrolls its rows, so Save and Cancel stay in view). No rule can know that height: it is the
// host's, and a sheet's header above the tab decides it.
//
// Measured on the page and written in layout pixels: a window drawn at a UI scale reports its rects
// scaled, and the variable is spent unscaled.

import { drawnScale } from "../utils/drawn-scale.js";

/** The custom property the stylesheet reads. */
export const MENU_ROOM_VAR = "--timeline-menu-room";

/** Kept clear between the menu's foot and the timeline's, so its shadow is not cut flat. */
const MENU_ROOM_MARGIN = 8;

/**
 * Tell an open toolbar menu how much room it has below it. Nothing for a shut menu, or for one on a
 * tab that is not showing (its rects are all zero, and any figure read off them would be wrong).
 *
 * @param {HTMLDetailsElement|null} menu  The `<details>` the dropdown hangs from.
 */
export function fitMenuToTimeline(menu) {
	if (!menu?.open) return;
	const box = menu.querySelector(":scope > :not(summary)");
	const timeline = menu.closest(".stonetop-timeline");
	if (!box || !timeline) return;
	const frame = timeline.getBoundingClientRect();
	if (!frame.height || !timeline.offsetHeight) return;
	const scale = drawnScale(timeline, frame, { horizontal: false });
	const room = (frame.bottom - box.getBoundingClientRect().top) / scale - MENU_ROOM_MARGIN;
	box.style.setProperty(MENU_ROOM_VAR, `${Math.max(0, Math.floor(room))}px`);
}

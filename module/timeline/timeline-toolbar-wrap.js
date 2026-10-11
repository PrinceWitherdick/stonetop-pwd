// THE TOOLBAR'S SECOND LINE LINES UP UNDER ITS FIRST.
//
// The toolbar is one wrapping row: New Entry and the door to the full timeline on the left, the
// reader's own controls (Colours, Filter, Layout) pushed to the far end. On a sheet shrunk narrow
// the far group drops to a second line, where it hung off the right edge at its own widths under
// buttons it had nothing to do with (user, 2026-10-07: "make the second line's buttons left align
// and match the widths of the buttons above them").
//
// No rule can see that a flex row has wrapped, so it is measured: with the toolbar laid out as it
// would be anyway, does the far group start below the first button? If so the toolbar wears
// `WRAPPED_CLASS` (the stylesheet lays the group from the left) and each of the group's buttons is
// given at least the width of the button above it, in order: Colours under New Entry, Filter under
// Open the full timeline. The GM's Ages button, where there is one, leads the far group and so takes
// the first slot, the rest moving one along. Layout keeps its own width, as the strip it is.
//
// Measured in layout pixels (`offsetWidth`): a window drawn at a UI scale reports its rects scaled,
// and a width is spent unscaled. Rects are only compared with each other, so their scale cancels.

/** The class the stylesheet keys the second line's layout on. */
export const WRAPPED_CLASS = "is-wrapped";

/** The far group's buttons that take a width from above (its own buttons and the menus' summaries), in document order. */
const MATCHED = ":scope > button, :scope > details > summary";

/**
 * Watch one toolbar and keep its second line under its first.
 *
 * @param {HTMLElement|null} toolbar  The `.stonetop-timeline-toolbar`.
 * @returns {() => void}              Stops watching.
 */
export function wireToolbarWrap(toolbar) {
	const end = toolbar?.querySelector(":scope > .stonetop-timeline-toolbar-end");
	if (!end || typeof ResizeObserver !== "function") return () => {};
	const above = [...toolbar.children].filter(el => el !== end);
	if (!above.length) return () => {};

	// Only a change of WIDTH re-measures. The toolbar's height moves with the very change this makes
	// (a second line, a third), and re-measuring on that would chase its own tail.
	const widths = new Map();
	const observer = new ResizeObserver(entries => {
		let moved = false;
		for (const { target } of entries) {
			if (widths.get(target) !== target.offsetWidth) moved = true;
			widths.set(target, target.offsetWidth);
		}
		if (moved) layToolbar(toolbar, end, above);
	});
	// The buttons above too: a web font landing late widens them with the toolbar unmoved.
	for (const el of [toolbar, ...above]) observer.observe(el);
	return () => observer.disconnect();
}

/**
 * Lay the toolbar out once: back to its plain row, and if that wraps, the second line under the first.
 * Nothing on a tab that is not showing (every width is zero).
 */
export function layToolbar(toolbar, end, above) {
	const matched = [...end.querySelectorAll(MATCHED)];
	toolbar.classList.remove(WRAPPED_CLASS);
	for (const el of matched) el.style.minWidth = "";
	if (!toolbar.offsetWidth) return;

	const first = above[0].getBoundingClientRect();
	if (end.getBoundingClientRect().top < first.bottom) return;

	toolbar.classList.add(WRAPPED_CLASS);
	matched.forEach((el, i) => {
		const over = above[i];
		if (over) el.style.minWidth = `${over.offsetWidth}px`;
	});
}

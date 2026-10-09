// HOW MUCH BIGGER AN ELEMENT IS DRAWN THAN IT IS LAID OUT.
//
// A window drawn at a UI scale reports its rects (`getBoundingClientRect`, a pointer's clientX/Y)
// scaled, and its layout (`offsetWidth`, `clientLeft`, scroll offsets, the px a style is written in)
// not. Anything measured on the page and spent in layout pixels divides the on-screen distance by
// this first.

/**
 * The element's drawn size over its laid-out size along one axis; exactly 1 unscaled, or when either is 0
 * (a hidden tab) or there is no rect to read, so a caller can always divide by it.
 *
 * @param {HTMLElement} el
 * @param {{width: number, height: number}} [rect]  `el`'s own rect, when the caller already took it.
 * @param {{horizontal?: boolean}} [opts]  Which axis to read (width by default).
 * @returns {number}
 */
export function drawnScale(el, rect = el?.getBoundingClientRect?.(), { horizontal = true } = {}) {
	if (!rect) return 1;
	const drawn = horizontal ? rect.width : rect.height;
	const laid = horizontal ? el.offsetWidth : el.offsetHeight;
	if (!drawn || !laid) return 1;
	// `offsetWidth` is rounded to a whole pixel and the rect is not, so an unscaled box 612.5px
	// wide reads 612.5 / 613. Under a pixel apart is that rounding, not a scale.
	return Math.abs(drawn - laid) < 1 ? 1 : drawn / laid;
}

// How big a window that exists to show a PRINTED PAGE opens.
//
// Two windows in this system are for reading something laid out for paper: the poster maps
// (TravelMapWindow, printed at 300 dpi) and the rulebooks themselves (BookReaderWindow). Both
// had the same two problems, and solving them twice is how they came to open at different
// sizes for no reason a reader could name.
//
// A fixed pixel box is either cramped on a large screen or hanging off the edge of a small one,
// so the default is a SHARE of the window the reader actually has. But a share of the WIDTH
// alone is wrong on an ultrawide: past a point the extra width is white mat down both sides
// rather than more page, so the width is also capped against the height at roughly the shape of
// the thing being read. That shape is the one thing the two callers disagree about, so it is
// the parameter.
//
// Read at CONSTRUCTION by each caller, because an AppV1 Application merges `defaultOptions`
// per instance: the size follows the screen as it is now rather than as it was at page load.
// Only the DEFAULT is decided here. Every frame stays resizable, so a reader who wants the
// whole width can drag it there and (see utils/sheet-size.js) keep it.

/** A share of one screen dimension, or `fallback` when there is no window to measure. */
function screenShare(available, fallback, share) {
	const measured = Number(available);
	return Number.isFinite(measured) && measured > 0
		? Math.round(measured * share)
		: fallback;
}

/**
 * @param {object}  [opts]
 * @param {number}  [opts.share]           fraction of the screen to take, both axes
 * @param {number}  [opts.maxAspect]       widest the result may be as a multiple of its height
 * @param {number}  [opts.fallbackWidth]   used when there is no window to measure (headless test)
 * @param {number}  [opts.fallbackHeight]
 * @returns {{width: number, height: number}}
 */
export function openingSize({
	share = 0.8,
	maxAspect = 1.2,
	fallbackWidth = 900,
	fallbackHeight = 800,
} = {}) {
	const height = screenShare(globalThis.window?.innerHeight, fallbackHeight, share);
	const width  = screenShare(globalThis.window?.innerWidth, fallbackWidth, share);
	return { width: Math.min(width, Math.round(height * maxAspect)), height };
}

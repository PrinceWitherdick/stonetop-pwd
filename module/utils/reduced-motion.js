// The one question everything that animates has to ask first: does this reader want less motion?
//
// WHY IT HAS ITS OWN FILE FOR ONE LINE. Three places asked it -- the flasher that walks a reader to
// a row, the pan surface that lets a thrown board glide, and the gallery that rolls a tile into
// view -- and each had written the media query out for itself, one of them not even through a
// predicate. Three copies of an accessibility promise is three places to find on the day the
// promise changes, and the one that gets missed is a reader who asked for stillness and got a
// two-second glide anyway.
//
// It lives HERE rather than in any of the three because none of them owns it: importing a
// highlighter into a pan surface to borrow one line would tie two unrelated things together for
// good, which is exactly why the copies were made in the first place.

/**
 * Has this reader asked for less motion?
 *
 * ⚠ NO `matchMedia` MEANS NO, not "don't know". A test and a headless run both land there, and
 * animation is what those callers are usually checking -- so the honest default is the one that
 * leaves the motion in and lets the test say what it wants by standing `matchMedia` up itself.
 */
export function prefersReducedMotion() {
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

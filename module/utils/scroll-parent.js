/**
 * Finding the ancestor that a given element actually scrolls inside.
 *
 * Which element that is differs per host and cannot be hardcoded: the character sheet
 * scrolls in `.window-content`, the NPC sheet in its active tab panel. Two features need
 * the answer — the relationships board's drag auto-scroll and the moves sidebar's collapse
 * handle — and both were walking the ancestor chain themselves.
 *
 * `overflow: hidden` ancestors are deliberately skipped. `.stonetop-sheet-layout` is one:
 * it clips rather than scrolls, so anchoring to it reproduces the very bugs these callers
 * exist to fix.
 */

const SCROLLABLE_OVERFLOW = new Set(["auto", "scroll", "overlay"]);

/**
 * The nearest scrolling ancestor of `node`, or null.
 *
 * @param {HTMLElement} node
 * @param {object}  [options]
 * @param {boolean} [options.mustOverflow]  when true, also require the ancestor to be
 *   overflowing RIGHT NOW (`scrollHeight > clientHeight`). Callers that act during a
 *   gesture want this — an ancestor that isn't overflowing has nothing to scroll. Callers
 *   that bind a listener up front must NOT, because at wire time the content may not have
 *   grown tall enough yet and they would bind to nothing.
 * @returns {HTMLElement|null}
 */
export function scrollParent(node, { mustOverflow = false } = {}) {
	for (let el = node?.parentElement; el; el = el.parentElement) {
		if (SCROLLABLE_OVERFLOW.has(getComputedStyle(el).overflowY)
			&& (!mustOverflow || el.scrollHeight > el.clientHeight)) return el;
		if (el === el.ownerDocument?.body) break;
	}
	return null;
}

